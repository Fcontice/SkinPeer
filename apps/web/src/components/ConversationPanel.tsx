import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { buildOfferChains, type OfferChain } from '../lib/offerChains'
import { TradeOfferModal } from './TradeOfferModal'
import type { Conversation, Message, OfferStatus, TradeOffer } from '../types/traderNetwork'

const STATUS_COLOR: Record<OfferStatus, string> = {
  pending: 'bg-warning/20 text-warning',
  accepted: 'bg-accent/20 text-accent',
  rejected: 'bg-danger/20 text-danger',
  withdrawn: 'bg-gray-500/20 text-gray-400',
  countered: 'bg-blue-500/20 text-blue-300',
}

interface ConvoView {
  conversation: Conversation
  messages: Message[]
}

interface Props {
  conversationId: string
  onBack?: () => void
}

export function ConversationPanel({ conversationId, onBack }: Props) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [data, setData] = useState<ConvoView | null>(null)
  const [offers, setOffers] = useState<Map<string, TradeOffer>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [openChainRoot, setOpenChainRoot] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setData(null)
    setError(null)
    setOffers(new Map())
    apiFetch<ConvoView>(`/conversations/${conversationId}`)
      .then(setData)
      .catch((e: Error) => setError(e.message))
    apiFetch<{ rows: TradeOffer[] }>(`/offers/by-conversation/${conversationId}`)
      .then((d) => {
        const m = new Map<string, TradeOffer>()
        for (const o of d.rows) m.set(o.id, o)
        setOffers(m)
      })
      .catch(() => { /* non-fatal */ })
  }, [conversationId])

  useEffect(() => {
    if (!conversationId) return
    const ch = supabase
      .channel(`offers-panel:${conversationId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'trade_offers', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          setOffers((prev) => {
            const next = new Map(prev)
            if (payload.eventType === 'DELETE') {
              const oid = (payload.old as { id?: string } | null)?.id
              if (oid) next.delete(oid)
            } else {
              const o = payload.new as TradeOffer
              next.set(o.id, o)
            }
            return next
          })
        })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [conversationId])

  useEffect(() => {
    if (!conversationId) return
    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const m = payload.new as Message
          setData((prev) => {
            if (!prev) return prev
            if (prev.messages.find((x) => x.id === m.id)) return prev
            return { ...prev, messages: [...prev.messages, m] }
          })
        }
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [conversationId])

  useEffect(() => {
    if (!data) return
    apiFetch(`/conversations/${conversationId}/read`, { method: 'POST' }).catch(() => {})
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [data?.messages.length, conversationId, data])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    setSending(true)
    try {
      await apiFetch<Message>(`/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: body.trim() }),
      })
      setBody('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  const { skipMessageIds, chainByOfferId, chainByRoot } = useMemo(() => {
    const chainByOfferId = new Map<string, OfferChain>()
    const chainByRoot = new Map<string, OfferChain>()
    if (!data) return { skipMessageIds: new Set<string>(), chainByOfferId, chainByRoot }
    const chains = buildOfferChains(Array.from(offers.values()), data.messages)
    const anchorIds = new Set<string>()
    for (const c of chains) {
      if (c.anchorMessageId) anchorIds.add(c.anchorMessageId)
      chainByRoot.set(c.rootId, c)
      for (const o of c.offers) chainByOfferId.set(o.id, c)
    }
    const skip = new Set<string>()
    for (const m of data.messages) {
      if (m.kind !== 'trade_offer') continue
      if (!anchorIds.has(m.id)) skip.add(m.id)
    }
    return { skipMessageIds: skip, chainByOfferId, chainByRoot }
  }, [offers, data])

  if (error) {
    return (
      <div className="bg-card border border-border rounded-xl p-6">
        <p className="text-danger text-sm">{error}</p>
      </div>
    )
  }

  if (!data || !user) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 flex items-center gap-3 text-gray-500">
        <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
        <span className="text-sm">Loading conversation…</span>
      </div>
    )
  }

  const other =
    data.conversation.user_a_id === user.id ? data.conversation.user_b : data.conversation.user_a
  const displayName = other?.steam_persona ?? other?.username ?? 'Unknown trader'

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden flex flex-col h-[calc(100vh-13rem)] min-h-[28rem] shadow-[0_0_40px_rgba(0,0,0,0.35)]">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
        <div className="flex items-center gap-3 min-w-0">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="md:hidden text-gray-400 hover:text-white p-1 -ml-1"
              aria-label="Back to messages"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}
          {other?.steam_avatar ? (
            <img
              src={other.steam_avatar}
              alt=""
              className="w-10 h-10 rounded-md border border-border shrink-0"
            />
          ) : (
            <div className="w-10 h-10 rounded-md bg-bg border border-border shrink-0" />
          )}
          <div className="min-w-0">
            <h2 className="font-semibold truncate">{displayName}</h2>
            <Link
              to={`/traders/${other?.id ?? ''}`}
              className="text-xs text-gray-400 hover:text-accent transition"
            >
              View profile
            </Link>
          </div>
        </div>
        <button
          onClick={() => navigate(`/messages/${conversationId}/propose`)}
          className="bg-accent text-bg font-semibold rounded-md px-4 py-2 text-sm hover:opacity-90 transition shadow-[0_0_18px_rgba(16,185,129,0.25)] shrink-0"
        >
          Propose trade
        </button>
      </div>

      {/* Message thread */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-5 py-4 space-y-2 bg-bg/40"
      >
        {data.messages.length === 0 && (
          <p className="text-gray-500 text-sm text-center py-8">No messages yet. Say hi.</p>
        )}
        {data.messages.map((m) => {
          if (skipMessageIds.has(m.id)) return null
          const mine = m.sender_id === user.id
          if (m.kind === 'trade_proposal_link') {
            const proposalId = (m.metadata as { proposal_id?: string } | null)?.proposal_id
            return (
              <div key={m.id} className="text-center text-xs text-gray-400 py-2">
                <Link to={`/proposals/${proposalId}`} className="text-accent underline">
                  Trade proposal opened — click to view
                </Link>
              </div>
            )
          }
          if (m.kind === 'trade_offer') {
            const oid = (m.metadata as { offer_id?: string } | null)?.offer_id
            if (!oid) return null
            const chain = chainByOfferId.get(oid)
            if (!chain) return null
            const latest = chain.latest
            const isMine = latest.from_user_id === user.id
            const youWantCount = isMine ? latest.requested_items.length : latest.offered_items.length
            const youOfferCount = isMine ? latest.offered_items.length : latest.requested_items.length
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setOpenChainRoot(chain.rootId)}
                className="w-full text-left bg-bg/60 border border-border rounded-md px-3 py-2 hover:border-accent flex items-center gap-3 transition"
              >
                <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase ${STATUS_COLOR[latest.status]}`}>
                  {latest.status}
                </span>
                <span className="text-xs text-gray-300 truncate">
                  Trade proposal — You want {youWantCount} item{youWantCount === 1 ? '' : 's'}
                  {' ↔ '}
                  You offer {youOfferCount} item{youOfferCount === 1 ? '' : 's'}
                </span>
                <span className="ml-auto text-gray-500 text-xs">▾</span>
              </button>
            )
          }
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`rounded-lg px-3 py-2 max-w-md text-sm ${
                  mine
                    ? 'bg-accent text-bg'
                    : 'bg-card border border-border text-gray-100'
                }`}
              >
                <p className="whitespace-pre-wrap">{m.body}</p>
                <p className={`text-[10px] mt-1 ${mine ? 'text-bg/60' : 'text-gray-500'}`}>
                  {new Date(m.created_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Composer */}
      <form onSubmit={send} className="flex gap-2 p-4 border-t border-border bg-card">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Type a message..."
          maxLength={2000}
          className="flex-1 bg-bg border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent/60 transition"
        />
        <button
          type="submit"
          disabled={sending || !body.trim()}
          className="bg-accent text-bg font-semibold rounded-md px-5 py-2 text-sm disabled:opacity-50 hover:opacity-90 transition"
        >
          {sending ? '…' : 'Send'}
        </button>
      </form>

      {openChainRoot && chainByRoot.get(openChainRoot) && (
        <TradeOfferModal
          chain={chainByRoot.get(openChainRoot)!}
          onClose={() => setOpenChainRoot(null)}
        />
      )}
    </div>
  )
}


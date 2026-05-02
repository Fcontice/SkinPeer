import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { apiFetch } from '../lib/api'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { PriceProvider } from '../context/PriceContext'
import { TradeOfferCard } from '../components/TradeOfferCard'
import { buildOfferChains, type OfferChain } from '../lib/offerChains'
import type { Conversation, Message, TradeOffer } from '../types/traderNetwork'

interface ConvoView {
  conversation: Conversation
  messages: Message[]
}

type Tab = 'chat' | 'trades'
type Filter = 'all' | 'active' | 'completed' | 'closed'

export function ConversationPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [convo, setConvo] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [offers, setOffers] = useState<Map<string, TradeOffer>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [tab, setTab] = useState<Tab>('chat')
  const [filter, setFilter] = useState<Filter>('all')
  const [manuallyExpanded, setManuallyExpanded] = useState<Set<string>>(new Set())
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    apiFetch<ConvoView>(`/conversations/${id}`)
      .then((data) => {
        if (cancelled) return
        setConvo(data.conversation)
        setMessages(data.messages)
      })
      .catch((e: Error) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [id])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    apiFetch<{ rows: TradeOffer[] }>(`/offers/by-conversation/${id}`)
      .then((data) => {
        if (cancelled) return
        const m = new Map<string, TradeOffer>()
        for (const o of data.rows) m.set(o.id, o)
        setOffers(m)
      })
      .catch(() => { /* non-fatal — UI degrades to no cards */ })
    return () => { cancelled = true }
  }, [id])

  useEffect(() => {
    if (!id) return
    const ch = supabase
      .channel(`messages:${id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${id}` },
        (payload) => {
          const m = payload.new as Message
          setMessages((prev) => (prev.find((x) => x.id === m.id) ? prev : [...prev, m]))
        })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [id])

  useEffect(() => {
    if (!id) return
    const ch = supabase
      .channel(`offers:${id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'trade_offers', filter: `conversation_id=eq.${id}` },
        (payload) => {
          setOffers((prev) => {
            const next = new Map(prev)
            if (payload.eventType === 'DELETE') {
              const oldId = (payload.old as { id?: string } | null)?.id
              if (oldId) next.delete(oldId)
            } else {
              const o = payload.new as TradeOffer
              next.set(o.id, o)
            }
            return next
          })
        })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [id])

  useEffect(() => {
    if (!convo) return
    apiFetch(`/conversations/${id}/read`, { method: 'POST' }).catch(() => {})
    if (scrollRef.current && tab === 'chat') {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length, id, convo, tab])

  const chains = useMemo(
    () => buildOfferChains(Array.from(offers.values()), messages),
    [offers, messages],
  )

  const chainByRoot = useMemo(() => {
    const m = new Map<string, OfferChain>()
    for (const c of chains) m.set(c.rootId, c)
    return m
  }, [chains])

  const offerIdToChain = useMemo(() => {
    const m = new Map<string, OfferChain>()
    for (const c of chains) for (const o of c.offers) m.set(o.id, c)
    return m
  }, [chains])

  // Skip messages whose offer is not the most recent in its chain
  const messageIdsToSkip = useMemo(() => {
    const skip = new Set<string>()
    for (const m of messages) {
      if (m.kind !== 'trade_offer') continue
      const oid = (m.metadata as { offer_id?: string } | null)?.offer_id
      if (!oid) continue
      const c = offerIdToChain.get(oid)
      if (c && m.id !== c.anchorMessageId) skip.add(m.id)
    }
    return skip
  }, [messages, offerIdToChain])

  // For each chain, true if any message has created_at > anchor's created_at
  const chainHasNewerBelow = useMemo(() => {
    const result = new Map<string, boolean>()
    for (const c of chains) {
      let anchorTs = ''
      if (c.anchorMessageId) {
        const m = messages.find((x) => x.id === c.anchorMessageId)
        if (m) anchorTs = m.created_at
      }
      const hasNewer = anchorTs ? messages.some((m) => m.created_at > anchorTs) : false
      result.set(c.rootId, hasNewer)
    }
    return result
  }, [chains, messages])

  const me = user?.id ?? ''
  const tabPendingCount = useMemo(
    () => chains.filter((c) => c.latest.status === 'pending' && c.latest.to_user_id === me).length,
    [chains, me],
  )

  function expandManually(rootId: string) {
    setManuallyExpanded((prev) => {
      if (prev.has(rootId)) {
        const next = new Set(prev)
        next.delete(rootId)
        return next
      }
      return new Set(prev).add(rootId)
    })
  }

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    setSending(true)
    try {
      await apiFetch<Message>(`/conversations/${id}/messages`, {
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

  if (error) return <Layout><p className="text-danger">{error}</p></Layout>
  if (!convo || !user) return <Layout><p className="text-gray-400">Loading...</p></Layout>

  const other = convo.user_a_id === user.id ? convo.user_b : convo.user_a

  return (
    <PriceProvider>
      <Layout>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {other?.steam_avatar && <img src={other.steam_avatar} alt="" className="w-10 h-10 rounded" />}
            <div>
              <h1 className="text-xl font-bold">{other?.steam_persona ?? other?.username ?? 'Unknown trader'}</h1>
              <Link to={`/traders/${other?.id ?? ''}`} className="text-xs text-gray-400 hover:text-accent">View profile</Link>
            </div>
          </div>
          <button
            onClick={() => navigate(`/messages/${id}/propose`)}
            className="bg-accent text-black font-semibold rounded px-4 py-2"
          >
            Propose trade
          </button>
        </div>

        <div className="flex gap-1 mb-3 border-b border-border">
          <TabButton active={tab === 'chat'} onClick={() => setTab('chat')}>Chat</TabButton>
          <TabButton active={tab === 'trades'} onClick={() => setTab('trades')}>
            <span className="relative">
              Trades
              {tabPendingCount > 0 && (
                <span className="absolute -top-1 -right-3 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-warning text-[10px] text-black font-semibold">
                  {tabPendingCount}
                </span>
              )}
            </span>
          </TabButton>
        </div>

        {tab === 'chat' ? (
          <div ref={scrollRef} className="bg-card border border-border rounded p-4 h-96 overflow-y-auto space-y-2 mb-4">
            {messages.length === 0 && <p className="text-gray-500 text-sm">No messages yet. Say hi.</p>}
            {messages.map((m) => {
              if (messageIdsToSkip.has(m.id)) return null
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
                const chain = offerIdToChain.get(oid)
                if (!chain) return null
                const c = chainByRoot.get(chain.rootId)!
                return (
                  <TradeOfferCard
                    key={c.rootId}
                    chain={c}
                    defaultMinimized={chainHasNewerBelow.get(c.rootId) ?? false}
                    manuallyExpanded={manuallyExpanded.has(c.rootId)}
                    onManualExpand={() => expandManually(c.rootId)}
                  />
                )
              }

              return (
                <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`rounded px-3 py-2 max-w-md text-sm ${mine ? 'bg-accent text-black' : 'bg-bg border border-border'}`}>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                    <p className={`text-[10px] mt-1 ${mine ? 'text-black/60' : 'text-gray-500'}`}>
                      {new Date(m.created_at).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <TradesView
            chains={chains}
            filter={filter}
            setFilter={setFilter}
            manuallyExpanded={manuallyExpanded}
            expandManually={expandManually}
          />
        )}

        {tab === 'chat' && (
          <form onSubmit={send} className="flex gap-2">
            <input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Type a message..."
              maxLength={2000}
              className="flex-1 bg-card border border-border rounded px-3 py-2"
            />
            <button
              type="submit"
              disabled={sending || !body.trim()}
              className="bg-accent text-black font-semibold rounded px-4 py-2 disabled:opacity-50"
            >
              {sending ? '...' : 'Send'}
            </button>
          </form>
        )}
      </Layout>
    </PriceProvider>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-sm px-4 py-2 -mb-px border-b-2 ${
        active ? 'border-accent text-white' : 'border-transparent text-gray-400 hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

function TradesView({
  chains,
  filter,
  setFilter,
  manuallyExpanded,
  expandManually,
}: {
  chains: OfferChain[]
  filter: Filter
  setFilter: (f: Filter) => void
  manuallyExpanded: Set<string>
  expandManually: (rootId: string) => void
}) {
  const sorted = useMemo(() => {
    return [...chains].sort((a, b) => b.latest.created_at.localeCompare(a.latest.created_at))
  }, [chains])

  const filtered = useMemo(() => {
    return sorted.filter((c) => {
      const s = c.latest.status
      if (filter === 'all') return true
      if (filter === 'active') return s === 'pending'
      if (filter === 'completed') return s === 'accepted'
      if (filter === 'closed') return s === 'rejected' || s === 'withdrawn' || s === 'countered'
      return true
    })
  }, [sorted, filter])

  return (
    <div className="bg-card border border-border rounded p-4 mb-4">
      <div className="flex gap-2 mb-3 flex-wrap">
        {(['all', 'active', 'completed', 'closed'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1 rounded border capitalize ${
              filter === f ? 'bg-accent text-black border-accent' : 'bg-bg border-border hover:border-gray-500'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-gray-500 text-sm py-4 text-center">
          {chains.length === 0
            ? 'No trades in this conversation yet. Click "Propose trade" above.'
            : 'No trades match this filter.'}
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => (
            <TradeOfferCard
              key={c.rootId}
              chain={c}
              defaultMinimized={false}
              manuallyExpanded={manuallyExpanded.has(c.rootId)}
              onManualExpand={() => expandManually(c.rootId)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

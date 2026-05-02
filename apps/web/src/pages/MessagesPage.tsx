import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { ConversationPanel } from '../components/ConversationPanel'
import { apiFetch } from '../lib/api'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { Conversation, Message } from '../types/traderNetwork'

function otherParty(c: Conversation, meId: string) {
  return c.user_a_id === meId ? c.user_b : c.user_a
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const then = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - then.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const sameDay = then.toDateString() === now.toDateString()
  if (sameDay) return `${diffHr}h ago`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (then.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return then.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' })
}

function previewText(c: Conversation, meId: string): string {
  const m = c.last_message
  if (!m) return 'No messages yet'
  const prefix = m.sender_id === meId ? 'You: ' : ''
  if (m.kind === 'trade_offer') return `${prefix}Sent a trade offer`
  if (m.kind === 'trade_proposal_link') return `${prefix}Opened a trade proposal`
  if (m.kind === 'system') return m.body
  return `${prefix}${m.body}`
}

export function MessagesPage() {
  const { id: activeId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const refetch = useCallback(async () => {
    try {
      const data = await apiFetch<Conversation[]>('/conversations')
      setConversations(data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load conversations')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refetch()
  }, [refetch])

  // Refresh the list whenever a new message arrives in any of the user's
  // conversations (RLS limits realtime to messages we can see).
  useEffect(() => {
    if (!user) return
    const ch = supabase
      .channel('messages-list')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const m = payload.new as Message
          setConversations((prev) => {
            const idx = prev.findIndex((c) => c.id === m.conversation_id)
            if (idx === -1) {
              // New conversation we don't have yet — refetch from server.
              void refetch()
              return prev
            }
            const updated: Conversation = {
              ...prev[idx],
              last_message_at: m.created_at,
              last_message: {
                body: m.body,
                kind: m.kind,
                sender_id: m.sender_id,
                created_at: m.created_at,
              },
              unread_count:
                m.sender_id === user.id || m.conversation_id === activeId
                  ? prev[idx].unread_count ?? 0
                  : (prev[idx].unread_count ?? 0) + 1,
            }
            const next = [updated, ...prev.slice(0, idx), ...prev.slice(idx + 1)]
            return next
          })
        }
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [user, activeId, refetch])

  // When the active conversation changes, zero out its unread count locally —
  // the server is marking it read via ConversationPanel's effect.
  useEffect(() => {
    if (!activeId) return
    setConversations((prev) =>
      prev.map((c) => (c.id === activeId ? { ...c, unread_count: 0 } : c))
    )
  }, [activeId])

  const filtered = useMemo(() => {
    if (!user) return conversations
    const q = query.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter((c) => {
      const o = otherParty(c, user.id)
      const name = (o?.steam_persona ?? o?.username ?? '').toLowerCase()
      return name.includes(q)
    })
  }, [conversations, query, user])

  const showRail = !!activeId

  return (
    <Layout>
      <div className="md:flex md:gap-6 md:items-start">
        {/* List pane */}
        <aside
          className={`
            transition-all duration-300 ease-out
            ${showRail
              ? 'hidden md:block md:w-80 md:flex-shrink-0'
              : 'w-full max-w-3xl mx-auto'
            }
          `}
        >
          <div className="mb-5">
            <h1 className="text-3xl font-bold tracking-tight mb-1">Messages</h1>
            {!showRail && (
              <p className="text-sm text-gray-400">
                Direct conversations with traders. Pick a thread to continue.
              </p>
            )}
          </div>

          <div className="relative mb-4">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by username…"
              className="w-full bg-card border border-border rounded-md pl-9 pr-3 py-2 text-sm placeholder:text-gray-500 focus:outline-none focus:border-accent/60 transition"
            />
            <svg
              aria-hidden="true"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </div>

          {error && <p className="text-danger text-sm mb-3">{error}</p>}

          {loading ? (
            <div className="flex items-center gap-3 text-gray-500 px-1 py-3">
              <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
              <span className="text-sm">Loading conversations…</span>
            </div>
          ) : filtered.length === 0 ? (
            query.trim() ? (
              <div className="bg-card border border-border rounded-xl p-6 text-center">
                <p className="text-sm text-gray-400">
                  No traders match <span className="text-white">"{query}"</span>.
                </p>
              </div>
            ) : (
              <EmptyState />
            )
          ) : (
            <ul className="space-y-2">
              {filtered.map((c) => {
                const other = user ? otherParty(c, user.id) : null
                const name = other?.steam_persona ?? other?.username ?? 'Unknown trader'
                const isActive = c.id === activeId
                const unread = (c.unread_count ?? 0) > 0 && !isActive
                return (
                  <li key={c.id}>
                    <Link
                      to={`/messages/${c.id}`}
                      className={`
                        group block rounded-xl border p-3 transition-all
                        ${isActive
                          ? 'bg-accent/10 border-accent/50 shadow-[0_0_0_1px_rgba(16,185,129,0.4),0_0_24px_rgba(16,185,129,0.15)]'
                          : 'bg-card border-border hover:border-accent/40 hover:shadow-[0_0_24px_rgba(16,185,129,0.08)]'
                        }
                      `}
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="relative shrink-0">
                          {other?.steam_avatar ? (
                            <img
                              src={other.steam_avatar}
                              alt=""
                              className="w-10 h-10 rounded-md border border-border"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-md bg-bg border border-border" />
                          )}
                          {unread && (
                            <span
                              aria-label="Unread messages"
                              className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-accent ring-2 ring-card shadow-[0_0_8px_rgba(16,185,129,0.7)]"
                            />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <p
                              className={`truncate ${
                                unread ? 'font-semibold text-white' : 'font-medium text-gray-100'
                              }`}
                            >
                              {name}
                            </p>
                            <span
                              className={`text-[11px] shrink-0 ${
                                unread ? 'text-accent' : 'text-gray-500'
                              }`}
                            >
                              {relativeTime(c.last_message_at ?? c.created_at)}
                            </span>
                          </div>
                          <p
                            className={`text-xs truncate mt-0.5 ${
                              unread ? 'text-gray-200' : 'text-gray-500'
                            }`}
                          >
                            {user ? previewText(c, user.id) : ''}
                          </p>
                        </div>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>

        {/* Chat pane */}
        {activeId && (
          <main
            key={activeId}
            className="flex-1 min-w-0 w-full animate-messages-slide-in"
          >
            <ConversationPanel
              conversationId={activeId}
              onBack={() => navigate('/messages')}
            />
          </main>
        )}
      </div>
    </Layout>
  )
}

function EmptyState() {
  return (
    <div className="bg-card border border-border rounded-xl p-10 text-center shadow-[0_0_40px_rgba(0,0,0,0.35)]">
      <div className="mx-auto w-12 h-12 rounded-xl bg-accent/10 border border-accent/30 flex items-center justify-center mb-4">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-accent"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold mb-1">No conversations yet</h2>
      <p className="text-sm text-gray-400 max-w-sm mx-auto mb-5">
        Start a thread with a trader to coordinate a verified Steam trade.
      </p>
      <Link
        to="/traders"
        className="inline-flex items-center justify-center gap-2 bg-accent text-bg font-semibold px-5 py-2.5 rounded-md text-sm hover:opacity-90 transition shadow-[0_0_18px_rgba(16,185,129,0.25)]"
      >
        Find traders
      </Link>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import type { ProposalStatus, TradeOffer, TradeProposal } from '../types/traderNetwork'

const STATUSES: Array<ProposalStatus | 'all'> = [
  'all', 'draft', 'completed', 'cancelled', 'disputed',
]

export function MyTradesPage() {
  const { user } = useAuth()
  const [filter, setFilter] = useState<ProposalStatus | 'all'>('all')
  const [proposals, setProposals] = useState<TradeProposal[]>([])
  const [inbound, setInbound] = useState<TradeOffer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filter !== 'all') params.set('status', filter)
    apiFetch<TradeProposal[]>(`/proposals/me?${params.toString()}`)
      .then((data) => setProposals(data))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [filter])

  useEffect(() => {
    if (!user) return
    let cancelled = false

    async function refresh() {
      try {
        const data = await apiFetch<{ count: number; rows: TradeOffer[] }>('/offers/inbound/pending')
        if (!cancelled) setInbound(data.rows)
      } catch {
        /* ignore */
      }
    }

    void refresh()

    const ch = supabase
      .channel(`my-trades-inbound:${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trade_offers', filter: `to_user_id=eq.${user.id}` },
        () => void refresh()
      )
      .subscribe()

    return () => {
      cancelled = true
      void supabase.removeChannel(ch)
    }
  }, [user?.id])

  return (
    <Layout>
      <h1 className="text-2xl font-bold mb-4">My trades</h1>

      {inbound.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-2">Offers awaiting your action</h2>
          <ul className="space-y-2">
            {inbound.map((o) => (
              <li key={o.id}>
                <Link
                  to={`/messages/${o.conversation_id}`}
                  className="block bg-card border border-warning/50 rounded p-3 hover:border-warning"
                >
                  <div className="flex items-center justify-between text-sm">
                    <span>
                      {o.requested_items.length} item{o.requested_items.length === 1 ? '' : 's'} requested
                      {' · '}
                      {o.offered_items.length} item{o.offered_items.length === 1 ? '' : 's'} offered
                    </span>
                    <span className="text-xs text-gray-400">
                      {new Date(o.created_at).toLocaleString()}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex gap-2 mb-6 flex-wrap">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`text-sm px-3 py-1 rounded border ${
              filter === s ? 'bg-accent text-black border-accent' : 'bg-card border-border hover:border-gray-500'
            }`}
          >
            {s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {error && <p className="text-danger text-sm mb-3">{error}</p>}

      {loading ? (
        <p className="text-gray-400">Loading...</p>
      ) : proposals.length === 0 ? (
        <p className="text-gray-400">No proposals match this filter.</p>
      ) : (
        <ul className="space-y-2">
          {proposals.map((p) => (
            <li key={p.id}>
              <Link
                to={`/proposals/${p.id}`}
                className="block bg-card border border-border rounded p-4 hover:border-accent"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-mono text-sm text-accent">{p.verification_code}</p>
                    <p className="text-xs text-gray-400 mt-1 capitalize">
                      {p.status.replace(/_/g, ' ')} · updated {new Date(p.updated_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Layout>
  )
}

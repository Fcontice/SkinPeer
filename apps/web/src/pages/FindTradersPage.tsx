import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import type { TraderProfile } from '../types/traderNetwork'

type Sort = 'recent' | 'rating' | 'trades'

const SORT_LABELS: Record<Sort, string> = {
  recent: 'Newest',
  rating: 'Top rated',
  trades: 'Most trades',
}

export function FindTradersPage() {
  const { profile, user } = useAuth()
  const [traders, setTraders] = useState<TraderProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<Sort>('recent')
  const [acceptingOnly, setAcceptingOnly] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      params.set('sort', sort)
      const data = await apiFetch<TraderProfile[]>(`/traders?${params.toString()}`)
      setTraders(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load traders')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort])

  const visible = acceptingOnly ? traders.filter((t) => t.accepting_trades) : traders
  const greetingName = profile?.username ?? user?.email?.split('@')[0] ?? 'trader'

  return (
    <Layout>
      <section className="bg-card border border-border rounded-xl p-5 sm:p-6 mb-6 relative overflow-hidden">
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top_right,rgba(16,185,129,0.10),transparent_60%)]"
        />
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-accent/80 mb-2">Dashboard</p>
            <h1 className="text-2xl sm:text-3xl font-bold">Welcome back, {greetingName}</h1>
            <p className="text-sm text-gray-400 mt-1">
              Browse verified traders, start a conversation, and propose a verified trade.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/proposals"
              className="inline-flex items-center gap-2 bg-card border border-border text-sm text-gray-200 px-3 py-2 rounded-md hover:border-accent/50 transition"
            >
              My trades
            </Link>
            <Link
              to="/messages"
              className="inline-flex items-center gap-2 bg-card border border-border text-sm text-gray-200 px-3 py-2 rounded-md hover:border-accent/50 transition"
            >
              Messages
            </Link>
            <Link
              to="/profile/edit"
              className="inline-flex items-center gap-2 bg-accent text-bg text-sm font-semibold px-3 py-2 rounded-md hover:opacity-90 transition"
            >
              Edit profile
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-card border border-border rounded-xl p-4 sm:p-5 mb-6">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && load()}
                placeholder="Search traders by display name…"
                className="w-full bg-bg border border-border rounded-md pl-9 pr-3 py-2 text-sm placeholder:text-gray-500 focus:border-accent focus:outline-none transition"
              />
            </div>
            <button
              onClick={() => load()}
              className="bg-accent text-bg font-semibold text-sm px-4 py-2 rounded-md hover:opacity-90 transition"
            >
              Search
            </button>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-gray-500 mr-1">Sort:</span>
              {(Object.keys(SORT_LABELS) as Sort[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setSort(s)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition ${
                    sort === s
                      ? 'bg-accent text-bg border-accent font-semibold'
                      : 'bg-bg border-border text-gray-400 hover:border-accent/50 hover:text-white'
                  }`}
                >
                  {SORT_LABELS[s]}
                </button>
              ))}
            </div>

            <label className="inline-flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={acceptingOnly}
                onChange={(e) => setAcceptingOnly(e.target.checked)}
                className="accent-accent"
              />
              Show only traders accepting trades
            </label>
          </div>
        </div>
      </section>

      {error && (
        <div className="bg-danger/10 border border-danger/40 text-sm text-danger rounded-md px-4 py-3 mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="bg-card border border-border rounded-xl p-4 animate-pulse"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-bg" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 bg-bg rounded" />
                  <div className="h-3 w-24 bg-bg rounded" />
                </div>
              </div>
              <div className="h-3 w-full bg-bg rounded mt-4" />
              <div className="h-3 w-3/4 bg-bg rounded mt-2" />
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState hasSearch={Boolean(search) || acceptingOnly} onReset={() => { setSearch(''); setAcceptingOnly(false); void load() }} />
      ) : (
        <>
          <p className="text-xs text-gray-500 mb-3">
            Showing {visible.length} trader{visible.length === 1 ? '' : 's'}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {visible.map((t) => (
              <TraderCard key={t.user_id} trader={t} />
            ))}
          </div>
        </>
      )}
    </Layout>
  )
}

function TraderCard({ trader }: { trader: TraderProfile }) {
  const initials = (trader.display_name || '?')
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

  const avatar = trader.profile?.steam_avatar ?? null

  return (
    <Link
      to={`/traders/${trader.user_id}`}
      className="group block bg-card border border-border rounded-xl p-4 hover:border-accent/60 hover:shadow-[0_0_24px_rgba(16,185,129,0.08)] transition"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          {avatar ? (
            <img
              src={avatar}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="w-10 h-10 rounded-full bg-bg border border-border object-cover shrink-0"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-bg border border-border flex items-center justify-center text-sm font-semibold text-accent shrink-0">
              {initials || '?'}
            </div>
          )}
          <div className="min-w-0">
            <h3 className="font-semibold truncate group-hover:text-accent transition">
              {trader.display_name || '(no name)'}
            </h3>
            <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
              <span>
                {trader.total_trades} trade{trader.total_trades === 1 ? '' : 's'}
              </span>
              {trader.average_rating !== null && (
                <>
                  <span className="text-gray-700">·</span>
                  <span className="inline-flex items-center gap-0.5 text-amber-400">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                    </svg>
                    {trader.average_rating.toFixed(2)}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        {trader.accepting_trades ? (
          <span className="shrink-0 text-[10px] uppercase tracking-wider text-accent bg-accent/10 border border-accent/30 rounded-full px-2 py-0.5">
            Accepting
          </span>
        ) : (
          <span className="shrink-0 text-[10px] uppercase tracking-wider text-gray-500 bg-bg border border-border rounded-full px-2 py-0.5">
            Paused
          </span>
        )}
      </div>
      {trader.bio ? (
        <p className="text-sm text-gray-400 mt-3 line-clamp-2 leading-relaxed">{trader.bio}</p>
      ) : (
        <p className="text-sm text-gray-600 mt-3 italic">No bio yet.</p>
      )}
      <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
        <span className="text-xs text-gray-500">View profile</span>
        <span className="text-xs text-accent group-hover:translate-x-0.5 transition-transform">→</span>
      </div>
    </Link>
  )
}

function EmptyState({ hasSearch, onReset }: { hasSearch: boolean; onReset: () => void }) {
  return (
    <div className="bg-card border border-dashed border-border rounded-xl p-10 text-center">
      <div className="w-12 h-12 rounded-full bg-bg border border-border flex items-center justify-center mx-auto mb-4 text-gray-500">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      </div>
      <h3 className="font-semibold mb-1">No traders found</h3>
      <p className="text-sm text-gray-400 max-w-sm mx-auto mb-5">
        {hasSearch
          ? 'No traders match these filters. Try adjusting your search or sort settings.'
          : 'There are no traders in the directory yet. Be the first — set up your profile.'}
      </p>
      {hasSearch ? (
        <button
          onClick={onReset}
          className="text-sm bg-accent text-bg font-semibold px-4 py-2 rounded-md hover:opacity-90 transition"
        >
          Clear filters
        </button>
      ) : (
        <Link
          to="/profile/edit"
          className="inline-block text-sm bg-accent text-bg font-semibold px-4 py-2 rounded-md hover:opacity-90 transition"
        >
          Set up your profile
        </Link>
      )}
    </div>
  )
}

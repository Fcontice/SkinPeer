import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useEnsurePrices, usePrices } from '../context/PriceContext'
import { fmtDelta, fmtUsd, parsePrice } from '../lib/offerChains'
import type { OfferChain } from '../lib/offerChains'
import type { MarketPrice, OfferItem, OfferStatus } from '../types/traderNetwork'

const STATUS_COLOR: Record<OfferStatus, string> = {
  pending: 'bg-warning/20 text-warning',
  accepted: 'bg-accent/20 text-accent',
  rejected: 'bg-danger/20 text-danger',
  withdrawn: 'bg-gray-500/20 text-gray-400',
  countered: 'bg-blue-500/20 text-blue-300',
}

interface Props {
  chain: OfferChain
  defaultMinimized: boolean
  manuallyExpanded: boolean
  onManualExpand: () => void
  onChange?: () => void
}

export function TradeOfferCard({ chain, defaultMinimized, manuallyExpanded, onManualExpand, onChange }: Props) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const [index, setIndex] = useState(chain.offers.length - 1)
  const wasOnLatestRef = useRef(true)
  useEffect(() => {
    if (wasOnLatestRef.current) setIndex(chain.offers.length - 1)
  }, [chain.offers.length])
  useEffect(() => {
    wasOnLatestRef.current = index === chain.offers.length - 1
  }, [index, chain.offers.length])

  const expanded = manuallyExpanded || !defaultMinimized
  const offer = chain.offers[index]
  const isLatest = index === chain.offers.length - 1
  const me = user?.id ?? ''
  const isSender = offer.from_user_id === me
  const isRecipient = offer.to_user_id === me
  const canAct = isLatest && offer.status === 'pending'

  const allNames = useMemo(() => {
    const s = new Set<string>()
    for (const i of offer.requested_items) s.add(i.name)
    for (const i of offer.offered_items) s.add(i.name)
    return [...s]
  }, [offer.requested_items, offer.offered_items])
  useEnsurePrices(allNames)
  const { get: getPrice } = usePrices()

  const requestedTotal = useMemo(
    () => offer.requested_items.reduce((acc, i) => acc + parsePrice(getPrice(i.name)?.lowest_price), 0),
    [offer.requested_items, getPrice],
  )
  const offeredTotal = useMemo(
    () => offer.offered_items.reduce((acc, i) => acc + parsePrice(getPrice(i.name)?.lowest_price), 0),
    [offer.offered_items, getPrice],
  )
  const fetchedAt = useMemo(() => latestFetchedAt(allNames, getPrice), [allNames, getPrice])

  // Per the viewer's perspective:
  //   - You want = items you'd receive = (recipient ? offered_items : requested_items)
  //   - You offer = items you'd give    = (recipient ? requested_items : offered_items)
  const youWantItems = isRecipient ? offer.offered_items : offer.requested_items
  const youWantTotal = isRecipient ? offeredTotal : requestedTotal
  const youOfferItems = isRecipient ? offer.requested_items : offer.offered_items
  const youOfferTotal = isRecipient ? requestedTotal : offeredTotal
  const delta = youWantTotal - youOfferTotal
  const deltaCopy =
    Math.abs(delta) < 0.005
      ? 'Even'
      : delta > 0
      ? `${fmtDelta(delta)} in your favor`
      : `${fmtDelta(delta)} against you`

  async function withDispatch(fn: () => Promise<void>) {
    setBusy(true)
    setActionError(null)
    try {
      await fn()
      onChange?.()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={onManualExpand}
        className="w-full text-left bg-bg border border-border rounded px-3 py-2 my-2 hover:border-accent flex items-center gap-3"
      >
        <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase ${STATUS_COLOR[offer.status]}`}>
          {offer.status}
        </span>
        <span className="text-xs text-gray-300 truncate">
          Trade proposal — You want {youWantItems.length} item{youWantItems.length === 1 ? '' : 's'} ({fmtUsd(youWantTotal)})
          {' ↔ '}
          You offer {youOfferItems.length} item{youOfferItems.length === 1 ? '' : 's'} ({fmtUsd(youOfferTotal)})
        </span>
        <span className="ml-auto text-gray-500">▾</span>
      </button>
    )
  }

  return (
    <div className="bg-bg border border-border rounded p-4 my-2">
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex items-center gap-2">
          <p className="text-xs uppercase tracking-wide text-gray-400">
            {isSender ? 'You proposed' : 'They proposed'}
          </p>
          <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase ${STATUS_COLOR[offer.status]}`}>
            {offer.status}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {chain.offers.length > 1 && (
            <Carousel index={index} length={chain.offers.length} onChange={setIndex} />
          )}
          <button
            type="button"
            onClick={onManualExpand}
            aria-label="Minimize"
            className="text-gray-500 hover:text-white text-xs"
          >
            ▴
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ItemColumn title="You want" items={youWantItems} total={youWantTotal} />
        <ItemColumn title="You offer" items={youOfferItems} total={youOfferTotal} />
      </div>

      <p className="text-[11px] text-gray-400 mt-3">
        Difference: {deltaCopy} <span className="text-gray-600">— advisory only</span>
      </p>
      <p className="text-[10px] text-gray-500 mt-1">
        Steam Community Market{fetchedAt ? ` — last fetched at ${fetchedAt}` : ''}
      </p>

      {actionError && <p className="text-danger text-xs mt-2">{actionError}</p>}

      {canAct && (
        <div className="flex gap-2 mt-4">
          {isRecipient && (
            <>
              <button
                disabled={busy}
                onClick={() =>
                  withDispatch(async () => {
                    const r = await apiFetch<{ proposal_id: string }>(`/offers/${offer.id}/accept`, { method: 'POST' })
                    navigate(`/proposals/${r.proposal_id}`)
                  })
                }
                className="bg-accent text-black font-semibold rounded px-3 py-1 text-sm disabled:opacity-50"
              >
                Accept
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  withDispatch(async () => {
                    await apiFetch(`/offers/${offer.id}/reject`, { method: 'POST' })
                  })
                }
                className="bg-bg border border-border rounded px-3 py-1 text-sm hover:border-danger disabled:opacity-50"
              >
                Reject
              </button>
              <button
                disabled={busy}
                onClick={() => navigate(`/messages/${offer.conversation_id}/propose?counter_of=${offer.id}`)}
                className="bg-bg border border-border rounded px-3 py-1 text-sm hover:border-accent disabled:opacity-50"
              >
                Counter
              </button>
            </>
          )}
          {isSender && (
            <button
              disabled={busy}
              onClick={() =>
                withDispatch(async () => {
                  await apiFetch(`/offers/${offer.id}/withdraw`, { method: 'POST' })
                })
              }
              className="bg-bg border border-border rounded px-3 py-1 text-sm hover:border-danger disabled:opacity-50"
            >
              Withdraw
            </button>
          )}
        </div>
      )}

      {offer.status === 'accepted' && offer.resulting_proposal_id && (
        <button
          onClick={() => navigate(`/proposals/${offer.resulting_proposal_id}`)}
          className="text-accent text-xs underline mt-3"
        >
          Open verification proposal →
        </button>
      )}
    </div>
  )
}

function Carousel({ index, length, onChange }: { index: number; length: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-1 text-xs text-gray-400">
      <button
        type="button"
        disabled={index === 0}
        onClick={() => onChange(index - 1)}
        className="px-1 disabled:opacity-30 hover:text-white"
        aria-label="Previous offer"
      >
        ‹
      </button>
      <span className="text-[11px]">Offer {index + 1} of {length}</span>
      <span className="flex gap-0.5">
        {Array.from({ length }).map((_, i) => (
          <span
            key={i}
            className={`w-1.5 h-1.5 rounded-full ${i === index ? 'bg-accent' : 'bg-gray-600'}`}
          />
        ))}
      </span>
      <button
        type="button"
        disabled={index === length - 1}
        onClick={() => onChange(index + 1)}
        className="px-1 disabled:opacity-30 hover:text-white"
        aria-label="Next offer"
      >
        ›
      </button>
    </div>
  )
}

function ItemColumn({ title, items, total }: { title: string; items: OfferItem[]; total: number }) {
  const visible = items.slice(0, 8)
  const overflow = items.length - visible.length
  return (
    <div>
      <p className="text-xs text-gray-300 mb-1 flex items-center justify-between gap-2">
        <span>
          {title} ({items.length})
        </span>
        <span className="text-gray-400">Total: {fmtUsd(total)}</span>
      </p>
      <ul className="space-y-1">
        {visible.map((i) => (
          <li key={i.asset_id} className="flex items-center gap-2">
            <img src={i.icon_url} alt="" className="w-8 h-8 object-contain" />
            <p className="text-xs truncate">{i.name}</p>
          </li>
        ))}
        {items.length === 0 && <li className="text-[10px] text-gray-500">(nothing)</li>}
      </ul>
      {overflow > 0 && <p className="text-[10px] text-gray-500 mt-1">+ {overflow} more</p>}
    </div>
  )
}

function latestFetchedAt(names: string[], get: (n: string) => MarketPrice | null): string | null {
  let max = ''
  for (const n of names) {
    const p = get(n)
    if (p?.fetched_at && p.fetched_at > max) max = p.fetched_at
  }
  if (!max) return null
  const d = new Date(max)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

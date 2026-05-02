import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { ScamWarningBanner } from '../components/ScamWarningBanner'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import type { Conversation, MarketPrice, Message, OfferItem, TradeOffer } from '../types/traderNetwork'
import type { InventoryItem } from '../../../../packages/shared/src/schemas'

interface MyInventoryResponse {
  items: InventoryItem[]
  cached: boolean
  is_private?: boolean
}

interface OtherInventoryResponse {
  items: InventoryItem[]
  is_private: boolean
}

interface ConvoView {
  conversation: Conversation
  messages: Message[]
}

// Cheap parser: strip everything that isn't a digit or "." and parseFloat.
// Accepts "$1.23", "1,23€", etc. Returns 0 for null/empty/unparsable.
function parsePrice(raw: string | null | undefined): number {
  if (!raw) return 0
  const stripped = raw.replace(/[^\d.,]/g, '')
  const lastDot = stripped.lastIndexOf('.')
  const lastComma = stripped.lastIndexOf(',')
  let normalized: string
  if (lastDot === -1 && lastComma === -1) normalized = stripped
  else if (lastDot > lastComma) normalized = stripped.replace(/,/g, '')
  else normalized = stripped.replace(/\./g, '').replace(',', '.')
  const n = parseFloat(normalized)
  return Number.isFinite(n) ? n : 0
}

function fmtUsd(n: number): string {
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.abs(n).toFixed(2)}`
}

function fmtDelta(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '-' : '±'
  return `${sign}$${Math.abs(n).toFixed(2)}`
}

// Convert an InventoryItem into the OfferItem payload shape (identical fields).
function toOfferItem(i: InventoryItem): OfferItem {
  return {
    asset_id: i.asset_id,
    class_id: i.class_id,
    name: i.name,
    icon_url: i.icon_url,
    wear: i.wear,
    rarity: i.rarity,
    type: i.type,
    tradable: i.tradable,
    marketable: i.marketable,
  }
}

export function ProposeTradePage() {
  const { conversationId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const counterOf = searchParams.get('counter_of')
  const navigate = useNavigate()
  const { user } = useAuth()
  const me = user?.id ?? ''

  const [convo, setConvo] = useState<Conversation | null>(null)
  const [convoMessages, setConvoMessages] = useState<Message[]>([])
  const [convoError, setConvoError] = useState<string | null>(null)

  const [theirInventory, setTheirInventory] = useState<InventoryItem[]>([])
  const [theirInventoryLoading, setTheirInventoryLoading] = useState(false)
  const [theirInventoryLoaded, setTheirInventoryLoaded] = useState(false)
  const [theirInventoryPrivate, setTheirInventoryPrivate] = useState(false)
  const [theirInventoryError, setTheirInventoryError] = useState<string | null>(null)

  const [myInventory, setMyInventory] = useState<InventoryItem[]>([])
  const [myInventoryLoading, setMyInventoryLoading] = useState(false)
  const [myInventoryLoaded, setMyInventoryLoaded] = useState(false)
  const [myInventoryError, setMyInventoryError] = useState<string | null>(null)

  const [requested, setRequested] = useState<Record<string, InventoryItem>>({})
  const [offered, setOffered] = useState<Record<string, InventoryItem>>({})

  const [prices, setPrices] = useState<Record<string, MarketPrice>>({})

  const [originalOffer, setOriginalOffer] = useState<TradeOffer | null>(null)

  const [pendingBlockerId, setPendingBlockerId] = useState<string | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [pendingConflict, setPendingConflict] = useState(false)

  const counterAppliedRef = useRef(false)

  // Resolve counterparty user_id and persona from the conversation.
  const counterpartyId = useMemo(() => {
    if (!convo) return null
    return convo.user_a_id === me ? convo.user_b_id : convo.user_a_id
  }, [convo, me])

  const counterpartyPersona = useMemo(() => {
    if (!convo) return null
    const them = convo.user_a_id === me ? convo.user_b : convo.user_a
    return them?.steam_persona ?? them?.username ?? 'Trader'
  }, [convo, me])

  // Step 1 — fetch the conversation.
  useEffect(() => {
    if (!conversationId) return
    let cancelled = false
    apiFetch<ConvoView>(`/conversations/${conversationId}`)
      .then((data) => {
        if (cancelled) return
        setConvo(data.conversation)
        setConvoMessages(data.messages)
      })
      .catch((e: Error) => {
        if (cancelled) return
        setConvoError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [conversationId])

  // Step 2 — once we know the counterparty id, fetch their inventory and ours.
  useEffect(() => {
    if (!counterpartyId) return
    let cancelled = false
    setTheirInventoryLoading(true)
    setTheirInventoryError(null)
    setTheirInventoryPrivate(false)
    apiFetch<OtherInventoryResponse>(`/inventory/by-user/${counterpartyId}`)
      .then((data) => {
        if (cancelled) return
        if (data.is_private) {
          setTheirInventoryPrivate(true)
          setTheirInventory([])
        } else {
          setTheirInventory(data.items.filter((i) => i.tradable))
        }
      })
      .catch((e: Error) => {
        if (cancelled) return
        // apiFetch throws on non-OK; the body is in e.message. The 403 shape
        // includes is_private:true but apiFetch only surfaces { error }, so we
        // check for a private-inventory hint in the message.
        if (/private/i.test(e.message)) {
          setTheirInventoryPrivate(true)
        } else {
          setTheirInventoryError(e.message)
        }
      })
      .finally(() => {
        if (cancelled) return
        setTheirInventoryLoading(false)
        setTheirInventoryLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [counterpartyId])

  useEffect(() => {
    let cancelled = false
    setMyInventoryLoading(true)
    apiFetch<MyInventoryResponse>('/me/inventory')
      .then((data) => {
        if (cancelled) return
        setMyInventory(data.items.filter((i) => i.tradable))
      })
      .catch((e: Error) => {
        if (cancelled) return
        setMyInventoryError(e.message)
      })
      .finally(() => {
        if (cancelled) return
        setMyInventoryLoading(false)
        setMyInventoryLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Step 3 — counter pre-population. If ?counter_of is set, fetch that offer.
  useEffect(() => {
    if (!counterOf) return
    let cancelled = false
    apiFetch<TradeOffer>(`/offers/${counterOf}`)
      .then((data) => {
        if (cancelled) return
        setOriginalOffer(data)
      })
      .catch((err) => {
        if (cancelled) return
        console.warn('Failed to load original offer for counter pre-pop:', err)
      })
    return () => {
      cancelled = true
    }
  }, [counterOf])

  // Reset the counter-pre-pop applied guard if the counter target changes.
  useEffect(() => {
    counterAppliedRef.current = false
  }, [counterOf])

  // When the original offer + both inventories are loaded, swap roles and
  // pre-select. Original.requested_items came from me originally? Spec:
  // "the original's offered_items become my requested selections; the
  // original's requested_items become my offered selections". Match by
  // asset_id against the relevant inventory; only pre-select items that
  // still exist there.
  useEffect(() => {
    if (!originalOffer) return
    if (counterAppliedRef.current) return
    if (!theirInventoryLoaded || !myInventoryLoaded) return
    const nextRequested: Record<string, InventoryItem> = {}
    for (const o of originalOffer.offered_items) {
      const match = theirInventory.find((i) => i.asset_id === o.asset_id)
      if (match) nextRequested[match.asset_id] = match
    }
    const nextOffered: Record<string, InventoryItem> = {}
    for (const o of originalOffer.requested_items) {
      const match = myInventory.find((i) => i.asset_id === o.asset_id)
      if (match) nextOffered[match.asset_id] = match
    }
    setRequested(nextRequested)
    setOffered(nextOffered)
    counterAppliedRef.current = true
    // We only want this to run once after both inventories settle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originalOffer, theirInventoryLoaded, myInventoryLoaded])

  // Pending-blocker scan: look at the most recent trade_offer messages in
  // the convo (latest 5), fetch their offers in parallel, and find any with
  // status === 'pending' AND from_user_id === me.
  useEffect(() => {
    if (!convoMessages.length || !me) return
    const offerIds: string[] = []
    for (let i = convoMessages.length - 1; i >= 0 && offerIds.length < 5; i--) {
      const m = convoMessages[i]
      if (m.kind !== 'trade_offer') continue
      const oid = (m.metadata as { offer_id?: string } | null)?.offer_id
      if (oid) offerIds.push(oid)
    }
    if (offerIds.length === 0) return
    let cancelled = false
    Promise.allSettled(offerIds.map((id) => apiFetch<TradeOffer>(`/offers/${id}`))).then(
      (results) => {
        if (cancelled) return
        let found: string | null = null
        for (const r of results) {
          if (r.status === 'rejected') {
            console.warn('Failed to load offer for pending-blocker scan:', r.reason)
            continue
          }
          const o = r.value
          if (o.status === 'pending' && o.from_user_id === me) {
            found = o.id
            break
          }
        }
        if (cancelled) return
        setPendingBlockerId(found)
      }
    )
    return () => {
      cancelled = true
    }
  }, [convoMessages, me])

  // Fetch market prices for every selected item on either side. We dedupe by
  // item name and skip names already cached in `prices`.
  useEffect(() => {
    const names = new Set<string>()
    for (const i of Object.values(requested)) names.add(i.name)
    for (const i of Object.values(offered)) names.add(i.name)
    const toFetch: string[] = []
    for (const n of names) {
      if (!prices[n]) toFetch.push(n)
    }
    if (toFetch.length === 0) return
    let cancelled = false
    Promise.allSettled(
      toFetch.map((name) => apiFetch<MarketPrice>(`/market/price?name=${encodeURIComponent(name)}`))
    ).then((results) => {
      if (cancelled) return
      const next: Record<string, MarketPrice> = {}
      results.forEach((r, idx) => {
        if (r.status === 'fulfilled') next[toFetch[idx]] = r.value
      })
      if (Object.keys(next).length > 0) {
        setPrices((prev) => ({ ...prev, ...next }))
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested, offered])

  function toggleRequested(item: InventoryItem) {
    setRequested((prev) => {
      const next = { ...prev }
      if (next[item.asset_id]) delete next[item.asset_id]
      else next[item.asset_id] = item
      return next
    })
  }

  function toggleOffered(item: InventoryItem) {
    setOffered((prev) => {
      const next = { ...prev }
      if (next[item.asset_id]) delete next[item.asset_id]
      else next[item.asset_id] = item
      return next
    })
  }

  // Running balance.
  const balance = useMemo(() => {
    let receive = 0
    let give = 0
    let latestFetched: string | null = null
    const nameSet = new Set<string>()
    for (const i of Object.values(requested)) {
      const p = prices[i.name]
      if (p) {
        receive += parsePrice(p.lowest_price)
        nameSet.add(i.name)
        if (!latestFetched || new Date(p.fetched_at) > new Date(latestFetched)) {
          latestFetched = p.fetched_at
        }
      }
    }
    for (const i of Object.values(offered)) {
      const p = prices[i.name]
      if (p) {
        give += parsePrice(p.lowest_price)
        nameSet.add(i.name)
        if (!latestFetched || new Date(p.fetched_at) > new Date(latestFetched)) {
          latestFetched = p.fetched_at
        }
      }
    }
    return { receive, give, delta: receive - give, latestFetched, hasPrices: nameSet.size > 0 }
  }, [requested, offered, prices])

  async function submit() {
    if (submitting) return
    if (pendingBlockerId || pendingConflict) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const body: Record<string, unknown> = {
        conversation_id: conversationId,
        requested_items: Object.values(requested).map(toOfferItem),
        offered_items: Object.values(offered).map(toOfferItem),
      }
      if (counterOf) body.parent_offer_id = counterOf
      await apiFetch<TradeOffer>('/offers', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      navigate(`/messages/${conversationId}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to create offer'
      // 409 from the server: surface a specific blocker UI, disable submit.
      if (/pending/i.test(msg)) {
        setPendingConflict(true)
      } else {
        setSubmitError(msg)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const requestedCount = Object.keys(requested).length
  const offeredCount = Object.keys(offered).length
  const submitDisabled =
    submitting ||
    !!pendingBlockerId ||
    pendingConflict ||
    theirInventoryLoading ||
    myInventoryLoading ||
    (requestedCount === 0 && offeredCount === 0)

  if (convoError) {
    return (
      <Layout>
        <ScamWarningBanner />
        <p className="text-danger">{convoError}</p>
      </Layout>
    )
  }

  if (!convo || !user) {
    return (
      <Layout>
        <ScamWarningBanner />
        <p className="text-gray-400">Loading…</p>
      </Layout>
    )
  }

  const fetchedHm = balance.latestFetched
    ? new Date(balance.latestFetched).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <Layout>
      <ScamWarningBanner />
      <h1 className="text-2xl font-bold mb-1">Propose a trade with {counterpartyPersona}</h1>
      <p className="text-sm text-gray-400 mb-6">
        They send these items to you · You send these items to them.
      </p>

      {(pendingBlockerId || pendingConflict) && (
        <div className="bg-warning/10 border border-warning rounded p-4 mb-6 text-sm">
          <p className="text-warning font-semibold mb-1">
            You have a pending proposal — withdraw it to revise.
          </p>
          <Link
            to={`/messages/${conversationId}`}
            className="text-accent underline text-xs"
          >
            View pending offer →
          </Link>
        </div>
      )}

      {/* Section 1 — items you want from them */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">
          Items you want from {counterpartyPersona}
        </h2>

        {theirInventoryPrivate ? (
          <div className="bg-card border border-warning rounded p-4 text-sm">
            <p className="text-warning mb-2">
              {counterpartyPersona}'s inventory is private — ask them to make it public.
            </p>
            <a
              className="underline text-accent text-xs"
              href="https://steamcommunity.com/my/edit/settings"
              target="_blank"
              rel="noreferrer"
            >
              Steam privacy settings
            </a>
          </div>
        ) : theirInventoryError ? (
          <div className="bg-card border border-danger rounded p-4 text-sm">
            <p className="text-danger">Could not load their inventory: {theirInventoryError}</p>
          </div>
        ) : theirInventoryLoading ? (
          <p className="text-gray-400 text-sm">Loading their inventory…</p>
        ) : theirInventory.length === 0 ? (
          <p className="text-gray-400 text-sm">They have no tradable items right now.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-2">
              {theirInventory.map((item) => {
                const isSelected = !!requested[item.asset_id]
                const price = prices[item.name]
                return (
                  <button
                    key={item.asset_id}
                    type="button"
                    onClick={() => toggleRequested(item)}
                    className={`bg-card border rounded p-2 text-left transition ${
                      isSelected ? 'border-accent' : 'border-border hover:border-gray-500'
                    }`}
                  >
                    <img src={item.icon_url} alt="" className="w-full h-20 object-contain mb-2" />
                    <p className="text-xs font-semibold line-clamp-2">{item.name}</p>
                    {item.wear && <p className="text-[10px] text-gray-400">{item.wear}</p>}
                    {isSelected && price && (
                      <p className="text-[10px] text-gray-500">{price.lowest_price ?? '—'}</p>
                    )}
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-gray-400">
              {requestedCount} item{requestedCount === 1 ? '' : 's'} selected
            </p>
          </>
        )}
      </section>

      {/* Running balance */}
      <section className="bg-card border border-border rounded p-4 mb-8">
        <p className="text-sm">
          You receive ≈ <span className="text-accent font-semibold">{fmtUsd(balance.receive)}</span>
          {' · '}
          You give ≈ <span className="text-accent font-semibold">{fmtUsd(balance.give)}</span>
          {' · '}
          Δ <span className={balance.delta >= 0 ? 'text-accent' : 'text-warning'}>{fmtDelta(balance.delta)}</span>
        </p>
        {balance.hasPrices && fetchedHm && (
          <p className="text-[10px] text-gray-500 mt-1">
            Source: Steam Community Market — last fetched at {fetchedHm}
          </p>
        )}
      </section>

      {/* Section 2 — items you'll offer */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-3">Items you'll offer</h2>

        {myInventoryError ? (
          <div className="bg-card border border-danger rounded p-4 text-sm">
            <p className="text-danger mb-2">Could not load your inventory: {myInventoryError}</p>
            <p className="text-gray-400">
              If your Steam inventory is private, set it to public in{' '}
              <a className="underline" href="https://steamcommunity.com/my/edit/settings" target="_blank" rel="noreferrer">
                Steam privacy settings
              </a>{' '}
              and refresh.
            </p>
          </div>
        ) : myInventoryLoading ? (
          <p className="text-gray-400 text-sm">Loading your inventory…</p>
        ) : myInventory.length === 0 ? (
          <p className="text-gray-400 text-sm">You have no tradable items right now.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-2">
              {myInventory.map((item) => {
                const isSelected = !!offered[item.asset_id]
                const price = prices[item.name]
                return (
                  <button
                    key={item.asset_id}
                    type="button"
                    onClick={() => toggleOffered(item)}
                    className={`bg-card border rounded p-2 text-left transition ${
                      isSelected ? 'border-accent' : 'border-border hover:border-gray-500'
                    }`}
                  >
                    <img src={item.icon_url} alt="" className="w-full h-20 object-contain mb-2" />
                    <p className="text-xs font-semibold line-clamp-2">{item.name}</p>
                    {item.wear && <p className="text-[10px] text-gray-400">{item.wear}</p>}
                    {isSelected && price && (
                      <p className="text-[10px] text-gray-500">{price.lowest_price ?? '—'}</p>
                    )}
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-gray-400">
              {offeredCount} item{offeredCount === 1 ? '' : 's'} selected
            </p>
          </>
        )}

        <p className="text-[10px] text-gray-500 mt-3">
          Price hints are advisory only and do not gate submission.
        </p>
      </section>

      {/* Section 3 — submit */}
      <div className="flex items-center justify-between bg-card border border-border rounded p-4">
        <div className="text-sm text-gray-400">
          {requestedCount} requested · {offeredCount} offered
        </div>
        <div className="flex items-center gap-3">
          {submitError && <p className="text-danger text-xs">{submitError}</p>}
          <button
            onClick={submit}
            disabled={submitDisabled}
            className="bg-accent text-black font-semibold rounded px-4 py-2 disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : counterOf ? 'Send counter-offer' : 'Send proposal'}
          </button>
        </div>
      </div>
    </Layout>
  )
}

# Trade-card chat-thread redesign

**Date:** 2026-05-01
**Scope:** `apps/web` only. No server changes, no migrations, no changes to the offer data model, the `ProposeTradePage` builder, or the post-acceptance verification flow.

---

## Goals

1. Group offers by **counter chain** (root + descendants linked via `parent_offer_id`) and render exactly one card per chain at the location of the chain's most recent offer in the message stream.
2. Carousel through every offer in the chain on a single card. Defaults to the most recent.
3. Show **per-side running totals** from Steam Community Market prices, plus a delta line.
4. Implement an expanded/minimized state machine with **sticky-after-manual** auto-minimize.
5. Add a **Chat / Trades** tab toggle inside the conversation view. Trades tab lists every chain in the conversation with filter chips and a pending-count badge.

---

## Architecture

### Data flow

`ConversationPage` already loads `{ conversation, messages }` and subscribes to `messages` realtime. Add a parallel load + realtime subscription for `trade_offers` filtered by `conversation_id=eq.<id>`. Maintain a single `Map<offer_id, TradeOffer>` in state that is the source of truth for both views (Chat and Trades).

```ts
const [offers, setOffers] = useState<Map<string, TradeOffer>>(new Map())
```

On INSERT/UPDATE/DELETE → patch the map. No more per-`<ConvoOfferCardRow>` `apiFetch('/offers/:id')` — that pattern was creating fan-out under the rate limiter. Chat-side cards read offers from this shared map.

### Chain grouping (pure helper)

```ts
// apps/web/src/lib/offerChains.ts
export interface OfferChain {
  rootId: string
  offers: TradeOffer[]      // sorted oldest → newest by created_at
  latest: TradeOffer        // alias for offers[offers.length - 1]
  anchorMessageId: string   // id of the most-recent trade_offer message in the chain
}

export function buildOfferChains(
  offers: TradeOffer[],
  messages: Message[],
): OfferChain[]
```

Algorithm:
1. Walk every offer; the **root** of an offer is found by recursively following `parent_offer_id`. Memoize by id.
2. Group offers by root id. Sort each group by `created_at` ascending.
3. For each chain, find the most recent message in `messages` where `kind === 'trade_offer'` and `metadata.offer_id` is one of this chain's offers. That message's id is `anchorMessageId`.
4. Sort chains by their anchor message's `created_at` descending (most recent first) for the Trades tab; preserve message order for the Chat view.

### `TradeOfferCard` rewrite

New props:

```ts
interface TradeOfferCardProps {
  chain: OfferChain
  defaultMinimized: boolean   // true if a newer message is below it
  onChange: () => void        // legacy refresh hook, kept for action callbacks
}
```

State:
- `currentIndex` (default `chain.offers.length - 1`).
- `expanded` (default `!defaultMinimized`).
- `userExpanded` (ref) — flips to `true` once the user clicks the chevron, suppresses future auto-minimize.

Body:
- **Header (always visible):** status badge of `chain.offers[currentIndex]` + carousel arrows + dots + "Offer N of M" + chevron.
- **Expanded body:** two columns (`requested_items` / `offered_items`) labeled per the viewer's perspective, per-column total `Total: $X.XX`, item rows with thumbnail + name (no inline per-item price text — totals roll up at the column header), bottom delta line, source caption, action buttons (only when `currentIndex === chain.offers.length - 1` AND `latest.status === 'pending'` AND viewer matches the relevant party).
- **Minimized body:** one line — `Trade proposal — You want N items ($X.XX) ↔ You offer M items ($Y.YY)` plus chevron.

Carousel arrows are disabled at boundaries; dots highlight `currentIndex`.

### Price provider (de-duplicated, conversation-scoped)

The current per-`ItemRow` `useEffect` fires one fetch per item per card mount. With multiple chains rendering, that's a fan-out problem. Lift to a context:

```ts
// apps/web/src/context/PriceContext.tsx
const PriceContext = createContext<{
  get: (name: string) => MarketPrice | null
  ensure: (names: string[]) => void
}>(...)
```

`ensure(names)` schedules a single fetch per unseen name and caches by name in a `useRef<Map<string, MarketPrice>>`. The provider wraps `ConversationPage`. `TradeOfferCard` calls `ensure([...names])` on mount and on `currentIndex` change. The header total reads via `get(name)` — `0` for items still pending.

### Auto-minimize rule

For each chain, a chain is "below" any message whose `created_at > chain.anchorMessageId.created_at`. In the chat render pass, walk messages in order:

```ts
let hasNewerBelowEachChain = new Map<string, boolean>()
// pre-pass: for every chain, compute whether any message after its anchor exists
```

`defaultMinimized = hasNewerBelow(chain) === true` → the card initially renders minimized. If the user has already manually expanded it (tracked per-chain in `Map<rootId, boolean>` held in `ConversationPage` state), defaultMinimized is overridden to `false`. **Sticky-after-manual:** once `userExpanded[rootId] = true`, it stays `true` for the session. Realtime arrivals never re-collapse a manually-expanded card.

The "newest pending offer awaiting the viewer's action" stays expanded only when its anchor is the literal last item in the thread (no message rendered after it).

### Chat / Trades tab toggle

`ConversationPage` adds a `<Tabs>` strip below the page header (counterparty info row stays). State: `tab: 'chat' | 'trades'`.

**Chat tab** (default):
- Same scrollable thread as today.
- During render, when iterating messages: keep a `seenChainRoots: Set<string>`. For each `kind: 'trade_offer'` message, look up its chain via `offer_id → root`. If `root in seenChainRoots`, skip render (older offer in the same chain). Otherwise render `<TradeOfferCard chain={chain} defaultMinimized={...} />` and add the root to `seenChainRoots`.
- Because chains are anchored at the most recent offer message, the natural iteration order needs a small flip: walk messages in **reverse** to find the anchor first, mark all earlier offers in that chain as "skip", then walk forward to render. Implementation: precompute a `Set<message_id>` of message ids to skip, then render forward as today.

**Trades tab:**
- Vertical list of all chains in the conversation, sorted by `latest.created_at` desc.
- Filter chips at the top: `All` | `Active` | `Completed` | `Closed`. State: `filter: 'all' | 'active' | 'completed' | 'closed'`.
  - Active: `latest.status === 'pending'`
  - Completed: `latest.status === 'accepted'`
  - Closed: `latest.status` ∈ `{rejected, withdrawn, countered}`. (`countered` should never be the latest by definition since a counter creates a child whose status starts pending — but defensive bucketing is cheap.)
- Each chain renders the same `<TradeOfferCard>` component, but `defaultMinimized={false}` so all are expanded by default in the dedicated view.
- Tab strip itself: `Trades` shows a `bg-warning` numeric badge when at least one chain has `latest.status === 'pending' && latest.to_user_id === me`. Counted from the local `offers` map.

### Action buttons

Only render on the latest offer of a chain when `latest.status === 'pending'`:
- Recipient (`latest.to_user_id === me`): Accept / Reject / Counter.
- Sender (`latest.from_user_id === me`): Withdraw.

Buttons use the existing `/api/offers/:id/{accept,reject,withdraw}` endpoints. Counter still navigates to `/messages/:cid/propose?counter_of=<latest.id>`. After a successful action, the realtime subscription updates the `offers` map; no manual refresh needed (kept `onChange` callback for the optimistic-loading spinner only).

### Pending-count badge on the Trades tab

Computed locally from the `offers` map, not the global `usePendingOffersCount` hook (that's for the nav badge across the whole app). Cheap — re-derive on every render.

```ts
const tabPending = useMemo(
  () => chains.filter(c => c.latest.status === 'pending' && c.latest.to_user_id === me).length,
  [chains, me]
)
```

---

## Files

### New
- `apps/web/src/lib/offerChains.ts` — pure chain-building helper + a tiny price-formatter used in totals.
- `apps/web/src/context/PriceContext.tsx` — conversation-scoped, deduplicated market-price fetcher.

### Modified
- `apps/web/src/components/TradeOfferCard.tsx` — full rewrite around the new props (`chain`, `defaultMinimized`).
- `apps/web/src/pages/ConversationPage.tsx` — load offers map, subscribe, build chains, render Chat/Trades tab toggle, drop the `<ConvoOfferCardRow>` per-card fetch component.

### Untouched (intentionally)
- `apps/web/src/pages/ProposeTradePage.tsx` — proposal builder, out of scope.
- `apps/web/src/pages/MyTradesPage.tsx` — dashboard inbox uses simple link rows, not `TradeOfferCard`.
- `apps/web/src/hooks/usePendingOffersCount.ts` — global nav badge, unchanged.
- Server routes, schemas, middleware — no changes.

---

## Edge cases

- **An offer arrives whose `parent_offer_id` references an offer not yet in the local map** (e.g., the sibling chain hasn't loaded). Treat the offer as its own root until the parent arrives via realtime; rebuild chains on map change.
- **`messages` arrives but the corresponding `trade_offer` row hasn't propagated.** The chat render simply does not see that message's chain yet; one re-render later (offers map update) it will.
- **All offers in a chain are present but no `messages` row anchors to any of them.** Should not happen because every offer creation also inserts a `messages` row. If it does, fall back to anchoring at the chain's `latest.created_at` virtually (still render, just at the bottom of the chat).
- **Carousel index out of bounds after a counter arrives.** When the chain length grows, leave `currentIndex` where it is unless it was already on the latest — in that case advance to the new latest. (Tracks the user's "I'm reviewing history" intent.)
- **User views the Trades tab with zero chains.** Show a small empty state: `No trades in this conversation yet. Click "Propose trade" above.`

---

## Manual verification

1. Create offer A→B in a thread, send a chat message after — card auto-minimizes to one line.
2. Click chevron, expand. Send another chat message — card stays expanded (sticky).
3. B counters → card auto-minimizes (a new offer message rendered below). Expand the new card → carousel arrow back shows the original. `Offer 1 of 2`.
4. Toggle to Trades tab → see the chain listed at the top. Filter chips work. Tab badge shows `1` while latest is pending awaiting the viewer.
5. B accepts → card flips to `accepted`, badge clears, button row hides, "Open verification proposal →" link appears.
6. Rate-limit check: open the conversation with 5+ chains in it; network panel shows one `/api/offers` list call + one `/api/market/price` call per unique item name across all chains, no per-card fan-out.

---

## Out of scope (per spec)

- Trade-offer data-model changes.
- Proposal builder UI.
- Verification flow post-acceptance.
- Persisting expanded/minimized state across page reloads.
- An "all conversations" trade-history archive (separate feature).

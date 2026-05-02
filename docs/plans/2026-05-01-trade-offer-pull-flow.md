# Trade Offer (Pull-Based) Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the trade-proposal flow into a standalone, pull-based offer launched from a Messages thread: A picks items from B's inventory + their own, sends an offer; B can accept (creates the existing trade_proposal + verification flow), reject, counter, and A can withdraw.

**Architecture:** A new `trade_offers` table + REST routes sit *in front of* the existing `trade_proposals` model. An accepted offer materializes into a `trade_proposals` row pre-populated with `trade_items` (owner_id mapped from offered/requested) and hands off to the unchanged verification-code / checklist flow. Steam inventory data and Steam Community Market prices are fetched server-side with TTL caches; prices are advisory and never gate submission.

**Tech Stack:** existing stack — pnpm + turbo monorepo, Express + TS server, React + Vite + TS client, Supabase (Postgres + Realtime + Auth), Zod request validation, Vitest + Supertest (new) for route tests.

---

## Context the implementer must read first

Before writing any code, read these to understand the existing system. Do not assume — the codebase has diverged from `CLAUDE.md` (e.g. `trade_rooms` is gone, replaced by `trade_proposals` in migration 003).

- `CLAUDE.md` — project rules + hard constraints
- `supabase/migrations/003_trader_network.sql` — current schema (especially `conversations`, `messages`, `trade_proposals`, `trade_items`, `trade_checklist_items`)
- `supabase/migrations/002_steam_auth.sql` — `steam_inventories` cache + `profiles.steam_id`
- `apps/server/src/routes/proposals.ts` — existing proposal lifecycle (do not break)
- `apps/server/src/routes/inventory.ts` — own-user inventory fetch + cache pattern
- `apps/server/src/lib/steam.ts` — Steam Web API helpers (`parseSteamInventory`, `InventoryItem`)
- `apps/server/src/services/proposalCodeService.ts` — verification code generator (reuse on accept)
- `apps/server/src/schemas/traderNetwork.ts` — Zod schema convention
- `apps/web/src/pages/ConversationPage.tsx` — current "Propose trade" button (line 112) + inline `trade_proposal_link` message rendering (line 128–137)
- `apps/web/src/pages/CreateTradeProposalPage.tsx` — to be replaced (push-based, own items only)
- `apps/web/src/pages/MyTradesPage.tsx` — where the inbox section is added
- `apps/web/src/components/Layout.tsx` — nav bar where the "My trades" badge dot lives
- `apps/web/src/types/traderNetwork.ts` — type aliases convention

---

## Naming conventions used in this plan

- **Offer** = `trade_offers` row (pull-based proposal awaiting B's action). New in this plan.
- **Proposal** = existing `trade_proposals` row (verification code + checklist). Created when an offer is accepted.
- **A** = sender (`from_user_id`); **B** = recipient (`to_user_id`).
- **Direction** = ordered pair `(from_user_id → to_user_id)`. A counter swaps direction.

---

## Build order (matches user's brief)

1. CLAUDE.md edit
2. Vitest + Supertest harness for the server (one-time, supports tasks 5–9)
3. Migration `004_trade_offers.sql`
4. Steam inventory-by-user route + price-overview service with caches
5. Zod schemas for offer endpoints
6. `POST /api/offers` (create) + pending-uniqueness enforcement
7. `POST /api/offers/:id/withdraw`, `/reject`
8. `POST /api/offers/:id/accept` — creates `trade_proposals` + `trade_items`, posts thread message
9. `POST /api/offers/:id/counter` — flips parent + creates child offer with swapped direction
10. `GET /api/offers/inbound/pending` (badge count) + `GET /api/offers/:id` (detail)
11. Wire offer routes into `apps/server/src/index.ts`; render inline `trade_offer` message card in `ConversationPage`
12. New page: `ProposeTradePage` (browse B's inventory → pick A's items → review → submit)
13. Counter UX: open the proposal builder pre-populated with the original selections, roles swapped
14. Dashboard inbox section + nav badge dot
15. End-to-end smoke script for the accept path

---

## Task 1: Update CLAUDE.md hard constraints

**Files:**
- Modify: `CLAUDE.md` (the "Hard Constraints — Do Not Build" section)

**Step 1: Confirm current line**

Run: `grep -n "No price lookup APIs" CLAUDE.md`
Expected: one match in the Hard Constraints section.

**Step 2: Replace the line**

Replace:

```
- No price lookup APIs (MVP)
```

with:

```
- Price hints are advisory only; never gate trade submission. Always disclose source and freshness.
```

Leave `- No Steam bot flows` exactly as-is.

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: allow advisory price hints in CLAUDE.md hard constraints"
```

---

## Task 2: Set up Vitest + Supertest for the server

The repo currently has no test framework. We add one *minimally* — only what's needed to test the new offer routes. Don't backfill tests for unrelated existing routes.

**Files:**
- Modify: `apps/server/package.json`
- Create: `apps/server/vitest.config.ts`
- Create: `apps/server/tests/setup.ts`
- Create: `apps/server/tests/helpers/mockSupabase.ts`

**Step 1: Add devDependencies**

In `apps/server/package.json`, add to `devDependencies`:

```json
"vitest": "^1.6.0",
"supertest": "^7.0.0",
"@types/supertest": "^6.0.2"
```

Add to `scripts`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

Run: `pnpm install` from repo root.

**Step 2: Create `apps/server/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
  },
})
```

**Step 3: Create `apps/server/tests/setup.ts`**

```ts
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role'
process.env.SUPABASE_ANON_KEY ??= 'test-anon'
process.env.STEAM_API_KEY ??= 'test-steam-key'
process.env.NODE_ENV = 'test'
```

**Step 4: Create `apps/server/tests/helpers/mockSupabase.ts`**

A tiny chainable stub so route tests can assert query shape without a real DB. Implementer: keep it minimal — only `.from().select/.insert/.update/.delete().eq/.or/.maybeSingle/.single()` + an `_inbox` array used by tests to inject fake row results in order.

```ts
import { vi } from 'vitest'

type Row = Record<string, unknown>

interface Stub {
  _inbox: Array<{ data: Row | Row[] | null; error: unknown | null; count?: number }>
  _calls: Array<{ table: string; op: string; args: unknown[] }>
  push(response: { data: Row | Row[] | null; error?: unknown; count?: number }): void
  reset(): void
}

export function createSupabaseStub(): Stub & { client: unknown } {
  const stub: Stub = {
    _inbox: [],
    _calls: [],
    push(resp) { stub._inbox.push({ error: null, ...resp }) },
    reset() { stub._inbox = []; stub._calls = [] },
  }

  function next() {
    return stub._inbox.shift() ?? { data: null, error: null }
  }

  function makeQuery(table: string, op: string, args: unknown[] = []): any {
    stub._calls.push({ table, op, args })
    const q: any = {
      select: (...a: unknown[]) => makeQuery(table, 'select', a),
      insert: (...a: unknown[]) => makeQuery(table, 'insert', a),
      update: (...a: unknown[]) => makeQuery(table, 'update', a),
      delete: () => makeQuery(table, 'delete', []),
      upsert: (...a: unknown[]) => makeQuery(table, 'upsert', a),
      eq: () => q,
      neq: () => q,
      gt: () => q,
      lt: () => q,
      gte: () => q,
      lte: () => q,
      or: () => q,
      in: () => q,
      is: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: () => Promise.resolve(next()),
      single: () => Promise.resolve(next()),
      then: (cb: any) => Promise.resolve(next()).then(cb),
    }
    return q
  }

  const client = { from: (table: string) => makeQuery(table, 'from') }
  return Object.assign(stub, { client })
}

export const mockSupabaseModule = (stubClient: unknown) => {
  vi.doMock('../../src/lib/supabase', () => ({ supabase: stubClient }))
}
```

**Step 5: Run a smoke test to prove the harness works**

Create `apps/server/tests/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createSupabaseStub } from './helpers/mockSupabase'

describe('test harness', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2)
  })

  it('supabase stub records calls', async () => {
    const s = createSupabaseStub()
    s.push({ data: { id: 'x' } })
    const c: any = s.client
    const res = await c.from('foo').select('*').eq('id', 'x').single()
    expect(res.data).toEqual({ id: 'x' })
    expect(s._calls[0].table).toBe('foo')
  })
})
```

Run: `pnpm --filter @skinpeer/server test`
Expected: 2 passed.

**Step 6: Commit**

```bash
git add apps/server/package.json apps/server/vitest.config.ts apps/server/tests/ pnpm-lock.yaml
git commit -m "chore(server): add vitest+supertest harness with supabase stub"
```

---

## Task 3: Migration `004_trade_offers.sql`

**Files:**
- Create: `supabase/migrations/004_trade_offers.sql`

**Step 1: Write the migration**

```sql
-- 004_trade_offers.sql
-- Pull-based trade offer layer in front of trade_proposals.
-- An accepted offer materializes a trade_proposals row + trade_items.
-- Pre-launch MVP — no production data preserved.

-- =====================================================================
-- trade_offers — pending pull-based offer between two users in a thread
-- =====================================================================

create table public.trade_offers (
  id                     uuid primary key default gen_random_uuid(),
  conversation_id        uuid not null references public.conversations(id) on delete cascade,
  from_user_id           uuid not null references public.profiles(id) on delete cascade,
  to_user_id             uuid not null references public.profiles(id) on delete cascade,
  -- requested_items: items from to_user_id's inventory that from_user wants to receive
  -- offered_items:   items from from_user_id's inventory that from_user is offering
  -- Each entry is the InventoryItem shape from apps/server/src/lib/steam.ts
  requested_items        jsonb not null default '[]'::jsonb,
  offered_items          jsonb not null default '[]'::jsonb,
  status                 text  not null default 'pending'
                            check (status in ('pending','accepted','rejected','withdrawn','countered')),
  parent_offer_id        uuid references public.trade_offers(id) on delete set null,
  resulting_proposal_id  uuid references public.trade_proposals(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint trade_offers_users_distinct check (from_user_id <> to_user_id),
  constraint trade_offers_items_nonempty
    check (jsonb_array_length(requested_items) > 0 or jsonb_array_length(offered_items) > 0)
);

create index trade_offers_conversation_idx on public.trade_offers (conversation_id, created_at desc);
create index trade_offers_from_user_idx    on public.trade_offers (from_user_id);
create index trade_offers_to_user_idx      on public.trade_offers (to_user_id);
create index trade_offers_status_idx       on public.trade_offers (status);

-- Enforce: at most one pending offer per (thread, sender → recipient) direction.
-- A counter goes the OTHER direction so it does not collide with this index.
create unique index trade_offers_one_pending_per_direction
  on public.trade_offers (conversation_id, from_user_id, to_user_id)
  where status = 'pending';

-- Realtime: clients subscribe to offers in a conversation.
alter publication supabase_realtime add table public.trade_offers;

-- =====================================================================
-- messages.kind: add 'trade_offer' so the inbox card renders inline
-- =====================================================================

alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages
  add constraint messages_kind_check
  check (kind in ('user','system','trade_proposal_link','trade_offer'));

-- =====================================================================
-- steam_inventory_cache — shared cache keyed by steam_id
-- (separate from steam_inventories which is keyed by our user_id)
-- =====================================================================

create table if not exists public.steam_inventory_cache (
  steam_id    text primary key,
  items       jsonb not null default '[]'::jsonb,
  is_private  boolean not null default false,
  fetched_at  timestamptz not null default now()
);

-- =====================================================================
-- steam_market_prices — shared price cache from Steam Community Market
-- =====================================================================

create table if not exists public.steam_market_prices (
  market_hash_name text primary key,
  lowest_price     text,
  median_price     text,
  volume           text,
  source           text not null default 'steam_community_market',
  fetched_at       timestamptz not null default now()
);

create index steam_market_prices_fetched_idx on public.steam_market_prices (fetched_at);
```

**Step 2: Apply via Supabase MCP**

The previous migrations were applied via the Supabase MCP tool (per DEV_LOG 2026-04-26). Apply this one the same way. After applying, verify:

```sql
select column_name from information_schema.columns where table_name = 'trade_offers' order by ordinal_position;
```

Expected: id, conversation_id, from_user_id, to_user_id, requested_items, offered_items, status, parent_offer_id, resulting_proposal_id, created_at, updated_at.

**Step 3: Commit**

```bash
git add supabase/migrations/004_trade_offers.sql
git commit -m "feat(db): add trade_offers + market price + cross-user inventory caches"
```

---

## Task 4: Steam services — inventory-by-user + price overview, both cached

**Files:**
- Create: `apps/server/src/lib/marketPrice.ts`
- Modify: `apps/server/src/lib/steam.ts` (add `fetchInventoryBySteamId`)
- Create: `apps/server/src/routes/marketPrices.ts`
- Modify: `apps/server/src/routes/inventory.ts` (add `GET /api/inventory/by-user/:user_id`)
- Test: `apps/server/tests/marketPrice.test.ts`
- Test: `apps/server/tests/inventoryByUser.test.ts`

**Step 1: Add `fetchInventoryBySteamId` in `apps/server/src/lib/steam.ts`**

Add at the bottom (it's the same fetch as `routes/inventory.ts` but pulled into a reusable helper):

```ts
export interface InventoryFetchResult {
  items: InventoryItem[]
  is_private: boolean
}

export async function fetchInventoryBySteamId(steamId: string): Promise<InventoryFetchResult> {
  const res = await fetch(
    `https://steamcommunity.com/inventory/${steamId}/730/2?l=english&count=500`,
    { headers: { 'User-Agent': 'SkinPeer/1.0' } }
  )
  if (res.status === 403) return { items: [], is_private: true }
  if (!res.ok) throw new Error(`Steam inventory error: ${res.status}`)
  const raw = (await res.json()) as Parameters<typeof parseSteamInventory>[0]
  return { items: parseSteamInventory(raw), is_private: false }
}
```

**Step 2: Write `apps/server/src/lib/marketPrice.ts`**

```ts
import { supabase } from './supabase'

export interface MarketPrice {
  market_hash_name: string
  lowest_price: string | null
  median_price: string | null
  volume: string | null
  source: string
  fetched_at: string
}

const CACHE_TTL_MS = 30 * 60 * 1000 // 30 minutes

export async function getMarketPrice(name: string): Promise<MarketPrice | null> {
  // Read cache
  const { data: cached } = await supabase
    .from('steam_market_prices')
    .select('*')
    .eq('market_hash_name', name)
    .maybeSingle()

  if (cached) {
    const age = Date.now() - new Date(cached.fetched_at).getTime()
    if (age < CACHE_TTL_MS) return cached as MarketPrice
  }

  const fresh = await fetchFromSteam(name)
  if (!fresh) return cached as MarketPrice | null // fall back to stale on Steam error

  await supabase
    .from('steam_market_prices')
    .upsert(
      {
        market_hash_name: name,
        lowest_price: fresh.lowest_price ?? null,
        median_price: fresh.median_price ?? null,
        volume: fresh.volume ?? null,
        source: 'steam_community_market',
        fetched_at: new Date().toISOString(),
      },
      { onConflict: 'market_hash_name' }
    )

  return {
    market_hash_name: name,
    lowest_price: fresh.lowest_price ?? null,
    median_price: fresh.median_price ?? null,
    volume: fresh.volume ?? null,
    source: 'steam_community_market',
    fetched_at: new Date().toISOString(),
  }
}

interface SteamPriceResponse {
  success?: boolean
  lowest_price?: string
  median_price?: string
  volume?: string
}

async function fetchFromSteam(name: string): Promise<SteamPriceResponse | null> {
  const url =
    `https://steamcommunity.com/market/priceoverview/?appid=730&currency=1` +
    `&market_hash_name=${encodeURIComponent(name)}`
  const res = await fetch(url, { headers: { 'User-Agent': 'SkinPeer/1.0' } })
  if (!res.ok) return null
  const json = (await res.json()) as SteamPriceResponse
  if (!json.success) return null
  return json
}
```

**Step 3: Write `apps/server/src/routes/marketPrices.ts`**

```ts
import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { getMarketPrice } from '../lib/marketPrice'

const router = Router()
router.use(authenticate)

// GET /api/market/price?name=AK-47%20%7C%20Redline%20%28Field-Tested%29
router.get('/price', async (req, res, next) => {
  try {
    const name = req.query.name
    if (typeof name !== 'string' || name.length === 0 || name.length > 200) {
      res.status(400).json({ error: 'Invalid name' })
      return
    }
    const price = await getMarketPrice(name)
    if (!price) {
      res.status(502).json({ error: 'Price unavailable' })
      return
    }
    res.json(price)
  } catch (err) {
    next(err)
  }
})

export default router
```

**Step 4: Add cross-user inventory route in `apps/server/src/routes/inventory.ts`**

Append (do not change existing `/inventory` handler — keep my-own-inventory backward compatible):

```ts
import { fetchInventoryBySteamId } from '../lib/steam'

// GET /api/inventory/by-user/:user_id
router.get('/by-user/:user_id', authenticate, async (req, res, next) => {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('steam_id')
      .eq('id', req.params.user_id)
      .maybeSingle()

    if (!profile?.steam_id) {
      res.status(404).json({ error: 'User has no linked Steam account' })
      return
    }
    const steamId = profile.steam_id

    const { data: cached } = await supabase
      .from('steam_inventory_cache')
      .select('items, is_private, fetched_at')
      .eq('steam_id', steamId)
      .maybeSingle()

    if (cached) {
      const age = Date.now() - new Date(cached.fetched_at).getTime()
      if (age < 5 * 60 * 1000) {
        res.json({ items: cached.items, is_private: cached.is_private, cached: true, fetched_at: cached.fetched_at })
        return
      }
    }

    const { items, is_private } = await fetchInventoryBySteamId(steamId)
    const fetched_at = new Date().toISOString()
    await supabase
      .from('steam_inventory_cache')
      .upsert({ steam_id: steamId, items, is_private, fetched_at }, { onConflict: 'steam_id' })

    res.json({ items, is_private, cached: false, fetched_at })
  } catch (err) {
    next(err)
  }
})
```

Note: this router is mounted at `/api/inventory` (different prefix from existing `/api/me/inventory`). See Task 11 for mounting.

**Step 5: Refactor existing `/api/me/inventory` to also use `fetchInventoryBySteamId`**

The existing handler in `apps/server/src/routes/inventory.ts` lines 39–54 inlines the fetch+parse. Replace that inline block with `await fetchInventoryBySteamId(steamId)`. Behavior must be unchanged: 5-min TTL, 403 → `{ error: 'Steam inventory is private' }` with HTTP 403, 502 on other Steam errors.

**Step 6: Test — `apps/server/tests/marketPrice.test.ts`**

Mock `global.fetch` and `supabase`. Cover: cache hit returns cached, cache miss calls Steam, Steam failure returns stale cache, Steam failure with no cache returns null.

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSupabaseStub } from './helpers/mockSupabase'

describe('getMarketPrice', () => {
  let s: ReturnType<typeof createSupabaseStub>

  beforeEach(() => {
    s = createSupabaseStub()
    vi.doMock('../src/lib/supabase', () => ({ supabase: s.client }))
  })
  afterEach(() => { vi.resetModules(); vi.restoreAllMocks() })

  it('returns cached price when fresh', async () => {
    s.push({
      data: {
        market_hash_name: 'AK-47 | Redline (Field-Tested)',
        lowest_price: '$10.00',
        median_price: '$10.50',
        volume: '500',
        source: 'steam_community_market',
        fetched_at: new Date().toISOString(),
      },
    })
    const { getMarketPrice } = await import('../src/lib/marketPrice')
    const out = await getMarketPrice('AK-47 | Redline (Field-Tested)')
    expect(out?.lowest_price).toBe('$10.00')
  })

  it('fetches from Steam on cache miss', async () => {
    s.push({ data: null }) // cache miss
    s.push({ data: null }) // upsert response (ignored)
    global.fetch = vi.fn(async () =>
      ({ ok: true, json: async () => ({ success: true, lowest_price: '$1.00', median_price: '$1.50', volume: '10' }) }) as Response
    ) as any
    const { getMarketPrice } = await import('../src/lib/marketPrice')
    const out = await getMarketPrice('Glock-18 | Water Elemental (Minimal Wear)')
    expect(out?.lowest_price).toBe('$1.00')
    expect(global.fetch).toHaveBeenCalledOnce()
  })

  it('falls back to stale cache when Steam fails', async () => {
    s.push({
      data: {
        market_hash_name: 'X', lowest_price: '$2.00', median_price: null, volume: null,
        source: 'steam_community_market', fetched_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
    })
    global.fetch = vi.fn(async () => ({ ok: false, status: 500 }) as Response) as any
    const { getMarketPrice } = await import('../src/lib/marketPrice')
    const out = await getMarketPrice('X')
    expect(out?.lowest_price).toBe('$2.00')
  })
})
```

Run: `pnpm --filter @skinpeer/server test marketPrice`
Expected: 3 passed.

**Step 7: Test — `apps/server/tests/inventoryByUser.test.ts`**

Cover: profile not found → 404, cached fresh → returns cache, cache stale → re-fetches, private inventory → `is_private: true` with empty items.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createSupabaseStub } from './helpers/mockSupabase'

describe('GET /api/inventory/by-user/:user_id', () => {
  let s: ReturnType<typeof createSupabaseStub>
  let app: express.Express

  beforeEach(async () => {
    s = createSupabaseStub()
    vi.resetModules()
    vi.doMock('../src/lib/supabase', () => ({ supabase: s.client }))
    vi.doMock('../src/middleware/authenticate', () => ({
      authenticate: (req: any, _res: any, next: any) => { req.user = { id: 'me' }; next() },
    }))
    const { default: router } = await import('../src/routes/inventory')
    app = express().use(express.json()).use('/api/inventory', router)
  })

  it('404 when target user has no steam_id', async () => {
    s.push({ data: null }) // profiles select
    const res = await request(app).get('/api/inventory/by-user/u-1')
    expect(res.status).toBe(404)
  })

  it('returns cached items when fresh', async () => {
    s.push({ data: { steam_id: '7656' } })           // profiles
    s.push({ data: { items: [{ asset_id: 'a' }], is_private: false, fetched_at: new Date().toISOString() } }) // cache hit
    const res = await request(app).get('/api/inventory/by-user/u-1')
    expect(res.status).toBe(200)
    expect(res.body.cached).toBe(true)
    expect(res.body.items.length).toBe(1)
  })

  it('returns is_private:true when Steam returns 403', async () => {
    s.push({ data: { steam_id: '7656' } })
    s.push({ data: null })          // no cache
    s.push({ data: null })          // upsert
    global.fetch = vi.fn(async () => ({ status: 403, ok: false }) as Response) as any
    const res = await request(app).get('/api/inventory/by-user/u-1')
    expect(res.status).toBe(200)
    expect(res.body.is_private).toBe(true)
    expect(res.body.items).toEqual([])
  })
})
```

Run: `pnpm --filter @skinpeer/server test inventoryByUser`
Expected: 3 passed.

**Step 8: Commit**

```bash
git add apps/server/src/lib/marketPrice.ts apps/server/src/lib/steam.ts \
        apps/server/src/routes/marketPrices.ts apps/server/src/routes/inventory.ts \
        apps/server/tests/marketPrice.test.ts apps/server/tests/inventoryByUser.test.ts
git commit -m "feat(server): inventory-by-user route + market price service with TTL caches"
```

---

## Task 5: Zod schemas for offer endpoints

**Files:**
- Modify: `apps/server/src/schemas/traderNetwork.ts`

**Step 1: Append to `apps/server/src/schemas/traderNetwork.ts`**

```ts
// =====================================================================
// trade_offers (pull-based)
// =====================================================================

// Mirror of InventoryItem from apps/server/src/lib/steam.ts. We hold
// offered/requested items at the shape we display + map back to Steam.
export const OfferItemSchema = z.object({
  asset_id: z.string().min(1).max(40),
  class_id: z.string().min(1).max(40),
  name: z.string().min(1).max(200),
  icon_url: z.string().url(),
  wear: z.string().max(40).nullable(),
  rarity: z.string().max(40).nullable(),
  type: z.string().max(40).nullable(),
  tradable: z.boolean(),
  marketable: z.boolean(),
})
export type OfferItemInput = z.infer<typeof OfferItemSchema>

export const CreateOfferSchema = z
  .object({
    conversation_id: z.string().uuid(),
    requested_items: z.array(OfferItemSchema).max(50),
    offered_items: z.array(OfferItemSchema).max(50),
    parent_offer_id: z.string().uuid().optional(),
  })
  .refine((v) => v.requested_items.length > 0 || v.offered_items.length > 0, {
    message: 'At least one item must be requested or offered',
  })
export type CreateOfferInput = z.infer<typeof CreateOfferSchema>

// Counter is identical shape (parent_offer_id required) but enforced at the route layer.
```

**Step 2: Test that existing schemas still parse**

```bash
pnpm --filter @skinpeer/server test
```

Expected: previous tests pass.

**Step 3: Commit**

```bash
git add apps/server/src/schemas/traderNetwork.ts
git commit -m "feat(server): zod schemas for trade offer create/counter"
```

---

## Task 6: `POST /api/offers` — create offer + pending-uniqueness

**Files:**
- Create: `apps/server/src/routes/offers.ts`
- Test: `apps/server/tests/offers.create.test.ts`

**Step 1: Write the failing test**

```ts
// apps/server/tests/offers.create.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createSupabaseStub } from './helpers/mockSupabase'

const ITEM = {
  asset_id: '1', class_id: '2', name: 'AK-47 | Redline',
  icon_url: 'https://x', wear: 'FT', rarity: 'Classified', type: 'Rifle',
  tradable: true, marketable: true,
}

describe('POST /api/offers', () => {
  let s: ReturnType<typeof createSupabaseStub>
  let app: express.Express

  beforeEach(async () => {
    s = createSupabaseStub()
    vi.resetModules()
    vi.doMock('../src/lib/supabase', () => ({ supabase: s.client }))
    vi.doMock('../src/middleware/authenticate', () => ({
      authenticate: (req: any, _res: any, next: any) => { req.user = { id: 'A' }; next() },
    }))
    const { default: router } = await import('../src/routes/offers')
    app = express().use(express.json()).use('/api/offers', router)
  })

  it('400 when no items provided', async () => {
    const res = await request(app).post('/api/offers').send({ conversation_id: 'c-1', requested_items: [], offered_items: [] })
    expect(res.status).toBe(400)
  })

  it('403 when caller not in conversation', async () => {
    s.push({ data: { id: 'c-1', user_a_id: 'X', user_b_id: 'Y' } })
    const res = await request(app).post('/api/offers').send({ conversation_id: 'c-1', requested_items: [ITEM], offered_items: [] })
    expect(res.status).toBe(403)
  })

  it('409 when a pending offer already exists in this direction', async () => {
    s.push({ data: { id: 'c-1', user_a_id: 'A', user_b_id: 'B' } })
    s.push({ data: null, error: { code: '23505', message: 'unique violation' } }) // insert
    const res = await request(app).post('/api/offers').send({ conversation_id: 'c-1', requested_items: [ITEM], offered_items: [] })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/pending/i)
  })

  it('201 creates offer + posts inline message', async () => {
    s.push({ data: { id: 'c-1', user_a_id: 'A', user_b_id: 'B' } }) // conversation
    s.push({ data: { id: 'o-1', conversation_id: 'c-1', from_user_id: 'A', to_user_id: 'B', status: 'pending' } }) // insert offer
    s.push({ data: { id: 'm-1' } }) // insert message
    const res = await request(app).post('/api/offers').send({ conversation_id: 'c-1', requested_items: [ITEM], offered_items: [] })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe('o-1')
  })
})
```

Run: `pnpm --filter @skinpeer/server test offers.create`
Expected: FAIL — `Cannot find module '../src/routes/offers'`.

**Step 2: Write `apps/server/src/routes/offers.ts` (create handler only for now)**

```ts
import { Router } from 'express'
import { supabase } from '../lib/supabase'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { CreateOfferSchema } from '../schemas/traderNetwork'

const router = Router()
router.use(authenticate)

router.post('/', validate(CreateOfferSchema), async (req, res, next) => {
  try {
    const me = req.user!.id
    const { conversation_id, requested_items, offered_items, parent_offer_id } = req.body

    const { data: convo } = await supabase
      .from('conversations')
      .select('id, user_a_id, user_b_id')
      .eq('id', conversation_id)
      .maybeSingle()

    if (!convo) { res.status(404).json({ error: 'Conversation not found' }); return }
    if (convo.user_a_id !== me && convo.user_b_id !== me) {
      res.status(403).json({ error: 'Forbidden' }); return
    }

    const to = convo.user_a_id === me ? convo.user_b_id : convo.user_a_id

    const { data: offer, error } = await supabase
      .from('trade_offers')
      .insert({
        conversation_id,
        from_user_id: me,
        to_user_id: to,
        requested_items,
        offered_items,
        parent_offer_id: parent_offer_id ?? null,
      })
      .select()
      .single()

    if (error) {
      if ((error as { code?: string }).code === '23505') {
        res.status(409).json({ error: 'You have a pending offer in this thread — withdraw it to revise.' })
        return
      }
      res.status(400).json({ error: (error as Error).message ?? 'Failed to create offer' })
      return
    }

    // Inline thread message rendering the offer card
    await supabase.from('messages').insert({
      conversation_id,
      sender_id: me,
      body: 'Trade offer sent',
      kind: 'trade_offer',
      metadata: { offer_id: offer!.id, parent_offer_id: parent_offer_id ?? null },
    })

    res.status(201).json(offer)
  } catch (err) {
    next(err)
  }
})

export default router
```

**Step 3: Run tests**

```bash
pnpm --filter @skinpeer/server test offers.create
```

Expected: 4 passed.

**Step 4: Commit**

```bash
git add apps/server/src/routes/offers.ts apps/server/tests/offers.create.test.ts
git commit -m "feat(server): POST /api/offers create with pending-uniqueness 409"
```

---

## Task 7: Withdraw + reject

**Files:**
- Modify: `apps/server/src/routes/offers.ts`
- Test: `apps/server/tests/offers.lifecycle.test.ts`

**Step 1: Write failing tests**

```ts
// apps/server/tests/offers.lifecycle.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createSupabaseStub } from './helpers/mockSupabase'

function setupApp(callerId: string) {
  vi.resetModules()
  vi.doMock('../src/middleware/authenticate', () => ({
    authenticate: (req: any, _res: any, next: any) => { req.user = { id: callerId }; next() },
  }))
}

describe('offer lifecycle', () => {
  let s: ReturnType<typeof createSupabaseStub>
  let app: express.Express

  beforeEach(async () => {
    s = createSupabaseStub()
    vi.doMock('../src/lib/supabase', () => ({ supabase: s.client }))
  })

  describe('POST /api/offers/:id/withdraw', () => {
    it('A withdraws their own pending offer', async () => {
      setupApp('A')
      vi.doMock('../src/lib/supabase', () => ({ supabase: s.client }))
      const { default: router } = await import('../src/routes/offers')
      app = express().use(express.json()).use('/api/offers', router)

      s.push({ data: { id: 'o-1', from_user_id: 'A', to_user_id: 'B', status: 'pending' } }) // load
      s.push({ data: { id: 'o-1', status: 'withdrawn' } })                                   // update
      const res = await request(app).post('/api/offers/o-1/withdraw')
      expect(res.status).toBe(200)
      expect(res.body.status).toBe('withdrawn')
    })

    it('403 if non-sender tries to withdraw', async () => {
      setupApp('B')
      vi.doMock('../src/lib/supabase', () => ({ supabase: s.client }))
      const { default: router } = await import('../src/routes/offers')
      app = express().use(express.json()).use('/api/offers', router)
      s.push({ data: { id: 'o-1', from_user_id: 'A', to_user_id: 'B', status: 'pending' } })
      const res = await request(app).post('/api/offers/o-1/withdraw')
      expect(res.status).toBe(403)
    })

    it('400 if offer not pending', async () => {
      setupApp('A')
      vi.doMock('../src/lib/supabase', () => ({ supabase: s.client }))
      const { default: router } = await import('../src/routes/offers')
      app = express().use(express.json()).use('/api/offers', router)
      s.push({ data: { id: 'o-1', from_user_id: 'A', to_user_id: 'B', status: 'rejected' } })
      const res = await request(app).post('/api/offers/o-1/withdraw')
      expect(res.status).toBe(400)
    })
  })

  describe('POST /api/offers/:id/reject', () => {
    it('B rejects A\'s pending offer', async () => {
      setupApp('B')
      vi.doMock('../src/lib/supabase', () => ({ supabase: s.client }))
      const { default: router } = await import('../src/routes/offers')
      app = express().use(express.json()).use('/api/offers', router)
      s.push({ data: { id: 'o-1', from_user_id: 'A', to_user_id: 'B', status: 'pending' } })
      s.push({ data: { id: 'o-1', status: 'rejected' } })
      const res = await request(app).post('/api/offers/o-1/reject')
      expect(res.status).toBe(200)
      expect(res.body.status).toBe('rejected')
    })

    it('403 if sender tries to reject (must withdraw)', async () => {
      setupApp('A')
      vi.doMock('../src/lib/supabase', () => ({ supabase: s.client }))
      const { default: router } = await import('../src/routes/offers')
      app = express().use(express.json()).use('/api/offers', router)
      s.push({ data: { id: 'o-1', from_user_id: 'A', to_user_id: 'B', status: 'pending' } })
      const res = await request(app).post('/api/offers/o-1/reject')
      expect(res.status).toBe(403)
    })
  })
})
```

Run: tests fail (handlers don't exist yet).

**Step 2: Add handlers in `apps/server/src/routes/offers.ts`**

Add a private helper at the top (after imports):

```ts
async function loadOffer(id: string) {
  const { data } = await supabase
    .from('trade_offers')
    .select('id, conversation_id, from_user_id, to_user_id, status, requested_items, offered_items, parent_offer_id')
    .eq('id', id)
    .maybeSingle()
  return data as null | {
    id: string; conversation_id: string; from_user_id: string; to_user_id: string;
    status: string; requested_items: unknown[]; offered_items: unknown[]; parent_offer_id: string | null;
  }
}

async function transitionOffer(id: string, status: string) {
  const { data } = await supabase
    .from('trade_offers')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  return data
}
```

Add handlers:

```ts
router.post('/:id/withdraw', async (req, res, next) => {
  try {
    const me = req.user!.id
    const offer = await loadOffer(req.params.id)
    if (!offer) { res.status(404).json({ error: 'Offer not found' }); return }
    if (offer.from_user_id !== me) { res.status(403).json({ error: 'Only the sender can withdraw' }); return }
    if (offer.status !== 'pending') { res.status(400).json({ error: 'Offer is not pending' }); return }
    res.json(await transitionOffer(offer.id, 'withdrawn'))
  } catch (err) { next(err) }
})

router.post('/:id/reject', async (req, res, next) => {
  try {
    const me = req.user!.id
    const offer = await loadOffer(req.params.id)
    if (!offer) { res.status(404).json({ error: 'Offer not found' }); return }
    if (offer.to_user_id !== me) { res.status(403).json({ error: 'Only the recipient can reject' }); return }
    if (offer.status !== 'pending') { res.status(400).json({ error: 'Offer is not pending' }); return }
    res.json(await transitionOffer(offer.id, 'rejected'))
  } catch (err) { next(err) }
})
```

**Step 3: Run tests**

```bash
pnpm --filter @skinpeer/server test offers.lifecycle
```

Expected: 5 passed.

**Step 4: Commit**

```bash
git add apps/server/src/routes/offers.ts apps/server/tests/offers.lifecycle.test.ts
git commit -m "feat(server): offer withdraw + reject endpoints with role checks"
```

---

## Task 8: Accept — materializes a `trade_proposals` + `trade_items`

The accept handoff is the critical bridge: the offer's `requested_items` (from B's inventory) become items where `owner_id = to_user_id (B)`, and `offered_items` (from A's inventory) become items where `owner_id = from_user_id (A)`. The new proposal starts in status `draft` so the existing checklist flow runs unchanged.

**Files:**
- Modify: `apps/server/src/routes/offers.ts`
- Test: `apps/server/tests/offers.accept.test.ts`

**Step 1: Write failing test**

```ts
// apps/server/tests/offers.accept.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createSupabaseStub } from './helpers/mockSupabase'

const ITEM = (n: string) => ({
  asset_id: n, class_id: 'c', name: `Item ${n}`,
  icon_url: 'https://x', wear: null, rarity: null, type: null,
  tradable: true, marketable: true,
})

describe('POST /api/offers/:id/accept', () => {
  let s: ReturnType<typeof createSupabaseStub>
  let app: express.Express

  beforeEach(async () => {
    s = createSupabaseStub()
    vi.resetModules()
    vi.doMock('../src/lib/supabase', () => ({ supabase: s.client }))
    vi.doMock('../src/middleware/authenticate', () => ({
      authenticate: (req: any, _res: any, next: any) => { req.user = { id: 'B' }; next() },
    }))
    vi.doMock('../src/services/proposalCodeService', () => ({
      generateProposalVerificationCode: async () => 'TEST-0001-CASE',
    }))
    const { default: router } = await import('../src/routes/offers')
    app = express().use(express.json()).use('/api/offers', router)
  })

  it('403 if non-recipient tries to accept', async () => {
    vi.resetModules()
    vi.doMock('../src/lib/supabase', () => ({ supabase: s.client }))
    vi.doMock('../src/middleware/authenticate', () => ({
      authenticate: (req: any, _res: any, next: any) => { req.user = { id: 'A' }; next() },
    }))
    const { default: router } = await import('../src/routes/offers')
    app = express().use(express.json()).use('/api/offers', router)
    s.push({ data: { id: 'o-1', conversation_id: 'c-1', from_user_id: 'A', to_user_id: 'B', status: 'pending', requested_items: [], offered_items: [] } })
    const res = await request(app).post('/api/offers/o-1/accept')
    expect(res.status).toBe(403)
  })

  it('creates proposal + items + thread message; flips offer status', async () => {
    s.push({ data: { id: 'o-1', conversation_id: 'c-1', from_user_id: 'A', to_user_id: 'B', status: 'pending',
                     requested_items: [ITEM('r1')], offered_items: [ITEM('a1'), ITEM('a2')] } })  // load offer
    s.push({ data: { id: 'p-1', verification_code: 'TEST-0001-CASE', creator_id: 'A', recipient_id: 'B' } }) // insert proposal
    s.push({ data: [], error: null }) // bulk insert items
    s.push({ data: null }) // update offer
    s.push({ data: null }) // insert thread message
    s.push({ data: null }) // activity log
    const res = await request(app).post('/api/offers/o-1/accept')
    expect(res.status).toBe(200)
    expect(res.body.proposal_id).toBe('p-1')
    expect(res.body.verification_code).toBe('TEST-0001-CASE')
  })

  it('400 when offer not pending', async () => {
    s.push({ data: { id: 'o-1', conversation_id: 'c-1', from_user_id: 'A', to_user_id: 'B', status: 'rejected', requested_items: [], offered_items: [] } })
    const res = await request(app).post('/api/offers/o-1/accept')
    expect(res.status).toBe(400)
  })
})
```

**Step 2: Run test → fail**

```bash
pnpm --filter @skinpeer/server test offers.accept
```

Expected: FAIL — handler not implemented.

**Step 3: Add `/accept` in `apps/server/src/routes/offers.ts`**

Below the reject handler:

```ts
import { generateProposalVerificationCode } from '../services/proposalCodeService'

interface OfferItemPayload {
  asset_id: string
  class_id: string
  name: string
  icon_url: string
  wear: string | null
  rarity: string | null
  type: string | null
}

router.post('/:id/accept', async (req, res, next) => {
  try {
    const me = req.user!.id
    const offer = await loadOffer(req.params.id)
    if (!offer) { res.status(404).json({ error: 'Offer not found' }); return }
    if (offer.to_user_id !== me) { res.status(403).json({ error: 'Only the recipient can accept' }); return }
    if (offer.status !== 'pending') { res.status(400).json({ error: 'Offer is not pending' }); return }

    const code = await generateProposalVerificationCode()

    const { data: proposal, error: pErr } = await supabase
      .from('trade_proposals')
      .insert({
        conversation_id: offer.conversation_id,
        creator_id: offer.from_user_id,
        recipient_id: offer.to_user_id,
        verification_code: code,
        status: 'draft',
      })
      .select()
      .single()

    if (pErr || !proposal) {
      res.status(500).json({ error: pErr?.message ?? 'Failed to create proposal' })
      return
    }

    const offered = (offer.offered_items as OfferItemPayload[]).map((i) => ({
      proposal_id: proposal.id,
      owner_id: offer.from_user_id,
      name: i.name,
      wear: i.wear,
      rarity: i.rarity,
      image_url: i.icon_url,
      steam_asset_id: i.asset_id,
    }))
    const requested = (offer.requested_items as OfferItemPayload[]).map((i) => ({
      proposal_id: proposal.id,
      owner_id: offer.to_user_id,
      name: i.name,
      wear: i.wear,
      rarity: i.rarity,
      image_url: i.icon_url,
      steam_asset_id: i.asset_id,
    }))
    const allItems = [...offered, ...requested]
    if (allItems.length > 0) {
      await supabase.from('trade_items').insert(allItems)
    }

    await supabase
      .from('trade_offers')
      .update({
        status: 'accepted',
        resulting_proposal_id: proposal.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', offer.id)

    await supabase.from('messages').insert({
      conversation_id: offer.conversation_id,
      sender_id: me,
      body: 'Trade offer accepted — verification proposal opened',
      kind: 'trade_proposal_link',
      metadata: { proposal_id: proposal.id, offer_id: offer.id, verification_code: code },
    })

    await supabase.from('trade_activity_log').insert({
      proposal_id: proposal.id,
      actor_id: me,
      action: 'proposal_created_from_offer',
      metadata: { offer_id: offer.id },
    })

    res.json({
      offer_id: offer.id,
      proposal_id: proposal.id,
      verification_code: code,
    })
  } catch (err) {
    next(err)
  }
})
```

**Step 4: Run tests**

```bash
pnpm --filter @skinpeer/server test offers.accept
```

Expected: 3 passed.

**Step 5: Commit**

```bash
git add apps/server/src/routes/offers.ts apps/server/tests/offers.accept.test.ts
git commit -m "feat(server): offer accept materializes trade_proposal + items"
```

---

## Task 9: Counter — flips parent + creates child offer in opposite direction

**Files:**
- Modify: `apps/server/src/routes/offers.ts`
- Test: `apps/server/tests/offers.counter.test.ts`

**Step 1: Write failing test**

Cover: B counters A's offer → original status `countered`, new offer has `from_user_id=B, to_user_id=A, parent_offer_id=original.id`. Sender of original cannot counter.

```ts
// apps/server/tests/offers.counter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createSupabaseStub } from './helpers/mockSupabase'

const ITEM = {
  asset_id: '1', class_id: '2', name: 'AK', icon_url: 'https://x',
  wear: null, rarity: null, type: null, tradable: true, marketable: true,
}

describe('POST /api/offers/:id/counter', () => {
  let s: ReturnType<typeof createSupabaseStub>
  let app: express.Express

  beforeEach(async () => {
    s = createSupabaseStub()
    vi.resetModules()
    vi.doMock('../src/lib/supabase', () => ({ supabase: s.client }))
    vi.doMock('../src/middleware/authenticate', () => ({
      authenticate: (req: any, _res: any, next: any) => { req.user = { id: 'B' }; next() },
    }))
    const { default: router } = await import('../src/routes/offers')
    app = express().use(express.json()).use('/api/offers', router)
  })

  it('creates new offer with parent + flips original to countered', async () => {
    s.push({ data: { id: 'o-1', conversation_id: 'c-1', from_user_id: 'A', to_user_id: 'B', status: 'pending', requested_items: [], offered_items: [] } }) // load
    s.push({ data: null }) // update parent → countered
    s.push({ data: { id: 'o-2', from_user_id: 'B', to_user_id: 'A', parent_offer_id: 'o-1', status: 'pending' } }) // insert child
    s.push({ data: { id: 'm-1' } }) // thread message

    const res = await request(app).post('/api/offers/o-1/counter').send({
      requested_items: [ITEM],
      offered_items: [],
    })
    expect(res.status).toBe(201)
    expect(res.body.parent_offer_id).toBe('o-1')
    expect(res.body.from_user_id).toBe('B')
  })

  it('403 if sender of original tries to counter', async () => {
    vi.resetModules()
    vi.doMock('../src/lib/supabase', () => ({ supabase: s.client }))
    vi.doMock('../src/middleware/authenticate', () => ({
      authenticate: (req: any, _res: any, next: any) => { req.user = { id: 'A' }; next() },
    }))
    const { default: router } = await import('../src/routes/offers')
    app = express().use(express.json()).use('/api/offers', router)
    s.push({ data: { id: 'o-1', conversation_id: 'c-1', from_user_id: 'A', to_user_id: 'B', status: 'pending', requested_items: [], offered_items: [] } })
    const res = await request(app).post('/api/offers/o-1/counter').send({ requested_items: [ITEM], offered_items: [] })
    expect(res.status).toBe(403)
  })
})
```

**Step 2: Add `/counter` handler**

```ts
import { CreateOfferSchema } from '../schemas/traderNetwork'
// CounterOffer body shape is identical to CreateOffer minus conversation_id (derived)
// and parent_offer_id (forced from URL).

const CounterOfferBodySchema = CreateOfferSchema._def.schema.omit({
  conversation_id: true,
  parent_offer_id: true,
})

router.post('/:id/counter', validate(CounterOfferBodySchema), async (req, res, next) => {
  try {
    const me = req.user!.id
    const original = await loadOffer(req.params.id)
    if (!original) { res.status(404).json({ error: 'Offer not found' }); return }
    if (original.to_user_id !== me) { res.status(403).json({ error: 'Only the recipient can counter' }); return }
    if (original.status !== 'pending') { res.status(400).json({ error: 'Offer is not pending' }); return }

    const { requested_items, offered_items } = req.body
    if ((requested_items?.length ?? 0) === 0 && (offered_items?.length ?? 0) === 0) {
      res.status(400).json({ error: 'Counter must include at least one item' })
      return
    }

    // 1) flip parent → countered
    await supabase
      .from('trade_offers')
      .update({ status: 'countered', updated_at: new Date().toISOString() })
      .eq('id', original.id)

    // 2) insert child going B → A
    const { data: child, error } = await supabase
      .from('trade_offers')
      .insert({
        conversation_id: original.conversation_id,
        from_user_id: me,
        to_user_id: original.from_user_id,
        requested_items,
        offered_items,
        parent_offer_id: original.id,
      })
      .select()
      .single()

    if (error) {
      // 23505 means there's already a pending offer in B → A direction.
      if ((error as { code?: string }).code === '23505') {
        res.status(409).json({ error: 'You already have a pending offer in this direction.' })
        return
      }
      res.status(400).json({ error: (error as Error).message })
      return
    }

    // 3) inline thread card for the counter
    await supabase.from('messages').insert({
      conversation_id: original.conversation_id,
      sender_id: me,
      body: 'Counter offer sent',
      kind: 'trade_offer',
      metadata: { offer_id: child!.id, parent_offer_id: original.id },
    })

    res.status(201).json(child)
  } catch (err) {
    next(err)
  }
})
```

**⚠ Implementer note:** `CreateOfferSchema._def.schema.omit(...)` reaches into the Zod refinement internals. If that breaks across Zod versions, just declare a fresh schema:

```ts
const CounterOfferBodySchema = z.object({
  requested_items: z.array(OfferItemSchema).max(50),
  offered_items: z.array(OfferItemSchema).max(50),
})
```

(import `z`, `OfferItemSchema` from the schemas file).

**Step 3: Run tests**

```bash
pnpm --filter @skinpeer/server test offers.counter
```

Expected: 2 passed.

**Step 4: Commit**

```bash
git add apps/server/src/routes/offers.ts apps/server/tests/offers.counter.test.ts
git commit -m "feat(server): offer counter flips parent + creates reverse-direction child"
```

---

## Task 10: GET handlers — detail + inbound pending count

**Files:**
- Modify: `apps/server/src/routes/offers.ts`
- Test: `apps/server/tests/offers.read.test.ts`

**Step 1: Add handlers**

```ts
// GET /api/offers/inbound/pending — count of offers awaiting current user's action
router.get('/inbound/pending', async (req, res, next) => {
  try {
    const me = req.user!.id
    const { count } = await supabase
      .from('trade_offers')
      .select('id', { count: 'exact', head: true })
      .eq('to_user_id', me)
      .eq('status', 'pending')
    res.json({ count: count ?? 0 })
  } catch (err) { next(err) }
})

// GET /api/offers/:id — detail (participant only)
router.get('/:id', async (req, res, next) => {
  try {
    const me = req.user!.id
    const offer = await loadOffer(req.params.id)
    if (!offer) { res.status(404).json({ error: 'Offer not found' }); return }
    if (offer.from_user_id !== me && offer.to_user_id !== me) {
      res.status(403).json({ error: 'Forbidden' }); return
    }
    res.json(offer)
  } catch (err) { next(err) }
})
```

**Step 2: Add a small test** (one passes inbound count, one detail-403 for non-participant). Skipping full test code — pattern matches Task 6/7. Run with `pnpm --filter @skinpeer/server test offers.read`.

**Step 3: Commit**

```bash
git add apps/server/src/routes/offers.ts apps/server/tests/offers.read.test.ts
git commit -m "feat(server): offer detail + inbound-pending count"
```

---

## Task 11: Wire offer routes + market price route into the server

**Files:**
- Modify: `apps/server/src/index.ts`

**Step 1: Mount the new routers**

In `apps/server/src/index.ts`, after the existing route mounts:

```ts
import offersRouter from './routes/offers'
import marketPricesRouter from './routes/marketPrices'

app.use('/api/inventory', inventoryRouter)   // already mounted at /api/me — ALSO mount here for /api/inventory/by-user/:id
app.use('/api/offers', offersRouter)
app.use('/api/market', marketPricesRouter)
```

⚠ Implementer note: the existing inventory router is mounted at `/api/me` (line 36). The new `by-user/:user_id` handler lives in the same router file so it's reachable at `/api/inventory/by-user/:user_id` only after being mounted at `/api/inventory`. Either mount the same router twice (simpler) or split into two routers (cleaner). Prefer splitting: move the `by-user` handler into a new `apps/server/src/routes/inventoryByUser.ts` and mount that at `/api/inventory`.

**Step 2: Smoke**

```bash
pnpm --filter @skinpeer/server dev
```

In another terminal:
```bash
curl -i http://localhost:4000/api/offers/inbound/pending
```

Expected: `401 Unauthorized` (auth middleware rejects unauthenticated) — confirms the route is wired.

**Step 3: Commit**

```bash
git add apps/server/src/index.ts apps/server/src/routes/inventoryByUser.ts
git commit -m "chore(server): mount offers, market price, inventory-by-user routes"
```

---

## Task 12: Frontend types + API helper

**Files:**
- Modify: `apps/web/src/types/traderNetwork.ts`

**Step 1: Append**

```ts
export type OfferStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'countered'

export interface OfferItem {
  asset_id: string
  class_id: string
  name: string
  icon_url: string
  wear: string | null
  rarity: string | null
  type: string | null
  tradable: boolean
  marketable: boolean
}

export interface TradeOffer {
  id: string
  conversation_id: string
  from_user_id: string
  to_user_id: string
  requested_items: OfferItem[]
  offered_items: OfferItem[]
  status: OfferStatus
  parent_offer_id: string | null
  resulting_proposal_id: string | null
  created_at: string
  updated_at: string
}

export interface MarketPrice {
  market_hash_name: string
  lowest_price: string | null
  median_price: string | null
  volume: string | null
  source: string
  fetched_at: string
}
```

Also extend the `Message` kind union to include `'trade_offer'`.

**Step 2: Commit**

```bash
git add apps/web/src/types/traderNetwork.ts
git commit -m "feat(web): types for trade offers + market prices"
```

---

## Task 13: Inline `trade_offer` card in `ConversationPage`

**Files:**
- Create: `apps/web/src/components/TradeOfferCard.tsx`
- Modify: `apps/web/src/pages/ConversationPage.tsx`

**Step 1: Build `TradeOfferCard.tsx`**

Render:
- Two columns: "They want" (requested_items) | "They offer" (offered_items)
- Status pill (pending / accepted / rejected / withdrawn / countered)
- "Countered →" badge linking to child if exists
- Action buttons (only when `status === 'pending'`):
  - I am sender → `Withdraw`
  - I am recipient → `Accept`, `Reject`, `Counter`
- On accept success: navigate to `/proposals/<resulting_proposal_id>`
- On counter: route to `/messages/:cid/propose?counter_of=<id>` (Task 14 page handles pre-population)
- Each item row shows market price hint (lazy-fetched via `apiFetch<MarketPrice>('/market/price?name=...')`) with caption: `Steam Community Market — last fetched at HH:MM`. Cap visible items at 8, "+ N more" if longer.

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import type { MarketPrice, OfferItem, TradeOffer } from '../types/traderNetwork'

const STATUS_COLOR: Record<TradeOffer['status'], string> = {
  pending:   'bg-warning/20 text-warning',
  accepted:  'bg-accent/20 text-accent',
  rejected:  'bg-danger/20 text-danger',
  withdrawn: 'bg-gray-500/20 text-gray-400',
  countered: 'bg-blue-500/20 text-blue-300',
}

export function TradeOfferCard({ offer, onChange }: { offer: TradeOffer; onChange: () => void }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const me = user?.id ?? ''
  const isSender = offer.from_user_id === me
  const isRecipient = offer.to_user_id === me
  const canAct = offer.status === 'pending'

  async function withDispatch(fn: () => Promise<void>) {
    setBusy(true); setError(null)
    try { await fn(); onChange() } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <div className="bg-bg border border-border rounded p-4 my-2">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs uppercase tracking-wide text-gray-400">
          {isSender ? 'You proposed' : 'They proposed'}
        </p>
        <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase ${STATUS_COLOR[offer.status]}`}>
          {offer.status}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <ItemColumn title="Wants" items={offer.requested_items} />
        <ItemColumn title="Offers" items={offer.offered_items} />
      </div>
      {error && <p className="text-danger text-xs mt-2">{error}</p>}
      {canAct && (
        <div className="flex gap-2 mt-4">
          {isRecipient && (
            <>
              <button
                disabled={busy}
                onClick={() => withDispatch(async () => {
                  const r = await apiFetch<{ proposal_id: string }>(`/offers/${offer.id}/accept`, { method: 'POST' })
                  navigate(`/proposals/${r.proposal_id}`)
                })}
                className="bg-accent text-black font-semibold rounded px-3 py-1 text-sm disabled:opacity-50"
              >
                Accept
              </button>
              <button
                disabled={busy}
                onClick={() => withDispatch(async () => {
                  await apiFetch(`/offers/${offer.id}/reject`, { method: 'POST' })
                })}
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
              onClick={() => withDispatch(async () => {
                await apiFetch(`/offers/${offer.id}/withdraw`, { method: 'POST' })
              })}
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

function ItemColumn({ title, items }: { title: string; items: OfferItem[] }) {
  const visible = items.slice(0, 8)
  const overflow = items.length - visible.length
  return (
    <div>
      <p className="text-xs text-gray-400 mb-1">{title} ({items.length})</p>
      <ul className="space-y-1">
        {visible.map((i) => <ItemRow key={i.asset_id} item={i} />)}
      </ul>
      {overflow > 0 && <p className="text-[10px] text-gray-500 mt-1">+ {overflow} more</p>}
    </div>
  )
}

function ItemRow({ item }: { item: OfferItem }) {
  const [price, setPrice] = useState<MarketPrice | null>(null)
  useEffect(() => {
    let cancelled = false
    apiFetch<MarketPrice>(`/market/price?name=${encodeURIComponent(item.name)}`)
      .then((p) => { if (!cancelled) setPrice(p) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [item.name])
  const fetchedHm = price ? new Date(price.fetched_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null
  return (
    <li className="flex items-center gap-2">
      <img src={item.icon_url} alt="" className="w-8 h-8 object-contain" />
      <div className="min-w-0 flex-1">
        <p className="text-xs truncate">{item.name}</p>
        {price && (
          <p className="text-[10px] text-gray-500">
            {price.lowest_price ?? '—'} · Steam Community Market — last fetched at {fetchedHm}
          </p>
        )}
      </div>
    </li>
  )
}
```

**Step 2: Render `trade_offer` messages in `ConversationPage.tsx`**

Inside the message-render loop (currently at line 126-152), add a new branch:

```tsx
if (m.kind === 'trade_offer') {
  const offerId = (m.metadata as { offer_id?: string } | null)?.offer_id
  if (!offerId) return null
  return <ConvoOfferCardRow key={m.id} offerId={offerId} onChange={() => /* refetch convo via apiFetch */ ...} />
}
```

Where `ConvoOfferCardRow` is a tiny wrapper that fetches `/offers/:id` and renders `<TradeOfferCard>`. Add Realtime subscription on `trade_offers` filtered by `id=eq.<offerId>` to refresh on status change.

**Step 3: Update "Propose trade" navigation**

Change `navigate(`/proposals/new?conversation_id=${id}`)` (line 112) to `navigate(`/messages/${id}/propose`)`. The new route is added in Task 14.

**Step 4: Manual verification**

Start client + server, send a `trade_offer` row directly in the DB via Supabase SQL editor, verify the card renders.

**Step 5: Commit**

```bash
git add apps/web/src/components/TradeOfferCard.tsx apps/web/src/pages/ConversationPage.tsx
git commit -m "feat(web): inline trade_offer card with accept/reject/counter/withdraw"
```

---

## Task 14: New `ProposeTradePage` (browse B's inventory → pick A's items → review → submit)

**Files:**
- Create: `apps/web/src/pages/ProposeTradePage.tsx`
- Modify: `apps/web/src/App.tsx` (route + remove old `/proposals/new` route)
- Delete: `apps/web/src/pages/CreateTradeProposalPage.tsx`

**Step 1: Routing**

In `App.tsx`:

- Replace `<Route path="/proposals/new" element={<ProtectedRoute><CreateTradeProposalPage /></ProtectedRoute>} />` with:
  ```tsx
  <Route path="/messages/:conversationId/propose" element={<ProtectedRoute><ProposeTradePage /></ProtectedRoute>} />
  ```
- Remove the `CreateTradeProposalPage` import.

**Step 2: Build `ProposeTradePage.tsx`**

Steps:
1. On mount, resolve the conversation → identify counterparty user_id (call `GET /api/conversations/:id` to learn user_a/user_b).
2. If `?counter_of=<offer_id>` query param present, fetch that offer to pre-populate selections with **roles swapped** (their offered_items become my requested, their requested_items become my offered).
3. Three-step UI (single page, three sections — top to bottom):
   - **Section 1: "Items you want from <Their persona>"** — fetch `/api/inventory/by-user/<their_user_id>`. Render grid (same component shape as current `CreateTradeProposalPage`). Multi-select. Running total via `MarketPrice` hint with explicit "Steam Community Market — last fetched at HH:MM" caption. If response has `is_private: true`, render: `<persona>'s inventory is private — ask them to make it public` plus `<a href="https://steamcommunity.com/my/edit/settings">Steam privacy settings</a>`. Do not say "no items found".
   - **Section 2: "Items you'll offer"** — fetch `/api/me/inventory`. Same multi-select. Show running balance delta (sum of requested low – sum of offered low). Caption underneath: "Price hints are advisory only and do not gate submission."
   - **Section 3: Submit** — POST `/api/offers` with `{ conversation_id, requested_items: [...], offered_items: [...], parent_offer_id?: counter_of }`. On 409 (pending exists in this direction), show banner: "You have a pending proposal — withdraw it to revise." with a link to the existing offer. On success: navigate back to `/messages/:conversationId`.

**Step 3: Handle 409 (pending blocker)**

Before allowing submit, also call `GET /api/conversations/:id` and look for the most recent pending offer where `from_user_id === me` (also exposed via a new helper or inferred from the inline card). Disable submit with the same copy when one exists. Server still enforces.

**Step 4: Manual verification**

```
- /messages/:cid → click "Propose trade" → arrive at new page
- pick items on both sides → submit → message thread shows offer card
- attempt to submit a second offer → submit button shows "withdraw it to revise"
- click "Counter" on a received offer → arrive at page with selections pre-filled & roles swapped
```

**Step 5: Commit**

```bash
git add apps/web/src/pages/ProposeTradePage.tsx apps/web/src/App.tsx
git rm apps/web/src/pages/CreateTradeProposalPage.tsx
git commit -m "feat(web): pull-based ProposeTradePage replaces CreateTradeProposalPage"
```

---

## Task 15: Dashboard inbox + nav badge dot

**Files:**
- Modify: `apps/web/src/pages/MyTradesPage.tsx`
- Modify: `apps/web/src/components/Layout.tsx`
- Create: `apps/web/src/hooks/usePendingOffersCount.ts`

**Step 1: Hook**

```ts
// apps/web/src/hooks/usePendingOffersCount.ts
import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export function usePendingOffersCount() {
  const { user } = useAuth()
  const [count, setCount] = useState(0)

  async function refresh() {
    try {
      const { count } = await apiFetch<{ count: number }>('/offers/inbound/pending')
      setCount(count)
    } catch {/* ignore */}
  }

  useEffect(() => {
    if (!user) return
    void refresh()
    const ch = supabase
      .channel(`offers-inbound:${user.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'trade_offers', filter: `to_user_id=eq.${user.id}` },
        () => void refresh())
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [user?.id])

  return count
}
```

**Step 2: Use in `Layout.tsx`**

Wrap the "My trades" link to show a small dot when count > 0:

```tsx
import { usePendingOffersCount } from '../hooks/usePendingOffersCount'
// ...
const pending = usePendingOffersCount()
// inside the nav:
<Link to="/proposals" className="text-sm text-gray-300 hover:text-white relative">
  My trades
  {pending > 0 && (
    <span className="absolute -top-1 -right-3 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-warning text-[10px] text-black font-semibold">
      {pending}
    </span>
  )}
</Link>
```

**Step 3: Inbox section in `MyTradesPage`**

Above the existing proposal list, add an "Offers awaiting your action" section that fetches `/api/offers/inbound/pending` (returning offers, not just count — extend the route to optionally return rows when `?include_rows=true`, or add a separate `/api/offers/inbound` listing). Render each as a row linking to `/messages/<conversation_id>`.

⚠ Implementer choice: extend `GET /api/offers/inbound/pending` to also return `rows: TradeOffer[]` (limit 20). One round trip is simpler than two endpoints.

**Step 4: Manual verification**

Open the dashboard with one pending inbound offer. Confirm the inbox section + the "1" badge dot in the nav.

**Step 5: Commit**

```bash
git add apps/web/src/hooks/usePendingOffersCount.ts apps/web/src/components/Layout.tsx apps/web/src/pages/MyTradesPage.tsx
git commit -m "feat(web): inbox section + nav badge for pending inbound offers"
```

---

## Task 16: End-to-end smoke script for the accept path

The user's brief asks for "end-to-end test of accept path into existing verification flow." Add a single hand-runnable script that exercises the happy path against a running dev server. Don't try to automate Steam — use a fake offered/requested items payload.

**Files:**
- Create: `scripts/smoke-accept-flow.ts`

**Step 1: Write the script**

```ts
// scripts/smoke-accept-flow.ts
//
// Run against a running dev server with two test users that have a conversation.
// Usage:  pnpm tsx scripts/smoke-accept-flow.ts --a-token=... --b-token=... --conv=<id>
//
// The script:
//   1. A creates an offer (1 requested, 1 offered)
//   2. B accepts → expects 200 with proposal_id + verification_code
//   3. GET /api/proposals/<id> as B → expects creator/recipient ids match, items split correctly
//   4. Both fill checklist via existing route → proposal flips to 'ready_to_verify'
//
// Pass criteria: every step prints OK; failure prints the response body and exits 1.

import { setTimeout as wait } from 'node:timers/promises'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=')
    return [k, v.join('=')]
  })
)
const A = args['a-token']
const B = args['b-token']
const CONV = args['conv']
const BASE = args['base'] ?? 'http://localhost:4000'
if (!A || !B || !CONV) { console.error('Required: --a-token --b-token --conv'); process.exit(2) }

async function call(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

const ITEM = (id: string) => ({
  asset_id: id, class_id: 'fake', name: `Test Item ${id}`, icon_url: 'https://x',
  wear: null, rarity: null, type: null, tradable: true, marketable: true,
})

async function main() {
  console.log('1. A creates offer')
  const create = await call(A, 'POST', '/offers', {
    conversation_id: CONV,
    requested_items: [ITEM('r1')],
    offered_items: [ITEM('a1')],
  })
  console.log('   status', create.status); if (create.status !== 201) { console.error(create.body); process.exit(1) }
  const offerId = create.body.id
  console.log('   offer', offerId)

  await wait(200)

  console.log('2. B accepts')
  const acc = await call(B, 'POST', `/offers/${offerId}/accept`)
  if (acc.status !== 200) { console.error(acc.body); process.exit(1) }
  const proposalId = acc.body.proposal_id
  console.log('   proposal', proposalId, 'code', acc.body.verification_code)

  console.log('3. GET proposal as B')
  const view = await call(B, 'GET', `/proposals/${proposalId}`)
  if (view.status !== 200) { console.error(view.body); process.exit(1) }
  const items = view.body.items
  if (items.creator.length !== 1 || items.recipient.length !== 1) {
    console.error('items split wrong:', items); process.exit(1)
  }
  console.log('   items split OK')

  console.log('4. Both fill checklist')
  const KEYS = ['verified_steam_id','verified_items','verified_floats','checked_stickers','no_off_platform_payment','understand_self_serve']
  for (const tok of [A, B]) {
    for (const k of KEYS) {
      const r = await call(tok, 'POST', `/proposals/${proposalId}/checklist`, { checklist_key: k, is_checked: true })
      if (r.status !== 200) { console.error('checklist', k, r.body); process.exit(1) }
    }
  }
  const final = await call(B, 'GET', `/proposals/${proposalId}`)
  if (final.body.proposal.status !== 'ready_to_verify') { console.error('expected ready_to_verify, got', final.body.proposal.status); process.exit(1) }
  console.log('   proposal status: ready_to_verify ✓')

  console.log('SMOKE OK')
}

main().catch((e) => { console.error(e); process.exit(1) })
```

**Step 2: Run it**

```bash
# in repo root, with server running on :4000 and two test users + conversation
pnpm tsx scripts/smoke-accept-flow.ts --a-token=... --b-token=... --conv=<convo-uuid>
```

Expected output ends with `SMOKE OK`.

**Step 3: Document in `DEV_LOG.md`**

Run `/project:update-dev-log` per the project convention.

**Step 4: Commit**

```bash
git add scripts/smoke-accept-flow.ts
git commit -m "test: end-to-end smoke for offer-accept-to-proposal handoff"
```

---

## Out of scope (do not implement)

- Steam trade bots / account linking beyond what already exists (Steam OpenID is in place).
- Payment / escrow / custody.
- "Guaranteed safe trade" copy — keep all existing safety language.
- Migrating any historical data — pre-launch MVP, no production data.
- AI safety review changes (existing `/api/proposals/:id/ai-review` is unchanged).
- A separate "offer history" archive view — for now, completed/rejected/withdrawn/countered offers stay inline in the message thread + show as accepted-→-proposal in MyTrades.

---

## Verification before merge

Run all of these and confirm they pass:

1. `pnpm --filter @skinpeer/server lint` — TypeScript clean
2. `pnpm --filter @skinpeer/web lint` — TypeScript clean
3. `pnpm --filter @skinpeer/server test` — all vitest suites green
4. `scripts/smoke-accept-flow.ts` — prints `SMOKE OK`
5. Manual browser pass:
   - Find traders → open a conversation with another test user
   - Click "Propose trade" → arrive at the new page; pick items both sides; submit
   - Switch to the other user's session → see badge dot in nav, see inline offer card in thread
   - Click Accept → land on the verification proposal page with both sides' items pre-populated
   - Try a second proposal A→B while one is pending → blocked with "withdraw it to revise"
   - Counter from B → A → original card flips to "countered"; new card appears with swapped roles

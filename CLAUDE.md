# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Note:** rewritten 2026-05-01 to reflect the trader-network refactor. The original trade-rooms-with-invite-codes spec is preserved at `docs/legacy/CLAUDE.md.pre-trader-network` if you need it (move it there if it doesn't exist yet). The hard constraints, trust/safety contract, and "Hard Constraints — Do Not Build" sections are unchanged from the original.

## Dev Log

After every session where code is written or modified, run `/project:update-dev-log` to append an entry to `DEV_LOG.md`. Include the prompt, what was implemented, any bugs and their fixes, and notable decisions.

## Project Overview

SkinPeer is a P2P CS2 skin trade coordination platform. The core product promise: every trade includes a verifiable code that must appear in the Steam mobile confirmation — if the code does not match, the trade is unsafe.

This is **not** a marketplace, escrow service, gambling site, or bot-powered exchange. The platform coordinates trades only; Steam trades happen directly between users.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite 5 + TypeScript 5 + Tailwind 3 + React Router 6 + TanStack Query 5 (`apps/web`) |
| Backend | Node + Express 4 + TypeScript 5 (`apps/server`) |
| Shared | TypeScript types in `packages/shared` (Vite alias + tsconfig path) |
| Database | PostgreSQL via Supabase |
| Auth | **Steam OpenID only.** No email/password. Server creates a Supabase user on first OpenID callback and issues a Supabase session. |
| Realtime | Supabase Realtime (subscribed tables: `messages`, `trade_proposals`, `trade_checklist_items`, `trade_offers`) |
| Validation | Zod on every request body and query string at route boundaries |
| AI | OpenAI SDK for on-demand AI safety reviews of proposals |
| Workspace | pnpm@9 workspaces orchestrated by Turborepo |
| Deployment | Vercel (web) + Railway (server) |

## Development Commands

```bash
# Both apps in parallel (server :4000, web :5173)
pnpm dev

# Or individually
pnpm --filter @skinpeer/web dev
pnpm --filter @skinpeer/server dev

# Build everything (shared → server → web)
pnpm build

# Type check (per package)
pnpm --filter @skinpeer/web lint
pnpm --filter @skinpeer/server lint

# Tests
pnpm --filter @skinpeer/server test       # Vitest, server unit + integration
pnpm --filter @skinpeer/web test          # Vitest, client unit
pnpm test:e2e                             # Playwright (root)

# Promote a user to admin (script-only)
pnpm make-admin user@example.com
```

## Monorepo Structure

```
/
├── apps/
│   ├── web/                      # React + Vite client (port 5173)
│   │   └── src/
│   │       ├── pages/            # Route-level components
│   │       ├── components/       # Shared UI (TrustBar, ScamWarningBanner, VerificationCode, …)
│   │       ├── context/          # AuthContext, PriceContext
│   │       ├── hooks/
│   │       ├── lib/              # Supabase client, API client
│   │       ├── types/
│   │       └── test/             # Vitest setup, renderWithProviders
│   └── server/                   # Express API (port 4000)
│       └── src/
│           ├── routes/           # One file per resource
│           ├── middleware/       # authenticate, requireAdmin, validate, rateLimiter, errorHandler, notFound
│           ├── services/         # proposalCodeService, …
│           ├── schemas/          # Zod request schemas
│           ├── lib/              # supabase admin client, openai, steam, marketPrice
│           ├── types/
│           └── test/             # Vitest setup, factories, supabaseTestClient
├── packages/
│   └── shared/                   # Cross-package TS types (e.g., InventoryItem)
├── scripts/                      # makeAdmin.ts and other one-offs
├── supabase/
│   ├── migrations/               # 001_initial → 008_steam_webapi_token
│   └── seed.sql
├── .github/workflows/ci.yml
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

## Environment Variables

### `apps/server/.env`
```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
PORT=4000
CLIENT_URL=http://localhost:5173
FRONTEND_URL=http://localhost:5173
STEAM_API_KEY=
STEAM_RETURN_URL=http://localhost:4000/api/auth/steam/callback
STEAM_REALM=http://localhost:4000
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
```

### `apps/web/.env`
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_API_URL=http://localhost:4000
```

### Tests (`.env.test` at repo root or in CI secrets)
```
SUPABASE_TEST_URL=             # dedicated Supabase project for tests
SUPABASE_TEST_SERVICE_ROLE_KEY=
SUPABASE_TEST_ANON_KEY=
```

## Database Schema

Migrations live in `supabase/migrations/`. The schema has been through three structural migrations:

| Migration | What it does |
|---|---|
| `001_initial.sql` | Original trade-rooms model (mostly dropped in 003) |
| `002_steam_auth.sql` | Steam fields on `profiles`, `steam_inventories` cache |
| `003_trader_network.sql` | **Major refactor.** Drops trade_rooms / trade_confirmations / activity_log; introduces conversations, messages, trade_proposals, trade_items, trade_checklist_items, trade_activity_log, ai_safety_reviews, trader_profiles, reviews, reports |
| `004_trade_offers.sql` | `trade_offers` (pull-based offers), `steam_inventory_cache`, `steam_market_prices` |
| `005_proposal_status_review.sql` | Adds `in_review` to proposal status check (kept for future use; no handler currently transitions into it) |
| `006_steam_trade_url.sql` | Adds `profiles.steam_trade_url` (nullable text) with a CHECK constraint enforcing the canonical Steam trade URL format. Powers the Send-on-Steam deeplink CTA. |
| `007_mark_completed.sql` | **PR 2.** Drops `trade_checklist_items`; drops `trade_proposals.creator_ready` / `recipient_ready`; drops `ready_to_verify` from the status check; adds `creator_marked_completed` / `recipient_marked_completed` booleans on `trade_proposals` to drive the new two-button completion flow. |
| `008_steam_webapi_token.sql` | Adds `profiles.steam_webapi_token_secret_id uuid` — a pointer into Supabase Vault (`vault.secrets`) holding the user's optional Steam WebAPI token, encrypted at rest. Includes two `SECURITY DEFINER` RPCs (`set_steam_webapi_token`, `clear_steam_webapi_token`) callable only by `service_role` so the server never round-trips plaintext through application SQL. |

### Tables in current schema

| Table | Purpose |
|---|---|
| `profiles` | One row per `auth.users`. `is_admin boolean` is the role flag. `steam_trade_url` (nullable text) holds the user's Steam trade offer URL — the canonical `https://steamcommunity.com/tradeoffer/new/?partner=...&token=...` link, validated by both Zod and a DB CHECK constraint. `steam_webapi_token_secret_id` (nullable uuid) points into `vault.secrets` for the encrypted-at-rest WebAPI token; plaintext is never returned to clients — endpoints only expose the derived `has_steam_webapi_token` boolean. |
| `trader_profiles` | Public directory entry (display name, bio, accepting_trades, total_trades, average_rating). Opt-in. |
| `conversations` | One per ordered pair `(LEAST(a,b), GREATEST(a,b))` so direction-independent. |
| `messages` | Chat with `kind in ('user','system','trade_proposal_link','trade_offer')`. |
| `trade_proposals` | Replaces trade_rooms. Status: `draft | completed | cancelled | disputed | in_review`. Has `verification_code` (unique, server-generated) plus per-user `creator_marked_completed` / `recipient_marked_completed` flags driving the mark-completed flow. |
| `trade_items` | FK `proposal_id`, FK `owner_id`. Items locked once status leaves `draft` **or** either user has marked completed. |
| `trade_activity_log` | Append-only audit; `proposal_id`, `actor_id`, `action`, `metadata`. |
| `ai_safety_reviews` | One per AI run; FK `proposal_id`, FK `requested_by`. `risk_level in ('low','medium','high','critical')`. |
| `reports` | User reports. Optional `subject_user_id`, `proposal_id`, `conversation_id`. |
| `reviews` | Post-trade rating (1-5) + comment, one per `(proposal, reviewer)`. |
| `trade_offers` | Pull-based offer with `requested_items`/`offered_items` JSON; `status in ('pending','accepted','rejected','withdrawn','countered')`. Accepting an offer materializes a `trade_proposals` row and copies items. |
| `steam_inventories` | Per-user inventory cache (TTL ~5 min). |
| `steam_inventory_cache` | Shared cache keyed by `steam_id` (used for viewing other users). |
| `steam_market_prices` | Steam Community Market price cache. Source + `fetched_at` always disclosed. |

### RLS

RLS is enabled only on Realtime-exposed tables: `conversations`, `messages`, `trade_proposals`, `trade_offers`. RLS exists as defense-in-depth for the Realtime stream — **not** the primary authorization. **Server REST routes always check authorization explicitly via the `authenticate` middleware + per-handler participant/role checks.**

## Core Business Rules

### Verification Code
- Generated by `apps/server/src/services/proposalCodeService.ts`.
- 6-character alphanumeric (`nanoid` with alphabet excluding 0/O/I/1).
- Unique on `trade_proposals.verification_code`.
- Generator retries up to **5 times** on collision; throws after.
- The code must appear in the Steam mobile confirmation — if it does not match, the trade is unsafe. This is the single most important user-facing safety primitive.

### Send-on-Steam deeplink
- Proposal page exposes a "Send trade on Steam" CTA to the proposal creator. It opens `https://steamcommunity.com/tradeoffer/new/?partner=...&token=...&message=<verification_code>` in a new tab. Steam's deeplink supports only `partner`, `token`, and `message` — items cannot be pre-populated, by Steam design. The agreed-items panel on the proposal page lists each item with a "Copy name" button as the workaround.
- **Gating:** the CTA requires both users to have `steam_trade_url` set. If the *clicker* is missing it, the click opens the helper modal inline (`SteamTradeUrlModal`); after a successful save the deeplink retries automatically. If the *counterparty* is missing it, no modal opens (we cannot fix it for them) — instead the UI shows an inline message and a one-click "Send reminder message" action that posts a templated `kind: 'system'` message in the conversation via `POST /api/conversations/:id/steam-trade-url-reminder`. Both branches share the same `SteamTradeUrlModal` component used on the Profile page.

### Proposal lifecycle
```
draft ──(either participant: POST /mark-completed [first call])──> draft (locked, awaiting other side)
draft ──(either participant: POST /mark-completed [second call])──> completed
draft ──(either participant: POST /mark-completed/reset)──> draft (flags cleared)
draft ──(either participant: POST /cancel)──> cancelled
```
Status transitions are **server-side only**. Clients cannot patch `status` directly. The `disputed` and `in_review` enum values exist in the schema but no handler transitions into them yet (reserved for future moderation workflows).

### Mark-completed → completed transition (server-side)
- Endpoint: `POST /api/proposals/:id/mark-completed`. Auth required, must be a participant, only allowed while status = `draft`. Idempotent per user — a second call from the same user is a no-op that returns the current row.
- The first call sets the caller's `creator_marked_completed` or `recipient_marked_completed` to `true`. Status stays `draft`. The proposal is **locked** from this point forward (no item edits, no offer changes, no AI review).
- The second call (from the *other* participant) sets the second flag to `true`, flips status to `completed`, and stamps `completed_at`.
- Activity log writes `marked_completed` per user and `trade_completed` on the second mark.
- `POST /api/proposals/:id/mark-completed/reset` clears both flags while still in `draft`. Once status is `completed`, only an admin can reset (admin route TBD).
- Realtime: clients subscribe to `trade_proposals` row updates and re-fetch on change. No separate broadcast.

### Items immutability
- Items can be added (`POST /api/proposals/:id/items`) or removed (`DELETE /api/proposals/:id/items/:itemId`) only when proposal status = `draft` **and** neither user has marked completed.
- Item editing in place is **not supported** (per decision D9).
- A user can only remove their own items.
- Once status leaves `draft` or anyone marks completed, items are locked for audit integrity.

### Offers → proposals
- An offer is a *pull* request: "I'd like these items from you, here are mine in exchange."
- DB-level constraint: at most one *pending* offer per `(conversation_id, from_user_id, to_user_id)` direction. A counter-offer goes the other direction so it doesn't collide.
- Accepting an offer (`POST /api/offers/:id/accept`) creates a `trade_proposals` row with both sides' items already populated and links it back via `resulting_proposal_id`.

### Auth & Roles
- Only auth path: `GET /api/auth/steam` → Steam OpenID redirect → `GET /api/auth/steam/callback` → server creates/updates the Supabase user and issues a session.
- Every `/api/*` route except `/api/auth/steam*` and `/health` requires a Supabase JWT in `Authorization: Bearer <token>`.
- Admin role is a `boolean` column `profiles.is_admin`, set **only** by the `scripts/makeAdmin.ts` script. There is no API path that mutates `is_admin` outside of `PATCH /api/admin/users/:id`, which itself is gated by `requireAdmin`. Self-promotion is impossible by construction.

### Sensitive fields on `profiles` (encryption pattern)
Any new sensitive value attached to a profile follows the same shape as `steam_webapi_token_secret_id`:
- The column on `profiles` is a `uuid` pointer into `vault.secrets`, **never** plaintext.
- A pair of `SECURITY DEFINER` SQL functions (`set_<field>` / `clear_<field>`) wrap `vault.create_secret` and `delete from vault.secrets`, so the application code only sees the pointer round-trip.
- Endpoints expose the derived presence boolean (e.g. `has_steam_webapi_token`) — the plaintext is only decrypted server-side, on demand, via `select decrypted_secret from vault.decrypted_secrets where id = ...`.
- Never return the plaintext (or the secret_id directly when avoidable) in any GET response.

### Trader directory
- `trader_profiles` is opt-in. A row is auto-created on first call to `GET /api/traders/me/profile`.
- `is_public = true` and `accepting_trades = true` make a profile appear in `GET /api/traders`.
- Public profile lookup at `GET /api/traders/:userId` does not require auth.

### Inventories
- `GET /api/me/inventory` returns the caller's own inventory, cached ~5 min.
- `GET /api/inventory/by-user/:user_id` returns another user's inventory; respects Steam privacy (`is_private` flag in cache).

### Market prices (advisory only)
- `GET /api/market/price?name=…` returns Steam Community Market lowest/median/volume.
- Source (`steam_community_market`) and `fetched_at` are **always** returned to the client and shown in the UI.
- Price is **never** a gate on submission. Per decision: price hints inform, never block. Users can submit lopsided trades with no warning beyond the AI safety review (which they have to opt into).

### AI Safety Review
- `POST /api/proposals/:id/ai-review` runs an OpenAI-based heuristic safety check.
- Per-user cap: 10 calls/min (custom limiter on the route).
- Per-`(proposal, user)` cap: 3 calls per 24h (DB-based, returns 429).
- Review must be on a proposal in `draft` or `ready_to_verify`.
- Latest review wins on the proposal (`trade_proposals.ai_review_id` is overwritten).

## Middleware (Express, in `apps/server/src/middleware/`)

| # | Name | File | Wired in `index.ts` |
|---|---|---|---|
| 1 | `authenticate` | `authenticate.ts` | per-router via `router.use(authenticate)`; verifies Supabase JWT |
| 2 | `requireAdmin` | `requireAdmin.ts` | applied only on `/api/admin` router after `authenticate` |
| 3 | `validate(schema)` | `validate.ts` | per-handler before each mutation |
| 4 | `errorHandler` | `errorHandler.ts` | last; logs and returns `{ error: 'Internal server error' }` |
| 5 | `notFound` | `notFound.ts` | second-to-last; 404 JSON |
| 6 | `defaultLimiter` | `rateLimiter.ts` | global, **300 req/min per IP**. The Steam OpenID redirect router is mounted *before* the limiter so callback redirects don't share the API budget. |

### `authLimiter`
A separate `authLimiter` (10 req / 15 min) is exported from `rateLimiter.ts` for future use; not currently mounted.

### Custom per-route limiters
- `aiReviewLimiter` in `routes/proposals.ts`: 10 req/min keyed by `req.user.id`, layered on top of the global IP limiter.

## API Routes (`/api` prefix, no version)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health` | no | Liveness |
| GET | `/api/auth/steam` | no | OpenID redirect |
| GET | `/api/auth/steam/callback` | no | OpenID return; creates Supabase user + session |
| POST | `/api/auth/profile` | yes | Upsert `profiles.username` |
| GET | `/api/auth/me` | yes | Own profile |
| GET | `/api/me/inventory` | yes | Own Steam inventory (cached) |
| GET | `/api/inventory/by-user/:user_id` | yes | Another user's inventory |
| GET | `/api/traders` | yes | List public, accepting traders |
| GET | `/api/traders/me/profile` | yes | Get/auto-create own trader profile |
| PATCH | `/api/traders/me/profile` | yes | Update display_name/bio/accepting/public |
| PATCH | `/api/traders/me/steam-trade-url` | yes | Update `steam_trade_url` and/or the encrypted Steam WebAPI token. Token is validated by pinging Steam; on token failure the URL still saves and the response includes a `tokenError` field. |
| DELETE | `/api/traders/me/steam-trade-url` | yes | Clear both `steam_trade_url` and the encrypted token in one shot. |
| GET | `/api/traders/:userId` | no | Public trader lookup |
| POST | `/api/conversations` | yes | Find-or-create with another user |
| GET | `/api/conversations` | yes | List own conversations |
| GET | `/api/conversations/:id` | yes | Conversation + last 50 messages |
| GET | `/api/conversations/:id/messages` | yes | Paginated history |
| POST | `/api/conversations/:id/messages` | yes | Send message |
| POST | `/api/conversations/:id/read` | yes | Mark read |
| POST | `/api/conversations/:id/steam-trade-url-reminder` | yes | Posts a templated `kind: 'system'` message asking the counterparty to add their Steam trade URL. Used by the Send-on-Steam gate. |
| POST | `/api/proposals` | yes | Create draft proposal in a conversation |
| GET | `/api/proposals/me` | yes | List own (creator OR recipient), optional `?status=` |
| GET | `/api/proposals/:id` | yes | Full proposal + items + AI review + counterparty Steam trade URLs |
| DELETE | `/api/proposals/:id` | yes | Cancel a draft (creator only) |
| POST | `/api/proposals/:id/items` | yes | Add item (draft + neither side marked) |
| DELETE | `/api/proposals/:id/items/:itemId` | yes | Remove own item (draft + neither side marked) |
| POST | `/api/proposals/:id/mark-completed` | yes | Per-user mark; second call flips to `completed` |
| POST | `/api/proposals/:id/mark-completed/reset` | yes | Clear both flags while still `draft` |
| POST | `/api/proposals/:id/cancel` | yes | `draft` → `cancelled` |
| POST | `/api/proposals/:id/review` | yes | Rate counterparty after `completed` |
| POST | `/api/proposals/:id/ai-review` | yes | Run AI safety review (rate-limited) |
| GET | `/api/proposals/:id/activity` | yes | Activity log (participants or admin) |
| POST | `/api/offers` | yes | Create pending offer |
| GET | `/api/offers/inbound/pending` | yes | Offers awaiting current user |
| GET | `/api/offers/by-conversation/:id` | yes | All offers in a thread |
| GET | `/api/offers/:id` | yes | Single offer (participants only) |
| POST | `/api/offers/:id/withdraw` | yes | Withdraw pending (sender only) |
| POST | `/api/offers/:id/reject` | yes | Reject pending (recipient only) |
| POST | `/api/offers/:id/accept` | yes | Accept → creates proposal + items |
| POST | `/api/offers/:id/counter` | yes | Counter-offer (flips parent to `countered`) |
| POST | `/api/reports` | yes | File report (optional `subject_user_id`/`proposal_id`/`conversation_id`) |
| GET | `/api/market/price` | yes | Steam market price for an item name |
| GET | `/api/admin/proposals` | yes (admin) | All proposals, filterable |
| GET | `/api/admin/reports` | yes (admin) | All reports |
| POST | `/api/admin/reports/:id` | yes (admin) | Resolve/dismiss |
| PATCH | `/api/admin/users/:id` | yes (admin) | Toggle `is_admin` |

## Frontend Routes

| Route | Page | Auth |
|---|---|---|
| `/` | `LandingPage` | no |
| `/login` | `LoginPage` | no |
| `/register` | `RegisterPage` | no |
| `/auth/callback` | `AuthCallbackPage` | no |
| `/onboarding` | `OnboardingPage` | yes |
| `/dashboard` | `MyTradesPage` (alias of `/proposals`) | yes |
| `/profile/edit` | `EditProfilePage` | yes |
| `/traders` | `FindTradersPage` | yes |
| `/traders/:userId` | `TraderProfilePage` | yes |
| `/messages` | `MessagesPage` | yes |
| `/messages/:id` | `MessagesPage` | yes |
| `/messages/:conversationId/propose` | `ProposeTradePage` | yes |
| `/proposals` | `MyTradesPage` | yes |
| `/proposals/:id` | `TradeProposalPage` | yes |
| `/admin` | `AdminDashboardPage` | yes (admin only) |

The admin gate is implemented in `apps/web/src/components/ProtectedRoute.tsx` with `<ProtectedRoute adminOnly>`. Non-admins are redirected to `/dashboard`.

## Design System

- **Background**: `#0d0f14` | **Card**: `#161a23` | **Border**: `#252a35`
- **Accent (trust/positive)**: emerald `#10b981`
- **Warning**: amber `#f59e0b`
- **Danger**: red `#ef4444`
- **Typography**: Inter or Geist
- **Cards**: subtle border, slight glow on hover

### UI Rules (load-bearing — do not remove)
- Verification code displayed in large monospace font with copy button (`apps/web/src/components/VerificationCode.tsx`)
- Non-dismissible scam warning banner on every trade proposal page (`apps/web/src/components/ScamWarningBanner.tsx`)
- Trust bar everywhere: *"We don't hold your skins. We don't use bots. Steam trades happen directly between you."* (`apps/web/src/components/TrustBar.tsx`)
- Warning language must be explicit: *"Do not accept this trade."* *"The code does not match."* Never vague: *"Something went wrong."*
- Price hints must always show source (`steam_community_market`) and `fetched_at` next to the number; copy must include the word "advisory."

## Hard Constraints — Do Not Build

- No Steam bot flows. We never automate trade actions on the user's behalf.
- No payment processing.
- No skin custody or escrow.
- Price hints are advisory only; never gate trade submission. Always disclose source and freshness.
- No gambling mechanics or randomized rewards.
- No "guaranteed safe trade" language anywhere in the UI.
- No official Valve/Steam affiliation claims; explicit disclaimer wherever Steam is mentioned.

## Testing

Tests use Vitest. The server uses a **stub-based** pattern (no real Supabase test project required): `vi.doMock` replaces `apps/server/src/lib/supabase` with a stub that returns canned responses, and the `authenticate` middleware is stubbed to inject a fake `req.user`. Supertest fires requests at the router mounted on a fresh Express instance per test.

- **Server tests** at `apps/server/tests/`. Helpers in `apps/server/tests/helpers/`.
  - `mockSupabase.ts` — chainable stub that records calls and returns FIFO-pushed responses.
  - `mockOpenAI.ts` — replaces `runAiSafetyReview` for AI route tests.
  - `mountRouter.ts` — boilerplate for `vi.doMock` + `supertest(app)`.
  - Run: `pnpm --filter @skinpeer/server test`.
- **Client tests** at `apps/web/src/**/*.test.tsx`, plus shared helper at `apps/web/src/test/renderWithProviders.tsx`. Vitest + React Testing Library + jsdom. Run: `pnpm --filter @skinpeer/web test`.
- **E2E** at `tests/e2e/`. Playwright drives the web app with the API base URL pointed at a mocked-server harness. Run: `pnpm test:e2e`.

Coverage targets: ≥80% on `apps/server/src/services/` and `apps/server/src/middleware/`. No coverage gate on UI; Playwright covers user-facing behavior.

CI runs typecheck + Vitest on every push and Playwright on PRs to `main`. See `.github/workflows/ci.yml`.

## Reconciliation Decisions (recorded 2026-05-01)

These are the policy decisions that drove the rewrite of this file. They are recorded so future code review can check whether a change drifts away from them.

| Decision | Choice | Rationale |
|---|---|---|
| D1 — Canonical product | Trader-network is canonical | Reflects shipped reality |
| D2 — Auth | Steam OpenID only | Right primitive for a CS2 product |
| D3 — API prefix | `/api` (no version) | No external consumers; premature |
| D4 — Rate limit | 300/min/IP | Code wins; doc was understated |
| D5 — Verification code format | 6-char nanoid | Already shipped; switching would invalidate existing codes |
| D6 — Locking + Realtime broadcast on both-ready | Dropped | Not load-bearing now that proposals are conversation-bound |
| D7 — Invite flow | Dropped | Discovery happens via traders directory + conversations |
| D8 — Reset endpoint | Dropped | `cancel` + recreate is sufficient |
| D9 — Item editing | Dropped | Add + remove only; immutable post-draft |
| D10 — `disputed` and `in_review` statuses | Schema only, no handlers wired | Reserves the values for future moderation workflows |
| D11 — AI safety review tests | Yes, with mocked OpenAI | Real product surface |

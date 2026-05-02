# SkinPeer Source-of-Truth Audit

**Date:** 2026-05-01
**Source of truth (per CLAUDE.md):** the documented MVP spec
**Method:** read-only cross-reference of every CLAUDE.md claim against actual code in `apps/`, `packages/`, `supabase/`
**Scope:** Phase 1 only — no code changes made.

---

## Executive Summary

CLAUDE.md describes a **trade-rooms MVP** (creator + counterparty share an invite code, both fill a 4-checkbox confirmation, the room locks). The actual codebase has been refactored into a **trader-network platform** (public trader directory, persistent conversations, proposals, offers, AI safety reviews, Steam OpenID auth, inventory caching, market price hints).

The two are not the same product. Almost every section of CLAUDE.md is outdated. Hard constraints and trust-bar copy are intact and compliant; everything implementation-shaped (routes, schema, auth strategy, table names, code generator format) has drifted.

**Reconciliation question for Phase 2 to proceed:** which side is canonical?

- **(A) Code is canonical.** CLAUDE.md must be rewritten to describe the trader-network platform. Tests are written against `trade_proposals`, `conversations`, `offers`, Steam OpenID, etc. This appears to be reality on the ground.
- **(B) CLAUDE.md is canonical.** The trader-network refactor is reverted or de-scoped, and tests are written against the documented MVP. Almost certainly not what you want, given the volume of merged work.
- **(C) Hybrid.** Update CLAUDE.md to describe the current platform but preserve the original trust/safety contract (verification code, scam warning, no escrow). Most likely the right call.

I recommend **(C)** but I'm not making that call. Phase 2 stays blocked on your decision.

---

## 1. Aligned (code matches CLAUDE.md)

### Tech stack — mostly aligned
- React 18 + Vite 5 + TypeScript 5 + Tailwind 3 (`apps/web`)
- Express 4 + Node + TypeScript (`apps/server`)
- Supabase (`@supabase/supabase-js` 2.43)
- Zod 3 for validation
- `express-rate-limit` for rate limiting
- TypeScript build via `tsc`; client build via Vite

### Middleware — all five exist
| # | Documented | File | Wired? |
|---|---|---|---|
| 1 | Supabase JWT auth | `apps/server/src/middleware/authenticate.ts` | yes, per-route |
| 2 | `requireAdmin` | `apps/server/src/middleware/requireAdmin.ts` | yes, on `/api/admin/*` |
| 3 | Zod validation | `apps/server/src/middleware/validate.ts` | yes, per-handler |
| 4 | Global error handler | `apps/server/src/middleware/errorHandler.ts` | yes, last in `index.ts` |
| 5 | Rate limiter | `apps/server/src/middleware/rateLimiter.ts` | yes, global |

### Hard constraints — fully compliant
Every "Do Not Build" item passes a grep audit:
- No Steam bot calls. Every "bot" mention is a *negation* in user-facing copy.
- No payment processing (no Stripe, no checkout, no subscription code).
- No escrow code. Every "escrow" mention is a *negation*.
- No gambling/spin/roulette/case-opening mechanics.
- No "guaranteed safe" language anywhere in UI.
- No claims of Valve/Steam affiliation; explicit disclaimers present.

### UI safety contract — intact
- Verification code displayed in monospace with copy button: `apps/web/src/components/VerificationCode.tsx`
- Non-dismissible scam warning banner: `apps/web/src/components/ScamWarningBanner.tsx`, mounted on `TradeProposalPage`
- Trust bar copy verbatim: `apps/web/src/components/TrustBar.tsx` — `"We don't hold your skins. We don't use bots. Steam trades happen directly between you."`

### Business rules — partially aligned
- Verification code uniqueness check + max 5 retries: `apps/server/src/services/proposalCodeService.ts`
- Server-side ready computation (server reads checklist; client cannot just send `ready=true`): `apps/server/src/routes/proposals.ts`
- Admin promotion is script-only; no self-promotion route is exposed. `PATCH /api/admin/users/:id` is gated by `requireAdmin`. Verified: no other route mutates `is_admin` / `role`.
- `makeAdmin` script exists (different path — see Drift).

---

## 2. Drift (code differs from CLAUDE.md — flagged with which side appears correct)

### 2.1 Monorepo layout
- **Doc:** `/client` and `/server` flat, npm.
- **Code:** pnpm workspaces — `apps/web`, `apps/server`, `packages/shared` — orchestrated by Turborepo.
- **Likely correct side:** code. Workspace layout is a deliberate choice; docs are stale.

### 2.2 Dev commands & ports
- **Doc:** `cd client && npm run dev` (5173), `cd server && npm run dev` (3001).
- **Code:** `pnpm dev` (root) or `pnpm --filter @skinpeer/web dev` / `pnpm --filter @skinpeer/server dev`. Server `PORT=4000` per `apps/server/.env.example`.
- **Likely correct side:** code.

### 2.3 `makeAdmin` script location
- **Doc:** `server/src/scripts/makeAdmin.ts`.
- **Code:** `scripts/makeAdmin.ts` at repo root. Invoked via `pnpm make-admin`.
- **Likely correct side:** code; doc just needs the path updated.

### 2.4 API prefix
- **Doc:** all routes under `/api/v1`.
- **Code:** all routes under `/api`. No versioning implemented.
- **Likely correct side:** ambiguous — need a call. If versioning was a real plan, the code drifted; if it was aspirational, the doc drifted.

### 2.5 Auth strategy
- **Doc:** Supabase email/password (`POST /auth/signup`, `/auth/login`, `/auth/logout`), Steam OpenID stub for later.
- **Code:** Steam OpenID is the **only** auth path. Routes: `GET /api/auth/steam`, `GET /api/auth/steam/callback`. There is no signup/login/logout endpoint, no email/password flow.
- **Likely correct side:** code (Steam OpenID is the right primitive for a CS2 product). Doc is materially wrong.

### 2.6 Rate limiter cap
- **Doc:** 60 req/min per IP.
- **Code:** **300** req/min per IP, in `apps/server/src/middleware/rateLimiter.ts`.
- **Likely correct side:** unclear. Pick a number; CI tests will assert it.

### 2.7 Verification code format
- **Doc:** `WORD-####-WORD` from a curated ~200-word uppercase 4–7 letter wordlist.
- **Code:** 6-character `nanoid` from a 32-char alphabet that excludes 0/O/I/1. No wordlist exists. Source: `apps/server/src/services/proposalCodeService.ts`.
- **Likely correct side:** code is shipping; doc is the original product spec. The doc's format is more memorable for a Steam mobile confirmation, which is the whole point of the code — this might actually be a regression worth restoring rather than re-documenting.

### 2.8 Database schema — major refactor not reflected in docs
The docs describe 7 (well, 6) tables. The DB has gone through three migrations after the initial one and now has ~14 tables. Three of the originally-documented tables were **dropped**.

| Documented table | Status in current schema |
|---|---|
| `users` | does not exist; user data lives in `profiles` (mirrors `auth.users`) |
| `trade_rooms` | **dropped** in `003_trader_network.sql`; replaced by `trade_proposals` |
| `trade_items` | exists but FK changed from `trade_room_id` → `proposal_id`; columns drifted |
| `trade_confirmations` | **dropped**; replaced by `trade_checklist_items` (different shape) |
| `trade_activity_logs` | **dropped**; replaced by `trade_activity_log` (singular) |
| `reports` | exists, but `room_id` FK → `proposal_id` + adds `subject_user_id`, `conversation_id` |

The `users.role` enum is replaced by `profiles.is_admin` (boolean).

The `trade_rooms.status` enum (`draft|waiting|in_review|ready|completed|cancelled|disputed`) is replaced by a `trade_proposals` status (`draft|ready_to_verify|completed|cancelled` based on route handlers).

The `locked` boolean is gone; locking is implicit in the proposal status transition.

**Likely correct side:** code. The trader-network refactor is real and shipped.

### 2.9 Confirmation flow
- **Doc:** `PATCH /api/v1/trade-rooms/:id/confirmation` with four booleans (`confirmed_profile`, `confirmed_items`, `confirmed_code`, `confirmed_mobile`); `ready` set server-side; both-ready → `status=ready`, `locked=true`, log, realtime broadcast.
- **Code:** `POST /api/proposals/:id/checklist` toggles individual checklist items. Both-ready → `status=ready_to_verify`. **No `locked` field is set. No realtime broadcast is visible in this handler.** Activity is logged.
- **Likely correct side:** code shipped; doc is more rigorous on the safety contract (locking + broadcast). Worth restoring those guarantees.

### 2.10 Status enum
- **Doc:** `draft | waiting | in_review | ready | completed | cancelled | disputed`
- **Code (proposals):** `draft | ready_to_verify | completed | cancelled`
- **Likely correct side:** code; doc has more states than implemented. `disputed` and `in_review` may have been intentionally dropped during refactor.

### 2.11 Reports table shape
- **Doc:** `id, trade_room_id, reporter_id, reason, notes, status (pending|reviewed|dismissed)`.
- **Code:** `id, reporter_id, reason, status (open|resolved|dismissed), subject_user_id, proposal_id, conversation_id, resolution_notes, resolved_by, resolved_at`. Status enum values differ.
- **Likely correct side:** code.

### 2.12 Frontend routes
- **Doc:** `/`, `/signup`, `/login`, `/dashboard`, `/trade/new`, `/trade/:id`, `/join/:invite_code`, `/admin`, `/admin/trade/:id`.
- **Code:** `/`, `/login`, `/register` (NOT `/signup`), `/auth/callback`, `/onboarding`, `/dashboard` (alias for `/proposals` via `MyTradesPage`), `/profile/edit`, `/traders`, `/traders/:userId`, `/messages`, `/messages/:id`, `/messages/:conversationId/propose`, `/proposals`, `/proposals/:id`, `/admin`, `/admin/trade/:id`.
- Drift: `/signup` → `/register`; `/trade/new` removed (creation happens inside a conversation); `/trade/:id` → `/proposals/:id`; `/join/:invite_code` does not exist (no invite flow exists in code at all).
- **Likely correct side:** code.

### 2.13 PORT mismatch
- **Doc:** `PORT=3001`. **Code:** `PORT=4000` in `apps/server/.env.example`.

---

## 3. Missing (documented but not implemented — or implemented but not documented)

### 3.1 Documented but NOT implemented

| Feature | Doc reference | Status |
|---|---|---|
| Email/password auth (`/auth/signup`, `/auth/login`, `/auth/logout`) | API table | not built — Steam OpenID is the only path |
| Resend email delivery | tech stack table | not installed in `apps/server/package.json`; no Resend client; no invite email |
| Invite flow + invite codes | "Invite Flow" section | not built — no `invite_code` field, no `/join/:invite_code` routes (server or client), no single-use enforcement |
| Reset endpoint (`POST /trade-rooms/:id/reset`) | API table | not built — proposals can only be cancelled, not reset |
| Item editing (`PATCH /items/:itemId`) | API table | not built |
| Locked-room 403 enforcement on item edits | "Room Locking" section | no `locked` field is set anywhere |
| Realtime broadcast on both-ready transition | "Confirmation → Ready" section | not visible in checklist handler |
| `/trade-rooms/:id/status` PATCH for completed/cancelled | API table | partially — separate `/complete` and `/cancel` POSTs exist on proposals |
| `/trade-rooms/:id/report` POST | API table | replaced by global `POST /api/reports` |
| WORD-####-WORD verification code format | "Verification Code" section | not built — generator returns 6-char nanoid |
| Wordlist of ~200 curated words | "Verification Code" section | does not exist |

### 3.2 Implemented but NOT documented

**API routes:**
- `GET /api/auth/steam`, `GET /api/auth/steam/callback`
- `POST /api/auth/profile`, `GET /api/auth/me`
- `GET /api/me/inventory`, `GET /api/inventory/by-user/:user_id`
- `GET /api/traders`, `GET /api/traders/me/profile`, `PATCH /api/traders/me/profile`, `GET /api/traders/:userId`
- `POST /api/conversations`, `GET /api/conversations`, `GET /api/conversations/:id`, `GET /api/conversations/:id/messages`, `POST /api/conversations/:id/messages`, `POST /api/conversations/:id/read`
- `POST /api/proposals`, `GET /api/proposals/me`, `GET /api/proposals/:id`, `DELETE /api/proposals/:id`, `POST /api/proposals/:id/items`, `DELETE /api/proposals/:id/items/:itemId`, `GET /api/proposals/:id/activity`, `POST /api/proposals/:id/checklist`, `POST /api/proposals/:id/complete`, `POST /api/proposals/:id/cancel`, `POST /api/proposals/:id/review`, `POST /api/proposals/:id/ai-review`
- `POST /api/offers`, `GET /api/offers/inbound/pending`, `GET /api/offers/by-conversation/:id`, `GET /api/offers/:id`, `POST /api/offers/:id/withdraw`, `POST /api/offers/:id/reject`, `POST /api/offers/:id/accept`, `POST /api/offers/:id/counter`
- `POST /api/reports`
- `GET /api/market/price`
- `GET /api/admin/proposals`, `GET /api/admin/reports`, `POST /api/admin/reports/:id`, `PATCH /api/admin/users/:id`

**Frontend routes:**
- `/register`, `/auth/callback`, `/onboarding`, `/profile/edit`, `/traders`, `/traders/:userId`, `/messages`, `/messages/:id`, `/messages/:conversationId/propose`, `/proposals`, `/proposals/:id`

**Database tables (post-refactor, not documented):**
- `profiles` (the actual user table)
- `steam_inventories`, `steam_inventory_cache`, `steam_market_prices`
- `trader_profiles`
- `conversations`, `messages`
- `trade_proposals`, `trade_checklist_items`, `trade_activity_log`
- `trade_offers`
- `ai_safety_reviews`
- `reviews` (post-trade rating + comment)

**Dependencies (not in CLAUDE.md tech stack):**
- Server: `openai` (AI safety review), `nanoid`, `cors`, `vitest`
- Client: `@tanstack/react-query`, `react-router-dom` (router was implied), `react-hot-toast`/similar (verify)
- Root: `concurrently`, `turbo`

**Env vars (in `.env.example` but not in CLAUDE.md):**
- `STEAM_API_KEY`, `STEAM_RETURN_URL`, `STEAM_REALM`
- `OPENAI_API_KEY`, `OPENAI_MODEL`
- `FRONTEND_URL` (likely a duplicate of `CLIENT_URL`)
- `VITE_API_URL` (client)

**Env vars in CLAUDE.md but missing from `.env.example`:**
- `RESEND_API_KEY` — no Resend integration exists, so this is documentation-only

---

## 4. Reconciliation Decisions Required Before Phase 2

Tests must be written against a known-correct target. Each item below changes the test surface materially. Please pick a side for each:

| # | Decision | Options |
|---|---|---|
| D1 | Is the trader-network refactor (proposals + conversations + offers) the canonical product? | **(a) yes — rewrite CLAUDE.md** / (b) no — revert to trade-rooms MVP / (c) hybrid |
| D2 | Auth strategy | (a) Steam OpenID only (current) / (b) add email/password back / (c) both |
| D3 | API prefix | (a) keep `/api` / (b) move to `/api/v1` |
| D4 | Rate limit cap | (a) 60/min (doc) / (b) 300/min (code) / (c) other |
| D5 | Verification code format | (a) keep 6-char nanoid / (b) restore WORD-####-WORD spec |
| D6 | Locking + realtime broadcast on both-ready | (a) restore as documented / (b) drop the requirement |
| D7 | Invite flow (invite codes, single-use, /join routes, Resend email) | (a) build it / (b) drop it from spec — discovery happens via traders directory + conversations |
| D8 | Reset endpoint to clear confirmations | (a) implement on proposals / (b) drop |
| D9 | Item editing (`PATCH /items/:itemId`) | (a) implement / (b) drop |
| D10 | Are `disputed` and `in_review` proposal statuses still in scope? | (a) add back / (b) drop |
| D11 | Should tests cover the AI safety review endpoint and OpenAI dependency? | (a) yes / (b) mock-only / (c) skip |

Once these are answered I'll write a Phase 2 test plan tailored to the reconciled state and then build it.

---

## 5. What Phase 2 Will Look Like (sketch — pending D1–D11)

If decisions land on the obvious **(C) hybrid → code is canonical, doc gets rewritten** path:

- **Server unit tests (Vitest)** — `proposalCodeService` (uniqueness + retry), `marketPrice` source/freshness, checklist→ready transition logic, role-gating helper, rate-limiter config.
- **Server integration tests (Vitest + Supertest)** against a dedicated test Supabase project — every implemented route × {happy path, 401 without JWT, 400 on bad Zod input, 403 on wrong role / wrong participant, locked-state behavior if D6=a}.
- **Client unit tests (Vitest + React Testing Library)** — `AuthContext`, `PriceContext`, `VerificationCode` (copy button), `ScamWarningBanner`, `TrustBar`, checklist component, proposal status reducer.
- **Playwright E2E** — Steam OpenID flow (mocked), trader directory → start conversation → propose → both checklist all → ready_to_verify → complete; offer accept → proposal creation; admin gating.
- **Mocks:** OpenAI (always), Steam Web API (always), Resend (only if D7=a).
- **CI:** GitHub Actions; secrets in repo settings; coverage gate ≥80% on `apps/server/src/services/` and `apps/server/src/middleware/`.
- **Fixtures:** `apps/server/src/test/factories.ts`, `apps/server/src/test/supabaseTestClient.ts`, `apps/web/src/test/renderWithProviders.tsx`.

Out of scope (per your brief): load testing, visual regression, tests for unbuilt features.

---

*End of Phase 1 audit. Phase 2 awaits decisions D1–D11.*

# SkinPeer — Requirements Specification

This document is the authoritative requirements record for the SkinPeer system as it currently exists in code (post trader-network refactor, 2026-05-01). Where `CLAUDE.md` and the original `architecture.md` describe the earlier "trade room" MVP, **this document supersedes them**.

---

## 1. Product Goal

SkinPeer is a peer-to-peer **trade coordination layer** for CS2 (Counter-Strike 2) skin trades. It does **not** custody skins, run bots, process payments, or facilitate the Steam trade itself. Its single job is to give two real users enough verifiable, structured context to safely complete a Steam-to-Steam trade — using a shared verification code that must appear in the Steam mobile confirmation prompt.

---

## 2. Functional Requirements

### 2.1 Authentication (`apps/server/src/routes/steam.ts`, `routes/auth.ts`)

- **FR-AUTH-1** Users authenticate via **Steam OpenID 2.0** only. Email/password is not supported.
- **FR-AUTH-2** First-time login provisions a Supabase Auth user keyed to a synthetic email `{steamid64}@steam.skinpeer.gg`; the email is never used for delivery.
- **FR-AUTH-3** Login must populate `profiles.steam_id`, `profiles.steam_persona`, and `profiles.steam_avatar` from `GetPlayerSummaries v2`.
- **FR-AUTH-4** A magic-link token is minted server-side and exchanged on the frontend `/auth/callback` page; the user lands on `/dashboard` on success.
- **FR-AUTH-5** All `/api/*` routes except `/api/auth/steam` and `/api/auth/steam/callback` require a valid Supabase JWT (`Authorization: Bearer ...`).
- **FR-AUTH-6** Admin role is set manually via `profiles.is_admin = true` (no self-promotion path).

### 2.2 Trader Directory (`routes/traders.ts`, `trader_profiles` table)

- **FR-DIR-1** Each user can opt into the public trader directory by setting `is_public = true` on their `trader_profiles` row.
- **FR-DIR-2** A user can mark themselves `accepting_trades = false` to hide from search without deleting the row.
- **FR-DIR-3** `GET /api/traders` returns directory entries filtered to `is_public AND accepting_trades`, sortable by `recent | rating | trades`, paginated up to 50/req.
- **FR-DIR-4** `GET /api/traders/me/profile` auto-creates the row on first read, seeded with `display_name = profiles.steam_persona`.
- **FR-DIR-5** `PATCH /api/traders/me/profile` updates `display_name`, `bio`, `trade_preferences`, `accepting_trades`, `is_public`.

### 2.3 Conversations & Messages (`routes/conversations.ts`)

- **FR-MSG-1** A conversation is uniquely identified by an unordered pair `(user_a_id, user_b_id)`. Starting a conversation is idempotent — the second invocation returns the same row.
- **FR-MSG-2** Only the two participants can read or write a conversation; admins are not auto-added.
- **FR-MSG-3** Message body is 1–2000 characters; messages are append-only (no edit, no delete).
- **FR-MSG-4** `GET /api/conversations/:id/messages?before=<iso>&limit=50` returns the most recent page first, supports cursor pagination via `before`.
- **FR-MSG-5** Real-time message delivery uses Supabase Realtime on the `messages` table; RLS restricts the replication stream to participants.

### 2.4 Trade Proposals (`routes/proposals.ts`, `services/proposalCodeService.ts`)

- **FR-TP-1** A trade proposal lives inside a conversation; it has one `creator_id` and one `recipient_id` (both must be conversation participants).
- **FR-TP-2** On creation the server generates a **6-character uppercase alphanumeric verification code** (excluding `0/O/I/1` to reduce confusion); uniqueness is enforced via `trade_proposals.verification_code UNIQUE` with retry-on-collision.
- **FR-TP-3** A `system` message of `kind = 'trade_proposal_link'` is inserted into the conversation referencing the new proposal.
- **FR-TP-4** Items are added per side via `POST /api/proposals/:id/items`; either participant can add to their own side; creator-side items belong to `creator_id`, recipient-side to `recipient_id`.
- **FR-TP-5** A proposal in `draft` status accepts item add/remove. A proposal in `ready_to_verify`, `completed`, `cancelled`, or `disputed` is item-locked.
- **FR-TP-6** Either participant can cancel a proposal in `draft` or `ready_to_verify` via `POST /api/proposals/:id/cancel`.

### 2.5 Safety Checklist & Status Transitions (`trade_checklist_items` table, `proposals.ts`)

- **FR-CK-1** Six checklist keys exist per (proposal, user): `verified_steam_id`, `verified_items`, `verified_floats`, `checked_stickers`, `no_off_platform_payment`, `understand_self_serve`.
- **FR-CK-2** A user toggles a key via `POST /api/proposals/:id/checklist` with `{ checklist_key, is_checked }`.
- **FR-CK-3** When **both** participants have all six keys checked, the server flips the proposal status from `draft` to `ready_to_verify` and emits a `trade_activity_log` row (`action = 'proposal_ready'`).
- **FR-CK-4** A proposal in `ready_to_verify` can be marked `completed` via `POST /api/proposals/:id/complete` (either participant). On completion, the trigger `increment_total_trades_on_completion` increments `trader_profiles.total_trades` for both users.
- **FR-CK-5** The status transition is server-authoritative; the client cannot set `ready_to_verify` directly.

### 2.6 AI Safety Review (`lib/anthropic.ts`, `proposals.ts`)

- **FR-AI-1** Either participant can request an AI safety review via `POST /api/proposals/:id/ai-review`, rate-limited to 3 requests per `(proposal, user)` per 24 h.
- **FR-AI-2** The review uses **Anthropic Claude Haiku 4.5** (`claude-haiku-4-5-20251001`); the model identifier lives in `schemas/traderNetwork.ts` as `AI_SAFETY_REVIEW_MODEL`.
- **FR-AI-3** Server builds the prompt from server-side data only (display names, trade history, items, recent messages, prior reports) — user-supplied prose is never injected verbatim.
- **FR-AI-4** Output is validated against `AiReviewResponseSchema` (risk_level enum, warnings, recommended_actions). Malformed output → one retry → `502` to client.
- **FR-AI-5** The review is persisted to `ai_safety_reviews` and linked via `trade_proposals.ai_review_id`.
- **FR-AI-6** The system prompt explicitly forbids the model from claiming a trade is "safe" — only "no obvious red flags detected."

### 2.7 Reports & Reviews (`routes/userReports.ts`, `routes/proposals.ts`)

- **FR-RPT-1** Any user can report another user via `POST /api/reports` with `{ subject_user_id, reason, proposal_id?, conversation_id? }`. Reason is 10–2000 chars.
- **FR-RPT-2** A user can leave a 1–5 star review on a counterparty via `POST /api/proposals/:id/review`, exactly once per `(proposal, reviewer)`. The `reviews_recompute_average` trigger updates `trader_profiles.average_rating`.

### 2.8 Admin (`routes/admin.ts`)

- **FR-ADM-1** Admin routes require `requireAdmin` middleware (verifies `profiles.is_admin = true`).
- **FR-ADM-2** Admins can list all proposals, mark reports as resolved/dismissed, and force-cancel proposals.

---

## 3. Non-Functional Requirements

### 3.1 Security

- **NFR-SEC-1** All `/api/*` routes (except OpenID redirect endpoints) require Supabase JWT verification via `middleware/authenticate.ts`.
- **NFR-SEC-2** All request bodies are validated server-side with Zod via `middleware/validate.ts`. The 400 response includes structured `issues`.
- **NFR-SEC-3** RLS is enabled on `conversations`, `messages`, `trade_proposals` (the Realtime-exposed tables). REST routes use the `service_role` key and enforce authorization in code, not via RLS.
- **NFR-SEC-4** Rate limiting: `defaultLimiter` allows 100 req / 15 min / IP; `authLimiter` allows 10 req / 15 min / IP on `/api/auth/*`.
- **NFR-SEC-5** Steam OpenID redirects are mounted **before** the rate limiter so legitimate browser navigation is never throttled.
- **NFR-SEC-6** Secrets (`SUPABASE_SERVICE_ROLE_KEY`, `STEAM_API_KEY`, `ANTHROPIC_API_KEY`) live in `apps/server/.env` only — never shipped to the client.
- **NFR-SEC-7** The frontend uses the Supabase **anon** key for Realtime subscriptions only; reads/writes go through the server.

### 3.2 Performance

- **NFR-PERF-1** Steam inventory fetches are cached per user for 5 minutes in `steam_inventories.fetched_at` to stay within Steam Community API rate limits.
- **NFR-PERF-2** Message history pagination caps at 100 rows per request; default 50.
- **NFR-PERF-3** Trader directory listing caps at 50 rows per request; default 20.
- **NFR-PERF-4** All foreign-key columns and high-traffic filter columns have explicit indexes (see `003_trader_network.sql` — every table has an `*_idx` on its FKs).

### 3.3 Reliability

- **NFR-REL-1** Verification code generation retries up to 5 times on uniqueness collision before throwing.
- **NFR-REL-2** AI safety review retries once on malformed JSON before returning 502 — never returns an unvalidated model response to the client.
- **NFR-REL-3** All write operations are surfaced through the global error handler (`middleware/errorHandler.ts`); no raw stack traces reach the client.

### 3.4 Compliance & Trust

- **NFR-TRUST-1** No copy in the application may use the phrase "guaranteed safe trade", "official Steam partner", or any equivalent. Warning language is explicit ("Do not accept this trade. The code does not match.") not vague.
- **NFR-TRUST-2** The "we don't hold your skins, we don't use bots, Steam trades happen directly between you" trust bar is rendered on every authenticated page.
- **NFR-TRUST-3** No payment processing, no escrow, no skin custody, no gambling mechanics, no randomized rewards.
- **NFR-TRUST-4** No Valve/Steam logos or trademarks beyond the OpenID "Sign in through Steam" affordance permitted by Steam's brand guidelines.

### 3.5 Observability

- **NFR-OBS-1** Every state-changing action writes to `trade_activity_log` with `proposal_id`, `actor_id`, `action`, optional `metadata`. The log is append-only.
- **NFR-OBS-2** Server errors are stamped with ISO timestamps in stdout (`errorHandler.ts`) for log aggregation.

### 3.6 Portability & Build

- **NFR-BUILD-1** The repository is a pnpm workspace monorepo (`apps/web`, `apps/server`, `packages/shared`). `pnpm install` from root must succeed on Windows, macOS, and Linux.
- **NFR-BUILD-2** Both apps must pass `tsc --noEmit` on every commit — that is the project's primary correctness gate (no automated test runner).
- **NFR-BUILD-3** Schema changes are versioned as `supabase/migrations/00X_*.sql` and applied via the Supabase MCP server (not the Supabase CLI).

---

## 4. Constraints

- **C-1** Steam Trade execution itself happens entirely outside SkinPeer. The platform never holds the user's Steam credentials, session, or trade tokens.
- **C-2** No Anthropic models other than `claude-haiku-4-5-20251001` are used for AI safety review without a documented version bump.
- **C-3** The verification code format is fixed: 6 uppercase alphanumeric chars, no `0/O/I/1`. Any change is a breaking UX change.
- **C-4** Pre-launch: no production trade data exists yet; schema migrations may drop and recreate tables (as `003_trader_network.sql` did).

---

## 5. Out of Scope (MVP)

- Steam-bot trade automation
- Payment processing or escrow of any kind
- Skin price oracle / market value lookup
- Mobile native apps (web is responsive only)
- Multi-language UI (English only)
- Email notifications (no Resend integration in current code)
- 2FA on the SkinPeer login itself (Steam OpenID is the auth source)

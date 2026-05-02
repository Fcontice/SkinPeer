# SkinPeer — User Stories

User stories grouped by epic. Each story has acceptance criteria that map to a concrete API route, UI page, or DB constraint already in the codebase. Stories link back to the personas in `PERSONAS.md`.

---

## Epic A — Authentication

**A.1** *As Trader Tom, I want to sign in with my existing Steam account, so that my SkinPeer identity is provably tied to my Steam profile.*
- **Accept:** `GET /api/auth/steam` redirects to Steam OpenID. Callback creates a Supabase user keyed to `{steamid64}@steam.skinpeer.gg`.
- **Accept:** After successful login, `profiles.steam_id`, `steam_persona`, `steam_avatar` are populated.
- **Accept:** Login takes ≤ 5 seconds end-to-end on a normal connection.

**A.2** *As Casey, I want to be sent back into the app and not get stuck on Steam's site, so that I can start trading without confusion.*
- **Accept:** `/auth/callback` page exchanges the magic-link token, then routes to `/dashboard` (or `/login?error=...` on failure with a human-readable error).
- **Accept:** The 6 documented error codes (`steam_failed`, `user_creation_failed`, `session_failed`, `unknown`, etc.) each render a specific copy block.

**A.3** *As Admin Ava, I want my admin status to be set manually, so that no user can self-promote.*
- **Accept:** `requireAdmin` middleware reads `profiles.is_admin` and rejects with 403 if false.
- **Accept:** The only path to becoming admin is direct DB edit via `scripts/makeAdmin.ts`.

---

## Epic B — Trader Directory

**B.1** *As Tom, I want a public profile that shows my trade count and average rating, so that other traders can quickly judge whether to trade with me.*
- **Accept:** `GET /api/traders/:userId` returns `display_name`, `bio`, `total_trades`, `average_rating`, `accepting_trades`, `is_public`.
- **Accept:** Profile is hidden from `/api/traders` listing if `is_public = false` or `accepting_trades = false`.

**B.2** *As Casey, I want to browse traders sorted by rating, so that my first trade is with someone reputable.*
- **Accept:** `GET /api/traders?sort=rating` returns up to 50 entries ordered by `average_rating DESC`.
- **Accept:** Default sort is `recent`; query parameter override is validated by Zod.

**B.3** *As Tom, I want to temporarily mark myself "not accepting trades" without losing my profile, so that I can pause without re-registering later.*
- **Accept:** `PATCH /api/traders/me/profile { accepting_trades: false }` succeeds; subsequent listings exclude Tom; his profile detail page still resolves.

---

## Epic C — Conversations & Messaging

**C.1** *As Casey, I want to message a trader before committing to a trade, so that I can ask questions in a structured place (not Discord DMs where I might be impersonated).*
- **Accept:** `POST /api/conversations { other_user_id }` returns the conversation row (idempotent — returns the existing one if already started).
- **Accept:** Only the two participants see the conversation in `GET /api/conversations`.

**C.2** *As Tom, I want messages to deliver in real time, so that a back-and-forth doesn't require manual refresh.*
- **Accept:** `POST /api/conversations/:id/messages` triggers Realtime broadcast; the other participant's UI updates within 1 second on a normal connection.
- **Accept:** Realtime stream is filtered by RLS policy `messages_select` to participants only.

**C.3** *As Casey, I want long conversations to paginate so that the page doesn't lock up.*
- **Accept:** `GET /api/conversations/:id/messages?before=<iso>&limit=50` returns up to 50 messages older than `before`; default page is most-recent 50.

---

## Epic D — Trade Proposals

**D.1** *As Tom, I want a structured proposal inside the conversation, so that both sides explicitly list their items before opening Steam.*
- **Accept:** `POST /api/proposals { conversation_id }` creates the proposal and inserts a `system` message of `kind = 'trade_proposal_link'` into the conversation.
- **Accept:** The proposal carries a unique 6-char verification code (uppercase alphanumeric, excluding `0/O/I/1`).

**D.2** *As Casey, I want to see the verification code in big monospace type with a copy button, so that I can paste it into the Steam mobile confirmation note without typo risk.*
- **Accept:** Verification code is rendered in a monospace component (`apps/web/src/components/VerificationCode.tsx`) with a copy-to-clipboard affordance.

**D.3** *As Tom, I want to add and remove items from my side of the proposal, so that we can iterate before locking.*
- **Accept:** `POST /api/proposals/:id/items` and `DELETE /api/proposals/:id/items/:itemId` succeed only when proposal status is `draft` and the user owns the item.
- **Accept:** A 400 error with explicit message is returned when attempting to edit items in a non-draft proposal.

**D.4** *As either user, I want to cancel a proposal that's gone stale, so that it doesn't sit around as a half-finished record.*
- **Accept:** `POST /api/proposals/:id/cancel` succeeds for participants when status is `draft` or `ready_to_verify`; flips status to `cancelled` and writes `cancelled_at`.

---

## Epic E — Safety Checklist & Lock

**E.1** *As Casey, I want a checklist that walks me through exactly what to verify, so that I don't forget the boring-but-critical step ("did I actually look at the float value?").*
- **Accept:** Six checklist keys are exposed: `verified_steam_id`, `verified_items`, `verified_floats`, `checked_stickers`, `no_off_platform_payment`, `understand_self_serve`.
- **Accept:** `POST /api/proposals/:id/checklist { checklist_key, is_checked }` upserts the row in `trade_checklist_items`.

**E.2** *As Tom, I want the system to flip the proposal to `ready_to_verify` only when both of us complete the entire checklist, so that we don't open Steam prematurely.*
- **Accept:** Server-side check: when **both** users have all six keys checked, status flips from `draft` → `ready_to_verify` and a `proposal_ready` activity log row is written. Client cannot set this status directly.

**E.3** *As Tom, I want to mark the proposal completed once Steam confirms the trade, so that my `total_trades` increments.*
- **Accept:** `POST /api/proposals/:id/complete` succeeds for either participant when status is `ready_to_verify`. Trigger `increment_total_trades_on_completion` increments `trader_profiles.total_trades` for both users.

---

## Epic F — AI Safety Review

**F.1** *As Casey, I want a one-click AI review of my proposal that flags scam patterns, so that I have a second opinion before pressing "Ready."*
- **Accept:** `POST /api/proposals/:id/ai-review` returns `{ risk_level, warnings, recommended_actions }` validated against `AiReviewResponseSchema`.
- **Accept:** Model used is `claude-haiku-4-5-20251001`.
- **Accept:** Response time ≤ 10 seconds typical; rate-limited to 3 reviews per `(proposal, user)` per 24 hours.

**F.2** *As Casey, I want the AI to refuse to claim a trade is "safe", so that I never get a false sense of security.*
- **Accept:** System prompt explicitly forbids "safe" language; outputs use phrasing like "no obvious red flags detected." (Verifiable in `lib/anthropic.ts`.)

**F.3** *As Tom, I want the AI to operate on server-validated data only, so that a bad actor cannot prompt-inject through the message body.*
- **Accept:** Server constructs the AI input from typed fields (`buildAiReviewInput`) — no raw user prose is concatenated into the prompt.

---

## Epic G — Reports & Reviews

**G.1** *As Casey, I want to leave a 1-5 star rating after a completed trade, so that future Caseys benefit from my experience.*
- **Accept:** `POST /api/proposals/:id/review { rating, comment }` succeeds exactly once per `(proposal, reviewer)`. Trigger recomputes `trader_profiles.average_rating`.

**G.2** *As Casey, I want to report a user who pressured me to send payment off-platform, so that the moderators can act.*
- **Accept:** `POST /api/reports { subject_user_id, reason, proposal_id?, conversation_id? }` writes a row to `reports` with status `open`.

---

## Epic H — Admin

**H.1** *As Ava, I want to see all open reports with the linked conversation and proposal, so that I can triage quickly.*
- **Accept:** Admin dashboard at `/admin` shows reports list filterable by `open | resolved | dismissed`; each row links to the source proposal/conversation.

**H.2** *As Ava, I want to resolve or dismiss a report with notes, so that the next admin sees what I decided.*
- **Accept:** Resolution writes `resolved_by`, `resolution_notes`, `resolved_at`, and flips status.

**H.3** *As Ava, I want to view the full activity log of any proposal, so that "he said / she said" disputes have a paper trail.*
- **Accept:** `/admin/trade/:id` renders all `trade_activity_log` rows for that proposal in chronological order with actor display names.

---

## Cross-cutting non-functional acceptance

- **NF-1** Every authenticated page renders the trust bar copy: *"We don't hold your skins. We don't use bots. Steam trades happen directly between you."*
- **NF-2** Every proposal page renders a non-dismissible scam warning banner.
- **NF-3** All forms validate with Zod and surface field-specific errors; no silent failures.
- **NF-4** All state-changing endpoints write a `trade_activity_log` entry — no silent state mutation.

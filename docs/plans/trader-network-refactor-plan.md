# REFACTOR PLAN — Trade Rooms → Trusted Trader Network
## Project: SkinPeer (CS2 P2P Trading Coordination Platform)

You are refactoring an existing application from a "trade room" model to a "trusted
trader network" model. Read this entire document before making any changes. Phase 0
(discovery) is mandatory and must complete before any code is written.

---

## Existing System (do not assume — verify in Phase 0)

**Stack:** pnpm monorepo, Vite + React + TypeScript + Tailwind (web), Express + TS
(server), Supabase (auth + Postgres + Realtime), Zod schemas in `packages/shared`.

**Auth:** Steam OpenID 2.0 → server mints Supabase session via Admin API.
`profiles.steam_id`, `steam_persona`, `steam_avatar` are populated on login.

**Existing tables (current state):**
- `profiles` — user identity, Steam fields, `is_admin`
- `trade_rooms` — the unit being deprecated
- `trade_items` — items belonging to a room
- `reports` — currently `room_id` foreign key
- `activity_log` — currently `room_id` foreign key
- `steam_inventories` — cached Steam inventory per user

**Frontend pages currently in use:**
`LandingPage`, `LoginPage`, `AuthCallbackPage`, `DashboardPage`, `CreateRoomPage`,
`TradeRoomPage`, `JoinPage`, `AdminDashboardPage`.

**Migration posture:** This is a pre-launch MVP. There is no production trade data to
preserve. Old tables and pages are dropped, not migrated.

---

## Concept Shift (one paragraph)

The product was a transactional tool — create a room, invite, fill in items, lock,
done. The new product is a **directory plus messenger plus proposal engine**. Users
build public trader profiles, discover other traders, message them, negotiate freely
in chat, and only then crystallize an agreement into a trade proposal. The proposal
inherits all the safety mechanics that used to live in the room: verification code,
checklist, status tracking, activity log, reports, AI safety review. Conversations
persist independently of any single trade — two traders may exchange messages over
many trades.

---

## Disclaimers (must appear in UI on relevant pages)

These are not optional — they govern liability framing. Surface them on landing,
trader profile, and trade proposal pages.

- The platform does not hold or escrow CS2 items.
- The platform does not operate Steam trade bots.
- The platform does not execute Steam trades; users complete trades themselves
  inside Steam.
- The platform is not gambling, betting, or a marketplace.
- The platform is not affiliated with or endorsed by Valve or Steam.
- Trades are never described as "guaranteed safe." Always use language like
  "safer," "verified," "checked," etc.
- Every trade page must remind users to verify items, floats, and stickers
  inside Steam before clicking Accept on the Steam trade window.

---

## Target User Flow

1. User signs in with Steam.
2. First-time users are routed to `Onboarding` to create a trader profile
   (bio, trade preferences, accepting toggle).
3. User browses `Find Traders` — searchable, sortable by reviews and trade count.
4. User opens another trader's public profile.
5. User clicks `Message` — server creates or returns the existing conversation
   between the two users.
6. Users exchange messages in real time.
7. Either user clicks `Propose Trade` from the conversation header.
8. `Create Trade Proposal` page opens, pre-filled with both users; each side adds
   items from their cached Steam inventory.
9. Submit creates a `trade_proposals` row with status `draft`, generates a unique
   verification code, and posts a system message into the conversation linking it.
10. Both users open the proposal, review items, and tick checklist items.
11. When both `creator_ready` and `recipient_ready` are true, status flips to
    `ready_to_verify`.
12. Users complete the trade inside Steam (off-platform).
13. Each user marks the trade `completed`, `cancelled`, or files a `report`.
14. After a `completed` proposal, both users may leave a `review` on each other.

---

## New Data Model

All tables use `uuid` primary keys with `gen_random_uuid()` defaults and
`timestamptz` columns with `now()` defaults unless stated.

### `trader_profiles`
One-to-one extension of `profiles`. A row exists only after a user opts into
discovery. Users without a row are not listed in Find Traders.
- `user_id uuid PK → profiles.id ON DELETE CASCADE`
- `display_name text NOT NULL` (defaults to steam_persona)
- `bio text`
- `trade_preferences text` (free-form, e.g. "Knives and gloves only")
- `accepting_trades boolean NOT NULL DEFAULT true`
- `is_public boolean NOT NULL DEFAULT true`
- `total_trades integer NOT NULL DEFAULT 0` (denormalized — incremented on completion)
- `average_rating numeric(3,2)` (denormalized — recomputed on review insert)
- `created_at`, `updated_at`

### `conversations`
- `id uuid PK`
- `user_a_id uuid NOT NULL → profiles.id`
- `user_b_id uuid NOT NULL → profiles.id`
- `last_message_at timestamptz`
- `created_at`
- `UNIQUE(LEAST(user_a_id, user_b_id), GREATEST(user_a_id, user_b_id))` —
  enforce one conversation per pair regardless of who initiated

### `messages`
- `id uuid PK`
- `conversation_id uuid NOT NULL → conversations.id ON DELETE CASCADE`
- `sender_id uuid NOT NULL → profiles.id`
- `body text NOT NULL`
- `kind text NOT NULL DEFAULT 'user'`
   `CHECK (kind IN ('user','system','trade_proposal_link'))`
- `metadata jsonb` (used by `trade_proposal_link` to store `proposal_id`)
- `read_at timestamptz`
- `created_at`

### `trade_proposals`
Replaces `trade_rooms`.
- `id uuid PK`
- `conversation_id uuid NOT NULL → conversations.id`
- `creator_id uuid NOT NULL → profiles.id`
- `recipient_id uuid NOT NULL → profiles.id`
- `status text NOT NULL DEFAULT 'draft'`
   `CHECK (status IN ('draft','ready_to_verify','completed','cancelled','disputed'))`
- `verification_code text NOT NULL UNIQUE` (6-char alphanumeric uppercase)
- `creator_ready boolean NOT NULL DEFAULT false`
- `recipient_ready boolean NOT NULL DEFAULT false`
- `ai_review_id uuid → ai_safety_reviews.id` (nullable; populated on user request)
- `completed_at timestamptz`
- `cancelled_at timestamptz`
- `created_at`, `updated_at`

### `trade_items`
Repurposed from existing table. Drop and recreate, or rename column.
- `id uuid PK`
- `proposal_id uuid NOT NULL → trade_proposals.id ON DELETE CASCADE`
- `owner_id uuid NOT NULL → profiles.id`
- `name text NOT NULL`
- `wear text`, `float_value numeric(10,8)`, `rarity text`
- `image_url text`
- `steam_asset_id text` (so item can be cross-referenced to inventory)
- `created_at`

### `trade_checklist_items`
A row per (proposal, user, checklist_key). Allows extending the checklist later
without schema changes.
- `id uuid PK`
- `proposal_id uuid NOT NULL → trade_proposals.id ON DELETE CASCADE`
- `user_id uuid NOT NULL → profiles.id`
- `checklist_key text NOT NULL` (e.g. `'verified_floats'`, `'checked_stickers'`,
  `'confirmed_steam_id'`, `'no_pressure_to_rush'`)
- `is_checked boolean NOT NULL DEFAULT false`
- `checked_at timestamptz`
- `UNIQUE(proposal_id, user_id, checklist_key)`

### `trade_activity_log`
Repurposed from existing `activity_log`.
- `id bigserial PK`
- `proposal_id uuid → trade_proposals.id`
- `actor_id uuid → profiles.id`
- `action text NOT NULL`
- `metadata jsonb`
- `created_at`

### `reports`
Repurposed.
- `id uuid PK`
- `reporter_id uuid NOT NULL → profiles.id`
- `subject_user_id uuid → profiles.id` (the user being reported)
- `proposal_id uuid → trade_proposals.id` (nullable — can report a user without a trade)
- `conversation_id uuid → conversations.id` (nullable — message-based reports)
- `reason text NOT NULL`
- `status text NOT NULL DEFAULT 'open'`
   `CHECK (status IN ('open','resolved','dismissed'))`
- `resolved_by uuid → profiles.id`
- `resolution_notes text`
- `created_at`, `resolved_at`

### `reviews`
- `id uuid PK`
- `proposal_id uuid NOT NULL → trade_proposals.id`
- `reviewer_id uuid NOT NULL → profiles.id`
- `subject_user_id uuid NOT NULL → profiles.id`
- `rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5)`
- `comment text`
- `created_at`
- `UNIQUE(proposal_id, reviewer_id)` — one review per trade per reviewer

### `ai_safety_reviews`
- `id uuid PK`
- `proposal_id uuid NOT NULL → trade_proposals.id`
- `requested_by uuid NOT NULL → profiles.id`
- `risk_level text NOT NULL CHECK (risk_level IN ('low','medium','high','critical'))`
- `warnings jsonb NOT NULL DEFAULT '[]'`
- `recommended_actions jsonb NOT NULL DEFAULT '[]'`
- `model_used text NOT NULL`
- `input_summary text`
- `created_at`

---

## Verification Code Spec

- Format: 6-character uppercase alphanumeric, e.g. `7K3M9P`
- Excluded characters: `0`, `O`, `I`, `1` (avoid visual ambiguity)
- Generated server-side at proposal creation; never editable
- Stored on `trade_proposals.verification_code` (UNIQUE constraint)
- Displayed prominently on the proposal page for both users
- Purpose: users compare codes verbally or in a separate channel before clicking
  Accept inside the Steam trade window. The code does not unlock anything — it is
  a shared secret that confirms both parties are looking at the same proposal.

---

## AI Safety Review Spec

**Trigger:** user clicks "Run AI Safety Review" on a proposal in `draft` status.
Rate-limited to 3 runs per proposal per user per 24h. Results are cached in
`ai_safety_reviews` and the latest is linked from `trade_proposals.ai_review_id`.

**Model:** Anthropic API, `claude-haiku-4-5-20251001` (fast, cheap, sufficient for
this task). Make the model identifier a server constant — easy to swap.

**Input assembled by server (never trust user-supplied):**
- Both users' trader profiles: display_name, total_trades, average_rating,
  account age (from `profiles.created_at`)
- All items on each side (name, wear, rarity, image_url) — no float values
  required for the review
- Last 30 messages from the conversation, oldest first
- Boolean: whether either user has been reported in the last 90 days

**System prompt for the model** (use verbatim):
> You are a CS2 trade safety reviewer. Analyze the trade proposal and conversation
> for signs of scam patterns common in CS2 trading: rushed pressure, off-Steam
> payment requests, lookalike accounts, mismatched item value, fake middleman
> claims, account takeover indicators, or social engineering. You do not have
> access to real-time Steam Market prices and you must not estimate item values.
> Output JSON only, with this exact shape:
> ```
> {
>   "risk_level": "low" | "medium" | "high" | "critical",
>   "warnings": string[],
>   "recommended_actions": string[]
> }
> ```
> Never claim a trade is safe. Use language like "no obvious red flags detected."
> Always include at least one recommended action reminding the user to verify
> items inside Steam before accepting.

**Output handling:** Validate against a Zod schema. If the model returns malformed
JSON, retry once. If still malformed, return a 502 to the frontend with a generic
"AI review unavailable, try again later" message. Never display raw model output.

**Display rules:** Risk level shown as a colored badge (low=green, medium=amber,
high=orange, critical=red). Warnings and actions rendered as plain bulleted lists.
Always paired with a static disclaimer: "AI review is advisory only. It does not
guarantee trade safety."

---

## Authorization Rules (apply consistently across server)

| Resource | Read access | Write access |
|---|---|---|
| `trader_profiles` (where `is_public=true`) | anyone authenticated | owner only |
| `conversations` | both participants | both participants |
| `messages` | both participants of parent conversation | sender (own messages only) |
| `trade_proposals` | creator + recipient + admins | creator/recipient depending on action |
| `trade_items` | proposal participants | owner of the item, only on `draft` status |
| `trade_checklist_items` | proposal participants | the user the row belongs to |
| `reports` | reporter + admins | reporter (create), admins (resolve) |
| `reviews` | anyone authenticated | reviewer (one per proposal) |
| `ai_safety_reviews` | proposal participants | system (created via authorized endpoint) |
| `trade_activity_log` | proposal participants + admins | system only |

Implement these as guard functions in `apps/server/src/middleware/authz.ts`.
Each route calls the appropriate guard early. Do not rely on Postgres RLS for the
MVP — explicit server-side checks only.

---

## Phased Implementation

Phases must run in order. Each phase has a gate; do not start phase N+1 until
the gate for N passes.

### Phase 0 — Discovery & Audit (mandatory before any code)

Walk the existing repo and produce a single output: a `REFACTOR_AUDIT.md` file
at the repo root containing one table:

| Path | Status | Reason / Notes |
|---|---|---|
| `apps/server/src/routes/rooms.ts` | REMOVE | Replaced by `trade-proposals.ts` |
| `apps/server/src/routes/auth.ts` | KEEP | Auth flow unchanged |
| `apps/web/src/pages/TradeRoomPage.tsx` | REPLACE | Becomes `TradeProposalPage.tsx` |
| ... | ... | ... |

Status values: `KEEP`, `RENAME`, `REPLACE`, `REMOVE`, `EXTEND`.
Cover every file under `apps/`, `packages/`, `supabase/`, and `scripts/`.

**Gate:** `REFACTOR_AUDIT.md` exists, every existing file is classified, and a
human has reviewed it. Do not start Phase 1 without explicit approval.

### Phase 1 — Schema migration

- Write `supabase/migrations/00X_trader_network.sql` containing:
  - `DROP TABLE` statements for `trade_rooms`, the old `trade_items`, the old
    `reports`, the old `activity_log` (in correct dependency order)
  - `CREATE TABLE` statements for all nine new tables above
  - Indexes on foreign keys, on `messages.conversation_id, created_at`, on
    `trader_profiles.is_public, accepting_trades`
  - Trigger to update `conversations.last_message_at` on message insert
  - Trigger to update `trader_profiles.average_rating` and `total_trades` on
    review insert and proposal completion respectively

**Gate:** Migration applies cleanly to a fresh Supabase project. All tables
exist. A manual smoke insert into each table succeeds.

### Phase 2 — Shared schemas

Update `packages/shared/src/schemas.ts`:
- Remove `CreateRoomSchema`
- Add `TraderProfileSchema`, `UpdateTraderProfileSchema`,
  `SendMessageSchema`, `CreateProposalSchema`, `AddProposalItemSchema`,
  `ChecklistToggleSchema`, `ReportSchema` (updated shape),
  `ReviewSchema`, `AiReviewResponseSchema`

**Gate:** `pnpm build` passes for the shared package.

### Phase 3 — Backend: trader profiles

Routes (mounted under `/api/traders`, all behind `authenticate`):
- `GET /me/profile` — own profile (creates default row if missing)
- `PATCH /me/profile` — update own profile
- `GET /` — list traders (filters: search, sort by `rating` or `trades`,
  pagination); only returns `is_public=true` rows
- `GET /:userId` — public profile by user id; 404 if not public

**Gate:** Manual curl tests for all four endpoints return correct shapes.

### Phase 4 — Backend: conversations and messages

Routes under `/api/conversations`:
- `POST /` — body `{ other_user_id }` — find-or-create conversation
- `GET /` — list current user's conversations, ordered by `last_message_at desc`
- `GET /:id` — get one conversation with last 50 messages
- `GET /:id/messages?before=` — paginated message history
- `POST /:id/messages` — send message
- `POST /:id/read` — mark all messages as read for the calling user

Real-time: Frontend subscribes to `messages:conversation_id=eq.{id}` via Supabase
Realtime. Server does not push — Postgres replication handles it.

**Gate:** Two test users can create a conversation, exchange messages, and the
realtime subscription fires for both clients.

### Phase 5 — Backend: trade proposals + items + checklist

Routes under `/api/proposals`:
- `POST /` — create from a conversation_id (server validates both users are
  participants); generates verification code; inserts a `trade_proposal_link`
  system message into the conversation
- `GET /:id` — full proposal with items grouped by side, checklist state, AI
  review summary
- `DELETE /:id` — cancel (creator only, status must be `draft`)
- `POST /:id/items` — add own item (status must be `draft`)
- `DELETE /:id/items/:itemId` — remove own item (status must be `draft`)
- `POST /:id/checklist` — body `{ checklist_key, is_checked }`; user only toggles
  their own row. After toggle, server checks if all required keys are checked
  for both users — if yes, flip status to `ready_to_verify`
- `POST /:id/complete` — marks status `completed`; only allowed when status is
  `ready_to_verify`; either participant may call; sets `completed_at`;
  increments both users' `total_trades`
- `POST /:id/cancel` — either participant; only from `draft` or `ready_to_verify`
- `GET /:id/activity` — full activity log
- `GET /me` — list current user's proposals (all statuses)

Define the canonical checklist keys server-side as a constant array:
`['verified_steam_id', 'verified_items', 'verified_floats', 'checked_stickers',
'no_off_platform_payment', 'understand_self_serve']`

**Gate:** A full proposal lifecycle works end to end via curl: create → add items
→ toggle checklist on both sides → status flips to `ready_to_verify` → complete.

### Phase 6 — Backend: reports, reviews, AI safety review

Routes:
- `POST /api/reports` — body `{ subject_user_id, proposal_id?, conversation_id?, reason }`
- `POST /api/proposals/:id/review` — body `{ rating, comment? }`; only allowed
  when proposal status is `completed` and reviewer is a participant; UNIQUE
  constraint prevents double-review
- `POST /api/proposals/:id/ai-review` — runs the Anthropic call; rate-limited;
  stores result; updates `proposal.ai_review_id`
- Admin routes under `/api/admin/`: list/resolve reports (existing pattern)

**Gate:** Reports filed correctly, reviews update `trader_profiles.average_rating`,
AI review returns a parseable response on a sample proposal.

### Phase 7 — Frontend: discovery and profiles

Replace deprecated pages and add new ones:
- `OnboardingPage.tsx` — first-login flow if no `trader_profiles` row exists
- `FindTradersPage.tsx` — search bar, sort dropdown, paginated grid of cards
- `TraderProfilePage.tsx` — public view; `Message` button kicks off
  `POST /api/conversations` then navigates to `/messages/:id`
- `EditProfilePage.tsx` — edit own trader profile

Remove: `CreateRoomPage.tsx`, `JoinPage.tsx`, `TradeRoomPage.tsx`.

**Gate:** New user signs in → onboarding → profile created → can browse and view
other profiles.

### Phase 8 — Frontend: messages and conversation

- `MessagesPage.tsx` — list of conversations, last message preview, unread badge
- `ConversationPage.tsx` — chat thread, real-time messages via Supabase Realtime,
  `Propose Trade` button in header (opens `CreateTradeProposalPage` with
  `conversation_id` query param)

**Gate:** Two users can chat in real time; system messages render distinctly.

### Phase 9 — Frontend: trade proposals

- `CreateTradeProposalPage.tsx` — pulls inventory from `/api/me/inventory`,
  side-by-side item picker, submit creates proposal and redirects
- `TradeProposalPage.tsx` — replaces `TradeRoomPage`. Verification code banner,
  side-by-side items, checklist (only own side toggleable), status panel,
  AI review section (with "Run review" button), report button, activity log,
  review form (after completion)
- `MyTradesPage.tsx` — list of user's proposals filterable by status

**Gate:** Full user flow from sign-in to completed proposal works without errors.

### Phase 10 — Cleanup and admin

- Delete the original `rooms.ts`, room middleware, room-related tests
- Update `AdminDashboardPage.tsx` to show reports referencing `proposal_id`/
  `conversation_id` instead of `room_id`
- Update landing page copy to reflect the new model
- Update README

**Gate:** Codebase has no remaining references to `trade_rooms` or `room_id`.
`pnpm build && pnpm lint` passes for all packages.

---

## Success Criteria (overall)

- A new user can sign in via Steam, create a trader profile, find another trader,
  start a conversation, propose a trade, complete the checklist on both sides,
  mark the trade complete, and leave a review — without any console errors or
  manual server intervention.
- All disclaimers are visible on landing, profile, and proposal pages.
- AI safety review returns a valid result for a representative proposal.
- An admin can see and resolve reports.
- No file in the repo references the deprecated `trade_rooms` concept.

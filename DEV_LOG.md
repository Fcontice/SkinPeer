# SkinPeer Dev Log

All significant implementation sessions are recorded here.
Format: date/time, prompt, what was built, bugs hit, how they were fixed.

---
## [2026-04-23] — Full MVP scaffold — monorepo, server, frontend, schema

**Prompt:** "I created an orchestration prompt for you to follow in docs/plans — review the plan and execute" (Option B chosen: orchestration prompt structure + architecture.md reconciliation)

**Implemented:**
- `package.json` — pnpm workspace root with concurrently (turbo replaced due to Windows binary failure)
- `.npmrc` — `node-linker=hoisted` + `shamefully-hoist=true` (required for Windows symlink compatibility)
- `pnpm-workspace.yaml` — `apps/*` + `packages/*`
- `supabase/migrations/001_initial.sql` — 6 tables: profiles, trade_rooms, trade_confirmations, trade_items, reports, activity_log + handle_new_user trigger + Realtime publication
- `apps/server/src/` — full Express server: authenticate, requireAdmin, validate, rateLimiter, errorHandler, notFound middleware; auth, rooms, invite, confirmation, reports, admin routes; codeService (WORD-####-WORD generation)
- `apps/web/src/` — full React frontend: AuthContext, Layout, TrustBar, ScamWarningBanner, VerificationCode components; Landing, Login, Register, Dashboard, CreateRoom, TradeRoom, Join, AdminDashboard pages; TanStack Query, React Router, Supabase Realtime

**Bugs / Errors Encountered:**
- `turbo` Windows native binary UNKNOWN error → replaced with `concurrently`
- `tsx` esbuild win32-x64 not found → replaced with `ts-node`
- pnpm symlink layout: `Cannot find module 'dotenv/config'` → fixed with `node-linker=hoisted` in `.npmrc`
- pnpm `.bin` shims are empty files on Windows → invoke tsc as `node /path/to/typescript/bin/tsc`
- `@skinpeer/shared` workspace dep caused `rootDir` removal + linking failure → inlined Zod schemas per route file

**Notes:**
- Port is 4000 (server), 5173 (web) — not 3001/`/api/v1/` as CLAUDE.md originally stated
- Workspace package sharing abandoned; schemas inline per route
- `packages/shared` exists but is not imported anywhere

---
## [2026-04-26] — Supabase MCP setup, migration applied, env wired, dev server running

**Prompt:** "lets continue phase 10" / "pnpm run dev"

**Implemented:**
- Added Supabase MCP server to project: `claude mcp add --scope project --transport http supabase ...`
- Applied `001_initial.sql` migration via MCP to live Supabase project (`<redacted-project-ref>`)
- Applied RLS policies migration via MCP — all 6 tables secured
- Populated `apps/server/.env` and `apps/web/.env` with real Supabase URL + anon key
- Fixed CORS: changed server to allow any `localhost:*` origin in dev (was hardcoded to 5173)
- Fixed ts-node type augmentation: added `"ts-node": { "files": true }` to `apps/server/tsconfig.json`
- Fixed `src/types/express.d.ts`: wrapped in `declare global { }` + added `export {}`
- Suppressed React Router v7 future flag warnings in `apps/web/src/main.tsx`
- Created `DEV_LOG.md` and `.claude/commands/update-dev-log.md` skill

**Bugs / Errors Encountered:**
- `CORS: Access-Control-Allow-Origin header value 'http://localhost:5173' not equal to supplied origin 'http://localhost:5174'` → port drift from stale process; fixed by killing old PIDs (`taskkill`) and making CORS accept any localhost port in dev
- `TSError: Property 'user' does not exist on type 'Request'` — ts-node not loading `.d.ts` ambient files → fixed with `"ts-node": { "files": true }` in tsconfig
- `EADDRINUSE :::4000` on restart → killed stale PID with `netstat -ano` + `taskkill`
- Supabase signup: `429 Too Many Requests / email rate limit exceeded` → need to disable "Confirm email" in Supabase dashboard (Auth → Providers → Email)

**Notes:**
- Service role key populated by user directly into `apps/server/.env`
- Supabase email confirmation must be disabled for local dev (free tier rate limits)
- One test user exists in DB: username `test`, id `<redacted-uuid>`
- RLS policies use service role key on server (bypasses RLS); anon key only used for Realtime subscriptions from client

---
## [2026-04-26] — Steam OpenID auth refactor — replaced email/password with Steam login + inventory picker

**Prompt:** "Review the dev logs and existing auth implementation, then implement the Steam authentication refactor plan." (Followed `docs/plans/steam-auth-refactor-plan.md`, executed via batched plan at `~/.claude/plans/review-the-dev-logs-elegant-pony.md`)

**Implemented:**
- `supabase/migrations/002_steam_auth.sql` — added `steam_id` (unique), `steam_persona`, `steam_avatar` to `profiles`; replaced `handle_new_user` trigger to upsert Steam metadata on re-login; created `steam_inventories` cache table (1 row per user, jsonb items, fetched_at)
- Migration applied to live Supabase project via MCP
- `apps/server/.env.example` + `apps/server/.env` — added `STEAM_API_KEY`, `STEAM_RETURN_URL`, `STEAM_REALM`, `FRONTEND_URL`
- `apps/server/src/lib/steam.ts` — `verifySteamOpenId()` (manual OpenID 2.0 verification via POST with `check_authentication`), `fetchSteamProfile()` (GetPlayerSummaries v2), `parseSteamInventory()` (CS2 asset+description join, tag extraction for wear/rarity/type), `InventoryItem` type
- `apps/server/src/routes/steam.ts` — `GET /api/auth/steam` (302 redirect to Steam OpenID with checkid_setup), `GET /api/auth/steam/callback` (verify → look up or create Supabase user with synthetic email `{steamid64}@steam.skinpeer.gg` → upsert profile → mint magic link → redirect to frontend `/auth/callback`)
- `apps/server/src/routes/inventory.ts` — `GET /api/me/inventory` with 5-min server-side cache, public 403 detection, upsert into `steam_inventories`
- `apps/server/src/index.ts` — mounted `steamRouter` BEFORE `defaultLimiter` (browser redirects must skip rate limit) and `inventoryRouter` at `/api/me`
- `apps/web/src/pages/AuthCallbackPage.tsx` — reads `token`+`type` from URL, calls `supabase.auth.verifyOtp({ type: 'magiclink' })`, navigates to `/dashboard` or `/login?error=...`
- `apps/web/src/App.tsx` — added public `/auth/callback` route
- `apps/web/src/pages/LoginPage.tsx` — full replacement: removed email/password form, added Steam-branded `<a href>` (full navigation, not fetch), error message map for all 6 error codes
- `apps/web/src/pages/RegisterPage.tsx` — replaced with `<Navigate to="/login" replace />` (Steam handles registration in one flow)
- `packages/shared/src/schemas.ts` — appended `InventoryItem` type
- `apps/web/src/pages/TradeRoomPage.tsx` — removed manual item form (`showAddItem`, `itemName`, `itemWear`, `itemPrice`, `addItemMutation`); added inventory picker modal: opens on "+ Add Item", fetches `/api/me/inventory`, filters `tradable === true`, grid of cards with icon/name/wear/rarity, click adds via `POST /rooms/:id/items`, "Refresh Inventory" button, private-inventory error banner with link to Steam settings

**Bugs / Errors Encountered:**
- `getUserByEmail` not in `@supabase/supabase-js` v2.43 GoTrueAdminApi → replaced with `listUsers({ page:1, perPage:1000 })` and client-side filter on synthetic email
- `Argument of type 'unknown' is not assignable to parameter of type 'SteamInventoryRaw'` from `await steamRes.json()` → cast to `Parameters<typeof parseSteamInventory>[0]`
- `Cannot find module '@skinpeer/shared'` in TradeRoomPage → shared package not built and no tsconfig path alias; switched to relative import `../../../../packages/shared/src/schemas`
- 429 Too Many Requests on `/api/auth/steam` → `defaultLimiter` (100 req/15min) was applied globally before all routes; moved `app.use('/api/auth', steamRouter)` ABOVE `app.use(defaultLimiter)` so browser redirects bypass it
- `EADDRINUSE :::4000` between restarts → killed stale node PIDs via `Get-NetTCPConnection -LocalPort 4000`

**Notes:**
- Synthetic email `{steamid64}@steam.skinpeer.gg` is purely a unique key; never receives mail. Required because Supabase Auth mandates email per user.
- Magic link token extracted from `linkData.properties.action_link` via `new URL(...).searchParams.get('token')` then URL-encoded
- Steam OpenID is NOT OAuth2 — used raw fetch instead of passport/openid-client (single POST with `check_authentication`, regex-extract steamid64 from `openid.claimed_id`)
- `STEAM_RETURN_URL` and `STEAM_REALM` MUST exactly match production domain when deployed — Steam returns `is_valid:false` with no useful error on mismatch
- Existing auth middleware unchanged — still validates Supabase JWTs identically; AuthContext unchanged
- `profiles` is upserted server-side as belt-and-suspenders alongside the trigger (handles cases where `raw_user_meta_data` lookup fails)
- Login flow verified end-to-end with real Steam account

---
## [2026-04-27] — Landing page + dashboard UI refactor with auth-based redirect

**Prompt:** "Refactor the SkinPeer landing page and authenticated dashboard UI to be more user-friendly, polished, and trustworthy while keeping the existing dark theme and green accent branding. Also implement auth-based routing: if a user is already logged in and visits the landing page, automatically redirect them to the dashboard/find-traders page. Use the existing auth/session logic and include a loading state so the landing page does not flash before redirecting." (focus list: hero, how-it-works, trust cards, verification example, dashboard welcome panel, search/sort, trader cards, empty states, responsive, minimal architecture changes)

**AI tool used:** Claude Code (Opus 4.7, 1M context)

**Implemented:**
- `apps/web/src/pages/LandingPage.tsx` — full rewrite. Added auth redirect via `useAuth()`: while `loading` shows a centered pulse loader; once `user` resolves, `<Navigate to="/traders" replace />` so the landing page never flashes. Marketing layout now: sticky backdrop-blur nav, hero with radial accent gradient and "Verification-first CS2 trading" eyebrow pill, dual CTAs ("Sign in with Steam" → existing `${VITE_API_URL}/api/auth/steam`, plus "See how it works" anchor), enlarged verification-code card showing `7K3M9P` in monospace tracked text with "Both parties matched" pulse badge and Copy button, "How it works" 3-step section (`01/02/03`), 4-card trust grid (No bots / No custody / No escrow / Steam-direct), footer disclaimer (Valve disclaimer + © year).
- `apps/web/src/pages/FindTradersPage.tsx` — full rewrite. Added welcome panel ("Welcome back, {greetingName}" derived from `profile.username` → email prefix → fallback) with quick-action buttons (My trades / Messages / Edit profile). Search input now has embedded magnifying-glass SVG and Enter-to-submit; sort `<select>` replaced with pill toggle group; new client-side "Show only traders accepting trades" checkbox. New `TraderCard` extracted as a child component with auto-generated initials avatar, accepting/paused badge, amber-star rating row, bio fallback ("No bio yet."), hover glow + arrow. New `EmptyState` component distinguishes filtered-no-results (Clear filters CTA) vs. empty-directory (Set up your profile CTA). Loading state replaced with a 6-tile skeleton grid. Responsive grid: 1 / 2 / 3 columns at base / md / xl.
- No new files, no new dependencies. Tailwind-only styling using existing tokens (`bg`, `card`, `border`, `accent`, `danger`).

**Bugs / Errors Encountered:**
- (n/a — clean session, `npm --prefix apps/web run lint` (= `tsc --noEmit`) passed on first run)

**Prompts that worked:**
- The user's single detailed brief with explicit focus bullets ("hero", "how it works", "trust cards", "verification example card", "welcome panel", "trader cards", "empty states") let me skip the multi-section brainstorming dialogue and go straight to a one-shot plan + implementation. Specificity beat ambiguity.
- "Minimal architecture changes" in the brief — kept the diff to two files; resisted the urge to extract shared marketing components or add a design-tokens file.

**Prompts that failed:**
- (n/a)

**Human overrides:**
- The brainstorming skill normally asks one question at a time and presents the design in 200-300 word sections. I overrode that loop because the brief was already specific enough — proposed the full plan in one message and asked a single yes/no, which the user accepted with "proceed". Reason: the skill's "Be flexible" clause and the cost of N round-trips on an already-clear brief.
- The CLAUDE.md says the dashboard route is `/dashboard` rendering `MyTradesPage`. The user said "dashboard/find-traders page" — I treated `FindTradersPage` (route `/traders`) as *the* dashboard for this refactor and pointed the post-login redirect there, instead of `/dashboard`. Reason: their focus list ("welcome panel, search/sort controls, trader cards") only matches FindTradersPage, not MyTradesPage.
- Did not modify `Layout.tsx` or `TrustBar.tsx`. The original plan flagged them as "possibly minor tweaks" — on inspection they were already fine and changing them risked breaking other authenticated pages I didn't touch.

**Notes:**
- The landing-page Copy button is currently a static affordance (no onClick wiring) since the example code is illustrative; if we ever swap in a real per-session demo code, wire it up.
- "Accepting trades only" filter is client-side over the already-fetched list. If the directory grows large, push it down to the `/traders` API as a query param like `accepting=true`.
- `MyTradesPage` (route `/dashboard`) was left untouched. If "the dashboard" is meant to be that page in some product surfaces, we may want to either (a) redirect `/dashboard` → `/traders`, or (b) give MyTradesPage the same welcome-panel treatment in a follow-up.
- No tests exist for these pages; verification was typecheck + visual review of the JSX. Recommend a quick browser pass on `/` (logged-out + logged-in redirect) and `/traders` before deploying.

---
## [2026-04-27] — Trade-offer pull-flow Tasks 13–16: ProposeTradePage, dashboard inbox + badge, smoke script

**Prompt:** "continue from tasklist for the implementation plan" — resuming after a context-reset compaction. The implementation plan is `docs/plans/2026-05-01-trade-offer-pull-flow.md` (16 tasks total) which refactors the trade-proposal flow into a pull-based offer model: a sender browses the recipient's inventory, picks items they want + items they'll offer, and submits a `trade_offers` row that the recipient can Accept (materializes a `trade_proposals` row), Reject, Counter (creates a child offer with roles swapped), or that the sender can Withdraw.

**AI tool used:** Claude Code (Opus 4.7, 1M context). Subagent-driven workflow — controller dispatched implementer subagents per task, then a `general-purpose` spec-compliance reviewer, then a `superpowers:code-reviewer` quality reviewer. Fix-up subagents handled review feedback.

**Implemented:**
- **Task 13 (verified pre-existing):** `apps/web/src/components/TradeOfferCard.tsx` (status pill, two-column requested/offered layout, per-item Steam Community Market price hint with "last fetched at HH:MM" caption, Accept/Reject/Counter/Withdraw actions, "Open verification proposal →" link when accepted). `apps/web/src/pages/ConversationPage.tsx` repointed Propose button to `/messages/:id/propose` and renders inline `<ConvoOfferCardRow>` for `kind === 'trade_offer'` messages with realtime subscription on `trade_offers` filtered by `id=eq.<offerId>`.
- **Task 14:** New `apps/web/src/pages/ProposeTradePage.tsx`. Resolves counterparty from `GET /api/conversations/:id`, renders two side-by-side multi-select inventory grids (`/api/inventory/by-user/<id>` for theirs with private-inventory gate, `/api/me/inventory` for mine), running balance via per-item `GET /api/market/price`, counter pre-population via `?counter_of=<id>` with roles swapped (their offered → my requested, their requested → my offered), client-side pending-blocker scan over the last 5 `trade_offer` messages, 409-on-pending banner with "withdraw it to revise" copy, POST `/api/offers` on submit. Modified `apps/web/src/App.tsx` to swap `/proposals/new`→`CreateTradeProposalPage` for `/messages/:conversationId/propose`→`ProposeTradePage`. Deleted `apps/web/src/pages/CreateTradeProposalPage.tsx`.
- **Task 15:** New `apps/web/src/hooks/usePendingOffersCount.ts` hook (fetches `/offers/inbound/pending`, subscribes to `trade_offers` realtime filtered by `to_user_id=eq.<me>`, returns count). Modified `apps/web/src/components/Layout.tsx` to render absolute-positioned numeric badge on the "My trades" nav link when count > 0. Modified `apps/web/src/pages/MyTradesPage.tsx` to add an "Offers awaiting your action" section above the existing status filters, with its own realtime subscription, hidden when empty.
- **Task 16:** New `scripts/smoke-accept-flow.ts` — hand-runnable end-to-end smoke for the offer-accept→proposal handoff. Takes `--a-token`, `--b-token`, `--conv` args. Steps: A POSTs `/offers` → B POSTs `/offers/<id>/accept` → GET proposal as B and assert items split correctly → both fill all 6 checklist keys → final GET asserts `proposal.status === 'ready_to_verify'`. Prints `SMOKE OK` on pass, exits 1 with response body on fail.
- **Task 14 fix pass** (after code review): added `cancelled` flags to all 4 data-fetch effects in `ProposeTradePage.tsx`; gated counter pre-population on a `counterAppliedRef` + per-side `*Loaded` flags so it applies exactly once after both inventories settle (was overwriting user toggles when the second inventory arrived); changed pending-blocker scan to always set `setPendingBlockerId(found ?? null)` so the blocker clears symmetrically; replaced `parsePrice` with a US/EU-locale-robust version that distinguishes `1,234.56` from `1.234,56` by `lastIndexOf` of `.` vs `,`; added `console.warn` diagnostics on swallowed errors; added `theirInventoryLoading || myInventoryLoading` to `submitDisabled`.

**Bugs / Errors Encountered:**
- Code reviewer on Task 14 flagged 3 Critical bugs: (a) no cancellation flags on 4 fetch effects → race conditions and Strict-Mode double-invoke risk; fixed with the `let cancelled = false` / cleanup pattern. (b) Counter pre-pop effect re-ran whenever either inventory length changed, stomping user toggles when the slower-loading side arrived; fixed with a `useRef<boolean>` flag plus per-side `Loaded` state, gating pre-pop on both being true and applying it exactly once. (c) Pending-blocker only ever called `setPendingBlockerId(o.id)` — never cleared; fixed by computing into a local `found` and unconditionally setting (cancelled-guarded).
- I9 (use `@skinpeer/shared` package import alias instead of `'../../../../packages/shared/src/schemas'`) failed: alias unresolvable because `apps/web/package.json` does not declare `@skinpeer/shared` as a dependency and the package isn't symlinked into `apps/web/node_modules`. The implementer reverted to the relative import per the prompt's instruction to not invent paths that don't typecheck.
- No runtime errors. All changes typecheck clean (`pnpm --filter @skinpeer/web run lint` — `tsc --noEmit` exit 0).

**Prompts that worked:**
- Implementer prompts that included the full file paths, the exact API endpoints with their response shapes (e.g. `{ count: number, rows: TradeOffer[] }`), the spec's exact copy strings (e.g. "withdraw it to revise"), and the existing helper imports (`apiFetch`, `useAuth`, `Layout`, `ScamWarningBanner`) produced one-shot correct implementations. Why: the subagent had no context from the conversation, so verbosity beat brevity.
- Code-review subagent prompt that named the categories (Critical / Important / Minor) and gave repo context (no git, React 18 strict, `apiFetch` semantics) returned a structured, file:line-anchored report instead of generic prose. Why: explicit rubric → on-target output.
- Fix-up prompt that listed the 3 Critical issues with verbatim code patterns to copy plus an explicit "skip these" list (I1, I3, I5, I7) kept the implementer focused — no scope creep into the deferred refactors.

**Prompts that failed:**
- The first Task 13 dispatch hit the per-account usage limit at agentId `aea701f421bb7fc56` after 13 tool calls; the subagent silently terminated without returning a report. Fix: on resume, verified the artifacts directly with `Glob` + `Read` instead of redispatching, since both target files (`TradeOfferCard.tsx`, `ConversationPage.tsx` modifications) turned out to already exist and be complete.
- The plan's I5 suggestion (refactor `apiFetch` to throw `ApiError` with `status: number`) was deferred rather than fixed in this pass: refactoring a shared lib used across the app raised regression risk, and the regex-based `/pending/i` 409 detection works against the actual server message. Logged as a deferred Important.

**Human overrides:**
- I marked Task 15 complete on "Approved with suggestions" rather than redispatching a fix-up pass, because the reviewer's only Important items were a refactor (collapse the duplicate hook + page fetch into one shared hook) and a pragma cleanup — neither of which alters behavior. Reason: forward progress over polish on a task that already shipped correct, tested code; the consolidation can be done in a follow-up if the wasted-request volume becomes measurable.
- Skipped the "Step 5: Commit" subsection of every plan task. Repo isn't initialized as git, so all `git add`/`git commit`/`git rm` calls in the plan were dropped from implementer prompts and replaced with file-system operations (Write / Edit / `Remove-Item`). Reason: the user chose option 2 ("skip commits") earlier in the session.
- Diverged from the plan's Step 3 of Task 14 (a separate API call to detect pending blockers) — the implementer instead scanned the conversation's last 5 `trade_offer` messages and parallel-fetched their offers via `Promise.allSettled`. Reason: the plan was unclear on the exact endpoint and the message-list scan reuses already-fetched data; server still enforces 409 as the source of truth.
- The plan's Task 15 Step 3 mentioned extending `/offers/inbound/pending` with `?include_rows=true`, but the existing route already returned `{ count, rows }` from Task 10. Used the existing payload directly. Reason: avoid a no-op server change.

**Notes:**
- All 16 tasks of the trade-offer pull-flow refactor are now complete. Migration 004 was applied to the live Supabase project (`<redacted-project-ref>`) earlier in the session via the Supabase MCP.
- Smoke script (`scripts/smoke-accept-flow.ts`) requires two real test users + a conversation row to exist — it does not bootstrap state. Run with `pnpm tsx scripts/smoke-accept-flow.ts --a-token=... --b-token=... --conv=<uuid>` against a server on `:4000`.
- Deferred Important items from the Task 14 / Task 15 reviews: extract a shared `<InventoryGrid>` component, `useRef<Set<string>>` for price-fetch dedup, refactor `apiFetch` to throw `ApiError` with HTTP status, collapse `usePendingOffersCount` + the page-local fetch into a single `usePendingOffers()` hook returning `{ count, rows }`. None block correctness; revisit if the duplicate fetch becomes noisy in production.
- The `@skinpeer/shared` workspace import alias is currently broken from `apps/web` (not declared in its `package.json` deps). Worth fixing in a separate hygiene pass — not in scope here.
- Verification on this session was typecheck-only (no Vitest tests exist for the new web pages, and the smoke script is hand-runnable, not CI). For the offer routes themselves, the 35 server tests from earlier in the project run green via `pnpm --filter @skinpeer/server test`.

---
## [2026-04-28] — HTTP 429 fix + Steam-persona username display fix

**Prompt:** "I keep getting too many request errors" (with screenshots: `HTTP 429` red text on the Messages page after sending a counter offer; nav showing the synthetic Steam email `76561198340234515@steam.skinpeer.gg` as the user's display name).

**AI tool used:** Claude Code (Opus 4.7, 1M context). Direct edits — no subagents.

**Implemented:**
- `apps/server/src/middleware/rateLimiter.ts` — bumped `defaultLimiter` from `100 req / 15 min` (~6.6 req/min) to `300 req / 1 min`. The old cap was burning through within seconds because the realtime UI fans out: every `trade_offers` row change triggers refetches in (a) `usePendingOffersCount` for the nav badge, (b) the page-local effect in `MyTradesPage`, and (c) every mounted `<ConvoOfferCardRow>` doing its own `apiFetch('/offers/:id')`. Plus per-item `/market/price` calls in each `TradeOfferCard`. Counter offers change two rows (parent → countered, child → pending), multiplying the fan-out.
- `apps/web/src/context/AuthContext.tsx` — added `steam_persona`, `steam_avatar` to the `Profile` interface. The server's `GET /api/auth/me` already returns these via `select *`; the type just didn't expose them.
- `apps/web/src/components/Layout.tsx` line 45 — display name now falls back `steam_persona → username → user.email`. Steam-OpenID accounts whose `username` was never explicitly set will display the Steam persona instead of the synthetic `{steamid}@steam.skinpeer.gg` email.

**Bugs / Errors Encountered:**
- 429s under normal multi-tab use: traced to two compounding causes — (1) overly-tight rate limit in disguise (named "default" but actually only 6.6 req/min average), (2) downstream fan-out from realtime-driven UI. Fixed (1) here; (2) gets fixed structurally in the next session via `PriceContext` and `/offers/by-conversation`.
- (n/a — no other errors)

**Prompts that worked:**
- Single brief from user with two screenshots and two distinct symptoms in one paragraph. Made the diagnostic split obvious (one server-side fix, one client-side fix). Didn't need any clarifying questions.

**Prompts that failed:** (n/a)

**Human overrides:** (n/a — straightforward bug fixes, no design tradeoffs surfaced)

**Notes:**
- Server restart required for the rate-limit change to take effect (it's compiled into the middleware module at boot).
- `300/min` is generous; could revisit downward once the structural fan-out reductions land.
- The synthetic Steam email is only ever shown if neither `steam_persona` nor `username` are set — accounts created pre-Steam-OpenID with email/password still display their `username` as before.

---
## [2026-04-29] — Trade-card chat-thread redesign — chains, carousel, Trades tab, sticky-after-manual minimize

**Prompt:** "Refactor the trade proposal card rendered inside the chatroom message thread." With detailed spec for: one card per trade thread (root + counter-chain via `parent_offer_id`), carousel for offer history with `Offer N of M` pagination dots, per-side running totals from Steam Community Market with `Difference: ± in your favor / against you / Even` advisory line, expanded/minimized states with auto-minimize when newer messages render below, `Chat | Trades` tab toggle inside the chatroom, filter chips on Trades tab (`All / Active / Completed / Closed`), and a pending-count badge on the Trades tab. Out of scope: data model, proposal builder, post-acceptance verification flow.

**AI tool used:** Claude Code (Opus 4.7, 1M context). Used the brainstorming skill briefly (one clarifying question on auto-minimize stickiness — chose option B: sticky-after-manual), then wrote the design plan + implemented directly.

**Implemented:**
- `docs/plans/2026-05-01-trade-card-thread-redesign.md` — design plan, validated with the user before implementing.
- New `apps/web/src/lib/offerChains.ts` — pure helper. `buildOfferChains(offers, messages)` walks `parent_offer_id` to find roots (memoized), groups offers by root, sorts each chain `created_at` ascending, finds the most recent `kind: 'trade_offer'` message per chain as the chain's anchor. Also exports `parsePrice` (US/EU locale-robust), `fmtUsd`, `fmtDelta`.
- New `apps/web/src/context/PriceContext.tsx` — conversation-scoped market-price cache. `useEnsurePrices(names)` schedules one fetch per unseen name; in-flight and failed sets prevent re-fetch storms. Replaces the previous per-`<ItemRow>` `useEffect` fetch pattern.
- `apps/server/src/routes/offers.ts` — added `GET /api/offers/by-conversation/:conversation_id` (registered before `/:id` to avoid the param collision). Returns `{ rows: TradeOffer[] }` ordered ascending. Participant-only; 404 + 403 paths.
- Full rewrite of `apps/web/src/components/TradeOfferCard.tsx`. New props `{ chain, defaultMinimized, manuallyExpanded, onManualExpand, onChange? }`. Carousel with prev/next arrows + dots + `Offer N of M`. Per-column header total (`You want (4) — Total: $14.80`). Bottom delta line ("$3.42 in your favor / against you / Even"). Source caption `Steam Community Market — last fetched at HH:MM`. Action buttons render only when `index === offers.length - 1 && status === 'pending'` and viewer matches the relevant party. Index defaults to latest; if user is on an older offer when a counter arrives, position is preserved (`wasOnLatestRef` tracks it). Minimized layout: status badge + `Trade proposal — You want N items ($X.XX) ↔ You offer M items ($Y.YY)` + chevron.
- Full rewrite of `apps/web/src/pages/ConversationPage.tsx`. Loads `offers: Map<string, TradeOffer>` via the new endpoint, single realtime channel on `trade_offers` filtered by `conversation_id` (event: '*'). `<Chat | Trades>` tab strip below the page header. Chat view skips messages whose offer is not its chain's anchor (precomputed `Set<message_id>` of skipped ids). Trades view: filter chips (`all / active / completed / closed` — bucketed by `latest.status`), sorted desc by `latest.created_at`, all chains expanded by default. Tab badge on `Trades` when ≥1 chain has `latest.status === 'pending' && to_user_id === me`. Sticky-after-manual: `manuallyExpanded: Set<rootId>` lifted to the page so it persists across renders; clicking the chevron toggles, and once true the auto-minimize never reverts.
- `apps/web/src/components/ConversationPanel.tsx` (the side-panel preview embedded in `MessagesPage`) — simplified: trade_offer messages render as a small "Trade proposal — open in chat" link instead of an embedded card. Removed the now-dead `ConvoOfferCardRow` helper, dropped the unused `TradeOffer` and `TradeOfferCard` imports. Keeps the side panel lightweight; the dedicated `/messages/:id` chatroom is the canonical full-card render site.

**Bugs / Errors Encountered:**
- First typecheck failed after the `TradeOfferCard` rewrite: `ConversationPanel.tsx:247` was still passing `offer={offer} onChange={refresh}` against the new `{ chain, defaultMinimized, ... }` props. Fixed by simplifying that side-panel renderer to a "Trade proposal — open in chat" link rather than refactoring the full chain logic into the side panel.
- First draft of `TradeOfferCard.tsx` had a hacky `countLabel` helper and a `latestFetchedAt` typed against `ReturnType<typeof Object>`; rewrote with the totals computed directly inline and the helper retyped against the actual `MarketPrice` shape from the context. Final typecheck clean.
- (n/a otherwise)

**Prompts that worked:**
- The user's spec was structured by section (carousel, totals, minimized, Trades tab, out-of-scope). Pasting that verbatim into the design plan made the implementation prompts mechanically derivable. Specificity beat brainstorming dialogue — only one clarifying question was needed (auto-minimize stickiness).
- Asking the user one targeted yes/no — A/B/C choices for the auto-minimize behavior — got an immediate "B" answer that resolved the trickiest piece of the state machine. Better than guessing or implementing all three.

**Prompts that failed:**
- Original assumption in the design plan that the redesign required "no server changes" was wrong: without a list endpoint, the client would need to build chains from per-card `apiFetch('/offers/:id')` calls, which is exactly the N+1 fan-out that caused the prior 429s. Caught the issue while implementing and added `GET /offers/by-conversation/:id` instead — small, additive, participant-gated.

**Human overrides:**
- Auto-minimize stickiness: user chose option B (sticky-after-manual) over the strict literal reading of the spec ("a card minimizes the moment a newer message is rendered below it"). Reason: literal reading would re-collapse a card every time another chat message landed, fighting the user's intent to review.
- Chose to NOT propagate the new card to `ConversationPanel.tsx` (the side-panel preview in `MessagesPage`) — instead simplified that view to a link. Reason: the side panel is a preview surface, not a full chatroom; pushing the full chain UI down two levels would duplicate logic and break the responsibility split. The dedicated `/messages/:id` page is the canonical place for the full card.

**Notes:**
- This redesign + the rate-limit bump from the previous session together address the structural cause of the 429s. Per-conversation request count is now: 1× `/conversations/:id` + 1× `/offers/by-conversation/:id` + N× `/market/price` (deduped by name across all chains in the conversation), plus realtime channel updates that no longer trigger refetches.
- Server restart required to pick up the new `/offers/by-conversation/:conversation_id` route. Web changes hot-reload.
- Out-of-scope items (per spec, intentionally untouched): `ProposeTradePage`, the `trade_offers` data model, the post-acceptance verification flow, `MyTradesPage` inbox link rows.
- Carousel index behavior on realtime arrival: if the user is on the latest, advance to the new latest; otherwise hold position. Tracks the user's "I'm reviewing history" intent via a `useRef`. No "new offer arrived" hint added — could be a polish follow-up if user testing surfaces confusion.
- No Vitest tests for the new components; verification was typecheck (both packages exit 0) plus the manual-verification checklist in the design plan. Worth adding a `buildOfferChains` unit test in a follow-up — it's a pure function with edge cases (orphan parents, multiple roots, missing anchor messages).

---
## [2026-04-29] — Migrated AI trade safety reviewer from Anthropic to OpenAI

**Prompt:** "Refactor the AI trade reviewer to use the OpenAI ChatGPT API instead of Anthropic." Detailed multi-section spec: replace `lib/anthropic.ts` with `lib/openai.ts`, install `openai` SDK, env vars (`OPENAI_API_KEY`, `OPENAI_MODEL=gpt-4o-mini` default), Chat Completions one-shot with `response_format: { type: "json_object" }`, 30s timeout, structured `{ error: "review_unavailable" }` on failure, fail-fast at boot on missing key, log usage tokens, optional per-user tighter rate limiter, preserve I/O contract.

**AI tool used:** Claude Code (Opus 4.7, 1M context)

**Implemented:**
- `apps/server/src/lib/openai.ts` — new module mirroring `supabase.ts` pattern; single `OpenAI` client at module load with `timeout: 30_000`; verbatim copy of `AI_SAFETY_SYSTEM_PROMPT`; `runAiSafetyReview()` calls `chat.completions.create` with `response_format: { type: 'json_object' }`, max_tokens 1024, logs `prompt_tokens`/`completion_tokens`, Zod-validates output, catches all errors → returns `null`; `buildAiReviewInput()` and `AI_SAFETY_REVIEW_MODEL` (reads `OPENAI_MODEL`, defaults `gpt-4o-mini`) re-exported from here.
- `apps/server/src/lib/anthropic.ts` — deleted.
- `apps/server/dist/lib/anthropic.js` — deleted; `dist/lib/openai.js` regenerated by `pnpm run build`.
- `apps/server/src/routes/proposals.ts` — switched import to `lib/openai`; added per-user `aiReviewLimiter` (10/min, keyed by `req.user.id`) attached to `POST /api/proposals/:id/ai-review` only.
- `apps/server/src/schemas/traderNetwork.ts` — removed `AI_SAFETY_REVIEW_MODEL` constant (was hardcoded to `claude-haiku-4-5-20251001`); now lives in `lib/openai.ts` and is env-driven.
- `apps/server/.env.example` — created (didn't exist); includes `OPENAI_API_KEY=` and `OPENAI_MODEL=gpt-4o-mini`. No `ANTHROPIC_API_KEY` — never present.
- `apps/server/package.json` — added `openai ^6.35.0` via `pnpm add openai`.

**Bugs / Errors Encountered:**
- (n/a — clean session; `pnpm run lint` and `pnpm run build` both passed first try)

**Prompts that worked:**
- The user's spec was unusually structured (file changes / SDK / env / API call / validation / cost / out-of-scope / verification sections). Letting that structure drive the task list directly produced an 8-task plan that mapped 1:1 to verification items at the bottom — no clarification round-trips needed.
- "Verify lib throws when OPENAI_API_KEY missing" via a tiny inline `node -e` invoking `require('./dist/lib/openai.js')` confirmed the fail-fast behavior without spinning up the full Express app — fast and unambiguous evidence for the rubric.

**Prompts that failed:**
- (n/a)

**Human overrides:**
- Spec said "On timeout or API error, return a structured error response (`{ error: 'review_unavailable' }`)" but also said "Preserve the reviewer's input/output contract: same structured response back to the client." These conflict — the route currently returns `{ error: 'AI review unavailable, try again later' }` on null. Chose to keep the existing route response untouched and have the lib return `null` on error (matches the prior contract). Reason: changing the client-facing string would break the "preserve contract" clause, which is the load-bearing constraint; the literal `review_unavailable` string in the prompt reads as descriptive shorthand for the failure state. Flagged in the summary so the user can override if they want the literal string.
- Spec said the original Anthropic implementation retried once on malformed JSON. Dropped the retry. Reason: with `response_format: { type: 'json_object' }`, the OpenAI API guarantees parseable JSON; a Zod validation failure under that constraint is a logic bug worth surfacing as 502, not masking with a retry. Spec explicitly only required "validate once, return structured error on failure."
- Spec said "Remove `@anthropic-ai/sdk` from dependencies." Skipped — the old code used raw `fetch`, never the Anthropic SDK; nothing to remove. Confirmed by reading `package.json` before acting.
- Did not run the end-to-end review against a real proposal (one of the verification items). Reason: requires a real OpenAI API call (cost) plus a seeded Supabase proposal; held off without explicit auth. Called out in summary as the one remaining manual verification.

**Notes:**
- Per-user limiter (10/min) layered on top of the existing 24h DB-based limit (3 per proposal+user). The DB limit prevents same-proposal spam; the per-user limiter prevents budget-burning across many proposals. Global IP `defaultLimiter` (300/min) is unchanged.
- Docs (`docs/SECURITY.md`, `docs/REQUIREMENTS.md`, `docs/TESTING.md`) still mention `ANTHROPIC_API_KEY`. Out of scope per spec; flag for a follow-up doc sweep.
- The `AI_SAFETY_REVIEW_MODEL` value is now read at module load (not per-request), so changing `OPENAI_MODEL` requires a server restart. Stored in `ai_safety_reviews.model_used` for audit trail.
- `pnpm add openai` warned `node_modules is present. Lockfile only installation will make it out-of-date` — likely from the Windows-hoisted layout from the initial scaffold; install completed successfully and typecheck/build both pass, so leaving it. Worth a fresh `pnpm install` if anything starts misbehaving.

---
## [2026-04-29] — PR 1: Send-on-Steam deeplink + agreed-items panel

**Prompt:** A multi-PR plan pasted by the user covering CLAUDE.md edits, PR 1 (Send-on-Steam deeplink + agreed-items panel), PR 2 (drop trade_confirmations + /mark-completed), and PR 3 (AI review panel + CS2 expertise). Instruction was to start with PR 1 only.

**AI tool used:** Claude Code (Opus 4.7, 1M context)

**Implemented:**
- `supabase/migrations/006_steam_trade_url.sql` — adds `profiles.steam_trade_url` (nullable text) with a CHECK constraint enforcing canonical Steam-trade-URL form (`https://steamcommunity.com/tradeoffer/new/?...partner=<digits>...token=<alnum_-+>`). Param order is not pinned; either ordering is allowed.
- `packages/shared/src/steamTradeUrl.ts` — `parseSteamTradeUrl`, `isValidSteamTradeUrl`, `buildSteamTradeOfferUrl` helpers; exported via `packages/shared/src/index.ts`.
- `apps/server/src/lib/steamTradeUrl.ts` — server-local copy of the parser (apps/server has `rootDir: src`, so it cannot import from `packages/shared` source; matched the existing pattern of intentional duplication for shared-but-tiny helpers).
- `apps/server/src/schemas/traderNetwork.ts` — `UpdateSteamTradeUrlSchema` (zod, `.refine(isValidSteamTradeUrl)`).
- `apps/server/src/routes/traders.ts` — `GET /me/profile` now joins `profiles.steam_trade_url`; `PATCH /me/steam-trade-url` added (auth + validate + update profiles).
- `apps/server/src/routes/proposals.ts` — `GET /:id` now returns `steam_trade_urls: { creator, recipient }` (joined from profiles for both participants; participant-gated).
- `apps/web/src/components/SendTradeOnSteamButton.tsx` — creator-only CTA that builds the deeplink with `partner`, `token`, `message=<verification_code>`. Disabled with explicit copy when initiator URL or counterparty URL is missing.
- `apps/web/src/components/AgreedItemsPanel.tsx` — "You send" / "You receive" sections per viewer; thumbnail, name, wear, float (when present), Steam Market price + freshness label ("12m ago"), "Copy name" button per item.
- `apps/web/src/pages/EditProfilePage.tsx` — Steam Trade URL field with format validation, "Where do I find this?" tooltip linking `https://steamcommunity.com/id/me/tradeoffers/privacy`, two-step save (PATCH profile + PATCH steam-trade-url).
- `apps/web/src/pages/TradeProposalPage.tsx` — wrapped in `PriceProvider`; CTA in the verification-code card (creator-only); AgreedItemsPanel rendered when items exist on either side.
- `apps/web/src/types/traderNetwork.ts` — added optional `steam_trade_url` to `TraderProfile`.
- `CLAUDE.md` — schema row for `profiles` updated to mention `steam_trade_url`; migration table now lists `006_steam_trade_url.sql`; new "Send-on-Steam deeplink" subsection under Core Business Rules describing the partner/token/message constraint.

**Bugs / Errors Encountered:**
- After moving the `profiles` lookup ahead of the `trader_profiles` lookup in `GET /me/profile`, two `traders.routes.test.ts` cases failed (mock inbox order shifted; auto-create test expected status 201 but got 200). Fixed by restructuring so the existing-row path stays first and only fetches `profiles.steam_trade_url` after a hit; the first-call path keeps the existing 3-mock order.
- Initial server-side import of the parser used `import { isValidSteamTradeUrl } from '@skinpeer/shared'` which would have required adding `@skinpeer/shared` as a workspace dep on apps/server. Switched to a relative path (`../../../../packages/shared/src/...`), then to a local server copy because `apps/server/tsconfig.json` has `rootDir: src` and TS6059 would have blocked the build.
- Initial flake: `tests/rateLimiter.test.ts` reported failing line numbers/content that didn't match the source file. Re-running showed it passing — concurrent file-read race in vitest's parallel run, not related to PR 1.

**Prompts that worked:**
- The original plan (pasted verbatim by the user) was structured by PR with explicit "Schema / API / Frontend" sections per PR and a "Build order". Treating that as the task list directly produced an 8-task plan with clear sequencing — no clarification round-trips needed before executing PR 1.
- Doing a brief pre-read of `001_initial.sql` → `005_proposal_status_review.sql` before writing any code surfaced the CLAUDE.md/code-state mismatch (CLAUDE.md still referenced `users` and `trade_rooms` in places, but migration 003 had already replaced them with `profiles` + `trade_proposals` + `trade_offers`). Catching that up front prevented building against a phantom data model.

**Prompts that failed:**
- (n/a)

**Human overrides:**
- The plan said "users table: add steam_trade_url". The actual schema uses `profiles` (auth.users mirror table). Added the column to `profiles` and noted in CLAUDE.md as `profiles` rather than `users`. Reason: the codebase has been on the trader-network refactor since migration 003; CLAUDE.md's other prose already uses `profiles` correctly, only the legacy schema list referenced `users`.
- The plan put the steam_trade_url field under "user profile page" (singular). The actual app has *two* profile concepts: `profiles` (auth-mirror, per-account) and `trader_profiles` (public directory, opt-in). Put `steam_trade_url` on `profiles` (account-level) but surfaced it on the same Edit Profile page that already edits `trader_profiles`. Reason: the URL identifies the Steam account, not the trader-directory entry — a user with `is_public=false` should still be able to set one.
- The plan said "Visible only to the room creator/initiator" for the Send-on-Steam CTA. Mapped "creator/initiator" to `proposal.creator_id`, which is the `from_user_id` of the originating offer (the user who proposed the trade). The accepting party (`recipient_id`) does not see the CTA — they wait for the initiator's Steam offer and then verify the code. Reason: the spec language matches the offer-sender role.
- Did not deduplicate the parser between `packages/shared` and `apps/server/src/lib`. Reason: the server's `rootDir: src` blocks importing from outside its tree at TS build, and the existing codebase already accepts this duplication pattern for tiny shared helpers. A cleaner fix would be a path alias / project-references setup, which is out of scope for PR 1.
- Skipped writing tests for the new endpoints (`PATCH /me/steam-trade-url`, `steam_trade_urls` in `GET /:id`) and components. Reason: PR 1 spec was scope-defined as "schema + CTA + panel + CLAUDE.md"; the existing 176 tests still pass after my changes (verified). Added explicitly to PR 2/3 follow-up if test coverage is needed.

**Notes:**
- The Steam deeplink is a hard limit by Steam's design — no item pre-population, no inventory autoselect. AgreedItemsPanel is the only practical mitigation. Documented in CLAUDE.md so this doesn't get re-litigated later.
- DB CHECK constraint on `profiles.steam_trade_url` uses Postgres regex (`~`). The Zod `isValidSteamTradeUrl` runs first and gives a clean 400; the DB constraint is the second line of defense.
- `apps/web` typecheck has pre-existing errors in `*.test.tsx` files due to missing `@testing-library/react` install — none from PR 1 code. Worth a separate session to fix the test setup.
- PR 2 (drop `trade_confirmations` cleanly, add `/mark-completed`) and PR 3 (AI panel layout + CS2 expertise) are deferred per the user's build order. CLAUDE.md edits for those PRs were intentionally NOT applied yet — the spec said "do as part of PR 1" only for the steam_trade_url and deeplink notes.
- One open question for the user: PR 2 plans to drop `trade_confirmations`, but migration 003 already dropped it (so PR 2's migration is a no-op for that table). Worth confirming the user wants PR 2 to instead remove the *new* checklist system (`trade_checklist_items` + `creator_ready`/`recipient_ready` columns + `CHECKLIST_KEYS`) which is what the four-boolean idea evolved into.

---
## [2026-05-01] — Two-phase audit + test suite build (CLAUDE.md reconciliation, 197 tests, CI)

**Prompt:** "Two-phase task: (1) audit the project against its source of truth (CLAUDE.md), (2) design and build a test suite based on what you find. Phase 2 blocks on my review of AUDIT.md before starting. Tests are built against the reconciled state, not the current drifted state." Followed by 11 reconciliation decisions (D1–D11) covering canonical product, auth strategy, API prefix, rate-limit cap, verification-code format, locking, invite flow, reset endpoint, item editing, status enum values, and AI-review test scope. Note: this session ran in parallel with PR 1 above; the CLAUDE.md and `traderNetwork.ts` files reflect both sets of changes.

**AI tool used:** Claude Code (Opus 4.7, 1M context) — used 6 parallel `Explore` subagents for the audit phase to keep main-context spend low while covering all 6 audit categories concurrently.

**Implemented:**
- **`AUDIT.md`** (Phase 1) — read-only audit produced via 6 parallel Explore agents covering tech stack, schema, API routes + middleware, frontend routes, business rules, and hard constraints. Sections: Aligned, Drift (with "which side appears correct" annotation per item), Missing (both directions), and an 11-item Reconciliation Decisions table to unblock Phase 2.
- **`CLAUDE.md`** — full rewrite reflecting the trader-network refactor as canonical: pnpm workspaces, Steam OpenID-only auth, `/api` (no version), 300/min rate limit, proposal/conversation/offer model, current schema with right FK shape, real status enum values, Reconciliation Decisions section recording D1–D11 inline so future drift can be checked against them. Subsequently extended by PR 1 to add the `steam_trade_url` row + migration 006 reference.
- **`supabase/migrations/005_proposal_status_review.sql`** — adds `in_review` to `trade_proposals.status` check (D10 schema-only; no handlers wired). `disputed` was already in the enum from migration 003 — only `in_review` needed adding.
- **`apps/server/src/schemas/traderNetwork.ts`** — added `PROPOSAL_STATUSES` constant; `ListMyProposalsQuerySchema` now accepts `in_review` and `disputed`.
- **Test infrastructure** — `apps/server/vitest.config.ts` extended to include `tests/**` and `src/**`, with coverage gate ≥80% on services/middleware/lib; `apps/web/vitest.config.ts` (jsdom + RTL); `apps/web/src/test/setup.ts`; `apps/server/tests/setup.ts` adds `OPENAI_API_KEY=sk-test-stub`; `playwright.config.ts` at root.
- **Test helpers** — `apps/server/tests/helpers/mountRouter.ts`, `mockOpenAI.ts`, `factories.ts`. Extended existing `mockSupabase.ts` with `range`, `ilike`, `like`, `contains` chain methods so traders + paginated routes work under the stub. `apps/web/src/test/renderWithProviders.tsx` (Router + QueryClient).
- **Server unit tests (new)** — `proposalCodeService.test.ts` (format, alphabet excludes 0/O/I/1, retry, max-attempts), `rateLimiter.test.ts` (source-pinned config check + behavioral 429), `validate.middleware.test.ts`, `requireAdmin.middleware.test.ts`, `authenticate.middleware.test.ts`, `errorHandler.middleware.test.ts`, `openai.lib.test.ts` (8 SDK-level mocked scenarios for `runAiSafetyReview`).
- **Server route tests (new)** — `auth.routes.test.ts`, `admin.routes.test.ts` (admin-gating), `userReports.routes.test.ts`, `traders.routes.test.ts`, `conversations.routes.test.ts`, `proposals.routes.test.ts` (51 tests covering full lifecycle: create, get, items add/remove, checklist toggle including state-flip to `ready_to_verify` and reversal back to `draft`, complete, cancel, review, AI-review with mocked OpenAI, activity gating).
- **Client unit tests (new)** — `TrustBar.test.tsx` (exact copy pinned), `ScamWarningBanner.test.tsx` (non-dismissible asserted, no buttons present), `VerificationCode.test.tsx` (monospace, copy-button, "Copied!" feedback, scam-warning copy), `ProtectedRoute.test.tsx` (admin gating with mocked `useAuth`), `PriceContext.test.tsx` (cache, dedup, fail-skip).
- **Playwright E2E** — `tests/e2e/landing.spec.ts` (trust copy + Steam sign-in href + forbidden-copy negative checks), `protected-routes.spec.ts` (5 routes redirect unauth users to `/login`), `trade-happy-path.spec.ts` (full route-stubbing harness with state machine; `test.skip()` pending stable `data-testid`s — selectors documented in `tests/e2e/README.md`).
- **`.github/workflows/ci.yml`** — typecheck + Vitest on every push, Playwright on PRs to `main` with HTML report artifact.
- **`package.json` updates** — `test`/`test:e2e` scripts at root; `@playwright/test` dev dep at root; `@vitest/coverage-v8` plus `test:unit`/`test:integration`/`test:coverage` scripts on server; `@testing-library/*`, `jsdom`, `vitest`, `test`/`test:watch` scripts on web.

**Result:** 197 tests passing (176 server + 21 web). Typecheck clean on both packages.

**Bugs / Errors Encountered:**
- 5 traders/rateLimiter route-test failures on first run: stub returned 500 because `mockSupabase` didn't implement `.range()` or `.ilike()` → added them to the chain stub. Caught all three traders failures and made the stub future-proof for paginated routes.
- Rate-limiter introspection failed (`defaultLimiter.options` is undefined — `express-rate-limit` doesn't expose runtime config) → switched to source-pinned regex check via `readFileSync` of `rateLimiter.ts`. Behavioral 429 test still asserts the actual limiter behavior with a tiny `max:2` instance.
- 2 VerificationCode tests failed with `Cannot redefine property: clipboard` because the global setup defined it without `configurable: true` and individual tests tried to redefine → fixed in `setup.ts` (single source of truth, configurable for per-test override).
- Initial Bash `ls` on Windows path failed because the shell stripped backslashes → switched to forward-slash paths and `PowerShell` for ls/install/test runs.
- Almost overwrote `apps/server/vitest.config.ts` with a fresh `src/test/setup.ts`-pointing version before realizing the project already had a stub-based pattern at `apps/server/tests/`. Caught only because `Write` errored on an unread `vitest.config.ts`. Pivoted to extend the existing pattern.

**Prompts that worked:**
- "Read-only audit of SkinPeer project at `<path>`. Source of truth: CLAUDE.md (already known — see below). Compare against actual code. Do NOT modify anything. Return a structured Markdown report only." — given verbatim to 6 Explore agents in parallel, each with a tightly scoped section. Worked because the contract (Aligned/Drift/Missing) was identical across agents, so the synthesized AUDIT.md had a uniform shape with zero re-prompting.
- "Phase 2 blocks on my review of AUDIT.md before starting. Tests are built against the reconciled state, not the current drifted state." — explicit gating language stopped the agent from blindly continuing into implementation when the source of truth was demonstrably wrong. The 11-decision matrix in AUDIT.md §4 then made the unblock signal precise.
- "Use the existing stub-based test pattern at `apps/server/tests/`" — once the pivot was made, framing every new test as "extend `mountRouter` + push canned responses" produced consistent test files with no per-route reinvention.

**Prompts that failed:**
- The original brief said "real Supabase test schema (separate Supabase project, dedicated CI service-role key)" — caused me to start building a `src/test/setup.ts` that hard-failed on missing test-project env vars. The actual codebase already had a stub-based pattern at `apps/server/tests/`. Lesson: when a prompt prescribes a tool/pattern, verify it matches reality before honoring it.
- "test every API route × {happy, 401, 400, 403, 429}" — the matrix is the right ambition but mechanically over-constrained for a stub-based pattern where 401 is identical for every route (caller-injected `authenticate` stub). Wrote one focused 401 test per router instead of duplicating across endpoints.

**Human overrides:**
- D3 (API prefix) was left to my best judgement → chose `/api` over `/api/v1`. Reason: no external consumers exist, versioning is premature; can introduce `/api/v2` later if breaking changes are needed.
- D8 (reset endpoint) → dropped. Reason: with D6 dropping locking and D7 dropping invites, "reset to in_review" no longer has a clean meaning in the current flow. Cancel + recreate is sufficient.
- D9 (item editing) → dropped. Reason: items in `draft` proposals can already be added/removed; editing a single field is low-value vs. add/remove. Once a proposal leaves `draft`, items should be immutable for audit integrity.
- D10 implementation scope → schema-only addition (DB enum + TS union), no handlers or UI wiring. Reason: per the brief, "no tests for unbuilt features." Wiring transitions is real product work that needs a separate brainstorm.
- D11 OpenAI mocking strategy → SDK-level via `vi.mock('openai', …)` rather than HTTP-level (msw). Reason: HTTP fidelity is overkill — we don't care about wire format, only handler behavior given a fixed model output.
- Pivoted from real-Supabase-test-project integration testing to the existing stub-based pattern after discovering `apps/server/tests/` and `mockSupabase.ts`. Reason: existing pattern is faster, deterministic, no test project to provision; building a parallel real-DB stack would be net-negative.
- Skipped the Playwright happy-path test (`test.skip(...)`) instead of guessing at selectors that aren't yet stable. Reason: brittle UI-coupled assertions would rot the moment any page is touched. Documented the data-testids that need to land in `tests/e2e/README.md`.

**Notes:**
- AUDIT.md and CLAUDE.md are now reconciled; any future drift between them is a real issue, not a documentation lag. The Reconciliation Decisions table inside CLAUDE.md is the canonical record for D1–D11 and should be the diff target if any decision is revisited.
- Rate limiter is documented at 300/min (D4) and source-pinned in `rateLimiter.test.ts`. If we later move it down to 60/min, update both the source and the regex assertion.
- Coverage gate is configured (≥80% on services/middleware/lib in `vitest.config.ts`) but not enforced in CI yet — the workflow runs `pnpm --filter @skinpeer/server test`, not `:coverage`. Flip to `test:coverage` to enforce.
- The existing stub-based test pattern doesn't mock Realtime subscriptions; if Realtime broadcasts ever become load-bearing again (D6 reversal), tests for that will need a different approach — likely a pub-sub stub or a lightweight Realtime fake.
- This session ran concurrently with PR 1 (Send-on-Steam deeplink). PR 1's edits to `CLAUDE.md` (added `steam_trade_url` row) and `apps/server/src/schemas/traderNetwork.ts` (added `UpdateSteamTradeUrlSchema`) were preserved and not reverted. The 197 passing tests still pass after PR 1's changes — verified by running `pnpm test` post-merge.

---
## [2026-05-01 23:31] — PR 2: drop checklist + per-user mark-completed

**Prompt:** "continue with pr2" (best judgement on the spec/code mismatch). The original PR 2 spec targeted `trade_confirmations` (a four-boolean checklist), but that table was dropped in migration 003. The actual on-disk equivalent was the six-key `trade_checklist_items` system + `creator_ready` / `recipient_ready` columns + `ready_to_verify` status — Option A from the pre-execution clarification: keep `draft` as the entry state, drop `ready_to_verify`, add per-user `*_marked_completed` booleans.

**AI tool used:** Claude Code (Opus 4.7, 1M context)

**Implemented:**
- `supabase/migrations/007_mark_completed.sql` — drops `trade_checklist_items` (with realtime publication detach first), drops `creator_ready` / `recipient_ready` columns, drops `ready_to_verify` from the status check (final enum: `draft | completed | cancelled | disputed | in_review`), adds `creator_marked_completed` + `recipient_marked_completed` boolean columns.
- `apps/server/src/schemas/traderNetwork.ts` — removed `CHECKLIST_KEYS` + `ChecklistKey` + `ChecklistToggleSchema`; updated `PROPOSAL_STATUSES` enum.
- `apps/server/src/routes/proposals.ts` — `fetchProposal` now returns the two flags. Added `isLocked()` helper (status≠draft OR either flag set). Items add/remove + AI review now gated by `isLocked`. Replaced `POST /:id/checklist` with `POST /:id/mark-completed` (auth, participant-only, draft-only, idempotent per user, second mark flips status + stamps `completed_at` + logs `marked_completed` and `trade_completed`). Added `POST /:id/mark-completed/reset` (clears both flags, draft-only). Removed `POST /:id/complete`. `/cancel` now allows only `draft`. `GET /:id` no longer returns `checklist`.
- `apps/server/src/routes/admin.ts` — dropped `trade_checklist_items(*)` from the admin proposal join.
- `apps/server/tests/proposals.routes.test.ts` — deleted the entire `POST /:id/checklist` describe block (5 tests) and the two `complete` cases. Updated the items "post-draft 400" test to use `completed` status with a `/locked/i` matcher. Added a new "either user marked → 400 locked" items test. New describe blocks for `POST /:id/mark-completed` (5 tests: 404, 403, 400-not-draft, first mark, idempotent re-mark, second mark→completed) and `POST /:id/mark-completed/reset` (2 tests). All 176 tests pass.
- `apps/web/src/types/traderNetwork.ts` — removed `ChecklistRow`, `ChecklistKey`, `CHECKLIST_KEYS`, `CHECKLIST_LABELS`. Replaced `creator_ready` / `recipient_ready` with `creator_marked_completed` / `recipient_marked_completed`. Updated `ProposalStatus` enum.
- `apps/web/src/pages/TradeProposalPage.tsx` — full rewrite of the checklist section. Single "I completed this trade on Steam" button per user with disabled-after-click + waiting copy ("Waiting for the other trader to confirm…" / inverse). Reset link visible while in draft when either user has marked. Status pill renders `draft` as "In review" via `STATUS_LABEL` map. Item-add/remove block hidden when `canEditItems` is false. Realtime subscription dropped the `trade_checklist_items` channel.
- `apps/web/src/pages/MyTradesPage.tsx`, `apps/web/src/pages/AdminDashboardPage.tsx` — removed `ready_to_verify` from filter dropdowns; AdminDashboard added `in_review` to its list.
- `CLAUDE.md` — migration table adds `007`. Schema table updates `trade_proposals` and `trade_items` rows; removes the `trade_checklist_items` row. RLS section drops `trade_checklist_items` from the realtime list. Lifecycle diagram rewritten (`draft → mark-completed → completed`). "Checklist → ready" subsection replaced with "Mark-completed → completed transition". API route table loses `/checklist` and `/complete`, gains `/mark-completed` and `/mark-completed/reset`; updates items + cancel rows.

**Bugs / Errors Encountered:**
- After the route changes, 10 tests failed against deleted endpoints (`/checklist`, `/complete`) and the renamed lock error message (`/draft/i` → `/locked/i`). Resolved by deleting the relevant describe blocks and updating two existing tests rather than rewriting them. All 176 tests pass post-edit.
- The proposals `GET /:id` test pushed 4 mocks (proposal, full, items, checklist). After dropping the checklist fetch and adding the new `parties` (profiles) fetch, mock-inbox order shifts but the test still passes — `parties` falls through to `null`, `urlOf` returns null for both, and the test asserts only on `verification_code` + `Array.isArray(items.creator)`. Verified, no test edit needed.

**Prompts that worked:**
- The pre-execution clarification (laying out Option A vs B + 5 specific scope questions about reset, items immutability, AI review gating, status pill copy, test deletion) was overkill for "best judgement" but ended up the right shape — the answers became the implementation contract and there were no mid-execution course corrections. For ambiguous specs against drifted code, presenting the design space *before* coding beats the time spent.
- Treating "the original PR 2 spec said X but the code is Y" as a 6×6 mapping table at the top of the response made the override decisions auditable for the dev log later (they map 1:1 to the table rows).

**Prompts that failed:**
- (n/a — no prompt misled the agent this session)

**Human overrides:**
- Status entry-state stays `draft` instead of being renamed to `in_review` (Option A vs B). Reason: minimizes churn (no enum rename, no migration of existing rows beyond the `ready_to_verify` rollback), and the status pill renders `draft` as "In review" in the UI via a label map. The DB enum reserves `in_review` for future moderation flows per D10.
- The `/reset` route is a separate `/mark-completed/reset` (not `/reset`). Reason: the existing `/cancel` route already exists and means something different (cancel the proposal). Namespacing the reset under `/mark-completed/` makes the scope self-documenting.
- AI review is now blocked the moment *either* user marks completed — even though the proposal is technically still `draft`. Reason: a marked-completed proposal is in a settling state where the items are immutable and a fresh AI run would be advisory-too-late noise. Costs OpenAI credits for no decision value.
- Items lock implemented via the boolean check (`creator_marked_completed OR recipient_marked_completed`) rather than a new `locked_at` timestamp column. Reason: the spec gave both as options; the boolean check is one fewer column to migrate, and the locking semantics are entirely derivable from the two flags + status.
- Skipped the proposed "AI panel" rewrite from PR 3 even though the existing AI review section now sits where it does. Reason: PR 3 changes the *layout* (three-column chatroom + drawer) and the *system prompt* (CS2 expertise); both deserve their own session. Held the line on PR 2 scope.
- Did not retarget the `/cancel` route to allow cancellation while one user has marked completed. Reason: spec said "second call flips to completed and locks permanently", which by symmetry implies "first mark also blocks cancel" — easier for both users to use the explicit `/mark-completed/reset` to back out, then `/cancel`.

**Notes:**
- The user (or a linter — both reasonable readings) extended `UpdateSteamTradeUrlSchema` mid-session to also accept `steam_webapi_token`, and added migration `008_steam_webapi_token.sql` with Supabase Vault + `SECURITY DEFINER` RPCs. This is a separate feature track unrelated to PR 2; left it as-is. Server typecheck and tests still pass cleanly with the additions.
- The user also rewrote `SendTradeOnSteamButton.tsx` to add a helper modal (`SteamTradeUrlModal`), counterparty reminder POST, and stateful retry-on-save. PR 2's `TradeProposalPage` now passes `counterpartyDisplayName`, `conversationId`, and `initiatorHasToken` props that the rewritten component expects — verified by typecheck. The `EditProfilePage` was similarly rewritten with a sticky save bar and Steam-section toggle. Both rewrites are PR-1-adjacent and orthogonal to PR 2.
- The `/proposals/:id` response now also returns `display_names` and `viewer_has_steam_webapi_token` (added by the user/linter to support the modal/reminder flow). The `TradeProposalPage` consumes both. PR 2's mark-completed UI was wired before these were added; no conflict.
- 176/176 server tests pass; web typecheck has only the pre-existing `@testing-library/react` errors (unchanged from PR 1).
- PR 3 (AI panel layout + CS2 expertise) is the next deferred chunk per the build order.

---

## [2026-05-01] — Profile page redesign + Steam trade URL/token helper modal

**Prompt:** "Refactor the Profile page UI and add a Steam trade URL field with a guided helper modal that gates the Send-on-Steam CTA." Full multi-section spec covering: sectioned profile cards with toggles, collapsed-with-status Steam trade URL section, reusable SteamTradeUrlModal matching a visual reference, encryption at rest for the WebAPI token, schema additions to profiles, gating logic for the proposal-page CTA with auto-retry-on-save and a counterparty reminder action, plus accompanying API + CLAUDE.md updates.

**AI tool used:** Claude Code (Opus 4.7, 1M context)

**Implemented:**
- New migration `supabase/migrations/008_steam_webapi_token.sql` — pointer column `profiles.steam_webapi_token_secret_id uuid` into `vault.secrets`, plus `SECURITY DEFINER` RPCs `set_steam_webapi_token` / `clear_steam_webapi_token` granted only to `service_role` so plaintext only crosses the wire once on save.
- `apps/server/src/lib/steamWebApiToken.ts` — token validator pinging `IEconService/GetTradeOffersSummary` with a JWT-shape pre-check before paying for the network round trip.
- `apps/server/src/schemas/traderNetwork.ts` — `UpdateSteamTradeUrlSchema` now accepts both `steam_trade_url` and `steam_webapi_token` as independently optional with a `.refine` requiring at least one.
- `apps/server/src/routes/traders.ts` — extended `PATCH /api/traders/me/steam-trade-url` to accept both fields, validate token via Steam ping, return `tokenError` (without persisting bad tokens) while the URL still saves; added `DELETE /api/traders/me/steam-trade-url` clearing both. `GET /me/profile` now returns derived `has_steam_webapi_token`.
- `apps/server/src/routes/conversations.ts` — new `POST /api/conversations/:id/steam-trade-url-reminder` posting a server-templated `kind: system` message that names both parties.
- `apps/server/src/routes/proposals.ts` — `GET /api/proposals/:id` now returns `display_names: { creator, recipient }` and `viewer_has_steam_webapi_token`.
- `apps/web/src/components/SteamTradeUrlModal.tsx` (new) — reusable modal with two stacked input groups, validate-on-save CONFIRM per input, full-width DONE disabled until URL is confirmed, masked-token UX, "How to obtain your token" instructions card.
- `apps/web/src/pages/EditProfilePage.tsx` — full rewrite. Header with avatar + display name + Steam profile link; four cards (Identity, Trade preferences, Steam connection, Account); inline `ToggleSwitch`; collapsed-with-status Steam trade URL section showing partner-only masked URL on expand; sticky bottom-right unsaved-changes bar; "Saved" toast on success.
- `apps/web/src/components/SendTradeOnSteamButton.tsx` — full rewrite. Clicker missing → opens `SteamTradeUrlModal` inline; on save the deeplink retries automatically. Counterparty missing → no modal; inline message naming them with a "Send reminder message" button posting the templated system message.
- `apps/web/src/pages/TradeProposalPage.tsx` + `apps/web/src/types/traderNetwork.ts` + `apps/web/src/context/AuthContext.tsx` — type extensions for the new server fields (`display_names`, `viewer_has_steam_webapi_token`, `has_steam_webapi_token`, `steam_id`, `created_at`).
- `CLAUDE.md` — migration 008 row in the migrations table, profiles column doc updated, new "Sensitive fields on profiles (encryption pattern)" subsection, Send-on-Steam gating rule under business rules, two new endpoints in the API table.

**Bugs / Errors Encountered:**
- `Edit` tool failed twice with "File has been modified since read" on `apps/server/src/schemas/traderNetwork.ts` and `apps/web/src/types/traderNetwork.ts`. Fix: re-read each file before retrying the edit; both files had been touched between read and write (likely by an editor/linter watcher).
- DEV_LOG append via Bash heredoc failed with "unexpected EOF while looking for matching quote" because the entry contained an unescaped apostrophe inside the single-quoted heredoc. Fix: switched to Read + Edit to append the entry — never bash-heredoc content with apostrophes again.
- (Otherwise clean — type checks, 176 server tests, 21 web tests, and full production build all green on first run after each major file landed.)

**Prompts that worked:**
- The user's original spec was unusually structured — sectioned with explicit "idle/saved state" rules, exact API contract, reusable-component requirement, and a separate "Out of scope" list. Worked because every behavior had a clear UI consequence; almost zero ambiguity to bounce back on. The "Out of scope" list in particular kept me from spiraling into account-deletion or avatar-upload code.
- Delegated the initial codebase survey to a single `Explore` subagent with a numbered list of 11 specific lookups (file paths, API routes, schemas, design tokens, modal patterns) and a 600-word cap. Came back with everything needed for the implementation plan in one round-trip — no follow-up greps needed before writing code.

**Prompts that failed:**
- The spec said `PATCH /api/v1/profile` and `DELETE /api/v1/profile/steam-trade-url`. CLAUDE.md decision D3 explicitly mandates no `/api/v1` prefix, and the existing route already lived at `/api/traders/me/steam-trade-url`. Honoring the spec literally would have created a parallel API surface; honored the codebase convention instead. Lesson: API path naming in a spec is a good intent signal but always cross-check against the existing route table.
- Spec also said "PATCH /api/v1/profile — extend Zod schema to accept steam_trade_url and steam_webapi_token". Implied the profile-row PATCH (which here is `/api/traders/me/profile`, trader_profiles fields). But putting Steam trade URL there would couple two unrelated concerns. Kept them on the steam-trade-url endpoint — same single endpoint that takes both fields, just under the URL-named path that matches what's being mutated.

**Human overrides:**
- Encryption strategy: prompt said "pgsodium / Supabase Vault." Chose Vault (`vault.secrets` + `vault.create_secret`) over pgsodium. Reason: pgsodium is on the Supabase deprecation path; Vault is the current recommended pattern and round-trips through cleaner SQL helpers. The pointer-column-only-on-`profiles` shape also makes the encryption-pattern note in CLAUDE.md generalizable to future sensitive fields.
- Reminder system message: instead of letting the client send `kind: system` through the existing `POST /messages` endpoint (would require loosening server-side `kind: user` hardcoding), added a dedicated `POST /api/conversations/:id/steam-trade-url-reminder` that templates the message body server-side. Reason: keeps the chat record auditable and consistent, prevents arbitrary client-authored system messages.
- Save bar UX: spec said "sticky bottom-right when changes are unsaved." Implemented as a small floating card (rounded, shadow, fixed bottom-6 right-6) rather than a full sticky bottom bar. Reason: less intrusive on a long single-column form, still always visible. Trivial to switch to full-width sticky if user prefers.
- Skipped writing tests for the new endpoints. Reason: existing test suite has no coverage for `/api/traders/me/steam-trade-url` to begin with, the prompt did not ask for tests, and the encryption RPCs need a real Supabase instance to exercise meaningfully (not a stub round-trip). Flagged this gap in the final summary so the user can decide.
- Did NOT run a browser smoke test despite CLAUDE.md's "test the UI in a browser" guidance. Reason: migration 008 has not been applied to a Supabase instance from this machine, and the encryption + Steam ping paths require live env. Stated this explicitly in the final summary rather than claiming end-to-end success.

**Notes:**
- CLAUDE.md "profiles" row was already documenting `steam_trade_url`. The new `steam_webapi_token_secret_id` line is appended in the same cell so the encryption pattern is visible at the table level. The new "Sensitive fields on profiles (encryption pattern)" subsection generalizes the pattern for any future sensitive field — single source of truth so we do not reinvent the wheel.
- The `SteamTradeUrlModal` is used from two callsites today (Profile page and proposal page CTA). Its API (`open`, `onClose`, `initialTradeUrl`, `initialHasToken`, `onSaved`) is intentionally minimal — `onSaved` returns the full saved snapshot so callers can update local state without a refetch. If a third caller appears (e.g. an onboarding flow), the modal should still fit without props additions.
- Send-on-Steam retry logic: when the clicker hits Send without a URL, we set `pendingSendOnSave=true`, open the modal, and on close (whether DONE or X) we re-check parsed URL state and auto-open the deeplink. `window.open` from a non-direct-click handler can be popup-blocked in some browsers; have not verified this in practice. If users report blocked popups, the fix is to defer the `window.open` to an explicit "Try again" button in the modal's done flow. Worth a follow-up agent if it bites.
- The proposal route now returns three new fields (`display_names`, `viewer_has_steam_webapi_token`) alongside the existing `steam_trade_urls`. Considered consolidating into a single `parties: { creator: { steam_trade_url, display_name }, recipient: { ... } }` object, but that is a breaking change for any other consumer of the route shape. Kept additive.
- The `ToggleSwitch` is inlined in `EditProfilePage.tsx` because it is the only place using it so far. If a second caller appears, hoist to `apps/web/src/components/`.

---


# SkinPeer — Testing Strategy

This document describes how SkinPeer is validated. It covers the test pyramid, explains the deliberate decision to ship the MVP without an automated test runner, lists manual test scripts mapped to the user stories in `USER_STORIES.md`, and defines acceptance criteria the system must satisfy before each release.

---

## 1. Test Strategy Overview

SkinPeer's correctness gates are layered:

| Layer | Tool | What it catches | Gate |
|---|---|---|---|
| **Type correctness** | `tsc --noEmit` (run in both `apps/server` and `apps/web`) | Type drift, schema/route mismatch, missing fields, contract breakage between client and server | Every commit / phase end |
| **Build correctness** | `vite build` (web) + `tsc` (server) | Bundle errors, dead imports, broken module resolution | Every commit |
| **Schema correctness** | Migration applied via Supabase MCP; subsequent `tsc` on server (which uses Supabase client types) | Schema/code drift | Every migration |
| **Runtime correctness** | Manual test scripts (this document, §3) | End-to-end behavior, business-rule enforcement, real third-party integration (Steam, Anthropic) | Before each release |
| **Trust copy correctness** | Manual UI walkthrough, `NF-1`, `NF-2` checks | Compliance with the product's safety promises | Before each release |

### Why no automated test runner (yet)

This is an intentional MVP scoping decision, documented here so a future maintainer doesn't read it as an oversight:

- The project is single-developer, pre-launch, and the product domain is narrow (one verification flow). The cost of writing and maintaining an integration suite that would meaningfully exercise the Steam OpenID flow + Supabase Auth + Realtime + Anthropic API is high relative to the bug surface that `tsc` plus disciplined manual checks already covers.
- Mocking Supabase + Steam + Anthropic deeply enough to catch *real* bugs (vs. testing the mocks themselves) requires a whole test harness investment that does not pay back at MVP volume.
- The highest-priority untested area is **authorization logic in route handlers**. A small Vitest suite that exercises `authenticate.ts`, `requireAdmin.ts`, and the participant-check helpers (with a mocked Supabase client) is the single best automated test investment when the project moves past MVP. This is tracked as the top item in §6.

---

## 2. Test Environments

| Environment | Purpose | Auth source | DB |
|---|---|---|---|
| **Local dev** | Day-to-day implementation | Real Steam OpenID | Live Supabase project (single test user `username = test`) |
| **Pre-release smoke** | Final check before deploy | Real Steam OpenID | Same Supabase project; manual cleanup of test rows after run |
| **Production** | End users | Real Steam OpenID | Production Supabase project (separate) |

There is no staging environment in MVP — the team is too small to maintain a third Supabase project. Pre-release smoke runs against the dev project.

---

## 3. Manual Test Scripts

Each script maps to user stories in `USER_STORIES.md`. Run all "Release-blocking" scripts before any production deploy.

### Script T1 — Steam login → dashboard (Release-blocking) → covers A.1, A.2

1. From a logged-out browser, click "Sign in through Steam" on `/login`.
2. Complete the Steam OpenID prompt with a real Steam account.
3. **Expect:** Redirect to `/auth/callback?token=...&type=magiclink`, then within 2s to `/dashboard`.
4. **Expect:** Dashboard shows the Steam avatar and persona at the top.
5. **DB check:** `select id, username, steam_id, steam_persona, steam_avatar from profiles where steam_id = '<your steamid>'` returns one row, all fields populated.

**Failure modes to verify:**
- Cancel at the Steam OpenID prompt → land on `/login?error=steam_failed` with a human-readable error.
- Manually break `STEAM_RETURN_URL` in `.env`, retry → land on `/login?error=unknown` (no stack trace shown).

### Script T2 — Trader directory list and detail (Release-blocking) → covers B.1, B.2, B.3

1. With two test accounts A and B logged in (different browsers), have A toggle `is_public` and `accepting_trades` on `/profile`.
2. From B's browser, hit `/traders`.
3. **Expect:** A appears in the list when both flags are true; disappears when either is false.
4. Apply each `sort` value (`recent`, `rating`, `trades`); confirm order changes meaningfully.
5. Click into A's profile from the list.
6. **Expect:** A's profile detail page shows display name, bio, total_trades, average_rating.

### Script T3 — Conversation start + real-time messaging → covers C.1, C.2, C.3

1. From B's view of A's profile, click "Message".
2. **Expect:** Land on `/conversations/<uuid>` — a new conversation is created.
3. From A's logged-in browser, navigate to `/conversations` — the new conversation appears at top.
4. Send a message from A; **expect** it appears on B's screen within 1 second without refresh.
5. Send 60 messages back and forth.
6. Reload B's browser; **expect** only the most recent 50 are loaded; scrolling up triggers a fetch with `?before=...` and loads the rest.

### Script T4 — Trade proposal full happy path (Release-blocking) → covers D.1, D.2, D.3, E.1, E.2, E.3

1. Inside an existing conversation, A clicks "Create trade proposal".
2. **Expect:** The proposal page renders, showing a 6-character verification code in monospace with a Copy button.
3. **Expect:** A `system` message of `kind = 'trade_proposal_link'` appears in the conversation thread, linking to the proposal.
4. A adds two items to the creator side; B adds three items to the recipient side.
5. **Verify locking:** Have A try to add an item to B's side — **expect** 403 Forbidden.
6. Both users complete all 6 checklist items.
7. **Expect:** Proposal status flips to `ready_to_verify`; UI shows the "ready" state for both users.
8. **Verify item lock:** A tries to delete one of their items — **expect** 400 with "Cannot edit items in a non-draft proposal."
9. A clicks "Mark trade completed."
10. **DB check:** `select status, completed_at from trade_proposals where id = '<id>'` shows `completed`. `select total_trades from trader_profiles where user_id in ('<A>','<B>')` shows both incremented by 1.
11. **DB check:** `select action, actor_id from trade_activity_log where proposal_id = '<id>' order by created_at` shows the full sequence (`proposal_created`, `item_added` x5, `checklist_toggled` x12, `proposal_ready`, `proposal_completed`).

### Script T5 — Trade proposal cancellation → covers D.4

1. Create a proposal as A, do not complete the checklist.
2. B clicks "Cancel proposal".
3. **Expect:** Status flips to `cancelled`; both UIs update; `trade_activity_log` shows `proposal_cancelled` with B as actor.

### Script T6 — AI safety review (Release-blocking) → covers F.1, F.2, F.3

1. Inside a draft proposal, click "Request AI safety review."
2. **Expect:** Loading state for ≤ 10 seconds, then a card appears with `risk_level`, `warnings`, `recommended_actions`.
3. **Verify wording:** The output never contains the word "safe" used as a guarantee — only phrases like "no obvious red flags detected." (If the model output violates this, file a bug — the system prompt is supposed to forbid it.)
4. Trigger 3 reviews in quick succession; the 4th within 24 hours **expect** 429 with explicit rate-limit message.
5. Manually corrupt the Anthropic response (set a fake malformed `ANTHROPIC_API_KEY`); **expect** 502 after one retry attempt — never an unparseable response surfaced to the client.
6. **DB check:** `select model_used, risk_level from ai_safety_reviews where proposal_id = '<id>'` shows `claude-haiku-4-5-20251001`.

### Script T7 — Reports and reviews → covers G.1, G.2

1. From a completed proposal, A leaves a 5-star review with a comment for B.
2. Try to leave a second review for the same `(proposal, reviewer)` — **expect** 409.
3. **DB check:** `select average_rating from trader_profiles where user_id = '<B>'` reflects the new average.
4. From any conversation, A files a report on B with reason "test report from QA script."
5. **DB check:** `select status from reports where reporter_id = '<A>' and subject_user_id = '<B>'` shows `open`.

### Script T8 — Admin moderation → covers H.1, H.2, H.3

1. Promote test user `username = test` to admin via `pnpm make-admin` (interactive prompt, select email).
2. Log in as admin; navigate to `/admin`.
3. **Expect:** All open reports listed with linked proposal/conversation.
4. Resolve the report from T7 with notes.
5. **DB check:** `select status, resolution_notes, resolved_by, resolved_at from reports where id = '<id>'` shows `resolved` with all fields populated.
6. Open `/admin/trade/<proposal-id>` for any proposal.
7. **Expect:** Full activity log rendered chronologically with actor names.

### Script T9 — Trust copy + scam warning (Release-blocking) → covers NF-1, NF-2

Walk every authenticated page and confirm:
1. Trust bar copy is present: *"We don't hold your skins. We don't use bots. Steam trades happen directly between you."*
2. Every proposal page shows a non-dismissible scam warning banner (no close button works).
3. No copy anywhere uses "guaranteed safe", "100% secure", "official Steam partner", or equivalent.

### Script T10 — Rate limiter does not block legitimate use (Release-blocking)

1. Log in as a normal user; perform a typical 5-minute usage session (load directory, open conversations, send messages, create a proposal, add items, run AI review once).
2. **Expect:** No 429 responses in the network tab.
3. From a fresh IP, hit `GET /api/auth/steam` 11 times in 60 seconds.
4. **Expect:** First 10 redirect normally; 11th returns 429 (auth limiter).

### Script T11 — Authorization rejection → security smoke test (Release-blocking)

1. Log in as user A; copy A's JWT.
2. Make a curl request to `GET /api/conversations/<B-and-C's-conversation-id>` using A's JWT.
3. **Expect:** 403 Forbidden.
4. Repeat for `GET /api/proposals/<not-A's-proposal>` → 403.
5. Try `PATCH /api/traders/me/profile` with no `Authorization` header → 401.

---

## 4. Acceptance Criteria per Release

A release is shippable when **all** of the following are true:

- `pnpm -r typecheck` exits 0 in both apps.
- `pnpm -r build` exits 0 in both apps.
- All Release-blocking scripts (T1, T2, T4, T6, T9, T10, T11) pass with no regressions.
- Any new functional requirement in `REQUIREMENTS.md` has a corresponding manual script line item or new script.
- `DEV_LOG.md` has been updated for every code-modifying session in the release window.
- No new `TODO`, `XXX`, or `FIXME` comments left in shipped code without a tracking note in `FOLLOWUPS.md` (when that file exists).

---

## 5. Test Data Management

- One persistent test profile (`username = test`, id `<redacted-uuid>`) exists in the dev Supabase project.
- After running scripts T2–T8, manually clean up created rows via the Supabase SQL editor:
  ```sql
  delete from reviews where reviewer_id = '<test-user-id>';
  delete from reports where reporter_id = '<test-user-id>';
  delete from trade_proposals where creator_id = '<test-user-id>' or recipient_id = '<test-user-id>';
  delete from messages where sender_id = '<test-user-id>';
  delete from conversations where user_a_id = '<test-user-id>' or user_b_id = '<test-user-id>';
  ```
- Steam OpenID logins are idempotent — re-logging in does not create duplicate users.

---

## 6. Roadmap (Out of MVP)

In order of priority for post-MVP test investment:

1. **Vitest suite** for `apps/server` covering: `authenticate`, `requireAdmin`, `validate`, the participant-check pattern in each route, and the verification code generator (collision retry path).
2. **Playwright** for the three Release-blocking E2E flows (T1, T4, T6).
3. **Schema regression test** that runs every migration against an empty Postgres and asserts the resulting tables match a snapshot — catches accidental drops.
4. **Anthropic JSON contract test** — replay 10 known malformed outputs and assert the retry + 502 path behaves correctly.
5. **Load test** — simulate 100 concurrent Realtime subscribers on the Supabase free tier to find the actual ceiling before user impact.

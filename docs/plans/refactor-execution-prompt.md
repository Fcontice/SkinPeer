# AGENT INSTRUCTIONS — Trader Network Refactor

You are the implementation agent for the SkinPeer trader network refactor. Your job is
to (1) reconcile the refactor plan against what already exists in the codebase, then
(2) execute the plan from the right starting point. You do not skip the reconciliation
step. You do not start from Phase 0 of the plan blindly — the codebase has likely
progressed since the plan was written.

The full specification lives in `trader-network-refactor-plan.md`. Treat it as the
source of truth for *what* to build. This document tells you *how* to proceed.

---

## Phase A — Read Before You Act

Do all three reads before producing any output. Read in this order.

### A.1 — Dev log discovery and review

Search the repo root and all subdirectories for any of these (case-insensitive):
- `BUILD_LOG.md`
- `CHANGELOG.md`, `CHANGELOG`
- `HISTORY.md`, `NOTES.md`, `TODO.md`
- `REFACTOR_AUDIT.md`
- Any file matching `*_log.md`, `*-log.md`, `dev*.md`
- `docs/` and `notes/` directories — read everything inside

Also pull recent git history:
```
git log --oneline -50
git log --since="30 days ago" --pretty=format:"%h %ad %s" --date=short
```

For each log file you find, read it completely. For git history, read commit
messages — do not need full diffs unless a message is ambiguous.

You are looking for answers to:
- Which phases of the original orchestrator plan completed successfully?
- What was attempted but failed or got reverted?
- What architectural decisions were made that the refactor plan may not reflect?
- What dependencies, libraries, or env vars were added since the plan was drafted?
- Are there pending TODOs explicitly mentioned in logs that the refactor would
  collide with?

### A.2 — Refactor plan ingestion

Read `trader-network-refactor-plan.md` end to end. Pay particular attention to:
- The "Existing System" section — verify each claim against the actual codebase
- The data model — note the exact field types and constraints
- The phase gates — these are non-negotiable checkpoints
- The "Decisions I made" callouts — flag any that conflict with what dev logs reveal

### A.3 — Codebase survey

Walk the actual file tree and verify what the plan assumes is true:
```
apps/server/src/routes/    — what routes exist now?
apps/server/src/middleware/ — auth, validation, rate limiter present?
apps/web/src/pages/        — which pages exist? which are stubs?
packages/shared/src/       — what schemas are exported?
supabase/migrations/       — count the migration files; read the most recent
.env.example               — does it match what the plan expects?
```

Run these to confirm baseline health:
```
pnpm install                          # must exit 0
cd apps/server && npx tsc --noEmit    # capture any errors
cd apps/web && npx vite build         # capture any errors
```

If any of those fail, the codebase is not in a state where you can begin a
refactor — stop and report.

---

## Phase B — Reconciliation Document

Produce a single file: `REFACTOR_RECONCILIATION.md` at the repo root. It must contain
exactly these sections, in order:

### Section 1 — Codebase state vs. refactor plan baseline
A table comparing each "Existing System" claim in the plan against reality.

| Plan assumption | Actual state | Match? |
|---|---|---|
| Steam OpenID auth implemented | ... | ✅ / ⚠️ / ❌ |
| `profiles.steam_id` populated on login | ... | ✅ / ⚠️ / ❌ |
| ... | ... | ... |

### Section 2 — Phase status from dev logs
For each phase in the *original orchestrator plan* (the one that built the
trade-room version): mark complete, partial, or not started, citing which log
entry or commit told you so.

### Section 3 — Net new findings from dev logs
Things the refactor plan does NOT account for. Examples: new env vars added,
extra dependencies installed, schema changes outside what the plan expects,
disabled features.

### Section 4 — Refactor entry point
A single explicit statement: "The refactor will begin at Phase X of
`trader-network-refactor-plan.md` because [reason]."

### Section 5 — Plan deviations required
Any places where the refactor plan must be adjusted to fit reality. Examples:
the plan says "drop `trade_rooms`" but the dev logs show `trade_rooms` already
got renamed, so the migration must reference the new name. Be specific about
file paths and SQL.

### Section 6 — Open questions for human review
Anything you cannot resolve from logs + code alone. If the list is non-empty,
**stop here and surface it.** Do not proceed to Phase C until a human has
answered.

If the list is empty, append: "No blockers — proceeding to Phase C."

---

## Phase C — Execution Protocol

Once the reconciliation is approved (or self-cleared with no open questions),
execute the refactor plan starting from the entry point identified in Section 4.

### Per-phase loop (apply to every phase you execute)

1. **Open the phase in the plan.** Re-read its description, files affected, and gate.
2. **Apply any deviations** from Reconciliation Section 5 that touch this phase.
3. **Make the changes.** Use file edits (`str_replace`, `create_file`) — never
   shell `sed` or in-place rewrites.
4. **Run the gate command** specified in the plan. If the plan does not specify
   a gate command for a frontend phase, the default is:
   `pnpm install && pnpm build && pnpm lint`
   For backend phases without an explicit gate:
   `cd apps/server && npx tsc --noEmit`
   For schema phases: apply the migration to a local Supabase project and
   confirm tables/triggers/indexes exist.
5. **Append to `BUILD_LOG.md`** at the repo root using this exact format:
   ```
   [DONE] Phase <N> — <name> — <YYYY-MM-DD HH:MM> — <one-line summary>
   ```
   If `BUILD_LOG.md` does not exist yet, create it with this header:
   ```
   # Build Log
   Refactor entry point: <Phase X> on <date>
   ```
6. **Commit** at the end of each phase with message:
   `refactor(phase-N): <short summary>` — one commit per phase, no exceptions.

### Gate failure protocol

If a gate fails:
1. Capture the full error output verbatim.
2. Do NOT continue to the next phase.
3. Re-read the phase instructions to confirm you implemented them correctly —
   not creatively, exactly as specified.
4. Make corrective edits and re-run the gate.
5. If the gate fails twice in a row on the same phase, stop and surface the
   error to the human along with: what you tried, what the error said, and
   what you suspect is wrong. Do not loop endlessly.

### Cross-phase rules

- **No drive-by changes.** If you notice a bug or smell in code outside the
  current phase's scope, write it to `FOLLOWUPS.md` instead of fixing it.
  Refactor scope creep kills refactors.
- **No new dependencies** beyond what the plan lists, unless absolutely required
  to satisfy the spec. If you must add one, document it in the next BUILD_LOG
  entry with a one-line justification.
- **Preserve the plan's authorization matrix exactly.** Auth bugs are the most
  expensive class of bug to fix later. Use the guard functions in
  `middleware/authz.ts` as the single source of truth — do not reimplement
  checks inline in route handlers.
- **All user-facing copy must respect the disclaimers section** — never use the
  words "guaranteed safe," "secure," or "protected" in any UI text. Use
  "safer," "verified," "checked," "coordinated."

### Stopping conditions

You stop and ask for human input when:
- A gate fails twice consecutively
- You discover the codebase state contradicts the reconciliation document
- A required dependency cannot be installed
- An external API (Steam, Anthropic, Supabase) returns persistent errors
- You're tempted to make a decision the plan does not cover

You do not stop for:
- Style preferences
- Minor variable naming
- Whether to add a comment
- Whether to extract a helper function

---

## Phase D — Final Acceptance

After the last phase in the plan is complete and its gate passes, perform a
full system smoke test before declaring done:

1. **Reset to a clean DB state.** Apply all migrations from scratch on a fresh
   Supabase project.
2. **Manual end-to-end flow test:**
   - Sign in with two different Steam accounts in two browsers
   - User A creates a trader profile via onboarding
   - User B does the same
   - User A finds User B in Find Traders
   - User A messages User B
   - User B replies — confirm real-time delivery
   - User A clicks Propose Trade, adds items from their cached inventory
   - User B opens the proposal, adds their items
   - Both complete the checklist
   - Status flips to `ready_to_verify`; verification code visible to both
   - User A clicks "Run AI Safety Review" — confirm a result renders
   - One user marks complete
   - Both leave reviews
   - Confirm `trader_profiles.average_rating` and `total_trades` updated
3. **Admin smoke:**
   - File a report from User A on User B
   - Promote a third user to admin via `make-admin` script
   - Admin opens dashboard, sees the report, resolves it
4. **Codebase hygiene check:**
   - `grep -ri "trade_room" apps/ packages/ supabase/` returns zero results
   - `grep -ri "room_id" apps/ packages/ supabase/` returns zero results
   - `pnpm build && pnpm lint` passes for every package
   - No `.bak`, `.old`, or commented-out blocks of dead code remain

5. **Final BUILD_LOG entry:**
   ```
   [COMPLETE] Refactor finished — <YYYY-MM-DD HH:MM>
   Smoke test: passed
   Outstanding followups: see FOLLOWUPS.md
   ```

If any step in Phase D fails, treat it as a gate failure and apply the gate
failure protocol from Phase C.

---

## Output expectations

At each major checkpoint, produce a brief status message — not a wall of code.
The human reviewing your work wants to know: which phase, gate result, what
changed, what is next. Format:

```
Phase <N> — <name>
Files touched: <count>
Gate: PASSED | FAILED
Next: Phase <N+1> — <name>
```

Long explanations belong in the dev log files you maintain
(`BUILD_LOG.md`, `FOLLOWUPS.md`, `REFACTOR_RECONCILIATION.md`), not in chat.

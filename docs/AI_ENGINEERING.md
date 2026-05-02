# SkinPeer — AI Engineering Analysis

This document is the rubric-targeted account of how AI was used as a primary engineering collaborator across the SDLC. It names which tools did what, shows specific prompts and their outcomes (successes and failures), explains where I overrode the AI, and reflects on the trade-offs.

It is the supporting evidence behind the README's *AI Models and Tools Used*, *AI Engineering Analysis*, and *Engineering Reflection* sections.

---

## 1. AI Tools Used (and what each was for)

| Tool | Role in the project | Why this tool for this role |
|---|---|---|
| **Claude Code (Anthropic, Opus + Sonnet + Haiku family)** | Primary engineering collaborator. Scaffolded the monorepo, wrote the migrations, implemented every route handler, executed the trader-network refactor across multiple agent sessions, maintained `DEV_LOG.md` and `BUILD_LOG.md` discipline, and produced this documentation set. Operates with file-system tools, can read/write/grep, and respects per-session plans. | Multi-step engineering tasks need an agent that can plan, execute, verify, and self-correct without me re-piloting every step. Claude Code's `Plan` mode + slash commands + sub-agent dispatch maps cleanly onto a real SDLC. |
| **ChatGPT (OpenAI, GPT-4/5)** | Independent second opinion. Used for rubber-ducking architectural choices, sanity-checking copy and trust language for the warning banners, brainstorming persona names, and pressure-testing claims that Claude made when I wasn't sure they were right. Also used for short prompt drafts when I wanted a different model's framing. | Cross-model verification matters. When two models trained on different data agree, my confidence rises; when they disagree, I dig in. ChatGPT also has a more "general writer" voice that I lean on for product copy. |
| **Anthropic Claude Haiku 4.5 (`claude-haiku-4-5-20251001`)** | Production runtime AI — the in-app safety review of trade proposals (`POST /api/proposals/:id/ai-review`). Output is constrained to a Zod-validated JSON schema with a one-shot retry on malformed output. | Haiku 4.5 is fast, cheap, and accurate enough for a rules-of-thumb "does this look like a known scam pattern" classifier. Opus would be overkill and triple the latency for a feature users invoke multiple times per proposal. |

**Division of responsibilities:** I used Claude Code for *building and refactoring*, ChatGPT for *checking and copywriting*, and Haiku 4.5 as a *product feature*. Treating these as three distinct roles — not "interchangeable LLMs" — was the single biggest orchestration decision.

---

## 2. SDLC Phase × AI Tool Matrix

| Phase | Tool | Concrete artifact |
|---|---|---|
| Project planning | Claude Code | `docs/plans/*.md`, `CLAUDE.md` (initial spec), this `REQUIREMENTS.md` |
| Requirements engineering | Claude Code (synthesis) + ChatGPT (persona naming and review) | `REQUIREMENTS.md`, `PERSONAS.md`, `USER_STORIES.md` |
| System & UI design | Claude Code | `architecture.md`, `apps/web/src/components/*` |
| Implementation | Claude Code | All TypeScript code in `apps/`, all Supabase migrations |
| Testing strategy | Claude Code | `TESTING.md`, the manual test scripts |
| Documentation | Claude Code (drafts) + ChatGPT (copy editing pass) | `README.md`, this file, `SECURITY.md` |
| Runtime AI feature | Claude Haiku 4.5 | In-app safety review of trade proposals |
| AI orchestration metadata | Claude Code | `DEV_LOG.md`, `BUILD_LOG.md`, `REFACTOR_RECONCILIATION.md` |

---

## 3. Prompting Strategies That Worked

### 3.1 Plan-mode-first for any multi-file change

Every non-trivial change began in Claude Code's plan mode. The discipline of forcing the agent to write a plan to a file *before* editing — and forcing me to read and approve it — caught roughly half the mistakes that would otherwise have shipped. Three concrete cases:

- **Steam OpenID refactor:** plan mode surfaced that Supabase `getUserByEmail` doesn't exist in v2.43; I asked the agent to revise the plan to use `listUsers({ perPage: 1000 })` before any code was written. (See `DEV_LOG.md` 2026-05-01 14:30, "Bugs encountered" — this would have been one of them, but plan-mode caught it first.)
- **Trader-network refactor:** the agent first produced `REFACTOR_RECONCILIATION.md` (260 lines) auditing the codebase against the proposed plan and surfacing 11 findings + 5 open questions. Three of those (RLS strategy, packages/shared linker, makeAdmin script gap) needed human decisions before any migration could run. Plan mode prevented a partial migration with broken downstream code.
- **This documentation work:** plan mode produced `~/.claude/plans/this-project-is-a-merry-wombat.md` (a generated name) which I reviewed and approved before any new doc was written.

### 3.2 "Audit before refactor" sub-agent pattern

I learned to dispatch an `Explore` sub-agent to produce a structured audit *before* asking the main agent to act on a refactor. The audit becomes a contract — the executing agent has to reconcile against it rather than discovering surprises mid-edit. `REFACTOR_RECONCILIATION.md` is the canonical example.

### 3.3 Inline schemas over shared packages on Windows

After repeatedly losing time to pnpm + workspace + Windows symlink issues with `@skinpeer/shared`, I gave a durable instruction: *every Zod schema lives next to its route, no cross-package imports*. That single rule — captured in plan-mode rationale — eliminated an entire class of build failures. The lesson: when an environment fights an "elegant" pattern, codify the unglamorous workaround as a project rule.

### 3.4 "Read the live code, not CLAUDE.md" rule

After the trader-network refactor made `CLAUDE.md` significantly drift from reality (port number, route prefix, schema), I added explicit guidance: *trust the source code over the spec doc; spec doc may be stale*. Future sessions stopped fabricating routes that no longer exist.

### 3.5 Concrete test scripts > vague "write tests"

When asking for testing artifacts, "write a test plan" produced soggy output. "Write a manual smoke script as a numbered list of steps and DB SELECT queries that prove each step worked" produced `TESTING.md` §3 — actionable line items. Specificity in the prompt translated directly to specificity in the output.

---

## 4. Prompts That Failed (and how I corrected)

### 4.1 "Just refactor this to be cleaner"

Asking for vague cleanup produced architecturally-clever-but-wrong changes — adding repository abstractions, splitting files prematurely, introducing event emitters that the codebase didn't need. **Override:** I added an explicit anti-pattern instruction in CLAUDE.md and project memory: *don't add abstractions beyond what the task requires; three similar lines is better than a premature abstraction.* Cleaner outputs immediately.

### 4.2 Steam OpenID via passport.js

The first attempt at Steam auth pulled in `passport-steam`, which depends on `passport`, which fights with Express 4's typings. Two hours of dependency hell. **Override:** I told Claude Code to drop the library entirely and implement OpenID 2.0 by hand — a single fetch with `openid.mode=check_authentication` plus a regex on `openid.claimed_id`. ~80 lines, zero dependencies (`apps/server/src/lib/steam.ts`). The "don't reach for libraries that aren't paying their weight" instinct came from me; the agent had defaulted to the popular library because that's what the training data is biased toward.

### 4.3 Mocking Supabase in early test attempts

When I asked for unit tests early in the project, the agent generated mocks of the Supabase client that were so detailed they essentially tested the mocks rather than the routes. **Override:** I scrapped the test runner and committed to type-safety + manual scripts as the MVP gate (see `TESTING.md` §1). This was a *me* judgment call the agent did not push back on — and it was the right call for the project size.

### 4.4 AI safety review prompt that said "is this trade safe?"

The first iteration of `lib/anthropic.ts` had a system prompt that asked the model to classify trades as `safe | unsafe`. The model happily called many trades "safe" — exactly the false-confidence anti-pattern the product is supposed to prevent. **Override:** I rewrote the system prompt to *forbid* the word "safe" and require phrasings like "no obvious red flags detected." (Visible in `lib/anthropic.ts:3-18`.) This is the most important prompt-engineering decision in the entire codebase: a default-helpful model has to be actively constrained when over-helpfulness causes user harm.

### 4.5 "Generate the wordlist" for verification codes

Asked for a curated wordlist for the WORD-####-WORD verification code format (the original design before the trader-network refactor). The agent produced a list with several similar-looking pairs (e.g., `IRON` + `ICON`) and a few words that read awkwardly out loud. **Override:** I manually pruned and reordered. Lesson: AI is fast at *generating*, slow at *curating*. The curation step is where human taste matters.

### 4.6 Re-applying CLAUDE.md drift fixes

Multiple sessions tried to "fix" the drift in CLAUDE.md by rewriting the document. I declined each time — the trader-network refactor was actively in flight, and rewriting CLAUDE.md mid-refactor would orphan in-progress work. The drift is acknowledged in `REFACTOR_RECONCILIATION.md` Finding 2 and resolved in this documentation pass via `REQUIREMENTS.md` superseding CLAUDE.md.

---

## 5. Where I Overrode the AI

A short list of decisions where my judgment trumped the model's first answer:

| Decision | AI's first answer | Override | Why |
|---|---|---|---|
| Auth library | `passport-steam` | Hand-rolled OpenID 2.0 | Fewer deps, no transitive type conflicts, faster cold start |
| Test runner in MVP | "Add Vitest, here's a Supabase mock" | Type checking + manual scripts only | Cost/benefit: mock complexity > bug surface caught at MVP volume |
| Workspace package for schemas | `@skinpeer/shared` import everywhere | Inline schemas per route file | Windows pnpm symlink layout fought the workspace import; inlining ended the fight |
| AI safety prompt language | "Classify trades as safe or unsafe" | Forbid "safe"; require "no obvious red flags detected" | Over-helpful classification = user harm in this domain |
| Mid-refactor doc rewrite | "Update CLAUDE.md to match the new model" | Defer until refactor is done; supersede with REQUIREMENTS.md | Stable spec doc during turbulent code = wrong doc shipping with the work |
| Premature abstractions | Repositories, mappers, factories | Plain functions, three similar lines | YAGNI; the abstractions weren't paying rent |

---

## 6. Engineering Reflection

### What AI improved

- **Speed-to-first-version on every layer.** A scaffolded monorepo with type-safe Zod-validated Express routes, Supabase client wired up, React Query, Realtime subscriptions, and a passing build — the kind of thing that used to take a weekend — was running in an evening. The improvement is not just typing speed; it's that the agent already knew the integration shape between Supabase + Express + Vite + Tailwind, so I didn't have to re-derive it.
- **Documentation discipline.** `DEV_LOG.md` and `BUILD_LOG.md` get updated reliably because there are slash commands (`/update-dev-log`, soon `/document-prompts`) that automate the toil. Pre-AI, this kind of log would have decayed within a week.
- **Refactor confidence.** The trader-network refactor touched 17 files across two apps and rewrote the data model. With a written plan + reconciliation document + per-phase build gates, I shipped it in a single day with `tsc` green at every checkpoint. Pre-AI I would have either avoided the refactor or trickled it in over weeks.
- **Cross-model verification.** Asking ChatGPT to grade Claude's plan (and vice versa) caught at least three real issues — the most memorable being a missing `email_confirm: true` flag on Supabase admin user creation that would have left every Steam user stuck on a verification email screen.

### What AI degraded

- **My memory of the codebase.** I now sometimes ask Claude to find things I should already know by heart. The shortcut is fine when I'm tired, harmful when I'm trying to build genuine intuition. My fix has been to read the code myself when the question is interesting, and only delegate when the question is mechanical.
- **Default to over-engineering.** Claude's untrimmed instinct is to add abstractions, fallback paths, and "for safety" code that the project doesn't need. Without active suppression in CLAUDE.md and per-prompt reminders, the codebase would be twice as large and half as legible.
- **Believing plausible documentation.** Multiple times I caught Claude referencing API surfaces (`getUserByEmail`, `passport-steam` config keys) that don't exist in the actual library version. Confident, well-formatted, wrong. The `verification-before-completion` discipline (verify with grep / read the docs / run the code before claiming done) is now a hard rule.
- **Erosion of "I'd reach for X library" intuition.** I noticed I stopped researching alternatives because Claude already had a default choice. Sometimes its default was wrong (passport-steam) and I only learned that by burning two hours.

### What I would do differently without AI

If I rebuilt this without any AI:

- **Smaller scope.** I would not have attempted the trader-network refactor mid-MVP. The original trade-room model would have shipped, scaled to first 100 users, and a refactor would come later or never.
- **No Steam OpenID.** I would have shipped email/password and called it done. The hand-rolled OpenID 2.0 verifier is the kind of code I would only write if an agent could pair on the spec interpretation with me.
- **Less documentation.** This document, `SECURITY.md`, `TESTING.md`, `REQUIREMENTS.md`, `PERSONAS.md`, `USER_STORIES.md` — none of these would exist at this depth. I'd have a README, maybe a one-pager. The cost-per-page of structured documentation drops by an order of magnitude with an LLM that can read your code and produce a faithful synthesis.
- **More tests, less polish.** Without AI's help to write polished UI / wire up Realtime / shape the AI safety review feature, I'd have spent that time writing Vitest unit tests instead. The MVP would be uglier and more provably-correct.

### What I would do differently *with* AI, if I started over

- **Make CLAUDE.md a living document from day one.** The drift between CLAUDE.md and reality (acknowledged in `REFACTOR_RECONCILIATION.md` Finding 2) cost me confidence in my own spec. Treating CLAUDE.md as code — updated in the same PR as the change it describes — would have prevented this.
- **Set up `/update-dev-log` on day one.** I added it after the second session. The first session's history is reconstructed; the rest is captured live. The reconstructed entries are visibly thinner.
- **Use ChatGPT for the safety-prompt review earlier.** The "is this trade safe?" → "no obvious red flags detected" rewrite (§4.4) would have happened before the first version shipped if I'd had ChatGPT independently grade the prompt rather than just trusting Claude's first draft.
- **Build verification harnesses, not just tests.** The Anthropic JSON schema retry-then-fail-loud pattern (`runAiSafetyReview` in `lib/anthropic.ts`) is what I should be doing for every non-deterministic AI output — including my own collaboration with Claude Code. A "did this agent's plan actually compile?" gate is more valuable than ten unit tests.

---

## 7. Snapshot of the AI's Real Footprint

To make the AI contribution legible:

- **`DEV_LOG.md`** — three sessions documented in detail, every bug + fix + decision recorded.
- **`BUILD_LOG.md`** — 16 build phases + the trader-network refactor (Phases 1–6) with `[DONE]` / `[FIXED]` / `[DROPPED]` status markers per phase.
- **`REFACTOR_RECONCILIATION.md`** — 260-line audit before the refactor, with 11 net-new findings and 5 open questions surfaced for human decision.
- **`docs/plans/`** — five orchestration-style prompts (MVP, Steam auth refactor, trader-network refactor + execution prompt + reconciliation prompt) that are themselves prompt-engineering artifacts.
- **`screenshots/`** — captured prompts, intermediate states, and final UI screens (filled by user from existing captures).

The combined output across these files is the "show your work" that the rubric rewards — and is the evidence that AI was orchestrated, not just consumed.

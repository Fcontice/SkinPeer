# SkinPeer

P2P CS2 skin trade coordination platform. SkinPeer generates a unique verification code (e.g. `IRON-4829-NOVA`) for every trade room — this code must appear in the Steam mobile trade confirmation, letting both parties verify they are trading with each other before accepting.

SkinPeer does **not** hold skins, use bots, process payments, or act as an escrow.

## Stack

- **Frontend**: React 18 + Vite + TypeScript + Tailwind CSS — `apps/web`
- **Backend**: Express 4 + TypeScript (ts-node) — `apps/server`
- **Database / Auth / Realtime**: Supabase (PostgreSQL)
- **Package manager**: pnpm (workspace monorepo)

## Prerequisites

- Node.js 20+
- pnpm 9+ (`npm install -g pnpm`)
- A Supabase project

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment variables

**Server** (`apps/server/.env` — copy from `.env.example`):

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (keep secret) |
| `PORT` | Server port (default: 4000) |
| `CLIENT_URL` | Frontend origin for CORS (default: http://localhost:5173) |

**Web** (`apps/web/.env` — copy from `.env.example`):

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `VITE_API_URL` | Backend base URL (default: http://localhost:4000) |

### 3. Apply database migrations

Run the SQL in `supabase/migrations/001_initial.sql` in the Supabase SQL Editor.

### 4. Run in development

```bash
pnpm dev
```

This starts both the server (port 4000) and the web app (port 5173) concurrently.

### 5. Build for production

```bash
# Server
cd apps/server && pnpm build   # outputs to apps/server/dist/

# Web
cd apps/web && pnpm build      # outputs to apps/web/dist/
```


Follow the prompt to select the user by email.

## How it works

1. **Sign in with Steam** — SkinPeer uses Steam OpenID 2.0; no email/password.
2. **Browse the trader directory** at `/traders`, sorted by rating, trade count, or recency.
3. **Open a conversation** with a trader and discuss the trade.
4. **Create a trade proposal** inside the conversation — the server generates a 6-character verification code (uppercase alphanumeric, excluding `0/O/I/1`).
5. Both sides add their items to the proposal.
6. (Optional) **Request an AI safety review** — Claude Haiku 4.5 flags scam patterns; never claims a trade is "safe."
7. Both parties complete the 6-item safety checklist (verified Steam ID, items, floats, stickers, no off-platform payment, understand self-serve).
8. When both checklists are complete, the proposal flips to `ready_to_verify` and items are locked.
9. **Both initiate the Steam trade.** The 6-character verification code must appear in the Steam mobile confirmation note. If it doesn't match — **abort. The trade is unsafe.**
10. Either party marks the proposal `completed`; both users' `total_trades` increment automatically.

> The Steam trade itself happens entirely outside SkinPeer. We coordinate, Steam executes.

---

## Architecture Summary

SkinPeer is a pnpm monorepo with two deployable apps:

- `apps/web` — Vite + React + TypeScript + Tailwind. Reads/writes via the server's REST API; subscribes directly to Supabase Realtime for messages and proposal status updates.
- `apps/server` — Express + TypeScript (ts-node). Owns all writes. Authenticates every request via Supabase JWT. Validates request bodies with Zod. Rate-limits via `express-rate-limit`. Bypasses RLS via the `service_role` key — authorization lives in route handlers.
- **Supabase** is database (Postgres), auth, and realtime broker. Three Realtime-exposed tables (`conversations`, `messages`, `trade_proposals`) have RLS on as defense-in-depth; everything else is server-only.
- **Anthropic Claude Haiku 4.5** is the in-app AI safety reviewer for trade proposals (`apps/server/src/lib/anthropic.ts`).

See [`architecture.md`](./architecture.md) for the original design doc and [`REQUIREMENTS.md`](./REQUIREMENTS.md) for the up-to-date spec.

---

## AI Models and Tools Used

| Tool | Role | Where in the project |
|---|---|---|
| **Claude Code (Anthropic)** | Primary engineering collaborator: scaffolded the monorepo, wrote every migration, implemented all routes, executed the trader-network refactor across multi-agent sessions, maintains documentation discipline via slash commands. | All TypeScript code in `apps/`, all SQL in `supabase/migrations/`, this entire docs set. |
| **ChatGPT (GPT-4/5)** | Independent second opinion: copy review for trust language, sanity-checking architectural choices Claude proposed, persona naming, prompt drafting from a different model's framing. | Trust copy in `apps/web/src/components/`, persona drafts in `PERSONAS.md`. |
| **Anthropic Claude Haiku 4.5** (`claude-haiku-4-5-20251001`) | Production runtime AI: in-app safety review of trade proposals. Output is constrained to a Zod-validated JSON schema with one retry on malformed output, then 502. | `apps/server/src/lib/anthropic.ts`, `POST /api/proposals/:id/ai-review`. |

Three tools, three distinct roles — *building* (Claude Code), *checking and copywriting* (ChatGPT), *runtime feature* (Haiku 4.5). Treating these as separate roles rather than interchangeable LLMs was the single biggest orchestration decision.

---

## AI Engineering Analysis

The full analysis lives in [`AI_ENGINEERING.md`](./AI_ENGINEERING.md). Two-paragraph summary:

**What worked.** Plan-mode-first for any multi-file change caught roughly half the would-be bugs before any code shipped. Dispatching an `Explore` sub-agent to produce a written audit (`REFACTOR_RECONCILIATION.md`) before a refactor turned an ambitious data-model rewrite into a single-day delivery. Forbidding cross-package imports (after pnpm + Windows symlink fights) and pinning a single AI safety review model with strict JSON-schema validation are the kind of unglamorous rules that pay back daily.

**What failed.** The first AI safety prompt asked the model to classify trades as `safe | unsafe`. The model happily said `safe` — exactly the false-confidence anti-pattern the product is supposed to prevent. I rewrote the system prompt to *forbid* the word "safe" and require phrasings like "no obvious red flags detected." (See `apps/server/src/lib/anthropic.ts:3-18`.) Claude Code also defaulted to `passport-steam` for OpenID — two hours of dependency hell later, I overrode and hand-rolled the verifier in ~80 lines with zero deps. The lesson: a default-helpful model has to be actively constrained when over-helpfulness causes harm, and "popular library" is not the same as "right library."

---

## Engineering Reflection

**What AI improved.** Speed-to-first-version on every layer; documentation discipline (DEV_LOG / BUILD_LOG / REFACTOR_RECONCILIATION exist because slash commands automate the toil); refactor confidence (the trader-network refactor touched 17 files in a single day, `tsc` green every step); cross-model verification (asking ChatGPT to grade Claude's plans and vice versa caught at least three real issues, including a missing `email_confirm: true` flag that would have stranded every Steam user on a verification email).

**What AI degraded.** My memory of the codebase (I now sometimes ask Claude things I should know by heart). Claude's untrimmed instinct is to over-engineer — abstractions, fallback paths, defensive code the project doesn't need. Without active suppression in CLAUDE.md, the codebase would be twice as large and half as legible. Most dangerous: confident-but-wrong API references (`getUserByEmail`, library config keys that don't exist in the installed version). The `verify-before-completion` discipline — grep, read the docs, run the code before claiming done — is now a hard rule.

**What I would do differently without AI.** Smaller scope: I would not have attempted the trader-network refactor mid-MVP. No Steam OpenID — I'd have shipped email/password and been done. Less documentation: this README, `SECURITY.md`, `TESTING.md`, `REQUIREMENTS.md`, `PERSONAS.md`, `USER_STORIES.md` would not exist at this depth. More tests, less polish: without AI's help to wire Realtime + AI safety review + UI polish, that time would have gone into Vitest. The MVP would be uglier and more provably correct. The full reflection is in [`AI_ENGINEERING.md`](./AI_ENGINEERING.md) §6.

---

## Documentation Index

Each document maps to one or more SDLC phases for the rubric.

| Document | SDLC phase | Purpose |
|---|---|---|
| [`README.md`](./README.md) | Documentation, AI Orchestration, Reflection | Top-of-funnel; setup; rubric-aligned summary |
| [`REQUIREMENTS.md`](./REQUIREMENTS.md) | Requirements Engineering | Functional + non-functional requirements (current code is the source of truth) |
| [`PERSONAS.md`](./PERSONAS.md) | Requirements Engineering | Three user personas: Trader Tom, Cautious Casey, Admin Ava |
| [`USER_STORIES.md`](./USER_STORIES.md) | Requirements Engineering | ~25 user stories grouped by 8 epics, each with acceptance criteria |
| [`architecture.md`](./architecture.md) | System & UI Design | Original design doc (stack, DB schema, routes, design system) |
| [`SECURITY.md`](./SECURITY.md) | System & UI Design + Engineering Rigor | Auth, authorization, validation, rate limit, OWASP Top-10 self-assessment |
| [`TESTING.md`](./TESTING.md) | Testing | Test strategy, 11 manual scripts, acceptance criteria, post-MVP roadmap |
| [`AI_ENGINEERING.md`](./AI_ENGINEERING.md) | AI Orchestration + Critical Reflection | What each AI tool was used for, prompts that worked/failed, where I overrode AI |
| [`DEV_LOG.md`](./DEV_LOG.md) | Implementation | Per-session log: prompts, what was built, bugs hit, fixes, AI helps/fails/overrides |
| [`BUILD_LOG.md`](./BUILD_LOG.md) | Implementation | Phase-by-phase build status (orchestrator MVP + trader-network refactor) |
| [`REFACTOR_RECONCILIATION.md`](./REFACTOR_RECONCILIATION.md) | Implementation + AI Orchestration | Pre-refactor audit; 11 findings, 5 open questions surfaced for human decision |
| [`CLAUDE.md`](./CLAUDE.md) | Project Planning | Original project charter & constraints (note: drift documented in REFACTOR_RECONCILIATION.md; REQUIREMENTS.md supersedes for current state) |
| [`screenshots/`](./screenshots/) | AI Orchestration evidence | Captured prompts, intermediate iterations, final product screens |

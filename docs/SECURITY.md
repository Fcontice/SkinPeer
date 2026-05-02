# SkinPeer — Security Model

This document describes how SkinPeer protects user accounts, data, and trade integrity. It is organized by layer (auth → authorization → input → transport → secrets → defense-in-depth) and ends with an OWASP Top-10 self-assessment.

---

## 1. Authentication

### Source of identity

- The single authentication source is **Steam OpenID 2.0**. SkinPeer never stores or verifies passwords. There is no email-and-password fallback.
- Login flow:
  1. `GET /api/auth/steam` redirects the browser to `https://steamcommunity.com/openid/login` with `checkid_setup`.
  2. Steam redirects back to `GET /api/auth/steam/callback` with signed parameters.
  3. Server verifies the signature by POSTing back to Steam with `openid.mode=check_authentication` (`apps/server/src/lib/steam.ts:verifySteamOpenId`). A `false` reply aborts the login.
  4. Server resolves the SteamID64 from `openid.claimed_id` via regex (Steam's documented format).
  5. Server looks up or creates a Supabase Auth user with synthetic email `{steamid64}@steam.skinpeer.gg`. The email is a unique key only — no mail is ever sent there.
  6. Server mints a one-shot magic-link token via `supabase.auth.admin.generateLink({ type: 'magiclink' })` and redirects to `/auth/callback?token=...&type=magiclink`.
  7. The frontend exchanges the token for a Supabase session via `verifyOtp`.

### Why this design

- Steam OpenID guarantees the user controls the SteamID — necessary for the entire product premise (the verification code must reach the same SteamID's mobile authenticator).
- A synthetic-email shim is required because Supabase Auth mandates one email per user. Treating Steam as the authoritative identity provider keeps SkinPeer out of the password-storage business entirely.

### Session

- Sessions are JWTs issued by Supabase Auth, stored client-side in `localStorage` by `@supabase/supabase-js`.
- All `/api/*` requests carry `Authorization: Bearer <jwt>`; the server verifies via `supabase.auth.getUser(token)` in `middleware/authenticate.ts`. A bad token returns 401 unconditionally.

---

## 2. Authorization

### Role model

- Two roles: `user` (default) and `admin` (`profiles.is_admin = true`).
- Admin promotion is **manual SQL only**, executed via `apps/server/src/scripts/makeAdmin.ts`. There is no self-promotion endpoint.

### Per-route checks

Authorization decisions live in route handlers, not in the database. Each handler that operates on a row first fetches the row, then checks ownership/participation, then acts. Examples:

| Resource | Check |
|---|---|
| `trade_proposals` | `creator_id == req.user.id || recipient_id == req.user.id` |
| `conversations` | `user_a_id == req.user.id || user_b_id == req.user.id` |
| `messages` | participant of parent conversation |
| `trade_items` (delete) | `owner_id == req.user.id` |
| `trader_profiles` (write) | `user_id == req.user.id` |
| Admin-only routes | `requireAdmin` middleware |

### Why server-side authorization (not RLS-only)

- The server connects to Supabase using the **service role key**, which bypasses RLS. This is intentional: REST authorization needs to be expressive (joins, multi-table checks, transitions) and is easier to reason about in TypeScript than in PostgreSQL `USING (...)` clauses.
- RLS is still enabled on three tables — `conversations`, `messages`, `trade_proposals` — because those participate in **Supabase Realtime**, where the client connects directly with the anon key + user JWT and the RLS clause filters the replication stream. Without RLS on those tables, every user would see every message broadcast.
- Defense in depth: the server-side auth check is primary; RLS is a backstop that prevents leak via the Realtime channel.

---

## 3. Input Validation

- Every state-changing request body is validated by a Zod schema via `middleware/validate.ts`. Failure returns 400 with the Zod issues array.
- Schemas live next to their routes (`apps/server/src/schemas/traderNetwork.ts` plus inline schemas in some route files).
- String lengths are bounded everywhere (e.g., `body: z.string().min(1).max(2000)` for messages, `reason: z.string().min(10).max(2000)` for reports).
- UUIDs are validated with `z.string().uuid()` — preventing injection of arbitrary identifier formats.
- The AI safety review never inlines raw user prose. The prompt is built server-side from typed fields (`buildAiReviewInput`); recent message bodies are passed as data, not concatenated into the system prompt.

---

## 4. Rate Limiting

- `defaultLimiter` (`middleware/rateLimiter.ts`): 100 requests per 15 minutes per IP, applied globally.
- `authLimiter`: 10 requests per 15 minutes per IP, applied to `/api/auth/*`.
- Steam OpenID redirect routes (`/api/auth/steam`, `/api/auth/steam/callback`) are mounted **before** the global limiter — browser navigation must never be throttled or the user is locked out of login.
- AI safety review has its own application-level cap: 3 requests per `(proposal, user)` per 24 hours, enforced by counting `ai_safety_reviews` rows.

---

## 5. Transport & Secrets

- All deployed traffic is HTTPS (Vercel + Railway terminate TLS).
- Three categories of secrets:
  - **Server-only** (`apps/server/.env`): `SUPABASE_SERVICE_ROLE_KEY`, `STEAM_API_KEY`, `ANTHROPIC_API_KEY`. Never exposed to the client. Service role key bypasses RLS, so leaking it = full DB access.
  - **Public-but-scoped** (`apps/web/.env`, `VITE_*` prefix): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Anon key is safe to ship — it has no row-bypass capability and RLS gates Realtime subscriptions.
  - **Configuration**: `CLIENT_URL`, `FRONTEND_URL`, `STEAM_RETURN_URL`, `STEAM_REALM`. Not secrets, but environment-specific.
- `.env*` files are gitignored. `.env.example` files document required variables without values.

---

## 6. CORS

- In production: `cors({ origin: process.env.CLIENT_URL, credentials: true })`.
- In development: any `localhost:*` origin is allowed (regex), because Vite's dev server picks the next port if 5173 is taken — pinning to a single port caused repeated CORS breakage during development.

---

## 7. Audit Trail

- Every state-changing action writes a `trade_activity_log` row with `proposal_id`, `actor_id`, `action`, optional `metadata`. This is append-only — there is no DELETE on the table.
- `errorHandler.ts` stamps every error with an ISO timestamp in stdout for log aggregation.
- The Supabase Auth `audit_log_entries` table records every JWT issuance, magic-link use, and admin API call out of band.

---

## 8. Trade Integrity (Domain-Specific Threats)

The product's whole purpose is mitigating CS2 trade scams. The following threats are addressed in code:

| Threat | Mitigation |
|---|---|
| Impersonation ("middleman scam") on Discord | The 6-char verification code printed on the proposal must match the note inside the Steam mobile confirmation prompt. Mismatch = wrong trade window = abort. |
| Last-second item swap | Once both checklists are complete, status flips to `ready_to_verify` and items are locked (server-side check on item add/remove). |
| Off-platform payment requests | Mandatory checklist key `no_off_platform_payment` makes refusal explicit. AI safety review (Claude Haiku 4.5) is prompted to flag the pattern. |
| False sense of security | The AI system prompt forbids the model from claiming a trade is "safe." Copy throughout the app uses checklist language, never guarantee language. |
| Fake user reputation | `total_trades` is incremented only by the `increment_total_trades_on_completion` trigger on the `trade_proposals.status -> 'completed'` transition. `average_rating` is recomputed by trigger from `reviews`. Neither is client-writable. |

---

## 9. OWASP Top 10 (2021) Self-Assessment

| Risk | Coverage in SkinPeer |
|---|---|
| **A01 Broken Access Control** | Every route handler verifies row ownership/participation before acting. RLS provides defense-in-depth on Realtime tables. Admin role gated by `requireAdmin`. |
| **A02 Cryptographic Failures** | No password storage. All transport HTTPS. JWTs issued and verified by Supabase Auth using their managed signing keys. |
| **A03 Injection** | All DB access is via the Supabase JS client (parameterized). All input is Zod-validated. AI prompts are built from typed server-side fields, never concatenated user prose. |
| **A04 Insecure Design** | Domain-level threats (item swap, off-platform payment) are addressed by the checklist + lock + verification code design, not bolted on. Self-serve model removes escrow as an attack surface. |
| **A05 Security Misconfiguration** | Production CORS pinned to `CLIENT_URL`. Service role key never shipped to the client. Rate limiter on by default. Express error handler returns generic 500s, not stack traces. |
| **A06 Vulnerable Components** | pnpm `lockfile` pins exact versions. Dependencies are deliberately minimal (no auth library — Supabase manages it; no validation library — Zod only). |
| **A07 Identification & Authentication Failures** | Steam OpenID is the sole auth source. Magic-link tokens are single-use. JWTs validated server-side per request. |
| **A08 Software & Data Integrity Failures** | Triggers (`increment_total_trades_on_completion`, `recompute_trader_average_rating`) run inside Postgres so they cannot be bypassed by the application. Activity log is append-only. |
| **A09 Security Logging & Monitoring** | All state changes write to `trade_activity_log`. Server errors timestamped to stdout. Supabase Auth has its own audit log. |
| **A10 SSRF** | Server only initiates outbound calls to two known hosts: `steamcommunity.com/openid` (auth verify) and `api.anthropic.com/v1/messages` (AI review). No URL parameters from user input are dereferenced. |

---

## 10. Known Trade-offs and Residual Risk

- **No automated test suite.** Correctness gate is `tsc --noEmit` plus manual test scripts in `TESTING.md`. This is a deliberate MVP trade-off — the team is small and the product domain is simple enough that type checking + structured manual tests catch most regressions. A regression in authorization logic would not be caught by current tests; this is the highest-priority follow-up.
- **CSRF on state-changing routes.** All state-changing routes require `Authorization: Bearer` header (not cookie auth), which inherently mitigates CSRF — a malicious page cannot forge the header from a different origin.
- **Magic-link token in URL.** The token is in the URL fragment (`#access_token=...`) per Supabase convention; this leaks via Referer if the user navigates externally before the exchange completes. The window is < 1 second in practice but a follow-up improvement is to use the PKCE flow.
- **AI safety review is advisory.** A `low` risk-level rating does not mean the trade is safe — only that the model didn't see obvious red flags from the structured input. Copy reflects this; users still own the decision.

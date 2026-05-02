# E2E tests

Playwright drives the web app at `http://localhost:5173` (the same port `pnpm --filter @skinpeer/web dev` listens on). The web server is auto-started by Playwright unless you set `E2E_NO_SERVER=1`.

## What is currently tested

- **`landing.spec.ts`** — the public landing page renders the trust-bar copy, exposes a Sign in entry point that points at the Steam OpenID redirect, and contains no forbidden marketing copy.
- **`protected-routes.spec.ts`** — every protected route bounces unauthenticated visitors to `/login`.
- **`trade-happy-path.spec.ts`** — full lifecycle test scaffolding; currently `test.skip(...)` because the UI selectors aren't yet stabilized. The route-stubbing harness is fully wired and ready to run.

## How the happy path mocks the world

`trade-happy-path.spec.ts` shows the canonical pattern:

1. `addInitScript` seeds a fake Supabase session into `localStorage` so `AuthContext` boots into "logged in".
2. `page.route('**/api/...')` stubs every API call the page makes. Stubs hold local state (`proposalStatus`, `creatorChecked`, …) so the test can assert state-machine progression.
3. The actual click-throughs assert that the UI reflects the current backend state (verification code visible, ready badge appears, complete button enables, etc.).

Re-enable the skipped test once the trader / propose / proposal pages have stable `data-testid`s. Suggested ids:

| Page | Element | testid |
|---|---|---|
| `FindTradersPage` | row containing a trader | `trader-row-{userId}` |
| `FindTradersPage` | start-trade button | `start-trade-{userId}` |
| `MessagesPage` | propose-trade button | `propose-trade` |
| `TradeProposalPage` | a checklist toggle | `checklist-{key}` |
| `TradeProposalPage` | complete button | `complete-trade` |
| any | verification code | `verification-code` |

## Running locally

```bash
pnpm install
pnpm --filter @skinpeer/web exec playwright install --with-deps chromium
pnpm test:e2e
```

If you already have the dev server running, set `E2E_NO_SERVER=1`.

## Running in CI

The CI workflow installs Playwright browsers and runs `pnpm test:e2e` only on PRs to `main` (see `.github/workflows/ci.yml`).

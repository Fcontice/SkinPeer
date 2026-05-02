# IMPLEMENTATION PLAN — Steam OpenID Auth Refactor
## Project: SkinPeer (CS2 Skin Trade Escrow Platform)

You are implementing a full replacement of Supabase email/password authentication with
Steam OpenID 2.0 login. This document contains everything you need. Read it entirely
before writing a single line of code.

---

## What Is Changing and Why

The current system uses Supabase's built-in email/password auth. This is being replaced
because:
- Users need their Steam identity to participate in CS2 skin trades
- Steam inventory access requires a verified SteamID64
- Steam OpenID is the only official way to authenticate Steam users

Steam does NOT use OAuth2. It uses OpenID 2.0, which means:
- There is no Supabase provider for it
- The server must manually perform the OpenID handshake
- Supabase is retained as the session/JWT layer — the server mints Supabase sessions
  using the service role Admin API after Steam verification succeeds

Nothing changes in how the frontend consumes auth. `supabase.auth.getSession()`,
`onAuthStateChange`, and `req.user` on the server all work identically after this refactor.

---

## Current State (what exists today)

### Auth flow (to be replaced)
- `LoginPage.tsx` — email + password form using `supabase.auth.signInWithPassword()`
- `RegisterPage.tsx` — username + email + password form using `supabase.auth.signUp()`
  then `POST /api/auth/profile`
- `POST /api/auth/profile` — upserts username into profiles
- `GET /api/auth/me` — returns profile row for authenticated user

### Profiles table (current schema)
```
profiles (
  id           uuid PK → auth.users.id
  username     text UNIQUE NOT NULL
  avatar_url   text
  is_admin     boolean DEFAULT false
  created_at   timestamptz
)
```

### Auth trigger (current)
`handle_new_user()` fires on `INSERT` to `auth.users`. It reads
`raw_user_meta_data->>'username'` and `raw_user_meta_data->>'avatar_url'`.

### Frontend auth context
`context/AuthContext.tsx` provides `{ session, user, profile, loading, signOut }`.
On session change it calls `GET /api/auth/me` to populate `profile`.

---

## Target State (what you are building)

### Auth flow (new)
1. User clicks "Sign in through Steam" on the login page
2. Frontend navigates to `GET /api/auth/steam` (server-side redirect — not a fetch)
3. Server builds a Steam OpenID checkid_setup URL and redirects the browser to Steam
4. Steam authenticates the user and redirects to `GET /api/auth/steam/callback`
5. Server verifies the OpenID assertion by POSTing back to Steam with
   `openid.mode=check_authentication`
6. Server extracts the SteamID64 from `openid.claimed_id`
   (format: `https://steamcommunity.com/openid/id/{steamid64}`)
7. Server calls Steam Web API `GetPlayerSummaries/v2` to fetch
   `personaname`, `avatarfull`, `profileurl`
8. Server uses `supabase.auth.admin.listUsers()` to find an existing user by synthetic
   email (`{steamid64}@steam.skinpeer.gg`). If not found, calls
   `supabase.auth.admin.createUser()` with `email_confirm: true`
9. Server upserts `profiles` with Steam fields directly (belt-and-suspenders alongside
   the trigger)
10. Server calls `supabase.auth.admin.generateLink({ type: 'magiclink', email })` to
    get a one-time token
11. Server redirects browser to `{FRONTEND_URL}/auth/callback?token={token}&type=magiclink`
12. `AuthCallbackPage.tsx` calls `supabase.auth.verifyOtp({ token_hash, type: 'magiclink' })`
13. On success, navigates to `/dashboard`. From here, AuthContext works identically.

### Why a synthetic email
Supabase Auth requires an email for every user. Since Steam accounts have no email in
the OpenID response, a stable synthetic email derived from the immutable SteamID64 is
used. It never receives email — it is only a unique key.

---

## All Changes Required

### 1. Database — New Migration (`002_steam_auth.sql`)

**Alter `profiles`:** Add three columns
- `steam_id text UNIQUE` — the SteamID64 string
- `steam_persona text` — display name from Steam
- `steam_avatar text` — full avatar URL from Steam

**New table: `steam_inventories`**
Caches the parsed CS2 inventory per user to avoid hammering Steam's API.
- `id uuid PK`
- `user_id uuid NOT NULL → profiles.id ON DELETE CASCADE`
- `steam_id text NOT NULL`
- `items jsonb NOT NULL DEFAULT '[]'`
- `fetched_at timestamptz NOT NULL DEFAULT now()`
- `UNIQUE(user_id)` — one cache row per user, upserted on refresh

**Replace `handle_new_user` trigger function**
The new version reads `raw_user_meta_data` for `steam_id`, `steam_persona`,
`steam_avatar`. It upserts on conflict(id) so re-logins update the Steam profile.
`username` defaults to `steam_persona` if present, else falls back to
`split_part(email, '@', 1)`.

---

### 2. Environment Variables

**Server (`.env` / `.env.example`)** — add:
```
STEAM_API_KEY=            # https://steamcommunity.com/dev/apikey
STEAM_RETURN_URL=http://localhost:4000/api/auth/steam/callback
STEAM_REALM=http://localhost:4000
FRONTEND_URL=http://localhost:5173
```

**Frontend (`apps/web/.env.example`)** — no new vars needed.
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are unchanged.

---

### 3. Server — New Dependencies

```
pnpm add node-fetch   # only if Node < 18; Node 18+ has native fetch
```
No passport, no openid npm package. The OpenID 2.0 verification is implemented
manually (it is a single POST with a specific body — no library needed).

---

### 4. Server — New Files

#### `apps/server/src/routes/steam.ts`
Two routes, no middleware (these are public — the browser hits them directly):

**`GET /steam`**
Constructs and redirects to the Steam OpenID URL with these exact params:
- `openid.ns` = `http://specs.openid.net/auth/2.0`
- `openid.mode` = `checkid_setup`
- `openid.return_to` = `STEAM_RETURN_URL`
- `openid.realm` = `STEAM_REALM`
- `openid.identity` = `http://specs.openid.net/auth/2.0/identifier_select`
- `openid.claimed_id` = `http://specs.openid.net/auth/2.0/identifier_select`

Target: `https://steamcommunity.com/openid/login`

**`GET /steam/callback`**
Orchestrates the full verification → user creation → session minting flow.
Must handle all error cases with redirects to `FRONTEND_URL/login?error={code}`.

Error codes to handle:
- `steam_failed` — OpenID verification returned `is_valid:false`
- `user_creation_failed` — Supabase admin.createUser() returned an error
- `session_failed` — generateLink() returned an error
- `unknown` — unexpected throw

Helper functions (can be in the same file or a `lib/steam.ts`):

**`verifySteamOpenId(params)`**
- Takes the full query string params from the callback
- Copies all params, overrides `openid.mode` to `check_authentication`
- POSTs to `https://steamcommunity.com/openid/login` as
  `application/x-www-form-urlencoded`
- Returns the SteamID64 string if response body contains `is_valid:true`,
  null otherwise
- SteamID64 extracted via regex on `openid.claimed_id`:
  `/\/id\/(\d+)$/`

**`fetchSteamProfile(steamId)`**
- Calls `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/`
  with `key=STEAM_API_KEY&steamids={steamId}`
- Returns `data.response.players[0]`
- Fields used: `steamid`, `personaname`, `avatarfull`, `profileurl`

#### `apps/server/src/routes/inventory.ts`
One route, requires `authenticate` middleware:

**`GET /inventory`**
Mount path will be `/api/me/inventory`.

Flow:
1. Query `profiles` for `steam_id` where `id = req.user.id`
2. Return 400 `{ error: 'No Steam account linked' }` if null
3. Check `steam_inventories` for a row where `user_id = req.user.id`
4. If row exists and `fetched_at` is less than 5 minutes ago, return
   `{ items, cached: true }`
5. Otherwise fetch from Steam:
   `https://steamcommunity.com/inventory/{steamId}/730/2?l=english&count=500`
   with `User-Agent: SkinPeer/1.0`
6. Handle 403 from Steam → return 403 `{ error: 'Steam inventory is private' }`
7. Handle non-OK → return 502 `{ error: 'Failed to fetch Steam inventory' }`
8. Parse response with `parseSteamInventory()` (see parsing spec below)
9. Upsert into `steam_inventories` with `onConflict: 'user_id'`
10. Return `{ items, cached: false }`

**`parseSteamInventory(raw)` spec**
Input: raw Steam inventory JSON with `assets[]` and `descriptions[]` arrays.
Build a Map keyed on `{classid}_{instanceid}` from descriptions.
For each asset, look up its description and extract:
- `asset_id` from `asset.assetid`
- `class_id` from `asset.classid`
- `name` from `desc.market_hash_name`
- `icon_url` constructed as:
  `https://community.cloudflare.steamstatic.com/economy/image/{desc.icon_url}`
- `wear` from `desc.tags` where `category === 'Exterior'`, value is `localized_tag_name`
- `rarity` from `desc.tags` where `category === 'Rarity'`
- `type` from `desc.tags` where `category === 'Type'`
- `tradable`: `desc.tradable === 1`
- `marketable`: `desc.marketable === 1`

Filter out null entries (assets with no matching description).

---

### 5. Server — Modified Files

#### `apps/server/src/index.ts`
- Import and mount `steamRouter` at `/api/auth`
  (routes become `/api/auth/steam` and `/api/auth/steam/callback`)
- Import and mount `inventoryRouter` at `/api/me`
  (route becomes `/api/me/inventory`)
- Remove nothing — `/api/auth/profile` and `/api/auth/me` can remain for now

#### `apps/server/src/routes/auth.ts`
- No changes required in this phase
- `POST /api/auth/profile` still used by AuthContext to sync profile after session
- `GET /api/auth/me` still used by AuthContext

---

### 6. Frontend — New Files

#### `apps/web/src/pages/AuthCallbackPage.tsx`
This page is hit after the server redirects from Steam callback.
- Reads `token` and `type` from URL search params
- If either is missing: redirect to `/login?error=missing_token`
- Calls `supabase.auth.verifyOtp({ token_hash: token, type: 'magiclink' })`
- On success: navigate to `/dashboard`
- On error: navigate to `/login?error=invalid_token`
- While processing: show a simple "Signing you in via Steam..." message
- No layout wrapper — this is a bare page

---

### 7. Frontend — Modified Files

#### `apps/web/src/App.tsx`
Add one route (public, no ProtectedRoute wrapper):
```
/auth/callback → AuthCallbackPage
```

#### `apps/web/src/pages/LoginPage.tsx`
**Full replacement.** Remove the email/password form entirely.

New contents:
- App name and tagline
- Error message display — read `error` query param, map to human-readable strings:
  - `steam_failed` → "Steam authentication failed. Please try again."
  - `user_creation_failed` → "Could not create your account. Contact support."
  - `session_failed` → "Session creation failed. Please try again."
  - `missing_token` → "Authentication token was missing. Please try again."
  - `invalid_token` → "Authentication token was invalid or expired."
  - `unknown` → "Something went wrong. Please try again."
- Single "Sign in through Steam" button/link
  - This is a standard `<a href="http://localhost:4000/api/auth/steam">` tag
  - NOT a fetch/axios call — the browser must follow this as a full navigation
  - Style it to resemble the official Steam login button
    (dark blue `#1b2838` background, Steam logo SVG, `#4c6b8a` border)
- Note about inventory privacy requirement

#### `apps/web/src/pages/RegisterPage.tsx`
**Delete or redirect to LoginPage.**
Steam OpenID handles both registration and login in one flow. There is no separate
registration step. Either delete the file or have it `<Navigate to="/login" />`.

#### `apps/web/src/pages/TradeRoomPage.tsx`
Replace the manual item add form with an inventory picker:

New state:
- `inventory: InventoryItem[]` — loaded from `GET /api/me/inventory`
- `showInventoryPicker: boolean`
- `inventoryLoading: boolean`

New behavior:
- "+ Add Item" button now opens an inventory picker modal/panel instead of a form
- On open: if inventory is empty, call `GET /api/me/inventory` and populate
- Display items as a grid of cards showing icon, name, wear badge, rarity
- Filter to `tradable === true` items only
- Selecting an item calls `POST /api/rooms/:id/items` with:
  - `name`: item.name
  - `wear`: item.wear
  - `rarity`: item.rarity
  - `image_url`: item.icon_url
  - `price_usd`: omit (no price data from inventory endpoint)
- Real-time subscription still handles the UI update — no manual refresh needed
- Add a "Refresh Inventory" button with a visible 5-minute cooldown timer
  (localStorage key `inventory_last_refresh`, compare to Date.now())
- Show a warning banner if inventory fetch returns 403 (inventory is private) with a
  direct link to `https://steamcommunity.com/my/edit/settings`

**InventoryItem type** (add to `packages/shared/src/schemas.ts` or a local types file):
```typescript
type InventoryItem = {
  asset_id:   string
  class_id:   string
  name:       string
  icon_url:   string
  wear:       string | null
  rarity:     string | null
  type:       string | null
  tradable:   boolean
  marketable: boolean
}
```

---

## Complete File Change Summary

| File | Action |
|---|---|
| `supabase/migrations/002_steam_auth.sql` | CREATE — schema additions |
| `apps/server/.env` / `.env.example` | MODIFY — add 4 Steam vars |
| `apps/server/src/routes/steam.ts` | CREATE — Steam OpenID routes |
| `apps/server/src/routes/inventory.ts` | CREATE — inventory cache route |
| `apps/server/src/index.ts` | MODIFY — mount 2 new routers |
| `apps/web/src/pages/AuthCallbackPage.tsx` | CREATE — OTP exchange page |
| `apps/web/src/App.tsx` | MODIFY — add /auth/callback route |
| `apps/web/src/pages/LoginPage.tsx` | REPLACE — Steam button only |
| `apps/web/src/pages/RegisterPage.tsx` | DELETE or redirect to /login |
| `apps/web/src/pages/TradeRoomPage.tsx` | MODIFY — inventory picker |
| `packages/shared/src/schemas.ts` | MODIFY — add InventoryItem type |

Files explicitly NOT changing:
- `middleware/authenticate.ts` — still reads Supabase JWT, no changes
- `middleware/requireAdmin.ts` — no changes
- `context/AuthContext.tsx` — no changes
- All other API routes — no changes
- `profiles` RLS policies (if any) — no changes needed

---

## Critical Implementation Notes

### Steam OpenID is a browser redirect flow, not a fetch
`/api/auth/steam` must return an HTTP 302 redirect. The frontend links to it with a
plain `<a>` tag. If you use `fetch()` on the frontend to call this endpoint, CORS and
redirect behavior will break it. Do not use axios or fetch for initiating the Steam login.

### The generateLink token must be URL-encoded
`linkData.properties.action_link` is a full Supabase URL. Parse it with `new URL()`,
extract the `token` search param (or hash fragment depending on Supabase version),
and pass it as a query param to the frontend redirect. Encode it with
`encodeURIComponent()` to prevent token corruption in the URL.

### Steam inventory endpoint is unauthenticated but rate-limited
The `steamcommunity.com/inventory/` endpoint does not require an API key but will
return 429 with no warning if called too frequently. The 5-minute server-side cache
is mandatory, not optional. The `fetched_at` check must use server time, not client
time.

### SteamID64 vs SteamID32
Steam has multiple ID formats. The `openid.claimed_id` URL always contains SteamID64
(the 17-digit number starting with 7656119...). This is the format used for all API
calls. Do not attempt to convert formats.

### Supabase `listUsers()` pagination
`supabase.auth.admin.listUsers()` is paginated and defaults to 50 users. For large
user bases this approach will miss users. The correct approach for finding a user by
email is:
```
supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
```
Or better: use `supabase.auth.admin.getUserByEmail(email)` if available in your
`@supabase/supabase-js` version (v2.39+). Check the installed version before choosing
the lookup strategy.

### Trade hold filtering
Items with `tradable: false` from the inventory parser must never appear in the picker.
Steam imposes a 7-day trade hold on recently acquired items. The `tradable` boolean
in the parsed item already reflects this — filter on it, do not implement custom
hold logic.

### Production domain change
`STEAM_RETURN_URL` and `STEAM_REALM` must exactly match your production domain when
deployed. Steam validates these values during OpenID verification. A mismatch causes
`is_valid:false` with no useful error message.

---

## Testing Checklist (manual, in order)

1. Apply `002_steam_auth.sql` migration — confirm new columns exist on `profiles`
   and `steam_inventories` table exists
2. Set `STEAM_API_KEY` in `.env`
3. Start server (`pnpm dev` or `cd apps/server && npx tsx src/index.ts`)
4. Open browser → `http://localhost:4000/api/auth/steam`
   — should redirect to `steamcommunity.com`
5. Complete Steam login
   — should land on `http://localhost:5173/auth/callback?token=...`
6. `AuthCallbackPage` should exchange token and redirect to `/dashboard`
7. Check Supabase dashboard → Authentication → Users — confirm new user with
   synthetic email exists
8. Check `profiles` table — confirm `steam_id`, `steam_persona`, `steam_avatar` populated
9. Navigate to a trade room → click "Add Item" — should trigger inventory fetch
10. Check `steam_inventories` table — confirm row was inserted with items array
11. Click "Add Item" again within 5 minutes — confirm `cached: true` in response
12. Sign out, sign back in — confirm session is restored correctly
13. Test with a private Steam inventory — confirm 403 error message shown to user

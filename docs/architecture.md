You are helping me build an MVP for a P2P CS2 skin trade coordination 
platform called SkinPeer. This platform is NOT a marketplace, NOT a 
gambling site, and does NOT take custody of skins. It is a trust and 
safety layer that helps two real users safely coordinate a direct 
Steam-to-Steam trade using a shared verification code and guided checklist.

---

## STACK (no substitutions)

- Monorepo with /client and /server directories
- Frontend: React + Vite + TypeScript + Tailwind CSS (client/)
- Backend: Node.js + Express + TypeScript (server/)
- Database: PostgreSQL via Supabase (use Supabase JS client on backend)
- Auth: Supabase Auth (email/password MVP; Steam OpenID stub for later)
- Real-time: Supabase Realtime (subscribe to trade room row changes)
- Validation: Zod on all API request bodies (server-side)
- Deployment target: Vercel (client) + Railway (server)
- Email: Resend for invite and notification emails

---

## FOLDER STRUCTURE

Scaffold this exact structure:

/
├── client/
│   ├── src/
│   │   ├── pages/         # Route-level components
│   │   ├── components/    # Shared UI components
│   │   ├── hooks/         # Custom React hooks
│   │   ├── lib/           # Supabase client, utils
│   │   └── types/         # Shared TypeScript types
│   ├── index.html
│   ├── vite.config.ts
│   └── tailwind.config.ts
├── server/
│   ├── src/
│   │   ├── routes/        # Express route handlers
│   │   ├── middleware/    # Auth, error handler, rate limiter
│   │   ├── services/      # Business logic (tradeService, codeService, etc.)
│   │   ├── lib/           # Supabase admin client, Resend client
│   │   └── types/         # Shared TypeScript types
│   └── tsconfig.json
├── .env.example
└── README.md

---

## DATABASE SCHEMA

Create these tables in Supabase. Use snake_case for all column names.

### users
- id: uuid PRIMARY KEY DEFAULT gen_random_uuid()
- email: text UNIQUE NOT NULL
- username: text UNIQUE NOT NULL
- steam_profile_url: text
- role: text NOT NULL DEFAULT 'user' -- enum: 'user' | 'admin'
- created_at: timestamptz DEFAULT now()

### trade_rooms
- id: uuid PRIMARY KEY DEFAULT gen_random_uuid()
- creator_id: uuid REFERENCES users(id)
- counterparty_id: uuid REFERENCES users(id) -- nullable until joined
- invite_code: text UNIQUE NOT NULL -- short random slug for join URL
- verification_code: text UNIQUE NOT NULL -- human-readable e.g. TRADE-4829-KILO
- title: text NOT NULL
- estimated_value: numeric
- notes: text
- status: text NOT NULL DEFAULT 'draft'
  -- enum: draft | waiting | in_review | ready | completed | cancelled | disputed
- locked: boolean NOT NULL DEFAULT false
  -- true after both parties confirm; prevents item edits
- created_at: timestamptz DEFAULT now()
- updated_at: timestamptz DEFAULT now()

### trade_items
- id: uuid PRIMARY KEY DEFAULT gen_random_uuid()
- trade_room_id: uuid REFERENCES trade_rooms(id)
- owner_side: text NOT NULL -- enum: 'creator' | 'counterparty'
- item_name: text NOT NULL
- wear: text -- optional e.g. Factory New, Field-Tested
- float_value: text -- optional
- image_url: text -- optional skin image for display
- estimated_value: numeric
- notes: text

### trade_confirmations
- id: uuid PRIMARY KEY DEFAULT gen_random_uuid()
- trade_room_id: uuid REFERENCES trade_rooms(id)
- user_id: uuid REFERENCES users(id)
- confirmed_profile: boolean NOT NULL DEFAULT false
- confirmed_items: boolean NOT NULL DEFAULT false
- confirmed_code: boolean NOT NULL DEFAULT false
- confirmed_mobile: boolean NOT NULL DEFAULT false
- ready: boolean NOT NULL DEFAULT false
  -- true only when all four booleans above are true; enforced server-side
- created_at: timestamptz DEFAULT now()
- updated_at: timestamptz DEFAULT now()
- UNIQUE(trade_room_id, user_id)

### trade_activity_logs
- id: uuid PRIMARY KEY DEFAULT gen_random_uuid()
- trade_room_id: uuid REFERENCES trade_rooms(id)
- actor_id: uuid REFERENCES users(id)
- action: text NOT NULL -- e.g. 'room_created', 'counterparty_joined', etc.
- metadata: jsonb -- optional additional context
- created_at: timestamptz DEFAULT now()

### reports
- id: uuid PRIMARY KEY DEFAULT gen_random_uuid()
- trade_room_id: uuid REFERENCES trade_rooms(id)
- reporter_id: uuid REFERENCES users(id)
- reason: text NOT NULL
- notes: text
- status: text NOT NULL DEFAULT 'pending' -- enum: pending | reviewed | dismissed
- created_at: timestamptz DEFAULT now()

---

## VERIFICATION CODE GENERATION

Implement a codeService with the following rules:
- Format: [WORD]-[4-digit number]-[WORD]
- Words drawn from a curated wordlist of ~200 uppercase 4-7 letter words
  (e.g. KILO, NOVA, IRON, SAFE, WOLF, APEX, etc.)
- Numbers are zero-padded 4 digits: 0001–9999
- On generation, check the trade_rooms table for uniqueness; regenerate 
  on collision (max 5 attempts before throwing)
- The invite_code (for the join URL) is a separate 8-character alphanumeric 
  slug generated independently

---

## AUTH RULES

- Use Supabase Auth for session management
- On signup, create a corresponding row in the users table via a 
  Supabase database trigger or post-signup server hook
- Protect all /api routes except POST /api/auth/signup and POST /api/auth/login
- Admin role is set manually in the users table (no self-promotion)
- First admin: seed script that promotes a user by email 
  (server/src/scripts/makeAdmin.ts)
- All protected routes must validate the Supabase JWT from the 
  Authorization: Bearer header using the Supabase admin client

---

## INVITE & COUNTERPARTY JOIN FLOW

1. Creator creates a trade room → room status becomes 'waiting'
2. Server returns an invite URL: /join/[invite_code]
3. Server sends an invite email via Resend to the counterparty email 
   (if provided at creation)
4. Invite links do not expire in MVP but are single-use: once a 
   counterparty joins, the link no longer adds new users
5. If the counterparty is not yet registered, redirect them to signup 
   with the invite_code preserved in query params; after signup, 
   auto-join the room
6. On join: set counterparty_id, update status to 'in_review', 
   log the event

---

## ROOM LOCKING RULES

- locked becomes true when BOTH trade_confirmations rows have ready: true
- When locked: item edits return 403; status and notes can still update
- Either user can "reset" the room (unlocks it, sets all confirmations 
  to false, logs the reset, returns status to 'in_review')
- Admin can always override locked state

---

## CHECKLIST → READY STATE TRANSITION

Server-side only (never trust client):
- PATCH /api/trade-rooms/:id/confirmation accepts the four boolean fields
- After any update, if all four fields are true, server sets ready: true 
  on that confirmation
- After setting ready: true on a confirmation, server checks if BOTH 
  confirmations have ready: true
- If yes: set room status to 'ready', set locked: true, log the event, 
  trigger Supabase Realtime broadcast so both clients update instantly

---

## API ROUTES

Prefix all routes with /api/v1

### Auth
- POST /auth/signup
- POST /auth/login
- POST /auth/logout

### Trade Rooms
- POST   /trade-rooms             (create; auth required)
- GET    /trade-rooms             (list own rooms; auth required)
- GET    /trade-rooms/:id         (get room; must be creator or counterparty)
- PATCH  /trade-rooms/:id         (update title/notes/items; respects locked)
- DELETE /trade-rooms/:id         (cancel; creator only)

### Join
- GET    /join/:invite_code       (resolve invite; returns room metadata)
- POST   /join/:invite_code       (join room as counterparty; auth required)

### Trade Items
- POST   /trade-rooms/:id/items   (add item; respects locked)
- PATCH  /items/:itemId           (edit item; respects locked)
- DELETE /items/:itemId           (remove item; respects locked)

### Confirmation / Checklist
- GET    /trade-rooms/:id/confirmation   (get both users' confirmation state)
- PATCH  /trade-rooms/:id/confirmation  (update own checklist fields)
- POST   /trade-rooms/:id/reset         (unlock room; either user)

### Status
- PATCH  /trade-rooms/:id/status  (mark completed or cancelled; either user)

### Reports
- POST   /trade-rooms/:id/report

### Activity Log
- GET    /trade-rooms/:id/activity

### Admin (role: admin only)
- GET    /admin/trade-rooms        (all rooms with filters)
- PATCH  /admin/trade-rooms/:id    (update any field including locked/status)
- GET    /admin/reports            (all pending reports)
- PATCH  /admin/reports/:id        (update report status)

---

## FRONTEND ROUTES

/                      Landing page
/signup                Sign up
/login                 Log in
/dashboard             User's trade rooms list
/trade/new             Create trade room form
/trade/:id             Trade room detail (live, real-time)
/join/:invite_code     Counterparty join page
/admin                 Admin dashboard (role-gated)
/admin/trade/:id       Admin room detail view

---

## REAL-TIME

Use Supabase Realtime to subscribe to changes on trade_rooms and 
trade_confirmations within the trade room detail page (/trade/:id).
Both users should see checklist state and room status update without refresh.

---

## DESIGN SYSTEM

- Dark UI: background #0d0f14, card #161a23, border #252a35
- Accent: emerald green #10b981 for trust/positive states
- Warning: amber #f59e0b for caution states  
- Danger: red #ef4444 for scam warnings
- Typography: Inter or Geist, clean and readable
- Cards with subtle border and slight glow on hover
- Every page must show the trust bar: 
  "We don't hold your skins. We don't use bots. Steam trades happen directly between you."
- Verification code displayed in large monospace font with a copy button
- Scam warning banner on every trade room page (not dismissible)

---

## MIDDLEWARE (implement all before any routes)

1. Supabase JWT auth middleware (attach user to req)
2. Role-check middleware (requireAdmin)
3. Zod request validation middleware (per-route schema)
4. Global error handler (structured JSON errors)
5. Rate limiter: express-rate-limit, 60 req/min per IP on all routes

---

## ENVIRONMENT VARIABLES (.env.example)

SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
RESEND_API_KEY=
CLIENT_URL=http://localhost:5173
PORT=3001

---

## WHAT NOT TO BUILD

- No Steam bot flows
- No payment processing
- No skin custody or escrow
- No price lookup APIs (MVP)
- No gambling mechanics
- No "guaranteed safe trade" language
- No official Valve/Steam affiliation claims

---

## MVP BUILD ORDER

Build in this sequence:
1. Scaffold monorepo, install deps, configure TypeScript, Tailwind, Supabase
2. DB schema (run migrations in Supabase)
3. Auth routes + middleware + makeAdmin seed script
4. Trade room CRUD routes + Zod schemas
5. Invite flow + Resend email
6. Confirmation/checklist routes + locking logic
7. Admin routes
8. Frontend: auth pages
9. Frontend: dashboard + create room
10. Frontend: trade room detail with real-time
11. Frontend: join flow
12. Frontend: admin dashboard
13. Landing page last (polish after core works)

Start with step 1. Ask me before moving to each new step.
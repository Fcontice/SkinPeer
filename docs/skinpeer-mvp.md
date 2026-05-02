# SkinPeer MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a P2P CS2 skin trade coordination platform with a verifiable code system so traders can safely confirm Steam trades without escrow or bots.

**Architecture:** Monorepo with `/client` (React + Vite + TypeScript + Tailwind) and `/server` (Node.js + Express + TypeScript). Supabase handles the database, auth, and real-time subscriptions. The server holds all business logic — room locking, confirmation transitions, and code generation are never trusted from the client.

**Tech Stack:** React 18, Vite, TypeScript, Tailwind CSS, Node.js, Express, Supabase JS v2, Zod, Resend, express-rate-limit, nanoid, React Router v6, TanStack Query v5

---

## Phase 1 — Monorepo Scaffold

### Task 1: Initialize monorepo root

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Create: `.gitignore`

**Step 1: Create root package.json**

```json
{
  "name": "skinpeer",
  "private": true,
  "scripts": {
    "dev:client": "cd client && npm run dev",
    "dev:server": "cd server && npm run dev",
    "build:client": "cd client && npm run build",
    "build:server": "cd server && npm run build"
  }
}
```

**Step 2: Create .env.example**

```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
RESEND_API_KEY=
CLIENT_URL=http://localhost:5173
PORT=3001
```

**Step 3: Create .gitignore**

```
node_modules/
dist/
.env
.env.local
*.local
```

**Step 4: Commit**

```bash
git init
git add package.json .env.example .gitignore
git commit -m "chore: initialize monorepo root"
```

---

### Task 2: Scaffold client (React + Vite + TypeScript + Tailwind)

**Files:**
- Create: `client/` (entire directory via Vite scaffold)

**Step 1: Scaffold Vite app**

```bash
cd client
npm create vite@latest . -- --template react-ts
npm install
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

**Step 2: Configure tailwind.config.ts**

```ts
import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0d0f14',
        card: '#161a23',
        border: '#252a35',
        accent: '#10b981',
        warning: '#f59e0b',
        danger: '#ef4444',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config
```

**Step 3: Replace src/index.css with Tailwind directives**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

**Step 4: Create folder structure**

```bash
mkdir -p client/src/{pages,components,hooks,lib,types}
```

**Step 5: Install routing + data fetching**

```bash
cd client
npm install react-router-dom @tanstack/react-query @supabase/supabase-js
npm install -D @types/node
```

**Step 6: Commit**

```bash
git add client/
git commit -m "chore: scaffold client with Vite, TypeScript, Tailwind"
```

---

### Task 3: Scaffold server (Node.js + Express + TypeScript)

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/src/index.ts`

**Step 1: Init server**

```bash
cd server
npm init -y
npm install express @supabase/supabase-js zod resend nanoid express-rate-limit cors dotenv
npm install -D typescript ts-node nodemon @types/express @types/cors @types/node
```

**Step 2: Create server/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Add server/package.json scripts**

```json
{
  "scripts": {
    "dev": "nodemon --watch src --ext ts --exec ts-node src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit"
  }
}
```

**Step 4: Create server/src/index.ts (skeleton)**

```ts
import 'dotenv/config'
import express from 'express'
import cors from 'cors'

const app = express()
const PORT = process.env.PORT ?? 3001

app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }))
app.use(express.json())

app.get('/health', (_req, res) => res.json({ ok: true }))

app.listen(PORT, () => console.log(`Server running on port ${PORT}`))

export default app
```

**Step 5: Verify server starts**

```bash
cd server && npm run dev
# Expected: "Server running on port 3001"
curl http://localhost:3001/health
# Expected: {"ok":true}
```

**Step 6: Commit**

```bash
git add server/
git commit -m "chore: scaffold server with Express, TypeScript"
```

---

### Task 4: Create shared TypeScript types

**Files:**
- Create: `server/src/types/index.ts`
- Create: `client/src/types/index.ts`

**Step 1: Write server/src/types/index.ts**

```ts
export type UserRole = 'user' | 'admin'
export type TradeStatus = 'draft' | 'waiting' | 'in_review' | 'ready' | 'completed' | 'cancelled' | 'disputed'
export type OwnerSide = 'creator' | 'counterparty'
export type ReportStatus = 'pending' | 'reviewed' | 'dismissed'

export interface DbUser {
  id: string
  email: string
  username: string
  steam_profile_url: string | null
  role: UserRole
  created_at: string
}

export interface DbTradeRoom {
  id: string
  creator_id: string
  counterparty_id: string | null
  invite_code: string
  verification_code: string
  title: string
  estimated_value: number | null
  notes: string | null
  status: TradeStatus
  locked: boolean
  created_at: string
  updated_at: string
}

export interface DbTradeItem {
  id: string
  trade_room_id: string
  owner_side: OwnerSide
  item_name: string
  wear: string | null
  float_value: string | null
  image_url: string | null
  estimated_value: number | null
  notes: string | null
}

export interface DbTradeConfirmation {
  id: string
  trade_room_id: string
  user_id: string
  confirmed_profile: boolean
  confirmed_items: boolean
  confirmed_code: boolean
  confirmed_mobile: boolean
  ready: boolean
  created_at: string
  updated_at: string
}

export interface DbTradeActivityLog {
  id: string
  trade_room_id: string
  actor_id: string
  action: string
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface DbReport {
  id: string
  trade_room_id: string
  reporter_id: string
  reason: string
  notes: string | null
  status: ReportStatus
  created_at: string
}

// Attach user to Express request
export interface AuthenticatedRequest extends Express.Request {
  user: DbUser
}
```

**Step 2: Copy to client/src/types/index.ts (shared types only)**

Copy `DbUser`, `DbTradeRoom`, `DbTradeItem`, `DbTradeConfirmation`, `DbTradeActivityLog`, `DbReport`, and all enums — same content.

**Step 3: Commit**

```bash
git add server/src/types/ client/src/types/
git commit -m "chore: add shared TypeScript types"
```

---

## Phase 2 — Database Schema

### Task 5: Run Supabase migrations

**Step 1: Copy this SQL into Supabase SQL editor and run it**

```sql
-- users
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  username text UNIQUE NOT NULL,
  steam_profile_url text,
  role text NOT NULL DEFAULT 'user',
  created_at timestamptz DEFAULT now()
);

-- Auto-create user row on Supabase Auth signup
CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO users (id, email, username)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();

-- trade_rooms
CREATE TABLE trade_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid REFERENCES users(id),
  counterparty_id uuid REFERENCES users(id),
  invite_code text UNIQUE NOT NULL,
  verification_code text UNIQUE NOT NULL,
  title text NOT NULL,
  estimated_value numeric,
  notes text,
  status text NOT NULL DEFAULT 'draft',
  locked boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- trade_items
CREATE TABLE trade_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_room_id uuid REFERENCES trade_rooms(id) ON DELETE CASCADE,
  owner_side text NOT NULL,
  item_name text NOT NULL,
  wear text,
  float_value text,
  image_url text,
  estimated_value numeric,
  notes text
);

-- trade_confirmations
CREATE TABLE trade_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_room_id uuid REFERENCES trade_rooms(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id),
  confirmed_profile boolean NOT NULL DEFAULT false,
  confirmed_items boolean NOT NULL DEFAULT false,
  confirmed_code boolean NOT NULL DEFAULT false,
  confirmed_mobile boolean NOT NULL DEFAULT false,
  ready boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(trade_room_id, user_id)
);

-- trade_activity_logs
CREATE TABLE trade_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_room_id uuid REFERENCES trade_rooms(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id),
  action text NOT NULL,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

-- reports
CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_room_id uuid REFERENCES trade_rooms(id),
  reporter_id uuid REFERENCES users(id),
  reason text NOT NULL,
  notes text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

-- Enable Realtime on trade_rooms and trade_confirmations
ALTER PUBLICATION supabase_realtime ADD TABLE trade_rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE trade_confirmations;
```

**Step 2: Verify tables exist in Supabase Table Editor**

Check: users, trade_rooms, trade_items, trade_confirmations, trade_activity_logs, reports all appear.

**Step 3: Commit**

```bash
# Save the SQL to a migrations file
mkdir -p server/src/migrations
# Paste the SQL above into server/src/migrations/001_initial_schema.sql
git add server/src/migrations/
git commit -m "feat: add initial database schema and auth trigger"
```

---

## Phase 3 — Server: Supabase Client + Middleware

### Task 6: Create Supabase admin client

**Files:**
- Create: `server/src/lib/supabase.ts`

**Step 1: Write server/src/lib/supabase.ts**

```ts
import { createClient } from '@supabase/supabase-js'

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env vars')
}

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)
```

**Step 2: Commit**

```bash
git add server/src/lib/supabase.ts
git commit -m "feat: add Supabase admin client"
```

---

### Task 7: Implement auth middleware

**Files:**
- Create: `server/src/middleware/auth.ts`
- Create: `server/src/middleware/requireAdmin.ts`

**Step 1: Write server/src/middleware/auth.ts**

```ts
import { Request, Response, NextFunction } from 'express'
import { supabase } from '../lib/supabase'
import { DbUser } from '../types'

export interface AuthRequest extends Request {
  user?: DbUser
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Missing token' })

  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return res.status(401).json({ error: 'Invalid token' })

  const { data: dbUser } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!dbUser) return res.status(401).json({ error: 'User not found' })

  req.user = dbUser
  next()
}
```

**Step 2: Write server/src/middleware/requireAdmin.ts**

```ts
import { Response, NextFunction } from 'express'
import { AuthRequest } from './auth'

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' })
  }
  next()
}
```

**Step 3: Commit**

```bash
git add server/src/middleware/
git commit -m "feat: add auth and requireAdmin middleware"
```

---

### Task 8: Implement validation and error middleware

**Files:**
- Create: `server/src/middleware/validate.ts`
- Create: `server/src/middleware/errorHandler.ts`

**Step 1: Write server/src/middleware/validate.ts**

```ts
import { Request, Response, NextFunction } from 'express'
import { ZodSchema } from 'zod'

export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        issues: result.error.issues,
      })
    }
    req.body = result.data
    next()
  }
}
```

**Step 2: Write server/src/middleware/errorHandler.ts**

```ts
import { Request, Response, NextFunction } from 'express'

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
}
```

**Step 3: Wire up middleware in server/src/index.ts**

```ts
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import { errorHandler } from './middleware/errorHandler'

const app = express()
const PORT = process.env.PORT ?? 3001

app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }))
app.use(express.json())
app.use(rateLimit({ windowMs: 60_000, max: 60 }))

app.get('/health', (_req, res) => res.json({ ok: true }))

// Routes go here (imported below)

app.use(errorHandler)

app.listen(PORT, () => console.log(`Server running on port ${PORT}`))
export default app
```

**Step 4: Commit**

```bash
git add server/src/middleware/ server/src/index.ts
git commit -m "feat: add Zod validation and global error handler middleware"
```

---

## Phase 4 — Auth Routes + makeAdmin Script

### Task 9: Implement auth routes

**Files:**
- Create: `server/src/routes/auth.ts`

**Step 1: Write server/src/routes/auth.ts**

```ts
import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../middleware/validate'
import { supabase } from '../lib/supabase'

const router = Router()

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

router.post('/signup', validate(signupSchema), async (req, res, next) => {
  try {
    const { email, password, username } = req.body

    // Check username not taken before creating auth user
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('username', username)
      .single()

    if (existing) return res.status(409).json({ error: 'Username already taken' })

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username },
    })

    if (error) return res.status(400).json({ error: error.message })

    // Sign in immediately to return session
    const { data: session, error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) return res.status(400).json({ error: signInError.message })

    res.status(201).json({ user: data.user, session: session.session })
  } catch (err) { next(err) }
})

router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return res.status(401).json({ error: 'Invalid credentials' })
    res.json({ user: data.user, session: data.session })
  } catch (err) { next(err) }
})

router.post('/logout', async (_req, res, next) => {
  try {
    await supabase.auth.signOut()
    res.json({ ok: true })
  } catch (err) { next(err) }
})

export default router
```

**Step 2: Register route in server/src/index.ts**

```ts
import authRouter from './routes/auth'
// ...
app.use('/api/v1/auth', authRouter)
```

**Step 3: Test signup**

```bash
curl -X POST http://localhost:3001/api/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123","username":"testuser"}'
# Expected: 201 with user and session
```

**Step 4: Commit**

```bash
git add server/src/routes/auth.ts server/src/index.ts
git commit -m "feat: add auth signup/login/logout routes"
```

---

### Task 10: Create makeAdmin seed script

**Files:**
- Create: `server/src/scripts/makeAdmin.ts`

**Step 1: Write server/src/scripts/makeAdmin.ts**

```ts
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const email = process.argv[2]
if (!email) {
  console.error('Usage: ts-node src/scripts/makeAdmin.ts <email>')
  process.exit(1)
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
  const { data, error } = await supabase
    .from('users')
    .update({ role: 'admin' })
    .eq('email', email)
    .select()
    .single()

  if (error) { console.error('Error:', error.message); process.exit(1) }
  console.log('Made admin:', data)
}

main()
```

**Step 2: Add script to server/package.json**

```json
"make-admin": "ts-node src/scripts/makeAdmin.ts"
```

**Step 3: Commit**

```bash
git add server/src/scripts/
git commit -m "feat: add makeAdmin seed script"
```

---

## Phase 5 — Code Generation Services

### Task 11: Implement codeService

**Files:**
- Create: `server/src/services/codeService.ts`

**Step 1: Write server/src/services/codeService.ts**

```ts
import { supabase } from '../lib/supabase'
import { customAlphabet } from 'nanoid'

const WORDLIST = [
  'KILO', 'NOVA', 'IRON', 'SAFE', 'WOLF', 'APEX', 'BOLT', 'CORE',
  'DARK', 'ECHO', 'FIRE', 'GATE', 'HAWK', 'JADE', 'LARK', 'MASK',
  'NEON', 'OPAL', 'PEAK', 'QUAY', 'RAZE', 'SAGE', 'TITAN', 'ULTRA',
  'VEIL', 'WARD', 'XENON', 'YARD', 'ZERO', 'ABLE', 'BASE', 'CALM',
  'DOME', 'EDGE', 'FANG', 'GRIT', 'HELM', 'ICON', 'JUST', 'KEEN',
  'LIME', 'MIND', 'NOTE', 'OPEN', 'PINE', 'QUAD', 'REEF', 'SLAM',
  'TIDE', 'UNIT', 'VAST', 'WRIT', 'XRAY', 'YOKE', 'ZONE', 'ACME',
  'BLAZE', 'CRANE', 'DRIFT', 'EMBER', 'FORGE', 'GRACE', 'HAVEN',
  'IDEAL', 'JEWEL', 'KNEEL', 'LANCE', 'MANOR', 'NERVE', 'OCEAN',
  'PLAIN', 'QUEST', 'REIGN', 'STONE', 'TOWER', 'URBAN', 'VALOR',
  'WATER', 'YIELD', 'ACORN', 'BRAVE', 'CLOAK', 'DELTA', 'EVADE',
  'FLINT', 'GRIND', 'HASTE', 'INPUT', 'JOINT', 'KRYPT', 'LEDGE',
  'MIGHT', 'NIGHT', 'ORDER', 'PRIME', 'QUICK', 'RAZOR', 'SCOUT',
  'TRACE', 'UNION', 'VAULT', 'WATCH', 'XENIX', 'YIELD', 'ZINCO',
]

const nanoidInvite = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 8)

function randomWord(): string {
  return WORDLIST[Math.floor(Math.random() * WORDLIST.length)]
}

function randomNum(): string {
  return String(Math.floor(Math.random() * 9999) + 1).padStart(4, '0')
}

export async function generateVerificationCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = `${randomWord()}-${randomNum()}-${randomWord()}`
    const { data } = await supabase
      .from('trade_rooms')
      .select('id')
      .eq('verification_code', code)
      .single()

    if (!data) return code
  }
  throw new Error('Failed to generate unique verification code after 5 attempts')
}

export function generateInviteCode(): string {
  return nanoidInvite()
}
```

**Step 2: Commit**

```bash
git add server/src/services/codeService.ts
git commit -m "feat: add verification code and invite code generation service"
```

---

## Phase 6 — Trade Room CRUD Routes

### Task 12: Implement trade room routes

**Files:**
- Create: `server/src/routes/tradeRooms.ts`
- Create: `server/src/services/activityService.ts`

**Step 1: Write server/src/services/activityService.ts**

```ts
import { supabase } from '../lib/supabase'

export async function logActivity(
  trade_room_id: string,
  actor_id: string,
  action: string,
  metadata?: Record<string, unknown>
) {
  await supabase.from('trade_activity_logs').insert({
    trade_room_id,
    actor_id,
    action,
    metadata: metadata ?? null,
  })
}
```

**Step 2: Write server/src/routes/tradeRooms.ts**

```ts
import { Router } from 'express'
import { z } from 'zod'
import { authenticate, AuthRequest } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { supabase } from '../lib/supabase'
import { generateVerificationCode, generateInviteCode } from '../services/codeService'
import { logActivity } from '../services/activityService'

const router = Router()
router.use(authenticate)

const createRoomSchema = z.object({
  title: z.string().min(1).max(100),
  estimated_value: z.number().positive().optional(),
  notes: z.string().max(1000).optional(),
  counterparty_email: z.string().email().optional(),
})

const updateRoomSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  notes: z.string().max(1000).optional(),
  estimated_value: z.number().positive().optional(),
})

router.post('/', validate(createRoomSchema), async (req: AuthRequest, res, next) => {
  try {
    const user = req.user!
    const [verCode, invCode] = await Promise.all([
      generateVerificationCode(),
      Promise.resolve(generateInviteCode()),
    ])

    const { data: room, error } = await supabase
      .from('trade_rooms')
      .insert({
        creator_id: user.id,
        invite_code: invCode,
        verification_code: verCode,
        title: req.body.title,
        estimated_value: req.body.estimated_value ?? null,
        notes: req.body.notes ?? null,
        status: 'waiting',
      })
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })

    await logActivity(room.id, user.id, 'room_created')

    // Send invite email if counterparty_email provided (handled in Phase 7)

    res.status(201).json({
      room,
      invite_url: `${process.env.CLIENT_URL}/join/${invCode}`,
    })
  } catch (err) { next(err) }
})

router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const user = req.user!
    const { data, error } = await supabase
      .from('trade_rooms')
      .select('*, trade_items(*)')
      .or(`creator_id.eq.${user.id},counterparty_id.eq.${user.id}`)
      .order('created_at', { ascending: false })

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) { next(err) }
})

router.get('/:id', async (req: AuthRequest, res, next) => {
  try {
    const user = req.user!
    const { data: room, error } = await supabase
      .from('trade_rooms')
      .select('*, trade_items(*)')
      .eq('id', req.params.id)
      .single()

    if (error || !room) return res.status(404).json({ error: 'Room not found' })

    if (room.creator_id !== user.id && room.counterparty_id !== user.id) {
      return res.status(403).json({ error: 'Access denied' })
    }

    res.json(room)
  } catch (err) { next(err) }
})

router.patch('/:id', validate(updateRoomSchema), async (req: AuthRequest, res, next) => {
  try {
    const user = req.user!
    const { data: room } = await supabase
      .from('trade_rooms')
      .select('creator_id, counterparty_id, locked')
      .eq('id', req.params.id)
      .single()

    if (!room) return res.status(404).json({ error: 'Room not found' })
    if (room.creator_id !== user.id && room.counterparty_id !== user.id) {
      return res.status(403).json({ error: 'Access denied' })
    }
    if (room.locked) return res.status(403).json({ error: 'Room is locked' })

    const { data: updated, error } = await supabase
      .from('trade_rooms')
      .update({ ...req.body, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })
    res.json(updated)
  } catch (err) { next(err) }
})

router.delete('/:id', async (req: AuthRequest, res, next) => {
  try {
    const user = req.user!
    const { data: room } = await supabase
      .from('trade_rooms')
      .select('creator_id, status')
      .eq('id', req.params.id)
      .single()

    if (!room) return res.status(404).json({ error: 'Room not found' })
    if (room.creator_id !== user.id) return res.status(403).json({ error: 'Only creator can cancel' })

    await supabase
      .from('trade_rooms')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', req.params.id)

    await logActivity(req.params.id, user.id, 'room_cancelled')
    res.json({ ok: true })
  } catch (err) { next(err) }
})

export default router
```

**Step 3: Register route in server/src/index.ts**

```ts
import tradeRoomsRouter from './routes/tradeRooms'
app.use('/api/v1/trade-rooms', tradeRoomsRouter)
```

**Step 4: Commit**

```bash
git add server/src/routes/tradeRooms.ts server/src/services/activityService.ts server/src/index.ts
git commit -m "feat: add trade room CRUD routes"
```

---

### Task 13: Implement trade items routes

**Files:**
- Create: `server/src/routes/tradeItems.ts`

**Step 1: Write server/src/routes/tradeItems.ts**

```ts
import { Router } from 'express'
import { z } from 'zod'
import { authenticate, AuthRequest } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { supabase } from '../lib/supabase'

const router = Router()
router.use(authenticate)

const itemSchema = z.object({
  owner_side: z.enum(['creator', 'counterparty']),
  item_name: z.string().min(1).max(200),
  wear: z.string().optional(),
  float_value: z.string().optional(),
  image_url: z.string().url().optional(),
  estimated_value: z.number().positive().optional(),
  notes: z.string().max(500).optional(),
})

async function getRoomAndCheckAccess(roomId: string, userId: string) {
  const { data: room } = await supabase
    .from('trade_rooms')
    .select('creator_id, counterparty_id, locked')
    .eq('id', roomId)
    .single()
  if (!room) return { room: null, error: 'Room not found', status: 404 }
  if (room.creator_id !== userId && room.counterparty_id !== userId) {
    return { room: null, error: 'Access denied', status: 403 }
  }
  if (room.locked) return { room: null, error: 'Room is locked', status: 403 }
  return { room, error: null, status: 200 }
}

// POST /api/v1/trade-rooms/:id/items
router.post('/trade-rooms/:id/items', validate(itemSchema), async (req: AuthRequest, res, next) => {
  try {
    const { room, error, status } = await getRoomAndCheckAccess(req.params.id, req.user!.id)
    if (error) return res.status(status).json({ error })

    const { data, error: insertError } = await supabase
      .from('trade_items')
      .insert({ ...req.body, trade_room_id: req.params.id })
      .select()
      .single()

    if (insertError) return res.status(400).json({ error: insertError.message })
    res.status(201).json(data)
  } catch (err) { next(err) }
})

// PATCH /api/v1/items/:itemId
router.patch('/items/:itemId', validate(itemSchema.partial()), async (req: AuthRequest, res, next) => {
  try {
    const { data: item } = await supabase
      .from('trade_items')
      .select('trade_room_id')
      .eq('id', req.params.itemId)
      .single()

    if (!item) return res.status(404).json({ error: 'Item not found' })

    const { room, error, status } = await getRoomAndCheckAccess(item.trade_room_id, req.user!.id)
    if (error) return res.status(status).json({ error })

    const { data, error: updateError } = await supabase
      .from('trade_items')
      .update(req.body)
      .eq('id', req.params.itemId)
      .select()
      .single()

    if (updateError) return res.status(400).json({ error: updateError.message })
    res.json(data)
  } catch (err) { next(err) }
})

// DELETE /api/v1/items/:itemId
router.delete('/items/:itemId', async (req: AuthRequest, res, next) => {
  try {
    const { data: item } = await supabase
      .from('trade_items')
      .select('trade_room_id')
      .eq('id', req.params.itemId)
      .single()

    if (!item) return res.status(404).json({ error: 'Item not found' })

    const { error, status } = await getRoomAndCheckAccess(item.trade_room_id, req.user!.id)
    if (error) return res.status(status).json({ error })

    await supabase.from('trade_items').delete().eq('id', req.params.itemId)
    res.json({ ok: true })
  } catch (err) { next(err) }
})

export default router
```

**Step 2: Register in server/src/index.ts**

```ts
import tradeItemsRouter from './routes/tradeItems'
app.use('/api/v1', tradeItemsRouter)
```

**Step 3: Commit**

```bash
git add server/src/routes/tradeItems.ts server/src/index.ts
git commit -m "feat: add trade items routes with lock enforcement"
```

---

## Phase 7 — Invite Flow + Email

### Task 14: Implement join routes + Resend email

**Files:**
- Create: `server/src/lib/resend.ts`
- Create: `server/src/routes/join.ts`

**Step 1: Write server/src/lib/resend.ts**

```ts
import { Resend } from 'resend'

export const resend = new Resend(process.env.RESEND_API_KEY)

export async function sendInviteEmail(to: string, inviteUrl: string, roomTitle: string) {
  await resend.emails.send({
    from: 'SkinPeer <noreply@skinpeer.com>',
    to,
    subject: `You've been invited to trade: ${roomTitle}`,
    html: `
      <h2>Trade Invitation</h2>
      <p>You've been invited to a SkinPeer trade room: <strong>${roomTitle}</strong></p>
      <p>Click the link below to join:</p>
      <a href="${inviteUrl}">${inviteUrl}</a>
      <hr>
      <p><em>We don't hold your skins. We don't use bots. Steam trades happen directly between you.</em></p>
    `,
  })
}
```

**Step 2: Write server/src/routes/join.ts**

```ts
import { Router } from 'express'
import { authenticate, AuthRequest } from '../middleware/auth'
import { supabase } from '../lib/supabase'
import { logActivity } from '../services/activityService'

const router = Router()

// GET /api/v1/join/:invite_code — resolve invite (no auth needed for preview)
router.get('/:invite_code', async (req, res, next) => {
  try {
    const { data: room, error } = await supabase
      .from('trade_rooms')
      .select('id, title, status, estimated_value, creator_id, counterparty_id')
      .eq('invite_code', req.params.invite_code)
      .single()

    if (error || !room) return res.status(404).json({ error: 'Invite not found' })
    if (room.counterparty_id) return res.status(410).json({ error: 'Invite already used' })

    res.json(room)
  } catch (err) { next(err) }
})

// POST /api/v1/join/:invite_code — join as counterparty (auth required)
router.post('/:invite_code', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const user = req.user!

    const { data: room, error } = await supabase
      .from('trade_rooms')
      .select('*')
      .eq('invite_code', req.params.invite_code)
      .single()

    if (error || !room) return res.status(404).json({ error: 'Invite not found' })
    if (room.counterparty_id) return res.status(410).json({ error: 'Invite already used' })
    if (room.creator_id === user.id) return res.status(400).json({ error: 'Cannot join your own room' })

    const { data: updated, error: updateError } = await supabase
      .from('trade_rooms')
      .update({
        counterparty_id: user.id,
        status: 'in_review',
        updated_at: new Date().toISOString(),
      })
      .eq('id', room.id)
      .select()
      .single()

    if (updateError) return res.status(400).json({ error: updateError.message })

    await logActivity(room.id, user.id, 'counterparty_joined', { username: user.username })

    res.json(updated)
  } catch (err) { next(err) }
})

export default router
```

**Step 3: Wire up invite email in trade rooms POST (add after room creation)**

In `server/src/routes/tradeRooms.ts`, after `logActivity`:

```ts
if (req.body.counterparty_email) {
  const { sendInviteEmail } = await import('../lib/resend')
  const inviteUrl = `${process.env.CLIENT_URL}/join/${invCode}`
  await sendInviteEmail(req.body.counterparty_email, inviteUrl, req.body.title).catch(console.error)
}
```

**Step 4: Register join routes**

```ts
import joinRouter from './routes/join'
app.use('/api/v1/join', joinRouter)
```

**Step 5: Commit**

```bash
git add server/src/lib/resend.ts server/src/routes/join.ts server/src/routes/tradeRooms.ts server/src/index.ts
git commit -m "feat: add invite join flow and Resend email"
```

---

## Phase 8 — Confirmation/Checklist + Locking Logic

### Task 15: Implement confirmation routes

**Files:**
- Create: `server/src/routes/confirmation.ts`

**Step 1: Write server/src/routes/confirmation.ts**

```ts
import { Router } from 'express'
import { z } from 'zod'
import { authenticate, AuthRequest } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { supabase } from '../lib/supabase'
import { logActivity } from '../services/activityService'

const router = Router()
router.use(authenticate)

const confirmationSchema = z.object({
  confirmed_profile: z.boolean().optional(),
  confirmed_items: z.boolean().optional(),
  confirmed_code: z.boolean().optional(),
  confirmed_mobile: z.boolean().optional(),
})

router.get('/:id/confirmation', async (req: AuthRequest, res, next) => {
  try {
    const user = req.user!
    const { data: room } = await supabase
      .from('trade_rooms')
      .select('creator_id, counterparty_id')
      .eq('id', req.params.id)
      .single()

    if (!room) return res.status(404).json({ error: 'Room not found' })
    if (room.creator_id !== user.id && room.counterparty_id !== user.id) {
      return res.status(403).json({ error: 'Access denied' })
    }

    const { data } = await supabase
      .from('trade_confirmations')
      .select('*')
      .eq('trade_room_id', req.params.id)

    res.json(data ?? [])
  } catch (err) { next(err) }
})

router.patch('/:id/confirmation', validate(confirmationSchema), async (req: AuthRequest, res, next) => {
  try {
    const user = req.user!

    const { data: room } = await supabase
      .from('trade_rooms')
      .select('creator_id, counterparty_id, status')
      .eq('id', req.params.id)
      .single()

    if (!room) return res.status(404).json({ error: 'Room not found' })
    if (room.creator_id !== user.id && room.counterparty_id !== user.id) {
      return res.status(403).json({ error: 'Access denied' })
    }

    // Upsert this user's confirmation
    const { data: existing } = await supabase
      .from('trade_confirmations')
      .select('*')
      .eq('trade_room_id', req.params.id)
      .eq('user_id', user.id)
      .single()

    const merged = { ...(existing ?? {}), ...req.body }
    const allChecked =
      merged.confirmed_profile &&
      merged.confirmed_items &&
      merged.confirmed_code &&
      merged.confirmed_mobile

    const { data: confirmation, error } = await supabase
      .from('trade_confirmations')
      .upsert(
        {
          trade_room_id: req.params.id,
          user_id: user.id,
          ...req.body,
          ready: allChecked,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'trade_room_id,user_id' }
      )
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })

    // Check if both parties are ready
    if (allChecked) {
      const { data: allConfirmations } = await supabase
        .from('trade_confirmations')
        .select('ready')
        .eq('trade_room_id', req.params.id)

      const bothReady = allConfirmations?.every((c) => c.ready) && (allConfirmations?.length ?? 0) === 2

      if (bothReady) {
        await supabase
          .from('trade_rooms')
          .update({ status: 'ready', locked: true, updated_at: new Date().toISOString() })
          .eq('id', req.params.id)

        await logActivity(req.params.id, user.id, 'room_locked_ready')
      }
    }

    res.json(confirmation)
  } catch (err) { next(err) }
})

router.post('/:id/reset', async (req: AuthRequest, res, next) => {
  try {
    const user = req.user!

    const { data: room } = await supabase
      .from('trade_rooms')
      .select('creator_id, counterparty_id')
      .eq('id', req.params.id)
      .single()

    if (!room) return res.status(404).json({ error: 'Room not found' })
    if (room.creator_id !== user.id && room.counterparty_id !== user.id) {
      return res.status(403).json({ error: 'Access denied' })
    }

    await supabase
      .from('trade_confirmations')
      .update({
        confirmed_profile: false,
        confirmed_items: false,
        confirmed_code: false,
        confirmed_mobile: false,
        ready: false,
        updated_at: new Date().toISOString(),
      })
      .eq('trade_room_id', req.params.id)

    await supabase
      .from('trade_rooms')
      .update({ locked: false, status: 'in_review', updated_at: new Date().toISOString() })
      .eq('id', req.params.id)

    await logActivity(req.params.id, user.id, 'room_reset')

    res.json({ ok: true })
  } catch (err) { next(err) }
})

export default router
```

**Step 2: Register in index.ts**

```ts
import confirmationRouter from './routes/confirmation'
app.use('/api/v1/trade-rooms', confirmationRouter)
```

**Step 3: Commit**

```bash
git add server/src/routes/confirmation.ts server/src/index.ts
git commit -m "feat: add confirmation/checklist routes with room locking logic"
```

---

### Task 16: Add status + reports + activity routes

**Files:**
- Create: `server/src/routes/status.ts`
- Create: `server/src/routes/reports.ts`
- Create: `server/src/routes/activity.ts`

**Step 1: Write server/src/routes/status.ts**

```ts
import { Router } from 'express'
import { z } from 'zod'
import { authenticate, AuthRequest } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { supabase } from '../lib/supabase'
import { logActivity } from '../services/activityService'

const router = Router()
router.use(authenticate)

const statusSchema = z.object({
  status: z.enum(['completed', 'cancelled']),
})

router.patch('/:id/status', validate(statusSchema), async (req: AuthRequest, res, next) => {
  try {
    const user = req.user!
    const { data: room } = await supabase
      .from('trade_rooms')
      .select('creator_id, counterparty_id')
      .eq('id', req.params.id)
      .single()

    if (!room) return res.status(404).json({ error: 'Room not found' })
    if (room.creator_id !== user.id && room.counterparty_id !== user.id) {
      return res.status(403).json({ error: 'Access denied' })
    }

    const { data } = await supabase
      .from('trade_rooms')
      .update({ status: req.body.status, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single()

    await logActivity(req.params.id, user.id, `status_changed_to_${req.body.status}`)

    res.json(data)
  } catch (err) { next(err) }
})

export default router
```

**Step 2: Write server/src/routes/reports.ts**

```ts
import { Router } from 'express'
import { z } from 'zod'
import { authenticate, AuthRequest } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { supabase } from '../lib/supabase'

const router = Router()
router.use(authenticate)

const reportSchema = z.object({
  reason: z.string().min(1).max(500),
  notes: z.string().max(1000).optional(),
})

router.post('/:id/report', validate(reportSchema), async (req: AuthRequest, res, next) => {
  try {
    const user = req.user!
    const { data: room } = await supabase
      .from('trade_rooms')
      .select('creator_id, counterparty_id')
      .eq('id', req.params.id)
      .single()

    if (!room) return res.status(404).json({ error: 'Room not found' })
    if (room.creator_id !== user.id && room.counterparty_id !== user.id) {
      return res.status(403).json({ error: 'Access denied' })
    }

    const { data } = await supabase
      .from('reports')
      .insert({
        trade_room_id: req.params.id,
        reporter_id: user.id,
        reason: req.body.reason,
        notes: req.body.notes ?? null,
      })
      .select()
      .single()

    // Automatically set room status to disputed
    await supabase
      .from('trade_rooms')
      .update({ status: 'disputed', updated_at: new Date().toISOString() })
      .eq('id', req.params.id)

    res.status(201).json(data)
  } catch (err) { next(err) }
})

export default router
```

**Step 3: Write server/src/routes/activity.ts**

```ts
import { Router } from 'express'
import { authenticate, AuthRequest } from '../middleware/auth'
import { supabase } from '../lib/supabase'

const router = Router()
router.use(authenticate)

router.get('/:id/activity', async (req: AuthRequest, res, next) => {
  try {
    const user = req.user!
    const { data: room } = await supabase
      .from('trade_rooms')
      .select('creator_id, counterparty_id')
      .eq('id', req.params.id)
      .single()

    if (!room) return res.status(404).json({ error: 'Room not found' })
    if (room.creator_id !== user.id && room.counterparty_id !== user.id) {
      return res.status(403).json({ error: 'Access denied' })
    }

    const { data } = await supabase
      .from('trade_activity_logs')
      .select('*')
      .eq('trade_room_id', req.params.id)
      .order('created_at', { ascending: true })

    res.json(data ?? [])
  } catch (err) { next(err) }
})

export default router
```

**Step 4: Register all in index.ts**

```ts
import statusRouter from './routes/status'
import reportsRouter from './routes/reports'
import activityRouter from './routes/activity'
app.use('/api/v1/trade-rooms', statusRouter)
app.use('/api/v1/trade-rooms', reportsRouter)
app.use('/api/v1/trade-rooms', activityRouter)
```

**Step 5: Commit**

```bash
git add server/src/routes/status.ts server/src/routes/reports.ts server/src/routes/activity.ts server/src/index.ts
git commit -m "feat: add status, reports, and activity log routes"
```

---

## Phase 9 — Admin Routes

### Task 17: Implement admin routes

**Files:**
- Create: `server/src/routes/admin.ts`

**Step 1: Write server/src/routes/admin.ts**

```ts
import { Router } from 'express'
import { z } from 'zod'
import { authenticate } from '../middleware/auth'
import { requireAdmin } from '../middleware/requireAdmin'
import { validate } from '../middleware/validate'
import { supabase } from '../lib/supabase'

const router = Router()
router.use(authenticate, requireAdmin)

// GET all trade rooms with optional status filter
router.get('/trade-rooms', async (req, res, next) => {
  try {
    let query = supabase
      .from('trade_rooms')
      .select('*, trade_items(*), trade_confirmations(*)')
      .order('created_at', { ascending: false })

    if (req.query.status) {
      query = query.eq('status', req.query.status as string)
    }

    const { data, error } = await query
    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) { next(err) }
})

const adminUpdateRoomSchema = z.object({
  status: z.string().optional(),
  locked: z.boolean().optional(),
  notes: z.string().optional(),
  title: z.string().optional(),
})

router.patch('/trade-rooms/:id', validate(adminUpdateRoomSchema), async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('trade_rooms')
      .update({ ...req.body, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) { next(err) }
})

router.get('/reports', async (_req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) { next(err) }
})

const updateReportSchema = z.object({
  status: z.enum(['reviewed', 'dismissed']),
})

router.patch('/reports/:id', validate(updateReportSchema), async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('reports')
      .update({ status: req.body.status })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) { next(err) }
})

export default router
```

**Step 2: Register in index.ts**

```ts
import adminRouter from './routes/admin'
app.use('/api/v1/admin', adminRouter)
```

**Step 3: Commit**

```bash
git add server/src/routes/admin.ts server/src/index.ts
git commit -m "feat: add admin routes for trade rooms and reports"
```

---

## Phase 10 — Frontend: Shared Infrastructure

### Task 18: Set up Supabase client + React Router + TanStack Query

**Files:**
- Create: `client/src/lib/supabase.ts`
- Create: `client/src/lib/api.ts`
- Modify: `client/src/main.tsx`
- Create: `client/src/components/TrustBar.tsx`
- Create: `client/src/components/Layout.tsx`

**Step 1: Write client/src/lib/supabase.ts**

```ts
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)
```

**Step 2: Add env vars to client/.env.local**

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_API_URL=http://localhost:3001
```

**Step 3: Write client/src/lib/api.ts**

```ts
const BASE = import.meta.env.VITE_API_URL

async function getToken() {
  const { data } = await import('./supabase').then(m => m.supabase.auth.getSession())
  return data.session?.access_token
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken()
  const res = await fetch(`${BASE}/api/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return res.json()
}
```

**Step 4: Update client/src/main.tsx**

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'

const queryClient = new QueryClient()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>
)
```

**Step 5: Write client/src/components/TrustBar.tsx**

```tsx
export function TrustBar() {
  return (
    <div className="w-full bg-card border-b border-border py-2 text-center text-sm text-gray-400">
      We don't hold your skins. We don't use bots. Steam trades happen directly between you.
    </div>
  )
}
```

**Step 6: Write client/src/components/Layout.tsx**

```tsx
import { TrustBar } from './TrustBar'

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg text-white">
      <TrustBar />
      <main className="max-w-5xl mx-auto px-4 py-8">{children}</main>
    </div>
  )
}
```

**Step 7: Commit**

```bash
git add client/src/lib/ client/src/main.tsx client/src/components/TrustBar.tsx client/src/components/Layout.tsx
git commit -m "feat: add Supabase client, API helper, shared layout"
```

---

### Task 19: Set up auth context and protected routes

**Files:**
- Create: `client/src/hooks/useAuth.ts`
- Create: `client/src/components/ProtectedRoute.tsx`
- Create: `client/src/components/AdminRoute.tsx`
- Modify: `client/src/App.tsx`

**Step 1: Write client/src/hooks/useAuth.ts**

```ts
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { User, Session } from '@supabase/supabase-js'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setUser(data.session?.user ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  return { user, session, loading }
}
```

**Step 2: Write client/src/components/ProtectedRoute.tsx**

```tsx
import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="text-center p-8">Loading...</div>
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}
```

**Step 3: Write client/src/App.tsx with all routes**

```tsx
import { Routes, Route } from 'react-router-dom'
import { ProtectedRoute } from './components/ProtectedRoute'
import { LandingPage } from './pages/LandingPage'
import { LoginPage } from './pages/LoginPage'
import { SignupPage } from './pages/SignupPage'
import { DashboardPage } from './pages/DashboardPage'
import { NewTradePage } from './pages/NewTradePage'
import { TradeRoomPage } from './pages/TradeRoomPage'
import { JoinPage } from './pages/JoinPage'
import { AdminDashboardPage } from './pages/AdminDashboardPage'
import { AdminTradeRoomPage } from './pages/AdminTradeRoomPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/join/:invite_code" element={<JoinPage />} />
      <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
      <Route path="/trade/new" element={<ProtectedRoute><NewTradePage /></ProtectedRoute>} />
      <Route path="/trade/:id" element={<ProtectedRoute><TradeRoomPage /></ProtectedRoute>} />
      <Route path="/admin" element={<ProtectedRoute><AdminDashboardPage /></ProtectedRoute>} />
      <Route path="/admin/trade/:id" element={<ProtectedRoute><AdminTradeRoomPage /></ProtectedRoute>} />
    </Routes>
  )
}
```

**Step 4: Create empty page stubs** (one file each, enough to not crash)

```tsx
// client/src/pages/LandingPage.tsx
export function LandingPage() { return <div>Landing</div> }
// Repeat for all 8 page files
```

**Step 5: Commit**

```bash
git add client/src/hooks/ client/src/components/ client/src/App.tsx client/src/pages/
git commit -m "feat: add auth context, protected routes, and page stubs"
```

---

## Phase 11 — Frontend: Auth Pages

### Task 20: Build LoginPage and SignupPage

**Files:**
- Modify: `client/src/pages/LoginPage.tsx`
- Modify: `client/src/pages/SignupPage.tsx`

**Step 1: Write client/src/pages/LoginPage.tsx**

```tsx
import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Layout } from '../components/Layout'

export function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setError(error.message); setLoading(false); return }
    navigate('/dashboard')
  }

  return (
    <Layout>
      <div className="max-w-md mx-auto mt-16">
        <h1 className="text-2xl font-bold mb-6">Sign in</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full bg-card border border-border rounded px-3 py-2 text-white focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full bg-card border border-border rounded px-3 py-2 text-white focus:outline-none focus:border-accent"
            />
          </div>
          {error && <p className="text-danger text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent text-bg font-semibold py-2 rounded hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <p className="mt-4 text-sm text-gray-400">
          No account? <Link to="/signup" className="text-accent">Sign up</Link>
        </p>
      </div>
    </Layout>
  )
}
```

**Step 2: Write client/src/pages/SignupPage.tsx** (same pattern with username field, calls POST /auth/signup via apiFetch)

```tsx
import { useState } from 'react'
import { useNavigate, Link, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { supabase } from '../lib/supabase'
import { Layout } from '../components/Layout'

export function SignupPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const inviteCode = searchParams.get('invite')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await apiFetch('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email, username, password }),
      })
      // Sign in now
      await supabase.auth.signInWithPassword({ email, password })
      navigate(inviteCode ? `/join/${inviteCode}` : '/dashboard')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Layout>
      <div className="max-w-md mx-auto mt-16">
        <h1 className="text-2xl font-bold mb-6">Create account</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm mb-1">Username</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)} required
              className="w-full bg-card border border-border rounded px-3 py-2 text-white focus:outline-none focus:border-accent" />
          </div>
          <div>
            <label className="block text-sm mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full bg-card border border-border rounded px-3 py-2 text-white focus:outline-none focus:border-accent" />
          </div>
          <div>
            <label className="block text-sm mb-1">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
              className="w-full bg-card border border-border rounded px-3 py-2 text-white focus:outline-none focus:border-accent" />
          </div>
          {error && <p className="text-danger text-sm">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full bg-accent text-bg font-semibold py-2 rounded hover:opacity-90 disabled:opacity-50">
            {loading ? 'Creating account...' : 'Create account'}
          </button>
        </form>
        <p className="mt-4 text-sm text-gray-400">
          Have an account? <Link to="/login" className="text-accent">Sign in</Link>
        </p>
      </div>
    </Layout>
  )
}
```

**Step 3: Commit**

```bash
git add client/src/pages/LoginPage.tsx client/src/pages/SignupPage.tsx
git commit -m "feat: add login and signup pages"
```

---

## Phase 12 — Frontend: Dashboard + Create Room

### Task 21: Build DashboardPage

**Files:**
- Modify: `client/src/pages/DashboardPage.tsx`
- Create: `client/src/components/TradeRoomCard.tsx`

**Step 1: Write client/src/components/TradeRoomCard.tsx**

```tsx
import { Link } from 'react-router-dom'
import type { DbTradeRoom } from '../types'

const STATUS_COLORS: Record<string, string> = {
  waiting: 'text-warning',
  in_review: 'text-accent',
  ready: 'text-accent',
  completed: 'text-gray-400',
  cancelled: 'text-danger',
  disputed: 'text-danger',
  draft: 'text-gray-400',
}

export function TradeRoomCard({ room }: { room: DbTradeRoom }) {
  return (
    <Link to={`/trade/${room.id}`}
      className="block bg-card border border-border rounded-lg p-4 hover:border-accent transition-colors">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">{room.title}</h3>
        <span className={`text-sm ${STATUS_COLORS[room.status] ?? 'text-gray-400'}`}>
          {room.status.replace('_', ' ')}
        </span>
      </div>
      {room.estimated_value && (
        <p className="text-sm text-gray-400 mt-1">~${room.estimated_value}</p>
      )}
      <p className="text-xs text-gray-500 mt-2">{new Date(room.created_at).toLocaleDateString()}</p>
    </Link>
  )
}
```

**Step 2: Write client/src/pages/DashboardPage.tsx**

```tsx
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { Layout } from '../components/Layout'
import { TradeRoomCard } from '../components/TradeRoomCard'
import type { DbTradeRoom } from '../types'

export function DashboardPage() {
  const { data: rooms, isLoading } = useQuery({
    queryKey: ['trade-rooms'],
    queryFn: () => apiFetch<DbTradeRoom[]>('/trade-rooms'),
  })

  return (
    <Layout>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">My Trade Rooms</h1>
        <Link to="/trade/new"
          className="bg-accent text-bg font-semibold px-4 py-2 rounded hover:opacity-90">
          + New Trade
        </Link>
      </div>
      {isLoading && <p className="text-gray-400">Loading...</p>}
      {rooms?.length === 0 && (
        <p className="text-gray-400">No trade rooms yet. Start one to trade safely.</p>
      )}
      <div className="space-y-3">
        {rooms?.map(room => <TradeRoomCard key={room.id} room={room} />)}
      </div>
    </Layout>
  )
}
```

**Step 3: Commit**

```bash
git add client/src/pages/DashboardPage.tsx client/src/components/TradeRoomCard.tsx
git commit -m "feat: add dashboard page with trade room list"
```

---

### Task 22: Build NewTradePage

**Files:**
- Modify: `client/src/pages/NewTradePage.tsx`

**Step 1: Write client/src/pages/NewTradePage.tsx**

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { Layout } from '../components/Layout'

export function NewTradePage() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [estimatedValue, setEstimatedValue] = useState('')
  const [notes, setNotes] = useState('')
  const [counterpartyEmail, setCounterpartyEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const data = await apiFetch<{ room: { id: string } }>('/trade-rooms', {
        method: 'POST',
        body: JSON.stringify({
          title,
          estimated_value: estimatedValue ? Number(estimatedValue) : undefined,
          notes: notes || undefined,
          counterparty_email: counterpartyEmail || undefined,
        }),
      })
      navigate(`/trade/${data.room.id}`)
    } catch (err: any) {
      setError(err.message)
      setLoading(false)
    }
  }

  return (
    <Layout>
      <div className="max-w-lg mx-auto">
        <h1 className="text-2xl font-bold mb-6">New Trade Room</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm mb-1">Trade Title *</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} required
              placeholder="e.g. AK-47 Fire Serpent for M4A4 Howl"
              className="w-full bg-card border border-border rounded px-3 py-2 text-white focus:outline-none focus:border-accent" />
          </div>
          <div>
            <label className="block text-sm mb-1">Estimated Value (USD)</label>
            <input type="number" value={estimatedValue} onChange={e => setEstimatedValue(e.target.value)}
              placeholder="500"
              className="w-full bg-card border border-border rounded px-3 py-2 text-white focus:outline-none focus:border-accent" />
          </div>
          <div>
            <label className="block text-sm mb-1">Counterparty Email (optional — sends invite)</label>
            <input type="email" value={counterpartyEmail} onChange={e => setCounterpartyEmail(e.target.value)}
              placeholder="trader@example.com"
              className="w-full bg-card border border-border rounded px-3 py-2 text-white focus:outline-none focus:border-accent" />
          </div>
          <div>
            <label className="block text-sm mb-1">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              className="w-full bg-card border border-border rounded px-3 py-2 text-white focus:outline-none focus:border-accent" />
          </div>
          {error && <p className="text-danger text-sm">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full bg-accent text-bg font-semibold py-2 rounded hover:opacity-90 disabled:opacity-50">
            {loading ? 'Creating...' : 'Create Trade Room'}
          </button>
        </form>
      </div>
    </Layout>
  )
}
```

**Step 2: Commit**

```bash
git add client/src/pages/NewTradePage.tsx
git commit -m "feat: add new trade room creation page"
```

---

## Phase 13 — Frontend: Trade Room Detail (Real-Time)

### Task 23: Build ScamWarningBanner + VerificationCode components

**Files:**
- Create: `client/src/components/ScamWarningBanner.tsx`
- Create: `client/src/components/VerificationCode.tsx`
- Create: `client/src/components/ConfirmationChecklist.tsx`

**Step 1: Write client/src/components/ScamWarningBanner.tsx**

```tsx
export function ScamWarningBanner() {
  return (
    <div className="bg-danger/10 border border-danger rounded-lg p-4 mb-6">
      <p className="text-danger font-semibold text-sm">
        ⚠ SCAM WARNING: Never accept a Steam trade where the verification code
        in the trade message does not exactly match the code shown on this page.
        If the code is missing or different, cancel the trade immediately.
      </p>
    </div>
  )
}
```

**Step 2: Write client/src/components/VerificationCode.tsx**

```tsx
import { useState } from 'react'

export function VerificationCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="bg-card border border-border rounded-lg p-6 text-center">
      <p className="text-sm text-gray-400 mb-2">Verification Code</p>
      <p className="font-mono text-3xl font-bold text-accent tracking-widest mb-4">{code}</p>
      <p className="text-xs text-gray-400 mb-4">
        This code must appear in the Steam trade message. If it does not match, do not accept the trade.
      </p>
      <button onClick={handleCopy}
        className="bg-accent text-bg font-semibold px-6 py-2 rounded hover:opacity-90">
        {copied ? 'Copied!' : 'Copy Code'}
      </button>
    </div>
  )
}
```

**Step 3: Write client/src/components/ConfirmationChecklist.tsx**

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { DbTradeConfirmation } from '../types'

interface Props {
  roomId: string
  myConfirmation: DbTradeConfirmation | undefined
  locked: boolean
}

const CHECKS = [
  { key: 'confirmed_profile', label: "I've verified the other trader's Steam profile" },
  { key: 'confirmed_items', label: "I've reviewed all items in this trade" },
  { key: 'confirmed_code', label: "I understand the verification code and will check it in Steam" },
  { key: 'confirmed_mobile', label: "I will check my Steam mobile confirmation before accepting" },
] as const

export function ConfirmationChecklist({ roomId, myConfirmation, locked }: Props) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (update: Record<string, boolean>) =>
      apiFetch(`/trade-rooms/${roomId}/confirmation`, { method: 'PATCH', body: JSON.stringify(update) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['confirmation', roomId] }),
  })

  function toggle(key: string, current: boolean) {
    if (locked) return
    mutation.mutate({ [key]: !current })
  }

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="font-semibold mb-3">Your Confirmation Checklist</h3>
      {locked && (
        <p className="text-accent text-sm mb-3 font-medium">✓ Both parties confirmed — room is locked</p>
      )}
      <div className="space-y-3">
        {CHECKS.map(({ key, label }) => {
          const checked = myConfirmation?.[key] ?? false
          return (
            <label key={key} className={`flex items-start gap-3 ${locked ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(key, checked)}
                disabled={locked}
                className="mt-1 accent-accent"
              />
              <span className="text-sm">{label}</span>
            </label>
          )
        })}
      </div>
      {myConfirmation?.ready && !locked && (
        <p className="text-accent text-sm mt-3">✓ Waiting for the other trader to confirm</p>
      )}
    </div>
  )
}
```

**Step 4: Commit**

```bash
git add client/src/components/ScamWarningBanner.tsx client/src/components/VerificationCode.tsx client/src/components/ConfirmationChecklist.tsx
git commit -m "feat: add scam warning, verification code display, and confirmation checklist components"
```

---

### Task 24: Build TradeRoomPage with real-time subscriptions

**Files:**
- Modify: `client/src/pages/TradeRoomPage.tsx`
- Create: `client/src/hooks/useTradeRoom.ts`

**Step 1: Write client/src/hooks/useTradeRoom.ts**

```ts
import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { supabase } from '../lib/supabase'
import type { DbTradeRoom, DbTradeConfirmation } from '../types'

export function useTradeRoom(id: string) {
  const queryClient = useQueryClient()

  const roomQuery = useQuery({
    queryKey: ['trade-room', id],
    queryFn: () => apiFetch<DbTradeRoom & { trade_items: any[] }>(`/trade-rooms/${id}`),
  })

  const confirmationQuery = useQuery({
    queryKey: ['confirmation', id],
    queryFn: () => apiFetch<DbTradeConfirmation[]>(`/trade-rooms/${id}/confirmation`),
  })

  useEffect(() => {
    const channel = supabase
      .channel(`trade_room_${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trade_rooms', filter: `id=eq.${id}` },
        () => queryClient.invalidateQueries({ queryKey: ['trade-room', id] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trade_confirmations', filter: `trade_room_id=eq.${id}` },
        () => queryClient.invalidateQueries({ queryKey: ['confirmation', id] }))
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [id, queryClient])

  return { roomQuery, confirmationQuery }
}
```

**Step 2: Write client/src/pages/TradeRoomPage.tsx**

```tsx
import { useParams, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTradeRoom } from '../hooks/useTradeRoom'
import { useAuth } from '../hooks/useAuth'
import { apiFetch } from '../lib/api'
import { Layout } from '../components/Layout'
import { ScamWarningBanner } from '../components/ScamWarningBanner'
import { VerificationCode } from '../components/VerificationCode'
import { ConfirmationChecklist } from '../components/ConfirmationChecklist'

export function TradeRoomPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { roomQuery, confirmationQuery } = useTradeRoom(id!)

  const room = roomQuery.data
  const confirmations = confirmationQuery.data ?? []
  const myConfirmation = confirmations.find(c => c.user_id === user?.id)

  const resetMutation = useMutation({
    mutationFn: () => apiFetch(`/trade-rooms/${id}/reset`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trade-room', id] }),
  })

  const statusMutation = useMutation({
    mutationFn: (status: 'completed' | 'cancelled') =>
      apiFetch(`/trade-rooms/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-room', id] })
    },
  })

  if (roomQuery.isLoading) return <Layout><p className="text-gray-400">Loading...</p></Layout>
  if (!room) return <Layout><p className="text-danger">Room not found.</p></Layout>

  const inviteUrl = `${window.location.origin}/join/${(room as any).invite_code}`

  return (
    <Layout>
      <ScamWarningBanner />
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">{room.title}</h1>
            <p className="text-sm text-gray-400 mt-1">Status: <span className="text-accent">{room.status.replace('_', ' ')}</span></p>
          </div>
          {room.status === 'waiting' && (
            <div className="bg-card border border-border rounded p-3 text-sm">
              <p className="text-gray-400 mb-1">Invite link:</p>
              <code className="text-accent break-all">{inviteUrl}</code>
            </div>
          )}
        </div>

        <VerificationCode code={room.verification_code} />

        <ConfirmationChecklist
          roomId={id!}
          myConfirmation={myConfirmation}
          locked={room.locked}
        />

        <div className="flex gap-3 flex-wrap">
          {room.locked && (
            <button onClick={() => resetMutation.mutate()}
              className="px-4 py-2 border border-warning text-warning rounded hover:bg-warning/10 text-sm">
              Reset Trade
            </button>
          )}
          {room.status === 'ready' && (
            <button onClick={() => statusMutation.mutate('completed')}
              className="px-4 py-2 bg-accent text-bg font-semibold rounded hover:opacity-90 text-sm">
              Mark Completed
            </button>
          )}
          {!['completed', 'cancelled', 'disputed'].includes(room.status) && (
            <button onClick={() => statusMutation.mutate('cancelled')}
              className="px-4 py-2 border border-danger text-danger rounded hover:bg-danger/10 text-sm">
              Cancel Trade
            </button>
          )}
        </div>

        {room.notes && (
          <div className="bg-card border border-border rounded p-4">
            <h3 className="font-semibold mb-2 text-sm">Notes</h3>
            <p className="text-sm text-gray-400">{room.notes}</p>
          </div>
        )}
      </div>
    </Layout>
  )
}
```

**Step 3: Commit**

```bash
git add client/src/hooks/useTradeRoom.ts client/src/pages/TradeRoomPage.tsx
git commit -m "feat: add trade room detail page with real-time updates"
```

---

## Phase 14 — Frontend: Join Flow

### Task 25: Build JoinPage

**Files:**
- Modify: `client/src/pages/JoinPage.tsx`

**Step 1: Write client/src/pages/JoinPage.tsx**

```tsx
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { Layout } from '../components/Layout'

export function JoinPage() {
  const { invite_code } = useParams<{ invite_code: string }>()
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [room, setRoom] = useState<any>(null)
  const [error, setError] = useState('')
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    apiFetch(`/join/${invite_code}`)
      .then(setRoom)
      .catch(err => setError(err.message))
  }, [invite_code])

  async function handleJoin() {
    if (!user) {
      navigate(`/signup?invite=${invite_code}`)
      return
    }
    setJoining(true)
    try {
      const joined = await apiFetch<{ id: string }>(`/join/${invite_code}`, { method: 'POST' })
      navigate(`/trade/${joined.id}`)
    } catch (err: any) {
      setError(err.message)
      setJoining(false)
    }
  }

  if (loading) return <Layout><p>Loading...</p></Layout>
  if (error) return <Layout><p className="text-danger">{error}</p></Layout>
  if (!room) return <Layout><p className="text-gray-400">Loading invite...</p></Layout>

  return (
    <Layout>
      <div className="max-w-md mx-auto mt-16 text-center">
        <h1 className="text-2xl font-bold mb-2">You've been invited to trade</h1>
        <p className="text-xl text-accent mb-6">{room.title}</p>
        {room.estimated_value && (
          <p className="text-gray-400 mb-6">Estimated value: ~${room.estimated_value}</p>
        )}
        <div className="bg-card border border-border rounded-lg p-4 mb-6 text-sm text-gray-400">
          We don't hold your skins. We don't use bots. Steam trades happen directly between you.
        </div>
        <button onClick={handleJoin} disabled={joining}
          className="w-full bg-accent text-bg font-semibold py-3 rounded hover:opacity-90 disabled:opacity-50">
          {joining ? 'Joining...' : user ? 'Join Trade Room' : 'Sign up to Join'}
        </button>
      </div>
    </Layout>
  )
}
```

**Step 2: Commit**

```bash
git add client/src/pages/JoinPage.tsx
git commit -m "feat: add counterparty join page"
```

---

## Phase 15 — Frontend: Admin Dashboard

### Task 26: Build AdminDashboardPage and AdminTradeRoomPage

**Files:**
- Modify: `client/src/pages/AdminDashboardPage.tsx`
- Modify: `client/src/pages/AdminTradeRoomPage.tsx`

**Step 1: Write client/src/pages/AdminDashboardPage.tsx**

```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { Layout } from '../components/Layout'

export function AdminDashboardPage() {
  const queryClient = useQueryClient()
  const { data: rooms } = useQuery({
    queryKey: ['admin-rooms'],
    queryFn: () => apiFetch<any[]>('/admin/trade-rooms'),
  })
  const { data: reports } = useQuery({
    queryKey: ['admin-reports'],
    queryFn: () => apiFetch<any[]>('/admin/reports'),
  })

  return (
    <Layout>
      <h1 className="text-2xl font-bold mb-6">Admin Dashboard</h1>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">All Trade Rooms</h2>
        <div className="space-y-2">
          {rooms?.map(room => (
            <Link key={room.id} to={`/admin/trade/${room.id}`}
              className="flex items-center justify-between bg-card border border-border rounded p-3 hover:border-accent">
              <span>{room.title}</span>
              <span className="text-sm text-gray-400">{room.status}</span>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Pending Reports</h2>
        <div className="space-y-2">
          {reports?.filter(r => r.status === 'pending').map(report => (
            <div key={report.id} className="bg-card border border-danger/50 rounded p-3">
              <p className="text-sm font-medium">{report.reason}</p>
              <p className="text-xs text-gray-400">{report.notes}</p>
              <Link to={`/admin/trade/${report.trade_room_id}`}
                className="text-accent text-xs mt-1 inline-block">View Room →</Link>
            </div>
          ))}
        </div>
      </section>
    </Layout>
  )
}
```

**Step 2: Write client/src/pages/AdminTradeRoomPage.tsx** (admin view with override controls)

```tsx
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { Layout } from '../components/Layout'

export function AdminTradeRoomPage() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()

  const { data: room } = useQuery({
    queryKey: ['trade-room', id],
    queryFn: () => apiFetch<any>(`/trade-rooms/${id}`),
  })

  const overrideMutation = useMutation({
    mutationFn: (update: any) =>
      apiFetch(`/admin/trade-rooms/${id}`, { method: 'PATCH', body: JSON.stringify(update) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trade-room', id] }),
  })

  if (!room) return <Layout><p className="text-gray-400">Loading...</p></Layout>

  return (
    <Layout>
      <h1 className="text-2xl font-bold mb-2">[ADMIN] {room.title}</h1>
      <p className="text-gray-400 mb-6">Status: {room.status} | Locked: {String(room.locked)}</p>

      <div className="flex gap-3 flex-wrap mb-6">
        <button onClick={() => overrideMutation.mutate({ locked: false, status: 'in_review' })}
          className="px-4 py-2 border border-warning text-warning rounded hover:bg-warning/10 text-sm">
          Force Unlock
        </button>
        <button onClick={() => overrideMutation.mutate({ status: 'disputed' })}
          className="px-4 py-2 border border-danger text-danger rounded hover:bg-danger/10 text-sm">
          Flag as Disputed
        </button>
        <button onClick={() => overrideMutation.mutate({ status: 'cancelled' })}
          className="px-4 py-2 border border-gray-500 text-gray-400 rounded hover:bg-gray-700 text-sm">
          Cancel Trade
        </button>
      </div>

      <div className="bg-card border border-border rounded p-4 text-sm font-mono whitespace-pre-wrap">
        {JSON.stringify(room, null, 2)}
      </div>
    </Layout>
  )
}
```

**Step 3: Commit**

```bash
git add client/src/pages/AdminDashboardPage.tsx client/src/pages/AdminTradeRoomPage.tsx
git commit -m "feat: add admin dashboard and admin room detail pages"
```

---

## Phase 16 — Landing Page

### Task 27: Build LandingPage

**Files:**
- Modify: `client/src/pages/LandingPage.tsx`

**Step 1: Write client/src/pages/LandingPage.tsx**

```tsx
import { Link } from 'react-router-dom'
import { TrustBar } from '../components/TrustBar'

export function LandingPage() {
  return (
    <div className="min-h-screen bg-bg text-white">
      <TrustBar />
      <div className="max-w-3xl mx-auto px-4 py-24 text-center">
        <h1 className="text-4xl font-bold mb-4">
          Trade CS2 Skins Without Getting Scammed
        </h1>
        <p className="text-gray-400 text-lg mb-4">
          Every SkinPeer trade includes a verifiable code that must appear in the
          Steam mobile confirmation. If the code doesn't match — the trade is unsafe.
        </p>
        <div className="bg-card border border-border rounded-lg p-6 mb-8 text-left max-w-md mx-auto">
          <p className="text-sm text-gray-400 mb-2">Example verification code</p>
          <p className="font-mono text-2xl text-accent tracking-widest">IRON-4829-NOVA</p>
          <p className="text-xs text-gray-500 mt-2">
            This code appears in the Steam trade message. No match = unsafe trade. Cancel immediately.
          </p>
        </div>
        <div className="flex gap-4 justify-center">
          <Link to="/signup"
            className="bg-accent text-bg font-semibold px-8 py-3 rounded hover:opacity-90">
            Get Started
          </Link>
          <Link to="/login"
            className="border border-border px-8 py-3 rounded hover:border-accent text-gray-300">
            Sign In
          </Link>
        </div>
        <div className="mt-16 grid grid-cols-3 gap-6 text-sm text-gray-400">
          <div>
            <p className="text-accent font-semibold mb-1">No Bots</p>
            <p>Trades happen directly in Steam between you and your counterparty.</p>
          </div>
          <div>
            <p className="text-accent font-semibold mb-1">No Custody</p>
            <p>We never hold your skins. Nothing leaves your inventory until you confirm.</p>
          </div>
          <div>
            <p className="text-accent font-semibold mb-1">Verification Codes</p>
            <p>A unique code must appear in every trade message. Missing code = stop.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add client/src/pages/LandingPage.tsx
git commit -m "feat: add landing page"
```

---

## Verification Checklist

After implementing all phases, verify end-to-end:

1. **Server health**: `curl http://localhost:3001/health` → `{"ok":true}`
2. **Signup**: POST `/api/v1/auth/signup` creates user in both Supabase Auth and `users` table
3. **Create room**: POST `/api/v1/trade-rooms` returns room with `invite_url` and unique `verification_code`
4. **Join flow**: GET `/api/v1/join/:code` returns room metadata; POST `/api/v1/join/:code` sets `counterparty_id` and status `in_review`
5. **Confirmation lock**: PATCH confirmation for both users → room status becomes `ready`, `locked = true`
6. **Reset**: POST reset → `locked = false`, confirmations cleared, status `in_review`
7. **Admin**: Admin user can GET all rooms, PATCH any room field
8. **Real-time**: Open trade room in two browser tabs as creator and counterparty — confirming checkboxes in one tab updates the other without refresh
9. **Lock enforcement**: With `locked = true`, POST to `/items` returns 403

---

## Phased Development Roadmap

| Phase | Scope | Milestone |
|-------|-------|-----------|
| 1 | Monorepo scaffold, TypeScript, Tailwind | Skeleton runs |
| 2 | DB schema in Supabase | All tables created |
| 3 | Supabase client + all middleware | Auth works |
| 4 | Auth routes + makeAdmin | Signup/login tested |
| 5 | Code generation services | Unique codes generated |
| 6 | Trade room CRUD + items | Rooms created and listed |
| 7 | Invite flow + Resend email | Invite link sent |
| 8 | Confirmation + locking logic | Room locks correctly |
| 9 | Admin routes | Admin can manage any room |
| 10 | Frontend: shared infra + auth pages | Login/signup works in browser |
| 11 | Frontend: dashboard + create room | User can create and view rooms |
| 12 | Frontend: trade room detail + real-time | Checklist syncs live |
| 13 | Frontend: join flow | Counterparty can join via link |
| 14 | Frontend: admin dashboard | Founder can monitor trades |
| 15 | Landing page | Product presentable |

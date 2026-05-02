import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createSupabaseStub } from './helpers/mockSupabase'

const ME = '00000000-0000-0000-0000-000000000001'

describe('routes/auth', () => {
  let s: ReturnType<typeof createSupabaseStub>
  let app: express.Express

  beforeEach(async () => {
    s = createSupabaseStub()
    vi.resetModules()
    vi.doMock('../src/lib/supabase', () => ({ supabase: s.client }))
    vi.doMock('../src/middleware/authenticate', () => ({
      authenticate: (req: any, _res: any, next: any) => { req.user = { id: ME, email: 'me@test.local' }; next() },
    }))
    const { default: router } = await import('../src/routes/auth')
    app = express().use(express.json()).use('/api/auth', router)
  })
  afterEach(() => { vi.restoreAllMocks() })

  describe('POST /api/auth/profile', () => {
    it('400 on invalid username (too short)', async () => {
      const res = await request(app).post('/api/auth/profile').send({ username: 'a' })
      expect(res.status).toBe(400)
    })

    it('400 on non-alphanumeric username', async () => {
      const res = await request(app).post('/api/auth/profile').send({ username: 'has space' })
      expect(res.status).toBe(400)
    })

    it('400 on missing username', async () => {
      const res = await request(app).post('/api/auth/profile').send({})
      expect(res.status).toBe(400)
    })

    it('updates and returns the profile on success', async () => {
      s.push({ data: { id: ME, username: 'newname', is_admin: false } })
      const res = await request(app).post('/api/auth/profile').send({ username: 'newname' })
      expect(res.status).toBe(200)
      expect(res.body.username).toBe('newname')
      expect(s._calls.find((c) => c.op === 'update')?.table).toBe('profiles')
    })

    it('400 when supabase returns an error', async () => {
      s.push({ data: null, error: { message: 'duplicate username' } })
      const res = await request(app).post('/api/auth/profile').send({ username: 'taken' })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/duplicate/i)
    })
  })

  describe('GET /api/auth/me', () => {
    it('returns the caller profile on success', async () => {
      s.push({ data: { id: ME, username: 'me', is_admin: false } })
      const res = await request(app).get('/api/auth/me')
      expect(res.status).toBe(200)
      expect(res.body.id).toBe(ME)
    })

    it('404 when profile not found', async () => {
      s.push({ data: null, error: null })
      const res = await request(app).get('/api/auth/me')
      expect(res.status).toBe(404)
    })

    it('queries profiles by req.user.id', async () => {
      s.push({ data: { id: ME, username: 'me' } })
      await request(app).get('/api/auth/me')
      expect(s._calls.some((c) => c.table === 'profiles')).toBe(true)
    })
  })
})

describe('routes/auth — auth required', () => {
  // Re-mount without the authenticate stub to confirm the real middleware
  // would 401. Here we substitute an authenticate that always 401s and
  // confirm the routes propagate it.
  let app: express.Express

  beforeEach(async () => {
    vi.resetModules()
    vi.doMock('../src/lib/supabase', () => ({ supabase: { from: () => ({ }) } }))
    vi.doMock('../src/middleware/authenticate', () => ({
      authenticate: (_req: any, res: any, _next: any) => { res.status(401).json({ error: 'Unauthorized' }) },
    }))
    const { default: router } = await import('../src/routes/auth')
    app = express().use(express.json()).use('/api/auth', router)
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('POST /profile returns 401 without auth', async () => {
    const res = await request(app).post('/api/auth/profile').send({ username: 'x' })
    expect(res.status).toBe(401)
  })

  it('GET /me returns 401 without auth', async () => {
    const res = await request(app).get('/api/auth/me')
    expect(res.status).toBe(401)
  })
})

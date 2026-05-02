import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createSupabaseStub } from './helpers/mockSupabase'

const ME = '00000000-0000-0000-0000-000000000001'

describe('routes/traders', () => {
  let s: ReturnType<typeof createSupabaseStub>
  let app: express.Express

  beforeEach(async () => {
    s = createSupabaseStub()
    vi.resetModules()
    vi.doMock('../src/lib/supabase', () => ({ supabase: s.client }))
    vi.doMock('../src/middleware/authenticate', () => ({
      authenticate: (req: any, _res: any, next: any) => { req.user = { id: ME }; next() },
    }))
    const { default: router } = await import('../src/routes/traders')
    app = express().use(express.json()).use('/api/traders', router)
  })
  afterEach(() => { vi.restoreAllMocks() })

  describe('GET /api/traders', () => {
    it('returns the list (200)', async () => {
      s.push({ data: [{ user_id: 'u-1' }, { user_id: 'u-2' }] })
      const res = await request(app).get('/api/traders')
      expect(res.status).toBe(200)
      expect(res.body.length).toBe(2)
    })

    it('400 on invalid sort param', async () => {
      const res = await request(app).get('/api/traders?sort=bogus')
      expect(res.status).toBe(400)
    })

    it('400 on limit > 50', async () => {
      const res = await request(app).get('/api/traders?limit=51')
      expect(res.status).toBe(400)
    })

    it('accepts sort=rating', async () => {
      s.push({ data: [] })
      const res = await request(app).get('/api/traders?sort=rating')
      expect(res.status).toBe(200)
    })

    it('accepts sort=trades', async () => {
      s.push({ data: [] })
      const res = await request(app).get('/api/traders?sort=trades')
      expect(res.status).toBe(200)
    })
  })

  describe('GET /api/traders/me/profile', () => {
    it('returns existing trader profile when present', async () => {
      s.push({ data: { user_id: ME, display_name: 'Alice', accepting_trades: true } })
      const res = await request(app).get('/api/traders/me/profile')
      expect(res.status).toBe(200)
      expect(res.body.display_name).toBe('Alice')
    })

    it('auto-creates a default trader_profile on first call', async () => {
      s.push({ data: null })                                               // no existing
      s.push({ data: { steam_persona: 'AlicePersona', username: 'alice' } }) // profiles lookup
      s.push({ data: { user_id: ME, display_name: 'AlicePersona' } })       // insert
      const res = await request(app).get('/api/traders/me/profile')
      expect(res.status).toBe(201)
      expect(res.body.display_name).toBe('AlicePersona')
    })
  })

  describe('PATCH /api/traders/me/profile', () => {
    it('updates display_name', async () => {
      s.push({ data: { user_id: ME, display_name: 'NewName' } })
      const res = await request(app).patch('/api/traders/me/profile').send({ display_name: 'NewName' })
      expect(res.status).toBe(200)
      expect(res.body.display_name).toBe('NewName')
    })

    it('400 on too-long display_name', async () => {
      const res = await request(app).patch('/api/traders/me/profile').send({ display_name: 'x'.repeat(100) })
      expect(res.status).toBe(400)
    })

    it('400 when supabase returns an error', async () => {
      s.push({ data: null, error: { message: 'no row' } })
      const res = await request(app).patch('/api/traders/me/profile').send({ accepting_trades: false })
      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/traders/:userId', () => {
    it('returns the public profile', async () => {
      s.push({ data: { user_id: 'u-x', display_name: 'X' } })
      const res = await request(app).get('/api/traders/u-x')
      expect(res.status).toBe(200)
      expect(res.body.display_name).toBe('X')
    })

    it('404 when profile is private or missing', async () => {
      s.push({ data: null })
      const res = await request(app).get('/api/traders/u-z')
      expect(res.status).toBe(404)
    })
  })
})

describe('routes/traders — auth required', () => {
  let app: express.Express

  beforeEach(async () => {
    vi.resetModules()
    vi.doMock('../src/lib/supabase', () => ({ supabase: { from: () => ({}) } }))
    vi.doMock('../src/middleware/authenticate', () => ({
      authenticate: (_req: any, res: any) => { res.status(401).json({ error: 'Unauthorized' }) },
    }))
    const { default: router } = await import('../src/routes/traders')
    app = express().use(express.json()).use('/api/traders', router)
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('GET /api/traders 401 without auth', async () => {
    const res = await request(app).get('/api/traders')
    expect(res.status).toBe(401)
  })
})

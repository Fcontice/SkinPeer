import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createSupabaseStub } from './helpers/mockSupabase'

const ADMIN = '00000000-0000-0000-0000-0000000000aa'
const NORMAL = '00000000-0000-0000-0000-0000000000bb'

async function mountAdmin(asAdmin: boolean) {
  vi.resetModules()
  const s = createSupabaseStub()
  vi.doMock('../src/lib/supabase', () => ({ supabase: s.client }))
  vi.doMock('../src/middleware/authenticate', () => ({
    authenticate: (req: any, _res: any, next: any) => {
      req.user = { id: asAdmin ? ADMIN : NORMAL, email: 'x@test.local' }
      next()
    },
  }))
  vi.doMock('../src/middleware/requireAdmin', () => ({
    requireAdmin: asAdmin
      ? (req: any, _res: any, next: any) => { req.isAdmin = true; next() }
      : (_req: any, res: any) => { res.status(403).json({ error: 'Forbidden' }) },
  }))
  const { default: router } = await import('../src/routes/admin')
  const app = express().use(express.json()).use('/api/admin', router)
  return { s, app }
}

describe('routes/admin — non-admin gate', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it.each([
    ['GET',  '/api/admin/proposals'],
    ['GET',  '/api/admin/reports'],
  ])('%s %s returns 403 for non-admin', async (method, path) => {
    const { app } = await mountAdmin(false)
    const res = await request(app)[method.toLowerCase() as 'get'](path)
    expect(res.status).toBe(403)
  })

  it('POST /api/admin/reports/:id returns 403 for non-admin', async () => {
    const { app } = await mountAdmin(false)
    const res = await request(app).post('/api/admin/reports/r-1').send({ status: 'resolved' })
    expect(res.status).toBe(403)
  })

  it('PATCH /api/admin/users/:id returns 403 for non-admin', async () => {
    const { app } = await mountAdmin(false)
    const res = await request(app).patch('/api/admin/users/u-1').send({ is_admin: true })
    expect(res.status).toBe(403)
  })
})

describe('routes/admin — admin happy paths', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('GET /proposals returns the list', async () => {
    const { s, app } = await mountAdmin(true)
    s.push({ data: [{ id: 'p-1' }, { id: 'p-2' }] })
    const res = await request(app).get('/api/admin/proposals')
    expect(res.status).toBe(200)
    expect(res.body.length).toBe(2)
  })

  it('GET /proposals filters by status when present', async () => {
    const { s, app } = await mountAdmin(true)
    s.push({ data: [] })
    await request(app).get('/api/admin/proposals?status=completed')
    expect(s._calls.some((c) => c.table === 'trade_proposals')).toBe(true)
  })

  it('GET /reports defaults to status=open', async () => {
    const { s, app } = await mountAdmin(true)
    s.push({ data: [] })
    const res = await request(app).get('/api/admin/reports')
    expect(res.status).toBe(200)
  })

  it('POST /reports/:id 400 on invalid status', async () => {
    const { app } = await mountAdmin(true)
    const res = await request(app).post('/api/admin/reports/r-1').send({ status: 'maybe' })
    expect(res.status).toBe(400)
  })

  it('POST /reports/:id resolves and logs activity when proposal_id is present', async () => {
    const { s, app } = await mountAdmin(true)
    s.push({ data: { id: 'r-1', proposal_id: 'p-1', status: 'resolved' } }) // update→single
    s.push({ data: { id: 'log-1' } })                                        // activity insert
    const res = await request(app).post('/api/admin/reports/r-1').send({ status: 'resolved' })
    expect(res.status).toBe(200)
    expect(s._calls.some((c) => c.table === 'trade_activity_log')).toBe(true)
  })

  it('POST /reports/:id resolves without log when no proposal_id', async () => {
    const { s, app } = await mountAdmin(true)
    s.push({ data: { id: 'r-2', proposal_id: null, status: 'dismissed' } })
    const res = await request(app).post('/api/admin/reports/r-2').send({ status: 'dismissed' })
    expect(res.status).toBe(200)
    expect(s._calls.some((c) => c.table === 'trade_activity_log')).toBe(false)
  })

  it('PATCH /users/:id 400 on missing is_admin field', async () => {
    const { app } = await mountAdmin(true)
    const res = await request(app).patch('/api/admin/users/u-1').send({})
    expect(res.status).toBe(400)
  })

  it('PATCH /users/:id toggles is_admin', async () => {
    const { s, app } = await mountAdmin(true)
    s.push({ data: { id: 'u-1', is_admin: true } })
    const res = await request(app).patch('/api/admin/users/u-1').send({ is_admin: true })
    expect(res.status).toBe(200)
    expect(res.body.is_admin).toBe(true)
  })
})

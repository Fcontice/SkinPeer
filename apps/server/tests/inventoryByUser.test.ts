import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createSupabaseStub } from './helpers/mockSupabase'

describe('GET /by-user/:user_id', () => {
  let s: ReturnType<typeof createSupabaseStub>
  let app: express.Express

  beforeEach(async () => {
    s = createSupabaseStub()
    vi.resetModules()
    vi.doMock('../src/lib/supabase', () => ({ supabase: s.client }))
    vi.doMock('../src/middleware/authenticate', () => ({
      authenticate: (req: any, _res: any, next: any) => { req.user = { id: 'me' }; next() },
    }))
    const { default: router } = await import('../src/routes/inventoryByUser')
    app = express().use(express.json()).use('/api/inventory', router)
  })

  it('404 when target user has no steam_id', async () => {
    s.push({ data: null })
    const res = await request(app).get('/api/inventory/by-user/u-1')
    expect(res.status).toBe(404)
  })

  it('returns cached items when fresh', async () => {
    s.push({ data: { steam_id: '7656' } })
    s.push({ data: { items: [{ asset_id: 'a' }], is_private: false, fetched_at: new Date().toISOString() } })
    const res = await request(app).get('/api/inventory/by-user/u-1')
    expect(res.status).toBe(200)
    expect(res.body.cached).toBe(true)
    expect(res.body.items.length).toBe(1)
  })

  it('returns is_private:true when Steam returns 403', async () => {
    s.push({ data: { steam_id: '7656' } })
    s.push({ data: null })
    s.push({ data: null })
    global.fetch = vi.fn(async () => ({ status: 403, ok: false }) as Response) as any
    const res = await request(app).get('/api/inventory/by-user/u-1')
    expect(res.status).toBe(200)
    expect(res.body.is_private).toBe(true)
    expect(res.body.items).toEqual([])
    expect(s._calls.some((c) => c.op === 'upsert')).toBe(true)
  })
})

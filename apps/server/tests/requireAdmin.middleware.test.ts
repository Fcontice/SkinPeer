import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createSupabaseStub } from './helpers/mockSupabase'

describe('requireAdmin middleware', () => {
  let s: ReturnType<typeof createSupabaseStub>

  beforeEach(() => {
    s = createSupabaseStub()
    vi.resetModules()
    vi.doMock('../src/lib/supabase', () => ({ supabase: s.client }))
  })
  afterEach(() => { vi.restoreAllMocks() })

  async function makeApp(user: { id: string } | null) {
    const { requireAdmin } = await import('../src/middleware/requireAdmin')
    return express()
      .use((req: any, _res, next) => { req.user = user ?? undefined; next() })
      .get('/x', requireAdmin, (req: any, res) => res.json({ ok: true, isAdmin: req.isAdmin }))
  }

  it('returns 401 when req.user is missing', async () => {
    const app = await makeApp(null)
    const res = await request(app).get('/x')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Unauthorized')
  })

  it('returns 403 when profile.is_admin is false', async () => {
    s.push({ data: { is_admin: false } })
    const app = await makeApp({ id: 'u-1' })
    const res = await request(app).get('/x')
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('Forbidden')
  })

  it('returns 403 when profile not found', async () => {
    s.push({ data: null })
    const app = await makeApp({ id: 'u-1' })
    const res = await request(app).get('/x')
    expect(res.status).toBe(403)
  })

  it('passes through and sets req.isAdmin=true when is_admin is true', async () => {
    s.push({ data: { is_admin: true } })
    const app = await makeApp({ id: 'u-1' })
    const res = await request(app).get('/x')
    expect(res.status).toBe(200)
    expect(res.body.isAdmin).toBe(true)
  })

  it('queries profiles by req.user.id', async () => {
    s.push({ data: { is_admin: true } })
    const app = await makeApp({ id: 'specific-id' })
    await request(app).get('/x')
    expect(s._calls[0].table).toBe('profiles')
  })
})

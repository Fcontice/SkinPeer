import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'

describe('authenticate middleware', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.restoreAllMocks() })

  async function makeApp(getUserResult: { user: { id: string; email: string } | null; error?: unknown }) {
    vi.doMock('../src/lib/supabase', () => ({
      supabase: {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: getUserResult.user },
            error: getUserResult.error ?? null,
          }),
        },
      },
    }))
    const { authenticate } = await import('../src/middleware/authenticate')
    return express().get('/x', authenticate, (req: any, res) => res.json({ user: req.user }))
  }

  it('returns 401 when no Authorization header is present', async () => {
    const app = await makeApp({ user: null, error: { message: 'no token' } })
    const res = await request(app).get('/x')
    expect(res.status).toBe(401)
  })

  it('returns 401 when Supabase rejects the token', async () => {
    const app = await makeApp({ user: null, error: { message: 'bad jwt' } })
    const res = await request(app).get('/x').set('Authorization', 'Bearer junk')
    expect(res.status).toBe(401)
  })

  it('passes and populates req.user on a valid token', async () => {
    const app = await makeApp({ user: { id: 'u-1', email: 'u@example.com' } })
    const res = await request(app).get('/x').set('Authorization', 'Bearer good')
    expect(res.status).toBe(200)
    expect(res.body.user).toEqual({ id: 'u-1', email: 'u@example.com' })
  })

  it('handles missing user.email gracefully', async () => {
    const app = await makeApp({ user: { id: 'u-2', email: '' } })
    const res = await request(app).get('/x').set('Authorization', 'Bearer good')
    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe('')
  })
})

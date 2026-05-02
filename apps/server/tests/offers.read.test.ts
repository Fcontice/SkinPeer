import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createSupabaseStub } from './helpers/mockSupabase'

describe('GET handlers on /api/offers', () => {
  let s: ReturnType<typeof createSupabaseStub>

  async function appWith(callerId: string) {
    vi.resetModules()
    vi.doMock('../src/lib/supabase', () => ({ supabase: s.client }))
    vi.doMock('../src/middleware/authenticate', () => ({
      authenticate: (req: any, _res: any, next: any) => { req.user = { id: callerId }; next() },
    }))
    const { default: router } = await import('../src/routes/offers')
    return express().use(express.json()).use('/api/offers', router)
  }

  beforeEach(() => {
    s = createSupabaseStub()
  })

  describe('GET /api/offers/inbound/pending', () => {
    it('returns count + rows for current user', async () => {
      const app = await appWith('B')
      s.push({ data: [
        { id: 'o-1', from_user_id: 'A', to_user_id: 'B', status: 'pending', conversation_id: 'c-1', requested_items: [], offered_items: [], parent_offer_id: null, created_at: '2026-05-01' },
        { id: 'o-2', from_user_id: 'C', to_user_id: 'B', status: 'pending', conversation_id: 'c-2', requested_items: [], offered_items: [], parent_offer_id: null, created_at: '2026-04-30' },
      ], count: 2 })
      const res = await request(app).get('/api/offers/inbound/pending')
      expect(res.status).toBe(200)
      expect(res.body.count).toBe(2)
      expect(res.body.rows.length).toBe(2)
      expect(res.body.rows[0].id).toBe('o-1')
    })

    it('returns 0 + [] when no pending offers', async () => {
      const app = await appWith('B')
      s.push({ data: [], count: 0 })
      const res = await request(app).get('/api/offers/inbound/pending')
      expect(res.status).toBe(200)
      expect(res.body.count).toBe(0)
      expect(res.body.rows).toEqual([])
    })
  })

  describe('GET /api/offers/:id', () => {
    it('returns offer when caller is participant (sender)', async () => {
      const app = await appWith('A')
      s.push({ data: { id: 'o-1', from_user_id: 'A', to_user_id: 'B', status: 'pending', conversation_id: 'c-1', requested_items: [], offered_items: [], parent_offer_id: null } })
      const res = await request(app).get('/api/offers/o-1')
      expect(res.status).toBe(200)
      expect(res.body.id).toBe('o-1')
    })

    it('returns offer when caller is participant (recipient)', async () => {
      const app = await appWith('B')
      s.push({ data: { id: 'o-1', from_user_id: 'A', to_user_id: 'B', status: 'pending', conversation_id: 'c-1', requested_items: [], offered_items: [], parent_offer_id: null } })
      const res = await request(app).get('/api/offers/o-1')
      expect(res.status).toBe(200)
    })

    it('403 when caller is not a participant', async () => {
      const app = await appWith('Z')
      s.push({ data: { id: 'o-1', from_user_id: 'A', to_user_id: 'B', status: 'pending', conversation_id: 'c-1', requested_items: [], offered_items: [], parent_offer_id: null } })
      const res = await request(app).get('/api/offers/o-1')
      expect(res.status).toBe(403)
    })

    it('404 when offer not found', async () => {
      const app = await appWith('A')
      s.push({ data: null })
      const res = await request(app).get('/api/offers/o-1')
      expect(res.status).toBe(404)
    })
  })
})

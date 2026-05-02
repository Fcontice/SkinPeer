import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createSupabaseStub } from './helpers/mockSupabase'

describe('offer lifecycle', () => {
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

  describe('POST /api/offers/:id/withdraw', () => {
    it('A withdraws their own pending offer', async () => {
      const app = await appWith('A')
      s.push({ data: { id: 'o-1', from_user_id: 'A', to_user_id: 'B', status: 'pending', conversation_id: 'c-1', requested_items: [], offered_items: [], parent_offer_id: null } })
      s.push({ data: { id: 'o-1', status: 'withdrawn' } })
      const res = await request(app).post('/api/offers/o-1/withdraw')
      expect(res.status).toBe(200)
      expect(res.body.status).toBe('withdrawn')
    })

    it('403 if non-sender tries to withdraw', async () => {
      const app = await appWith('B')
      s.push({ data: { id: 'o-1', from_user_id: 'A', to_user_id: 'B', status: 'pending', conversation_id: 'c-1', requested_items: [], offered_items: [], parent_offer_id: null } })
      const res = await request(app).post('/api/offers/o-1/withdraw')
      expect(res.status).toBe(403)
    })

    it('400 if offer not pending', async () => {
      const app = await appWith('A')
      s.push({ data: { id: 'o-1', from_user_id: 'A', to_user_id: 'B', status: 'rejected', conversation_id: 'c-1', requested_items: [], offered_items: [], parent_offer_id: null } })
      const res = await request(app).post('/api/offers/o-1/withdraw')
      expect(res.status).toBe(400)
    })

    it('404 if offer not found', async () => {
      const app = await appWith('A')
      s.push({ data: null })
      const res = await request(app).post('/api/offers/o-1/withdraw')
      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/offers/:id/reject', () => {
    it('B rejects A\'s pending offer', async () => {
      const app = await appWith('B')
      s.push({ data: { id: 'o-1', from_user_id: 'A', to_user_id: 'B', status: 'pending', conversation_id: 'c-1', requested_items: [], offered_items: [], parent_offer_id: null } })
      s.push({ data: { id: 'o-1', status: 'rejected' } })
      const res = await request(app).post('/api/offers/o-1/reject')
      expect(res.status).toBe(200)
      expect(res.body.status).toBe('rejected')
    })

    it('403 if sender tries to reject (must withdraw)', async () => {
      const app = await appWith('A')
      s.push({ data: { id: 'o-1', from_user_id: 'A', to_user_id: 'B', status: 'pending', conversation_id: 'c-1', requested_items: [], offered_items: [], parent_offer_id: null } })
      const res = await request(app).post('/api/offers/o-1/reject')
      expect(res.status).toBe(403)
    })
  })
})

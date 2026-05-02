import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createSupabaseStub } from './helpers/mockSupabase'

const ITEM = {
  asset_id: '1', class_id: '2', name: 'AK',
  icon_url: 'https://x.example.com/img.png',
  wear: null, rarity: null, type: null, tradable: true, marketable: true,
}

describe('POST /api/offers/:id/counter', () => {
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

  it('400 if body fails Zod (no items)', async () => {
    const app = await appWith('B')
    const res = await request(app).post('/api/offers/o-1/counter').send({ requested_items: [], offered_items: [] })
    expect(res.status).toBe(400)
  })

  it('404 when original offer not found', async () => {
    const app = await appWith('B')
    s.push({ data: null })
    const res = await request(app).post('/api/offers/o-1/counter').send({ requested_items: [ITEM], offered_items: [] })
    expect(res.status).toBe(404)
  })

  it('403 if sender of original tries to counter', async () => {
    const app = await appWith('A')
    s.push({ data: { id: 'o-1', conversation_id: 'c-1', from_user_id: 'A', to_user_id: 'B', status: 'pending', requested_items: [], offered_items: [], parent_offer_id: null } })
    const res = await request(app).post('/api/offers/o-1/counter').send({ requested_items: [ITEM], offered_items: [] })
    expect(res.status).toBe(403)
  })

  it('400 if original is not pending', async () => {
    const app = await appWith('B')
    s.push({ data: { id: 'o-1', conversation_id: 'c-1', from_user_id: 'A', to_user_id: 'B', status: 'rejected', requested_items: [], offered_items: [], parent_offer_id: null } })
    const res = await request(app).post('/api/offers/o-1/counter').send({ requested_items: [ITEM], offered_items: [] })
    expect(res.status).toBe(400)
  })

  it('creates new offer with parent + flips original to countered', async () => {
    const app = await appWith('B')
    s.push({ data: { id: 'o-1', conversation_id: 'c-1', from_user_id: 'A', to_user_id: 'B', status: 'pending', requested_items: [], offered_items: [], parent_offer_id: null } }) // load
    s.push({ data: null }) // update parent → countered
    s.push({ data: { id: 'o-2', conversation_id: 'c-1', from_user_id: 'B', to_user_id: 'A', parent_offer_id: 'o-1', status: 'pending' } }) // insert child
    s.push({ data: { id: 'm-1' } }) // thread message

    const res = await request(app).post('/api/offers/o-1/counter').send({
      requested_items: [ITEM],
      offered_items: [],
    })
    expect(res.status).toBe(201)
    expect(res.body.parent_offer_id).toBe('o-1')
    expect(res.body.from_user_id).toBe('B')
    expect(res.body.to_user_id).toBe('A')

    // Verify the parent update was attempted
    expect(s._calls.some((c) => c.table === 'trade_offers' && c.op === 'update')).toBe(true)
    // Verify the messages insert was attempted
    expect(s._calls.some((c) => c.table === 'messages' && c.op === 'insert')).toBe(true)
  })

  it('409 when child insert hits 23505 (existing pending in B→A direction)', async () => {
    const app = await appWith('B')
    s.push({ data: { id: 'o-1', conversation_id: 'c-1', from_user_id: 'A', to_user_id: 'B', status: 'pending', requested_items: [], offered_items: [], parent_offer_id: null } })
    s.push({ data: null }) // update parent
    s.push({ data: null, error: { code: '23505', message: 'unique violation' } }) // insert child
    const res = await request(app).post('/api/offers/o-1/counter').send({ requested_items: [ITEM], offered_items: [] })
    expect(res.status).toBe(409)
  })
})

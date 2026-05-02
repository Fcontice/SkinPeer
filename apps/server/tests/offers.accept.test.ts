import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createSupabaseStub } from './helpers/mockSupabase'

const ITEM = (n: string) => ({
  asset_id: n, class_id: 'c', name: `Item ${n}`,
  icon_url: 'https://x.example.com/img.png', wear: null, rarity: null, type: null,
  tradable: true, marketable: true,
})

describe('POST /api/offers/:id/accept', () => {
  let s: ReturnType<typeof createSupabaseStub>

  async function appWith(callerId: string) {
    vi.resetModules()
    vi.doMock('../src/lib/supabase', () => ({ supabase: s.client }))
    vi.doMock('../src/middleware/authenticate', () => ({
      authenticate: (req: any, _res: any, next: any) => { req.user = { id: callerId }; next() },
    }))
    vi.doMock('../src/services/proposalCodeService', () => ({
      generateProposalVerificationCode: async () => 'TEST-0001-CASE',
    }))
    const { default: router } = await import('../src/routes/offers')
    return express().use(express.json()).use('/api/offers', router)
  }

  beforeEach(() => {
    s = createSupabaseStub()
  })

  it('403 if non-recipient (sender) tries to accept', async () => {
    const app = await appWith('A')
    s.push({ data: { id: 'o-1', conversation_id: 'c-1', from_user_id: 'A', to_user_id: 'B', status: 'pending', requested_items: [], offered_items: [], parent_offer_id: null } })
    const res = await request(app).post('/api/offers/o-1/accept')
    expect(res.status).toBe(403)
  })

  it('400 when offer not pending', async () => {
    const app = await appWith('B')
    s.push({ data: { id: 'o-1', conversation_id: 'c-1', from_user_id: 'A', to_user_id: 'B', status: 'rejected', requested_items: [], offered_items: [], parent_offer_id: null } })
    const res = await request(app).post('/api/offers/o-1/accept')
    expect(res.status).toBe(400)
  })

  it('404 when offer not found', async () => {
    const app = await appWith('B')
    s.push({ data: null })
    const res = await request(app).post('/api/offers/o-1/accept')
    expect(res.status).toBe(404)
  })

  it('creates proposal + items + thread message; returns proposal_id and code', async () => {
    const app = await appWith('B')
    s.push({ data: { id: 'o-1', conversation_id: 'c-1', from_user_id: 'A', to_user_id: 'B', status: 'pending',
                     requested_items: [ITEM('r1')], offered_items: [ITEM('a1'), ITEM('a2')], parent_offer_id: null } })  // load offer
    s.push({ data: { id: 'p-1', verification_code: 'TEST-0001-CASE', creator_id: 'A', recipient_id: 'B', status: 'draft' } }) // insert proposal
    s.push({ data: [], error: null }) // bulk insert trade_items
    s.push({ data: null }) // update offer (accepted + resulting_proposal_id)
    s.push({ data: null }) // insert thread message
    s.push({ data: null }) // insert activity log

    const res = await request(app).post('/api/offers/o-1/accept')
    expect(res.status).toBe(200)
    expect(res.body.offer_id).toBe('o-1')
    expect(res.body.proposal_id).toBe('p-1')
    expect(res.body.verification_code).toBe('TEST-0001-CASE')

    // Verify the trade_items insert was called
    expect(s._calls.some((c) => c.table === 'trade_items' && c.op === 'insert')).toBe(true)
    // Verify the messages insert was called
    expect(s._calls.some((c) => c.table === 'messages' && c.op === 'insert')).toBe(true)
    // Verify the activity log was written
    expect(s._calls.some((c) => c.table === 'trade_activity_log' && c.op === 'insert')).toBe(true)
  })
})

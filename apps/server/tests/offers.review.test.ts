import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createSupabaseStub } from './helpers/mockSupabase'

const ME = '00000000-0000-0000-0000-0000000000aa'
const OTHER = '00000000-0000-0000-0000-0000000000bb'
const OFFER_ID = 'offer-1'

const PRESET_OFFER = {
  id: OFFER_ID,
  conversation_id: 'c-1',
  from_user_id: ME,
  to_user_id: OTHER,
  status: 'pending',
  offered_items: [{ asset_id: 'a1', class_id: 'c1', name: 'AK-47 | Redline (Field-Tested)', icon_url: '', wear: 'Field-Tested', rarity: 'Classified', type: null }],
  requested_items: [{ asset_id: 'a2', class_id: 'c2', name: 'AWP | Asiimov (Field-Tested)', icon_url: '', wear: 'Field-Tested', rarity: 'Covert', type: null }],
  parent_offer_id: null,
}

const REVIEW_ROW = {
  id: 'rev-1',
  trade_offer_id: OFFER_ID,
  viewer_user_id: ME,
  payload: {
    fairness: 'fair',
    value_delta_usd: 0,
    notable_observations: [],
    risk_flags: [],
    summary: 'No obvious red flags.',
  },
  model: 'test-model',
  created_at: '2026-05-01T00:00:00.000Z',
}

interface MountResult {
  s: ReturnType<typeof createSupabaseStub>
  app: express.Express
}

async function mount(extraMock?: () => void): Promise<MountResult> {
  const s = createSupabaseStub()
  vi.resetModules()
  vi.doMock('../src/lib/supabase', () => ({ supabase: s.client }))
  vi.doMock('../src/middleware/authenticate', () => ({
    authenticate: (req: any, _res: any, next: any) => { req.user = { id: ME }; next() },
  }))
  vi.doMock('../src/services/proposalCodeService', () => ({
    generateProposalVerificationCode: vi.fn(),
  }))
  vi.doMock('../src/lib/marketPrice', () => ({
    getMarketPrice: vi.fn().mockResolvedValue({ market_hash_name: 'x', lowest_price: '$10.00', median_price: null, volume: null, source: 'steam_community_market', fetched_at: '' }),
  }))
  vi.doMock('../src/lib/openai', () => ({
    runOfferReview: vi.fn().mockResolvedValue({
      fairness: 'fair',
      value_delta_usd: 0,
      notable_observations: [],
      risk_flags: [],
      summary: 'No obvious red flags.',
    }),
    buildOfferReviewInput: vi.fn().mockReturnValue('{}'),
    AI_SAFETY_REVIEW_MODEL: 'test-model',
  }))
  extraMock?.()
  const { default: router } = await import('../src/routes/offers')
  const app = express().use(express.json()).use('/api/offers', router)
  return { s, app }
}

describe('POST /api/offers/:id/review', () => {
  it('404 when offer does not exist', async () => {
    const { s, app } = await mount()
    s.push({ data: null })
    const res = await request(app).post(`/api/offers/${OFFER_ID}/review`)
    expect(res.status).toBe(404)
  })

  it('403 when caller is not a participant', async () => {
    const { s, app } = await mount()
    s.push({ data: { ...PRESET_OFFER, from_user_id: 'X', to_user_id: 'Y' } })
    const res = await request(app).post(`/api/offers/${OFFER_ID}/review`)
    expect(res.status).toBe(403)
  })

  it('200 returns cached review without invoking the model', async () => {
    const { s, app } = await mount()
    s.push({ data: PRESET_OFFER })          // loadOffer
    s.push({ data: REVIEW_ROW })             // cache hit
    const res = await request(app).post(`/api/offers/${OFFER_ID}/review`)
    expect(res.status).toBe(200)
    expect(res.body.id).toBe('rev-1')
    expect(res.body.payload.fairness).toBe('fair')
    // No upsert should have happened on cache hit.
    expect(s._calls.some((c) => c.table === 'trade_offer_reviews' && c.op === 'upsert')).toBe(false)
  })

  it('201 generates and persists a new review on cache miss', async () => {
    const { s, app } = await mount()
    s.push({ data: PRESET_OFFER })              // loadOffer
    s.push({ data: null })                      // cache miss
    s.push({ data: { display_name: 'Me', total_trades: 0, average_rating: null } })       // viewer trader_profile
    s.push({ data: { display_name: 'Other', total_trades: 5, average_rating: 4.5 } })     // counterparty trader_profile
    s.push({ data: { created_at: new Date().toISOString() } })                            // viewer profile
    s.push({ data: { created_at: new Date().toISOString() } })                            // counterparty profile
    s.push({ data: [] })                                                                   // messages
    s.push({ data: null, count: 0 })                                                       // reports count
    s.push({ data: REVIEW_ROW })                                                           // upsert select single
    const res = await request(app).post(`/api/offers/${OFFER_ID}/review`)
    expect(res.status).toBe(201)
    expect(res.body.payload.fairness).toBe('fair')
    expect(s._calls.some((c) => c.table === 'trade_offer_reviews' && c.op === 'upsert')).toBe(true)
  })

  it('502 when the model returns null', async () => {
    const { s, app } = await mount(() => {
      vi.doMock('../src/lib/openai', () => ({
        runOfferReview: vi.fn().mockResolvedValue(null),
        buildOfferReviewInput: vi.fn().mockReturnValue('{}'),
        AI_SAFETY_REVIEW_MODEL: 'test-model',
      }))
    })
    s.push({ data: PRESET_OFFER })
    s.push({ data: null })
    s.push({ data: { display_name: 'Me' } })
    s.push({ data: { display_name: 'Other' } })
    s.push({ data: { created_at: new Date().toISOString() } })
    s.push({ data: { created_at: new Date().toISOString() } })
    s.push({ data: [] })
    s.push({ data: null, count: 0 })
    const res = await request(app).post(`/api/offers/${OFFER_ID}/review`)
    expect(res.status).toBe(502)
  })

  it('?refresh=true bypasses the cache and always invokes the model', async () => {
    const { s, app } = await mount()
    s.push({ data: PRESET_OFFER })           // loadOffer
    // No cache lookup mock pushed — refresh=true skips that path
    s.push({ data: { display_name: 'Me' } })
    s.push({ data: { display_name: 'Other' } })
    s.push({ data: { created_at: new Date().toISOString() } })
    s.push({ data: { created_at: new Date().toISOString() } })
    s.push({ data: [] })
    s.push({ data: null, count: 0 })
    s.push({ data: REVIEW_ROW })
    const res = await request(app).post(`/api/offers/${OFFER_ID}/review?refresh=true`)
    expect(res.status).toBe(201)
    // Should NOT have queried the cache table on refresh path.
    expect(
      s._calls.some(
        (c) => c.table === 'trade_offer_reviews' && c.op === 'select' && JSON.stringify(c.args).includes('*')
      ),
    ).toBe(false)
  })
})

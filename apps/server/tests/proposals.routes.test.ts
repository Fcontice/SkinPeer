import { describe, it, expect, vi, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createSupabaseStub } from './helpers/mockSupabase'

const ME       = '00000000-0000-0000-0000-0000000000aa'
const OTHER    = '00000000-0000-0000-0000-0000000000bb'
const PROP_ID  = '00000000-0000-0000-0000-000000000001'
const CONVO_ID = '00000000-0000-0000-0000-000000000002'

// =====================================================================
// Most tests use this default mount: ME is the caller, OpenAI is fully
// stubbed. AI-review tests override `extra` to plug in different responses.
// =====================================================================

interface MountResult {
  s: ReturnType<typeof createSupabaseStub>
  app: express.Express
}

async function mount(extra?: () => void): Promise<MountResult> {
  const s = createSupabaseStub()
  vi.resetModules()
  vi.doMock('../src/lib/supabase', () => ({ supabase: s.client }))
  vi.doMock('../src/middleware/authenticate', () => ({
    authenticate: (req: any, _res: any, next: any) => { req.user = { id: ME }; next() },
  }))
  vi.doMock('../src/services/proposalCodeService', () => ({
    generateProposalVerificationCode: vi.fn().mockResolvedValue('TEST01'),
  }))
  vi.doMock('../src/lib/openai', () => ({
    runAiSafetyReview: vi.fn().mockResolvedValue({
      risk_level: 'low', warnings: [], recommended_actions: ['Verify in Steam.'],
    }),
    buildAiReviewInput: vi.fn().mockReturnValue('{}'),
    AI_SAFETY_REVIEW_MODEL: 'test-model',
  }))
  extra?.()
  const { default: router } = await import('../src/routes/proposals')
  const app = express().use(express.json()).use('/api/proposals', router)
  return { s, app }
}

afterEach(() => { vi.restoreAllMocks() })

// =====================================================================
// POST /api/proposals
// =====================================================================
describe('POST /api/proposals', () => {
  it('400 on missing conversation_id', async () => {
    const { app } = await mount()
    const res = await request(app).post('/api/proposals').send({})
    expect(res.status).toBe(400)
  })

  it('400 on non-uuid conversation_id', async () => {
    const { app } = await mount()
    const res = await request(app).post('/api/proposals').send({ conversation_id: 'nope' })
    expect(res.status).toBe(400)
  })

  it('404 when conversation does not exist', async () => {
    const { s, app } = await mount()
    s.push({ data: null })
    const res = await request(app).post('/api/proposals').send({ conversation_id: CONVO_ID })
    expect(res.status).toBe(404)
  })

  it('403 when caller is not a participant of the conversation', async () => {
    const { s, app } = await mount()
    s.push({ data: { id: CONVO_ID, user_a_id: 'X', user_b_id: 'Y' } })
    const res = await request(app).post('/api/proposals').send({ conversation_id: CONVO_ID })
    expect(res.status).toBe(403)
  })

  it('201 creates proposal, posts inline message, logs activity', async () => {
    const { s, app } = await mount()
    s.push({ data: { id: CONVO_ID, user_a_id: ME, user_b_id: OTHER } }) // convo lookup
    s.push({ data: { id: PROP_ID, creator_id: ME, recipient_id: OTHER, status: 'draft', verification_code: 'TEST01' } }) // insert proposal
    s.push({ data: { id: 'm-1' } })  // message insert (awaited, no .single)
    s.push({ data: { id: 'a-1' } })  // activity log insert
    const res = await request(app).post('/api/proposals').send({ conversation_id: CONVO_ID })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(PROP_ID)
    expect(s._calls.some((c) => c.table === 'trade_proposals' && c.op === 'insert')).toBe(true)
    expect(s._calls.some((c) => c.table === 'messages' && c.op === 'insert')).toBe(true)
    expect(s._calls.some((c) => c.table === 'trade_activity_log' && c.op === 'insert')).toBe(true)
  })

  it('400 when proposal insert fails', async () => {
    const { s, app } = await mount()
    s.push({ data: { id: CONVO_ID, user_a_id: ME, user_b_id: OTHER } })
    s.push({ data: null, error: { message: 'unique violation' } })
    const res = await request(app).post('/api/proposals').send({ conversation_id: CONVO_ID })
    expect(res.status).toBe(400)
  })
})

// =====================================================================
// GET /api/proposals/:id (participant gating)
// =====================================================================
describe('GET /api/proposals/:id', () => {
  it('404 when not found', async () => {
    const { s, app } = await mount()
    s.push({ data: null })
    const res = await request(app).get(`/api/proposals/${PROP_ID}`)
    expect(res.status).toBe(404)
  })

  it('403 when not a participant', async () => {
    const { s, app } = await mount()
    s.push({ data: { id: PROP_ID, creator_id: 'X', recipient_id: 'Y', status: 'draft', conversation_id: CONVO_ID, ai_review_id: null } })
    const res = await request(app).get(`/api/proposals/${PROP_ID}`)
    expect(res.status).toBe(403)
  })

  it('200 returns proposal + items + checklist + ai_review', async () => {
    const { s, app } = await mount()
    s.push({ data: { id: PROP_ID, creator_id: ME, recipient_id: OTHER, status: 'draft', conversation_id: CONVO_ID, ai_review_id: null } }) // fetchProposal
    s.push({ data: { id: PROP_ID, creator_id: ME, recipient_id: OTHER, status: 'draft', verification_code: 'TEST01' } }) // full
    s.push({ data: [{ id: 'i-1', proposal_id: PROP_ID, owner_id: ME }, { id: 'i-2', proposal_id: PROP_ID, owner_id: OTHER }] }) // items
    s.push({ data: [] }) // checklist
    const res = await request(app).get(`/api/proposals/${PROP_ID}`)
    expect(res.status).toBe(200)
    expect(res.body.proposal.verification_code).toBe('TEST01')
    expect(Array.isArray(res.body.items.creator)).toBe(true)
    expect(Array.isArray(res.body.items.recipient)).toBe(true)
  })
})

// =====================================================================
// GET /api/proposals/me (own list)
// =====================================================================
describe('GET /api/proposals/me', () => {
  it('400 on invalid status', async () => {
    const { app } = await mount()
    const res = await request(app).get('/api/proposals/me?status=bogus')
    expect(res.status).toBe(400)
  })

  it('200 returns the list with default limit', async () => {
    const { s, app } = await mount()
    s.push({ data: [{ id: PROP_ID }] })
    const res = await request(app).get('/api/proposals/me')
    expect(res.status).toBe(200)
    expect(res.body.length).toBe(1)
  })

  it('accepts in_review as a status filter (D10 reserves the value)', async () => {
    const { s, app } = await mount()
    s.push({ data: [] })
    const res = await request(app).get('/api/proposals/me?status=in_review')
    expect(res.status).toBe(200)
  })

  it('accepts disputed as a status filter', async () => {
    const { s, app } = await mount()
    s.push({ data: [] })
    const res = await request(app).get('/api/proposals/me?status=disputed')
    expect(res.status).toBe(200)
  })
})

// =====================================================================
// DELETE /api/proposals/:id (creator + draft only)
// =====================================================================
describe('DELETE /api/proposals/:id', () => {
  it('404 when not found', async () => {
    const { s, app } = await mount()
    s.push({ data: null })
    const res = await request(app).delete(`/api/proposals/${PROP_ID}`)
    expect(res.status).toBe(404)
  })

  it('403 when caller is not the creator', async () => {
    const { s, app } = await mount()
    s.push({ data: { id: PROP_ID, creator_id: 'X', recipient_id: ME, status: 'draft', conversation_id: CONVO_ID, ai_review_id: null } })
    const res = await request(app).delete(`/api/proposals/${PROP_ID}`)
    expect(res.status).toBe(403)
  })

  it('400 when status is not draft', async () => {
    const { s, app } = await mount()
    s.push({ data: { id: PROP_ID, creator_id: ME, recipient_id: OTHER, status: 'completed', conversation_id: CONVO_ID, ai_review_id: null } })
    const res = await request(app).delete(`/api/proposals/${PROP_ID}`)
    expect(res.status).toBe(400)
  })

  it('200 cancels a draft (creator)', async () => {
    const { s, app } = await mount()
    s.push({ data: { id: PROP_ID, creator_id: ME, recipient_id: OTHER, status: 'draft', conversation_id: CONVO_ID, ai_review_id: null } })
    s.push({ data: null }) // update awaited
    s.push({ data: null }) // activity log insert
    const res = await request(app).delete(`/api/proposals/${PROP_ID}`)
    expect(res.status).toBe(200)
  })
})

// =====================================================================
// Items: add (draft only) + delete (own only, draft only)
// =====================================================================
describe('items', () => {
  const ITEM = {
    name: 'AK-47 | Redline', wear: 'FT', float_value: 0.18, rarity: 'Classified',
    image_url: 'https://example.com/img.png', steam_asset_id: '1234',
  }

  it('POST 400 on missing name', async () => {
    const { app } = await mount()
    const res = await request(app).post(`/api/proposals/${PROP_ID}/items`).send({})
    expect(res.status).toBe(400)
  })

  it('POST 400 on float out of range', async () => {
    const { app } = await mount()
    const res = await request(app).post(`/api/proposals/${PROP_ID}/items`).send({ ...ITEM, float_value: 1.5 })
    expect(res.status).toBe(400)
  })

  it('POST 404 when proposal not found', async () => {
    const { s, app } = await mount()
    s.push({ data: null })
    const res = await request(app).post(`/api/proposals/${PROP_ID}/items`).send(ITEM)
    expect(res.status).toBe(404)
  })

  it('POST 403 when not a participant', async () => {
    const { s, app } = await mount()
    s.push({ data: { id: PROP_ID, creator_id: 'X', recipient_id: 'Y', status: 'draft', conversation_id: CONVO_ID, ai_review_id: null } })
    const res = await request(app).post(`/api/proposals/${PROP_ID}/items`).send(ITEM)
    expect(res.status).toBe(403)
  })

  it('POST 400 when status is not draft (immutable post-draft)', async () => {
    const { s, app } = await mount()
    s.push({ data: { id: PROP_ID, creator_id: ME, recipient_id: OTHER, status: 'completed', conversation_id: CONVO_ID, ai_review_id: null } })
    const res = await request(app).post(`/api/proposals/${PROP_ID}/items`).send(ITEM)
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/locked/i)
  })

  it('POST 400 when one user has already marked completed (locked)', async () => {
    const { s, app } = await mount()
    s.push({ data: { id: PROP_ID, creator_id: ME, recipient_id: OTHER, status: 'draft', conversation_id: CONVO_ID, ai_review_id: null, creator_marked_completed: false, recipient_marked_completed: true } })
    const res = await request(app).post(`/api/proposals/${PROP_ID}/items`).send(ITEM)
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/locked/i)
  })

  it('POST 201 adds item in draft', async () => {
    const { s, app } = await mount()
    s.push({ data: { id: PROP_ID, creator_id: ME, recipient_id: OTHER, status: 'draft', conversation_id: CONVO_ID, ai_review_id: null } })
    s.push({ data: { id: 'i-new', name: ITEM.name, owner_id: ME, proposal_id: PROP_ID } })
    s.push({ data: null }) // activity log
    const res = await request(app).post(`/api/proposals/${PROP_ID}/items`).send(ITEM)
    expect(res.status).toBe(201)
    expect(res.body.id).toBe('i-new')
  })

  it('DELETE 403 when item is not owned by caller', async () => {
    const { s, app } = await mount()
    s.push({ data: { id: PROP_ID, creator_id: ME, recipient_id: OTHER, status: 'draft', conversation_id: CONVO_ID, ai_review_id: null } })
    s.push({ data: { owner_id: OTHER, name: 'X' } })
    const res = await request(app).delete(`/api/proposals/${PROP_ID}/items/i-1`)
    expect(res.status).toBe(403)
  })

  it('DELETE 200 when caller owns the item', async () => {
    const { s, app } = await mount()
    s.push({ data: { id: PROP_ID, creator_id: ME, recipient_id: OTHER, status: 'draft', conversation_id: CONVO_ID, ai_review_id: null } })
    s.push({ data: { owner_id: ME, name: 'AK' } })
    s.push({ data: null }) // delete
    s.push({ data: null }) // activity log
    const res = await request(app).delete(`/api/proposals/${PROP_ID}/items/i-1`)
    expect(res.status).toBe(200)
  })

  it('DELETE 404 when item missing', async () => {
    const { s, app } = await mount()
    s.push({ data: { id: PROP_ID, creator_id: ME, recipient_id: OTHER, status: 'draft', conversation_id: CONVO_ID, ai_review_id: null } })
    s.push({ data: null }) // item lookup miss
    const res = await request(app).delete(`/api/proposals/${PROP_ID}/items/missing`)
    expect(res.status).toBe(404)
  })

  it('DELETE 400 when status is not draft', async () => {
    const { s, app } = await mount()
    s.push({ data: { id: PROP_ID, creator_id: ME, recipient_id: OTHER, status: 'completed', conversation_id: CONVO_ID, ai_review_id: null } })
    const res = await request(app).delete(`/api/proposals/${PROP_ID}/items/i-1`)
    expect(res.status).toBe(400)
  })
})

// =====================================================================
// POST /api/proposals/:id/mark-completed (per-user flag, second flips status)
// =====================================================================
describe('POST /api/proposals/:id/mark-completed', () => {
  it('404 when proposal not found', async () => {
    const { s, app } = await mount()
    s.push({ data: null })
    const res = await request(app).post(`/api/proposals/${PROP_ID}/mark-completed`)
    expect(res.status).toBe(404)
  })

  it('403 when caller is not a participant', async () => {
    const { s, app } = await mount()
    s.push({ data: { id: PROP_ID, creator_id: 'X', recipient_id: 'Y', status: 'draft', conversation_id: CONVO_ID, ai_review_id: null, creator_marked_completed: false, recipient_marked_completed: false } })
    const res = await request(app).post(`/api/proposals/${PROP_ID}/mark-completed`)
    expect(res.status).toBe(403)
  })

  it('400 when status is not draft', async () => {
    const { s, app } = await mount()
    s.push({ data: { id: PROP_ID, creator_id: ME, recipient_id: OTHER, status: 'completed', conversation_id: CONVO_ID, ai_review_id: null, creator_marked_completed: true, recipient_marked_completed: true } })
    const res = await request(app).post(`/api/proposals/${PROP_ID}/mark-completed`)
    expect(res.status).toBe(400)
  })

  it('200 first mark sets caller flag, status stays draft', async () => {
    const { s, app } = await mount()
    s.push({ data: { id: PROP_ID, creator_id: ME, recipient_id: OTHER, status: 'draft', conversation_id: CONVO_ID, ai_review_id: null, creator_marked_completed: false, recipient_marked_completed: false } })
    s.push({ data: { id: PROP_ID, status: 'draft', creator_marked_completed: true, recipient_marked_completed: false } }) // update select single
    s.push({ data: null }) // log marked_completed
    const res = await request(app).post(`/api/proposals/${PROP_ID}/mark-completed`)
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('draft')
    expect(res.body.creator_marked_completed).toBe(true)
  })

  it('200 idempotent when caller already marked', async () => {
    const { s, app } = await mount()
    s.push({ data: { id: PROP_ID, creator_id: ME, recipient_id: OTHER, status: 'draft', conversation_id: CONVO_ID, ai_review_id: null, creator_marked_completed: true, recipient_marked_completed: false } })
    s.push({ data: { id: PROP_ID, status: 'draft', creator_marked_completed: true, recipient_marked_completed: false } })
    const res = await request(app).post(`/api/proposals/${PROP_ID}/mark-completed`)
    expect(res.status).toBe(200)
    // idempotent path does not write a new flag or log
    expect(s._calls.some((c) => c.table === 'trade_proposals' && c.op === 'update')).toBe(false)
  })

  it('200 second mark flips status to completed and logs trade_completed', async () => {
    const { s, app } = await mount()
    s.push({ data: { id: PROP_ID, creator_id: ME, recipient_id: OTHER, status: 'draft', conversation_id: CONVO_ID, ai_review_id: null, creator_marked_completed: false, recipient_marked_completed: true } })
    s.push({ data: { id: PROP_ID, status: 'completed', creator_marked_completed: true, recipient_marked_completed: true } })
    s.push({ data: null }) // log marked_completed
    s.push({ data: null }) // log trade_completed
    const res = await request(app).post(`/api/proposals/${PROP_ID}/mark-completed`)
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('completed')
  })
})

// =====================================================================
// POST /api/proposals/:id/mark-completed/reset
// =====================================================================
describe('POST /api/proposals/:id/mark-completed/reset', () => {
  it('400 when status is not draft', async () => {
    const { s, app } = await mount()
    s.push({ data: { id: PROP_ID, creator_id: ME, recipient_id: OTHER, status: 'completed', conversation_id: CONVO_ID, ai_review_id: null, creator_marked_completed: true, recipient_marked_completed: true } })
    const res = await request(app).post(`/api/proposals/${PROP_ID}/mark-completed/reset`)
    expect(res.status).toBe(400)
  })

  it('200 clears both flags from draft', async () => {
    const { s, app } = await mount()
    s.push({ data: { id: PROP_ID, creator_id: ME, recipient_id: OTHER, status: 'draft', conversation_id: CONVO_ID, ai_review_id: null, creator_marked_completed: true, recipient_marked_completed: false } })
    s.push({ data: { id: PROP_ID, status: 'draft', creator_marked_completed: false, recipient_marked_completed: false } })
    s.push({ data: null }) // log
    const res = await request(app).post(`/api/proposals/${PROP_ID}/mark-completed/reset`)
    expect(res.status).toBe(200)
    expect(res.body.creator_marked_completed).toBe(false)
    expect(res.body.recipient_marked_completed).toBe(false)
  })
})

// =====================================================================
// POST /api/proposals/:id/cancel
// =====================================================================
describe('cancel', () => {
  it('400 when status is completed', async () => {
    const { s, app } = await mount()
    s.push({ data: { id: PROP_ID, creator_id: ME, recipient_id: OTHER, status: 'completed', conversation_id: CONVO_ID, ai_review_id: null, creator_marked_completed: true, recipient_marked_completed: true } })
    const res = await request(app).post(`/api/proposals/${PROP_ID}/cancel`)
    expect(res.status).toBe(400)
  })

  it('200 from draft', async () => {
    const { s, app } = await mount()
    s.push({ data: { id: PROP_ID, creator_id: ME, recipient_id: OTHER, status: 'draft', conversation_id: CONVO_ID, ai_review_id: null, creator_marked_completed: false, recipient_marked_completed: false } })
    s.push({ data: { id: PROP_ID, status: 'cancelled' } })
    s.push({ data: null })
    const res = await request(app).post(`/api/proposals/${PROP_ID}/cancel`)
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('cancelled')
  })
})

// =====================================================================
// POST /api/proposals/:id/review (post-completion)
// =====================================================================
describe('POST /api/proposals/:id/review', () => {
  it('400 on rating < 1', async () => {
    const { app } = await mount()
    const res = await request(app).post(`/api/proposals/${PROP_ID}/review`).send({ rating: 0 })
    expect(res.status).toBe(400)
  })

  it('400 on rating > 5', async () => {
    const { app } = await mount()
    const res = await request(app).post(`/api/proposals/${PROP_ID}/review`).send({ rating: 6 })
    expect(res.status).toBe(400)
  })

  it('400 when status is not completed', async () => {
    const { s, app } = await mount()
    s.push({ data: { id: PROP_ID, creator_id: ME, recipient_id: OTHER, status: 'draft', conversation_id: CONVO_ID, ai_review_id: null } })
    const res = await request(app).post(`/api/proposals/${PROP_ID}/review`).send({ rating: 5 })
    expect(res.status).toBe(400)
  })

  it('409 on duplicate review (unique violation)', async () => {
    const { s, app } = await mount()
    s.push({ data: { id: PROP_ID, creator_id: ME, recipient_id: OTHER, status: 'completed', conversation_id: CONVO_ID, ai_review_id: null } })
    s.push({ data: null, error: { code: '23505', message: 'unique violation' } })
    const res = await request(app).post(`/api/proposals/${PROP_ID}/review`).send({ rating: 5 })
    expect(res.status).toBe(409)
  })

  it('201 inserts review on completed proposal', async () => {
    const { s, app } = await mount()
    s.push({ data: { id: PROP_ID, creator_id: ME, recipient_id: OTHER, status: 'completed', conversation_id: CONVO_ID, ai_review_id: null } })
    s.push({ data: { id: 'rev-1', rating: 5 } })
    s.push({ data: null }) // log
    const res = await request(app).post(`/api/proposals/${PROP_ID}/review`).send({ rating: 5, comment: 'great' })
    expect(res.status).toBe(201)
  })
})

// =====================================================================
// POST /api/proposals/:id/ai-review (with mocked OpenAI)
// =====================================================================
describe('POST /api/proposals/:id/ai-review', () => {
  it('429 when user already has 3 reviews on this proposal in 24h', async () => {
    const { s, app } = await mount()
    s.push({ data: { id: PROP_ID, creator_id: ME, recipient_id: OTHER, status: 'draft', conversation_id: CONVO_ID, ai_review_id: null } })
    s.push({ data: null, count: 3 }) // ai_safety_reviews count
    const res = await request(app).post(`/api/proposals/${PROP_ID}/ai-review`)
    expect(res.status).toBe(429)
  })

  it('400 when status is completed', async () => {
    const { s, app } = await mount()
    s.push({ data: { id: PROP_ID, creator_id: ME, recipient_id: OTHER, status: 'completed', conversation_id: CONVO_ID, ai_review_id: null } })
    const res = await request(app).post(`/api/proposals/${PROP_ID}/ai-review`)
    expect(res.status).toBe(400)
  })

  it('502 when the OpenAI client returns null', async () => {
    const { s, app } = await mount(() => {
      vi.doMock('../src/lib/openai', () => ({
        runAiSafetyReview: vi.fn().mockResolvedValue(null),
        buildAiReviewInput: vi.fn().mockReturnValue('{}'),
        AI_SAFETY_REVIEW_MODEL: 'test-model',
      }))
    })
    s.push({ data: { id: PROP_ID, creator_id: ME, recipient_id: OTHER, status: 'draft', conversation_id: CONVO_ID, ai_review_id: null } })
    s.push({ data: null, count: 0 }) // recent reviews
    s.push({ data: { display_name: 'Me', total_trades: 0, average_rating: null } }) // creator trader_profile
    s.push({ data: { display_name: 'Other', total_trades: 5, average_rating: 4.5 } }) // recipient trader_profile
    s.push({ data: { created_at: new Date().toISOString() } })  // creator profile
    s.push({ data: { created_at: new Date().toISOString() } })  // recipient profile
    s.push({ data: [] })            // items
    s.push({ data: [] })            // messages
    s.push({ data: null, count: 0 }) // reports
    const res = await request(app).post(`/api/proposals/${PROP_ID}/ai-review`)
    expect(res.status).toBe(502)
  })

  it('201 stores the review and updates trade_proposals.ai_review_id on success', async () => {
    const { s, app } = await mount() // default mock returns risk_level: 'low'
    s.push({ data: { id: PROP_ID, creator_id: ME, recipient_id: OTHER, status: 'draft', conversation_id: CONVO_ID, ai_review_id: null } })
    s.push({ data: null, count: 0 })
    s.push({ data: { display_name: 'Me' } })
    s.push({ data: { display_name: 'Other' } })
    s.push({ data: { created_at: new Date().toISOString() } })
    s.push({ data: { created_at: new Date().toISOString() } })
    s.push({ data: [] })
    s.push({ data: [] })
    s.push({ data: null, count: 0 })
    s.push({ data: { id: 'air-1', risk_level: 'low' } }) // store review
    s.push({ data: null }) // update trade_proposals
    s.push({ data: null }) // log
    const res = await request(app).post(`/api/proposals/${PROP_ID}/ai-review`)
    expect(res.status).toBe(201)
    expect(res.body.risk_level).toBe('low')
  })
})

// =====================================================================
// GET /api/proposals/:id/activity (participant or admin)
// =====================================================================
describe('GET /api/proposals/:id/activity', () => {
  it('200 for a participant', async () => {
    const { s, app } = await mount()
    s.push({ data: { id: PROP_ID, creator_id: ME, recipient_id: OTHER, status: 'draft', conversation_id: CONVO_ID, ai_review_id: null } })
    s.push({ data: [{ id: 1, action: 'proposal_created' }] })
    const res = await request(app).get(`/api/proposals/${PROP_ID}/activity`)
    expect(res.status).toBe(200)
    expect(res.body[0].action).toBe('proposal_created')
  })

  it('403 for non-participant non-admin', async () => {
    const { s, app } = await mount()
    s.push({ data: { id: PROP_ID, creator_id: 'X', recipient_id: 'Y', status: 'draft', conversation_id: CONVO_ID, ai_review_id: null } })
    s.push({ data: { is_admin: false } })
    const res = await request(app).get(`/api/proposals/${PROP_ID}/activity`)
    expect(res.status).toBe(403)
  })

  it('200 for non-participant admin', async () => {
    const { s, app } = await mount()
    s.push({ data: { id: PROP_ID, creator_id: 'X', recipient_id: 'Y', status: 'draft', conversation_id: CONVO_ID, ai_review_id: null } })
    s.push({ data: { is_admin: true } })
    s.push({ data: [] })
    const res = await request(app).get(`/api/proposals/${PROP_ID}/activity`)
    expect(res.status).toBe(200)
  })
})

// =====================================================================
// Auth required
// =====================================================================
describe('proposals — auth required', () => {
  it('401 without authenticate (POST /api/proposals)', async () => {
    vi.resetModules()
    vi.doMock('../src/lib/supabase', () => ({ supabase: { from: () => ({}) } }))
    vi.doMock('../src/middleware/authenticate', () => ({
      authenticate: (_req: any, res: any) => { res.status(401).json({ error: 'Unauthorized' }) },
    }))
    vi.doMock('../src/services/proposalCodeService', () => ({
      generateProposalVerificationCode: vi.fn(),
    }))
    vi.doMock('../src/lib/openai', () => ({
      runAiSafetyReview: vi.fn(), buildAiReviewInput: vi.fn(), AI_SAFETY_REVIEW_MODEL: 'x',
    }))
    const { default: router } = await import('../src/routes/proposals')
    const app = express().use(express.json()).use('/api/proposals', router)
    const res = await request(app).post('/api/proposals').send({ conversation_id: CONVO_ID })
    expect(res.status).toBe(401)
  })
})

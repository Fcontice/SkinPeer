import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createSupabaseStub } from './helpers/mockSupabase'

const ITEM = {
  asset_id: '1', class_id: '2', name: 'AK-47 | Redline',
  icon_url: 'https://x.example.com/img.png', wear: 'FT', rarity: 'Classified', type: 'Rifle',
  tradable: true, marketable: true,
}

describe('POST /api/offers', () => {
  let s: ReturnType<typeof createSupabaseStub>
  let app: express.Express

  beforeEach(async () => {
    s = createSupabaseStub()
    vi.resetModules()
    vi.doMock('../src/lib/supabase', () => ({ supabase: s.client }))
    vi.doMock('../src/middleware/authenticate', () => ({
      authenticate: (req: any, _res: any, next: any) => { req.user = { id: 'A' }; next() },
    }))
    const { default: router } = await import('../src/routes/offers')
    app = express().use(express.json()).use('/api/offers', router)
  })

  it('400 when no items provided', async () => {
    const res = await request(app).post('/api/offers').send({ conversation_id: '00000000-0000-0000-0000-000000000001', requested_items: [], offered_items: [] })
    expect(res.status).toBe(400)
  })

  it('403 when caller not in conversation', async () => {
    s.push({ data: { id: '00000000-0000-0000-0000-000000000001', user_a_id: 'X', user_b_id: 'Y' } })
    const res = await request(app).post('/api/offers').send({ conversation_id: '00000000-0000-0000-0000-000000000001', requested_items: [ITEM], offered_items: [] })
    expect(res.status).toBe(403)
  })

  it('404 when conversation not found', async () => {
    s.push({ data: null })
    const res = await request(app).post('/api/offers').send({ conversation_id: '00000000-0000-0000-0000-000000000001', requested_items: [ITEM], offered_items: [] })
    expect(res.status).toBe(404)
  })

  it('409 when a pending offer already exists in this direction', async () => {
    s.push({ data: { id: '00000000-0000-0000-0000-000000000001', user_a_id: 'A', user_b_id: 'B' } })
    s.push({ data: null, error: { code: '23505', message: 'unique violation' } })
    const res = await request(app).post('/api/offers').send({ conversation_id: '00000000-0000-0000-0000-000000000001', requested_items: [ITEM], offered_items: [] })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/pending/i)
  })

  it('201 creates offer + posts inline message', async () => {
    s.push({ data: { id: '00000000-0000-0000-0000-000000000001', user_a_id: 'A', user_b_id: 'B' } })
    s.push({ data: { id: 'o-1', conversation_id: '00000000-0000-0000-0000-000000000001', from_user_id: 'A', to_user_id: 'B', status: 'pending' } })
    s.push({ data: { id: 'm-1' } })
    const res = await request(app).post('/api/offers').send({ conversation_id: '00000000-0000-0000-0000-000000000001', requested_items: [ITEM], offered_items: [] })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe('o-1')
    // Confirm the inline message insert was attempted
    expect(s._calls.some((c) => c.op === 'insert')).toBe(true)
  })
})

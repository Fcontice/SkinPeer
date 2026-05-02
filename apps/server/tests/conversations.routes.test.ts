import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createSupabaseStub } from './helpers/mockSupabase'

const ME    = '00000000-0000-0000-0000-000000000001'
const OTHER = '00000000-0000-0000-0000-000000000002'
const CONVO = '00000000-0000-0000-0000-0000000000aa'

describe('routes/conversations', () => {
  let s: ReturnType<typeof createSupabaseStub>
  let app: express.Express

  beforeEach(async () => {
    s = createSupabaseStub()
    vi.resetModules()
    vi.doMock('../src/lib/supabase', () => ({ supabase: s.client }))
    vi.doMock('../src/middleware/authenticate', () => ({
      authenticate: (req: any, _res: any, next: any) => { req.user = { id: ME }; next() },
    }))
    const { default: router } = await import('../src/routes/conversations')
    app = express().use(express.json()).use('/api/conversations', router)
  })
  afterEach(() => { vi.restoreAllMocks() })

  describe('POST /api/conversations', () => {
    it('400 on self-conversation attempt', async () => {
      const res = await request(app).post('/api/conversations').send({ other_user_id: ME })
      expect(res.status).toBe(400)
    })

    it('400 on missing other_user_id', async () => {
      const res = await request(app).post('/api/conversations').send({})
      expect(res.status).toBe(400)
    })

    it('400 on non-uuid other_user_id', async () => {
      const res = await request(app).post('/api/conversations').send({ other_user_id: 'not-a-uuid' })
      expect(res.status).toBe(400)
    })

    it('returns existing conversation when one exists', async () => {
      s.push({ data: { id: CONVO, user_a_id: ME, user_b_id: OTHER } })
      const res = await request(app).post('/api/conversations').send({ other_user_id: OTHER })
      expect(res.status).toBe(200)
      expect(res.body.id).toBe(CONVO)
    })

    it('201 creates new conversation when none exists', async () => {
      s.push({ data: null }) // existing lookup miss
      s.push({ data: { id: CONVO, user_a_id: ME, user_b_id: OTHER } })
      const res = await request(app).post('/api/conversations').send({ other_user_id: OTHER })
      expect(res.status).toBe(201)
    })
  })

  describe('GET /api/conversations/:id (participant gating)', () => {
    it('403 when caller is not a participant', async () => {
      s.push({ data: { user_a_id: 'X', user_b_id: 'Y' } })
      const res = await request(app).get(`/api/conversations/${CONVO}`)
      expect(res.status).toBe(403)
    })

    it('200 when caller is a participant', async () => {
      s.push({ data: { user_a_id: ME, user_b_id: OTHER } }) // assertParticipant
      s.push({ data: { id: CONVO, user_a_id: ME, user_b_id: OTHER } }) // header
      s.push({ data: [] }) // messages
      const res = await request(app).get(`/api/conversations/${CONVO}`)
      expect(res.status).toBe(200)
      expect(res.body.conversation.id).toBe(CONVO)
    })
  })

  describe('POST /api/conversations/:id/messages', () => {
    it('400 on empty body', async () => {
      const res = await request(app).post(`/api/conversations/${CONVO}/messages`).send({ body: '' })
      expect(res.status).toBe(400)
    })

    it('400 on body > 2000 chars', async () => {
      const res = await request(app).post(`/api/conversations/${CONVO}/messages`).send({ body: 'x'.repeat(2001) })
      expect(res.status).toBe(400)
    })

    it('403 when caller is not a participant', async () => {
      s.push({ data: { user_a_id: 'X', user_b_id: 'Y' } })
      const res = await request(app).post(`/api/conversations/${CONVO}/messages`).send({ body: 'hello' })
      expect(res.status).toBe(403)
    })

    it('201 sends message on happy path', async () => {
      s.push({ data: { user_a_id: ME, user_b_id: OTHER } })
      s.push({ data: { id: 'm-1', body: 'hello', kind: 'user' } })
      const res = await request(app).post(`/api/conversations/${CONVO}/messages`).send({ body: 'hello' })
      expect(res.status).toBe(201)
      expect(res.body.kind).toBe('user')
    })
  })

  describe('POST /api/conversations/:id/read', () => {
    it('403 when not a participant', async () => {
      s.push({ data: { user_a_id: 'X', user_b_id: 'Y' } })
      const res = await request(app).post(`/api/conversations/${CONVO}/read`)
      expect(res.status).toBe(403)
    })

    it('200 marks messages read for participant', async () => {
      s.push({ data: { user_a_id: ME, user_b_id: OTHER } })
      s.push({ data: null }) // update returns no rows but no error
      const res = await request(app).post(`/api/conversations/${CONVO}/read`)
      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
    })
  })

  describe('GET /api/conversations/:id/messages (pagination)', () => {
    it('400 on invalid limit', async () => {
      s.push({ data: { user_a_id: ME, user_b_id: OTHER } })
      const res = await request(app).get(`/api/conversations/${CONVO}/messages?limit=999`)
      expect(res.status).toBe(400)
    })

    it('200 returns reversed history', async () => {
      s.push({ data: { user_a_id: ME, user_b_id: OTHER } })
      s.push({ data: [{ id: 'm-2', created_at: 'b' }, { id: 'm-1', created_at: 'a' }] })
      const res = await request(app).get(`/api/conversations/${CONVO}/messages?limit=10`)
      expect(res.status).toBe(200)
      // The route reverses internally so oldest is first.
      expect(res.body[0].id).toBe('m-1')
    })
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createSupabaseStub } from './helpers/mockSupabase'

const ME      = '00000000-0000-0000-0000-000000000001'
const SUBJECT = '00000000-0000-0000-0000-000000000002'
const PROP    = '00000000-0000-0000-0000-0000000000aa'
const CONVO   = '00000000-0000-0000-0000-0000000000bb'

describe('POST /api/reports', () => {
  let s: ReturnType<typeof createSupabaseStub>
  let app: express.Express

  beforeEach(async () => {
    s = createSupabaseStub()
    vi.resetModules()
    vi.doMock('../src/lib/supabase', () => ({ supabase: s.client }))
    vi.doMock('../src/middleware/authenticate', () => ({
      authenticate: (req: any, _res: any, next: any) => { req.user = { id: ME }; next() },
    }))
    const { default: router } = await import('../src/routes/userReports')
    app = express().use(express.json()).use('/api/reports', router)
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('400 on missing subject_user_id', async () => {
    const res = await request(app).post('/api/reports').send({ reason: 'A reason that is long enough' })
    expect(res.status).toBe(400)
  })

  it('400 on too-short reason', async () => {
    const res = await request(app).post('/api/reports').send({ subject_user_id: SUBJECT, reason: 'short' })
    expect(res.status).toBe(400)
  })

  it('400 on self-report', async () => {
    const res = await request(app).post('/api/reports').send({
      subject_user_id: ME,
      reason: 'I should not be allowed to report myself like this.',
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/yourself/i)
  })

  it('404 when proposal_id is supplied but proposal not found', async () => {
    s.push({ data: null }) // proposal lookup
    const res = await request(app).post('/api/reports').send({
      subject_user_id: SUBJECT, proposal_id: PROP, reason: 'A long enough reason for the report.',
    })
    expect(res.status).toBe(404)
  })

  it('403 when caller is not a participant of the proposal', async () => {
    s.push({ data: { creator_id: 'X', recipient_id: 'Y' } })
    const res = await request(app).post('/api/reports').send({
      subject_user_id: SUBJECT, proposal_id: PROP, reason: 'Long enough reason for the report here.',
    })
    expect(res.status).toBe(403)
  })

  it('404 when conversation_id is supplied but conversation not found', async () => {
    s.push({ data: null })
    const res = await request(app).post('/api/reports').send({
      subject_user_id: SUBJECT, conversation_id: CONVO, reason: 'A long enough reason for this report.',
    })
    expect(res.status).toBe(404)
  })

  it('403 when caller is not a participant of the conversation', async () => {
    s.push({ data: { user_a_id: 'X', user_b_id: 'Y' } })
    const res = await request(app).post('/api/reports').send({
      subject_user_id: SUBJECT, conversation_id: CONVO, reason: 'Another long enough report reason here.',
    })
    expect(res.status).toBe(403)
  })

  it('201 inserts the report on the happy path (no proposal/convo)', async () => {
    s.push({ data: { id: 'r-1', reporter_id: ME, subject_user_id: SUBJECT, status: 'open' } })
    const res = await request(app).post('/api/reports').send({
      subject_user_id: SUBJECT, reason: 'A long enough reason for this report.',
    })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe('r-1')
  })

  it('201 when caller is a participant of the referenced proposal', async () => {
    s.push({ data: { creator_id: ME, recipient_id: SUBJECT } })  // proposal lookup
    s.push({ data: { id: 'r-2' } })                               // insert
    const res = await request(app).post('/api/reports').send({
      subject_user_id: SUBJECT, proposal_id: PROP, reason: 'A long enough reason for this report.',
    })
    expect(res.status).toBe(201)
  })
})

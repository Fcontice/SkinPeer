import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { errorHandler } from '../src/middleware/errorHandler'
import { notFound } from '../src/middleware/notFound'

describe('errorHandler + notFound', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it('errorHandler returns a 500 with stable shape and does not leak err.message', async () => {
    const app = express()
      .get('/boom', (_req, _res, next) => next(new Error('secret detail')))
      .use(errorHandler)
    const res = await request(app).get('/boom')
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error' })
    expect(res.body.message).toBeUndefined()
    expect(res.body.stack).toBeUndefined()
  })

  it('errorHandler logs the error', async () => {
    const app = express()
      .get('/boom', (_req, _res, next) => next(new Error('logged-message')))
      .use(errorHandler)
    await request(app).get('/boom')
    const logged = consoleSpy.mock.calls.flat().join(' ')
    expect(logged).toContain('logged-message')
  })

  it('notFound returns a 404 with stable shape', async () => {
    const app = express().use(notFound)
    const res = await request(app).get('/nope')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Not found' })
  })
})

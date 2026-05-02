import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// express-rate-limit doesn't expose runtime options on the returned middleware,
// so we pin the documented values by reading the source. If a future edit
// changes the literals, this fails with a clear "config drift" message.

describe('rateLimiter config (source-pinned)', () => {
  const source = readFileSync(
    resolve(__dirname, '../src/middleware/rateLimiter.ts'),
    'utf8'
  )

  it('defaultLimiter is configured for 300 req/min per IP (CLAUDE.md D4)', () => {
    expect(source).toMatch(/defaultLimiter[\s\S]*?windowMs:\s*60\s*\*\s*1000/)
    expect(source).toMatch(/defaultLimiter[\s\S]*?max:\s*300/)
  })

  it('authLimiter is stricter (10 req / 15 min)', () => {
    expect(source).toMatch(/authLimiter[\s\S]*?windowMs:\s*15\s*\*\s*60\s*\*\s*1000/)
    expect(source).toMatch(/authLimiter[\s\S]*?max:\s*10/)
  })

  it('returns 429 when called past the limit', async () => {
    const express = (await import('express')).default
    const request = (await import('supertest')).default
    const limiter = (await import('express-rate-limit')).default({
      windowMs: 60 * 1000,
      max: 2,
      standardHeaders: true,
      legacyHeaders: false,
    })
    const app = express().use(limiter).get('/x', (_req, res) => res.json({ ok: true }))
    expect((await request(app).get('/x')).status).toBe(200)
    expect((await request(app).get('/x')).status).toBe(200)
    expect((await request(app).get('/x')).status).toBe(429)
  })
})

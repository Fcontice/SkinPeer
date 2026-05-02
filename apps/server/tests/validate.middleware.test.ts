import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { validate } from '../src/middleware/validate'

const TestSchema = z.object({
  name: z.string().min(1),
  age: z.number().int().min(0),
})

function makeApp() {
  return express()
    .use(express.json())
    .post('/x', validate(TestSchema), (req, res) => res.json({ body: req.body }))
}

describe('validate middleware', () => {
  it('passes valid input through and parses it onto req.body', async () => {
    const res = await request(makeApp()).post('/x').send({ name: 'a', age: 1 })
    expect(res.status).toBe(200)
    expect(res.body.body).toEqual({ name: 'a', age: 1 })
  })

  it('returns 400 with issues array on bad input', async () => {
    const res = await request(makeApp()).post('/x').send({ name: '', age: -1 })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Validation failed')
    expect(Array.isArray(res.body.issues)).toBe(true)
    expect(res.body.issues.length).toBeGreaterThan(0)
  })

  it('returns 400 on missing required fields', async () => {
    const res = await request(makeApp()).post('/x').send({})
    expect(res.status).toBe(400)
  })

  it('strips unknown fields by default (Zod object .parse behavior)', async () => {
    const res = await request(makeApp()).post('/x').send({ name: 'a', age: 1, extra: 'x' })
    expect(res.status).toBe(200)
    expect(res.body.body).not.toHaveProperty('extra')
  })
})

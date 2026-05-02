import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSupabaseStub } from './helpers/mockSupabase'

describe('generateProposalVerificationCode', () => {
  let s: ReturnType<typeof createSupabaseStub>

  beforeEach(() => {
    s = createSupabaseStub()
    vi.resetModules()
    vi.doMock('../src/lib/supabase', () => ({ supabase: s.client }))
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a 6-character code from the safe alphabet on first try', async () => {
    s.push({ data: null }) // no collision
    const { generateProposalVerificationCode } = await import('../src/services/proposalCodeService')
    const code = await generateProposalVerificationCode()
    expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/)
  })

  it('excludes 0/O/I/1 from the alphabet', async () => {
    // Generate 200 codes; assert none contain ambiguous characters.
    for (let i = 0; i < 200; i++) s.push({ data: null })
    const { generateProposalVerificationCode } = await import('../src/services/proposalCodeService')
    for (let i = 0; i < 200; i++) {
      const code = await generateProposalVerificationCode()
      expect(code).not.toMatch(/[0OI1]/)
    }
  })

  it('retries on collision and eventually returns a unique code', async () => {
    // 3 collisions, then success.
    s.push({ data: { id: 'collide-1' } })
    s.push({ data: { id: 'collide-2' } })
    s.push({ data: { id: 'collide-3' } })
    s.push({ data: null })
    const { generateProposalVerificationCode } = await import('../src/services/proposalCodeService')
    const code = await generateProposalVerificationCode()
    expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/)
    // We made exactly four select calls.
    const selects = s._calls.filter((c) => c.op === 'select')
    expect(selects.length).toBe(4)
  })

  it('throws after MAX_ATTEMPTS (5) consecutive collisions', async () => {
    for (let i = 0; i < 5; i++) s.push({ data: { id: `collide-${i}` } })
    const { generateProposalVerificationCode } = await import('../src/services/proposalCodeService')
    await expect(generateProposalVerificationCode()).rejects.toThrow(/5 attempts/)
  })

  it('queries trade_proposals.verification_code on each attempt', async () => {
    s.push({ data: null })
    const { generateProposalVerificationCode } = await import('../src/services/proposalCodeService')
    await generateProposalVerificationCode()
    expect(s._calls[0].table).toBe('trade_proposals')
  })
})

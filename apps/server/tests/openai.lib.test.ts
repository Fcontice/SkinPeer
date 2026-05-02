import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// runAiSafetyReview is intentionally fault-tolerant: API errors, malformed
// JSON, and schema-invalid responses all return null. The route layer maps
// null → 502 review_unavailable. These tests pin that contract.

describe('runAiSafetyReview', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.restoreAllMocks() })

  async function loadWithCompletionsCreate(impl: (...args: unknown[]) => unknown) {
    vi.doMock('openai', () => {
      class FakeOpenAI {
        chat = { completions: { create: impl } }
        constructor(_opts: unknown) {}
      }
      return { default: FakeOpenAI }
    })
    return await import('../src/lib/openai')
  }

  it('returns the parsed object for a well-formed response', async () => {
    const { runAiSafetyReview } = await loadWithCompletionsCreate(async () => ({
      choices: [{ message: { content: JSON.stringify({
        risk_level: 'medium',
        warnings: ['lookalike account suspected'],
        recommended_actions: ['verify Steam ID before accepting'],
      }) } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }))
    const out = await runAiSafetyReview('input')
    expect(out?.risk_level).toBe('medium')
    expect(out?.warnings).toContain('lookalike account suspected')
  })

  it('returns null when the SDK throws', async () => {
    const { runAiSafetyReview } = await loadWithCompletionsCreate(async () => {
      throw new Error('rate-limited')
    })
    const out = await runAiSafetyReview('input')
    expect(out).toBeNull()
  })

  it('returns null when content is missing', async () => {
    const { runAiSafetyReview } = await loadWithCompletionsCreate(async () => ({
      choices: [{ message: { content: null } }],
    }))
    const out = await runAiSafetyReview('input')
    expect(out).toBeNull()
  })

  it('returns null when JSON parses but fails schema (bad risk_level)', async () => {
    const { runAiSafetyReview } = await loadWithCompletionsCreate(async () => ({
      choices: [{ message: { content: JSON.stringify({
        risk_level: 'super-high', warnings: [], recommended_actions: ['x'],
      }) } }],
    }))
    expect(await runAiSafetyReview('input')).toBeNull()
  })

  it('returns null when JSON parses but recommended_actions is empty', async () => {
    const { runAiSafetyReview } = await loadWithCompletionsCreate(async () => ({
      choices: [{ message: { content: JSON.stringify({
        risk_level: 'low', warnings: [], recommended_actions: [],
      }) } }],
    }))
    expect(await runAiSafetyReview('input')).toBeNull()
  })

  it('returns null when content is not valid JSON', async () => {
    const { runAiSafetyReview } = await loadWithCompletionsCreate(async () => ({
      choices: [{ message: { content: 'not json' } }],
    }))
    expect(await runAiSafetyReview('input')).toBeNull()
  })
})

describe('buildAiReviewInput', () => {
  it('serializes the input fields to JSON', async () => {
    const { buildAiReviewInput } = await import('../src/lib/openai')
    const out = buildAiReviewInput({
      creator: { display_name: 'A', total_trades: 0, average_rating: null, account_age_days: 1 },
      recipient: { display_name: 'B', total_trades: 5, average_rating: 4.5, account_age_days: 365 },
      creator_items: [],
      recipient_items: [],
      recent_messages: [],
      either_reported_within_90d: false,
    })
    const parsed = JSON.parse(out)
    expect(parsed.creator.display_name).toBe('A')
    expect(parsed.recipient.average_rating).toBe(4.5)
    expect(parsed.either_reported_within_90d).toBe(false)
  })
})

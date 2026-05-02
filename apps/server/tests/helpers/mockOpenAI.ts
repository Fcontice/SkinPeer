import { vi } from 'vitest'
import type { AiReviewResponse } from '../../src/schemas/traderNetwork'

/**
 * Replaces the OpenAI-backed `runAiSafetyReview` so AI route tests don't
 * touch the real API. Pair with `mountRouter` via `extraMocks`.
 *
 * Example:
 *   await mountRouter({
 *     routerPath: '../src/routes/proposals',
 *     mountAt: '/api/proposals',
 *     initialUser: { id: USER_A },
 *     extraMocks: () => mockAiSafetyReview({ risk_level: 'medium', warnings: ['x'], recommended_actions: ['verify in steam'] }),
 *   })
 */
export function mockAiSafetyReview(result: AiReviewResponse | null) {
  vi.doMock('../src/lib/openai', () => ({
    runAiSafetyReview: vi.fn().mockResolvedValue(result),
    buildAiReviewInput: (args: unknown) => JSON.stringify(args),
    AI_SAFETY_REVIEW_MODEL: 'test-model',
  }))
}

export function mockAiSafetyReviewError() {
  vi.doMock('../src/lib/openai', () => ({
    runAiSafetyReview: vi.fn().mockRejectedValue(new Error('OpenAI down')),
    buildAiReviewInput: (args: unknown) => JSON.stringify(args),
    AI_SAFETY_REVIEW_MODEL: 'test-model',
  }))
}

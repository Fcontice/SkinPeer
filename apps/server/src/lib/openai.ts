import OpenAI from 'openai'
import {
  AiReviewResponseSchema,
  AiReviewResponse,
  OfferReviewResponseSchema,
  OfferReviewResponse,
} from '../schemas/traderNetwork'

if (!process.env.OPENAI_API_KEY) {
  throw new Error('Missing OpenAI env var: OPENAI_API_KEY is required for AI safety review')
}

export const AI_SAFETY_REVIEW_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini'

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 30_000,
})

export const AI_SAFETY_SYSTEM_PROMPT = [
  'You are a CS2 trade safety reviewer. Analyze the trade proposal and conversation',
  'for signs of scam patterns common in CS2 trading: rushed pressure, off-Steam',
  'payment requests, lookalike accounts, mismatched item value, fake middleman',
  'claims, account takeover indicators, or social engineering. You do not have',
  'access to real-time Steam Market prices and you must not estimate item values.',
  'Output JSON only, with this exact shape:',
  '{',
  '  "risk_level": "low" | "medium" | "high" | "critical",',
  '  "warnings": string[],',
  '  "recommended_actions": string[]',
  '}',
  'Never claim a trade is safe. Use language like "no obvious red flags detected."',
  'Always include at least one recommended action reminding the user to verify',
  'items inside Steam before accepting.',
].join('\n')

// Returns null on API error, timeout, missing content, or validation failure.
// The calling route maps null → 502 review_unavailable.
export async function runAiSafetyReview(input: string): Promise<AiReviewResponse | null> {
  try {
    const completion = await openai.chat.completions.create({
      model: AI_SAFETY_REVIEW_MODEL,
      max_tokens: 1024,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: AI_SAFETY_SYSTEM_PROMPT },
        { role: 'user', content: input },
      ],
    })

    if (completion.usage) {
      console.log(
        `[ai-safety-review] model=${AI_SAFETY_REVIEW_MODEL} prompt_tokens=${completion.usage.prompt_tokens} completion_tokens=${completion.usage.completion_tokens}`
      )
    }

    const text = completion.choices[0]?.message?.content
    if (!text) return null

    const parsed = JSON.parse(text)
    const result = AiReviewResponseSchema.safeParse(parsed)
    return result.success ? result.data : null
  } catch (err) {
    console.error('[ai-safety-review] failed:', err instanceof Error ? err.message : err)
    return null
  }
}

// Builds the prompt body the model sees. Server-built; never trust user-supplied input.
export function buildAiReviewInput(args: {
  creator: { display_name: string; total_trades: number; average_rating: number | null; account_age_days: number }
  recipient: { display_name: string; total_trades: number; average_rating: number | null; account_age_days: number }
  creator_items: Array<{ name: string; wear: string | null; rarity: string | null; image_url: string | null }>
  recipient_items: Array<{ name: string; wear: string | null; rarity: string | null; image_url: string | null }>
  recent_messages: Array<{ sender: 'creator' | 'recipient'; body: string; created_at: string }>
  either_reported_within_90d: boolean
}): string {
  return JSON.stringify(args, null, 2)
}

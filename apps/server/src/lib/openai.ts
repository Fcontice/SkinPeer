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

// =====================================================================
// Offer-level review (PR 3) — CS2 domain-aware, viewer-perspective output.
// =====================================================================

export const OFFER_REVIEW_SYSTEM_PROMPT = [
  'You are an expert CS2 trade reviewer with deep knowledge of skin trading.',
  'Evaluate the offer from the viewer\'s perspective. Output JSON only with this exact shape:',
  '{',
  '  "fairness": "fair" | "slightly_unfavorable" | "unfavorable" | "heavily_unfavorable",',
  '  "value_delta_usd": number, // viewer-positive = good for the viewer (Steam Market basis)',
  '  "notable_observations": string[], // pattern/float/sticker callouts worth investigating',
  '  "risk_flags": string[], // scam patterns or red flags',
  '  "summary": string // one-paragraph plain-English review',
  '}',
  '',
  'Reason about the following CS2-specific factors:',
  '',
  '• Wear & float: Factory New (0.00–0.07), Minimal Wear (0.07–0.15), Field-Tested (0.15–0.38),',
  '  Well-Worn (0.38–0.45), Battle-Scarred (0.45–1.00). Some skins are float-capped (e.g. AWP Asiimov',
  '  cannot go below FT). Low-float and high-float edge cases command 10–50%+ intra-wear premiums.',
  '',
  '• Pattern indices: Case Hardened blue gems (Tier 1/2/3 placements on AK-47, Karambit, etc.);',
  '  Fade percentages (90/95/100 — only Karambit/Bayonet/Talon Fade goes to 100%); Marble Fade tiers',
  '  (FFI, Fire & Ice, Max Fire & Ice); Crimson Web spider placement and density (full webs vs scraps);',
  '  Doppler phases (Phase 1, 2, 3, 4, Ruby, Sapphire, Black Pearl) and Gamma Doppler phases (1–4,',
  '  Emerald). Flag undisclosed pattern potential — if the item name suggests a pattern-sensitive skin,',
  '  call it out as a "verify the pattern" observation.',
  '',
  '• Stickers: ~20% sticker-value rule of thumb (worth ≈20% of capsule price applied if scraped).',
  '  Holo / Gold / Foil tiers carry premiums. Major tournament stickers — Katowice 2014 (top tier),',
  '  Katowice 2015, Krakow 2017, Boston 2018, Berlin 2019, etc. — can be worth far more than the gun.',
  '  Call out scraped vs mint, sticker combos / crafts, and high-tier majors.',
  '',
  '• Rarity tiers: Consumer (white) → Industrial (light blue) → Mil-Spec (dark blue) → Restricted',
  '  (purple) → Classified (pink) → Covert (red) → Knife/Glove (gold). StatTrak adds ~10–25% premium',
  '  on most skins (less on high-end items). Souvenir items follow separate scarcity dynamics.',
  '',
  '• Market dynamics: Steam Community Market vs third-party (Buff163, CSFloat, Skinport) prices —',
  '  third-party can be 10–30% cheaper than Steam for popular items. Steam takes ~15% fees on sale.',
  '  Cash-out friction on Steam (balance only). Use Steam Market basis for value_delta_usd, but feel',
  '  free to flag in summary if the offer is dramatically off third-party pricing.',
  '',
  '• Scam patterns to flag in risk_flags when present:',
  '  - Fake inspect links (URL doesn\'t match steam://rungame/730/...).',
  '  - Item swap right before trade window opens.',
  '  - "Overpay if I go first" / pressure to send first.',
  '  - Fake middleman claims (no official middleman exists on SkinPeer or Steam).',
  '  - Account impersonation / lookalike profiles.',
  '  - Names that don\'t match the inspect link contents.',
  '  - Heavy time pressure or guilt-tripping in chat.',
  '  - Off-Steam payment requests (cash, gift cards, crypto).',
  '',
  'Hard constraints:',
  '- Never claim an offer is "safe" — use language like "no obvious red flags".',
  '- Never recommend off-Steam payment.',
  '- value_delta_usd must be a number (use 0 if you genuinely cannot estimate).',
  '- Output JSON only.',
].join('\n')

export async function runOfferReview(input: string): Promise<OfferReviewResponse | null> {
  try {
    const completion = await openai.chat.completions.create({
      model: AI_SAFETY_REVIEW_MODEL,
      max_tokens: 1500,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: OFFER_REVIEW_SYSTEM_PROMPT },
        { role: 'user', content: input },
      ],
    })

    if (completion.usage) {
      console.log(
        `[ai-offer-review] model=${AI_SAFETY_REVIEW_MODEL} prompt_tokens=${completion.usage.prompt_tokens} completion_tokens=${completion.usage.completion_tokens}`,
      )
    }

    const text = completion.choices[0]?.message?.content
    if (!text) return null

    const parsed = JSON.parse(text)
    const result = OfferReviewResponseSchema.safeParse(parsed)
    return result.success ? result.data : null
  } catch (err) {
    console.error('[ai-offer-review] failed:', err instanceof Error ? err.message : err)
    return null
  }
}

// Builds the input the model sees for an offer review. Items are described
// with full Steam market_hash_name so the model can reason about wear from the
// "(Field-Tested)" suffix and patterns from the base name.
export function buildOfferReviewInput(args: {
  viewer_role: 'sender' | 'recipient'
  viewer: { display_name: string; total_trades: number; average_rating: number | null; account_age_days: number }
  counterparty: { display_name: string; total_trades: number; average_rating: number | null; account_age_days: number }
  // Items the viewer is sending to the counterparty.
  viewer_sends: Array<{ name: string; wear: string | null; rarity: string | null }>
  // Items the viewer is receiving from the counterparty.
  viewer_receives: Array<{ name: string; wear: string | null; rarity: string | null }>
  // Steam Market lowest_price strings for each item if known (e.g. "$45.20"),
  // null when uncached. The model uses these as the canonical USD basis.
  prices: Record<string, string | null>
  recent_messages: Array<{ sender: 'viewer' | 'counterparty'; body: string; created_at: string }>
  counterparty_reported_within_90d: boolean
}): string {
  return JSON.stringify(args, null, 2)
}

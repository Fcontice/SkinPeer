import { z } from 'zod'
import { isValidSteamTradeUrl } from '../lib/steamTradeUrl'

// =====================================================================
// trader_profiles
// =====================================================================

export const TraderProfileSchema = z.object({
  display_name: z.string().min(1).max(60),
  bio: z.string().max(500).nullish(),
  trade_preferences: z.string().max(500).nullish(),
  accepting_trades: z.boolean(),
  is_public: z.boolean(),
})
export type TraderProfileInput = z.infer<typeof TraderProfileSchema>

export const UpdateTraderProfileSchema = TraderProfileSchema.partial()
export type UpdateTraderProfileInput = z.infer<typeof UpdateTraderProfileSchema>

// steam_trade_url + steam_webapi_token both live on profiles (not
// trader_profiles) and share a single patch endpoint. Each field is
// independently optional — at least one must be present. null on either
// field clears it. The token, when provided, is validated by pinging Steam
// before being persisted; on validation failure the URL still saves and the
// response includes a `tokenError` field. Plaintext token never round-trips
// back to the client — only the derived has_steam_webapi_token boolean does.
export const UpdateSteamTradeUrlSchema = z
  .object({
    steam_trade_url: z
      .string()
      .max(300)
      .nullable()
      .refine((v) => v === null || isValidSteamTradeUrl(v), {
        message:
          'Must be a Steam trade URL of the form https://steamcommunity.com/tradeoffer/new/?partner=...&token=...',
      })
      .optional(),
    steam_webapi_token: z.string().min(1).max(2000).nullable().optional(),
  })
  .refine(
    (v) => v.steam_trade_url !== undefined || v.steam_webapi_token !== undefined,
    { message: 'At least one of steam_trade_url or steam_webapi_token is required' },
  )
export type UpdateSteamTradeUrlInput = z.infer<typeof UpdateSteamTradeUrlSchema>

export const ListTradersQuerySchema = z.object({
  search: z.string().max(60).optional(),
  sort: z.enum(['rating', 'trades', 'recent']).default('recent'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})
export type ListTradersQuery = z.infer<typeof ListTradersQuerySchema>

// =====================================================================
// conversations + messages
// =====================================================================

export const StartConversationSchema = z.object({
  other_user_id: z.string().uuid(),
})
export type StartConversationInput = z.infer<typeof StartConversationSchema>

export const SendMessageSchema = z.object({
  body: z.string().min(1).max(2000),
})
export type SendMessageInput = z.infer<typeof SendMessageSchema>

export const MessageHistoryQuerySchema = z.object({
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})
export type MessageHistoryQuery = z.infer<typeof MessageHistoryQuerySchema>

// =====================================================================
// trade_proposals + items + checklist
// =====================================================================

export const CreateProposalSchema = z.object({
  conversation_id: z.string().uuid(),
})
export type CreateProposalInput = z.infer<typeof CreateProposalSchema>

export const AddProposalItemSchema = z.object({
  name: z.string().min(1).max(200),
  wear: z.string().max(40).nullish(),
  float_value: z.number().min(0).max(1).nullish(),
  rarity: z.string().max(40).nullish(),
  image_url: z.string().url().nullish(),
  steam_asset_id: z.string().max(40).nullish(),
})
export type AddProposalItemInput = z.infer<typeof AddProposalItemSchema>

// Status enum mirrors the DB check constraint (007). ready_to_verify was
// dropped in PR 2; the four-boolean checklist was replaced with per-user
// mark-completed flags on trade_proposals.
export const PROPOSAL_STATUSES = [
  'draft',
  'completed',
  'cancelled',
  'disputed',
  'in_review',
] as const
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number]

export const ListMyProposalsQuerySchema = z.object({
  status: z.enum(PROPOSAL_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})
export type ListMyProposalsQuery = z.infer<typeof ListMyProposalsQuerySchema>

// =====================================================================
// reports + reviews
// =====================================================================

// New shape: subject_user_id is required; proposal_id and conversation_id are optional context.
export const FileReportSchema = z
  .object({
    subject_user_id: z.string().uuid(),
    proposal_id: z.string().uuid().optional(),
    conversation_id: z.string().uuid().optional(),
    reason: z.string().min(10).max(2000),
  })
  .refine((v) => v.subject_user_id !== undefined, {
    message: 'subject_user_id is required',
  })
export type FileReportInput = z.infer<typeof FileReportSchema>

export const ReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).nullish(),
})
export type ReviewInput = z.infer<typeof ReviewSchema>

// =====================================================================
// AI safety review
// =====================================================================

// Strict shape we hold the model output to. Validated against parsed JSON.
// Malformed → null → 502.
export const AiReviewResponseSchema = z.object({
  risk_level: z.enum(['low', 'medium', 'high', 'critical']),
  warnings: z.array(z.string().max(500)).max(20),
  recommended_actions: z.array(z.string().max(500)).min(1).max(20),
})
export type AiReviewResponse = z.infer<typeof AiReviewResponseSchema>

// Offer-level review (PR 3). Richer schema than AiReviewResponseSchema;
// computed from the viewer's perspective (fairness + value_delta_usd).
export const OFFER_FAIRNESS = ['fair', 'slightly_unfavorable', 'unfavorable', 'heavily_unfavorable'] as const
export type OfferFairness = (typeof OFFER_FAIRNESS)[number]

export const OfferReviewResponseSchema = z.object({
  fairness: z.enum(OFFER_FAIRNESS),
  value_delta_usd: z.number().finite(),
  notable_observations: z.array(z.string().max(500)).max(20),
  risk_flags: z.array(z.string().max(500)).max(20),
  summary: z.string().max(2000),
})
export type OfferReviewResponse = z.infer<typeof OfferReviewResponseSchema>

// =====================================================================
// trade_offers (pull-based)
// =====================================================================

// Mirror of InventoryItem from apps/server/src/lib/steam.ts. We hold
// offered/requested items at the shape we display + map back to Steam.
export const OfferItemSchema = z.object({
  asset_id: z.string().min(1).max(40),
  class_id: z.string().min(1).max(40),
  name: z.string().min(1).max(200),
  icon_url: z.string().url(),
  wear: z.string().max(40).nullable(),
  rarity: z.string().max(40).nullable(),
  type: z.string().max(40).nullable(),
  tradable: z.boolean(),
  marketable: z.boolean(),
})
export type OfferItemInput = z.infer<typeof OfferItemSchema>

export const CreateOfferSchema = z
  .object({
    conversation_id: z.string().uuid(),
    requested_items: z.array(OfferItemSchema).max(50),
    offered_items: z.array(OfferItemSchema).max(50),
    parent_offer_id: z.string().uuid().optional(),
  })
  .refine((v) => v.requested_items.length > 0 || v.offered_items.length > 0, {
    message: 'At least one item must be requested or offered',
  })
export type CreateOfferInput = z.infer<typeof CreateOfferSchema>

// Counter is identical shape (parent_offer_id required) but enforced at the route layer.

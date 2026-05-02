// Frontend-side types for trader-network entities. Mirror the server's
// public response shapes — these are not Zod validators, just type aliases.

export interface TraderProfile {
  user_id: string
  display_name: string
  bio: string | null
  trade_preferences: string | null
  accepting_trades: boolean
  is_public?: boolean
  total_trades: number
  average_rating: number | null
  created_at: string
  // Joined from profiles.steam_trade_url for the /me/profile response.
  steam_trade_url?: string | null
  // Derived from profiles.steam_webapi_token_secret_id presence — plaintext
  // is never returned to the client.
  has_steam_webapi_token?: boolean
  // Joined from profiles for the list + public-detail responses so trader
  // cards can show the user's Steam avatar instead of generated initials.
  profile?: { steam_avatar: string | null; steam_persona: string | null } | null
}

export type TraderProfilePublic = TraderProfile

export interface Conversation {
  id: string
  user_a_id: string
  user_b_id: string
  last_message_at: string | null
  created_at: string
  user_a?: { id: string; username: string; steam_persona: string | null; steam_avatar: string | null }
  user_b?: { id: string; username: string; steam_persona: string | null; steam_avatar: string | null }
  last_message?: {
    body: string
    kind: Message['kind']
    sender_id: string
    created_at: string
  } | null
  unread_count?: number
}

export interface Message {
  id: string
  conversation_id: string
  sender_id: string
  body: string
  kind: 'user' | 'system' | 'trade_proposal_link' | 'trade_offer'
  metadata: Record<string, unknown> | null
  read_at: string | null
  created_at: string
}

export type ProposalStatus = 'draft' | 'completed' | 'cancelled' | 'disputed' | 'in_review'

export interface TradeProposal {
  id: string
  conversation_id: string
  creator_id: string
  recipient_id: string
  status: ProposalStatus
  verification_code: string
  creator_marked_completed: boolean
  recipient_marked_completed: boolean
  ai_review_id: string | null
  completed_at: string | null
  cancelled_at: string | null
  created_at: string
  updated_at: string
}

export interface TradeItem {
  id: string
  proposal_id: string
  owner_id: string
  name: string
  wear: string | null
  float_value: number | null
  rarity: string | null
  image_url: string | null
  steam_asset_id: string | null
  created_at: string
}

export interface AiSafetyReview {
  id: string
  proposal_id: string
  requested_by: string
  risk_level: 'low' | 'medium' | 'high' | 'critical'
  warnings: string[]
  recommended_actions: string[]
  model_used: string
  input_summary: string | null
  created_at: string
}

export type OfferStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'countered'

export interface OfferItem {
  asset_id: string
  class_id: string
  name: string
  icon_url: string
  wear: string | null
  rarity: string | null
  type: string | null
  tradable: boolean
  marketable: boolean
}

export interface TradeOffer {
  id: string
  conversation_id: string
  from_user_id: string
  to_user_id: string
  requested_items: OfferItem[]
  offered_items: OfferItem[]
  status: OfferStatus
  parent_offer_id: string | null
  resulting_proposal_id: string | null
  created_at: string
  updated_at: string
}

export interface MarketPrice {
  market_hash_name: string
  lowest_price: string | null
  median_price: string | null
  volume: string | null
  source: string
  fetched_at: string
}

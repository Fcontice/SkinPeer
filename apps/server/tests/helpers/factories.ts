// Inline data builders for stub-based route tests. NOT real DB factories —
// they just produce plain objects that match the shape of rows the route
// handlers expect to read out of supabase.from(...).select().

import { randomUUID } from 'node:crypto'

export function uuid() {
  return randomUUID()
}

export function makeProfile(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(),
    username: `user_${Math.random().toString(36).slice(2, 8)}`,
    avatar_url: null,
    is_admin: false,
    steam_id: null,
    steam_persona: null,
    steam_avatar: null,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

export function makeConversation(userA: string, userB: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(),
    user_a_id: userA,
    user_b_id: userB,
    last_message_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

export function makeProposal(creatorId: string, recipientId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(),
    conversation_id: uuid(),
    creator_id: creatorId,
    recipient_id: recipientId,
    status: 'draft',
    verification_code: 'ABC123',
    creator_ready: false,
    recipient_ready: false,
    ai_review_id: null,
    completed_at: null,
    cancelled_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

export function makeItem(proposalId: string, ownerId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(),
    proposal_id: proposalId,
    owner_id: ownerId,
    name: 'AK-47 | Redline',
    wear: 'Field-Tested',
    float_value: 0.18,
    rarity: 'Classified',
    image_url: 'https://steamcommunity-a.akamaihd.net/economy/image/x',
    steam_asset_id: '1234567890',
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

export function makeChecklistItem(proposalId: string, userId: string, key: string, isChecked: boolean) {
  return {
    id: uuid(),
    proposal_id: proposalId,
    user_id: userId,
    checklist_key: key,
    is_checked: isChecked,
    checked_at: isChecked ? new Date().toISOString() : null,
  }
}

export function makeOffer(conversationId: string, fromId: string, toId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(),
    conversation_id: conversationId,
    from_user_id: fromId,
    to_user_id: toId,
    requested_items: [],
    offered_items: [],
    status: 'pending',
    parent_offer_id: null,
    resulting_proposal_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

export function makeOfferItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    asset_id: '1',
    class_id: '2',
    name: 'AK-47 | Redline',
    icon_url: 'https://steamcommunity-a.akamaihd.net/economy/image/x',
    wear: 'FT',
    rarity: 'Classified',
    type: 'Rifle',
    tradable: true,
    marketable: true,
    ...overrides,
  }
}

export function makeReport(reporterId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(),
    reporter_id: reporterId,
    subject_user_id: null,
    proposal_id: null,
    conversation_id: null,
    reason: 'Test report reason that is long enough.',
    status: 'open',
    resolved_by: null,
    resolution_notes: null,
    created_at: new Date().toISOString(),
    resolved_at: null,
    ...overrides,
  }
}

export function makeAiReview(proposalId: string, requestedBy: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid(),
    proposal_id: proposalId,
    requested_by: requestedBy,
    risk_level: 'low',
    warnings: [],
    recommended_actions: ['Verify items in Steam before accepting.'],
    model_used: 'test-model',
    input_summary: 'creator=1 items, recipient=1 items, msgs=2',
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

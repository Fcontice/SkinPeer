import { Router } from 'express'
import { supabase } from '../lib/supabase'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import rateLimit from 'express-rate-limit'
import {
  CreateProposalSchema,
  AddProposalItemSchema,
  ListMyProposalsQuerySchema,
  ReviewSchema,
} from '../schemas/traderNetwork'
import { generateProposalVerificationCode } from '../services/proposalCodeService'
import { runAiSafetyReview, buildAiReviewInput, AI_SAFETY_REVIEW_MODEL } from '../lib/openai'

// Per-user cap on AI review calls layered on top of the global IP limiter.
// The 24h DB-based limit (3 per proposal+user) covers same-proposal spam;
// this prevents a single user from burning model budget across many proposals.
const aiReviewLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user?.id ?? req.ip ?? 'anonymous',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many AI review requests, please slow down' },
})

const router = Router()
router.use(authenticate)

// ---------- helpers ----------

async function fetchProposal(id: string): Promise<{
  id: string
  conversation_id: string
  creator_id: string
  recipient_id: string
  status: string
  ai_review_id: string | null
  creator_marked_completed: boolean
  recipient_marked_completed: boolean
} | null> {
  const { data } = await supabase
    .from('trade_proposals')
    .select('id, conversation_id, creator_id, recipient_id, status, ai_review_id, creator_marked_completed, recipient_marked_completed')
    .eq('id', id)
    .maybeSingle()
  return data
}

// Either user marking completed locks the room. We check both flags so the
// items + AI-review routes treat "first user marked" as immutable too.
function isLocked(p: { creator_marked_completed: boolean; recipient_marked_completed: boolean; status: string }): boolean {
  return (
    p.status !== 'draft' ||
    p.creator_marked_completed ||
    p.recipient_marked_completed
  )
}

function isParticipant(p: { creator_id: string; recipient_id: string }, userId: string): boolean {
  return p.creator_id === userId || p.recipient_id === userId
}

async function logActivity(proposalId: string, actorId: string, action: string, metadata?: unknown) {
  await supabase.from('trade_activity_log').insert({
    proposal_id: proposalId,
    actor_id: actorId,
    action,
    metadata: metadata ?? null,
  })
}

// ---------- POST /api/proposals ----------
router.post('/', validate(CreateProposalSchema), async (req, res, next) => {
  try {
    const me = req.user!.id
    const conversationId = req.body.conversation_id as string

    const { data: convo } = await supabase
      .from('conversations')
      .select('id, user_a_id, user_b_id')
      .eq('id', conversationId)
      .maybeSingle()

    if (!convo) {
      res.status(404).json({ error: 'Conversation not found' })
      return
    }
    if (convo.user_a_id !== me && convo.user_b_id !== me) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    const recipientId = convo.user_a_id === me ? convo.user_b_id : convo.user_a_id
    const code = await generateProposalVerificationCode()

    const { data: proposal, error } = await supabase
      .from('trade_proposals')
      .insert({
        conversation_id: conversationId,
        creator_id: me,
        recipient_id: recipientId,
        verification_code: code,
      })
      .select()
      .single()

    if (error || !proposal) {
      res.status(400).json({ error: error?.message ?? 'Failed to create proposal' })
      return
    }

    // Post a system message linking the proposal into the conversation
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: me,
      body: 'Trade proposal created',
      kind: 'trade_proposal_link',
      metadata: { proposal_id: proposal.id, verification_code: code },
    })

    await logActivity(proposal.id, me, 'proposal_created')

    res.status(201).json(proposal)
  } catch (err) {
    next(err)
  }
})

// ---------- GET /api/proposals/me ----------
router.get('/me', async (req, res, next) => {
  try {
    const me = req.user!.id
    const parsed = ListMyProposalsQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues })
      return
    }
    const { status, limit } = parsed.data

    let query = supabase
      .from('trade_proposals')
      .select('*')
      .or(`creator_id.eq.${me},recipient_id.eq.${me}`)
      .order('updated_at', { ascending: false })
      .limit(limit)

    if (status) query = query.eq('status', status)

    const { data, error } = await query
    if (error) {
      res.status(400).json({ error: error.message })
      return
    }
    res.json(data ?? [])
  } catch (err) {
    next(err)
  }
})

// ---------- GET /api/proposals/:id ----------
router.get('/:id', async (req, res, next) => {
  try {
    const me = req.user!.id
    const proposal = await fetchProposal(req.params.id)
    if (!proposal) {
      res.status(404).json({ error: 'Proposal not found' })
      return
    }
    if (!isParticipant(proposal, me)) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    const { data: full } = await supabase
      .from('trade_proposals')
      .select('*')
      .eq('id', req.params.id)
      .single()

    const { data: items } = await supabase
      .from('trade_items')
      .select('*')
      .eq('proposal_id', req.params.id)
      .order('created_at', { ascending: true })

    const creatorItems = (items ?? []).filter((i) => i.owner_id === proposal.creator_id)
    const recipientItems = (items ?? []).filter((i) => i.owner_id === proposal.recipient_id)

    let aiReview = null
    if (proposal.ai_review_id) {
      const { data } = await supabase
        .from('ai_safety_reviews')
        .select('*')
        .eq('id', proposal.ai_review_id)
        .maybeSingle()
      aiReview = data
    }

    // Steam trade URLs for the Send-on-Steam deeplink CTA. Visible only to
    // participants (this route is already gated above). We also expose each
    // party's display name (steam_persona / username) so the gating UI can
    // name the counterparty in its inline messaging.
    //
    // viewer_has_steam_webapi_token mirrors the boolean shape used by the
    // /traders/me/profile response, so the helper modal can show the token-
    // saved indicator even when the user opens it from this page. We do not
    // expose token presence for the counterparty — that's the user's secret.
    const { data: parties } = await supabase
      .from('profiles')
      .select('id, steam_trade_url, steam_persona, username, steam_webapi_token_secret_id')
      .in('id', [proposal.creator_id, proposal.recipient_id])

    const urlOf = (uid: string) =>
      parties?.find((p) => p.id === uid)?.steam_trade_url ?? null
    const nameOf = (uid: string) => {
      const p = parties?.find((x) => x.id === uid)
      return p?.steam_persona ?? p?.username ?? 'Trader'
    }
    const viewer = parties?.find((p) => p.id === me)

    res.json({
      proposal: full,
      items: { creator: creatorItems, recipient: recipientItems },
      ai_review: aiReview,
      steam_trade_urls: {
        creator: urlOf(proposal.creator_id),
        recipient: urlOf(proposal.recipient_id),
      },
      display_names: {
        creator: nameOf(proposal.creator_id),
        recipient: nameOf(proposal.recipient_id),
      },
      viewer_has_steam_webapi_token: !!viewer?.steam_webapi_token_secret_id,
    })
  } catch (err) {
    next(err)
  }
})

// ---------- DELETE /api/proposals/:id ----------
router.delete('/:id', async (req, res, next) => {
  try {
    const me = req.user!.id
    const proposal = await fetchProposal(req.params.id)
    if (!proposal) {
      res.status(404).json({ error: 'Proposal not found' })
      return
    }
    if (proposal.creator_id !== me) {
      res.status(403).json({ error: 'Only the creator can cancel a draft proposal' })
      return
    }
    if (proposal.status !== 'draft') {
      res.status(400).json({ error: 'Only draft proposals can be deleted' })
      return
    }

    await supabase
      .from('trade_proposals')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)

    await logActivity(req.params.id, me, 'proposal_deleted')

    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// ---------- POST /api/proposals/:id/items ----------
router.post('/:id/items', validate(AddProposalItemSchema), async (req, res, next) => {
  try {
    const me = req.user!.id
    const proposal = await fetchProposal(req.params.id)
    if (!proposal) {
      res.status(404).json({ error: 'Proposal not found' })
      return
    }
    if (!isParticipant(proposal, me)) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }
    if (isLocked(proposal)) {
      res.status(400).json({ error: 'Items are locked for this proposal' })
      return
    }

    const { data, error } = await supabase
      .from('trade_items')
      .insert({ ...req.body, proposal_id: req.params.id, owner_id: me })
      .select()
      .single()

    if (error) {
      res.status(400).json({ error: error.message })
      return
    }

    await logActivity(req.params.id, me, 'item_added', { item_name: data.name })

    res.status(201).json(data)
  } catch (err) {
    next(err)
  }
})

// ---------- DELETE /api/proposals/:id/items/:itemId ----------
router.delete('/:id/items/:itemId', async (req, res, next) => {
  try {
    const me = req.user!.id
    const proposal = await fetchProposal(req.params.id)
    if (!proposal) {
      res.status(404).json({ error: 'Proposal not found' })
      return
    }
    if (!isParticipant(proposal, me)) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }
    if (isLocked(proposal)) {
      res.status(400).json({ error: 'Items are locked for this proposal' })
      return
    }

    const { data: item } = await supabase
      .from('trade_items')
      .select('owner_id, name')
      .eq('id', req.params.itemId)
      .maybeSingle()

    if (!item) {
      res.status(404).json({ error: 'Item not found' })
      return
    }
    if (item.owner_id !== me) {
      res.status(403).json({ error: 'You can only remove your own items' })
      return
    }

    await supabase.from('trade_items').delete().eq('id', req.params.itemId)
    await logActivity(req.params.id, me, 'item_removed', { item_name: item.name })

    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// ---------- POST /api/proposals/:id/mark-completed ----------
// Either participant marks the trade as completed on Steam. The first call
// locks the room (status stays draft, no item edits, no offer changes).
// The second call flips status -> completed permanently. Idempotent per user.
router.post('/:id/mark-completed', async (req, res, next) => {
  try {
    const me = req.user!.id
    const proposal = await fetchProposal(req.params.id)
    if (!proposal) {
      res.status(404).json({ error: 'Proposal not found' })
      return
    }
    if (!isParticipant(proposal, me)) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }
    if (proposal.status !== 'draft') {
      res.status(400).json({ error: 'Only draft proposals can be marked completed' })
      return
    }

    const isCreator = proposal.creator_id === me
    const myFlag = isCreator ? proposal.creator_marked_completed : proposal.recipient_marked_completed
    const otherFlag = isCreator ? proposal.recipient_marked_completed : proposal.creator_marked_completed

    if (myFlag) {
      // Idempotent — already marked. Return the current proposal row.
      const { data } = await supabase.from('trade_proposals').select('*').eq('id', req.params.id).single()
      res.json(data)
      return
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }
    if (isCreator) updates.creator_marked_completed = true
    else updates.recipient_marked_completed = true

    const bothMarked = otherFlag === true
    if (bothMarked) {
      updates.status = 'completed'
      updates.completed_at = new Date().toISOString()
    }

    const { data, error } = await supabase
      .from('trade_proposals')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) {
      res.status(400).json({ error: error.message })
      return
    }

    await logActivity(req.params.id, me, 'marked_completed')
    if (bothMarked) {
      await logActivity(req.params.id, me, 'trade_completed')
    }

    res.json(data)
  } catch (err) {
    next(err)
  }
})

// ---------- POST /api/proposals/:id/mark-completed/reset ----------
// Either participant can clear both flags while the proposal is still draft.
// Useful if someone marked completed by mistake. Once status is completed,
// only an admin can reset (admin route lives elsewhere).
router.post('/:id/mark-completed/reset', async (req, res, next) => {
  try {
    const me = req.user!.id
    const proposal = await fetchProposal(req.params.id)
    if (!proposal) {
      res.status(404).json({ error: 'Proposal not found' })
      return
    }
    if (!isParticipant(proposal, me)) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }
    if (proposal.status !== 'draft') {
      res.status(400).json({ error: 'Reset only allowed while the proposal is in draft' })
      return
    }

    const { data, error } = await supabase
      .from('trade_proposals')
      .update({
        creator_marked_completed: false,
        recipient_marked_completed: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) {
      res.status(400).json({ error: error.message })
      return
    }

    await logActivity(req.params.id, me, 'marked_completed_reset')

    res.json(data)
  } catch (err) {
    next(err)
  }
})

// ---------- POST /api/proposals/:id/cancel ----------
router.post('/:id/cancel', async (req, res, next) => {
  try {
    const me = req.user!.id
    const proposal = await fetchProposal(req.params.id)
    if (!proposal) {
      res.status(404).json({ error: 'Proposal not found' })
      return
    }
    if (!isParticipant(proposal, me)) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }
    if (proposal.status !== 'draft') {
      res.status(400).json({ error: 'Proposal can only be cancelled while in draft' })
      return
    }

    const { data, error } = await supabase
      .from('trade_proposals')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) {
      res.status(400).json({ error: error.message })
      return
    }

    await logActivity(req.params.id, me, 'proposal_cancelled')

    res.json(data)
  } catch (err) {
    next(err)
  }
})

// ---------- POST /api/proposals/:id/review ----------
router.post('/:id/review', validate(ReviewSchema), async (req, res, next) => {
  try {
    const me = req.user!.id
    const proposal = await fetchProposal(req.params.id)
    if (!proposal) {
      res.status(404).json({ error: 'Proposal not found' })
      return
    }
    if (!isParticipant(proposal, me)) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }
    if (proposal.status !== 'completed') {
      res.status(400).json({ error: 'Reviews can only be left on completed proposals' })
      return
    }

    const subjectUserId = proposal.creator_id === me ? proposal.recipient_id : proposal.creator_id

    const { data, error } = await supabase
      .from('reviews')
      .insert({
        proposal_id: req.params.id,
        reviewer_id: me,
        subject_user_id: subjectUserId,
        rating: req.body.rating,
        comment: req.body.comment ?? null,
      })
      .select()
      .single()

    if (error) {
      // unique violation = already reviewed
      if (error.code === '23505') {
        res.status(409).json({ error: 'You have already reviewed this trade' })
        return
      }
      res.status(400).json({ error: error.message })
      return
    }

    await logActivity(req.params.id, me, 'review_submitted', { rating: req.body.rating })

    res.status(201).json(data)
  } catch (err) {
    next(err)
  }
})

// ---------- POST /api/proposals/:id/ai-review ----------
// Rate-limited: 10 runs per user per minute, plus 3 runs per (proposal, user) per 24h.
router.post('/:id/ai-review', aiReviewLimiter, async (req, res, next) => {
  try {
    const me = req.user!.id
    const proposal = await fetchProposal(req.params.id)
    if (!proposal) {
      res.status(404).json({ error: 'Proposal not found' })
      return
    }
    if (!isParticipant(proposal, me)) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }
    if (proposal.status !== 'draft' || proposal.creator_marked_completed || proposal.recipient_marked_completed) {
      res.status(400).json({ error: 'AI review is only available before either party has marked the trade completed' })
      return
    }

    // Rate-limit check
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { count: recentCount } = await supabase
      .from('ai_safety_reviews')
      .select('id', { count: 'exact', head: true })
      .eq('proposal_id', req.params.id)
      .eq('requested_by', me)
      .gte('created_at', since)

    if ((recentCount ?? 0) >= 3) {
      res.status(429).json({ error: 'Rate limit: 3 AI reviews per proposal per user per 24 hours' })
      return
    }

    // Build input — server-only data
    const { data: creatorProfile } = await supabase
      .from('trader_profiles')
      .select('display_name, total_trades, average_rating')
      .eq('user_id', proposal.creator_id)
      .maybeSingle()

    const { data: recipientProfile } = await supabase
      .from('trader_profiles')
      .select('display_name, total_trades, average_rating')
      .eq('user_id', proposal.recipient_id)
      .maybeSingle()

    const { data: creatorAuth } = await supabase
      .from('profiles')
      .select('created_at')
      .eq('id', proposal.creator_id)
      .single()

    const { data: recipientAuth } = await supabase
      .from('profiles')
      .select('created_at')
      .eq('id', proposal.recipient_id)
      .single()

    const ageDays = (iso?: string | null) =>
      iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : 0

    const { data: items } = await supabase
      .from('trade_items')
      .select('owner_id, name, wear, rarity, image_url')
      .eq('proposal_id', req.params.id)

    const creatorItems = (items ?? [])
      .filter((i) => i.owner_id === proposal.creator_id)
      .map(({ name, wear, rarity, image_url }) => ({ name, wear, rarity, image_url }))
    const recipientItems = (items ?? [])
      .filter((i) => i.owner_id === proposal.recipient_id)
      .map(({ name, wear, rarity, image_url }) => ({ name, wear, rarity, image_url }))

    const { data: messages } = await supabase
      .from('messages')
      .select('sender_id, body, created_at')
      .eq('conversation_id', proposal.conversation_id)
      .order('created_at', { ascending: false })
      .limit(30)

    const recentMessages = (messages ?? [])
      .reverse()
      .map((m) => ({
        sender: (m.sender_id === proposal.creator_id ? 'creator' : 'recipient') as 'creator' | 'recipient',
        body: m.body,
        created_at: m.created_at,
      }))

    const since90 = new Date(Date.now() - 90 * 86400000).toISOString()
    const { count: reportedCount } = await supabase
      .from('reports')
      .select('id', { count: 'exact', head: true })
      .in('subject_user_id', [proposal.creator_id, proposal.recipient_id])
      .gte('created_at', since90)

    const inputBody = buildAiReviewInput({
      creator: {
        display_name: creatorProfile?.display_name ?? '(no profile)',
        total_trades: creatorProfile?.total_trades ?? 0,
        average_rating: creatorProfile?.average_rating ?? null,
        account_age_days: ageDays(creatorAuth?.created_at),
      },
      recipient: {
        display_name: recipientProfile?.display_name ?? '(no profile)',
        total_trades: recipientProfile?.total_trades ?? 0,
        average_rating: recipientProfile?.average_rating ?? null,
        account_age_days: ageDays(recipientAuth?.created_at),
      },
      creator_items: creatorItems,
      recipient_items: recipientItems,
      recent_messages: recentMessages,
      either_reported_within_90d: (reportedCount ?? 0) > 0,
    })

    const aiResult = await runAiSafetyReview(inputBody)
    if (!aiResult) {
      res.status(502).json({ error: 'AI review unavailable, try again later' })
      return
    }

    const { data: stored, error: storeErr } = await supabase
      .from('ai_safety_reviews')
      .insert({
        proposal_id: req.params.id,
        requested_by: me,
        risk_level: aiResult.risk_level,
        warnings: aiResult.warnings,
        recommended_actions: aiResult.recommended_actions,
        model_used: AI_SAFETY_REVIEW_MODEL,
        input_summary: `creator=${creatorItems.length} items, recipient=${recipientItems.length} items, msgs=${recentMessages.length}`,
      })
      .select()
      .single()

    if (storeErr || !stored) {
      res.status(500).json({ error: storeErr?.message ?? 'Failed to store AI review' })
      return
    }

    // Latest review wins on the proposal
    await supabase
      .from('trade_proposals')
      .update({ ai_review_id: stored.id, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)

    await logActivity(req.params.id, me, 'ai_review_run', { risk_level: aiResult.risk_level })

    res.status(201).json(stored)
  } catch (err) {
    next(err)
  }
})

// ---------- GET /api/proposals/:id/activity ----------
router.get('/:id/activity', async (req, res, next) => {
  try {
    const me = req.user!.id
    const proposal = await fetchProposal(req.params.id)
    if (!proposal) {
      res.status(404).json({ error: 'Proposal not found' })
      return
    }
    if (!isParticipant(proposal, me)) {
      // also allow admins
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', me)
        .single()
      if (!profile?.is_admin) {
        res.status(403).json({ error: 'Forbidden' })
        return
      }
    }

    const { data } = await supabase
      .from('trade_activity_log')
      .select('*')
      .eq('proposal_id', req.params.id)
      .order('created_at', { ascending: true })

    res.json(data ?? [])
  } catch (err) {
    next(err)
  }
})

export default router

import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { supabase } from '../lib/supabase'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { CreateOfferSchema, OfferItemSchema } from '../schemas/traderNetwork'
import { generateProposalVerificationCode } from '../services/proposalCodeService'
import {
  runOfferReview,
  buildOfferReviewInput,
  AI_SAFETY_REVIEW_MODEL,
} from '../lib/openai'
import { getMarketPrice } from '../lib/marketPrice'

const router = Router()
router.use(authenticate)

type OfferRow = {
  id: string
  conversation_id: string
  from_user_id: string
  to_user_id: string
  status: string
  requested_items: unknown[]
  offered_items: unknown[]
  parent_offer_id: string | null
}

type OfferItemPayload = {
  asset_id: string
  class_id: string
  name: string
  icon_url: string
  wear: string | null
  rarity: string | null
  type: string | null
}

async function loadOffer(id: string): Promise<OfferRow | null> {
  const { data } = await supabase
    .from('trade_offers')
    .select('id, conversation_id, from_user_id, to_user_id, status, requested_items, offered_items, parent_offer_id')
    .eq('id', id)
    .maybeSingle()
  return (data as OfferRow | null) ?? null
}

async function transitionOffer(id: string, status: string) {
  const { data } = await supabase
    .from('trade_offers')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  return data
}

const CounterOfferBodySchema = z.object({
  requested_items: z.array(OfferItemSchema).max(50),
  offered_items: z.array(OfferItemSchema).max(50),
})

router.post('/', validate(CreateOfferSchema), async (req, res, next) => {
  try {
    const me = req.user!.id
    const { conversation_id, requested_items, offered_items, parent_offer_id } = req.body

    const { data: convo } = await supabase
      .from('conversations')
      .select('id, user_a_id, user_b_id')
      .eq('id', conversation_id)
      .maybeSingle()

    if (!convo) {
      res.status(404).json({ error: 'Conversation not found' })
      return
    }
    if (convo.user_a_id !== me && convo.user_b_id !== me) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    const to = convo.user_a_id === me ? convo.user_b_id : convo.user_a_id

    const { data: offer, error } = await supabase
      .from('trade_offers')
      .insert({
        conversation_id,
        from_user_id: me,
        to_user_id: to,
        requested_items,
        offered_items,
        parent_offer_id: parent_offer_id ?? null,
      })
      .select()
      .single()

    if (error) {
      if ((error as { code?: string }).code === '23505') {
        res.status(409).json({ error: 'You have a pending offer in this thread — withdraw it to revise.' })
        return
      }
      res.status(400).json({ error: (error as Error).message ?? 'Failed to create offer' })
      return
    }

    await supabase.from('messages').insert({
      conversation_id,
      sender_id: me,
      body: 'Trade offer sent',
      kind: 'trade_offer',
      metadata: { offer_id: offer!.id, parent_offer_id: parent_offer_id ?? null },
    })

    res.status(201).json(offer)
  } catch (err) {
    next(err)
  }
})

// GET /api/offers/inbound/pending — offers awaiting current user's action
// MUST be registered BEFORE GET /:id, otherwise Express would match :id with id="inbound"
router.get('/inbound/pending', async (req, res, next) => {
  try {
    const me = req.user!.id
    const { data, count } = await supabase
      .from('trade_offers')
      .select('*', { count: 'exact' })
      .eq('to_user_id', me)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(20)
    res.json({ count: count ?? 0, rows: data ?? [] })
  } catch (err) { next(err) }
})

// GET /api/offers/by-conversation/:conversation_id — all offers in a thread
// MUST be registered BEFORE GET /:id, same reason as /inbound/pending above
router.get('/by-conversation/:conversation_id', async (req, res, next) => {
  try {
    const me = req.user!.id
    const { data: convo } = await supabase
      .from('conversations')
      .select('user_a_id, user_b_id')
      .eq('id', req.params.conversation_id)
      .maybeSingle()
    if (!convo) { res.status(404).json({ error: 'Conversation not found' }); return }
    if (convo.user_a_id !== me && convo.user_b_id !== me) {
      res.status(403).json({ error: 'Forbidden' }); return
    }
    const { data } = await supabase
      .from('trade_offers')
      .select('*')
      .eq('conversation_id', req.params.conversation_id)
      .order('created_at', { ascending: true })
    res.json({ rows: data ?? [] })
  } catch (err) { next(err) }
})

// Per-user 1/min rate limit on the AI offer-review endpoint, layered on top
// of the global IP limiter. Cache hits don't go through this — only forced
// refreshes do.
const offerReviewRefreshLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1,
  keyGenerator: (req) => req.user?.id ?? req.ip ?? 'anonymous',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Refresh limit: 1 review per minute. Wait a moment and try again.' },
  // Skip when the cached row is going to be returned — we conditionally
  // bypass by setting req._cacheHit before reaching the limiter (see route).
  skip: (req) => Boolean((req as unknown as { _cacheHit?: boolean })._cacheHit),
})

type StoredOfferReview = {
  id: string
  trade_offer_id: string
  viewer_user_id: string
  payload: unknown
  model: string
  created_at: string
}

// POST /api/offers/:id/review
// Returns the cached per-(offer, viewer) review if present and refresh!=true.
// On miss (or refresh=true), runs the model, upserts, and returns the row.
// Per-user 1/min limiter applies on cache miss + refresh paths only.
router.post('/:id/review', async (req, res, next) => {
  try {
    const me = req.user!.id
    const offer = await loadOffer(req.params.id)
    if (!offer) { res.status(404).json({ error: 'Offer not found' }); return }
    if (offer.from_user_id !== me && offer.to_user_id !== me) {
      res.status(403).json({ error: 'Forbidden' }); return
    }

    const refresh = req.query.refresh === 'true' || req.body?.refresh === true

    if (!refresh) {
      const { data: cached } = await supabase
        .from('trade_offer_reviews')
        .select('*')
        .eq('trade_offer_id', offer.id)
        .eq('viewer_user_id', me)
        .maybeSingle()
      if (cached) {
        res.json(cached as StoredOfferReview)
        return
      }
    }

    // From here we will hit the model — apply the refresh limiter inline.
    await new Promise<void>((resolve, reject) => {
      offerReviewRefreshLimiter(req, res, (err?: unknown) => {
        if (err) reject(err)
        else resolve()
      })
    })
    if (res.headersSent) return

    // Build viewer-perspective payload.
    const viewerIsSender = offer.from_user_id === me
    const counterpartyId = viewerIsSender ? offer.to_user_id : offer.from_user_id

    const viewerSendsRaw = (viewerIsSender ? offer.offered_items : offer.requested_items) as OfferItemPayload[]
    const viewerReceivesRaw = (viewerIsSender ? offer.requested_items : offer.offered_items) as OfferItemPayload[]
    const viewerSends = viewerSendsRaw.map((i) => ({ name: i.name, wear: i.wear, rarity: i.rarity }))
    const viewerReceives = viewerReceivesRaw.map((i) => ({ name: i.name, wear: i.wear, rarity: i.rarity }))

    // Steam Market price hints — null when uncached/unavailable. The market
    // price helper does its own caching so this is cheap on hot paths.
    const allNames = Array.from(
      new Set([...viewerSends.map((i) => i.name), ...viewerReceives.map((i) => i.name)]),
    )
    const priceEntries = await Promise.all(
      allNames.map(async (n) => {
        try {
          const p = await getMarketPrice(n)
          return [n, p?.lowest_price ?? p?.median_price ?? null] as const
        } catch {
          return [n, null] as const
        }
      }),
    )
    const prices: Record<string, string | null> = Object.fromEntries(priceEntries)

    const { data: viewerProfile } = await supabase
      .from('trader_profiles')
      .select('display_name, total_trades, average_rating')
      .eq('user_id', me)
      .maybeSingle()
    const { data: counterpartyProfile } = await supabase
      .from('trader_profiles')
      .select('display_name, total_trades, average_rating')
      .eq('user_id', counterpartyId)
      .maybeSingle()

    const { data: viewerAuth } = await supabase
      .from('profiles')
      .select('created_at')
      .eq('id', me)
      .single()
    const { data: counterpartyAuth } = await supabase
      .from('profiles')
      .select('created_at')
      .eq('id', counterpartyId)
      .single()

    const ageDays = (iso?: string | null) =>
      iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : 0

    const { data: messages } = await supabase
      .from('messages')
      .select('sender_id, body, created_at')
      .eq('conversation_id', offer.conversation_id)
      .order('created_at', { ascending: false })
      .limit(30)

    const recentMessages = (messages ?? [])
      .reverse()
      .map((m) => ({
        sender: (m.sender_id === me ? 'viewer' : 'counterparty') as 'viewer' | 'counterparty',
        body: m.body,
        created_at: m.created_at,
      }))

    const since90 = new Date(Date.now() - 90 * 86400000).toISOString()
    const { count: reportedCount } = await supabase
      .from('reports')
      .select('id', { count: 'exact', head: true })
      .eq('subject_user_id', counterpartyId)
      .gte('created_at', since90)

    const inputBody = buildOfferReviewInput({
      viewer_role: viewerIsSender ? 'sender' : 'recipient',
      viewer: {
        display_name: viewerProfile?.display_name ?? '(no profile)',
        total_trades: viewerProfile?.total_trades ?? 0,
        average_rating: viewerProfile?.average_rating ?? null,
        account_age_days: ageDays(viewerAuth?.created_at),
      },
      counterparty: {
        display_name: counterpartyProfile?.display_name ?? '(no profile)',
        total_trades: counterpartyProfile?.total_trades ?? 0,
        average_rating: counterpartyProfile?.average_rating ?? null,
        account_age_days: ageDays(counterpartyAuth?.created_at),
      },
      viewer_sends: viewerSends,
      viewer_receives: viewerReceives,
      prices,
      recent_messages: recentMessages,
      counterparty_reported_within_90d: (reportedCount ?? 0) > 0,
    })

    const result = await runOfferReview(inputBody)
    if (!result) {
      res.status(502).json({ error: 'AI review unavailable, try again later' })
      return
    }

    const { data: stored, error: storeErr } = await supabase
      .from('trade_offer_reviews')
      .upsert(
        {
          trade_offer_id: offer.id,
          viewer_user_id: me,
          payload: result,
          model: AI_SAFETY_REVIEW_MODEL,
        },
        { onConflict: 'trade_offer_id,viewer_user_id' },
      )
      .select()
      .single()

    if (storeErr || !stored) {
      res.status(500).json({ error: storeErr?.message ?? 'Failed to store review' })
      return
    }

    res.status(201).json(stored as StoredOfferReview)
  } catch (err) {
    next(err)
  }
})

// GET /api/offers/:id — participant only
router.get('/:id', async (req, res, next) => {
  try {
    const me = req.user!.id
    const offer = await loadOffer(req.params.id)
    if (!offer) { res.status(404).json({ error: 'Offer not found' }); return }
    if (offer.from_user_id !== me && offer.to_user_id !== me) {
      res.status(403).json({ error: 'Forbidden' }); return
    }
    res.json(offer)
  } catch (err) { next(err) }
})

router.post('/:id/withdraw', async (req, res, next) => {
  try {
    const me = req.user!.id
    const offer = await loadOffer(req.params.id)
    if (!offer) { res.status(404).json({ error: 'Offer not found' }); return }
    if (offer.from_user_id !== me) { res.status(403).json({ error: 'Only the sender can withdraw' }); return }
    if (offer.status !== 'pending') { res.status(400).json({ error: 'Offer is not pending' }); return }
    res.json(await transitionOffer(offer.id, 'withdrawn'))
  } catch (err) { next(err) }
})

router.post('/:id/reject', async (req, res, next) => {
  try {
    const me = req.user!.id
    const offer = await loadOffer(req.params.id)
    if (!offer) { res.status(404).json({ error: 'Offer not found' }); return }
    if (offer.to_user_id !== me) { res.status(403).json({ error: 'Only the recipient can reject' }); return }
    if (offer.status !== 'pending') { res.status(400).json({ error: 'Offer is not pending' }); return }
    res.json(await transitionOffer(offer.id, 'rejected'))
  } catch (err) { next(err) }
})

router.post('/:id/accept', async (req, res, next) => {
  try {
    const me = req.user!.id
    const offer = await loadOffer(req.params.id)
    if (!offer) { res.status(404).json({ error: 'Offer not found' }); return }
    if (offer.to_user_id !== me) { res.status(403).json({ error: 'Only the recipient can accept' }); return }
    if (offer.status !== 'pending') { res.status(400).json({ error: 'Offer is not pending' }); return }

    const code = await generateProposalVerificationCode()

    const { data: proposal, error: pErr } = await supabase
      .from('trade_proposals')
      .insert({
        conversation_id: offer.conversation_id,
        creator_id: offer.from_user_id,
        recipient_id: offer.to_user_id,
        verification_code: code,
        status: 'draft',
      })
      .select()
      .single()

    if (pErr || !proposal) {
      res.status(500).json({ error: (pErr as Error | null)?.message ?? 'Failed to create proposal' })
      return
    }

    const offered = (offer.offered_items as OfferItemPayload[]).map((i) => ({
      proposal_id: proposal.id,
      owner_id: offer.from_user_id,
      name: i.name,
      wear: i.wear,
      rarity: i.rarity,
      image_url: i.icon_url,
      steam_asset_id: i.asset_id,
    }))
    const requested = (offer.requested_items as OfferItemPayload[]).map((i) => ({
      proposal_id: proposal.id,
      owner_id: offer.to_user_id,
      name: i.name,
      wear: i.wear,
      rarity: i.rarity,
      image_url: i.icon_url,
      steam_asset_id: i.asset_id,
    }))
    const allItems = [...offered, ...requested]
    if (allItems.length > 0) {
      await supabase.from('trade_items').insert(allItems)
    }

    await supabase
      .from('trade_offers')
      .update({
        status: 'accepted',
        resulting_proposal_id: proposal.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', offer.id)

    await supabase.from('messages').insert({
      conversation_id: offer.conversation_id,
      sender_id: me,
      body: 'Trade offer accepted — verification proposal opened',
      kind: 'trade_proposal_link',
      metadata: { proposal_id: proposal.id, offer_id: offer.id, verification_code: code },
    })

    await supabase.from('trade_activity_log').insert({
      proposal_id: proposal.id,
      actor_id: me,
      action: 'proposal_created_from_offer',
      metadata: { offer_id: offer.id },
    })

    res.json({
      offer_id: offer.id,
      proposal_id: proposal.id,
      verification_code: code,
    })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/counter', validate(CounterOfferBodySchema), async (req, res, next) => {
  try {
    const me = req.user!.id

    const { requested_items, offered_items } = req.body
    if ((requested_items?.length ?? 0) === 0 && (offered_items?.length ?? 0) === 0) {
      res.status(400).json({ error: 'Counter must include at least one item' })
      return
    }

    const original = await loadOffer(req.params.id)
    if (!original) { res.status(404).json({ error: 'Offer not found' }); return }
    if (original.to_user_id !== me) { res.status(403).json({ error: 'Only the recipient can counter' }); return }
    if (original.status !== 'pending') { res.status(400).json({ error: 'Offer is not pending' }); return }

    // 1) flip parent → countered
    await supabase
      .from('trade_offers')
      .update({ status: 'countered', updated_at: new Date().toISOString() })
      .eq('id', original.id)

    // 2) insert child going B → A
    const { data: child, error } = await supabase
      .from('trade_offers')
      .insert({
        conversation_id: original.conversation_id,
        from_user_id: me,
        to_user_id: original.from_user_id,
        requested_items,
        offered_items,
        parent_offer_id: original.id,
      })
      .select()
      .single()

    if (error) {
      if ((error as { code?: string }).code === '23505') {
        res.status(409).json({ error: 'You already have a pending offer in this direction.' })
        return
      }
      res.status(400).json({ error: (error as Error).message })
      return
    }

    // 3) inline thread card for the counter
    await supabase.from('messages').insert({
      conversation_id: original.conversation_id,
      sender_id: me,
      body: 'Counter offer sent',
      kind: 'trade_offer',
      metadata: { offer_id: child!.id, parent_offer_id: original.id },
    })

    res.status(201).json(child)
  } catch (err) {
    next(err)
  }
})

export default router

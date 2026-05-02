import { Router } from 'express'
import { supabase } from '../lib/supabase'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import {
  StartConversationSchema,
  SendMessageSchema,
  MessageHistoryQuerySchema,
} from '../schemas/traderNetwork'

const router = Router()
router.use(authenticate)

// POST /api/conversations
// Find-or-create the conversation between the caller and other_user_id.
// One row per pair regardless of who initiated (enforced by the unique
// (LEAST, GREATEST) index on conversations).
router.post('/', validate(StartConversationSchema), async (req, res, next) => {
  try {
    const me = req.user!.id
    const other = req.body.other_user_id as string

    if (other === me) {
      res.status(400).json({ error: 'Cannot start a conversation with yourself' })
      return
    }

    const { data: existing } = await supabase
      .from('conversations')
      .select('*')
      .or(
        `and(user_a_id.eq.${me},user_b_id.eq.${other}),` +
        `and(user_a_id.eq.${other},user_b_id.eq.${me})`
      )
      .maybeSingle()

    if (existing) {
      res.json(existing)
      return
    }

    const { data: created, error } = await supabase
      .from('conversations')
      .insert({ user_a_id: me, user_b_id: other })
      .select()
      .single()

    if (error) {
      res.status(400).json({ error: error.message })
      return
    }

    res.status(201).json(created)
  } catch (err) {
    next(err)
  }
})

// GET /api/conversations — list current user's conversations, ordered by recency,
// enriched with the latest message preview and an unread count for the caller.
router.get('/', async (req, res, next) => {
  try {
    const me = req.user!.id

    const { data, error } = await supabase
      .from('conversations')
      .select(`
        id, user_a_id, user_b_id, last_message_at, created_at,
        user_a:profiles!conversations_user_a_id_fkey(id, username, steam_persona, steam_avatar),
        user_b:profiles!conversations_user_b_id_fkey(id, username, steam_persona, steam_avatar)
      `)
      .or(`user_a_id.eq.${me},user_b_id.eq.${me}`)
      .order('last_message_at', { ascending: false, nullsFirst: false })

    if (error) {
      res.status(400).json({ error: error.message })
      return
    }

    const conversations = data ?? []

    const enriched = await Promise.all(
      conversations.map(async (c) => {
        const [latestRes, unreadRes] = await Promise.all([
          supabase
            .from('messages')
            .select('body, kind, sender_id, created_at')
            .eq('conversation_id', c.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('conversation_id', c.id)
            .neq('sender_id', me)
            .is('read_at', null),
        ])

        return {
          ...c,
          last_message: latestRes.data ?? null,
          unread_count: unreadRes.count ?? 0,
        }
      })
    )

    res.json(enriched)
  } catch (err) {
    next(err)
  }
})

async function assertParticipant(conversationId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('conversations')
    .select('user_a_id, user_b_id')
    .eq('id', conversationId)
    .maybeSingle()

  if (!data) return false
  return data.user_a_id === userId || data.user_b_id === userId
}

// GET /api/conversations/:id — conversation header + last 50 messages
router.get('/:id', async (req, res, next) => {
  try {
    const me = req.user!.id
    const ok = await assertParticipant(req.params.id, me)
    if (!ok) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    const { data: convo } = await supabase
      .from('conversations')
      .select(`
        id, user_a_id, user_b_id, last_message_at, created_at,
        user_a:profiles!conversations_user_a_id_fkey(id, username, steam_persona, steam_avatar),
        user_b:profiles!conversations_user_b_id_fkey(id, username, steam_persona, steam_avatar)
      `)
      .eq('id', req.params.id)
      .single()

    const { data: messages } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(50)

    res.json({ conversation: convo, messages: (messages ?? []).reverse() })
  } catch (err) {
    next(err)
  }
})

// GET /api/conversations/:id/messages?before=ISO&limit=N — older message page
router.get('/:id/messages', async (req, res, next) => {
  try {
    const me = req.user!.id
    const ok = await assertParticipant(req.params.id, me)
    if (!ok) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    const parsed = MessageHistoryQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues })
      return
    }
    const { before, limit } = parsed.data

    let query = supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (before) {
      query = query.lt('created_at', before)
    }

    const { data, error } = await query
    if (error) {
      res.status(400).json({ error: error.message })
      return
    }

    res.json((data ?? []).reverse())
  } catch (err) {
    next(err)
  }
})

// POST /api/conversations/:id/messages — send message
router.post('/:id/messages', validate(SendMessageSchema), async (req, res, next) => {
  try {
    const me = req.user!.id
    const ok = await assertParticipant(req.params.id, me)
    if (!ok) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    const { data, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: req.params.id,
        sender_id: me,
        body: req.body.body,
        kind: 'user',
      })
      .select()
      .single()

    if (error) {
      res.status(400).json({ error: error.message })
      return
    }

    res.status(201).json(data)
  } catch (err) {
    next(err)
  }
})

// POST /api/conversations/:id/steam-trade-url-reminder
// Posts a templated system message asking the counterparty to add their
// Steam trade URL. Used by the Send-on-Steam CTA when the counterparty's URL
// is missing — we can't fix it for them, but we can surface a one-click ping.
//
// Server-controlled body (clients cannot author arbitrary system messages):
// the kind is forced to 'system' and the wording is templated here so the
// chat record is auditable and consistent.
router.post('/:id/steam-trade-url-reminder', async (req, res, next) => {
  try {
    const me = req.user!.id
    const ok = await assertParticipant(req.params.id, me)
    if (!ok) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    const { data: convo } = await supabase
      .from('conversations')
      .select('user_a_id, user_b_id')
      .eq('id', req.params.id)
      .single()
    if (!convo) {
      res.status(404).json({ error: 'Conversation not found' })
      return
    }
    const counterparty = convo.user_a_id === me ? convo.user_b_id : convo.user_a_id

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, steam_persona, username')
      .in('id', [me, counterparty])

    const nameOf = (uid: string) => {
      const p = profiles?.find((x) => x.id === uid)
      return p?.steam_persona ?? p?.username ?? 'Trader'
    }

    const body =
      `${nameOf(me)} tried to send a Steam trade but ${nameOf(counterparty)}'s ` +
      `trade URL isn't set up yet. Add it on your profile to receive trades.`

    const { data, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: req.params.id,
        sender_id: me,
        body,
        kind: 'system',
      })
      .select()
      .single()

    if (error) {
      res.status(400).json({ error: error.message })
      return
    }
    res.status(201).json(data)
  } catch (err) {
    next(err)
  }
})

// POST /api/conversations/:id/read — mark all messages in this conversation as read for the caller
router.post('/:id/read', async (req, res, next) => {
  try {
    const me = req.user!.id
    const ok = await assertParticipant(req.params.id, me)
    if (!ok) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    const { error } = await supabase
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('conversation_id', req.params.id)
      .neq('sender_id', me)
      .is('read_at', null)

    if (error) {
      res.status(400).json({ error: error.message })
      return
    }

    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router

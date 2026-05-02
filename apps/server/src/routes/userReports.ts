import { Router } from 'express'
import { supabase } from '../lib/supabase'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { FileReportSchema } from '../schemas/traderNetwork'

const router = Router()
router.use(authenticate)

// POST /api/reports
// File a report against another user. Optionally tied to a proposal or conversation.
router.post('/', validate(FileReportSchema), async (req, res, next) => {
  try {
    const me = req.user!.id
    const body = req.body as {
      subject_user_id: string
      proposal_id?: string
      conversation_id?: string
      reason: string
    }

    if (body.subject_user_id === me) {
      res.status(400).json({ error: 'Cannot report yourself' })
      return
    }

    // If a proposal_id is supplied, verify the reporter is a participant
    if (body.proposal_id) {
      const { data: proposal } = await supabase
        .from('trade_proposals')
        .select('creator_id, recipient_id')
        .eq('id', body.proposal_id)
        .maybeSingle()

      if (!proposal) {
        res.status(404).json({ error: 'Proposal not found' })
        return
      }
      if (proposal.creator_id !== me && proposal.recipient_id !== me) {
        res.status(403).json({ error: 'Forbidden' })
        return
      }
    }

    // If a conversation_id is supplied, verify the reporter is a participant
    if (body.conversation_id) {
      const { data: convo } = await supabase
        .from('conversations')
        .select('user_a_id, user_b_id')
        .eq('id', body.conversation_id)
        .maybeSingle()

      if (!convo) {
        res.status(404).json({ error: 'Conversation not found' })
        return
      }
      if (convo.user_a_id !== me && convo.user_b_id !== me) {
        res.status(403).json({ error: 'Forbidden' })
        return
      }
    }

    const { data, error } = await supabase
      .from('reports')
      .insert({
        reporter_id: me,
        subject_user_id: body.subject_user_id,
        proposal_id: body.proposal_id ?? null,
        conversation_id: body.conversation_id ?? null,
        reason: body.reason,
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

export default router

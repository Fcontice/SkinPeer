import { Router } from 'express'
import { z } from 'zod'
import { supabase } from '../lib/supabase'
import { authenticate } from '../middleware/authenticate'
import { requireAdmin } from '../middleware/requireAdmin'
import { validate } from '../middleware/validate'

const router = Router()
router.use(authenticate, requireAdmin)

// GET /api/admin/proposals — all trade proposals with optional status filter
router.get('/proposals', async (req, res, next) => {
  try {
    const { status, sort = 'created_at', order = 'desc', limit = '50' } = req.query as Record<string, string>

    let query = supabase
      .from('trade_proposals')
      .select('*, trade_items(*)')
      .order(sort, { ascending: order === 'asc' })
      .limit(parseInt(limit, 10))

    if (status) query = query.eq('status', status)

    const { data, error } = await query
    if (error) { res.status(400).json({ error: error.message }); return }
    res.json(data)
  } catch (err) { next(err) }
})

// GET /api/admin/reports — all reports with optional status filter
router.get('/reports', async (req, res, next) => {
  try {
    const { status = 'open' } = req.query as Record<string, string>

    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: false })

    if (error) { res.status(400).json({ error: error.message }); return }
    res.json(data)
  } catch (err) { next(err) }
})

const ResolveReportSchema = z.object({
  status: z.enum(['resolved', 'dismissed']),
})

// POST /api/admin/reports/:id — resolve or dismiss report
router.post('/reports/:id', validate(ResolveReportSchema), async (req, res, next) => {
  try {
    const { data: report, error } = await supabase
      .from('reports')
      .update({
        status: req.body.status,
        resolved_by: req.user!.id,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) { res.status(400).json({ error: error.message }); return }

    if (report.proposal_id) {
      await supabase.from('trade_activity_log').insert({
        proposal_id: report.proposal_id,
        actor_id: req.user!.id,
        action: 'report_resolved',
        metadata: { report_id: report.id, status: req.body.status },
      })
    }

    res.json(report)
  } catch (err) { next(err) }
})

const ToggleAdminSchema = z.object({
  is_admin: z.boolean(),
})

// PATCH /api/admin/users/:id — toggle admin flag
router.patch('/users/:id', validate(ToggleAdminSchema), async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .update({ is_admin: req.body.is_admin })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) { res.status(400).json({ error: error.message }); return }
    res.json(data)
  } catch (err) { next(err) }
})

export default router

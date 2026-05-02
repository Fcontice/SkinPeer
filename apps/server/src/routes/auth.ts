import { Router } from 'express'
import { z } from 'zod'
import { supabase } from '../lib/supabase'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'

const router = Router()

const ProfileSchema = z.object({
  username: z.string().min(2).max(30).regex(/^[a-zA-Z0-9_]+$/, 'Username must be alphanumeric'),
})

// POST /api/auth/profile — upsert profile username
router.post('/profile', authenticate, validate(ProfileSchema), async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .update({ username: req.body.username })
      .eq('id', req.user!.id)
      .select()
      .single()

    if (error) {
      res.status(400).json({ error: error.message })
      return
    }

    res.json(data)
  } catch (err) {
    next(err)
  }
})

// GET /api/auth/me — get own profile
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', req.user!.id)
      .single()

    if (error || !data) {
      res.status(404).json({ error: 'Profile not found' })
      return
    }

    res.json(data)
  } catch (err) {
    next(err)
  }
})

export default router

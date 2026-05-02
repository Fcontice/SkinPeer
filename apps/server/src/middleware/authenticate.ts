import { Request, Response, NextFunction } from 'express'
import { supabase } from '../lib/supabase'

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization
  const token = authHeader?.replace('Bearer ', '')

  if (!token) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { data: { user }, error } = await supabase.auth.getUser(token)

  if (error || !user) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  req.user = { id: user.id, email: user.email ?? '' }
  next()
}

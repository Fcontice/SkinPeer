import { Request, Response, NextFunction } from 'express'
import { supabase } from '../lib/supabase'

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', req.user.id)
    .single()

  if (!profile?.is_admin) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  req.isAdmin = true
  next()
}

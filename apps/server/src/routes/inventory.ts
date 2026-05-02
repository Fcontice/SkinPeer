import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { supabase } from '../lib/supabase'
import { fetchInventoryBySteamId } from '../lib/steam'

const router = Router()

router.get('/inventory', authenticate, async (req, res, next) => {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('steam_id')
      .eq('id', req.user!.id)
      .single()

    if (!profile?.steam_id) {
      res.status(400).json({ error: 'No Steam account linked' })
      return
    }

    const steamId = profile.steam_id

    // Check cache
    const { data: cached } = await supabase
      .from('steam_inventories')
      .select('items, fetched_at')
      .eq('user_id', req.user!.id)
      .single()

    if (cached) {
      const ageMs = Date.now() - new Date(cached.fetched_at).getTime()
      if (ageMs < 5 * 60 * 1000) {
        res.json({ items: cached.items, cached: true })
        return
      }
    }

    // Fetch from Steam
    let result
    try {
      result = await fetchInventoryBySteamId(steamId)
    } catch {
      res.status(502).json({ error: 'Failed to fetch Steam inventory' })
      return
    }

    if (result.is_private) {
      res.status(403).json({ error: 'Steam inventory is private' })
      return
    }

    const items = result.items

    await supabase.from('steam_inventories').upsert(
      { user_id: req.user!.id, steam_id: steamId, items, fetched_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )

    res.json({ items, cached: false })
  } catch (err) {
    next(err)
  }
})

export default router

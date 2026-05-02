import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { supabase } from '../lib/supabase'
import { fetchInventoryBySteamId } from '../lib/steam'

const router = Router()
router.use(authenticate)

router.get('/by-user/:user_id', async (req, res, next) => {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('steam_id')
      .eq('id', req.params.user_id)
      .maybeSingle()

    if (!profile?.steam_id) {
      res.status(404).json({ error: 'User has no linked Steam account' })
      return
    }
    const steamId = profile.steam_id

    const { data: cached } = await supabase
      .from('steam_inventory_cache')
      .select('items, is_private, fetched_at')
      .eq('steam_id', steamId)
      .maybeSingle()

    if (cached) {
      const age = Date.now() - new Date(cached.fetched_at).getTime()
      if (age < 5 * 60 * 1000) {
        res.json({ items: cached.items, is_private: cached.is_private, cached: true, fetched_at: cached.fetched_at })
        return
      }
    }

    let fetched
    try {
      fetched = await fetchInventoryBySteamId(steamId)
    } catch {
      res.status(502).json({ error: 'Failed to fetch Steam inventory' })
      return
    }
    const { items, is_private } = fetched
    const fetched_at = new Date().toISOString()
    await supabase
      .from('steam_inventory_cache')
      .upsert({ steam_id: steamId, items, is_private, fetched_at }, { onConflict: 'steam_id' })

    res.json({ items, is_private, cached: false, fetched_at })
  } catch (err) {
    next(err)
  }
})

export default router

import { Router } from 'express'
import { supabase } from '../lib/supabase'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { validateSteamWebApiToken } from '../lib/steamWebApiToken'
import {
  UpdateTraderProfileSchema,
  ListTradersQuerySchema,
  UpdateSteamTradeUrlSchema,
} from '../schemas/traderNetwork'

const router = Router()
router.use(authenticate)

// GET /api/traders/me/profile
// Returns own trader_profiles row. Auto-creates a default row on first call,
// seeded with display_name = profiles.steam_persona (or username fallback).
// Also returns the account-level steam_trade_url from profiles, since the
// edit-profile screen surfaces both together.
router.get('/me/profile', async (req, res, next) => {
  try {
    const userId = req.user!.id

    const { data: existing } = await supabase
      .from('trader_profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    if (existing) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('steam_trade_url, steam_webapi_token_secret_id')
        .eq('id', userId)
        .single()
      res.json({
        ...existing,
        steam_trade_url: profile?.steam_trade_url ?? null,
        has_steam_webapi_token: !!profile?.steam_webapi_token_secret_id,
      })
      return
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('steam_persona, username, steam_trade_url, steam_webapi_token_secret_id')
      .eq('id', userId)
      .single()

    const displayName = profile?.steam_persona ?? profile?.username ?? ''

    const { data: created, error } = await supabase
      .from('trader_profiles')
      .insert({ user_id: userId, display_name: displayName })
      .select()
      .single()

    if (error) {
      res.status(400).json({ error: error.message })
      return
    }

    res.status(201).json({
      ...created,
      steam_trade_url: profile?.steam_trade_url ?? null,
      has_steam_webapi_token: !!profile?.steam_webapi_token_secret_id,
    })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/traders/me/steam-trade-url
// Updates profiles.steam_trade_url and/or the optional Steam WebAPI token.
// Both fields are independently optional (Zod refines that at least one is
// present). The DB CHECK constraint on the URL enforces canonical format;
// Zod pre-validates so we return a clean 400 instead of a constraint-
// violation 23514. The token is validated against Steam before persisting:
//   - on token-only validation failure: URL still saves, response includes
//     `tokenError` and the token is NOT persisted
//   - on URL validation failure: handled by Zod (400)
// Plaintext token is round-tripped through vault.secrets via the
// set_steam_webapi_token RPC and never returned to the client.
router.patch('/me/steam-trade-url', validate(UpdateSteamTradeUrlSchema), async (req, res, next) => {
  try {
    const userId = req.user!.id
    const body = req.body as {
      steam_trade_url?: string | null
      steam_webapi_token?: string | null
    }

    if (body.steam_trade_url !== undefined) {
      const { error } = await supabase
        .from('profiles')
        .update({ steam_trade_url: body.steam_trade_url })
        .eq('id', userId)
      if (error) {
        res.status(400).json({ error: error.message })
        return
      }
    }

    let tokenError: string | null = null

    if (body.steam_webapi_token !== undefined) {
      if (body.steam_webapi_token === null) {
        const { error } = await supabase.rpc('clear_steam_webapi_token', {
          p_user_id: userId,
        })
        if (error) {
          res.status(400).json({ error: error.message })
          return
        }
      } else {
        const ok = await validateSteamWebApiToken(body.steam_webapi_token)
        if (!ok) {
          tokenError =
            "Token didn't work — double-check it's the most recent one from Steam."
        } else {
          const { error } = await supabase.rpc('set_steam_webapi_token', {
            p_user_id: userId,
            p_token: body.steam_webapi_token,
          })
          if (error) {
            res.status(400).json({ error: error.message })
            return
          }
        }
      }
    }

    const { data: profile, error: readErr } = await supabase
      .from('profiles')
      .select('steam_trade_url, steam_webapi_token_secret_id')
      .eq('id', userId)
      .single()
    if (readErr || !profile) {
      res.status(400).json({ error: readErr?.message ?? 'Profile not found' })
      return
    }

    res.json({
      steam_trade_url: profile.steam_trade_url ?? null,
      has_steam_webapi_token: !!profile.steam_webapi_token_secret_id,
      ...(tokenError ? { tokenError } : {}),
    })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/traders/me/steam-trade-url
// Clears both the Steam trade URL and the encrypted WebAPI token in one shot.
router.delete('/me/steam-trade-url', async (req, res, next) => {
  try {
    const userId = req.user!.id

    const { error: urlErr } = await supabase
      .from('profiles')
      .update({ steam_trade_url: null })
      .eq('id', userId)
    if (urlErr) {
      res.status(400).json({ error: urlErr.message })
      return
    }

    const { error: tokenErr } = await supabase.rpc('clear_steam_webapi_token', {
      p_user_id: userId,
    })
    if (tokenErr) {
      res.status(400).json({ error: tokenErr.message })
      return
    }

    res.json({ steam_trade_url: null, has_steam_webapi_token: false })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/traders/me/profile
router.patch('/me/profile', validate(UpdateTraderProfileSchema), async (req, res, next) => {
  try {
    const userId = req.user!.id

    const { data, error } = await supabase
      .from('trader_profiles')
      .update({ ...req.body, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .select()
      .single()

    if (error || !data) {
      res.status(400).json({ error: error?.message ?? 'Profile not found' })
      return
    }

    res.json(data)
  } catch (err) {
    next(err)
  }
})

// GET /api/traders
// List public, accepting traders. Sortable by rating | trades | recent.
router.get('/', async (req, res, next) => {
  try {
    const parsed = ListTradersQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues })
      return
    }
    const { search, sort, limit, offset } = parsed.data

    let query = supabase
      .from('trader_profiles')
      .select(`
        user_id, display_name, bio, accepting_trades, total_trades, average_rating, created_at,
        profile:profiles!trader_profiles_user_id_fkey(steam_avatar, steam_persona)
      `)
      .eq('is_public', true)
      .range(offset, offset + limit - 1)

    if (search) {
      query = query.ilike('display_name', `%${search}%`)
    }

    if (sort === 'rating') {
      query = query.order('average_rating', { ascending: false, nullsFirst: false })
    } else if (sort === 'trades') {
      query = query.order('total_trades', { ascending: false })
    } else {
      query = query.order('created_at', { ascending: false })
    }

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

// GET /api/traders/:userId
// Public profile lookup. 404 if profile is not public.
router.get('/:userId', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('trader_profiles')
      .select(`
        user_id, display_name, bio, trade_preferences, accepting_trades,
        total_trades, average_rating, created_at,
        profile:profiles!trader_profiles_user_id_fkey(steam_avatar, steam_persona)
      `)
      .eq('user_id', req.params.userId)
      .eq('is_public', true)
      .maybeSingle()

    if (error) {
      res.status(400).json({ error: error.message })
      return
    }

    if (!data) {
      res.status(404).json({ error: 'Trader not found' })
      return
    }

    res.json(data)
  } catch (err) {
    next(err)
  }
})

export default router

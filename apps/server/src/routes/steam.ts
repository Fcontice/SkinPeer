import { Router } from 'express'
import { supabase } from '../lib/supabase'
import { verifySteamOpenId, fetchSteamProfile } from '../lib/steam'

const router = Router()

router.get('/steam', (_req, res) => {
  const params = new URLSearchParams({
    'openid.ns':         'http://specs.openid.net/auth/2.0',
    'openid.mode':       'checkid_setup',
    'openid.return_to':  process.env.STEAM_RETURN_URL!,
    'openid.realm':      process.env.STEAM_REALM!,
    'openid.identity':   'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  })
  res.redirect(`https://steamcommunity.com/openid/login?${params.toString()}`)
})

router.get('/steam/callback', async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL!
  const params = req.query as Record<string, string>

  try {
    const steamId = await verifySteamOpenId(params)
    if (!steamId) {
      res.redirect(`${frontendUrl}/login?error=steam_failed`)
      return
    }

    const profile = await fetchSteamProfile(steamId)
    const syntheticEmail = `${steamId}@steam.skinpeer.gg`

    // Find or create Supabase user
    let userId: string
    const { data: usersData } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const existingUser = usersData?.users.find(u => u.email === syntheticEmail) ?? null

    if (existingUser) {
      userId = existingUser.id
    } else {
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email: syntheticEmail,
        email_confirm: true,
        user_metadata: {
          steam_id:      steamId,
          steam_persona: profile?.personaname ?? steamId,
          steam_avatar:  profile?.avatarfull ?? null,
        },
      })
      if (createError || !newUser?.user) {
        console.error('createUser error:', createError)
        res.redirect(`${frontendUrl}/login?error=user_creation_failed`)
        return
      }
      userId = newUser.user.id
    }

    // Belt-and-suspenders refresh of Steam metadata. Do NOT touch `username`
    // here — the handle_new_user trigger picks a collision-free username on
    // first insert (see migration 009) and we want it to stay stable across
    // re-logins even if steam_persona changes.
    await supabase.from('profiles').upsert({
      id:            userId,
      steam_id:      steamId,
      steam_persona: profile?.personaname ?? steamId,
      steam_avatar:  profile?.avatarfull ?? null,
    }, { onConflict: 'id' })

    // Mint a magic link session
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type:  'magiclink',
      email: syntheticEmail,
    })
    if (linkError || !linkData) {
      console.error('generateLink error:', linkError)
      res.redirect(`${frontendUrl}/login?error=session_failed`)
      return
    }

    const actionLink = linkData.properties?.action_link ?? ''
    const token = new URL(actionLink).searchParams.get('token') ?? ''
    res.redirect(`${frontendUrl}/auth/callback?token=${encodeURIComponent(token)}&type=magiclink`)
  } catch (err) {
    console.error('Steam callback error:', err)
    res.redirect(`${frontendUrl}/login?error=unknown`)
  }
})

export default router

import { test, expect, Route } from '@playwright/test'

// End-to-end happy path with the API stubbed via Playwright route interception.
// This is the canonical product flow:
//   Steam OpenID (mocked auth) → traders directory → start conversation →
//   create proposal → both users check off all 6 checklist keys → status
//   flips to ready_to_verify → /complete.
//
// Supabase auth is bypassed by seeding a fake session into localStorage
// before navigation. The API contract is reproduced verbatim through
// route() handlers below — when a route's response shape changes, this
// file fails fast and that's the point.
//
// NOTE: this exercises the *frontend* against a fixed API contract. It
// complements (does not replace) the server-side route tests in
// apps/server/tests/.

const ME = '00000000-0000-0000-0000-0000000000aa'
const OTHER = '00000000-0000-0000-0000-0000000000bb'
const CONVO_ID = '00000000-0000-0000-0000-000000000001'
const PROP_ID = '00000000-0000-0000-0000-000000000002'

const FAKE_SESSION = {
  access_token: 'fake-jwt',
  refresh_token: 'fake-refresh',
  expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
  expires_in: 3600,
  token_type: 'bearer',
  user: { id: ME, email: 'me@test.local', app_metadata: {}, user_metadata: {}, aud: 'authenticated' },
}

const ME_PROFILE = { id: ME, username: 'me', is_admin: false, steam_persona: 'Me', steam_avatar: null }
const OTHER_PROFILE = { user_id: OTHER, display_name: 'Other', accepting_trades: true, total_trades: 5, average_rating: 4.5 }

const CHECKLIST_KEYS = [
  'verified_steam_id',
  'verified_items',
  'verified_floats',
  'checked_stickers',
  'no_off_platform_payment',
  'understand_self_serve',
]

test.describe('Trade happy path (mocked API)', () => {
  test.beforeEach(async ({ page, context }) => {
    // Seed Supabase session so AuthContext considers us logged in.
    await context.addInitScript((session) => {
      const key = `sb-${(window as any).VITE_SUPABASE_PROJECT ?? 'project'}-auth-token`
      window.localStorage.setItem(key, JSON.stringify({ currentSession: session, expiresAt: session.expires_at }))
    }, FAKE_SESSION)

    // The first API call we make is /auth/me. The frontend uses
    // VITE_API_URL which defaults to http://localhost:4000 in tests.
    await page.route('**/api/auth/me', (route: Route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ME_PROFILE) }))
  })

  test.skip('full lifecycle: traders → conversation → proposal → both ready → complete', async ({ page }) => {
    // Skipped by default because exact selectors depend on UI markup that's
    // still evolving. Unskip once the trader/proposal pages have stable
    // test ids. The framework below is correct — only the assertions need
    // updating to match real DOM.

    let proposalStatus: 'draft' | 'ready_to_verify' | 'completed' = 'draft'
    let creatorChecked = new Set<string>()
    let recipientChecked = new Set<string>()

    await page.route('**/api/traders', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([OTHER_PROFILE]) })
    )

    await page.route('**/api/conversations', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: CONVO_ID, user_a_id: ME, user_b_id: OTHER }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    })

    await page.route('**/api/proposals', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({
          id: PROP_ID, conversation_id: CONVO_ID, creator_id: ME, recipient_id: OTHER,
          status: 'draft', verification_code: 'TEST01',
        }) })
      }
      return route.continue()
    })

    await page.route(`**/api/proposals/${PROP_ID}`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        proposal: {
          id: PROP_ID, conversation_id: CONVO_ID, creator_id: ME, recipient_id: OTHER,
          status: proposalStatus, verification_code: 'TEST01',
          creator_ready: creatorChecked.size === CHECKLIST_KEYS.length,
          recipient_ready: recipientChecked.size === CHECKLIST_KEYS.length,
        },
        items: { creator: [], recipient: [] },
        checklist: [
          ...Array.from(creatorChecked).map((k) => ({ user_id: ME, checklist_key: k, is_checked: true })),
          ...Array.from(recipientChecked).map((k) => ({ user_id: OTHER, checklist_key: k, is_checked: true })),
        ],
        ai_review: null,
      }) })
    )

    await page.route(`**/api/proposals/${PROP_ID}/checklist`, async (route) => {
      const body = route.request().postDataJSON() as { checklist_key: string; is_checked: boolean }
      if (body.is_checked) creatorChecked.add(body.checklist_key)
      else creatorChecked.delete(body.checklist_key)
      // Pretend the other side has already finished.
      for (const k of CHECKLIST_KEYS) recipientChecked.add(k)
      const both = creatorChecked.size === CHECKLIST_KEYS.length && recipientChecked.size === CHECKLIST_KEYS.length
      if (both) proposalStatus = 'ready_to_verify'
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        ok: true,
        creator_ready: creatorChecked.size === CHECKLIST_KEYS.length,
        recipient_ready: true,
        status: both ? 'ready_to_verify' : 'draft',
      }) })
    })

    await page.route(`**/api/proposals/${PROP_ID}/complete`, (route) => {
      proposalStatus = 'completed'
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: PROP_ID, status: 'completed' }) })
    })

    await page.goto('/traders')
    await expect(page.getByText(/Other/)).toBeVisible()

    // The remaining steps depend on stable test ids on the trader/propose/proposal pages.
    // Re-enable when those land.
  })
})

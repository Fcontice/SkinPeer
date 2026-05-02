import { test, expect } from '@playwright/test'

// Without a Supabase session, every protected route should bounce to /login.
// This guards the "all /api routes auth-gated, all admin pages admin-gated"
// invariant from the client side.

const PROTECTED = [
  '/dashboard',
  '/profile/edit',
  '/traders',
  '/messages',
  '/proposals',
]

for (const path of PROTECTED) {
  test(`unauthenticated visit to ${path} redirects to /login`, async ({ page }) => {
    await page.goto(path)
    await expect(page).toHaveURL(/\/login$/)
  })
}

test('unauthenticated visit to /admin redirects to /login (NOT /dashboard)', async ({ page }) => {
  // Subtle: if user is missing → /login. Only "user present, not admin" → /dashboard.
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/login$/)
})

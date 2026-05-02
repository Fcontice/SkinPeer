import { test, expect } from '@playwright/test'

test.describe('Landing page (unauthenticated)', () => {
  test('renders the trust contract copy', async ({ page }) => {
    await page.goto('/')
    // Trust bar copy is part of the load-bearing safety contract.
    await expect(
      page.getByText("We don't hold your skins. We don't use bots. Steam trades happen directly between you.")
    ).toBeVisible()
  })

  test('exposes a Sign in entry point pointing at the Steam OpenID redirect', async ({ page }) => {
    await page.goto('/')
    const signIn = page.getByRole('link', { name: /sign in/i }).first()
    await expect(signIn).toBeVisible()
    const href = await signIn.getAttribute('href')
    expect(href).toMatch(/\/api\/auth\/steam$/)
  })

  test('does NOT contain forbidden marketing copy', async ({ page }) => {
    await page.goto('/')
    const text = (await page.locator('body').textContent()) ?? ''
    expect(text).not.toMatch(/guaranteed safe/i)
    expect(text).not.toMatch(/100% safe/i)
    // Affiliation disclaimers should be present, not affiliation claims.
    expect(text.toLowerCase()).not.toContain('official steam partner')
  })
})

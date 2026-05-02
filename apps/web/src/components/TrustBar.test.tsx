import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TrustBar } from './TrustBar'

// The trust-bar copy is a load-bearing user-facing safety contract — see
// CLAUDE.md "UI Rules". This test pins the exact wording so a future
// well-meaning copy edit can't soften the language without an explicit
// review of this assertion.
describe('TrustBar', () => {
  it('renders the exact safety contract copy', () => {
    render(<TrustBar />)
    expect(
      screen.getByText("We don't hold your skins. We don't use bots. Steam trades happen directly between you.")
    ).toBeInTheDocument()
  })

  it('the copy does not include forbidden phrases', () => {
    render(<TrustBar />)
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/guaranteed safe/i)
    expect(text).not.toMatch(/100% safe/i)
    expect(text).not.toMatch(/escrow/i)
  })
})

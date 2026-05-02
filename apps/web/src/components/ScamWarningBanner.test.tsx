import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ScamWarningBanner } from './ScamWarningBanner'

describe('ScamWarningBanner', () => {
  it('renders explicit scam warning copy mentioning the verification code', () => {
    render(<ScamWarningBanner />)
    expect(screen.getByText(/SCAM WARNING/i)).toBeInTheDocument()
    expect(screen.getByText(/verification code/i)).toBeInTheDocument()
  })

  it('uses explicit, action-oriented language ("cancel the trade", "do not")', () => {
    render(<ScamWarningBanner />)
    const text = document.body.textContent ?? ''
    expect(text).toMatch(/cancel the trade/i)
    expect(text).toMatch(/do not/i)
  })

  it('is non-dismissible — there is no close/dismiss button', () => {
    render(<ScamWarningBanner />)
    // The whole rule: the banner must not be dismissible.
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByLabelText(/close|dismiss/i)).toBeNull()
  })

  it('does not contain forbidden softening copy', () => {
    render(<ScamWarningBanner />)
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/guaranteed safe/i)
    // The CLAUDE.md UI rule explicitly bans vague "Something went wrong" style messages.
    expect(text).not.toMatch(/something went wrong/i)
  })
})

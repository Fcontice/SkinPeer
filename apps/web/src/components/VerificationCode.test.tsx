import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VerificationCode } from './VerificationCode'

describe('VerificationCode', () => {
  it('renders the code in monospace at large size', () => {
    render(<VerificationCode code="ABC123" />)
    const codeEl = screen.getByText('ABC123')
    expect(codeEl).toBeInTheDocument()
    // The "font-mono text-3xl" classes are part of the visual contract.
    expect(codeEl.className).toMatch(/font-mono/)
    expect(codeEl.className).toMatch(/text-3xl/)
  })

  it('exposes a copy button labeled "Copy Code"', () => {
    render(<VerificationCode code="ABC123" />)
    expect(screen.getByRole('button', { name: /copy code/i })).toBeInTheDocument()
  })

  it('writes the code to the clipboard on click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      writable: true, configurable: true, value: { writeText },
    })

    render(<VerificationCode code="DEFXYZ" />)
    await userEvent.click(screen.getByRole('button', { name: /copy code/i }))

    expect(writeText).toHaveBeenCalledWith('DEFXYZ')
  })

  it('shows a "Copied!" confirmation after click', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      writable: true, configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })

    render(<VerificationCode code="GHI789" />)
    await userEvent.click(screen.getByRole('button', { name: /copy code/i }))

    expect(screen.getByRole('button')).toHaveTextContent(/copied/i)
  })

  it('reminds the user to compare the code via a separate channel', () => {
    render(<VerificationCode code="JKL012" />)
    const text = document.body.textContent ?? ''
    expect(text).toMatch(/separate channel|aloud/i)
    expect(text).toMatch(/stop the trade/i)
  })
})

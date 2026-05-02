import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { PriceProvider, usePrices } from './PriceContext'

const apiFetchMock = vi.fn()
vi.mock('../lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}))

function wrapper({ children }: { children: React.ReactNode }) {
  return <PriceProvider>{children}</PriceProvider>
}

describe('PriceProvider / usePrices', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts with no cached prices — get returns null', () => {
    const { result } = renderHook(() => usePrices(), { wrapper })
    expect(result.current.get('AK-47')).toBeNull()
  })

  it('fetches a price the first time ensure() is called and exposes it via get()', async () => {
    apiFetchMock.mockResolvedValue({
      market_hash_name: 'AK-47',
      lowest_price: '$10.00',
      median_price: '$10.50',
      volume: '500',
      source: 'steam_community_market',
      fetched_at: new Date().toISOString(),
    })

    const { result } = renderHook(() => usePrices(), { wrapper })
    act(() => { result.current.ensure(['AK-47']) })
    await waitFor(() => expect(result.current.get('AK-47')).not.toBeNull())
    expect(result.current.get('AK-47')?.source).toBe('steam_community_market')
  })

  it('does not refetch when ensure() is called again with the same name', async () => {
    apiFetchMock.mockResolvedValue({
      market_hash_name: 'X', lowest_price: '$1.00', median_price: null, volume: null,
      source: 'steam_community_market', fetched_at: new Date().toISOString(),
    })

    const { result } = renderHook(() => usePrices(), { wrapper })
    act(() => { result.current.ensure(['X']) })
    await waitFor(() => expect(result.current.get('X')).not.toBeNull())

    apiFetchMock.mockClear()
    act(() => { result.current.ensure(['X']) })
    expect(apiFetchMock).not.toHaveBeenCalled()
  })

  it('skips empty-string names', async () => {
    const { result } = renderHook(() => usePrices(), { wrapper })
    act(() => { result.current.ensure(['']) })
    expect(apiFetchMock).not.toHaveBeenCalled()
  })

  it('does not retry a name that previously failed (within session)', async () => {
    apiFetchMock.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => usePrices(), { wrapper })
    act(() => { result.current.ensure(['Boom']) })
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled())

    apiFetchMock.mockClear()
    apiFetchMock.mockResolvedValue({} as never)
    act(() => { result.current.ensure(['Boom']) })
    expect(apiFetchMock).not.toHaveBeenCalled()
  })
})

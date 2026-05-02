import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSupabaseStub } from './helpers/mockSupabase'

describe('getMarketPrice', () => {
  let s: ReturnType<typeof createSupabaseStub>

  beforeEach(() => {
    s = createSupabaseStub()
    vi.resetModules()
    vi.doMock('../src/lib/supabase', () => ({ supabase: s.client }))
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('returns cached price when fresh', async () => {
    s.push({
      data: {
        market_hash_name: 'AK-47 | Redline (Field-Tested)',
        lowest_price: '$10.00',
        median_price: '$10.50',
        volume: '500',
        source: 'steam_community_market',
        fetched_at: new Date().toISOString(),
      },
    })
    const { getMarketPrice } = await import('../src/lib/marketPrice')
    const out = await getMarketPrice('AK-47 | Redline (Field-Tested)')
    expect(out?.lowest_price).toBe('$10.00')
  })

  it('fetches from Steam on cache miss', async () => {
    s.push({ data: null })
    s.push({ data: null })
    global.fetch = vi.fn(async () =>
      ({ ok: true, json: async () => ({ success: true, lowest_price: '$1.00', median_price: '$1.50', volume: '10' }) }) as Response
    ) as any
    const { getMarketPrice } = await import('../src/lib/marketPrice')
    const out = await getMarketPrice('Glock-18 | Water Elemental (Minimal Wear)')
    expect(out?.lowest_price).toBe('$1.00')
    expect(global.fetch).toHaveBeenCalledOnce()
    expect(s._calls.some((c) => c.op === 'upsert')).toBe(true)
  })

  it('falls back to stale cache when Steam fails', async () => {
    s.push({
      data: {
        market_hash_name: 'X', lowest_price: '$2.00', median_price: null, volume: null,
        source: 'steam_community_market', fetched_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
    })
    global.fetch = vi.fn(async () => ({ ok: false, status: 500 }) as Response) as any
    const { getMarketPrice } = await import('../src/lib/marketPrice')
    const out = await getMarketPrice('X')
    expect(out?.lowest_price).toBe('$2.00')
  })
})

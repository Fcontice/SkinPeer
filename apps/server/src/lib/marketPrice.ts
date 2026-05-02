import { supabase } from './supabase'

export interface MarketPrice {
  market_hash_name: string
  lowest_price: string | null
  median_price: string | null
  volume: string | null
  source: string
  fetched_at: string
}

const CACHE_TTL_MS = 30 * 60 * 1000 // 30 minutes

export async function getMarketPrice(name: string): Promise<MarketPrice | null> {
  const { data: cached } = await supabase
    .from('steam_market_prices')
    .select('*')
    .eq('market_hash_name', name)
    .maybeSingle()

  if (cached) {
    const age = Date.now() - new Date(cached.fetched_at).getTime()
    if (age < CACHE_TTL_MS) return cached as MarketPrice
  }

  const fresh = await fetchFromSteam(name)
  if (!fresh) return cached as MarketPrice | null

  const fetched_at = new Date().toISOString()
  await supabase
    .from('steam_market_prices')
    .upsert(
      {
        market_hash_name: name,
        lowest_price: fresh.lowest_price ?? null,
        median_price: fresh.median_price ?? null,
        volume: fresh.volume ?? null,
        source: 'steam_community_market',
        fetched_at,
      },
      { onConflict: 'market_hash_name' }
    )

  return {
    market_hash_name: name,
    lowest_price: fresh.lowest_price ?? null,
    median_price: fresh.median_price ?? null,
    volume: fresh.volume ?? null,
    source: 'steam_community_market',
    fetched_at,
  }
}

interface SteamPriceResponse {
  success?: boolean
  lowest_price?: string
  median_price?: string
  volume?: string
}

async function fetchFromSteam(name: string): Promise<SteamPriceResponse | null> {
  const url =
    `https://steamcommunity.com/market/priceoverview/?appid=730&currency=1` +
    `&market_hash_name=${encodeURIComponent(name)}`
  const res = await fetch(url, { headers: { 'User-Agent': 'SkinPeer/1.0' } })
  if (!res.ok) return null
  const json = (await res.json()) as SteamPriceResponse
  if (!json.success) return null
  return json
}

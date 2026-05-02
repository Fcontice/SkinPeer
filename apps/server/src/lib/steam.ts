const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login'

export async function verifySteamOpenId(
  params: Record<string, string>
): Promise<string | null> {
  const verifyParams = { ...params, 'openid.mode': 'check_authentication' }
  const body = new URLSearchParams(verifyParams).toString()

  const res = await fetch(STEAM_OPENID_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  const text = await res.text()
  if (!text.includes('is_valid:true')) return null

  const claimedId = params['openid.claimed_id'] ?? ''
  const match = claimedId.match(/\/id\/(\d+)$/)
  return match ? match[1] : null
}

export async function fetchSteamProfile(steamId: string): Promise<SteamPlayer | null> {
  const apiKey = process.env.STEAM_API_KEY
  const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${apiKey}&steamids=${steamId}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Steam API error: ${res.status}`)
  const data = await res.json() as { response: { players: SteamPlayer[] } }
  return data.response.players[0] ?? null
}

export interface SteamPlayer {
  steamid: string
  personaname: string
  avatarfull: string
  profileurl: string
}

export interface InventoryItem {
  asset_id:    string
  class_id:    string
  name:        string
  icon_url:    string
  wear:        string | null
  rarity:      string | null
  type:        string | null
  tradable:    boolean
  marketable:  boolean
}

interface SteamTag { category: string; localized_tag_name: string }
interface SteamDesc {
  classid: string; instanceid: string; market_hash_name: string
  icon_url: string; tags: SteamTag[]; tradable: number; marketable: number
}
interface SteamAsset { assetid: string; classid: string; instanceid: string }
interface SteamInventoryRaw { assets: SteamAsset[]; descriptions: SteamDesc[] }

export function parseSteamInventory(raw: SteamInventoryRaw): InventoryItem[] {
  const descMap = new Map<string, SteamDesc>()
  for (const d of raw.descriptions ?? []) {
    descMap.set(`${d.classid}_${d.instanceid}`, d)
  }

  const items: InventoryItem[] = []
  for (const asset of raw.assets ?? []) {
    const desc = descMap.get(`${asset.classid}_${asset.instanceid}`)
    if (!desc) continue
    const tag = (cat: string) =>
      desc.tags?.find(t => t.category === cat)?.localized_tag_name ?? null

    items.push({
      asset_id:   asset.assetid,
      class_id:   asset.classid,
      name:       desc.market_hash_name,
      icon_url:   `https://community.cloudflare.steamstatic.com/economy/image/${desc.icon_url}`,
      wear:       tag('Exterior'),
      rarity:     tag('Rarity'),
      type:       tag('Type'),
      tradable:   desc.tradable === 1,
      marketable: desc.marketable === 1,
    })
  }
  return items
}

export interface InventoryFetchResult {
  items: InventoryItem[]
  is_private: boolean
}

export async function fetchInventoryBySteamId(steamId: string): Promise<InventoryFetchResult> {
  const res = await fetch(
    `https://steamcommunity.com/inventory/${steamId}/730/2?l=english&count=500`,
    { headers: { 'User-Agent': 'SkinPeer/1.0' } }
  )
  if (res.status === 403) return { items: [], is_private: true }
  if (!res.ok) throw new Error(`Steam inventory error: ${res.status}`)
  const raw = (await res.json()) as Parameters<typeof parseSteamInventory>[0]
  return { items: parseSteamInventory(raw), is_private: false }
}

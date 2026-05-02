// Server-side copy of the Steam trade URL parser.
// Mirrors packages/shared/src/steamTradeUrl.ts; kept local because apps/server
// has rootDir: src and cannot import outside its own tree.

export interface ParsedSteamTradeUrl {
  partner: string
  token: string
}

const PARTNER_RE = /^[0-9]+$/
const TOKEN_RE = /^[A-Za-z0-9_-]+$/

export function parseSteamTradeUrl(input: unknown): ParsedSteamTradeUrl | null {
  if (typeof input !== 'string' || input.length === 0) return null

  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }

  if (url.protocol !== 'https:') return null
  if (url.hostname !== 'steamcommunity.com') return null
  if (url.pathname !== '/tradeoffer/new/') return null

  const partner = url.searchParams.get('partner')
  const token = url.searchParams.get('token')
  if (!partner || !PARTNER_RE.test(partner)) return null
  if (!token || !TOKEN_RE.test(token)) return null

  return { partner, token }
}

export function isValidSteamTradeUrl(input: unknown): boolean {
  return parseSteamTradeUrl(input) !== null
}

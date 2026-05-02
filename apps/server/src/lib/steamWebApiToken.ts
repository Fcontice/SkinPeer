// Helpers for the optional per-user Steam WebAPI token.
// The token is a long-lived string the user copies from
// https://steamcommunity.com/pointssummary/ajaxgetasyncconfig — it
// authenticates as the user against the IEconService endpoints, which
// expose recently-acquired items the public /inventory/ endpoint does not.
//
// We never store the plaintext on profiles. set_steam_webapi_token /
// clear_steam_webapi_token RPCs (see migration 008) round-trip it through
// vault.secrets, returning only a uuid pointer.

const STEAM_VALIDATION_URL =
  'https://api.steampowered.com/IEconService/GetTradeOffersSummary/v1/'

// Pings Steam with the candidate token and returns true iff Steam accepts it.
// We use GetTradeOffersSummary because it is cheap (no body, just counts) and
// requires the same auth as the inventory endpoints we'll eventually use.
export async function validateSteamWebApiToken(token: string): Promise<boolean> {
  const trimmed = token.trim()
  if (!trimmed) return false

  // Basic shape check before paying for a network round trip. Steam tokens
  // are JWT-shaped (three dot-separated base64url segments) — reject anything
  // obviously off so a typo doesn't rate-limit us.
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed)) {
    return false
  }

  const url = `${STEAM_VALIDATION_URL}?access_token=${encodeURIComponent(trimmed)}`
  let res: Response
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'SkinPeer/1.0' } })
  } catch {
    return false
  }

  // Steam returns 401 for invalid/expired tokens, 200 with JSON for valid.
  if (!res.ok) return false

  // Sanity-parse the body — Steam sometimes returns 200 with an empty body
  // for malformed requests.
  try {
    const body = (await res.json()) as { response?: unknown }
    return body.response !== undefined
  } catch {
    return false
  }
}

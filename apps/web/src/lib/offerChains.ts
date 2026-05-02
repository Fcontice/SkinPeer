import type { Message, TradeOffer } from '../types/traderNetwork'

export interface OfferChain {
  rootId: string
  offers: TradeOffer[]
  latest: TradeOffer
  anchorMessageId: string | null
}

export function buildOfferChains(
  offers: TradeOffer[],
  messages: Message[],
): OfferChain[] {
  if (offers.length === 0) return []

  const byId = new Map<string, TradeOffer>()
  for (const o of offers) byId.set(o.id, o)

  const rootCache = new Map<string, string>()
  function rootOf(id: string): string {
    if (rootCache.has(id)) return rootCache.get(id)!
    let cursor: TradeOffer | undefined = byId.get(id)
    const path: string[] = []
    while (cursor && cursor.parent_offer_id && byId.has(cursor.parent_offer_id)) {
      path.push(cursor.id)
      cursor = byId.get(cursor.parent_offer_id)
    }
    const root = cursor ? cursor.id : id
    for (const x of path) rootCache.set(x, root)
    rootCache.set(root, root)
    return root
  }

  const groups = new Map<string, TradeOffer[]>()
  for (const o of offers) {
    const r = rootOf(o.id)
    if (!groups.has(r)) groups.set(r, [])
    groups.get(r)!.push(o)
  }

  const messageByOfferId = new Map<string, Message>()
  for (const m of messages) {
    if (m.kind !== 'trade_offer') continue
    const oid = (m.metadata as { offer_id?: string } | null)?.offer_id
    if (!oid) continue
    messageByOfferId.set(oid, m)
  }

  const chains: OfferChain[] = []
  for (const [rootId, list] of groups) {
    list.sort((a, b) => a.created_at.localeCompare(b.created_at))
    let anchorMessageId: string | null = null
    let anchorTs = ''
    for (const o of list) {
      const m = messageByOfferId.get(o.id)
      if (m && m.created_at >= anchorTs) { anchorMessageId = m.id; anchorTs = m.created_at }
    }
    chains.push({ rootId, offers: list, latest: list[list.length - 1], anchorMessageId })
  }
  return chains
}

export function parsePrice(raw: string | null | undefined): number {
  if (!raw) return 0
  const stripped = raw.replace(/[^\d.,]/g, '')
  const lastDot = stripped.lastIndexOf('.')
  const lastComma = stripped.lastIndexOf(',')
  let normalized: string
  if (lastDot === -1 && lastComma === -1) normalized = stripped
  else if (lastDot > lastComma) normalized = stripped.replace(/,/g, '')
  else normalized = stripped.replace(/\./g, '').replace(',', '.')
  const n = parseFloat(normalized)
  return Number.isFinite(n) ? n : 0
}

export function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`
}

export function fmtDelta(n: number): string {
  if (Math.abs(n) < 0.005) return '$0.00'
  return `${n >= 0 ? '+' : '−'}$${Math.abs(n).toFixed(2)}`
}

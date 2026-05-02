// scripts/smoke-accept-flow.ts
//
// Run against a running dev server with two test users that have a conversation.
// Usage:  pnpm tsx scripts/smoke-accept-flow.ts --a-token=... --b-token=... --conv=<id>
//
// The script:
//   1. A creates an offer (1 requested, 1 offered)
//   2. B accepts → expects 200 with proposal_id + verification_code
//   3. GET /api/proposals/<id> as B → expects creator/recipient ids match, items split correctly
//   4. Both fill checklist via existing route → proposal flips to 'ready_to_verify'
//
// Pass criteria: every step prints OK; failure prints the response body and exits 1.

import { setTimeout as wait } from 'node:timers/promises'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=')
    return [k, v.join('=')]
  })
)
const A = args['a-token']
const B = args['b-token']
const CONV = args['conv']
const BASE = args['base'] ?? 'http://localhost:4000'
if (!A || !B || !CONV) { console.error('Required: --a-token --b-token --conv'); process.exit(2) }

async function call(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

const ITEM = (id: string) => ({
  asset_id: id, class_id: 'fake', name: `Test Item ${id}`, icon_url: 'https://x',
  wear: null, rarity: null, type: null, tradable: true, marketable: true,
})

async function main() {
  console.log('1. A creates offer')
  const create = await call(A, 'POST', '/offers', {
    conversation_id: CONV,
    requested_items: [ITEM('r1')],
    offered_items: [ITEM('a1')],
  })
  console.log('   status', create.status); if (create.status !== 201) { console.error(create.body); process.exit(1) }
  const offerId = create.body.id
  console.log('   offer', offerId)

  await wait(200)

  console.log('2. B accepts')
  const acc = await call(B, 'POST', `/offers/${offerId}/accept`)
  if (acc.status !== 200) { console.error(acc.body); process.exit(1) }
  const proposalId = acc.body.proposal_id
  console.log('   proposal', proposalId, 'code', acc.body.verification_code)

  console.log('3. GET proposal as B')
  const view = await call(B, 'GET', `/proposals/${proposalId}`)
  if (view.status !== 200) { console.error(view.body); process.exit(1) }
  const items = view.body.items
  if (items.creator.length !== 1 || items.recipient.length !== 1) {
    console.error('items split wrong:', items); process.exit(1)
  }
  console.log('   items split OK')

  console.log('4. Both fill checklist')
  const KEYS = ['verified_steam_id','verified_items','verified_floats','checked_stickers','no_off_platform_payment','understand_self_serve']
  for (const tok of [A, B]) {
    for (const k of KEYS) {
      const r = await call(tok, 'POST', `/proposals/${proposalId}/checklist`, { checklist_key: k, is_checked: true })
      if (r.status !== 200) { console.error('checklist', k, r.body); process.exit(1) }
    }
  }
  const final = await call(B, 'GET', `/proposals/${proposalId}`)
  if (final.body.proposal.status !== 'ready_to_verify') { console.error('expected ready_to_verify, got', final.body.proposal.status); process.exit(1) }
  console.log('   proposal status: ready_to_verify ✓')

  console.log('SMOKE OK')
}

main().catch((e) => { console.error(e); process.exit(1) })

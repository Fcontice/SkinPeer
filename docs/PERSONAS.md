# SkinPeer — User Personas

These three personas anchor every design and copy decision. They are derived from the actual CS2 trading community and the threat model the product addresses.

---

## Persona 1 — "Trader Tom" (the high-volume veteran)

| Attribute | Detail |
|---|---|
| Age | 24 |
| Steam tenure | 8 years, 2,000+ hours in CS2 |
| Trades per month | 30–60 |
| Inventory value | $4,000+ |
| Tech comfort | High |
| Devices | Desktop primary, Steam mobile authenticator always on |

**Goals**
- Find serious trade partners quickly without wading through scammers and lowballers.
- Build a public reputation that other traders can trust at a glance.
- Lock in trade terms in writing before opening Steam, so a counterparty can't change items at the last second.

**Frustrations**
- Discord scammers impersonating known traders ("middleman scams").
- The same five questions every trade ("Do you have the same float? Is the sticker original?").
- Traders going silent after agreeing to terms.

**How SkinPeer helps Tom**
- Public trader profile with `total_trades` and `average_rating` lets him show his track record.
- The 6-char verification code printed on the proposal makes "right person, right items" verifiable inside the Steam mobile prompt.
- The structured proposal locks both sides to the items they listed — no surprise swap at confirmation.

**Anti-goals**
- Tom does **not** want SkinPeer to take a fee, hold his items, or insert a bot. He'd leave instantly.

---

## Persona 2 — "Cautious Casey" (the scam-wary newcomer)

| Attribute | Detail |
|---|---|
| Age | 17 |
| Steam tenure | 18 months |
| Trades per month | 1–3 |
| Inventory value | $80–150 (a single knife she saved up for) |
| Tech comfort | Medium |
| Devices | Mobile-first; uses Steam mobile authenticator |

**Goals**
- Make her first knife trade-up without losing the knife.
- Trade only with people who've successfully traded before.
- Have something to fall back on if a trade "feels weird."

**Frustrations**
- Has heard horror stories about API key scams and Steam trade-hold tricks.
- Doesn't know how to read a float value, sticker wear, or pattern index confidently.
- Steam Market mods are intimidating; she has only ever direct-traded once.

**How SkinPeer helps Casey**
- The 6-step safety checklist walks her through exactly what to verify before checking "Ready" — including "no off-platform payment" and "I understand SkinPeer is self-serve."
- The AI safety review (Claude Haiku 4.5) flags suspicious patterns like off-Steam payment requests or mismatched item value.
- The non-dismissible scam warning banner reminds her every time: *do not accept the trade if the verification code does not match.*
- A counterparty's `total_trades` and `average_rating` are visible before she opens a conversation.

**Anti-goals**
- Casey does **not** want SkinPeer to call itself "guaranteed safe" — overconfident UX makes her *more* nervous, not less. The product must read as a checklist, not a guarantee.

---

## Persona 3 — "Admin Ava" (the moderator)

| Attribute | Detail |
|---|---|
| Role | SkinPeer staff, part-time |
| Steam tenure | Long-time CS player |
| Volume | Reviews 10–30 reports per day at scale |
| Tech comfort | High |
| Auth | `profiles.is_admin = true`, set manually via SQL |

**Goals**
- Triage incoming reports quickly with enough context to make a fair call.
- Identify repeat offenders without manually correlating across conversations.
- Resolve disputes without taking sides on disputed item values (which SkinPeer explicitly does not adjudicate).

**Frustrations**
- Reports without context ("this guy's a scammer") that take hours to investigate.
- No paper trail of who confirmed what, when.
- Users asking her to "reverse the trade" — which is impossible because Steam owns the trade, not SkinPeer.

**How SkinPeer helps Ava**
- Every state change in a proposal is appended to `trade_activity_log` with actor and timestamp.
- A report carries optional `proposal_id` and `conversation_id` so she can pull the full thread in one click.
- The admin view at `/admin` lists all proposals with filters by status; `/admin/trade/:id` shows the full activity log.
- The product's public copy clearly states "self-serve, we coordinate, you trade" — so she can decline reverse-trade requests with a documented policy, not personal judgment.

**Anti-goals**
- Ava does **not** want a moderation queue with destructive actions. Her tools are: mark report resolved/dismissed, force-cancel a proposal, flip `accepting_trades` on a bad actor's profile. She does not need to delete users or rewrite history.

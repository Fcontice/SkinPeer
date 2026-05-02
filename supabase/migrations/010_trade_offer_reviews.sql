-- 010_trade_offer_reviews.sql
-- PR 3 — per-(offer, viewer) AI safety reviews surfaced in the chat AI panel
-- and on the proposal page. The viewer dimension is essential: fairness and
-- value_delta_usd are computed from the viewer's perspective, so the same
-- offer reviewed by sender vs recipient produces different payloads.
--
-- The existing ai_safety_reviews table is keyed on proposal_id and uses a
-- different output shape (risk_level + warnings + recommended_actions). We
-- keep that for backwards compatibility on TradeProposalPage; this new table
-- holds the richer, CS2-domain-aware reviews used by the chat panel.

create table public.trade_offer_reviews (
  id              uuid primary key default gen_random_uuid(),
  trade_offer_id  uuid not null references public.trade_offers(id) on delete cascade,
  viewer_user_id  uuid not null references public.profiles(id) on delete cascade,
  payload         jsonb not null,
  model           text  not null,
  created_at      timestamptz not null default now()
);

-- One review per (offer, viewer). A re-run upserts on this key.
create unique index trade_offer_reviews_offer_viewer_unique
  on public.trade_offer_reviews (trade_offer_id, viewer_user_id);

create index trade_offer_reviews_offer_idx
  on public.trade_offer_reviews (trade_offer_id);

-- 004_trade_offers.sql
-- Pull-based trade offer layer in front of trade_proposals.
-- An accepted offer materializes a trade_proposals row + trade_items.
-- Pre-launch MVP — no production data preserved.

-- =====================================================================
-- trade_offers — pending pull-based offer between two users in a thread
-- =====================================================================

create table public.trade_offers (
  id                     uuid primary key default gen_random_uuid(),
  conversation_id        uuid not null references public.conversations(id) on delete cascade,
  from_user_id           uuid not null references public.profiles(id) on delete cascade,
  to_user_id             uuid not null references public.profiles(id) on delete cascade,
  -- requested_items: items from to_user_id's inventory that from_user wants to receive
  -- offered_items:   items from from_user_id's inventory that from_user is offering
  -- Each entry is the InventoryItem shape from apps/server/src/lib/steam.ts
  requested_items        jsonb not null default '[]'::jsonb,
  offered_items          jsonb not null default '[]'::jsonb,
  status                 text  not null default 'pending'
                            check (status in ('pending','accepted','rejected','withdrawn','countered')),
  parent_offer_id        uuid references public.trade_offers(id) on delete set null,
  resulting_proposal_id  uuid references public.trade_proposals(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint trade_offers_users_distinct check (from_user_id <> to_user_id),
  constraint trade_offers_items_nonempty
    check (jsonb_array_length(requested_items) > 0 or jsonb_array_length(offered_items) > 0)
);

create index trade_offers_conversation_idx on public.trade_offers (conversation_id, created_at desc);
create index trade_offers_from_user_idx    on public.trade_offers (from_user_id);
create index trade_offers_to_user_idx      on public.trade_offers (to_user_id);
create index trade_offers_status_idx       on public.trade_offers (status);

-- Enforce: at most one pending offer per (thread, sender → recipient) direction.
-- A counter goes the OTHER direction so it does not collide with this index.
create unique index trade_offers_one_pending_per_direction
  on public.trade_offers (conversation_id, from_user_id, to_user_id)
  where status = 'pending';

-- Realtime: clients subscribe to offers in a conversation.
alter publication supabase_realtime add table public.trade_offers;

-- =====================================================================
-- messages.kind: add 'trade_offer' so the inbox card renders inline
-- =====================================================================

alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages
  add constraint messages_kind_check
  check (kind in ('user','system','trade_proposal_link','trade_offer'));

-- =====================================================================
-- steam_inventory_cache — shared cache keyed by steam_id
-- (separate from steam_inventories which is keyed by our user_id)
-- =====================================================================

create table if not exists public.steam_inventory_cache (
  steam_id    text primary key,
  items       jsonb not null default '[]'::jsonb,
  is_private  boolean not null default false,
  fetched_at  timestamptz not null default now()
);

-- =====================================================================
-- steam_market_prices — shared price cache from Steam Community Market
-- =====================================================================

create table if not exists public.steam_market_prices (
  market_hash_name text primary key,
  lowest_price     text,
  median_price     text,
  volume           text,
  source           text not null default 'steam_community_market',
  fetched_at       timestamptz not null default now()
);

create index steam_market_prices_fetched_idx on public.steam_market_prices (fetched_at);

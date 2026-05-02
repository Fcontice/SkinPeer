-- 003_trader_network.sql
-- Trader-network refactor — Phase 1 schema migration.
-- Replaces the trade-room data model with a directory + messenger + proposal model.
-- Pre-launch MVP, no production trade data preserved (per refactor plan).
--
-- RLS strategy:
--   ON  → conversations, messages, trade_proposals
--         (subscribed via Realtime with anon key + user JWT; need server-side
--         filter on the replication stream).
--   OFF → trader_profiles, trade_items, trade_checklist_items, trade_activity_log,
--         reports, reviews, ai_safety_reviews
--         (server-only access via service_role; service_role bypasses RLS;
--         no Realtime exposure planned).
-- Server REST routes always validate authorization explicitly via
-- middleware/authz.ts. RLS is defense-in-depth for Realtime, never the
-- primary check.

-- =====================================================================
-- DROP deprecated tables (reverse-FK order)
-- =====================================================================

-- Remove from Realtime publication before drop (publication FKs the table OID)
alter publication supabase_realtime drop table public.trade_items;
alter publication supabase_realtime drop table public.trade_confirmations;
alter publication supabase_realtime drop table public.trade_rooms;

drop table if exists public.activity_log cascade;
drop table if exists public.reports cascade;
drop table if exists public.trade_confirmations cascade;
drop table if exists public.trade_items cascade;
drop table if exists public.trade_rooms cascade;

-- =====================================================================
-- trader_profiles — opt-in directory entry
-- =====================================================================

create table public.trader_profiles (
  user_id           uuid primary key references public.profiles(id) on delete cascade,
  display_name      text not null default '',
  bio               text,
  trade_preferences text,
  accepting_trades  boolean not null default true,
  is_public         boolean not null default true,
  total_trades      integer not null default 0,
  average_rating    numeric(3,2),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index trader_profiles_is_public_accepting_idx
  on public.trader_profiles (is_public, accepting_trades);

-- =====================================================================
-- conversations — one per (user_a, user_b) pair, regardless of initiator
-- =====================================================================

create table public.conversations (
  id              uuid primary key default gen_random_uuid(),
  user_a_id       uuid not null references public.profiles(id) on delete cascade,
  user_b_id       uuid not null references public.profiles(id) on delete cascade,
  last_message_at timestamptz,
  created_at      timestamptz not null default now(),
  constraint conversations_users_distinct check (user_a_id <> user_b_id)
);

-- Pair uniqueness is order-independent: (LEAST, GREATEST) makes the index
-- match any direction the conversation was created from.
create unique index conversations_pair_unique
  on public.conversations (least(user_a_id, user_b_id), greatest(user_a_id, user_b_id));

create index conversations_user_a_idx on public.conversations (user_a_id);
create index conversations_user_b_idx on public.conversations (user_b_id);

-- =====================================================================
-- messages — chat thread; 'system' kind for trade_proposal_link entries
-- =====================================================================

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid not null references public.profiles(id) on delete cascade,
  body            text not null,
  kind            text not null default 'user'
                    check (kind in ('user','system','trade_proposal_link')),
  metadata        jsonb,
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index messages_conversation_created_idx
  on public.messages (conversation_id, created_at);
create index messages_sender_idx on public.messages (sender_id);

-- =====================================================================
-- ai_safety_reviews — created BEFORE trade_proposals so we can FK ai_review_id
-- =====================================================================

create table public.ai_safety_reviews (
  id                  uuid primary key default gen_random_uuid(),
  proposal_id         uuid not null,  -- FK added after trade_proposals exists
  requested_by        uuid not null references public.profiles(id) on delete cascade,
  risk_level          text not null check (risk_level in ('low','medium','high','critical')),
  warnings            jsonb not null default '[]',
  recommended_actions jsonb not null default '[]',
  model_used          text not null,
  input_summary       text,
  created_at          timestamptz not null default now()
);

create index ai_safety_reviews_proposal_idx on public.ai_safety_reviews (proposal_id);
create index ai_safety_reviews_requested_by_idx on public.ai_safety_reviews (requested_by);

-- =====================================================================
-- trade_proposals — replaces trade_rooms
-- =====================================================================

create table public.trade_proposals (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references public.conversations(id) on delete cascade,
  creator_id        uuid not null references public.profiles(id) on delete cascade,
  recipient_id      uuid not null references public.profiles(id) on delete cascade,
  status            text not null default 'draft'
                      check (status in ('draft','ready_to_verify','completed','cancelled','disputed')),
  verification_code text not null unique,
  creator_ready     boolean not null default false,
  recipient_ready   boolean not null default false,
  ai_review_id      uuid references public.ai_safety_reviews(id) on delete set null,
  completed_at      timestamptz,
  cancelled_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint trade_proposals_users_distinct check (creator_id <> recipient_id)
);

create index trade_proposals_conversation_idx on public.trade_proposals (conversation_id);
create index trade_proposals_creator_idx on public.trade_proposals (creator_id);
create index trade_proposals_recipient_idx on public.trade_proposals (recipient_id);
create index trade_proposals_status_idx on public.trade_proposals (status);

-- Now back-link ai_safety_reviews.proposal_id → trade_proposals.id
alter table public.ai_safety_reviews
  add constraint ai_safety_reviews_proposal_fk
  foreign key (proposal_id) references public.trade_proposals(id) on delete cascade;

-- =====================================================================
-- trade_items — recreated with new shape (proposal_id, steam_asset_id)
-- =====================================================================

create table public.trade_items (
  id             uuid primary key default gen_random_uuid(),
  proposal_id    uuid not null references public.trade_proposals(id) on delete cascade,
  owner_id       uuid not null references public.profiles(id) on delete cascade,
  name           text not null,
  wear           text,
  float_value    numeric(10,8),
  rarity         text,
  image_url      text,
  steam_asset_id text,
  created_at     timestamptz not null default now()
);

create index trade_items_proposal_idx on public.trade_items (proposal_id);
create index trade_items_owner_idx on public.trade_items (owner_id);

-- =====================================================================
-- trade_checklist_items — per (proposal, user, key); no schema change for new keys
-- =====================================================================

create table public.trade_checklist_items (
  id            uuid primary key default gen_random_uuid(),
  proposal_id   uuid not null references public.trade_proposals(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  checklist_key text not null,
  is_checked    boolean not null default false,
  checked_at    timestamptz,
  unique(proposal_id, user_id, checklist_key)
);

create index trade_checklist_items_proposal_idx on public.trade_checklist_items (proposal_id);
create index trade_checklist_items_user_idx on public.trade_checklist_items (user_id);

-- =====================================================================
-- trade_activity_log — replaces activity_log; proposal_id (not room_id)
-- =====================================================================

create table public.trade_activity_log (
  id          bigserial primary key,
  proposal_id uuid references public.trade_proposals(id) on delete cascade,
  actor_id    uuid references public.profiles(id) on delete set null,
  action      text not null,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

create index trade_activity_log_proposal_idx on public.trade_activity_log (proposal_id);
create index trade_activity_log_actor_idx on public.trade_activity_log (actor_id);

-- =====================================================================
-- reports — recreated with subject_user_id, optional proposal_id/conversation_id
-- =====================================================================

create table public.reports (
  id               uuid primary key default gen_random_uuid(),
  reporter_id      uuid not null references public.profiles(id) on delete cascade,
  subject_user_id  uuid references public.profiles(id) on delete set null,
  proposal_id      uuid references public.trade_proposals(id) on delete set null,
  conversation_id  uuid references public.conversations(id) on delete set null,
  reason           text not null,
  status           text not null default 'open'
                     check (status in ('open','resolved','dismissed')),
  resolved_by      uuid references public.profiles(id) on delete set null,
  resolution_notes text,
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz
);

create index reports_reporter_idx on public.reports (reporter_id);
create index reports_subject_user_idx on public.reports (subject_user_id);
create index reports_proposal_idx on public.reports (proposal_id);
create index reports_conversation_idx on public.reports (conversation_id);
create index reports_status_idx on public.reports (status);

-- =====================================================================
-- reviews — one per (proposal, reviewer)
-- =====================================================================

create table public.reviews (
  id              uuid primary key default gen_random_uuid(),
  proposal_id     uuid not null references public.trade_proposals(id) on delete cascade,
  reviewer_id     uuid not null references public.profiles(id) on delete cascade,
  subject_user_id uuid not null references public.profiles(id) on delete cascade,
  rating          integer not null check (rating between 1 and 5),
  comment         text,
  created_at      timestamptz not null default now(),
  unique(proposal_id, reviewer_id),
  constraint reviews_reviewer_not_subject check (reviewer_id <> subject_user_id)
);

create index reviews_proposal_idx on public.reviews (proposal_id);
create index reviews_reviewer_idx on public.reviews (reviewer_id);
create index reviews_subject_user_idx on public.reviews (subject_user_id);

-- =====================================================================
-- Triggers
-- =====================================================================

-- 1. messages.insert → conversations.last_message_at = new.created_at
create or replace function public.touch_conversation_last_message()
returns trigger language plpgsql as $$
begin
  update public.conversations
     set last_message_at = new.created_at
   where id = new.conversation_id;
  return new;
end;
$$;

create trigger messages_touch_conversation
  after insert on public.messages
  for each row execute procedure public.touch_conversation_last_message();

-- 2. reviews.insert → recompute trader_profiles.average_rating for subject_user_id
create or replace function public.recompute_trader_average_rating()
returns trigger language plpgsql as $$
declare
  avg_rating numeric(3,2);
begin
  select round(avg(rating)::numeric, 2)
    into avg_rating
    from public.reviews
   where subject_user_id = new.subject_user_id;

  update public.trader_profiles
     set average_rating = avg_rating,
         updated_at = now()
   where user_id = new.subject_user_id;

  return new;
end;
$$;

create trigger reviews_recompute_average
  after insert on public.reviews
  for each row execute procedure public.recompute_trader_average_rating();

-- 3. trade_proposals.update → if status flips to 'completed', increment total_trades
--    for both creator and recipient (only on the transition, not repeat updates).
create or replace function public.increment_total_trades_on_completion()
returns trigger language plpgsql as $$
begin
  if new.status = 'completed' and (old.status is distinct from 'completed') then
    update public.trader_profiles
       set total_trades = total_trades + 1,
           updated_at = now()
     where user_id in (new.creator_id, new.recipient_id);
  end if;
  return new;
end;
$$;

create trigger trade_proposals_increment_trades
  after update on public.trade_proposals
  for each row execute procedure public.increment_total_trades_on_completion();

-- =====================================================================
-- RLS — only on Realtime-exposed tables
-- =====================================================================

alter table public.conversations  enable row level security;
alter table public.messages       enable row level security;
alter table public.trade_proposals enable row level security;

-- conversations: participants only
create policy conversations_select on public.conversations
  for select to public
  using (auth.uid() = user_a_id or auth.uid() = user_b_id);

-- messages: visible to both participants of the parent conversation
create policy messages_select on public.messages
  for select to public
  using (exists (
    select 1 from public.conversations c
     where c.id = messages.conversation_id
       and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
  ));

-- trade_proposals: creator, recipient, or admins
create policy trade_proposals_select on public.trade_proposals
  for select to public
  using (
    auth.uid() = creator_id
    or auth.uid() = recipient_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

-- =====================================================================
-- Realtime publication — add the three subscribed tables
-- =====================================================================

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.trade_proposals;
alter publication supabase_realtime add table public.trade_checklist_items;

-- profiles: mirrors auth.users, created by trigger
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text unique not null,
  avatar_url   text,
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now()
);

-- trade rooms (with verification_code from architecture.md)
create table public.trade_rooms (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null,
  status              text not null default 'open'
                        check (status in ('open','pending','locked','completed','disputed','cancelled')),
  creator_id          uuid not null references public.profiles(id),
  invitee_id          uuid references public.profiles(id),
  invite_token        text unique,
  verification_code   text unique not null,
  locked_at           timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- trade confirmations (4-checkbox per user, replaces creator_confirmed/invitee_confirmed)
create table public.trade_confirmations (
  id                  uuid primary key default gen_random_uuid(),
  room_id             uuid not null references public.trade_rooms(id) on delete cascade,
  user_id             uuid not null references public.profiles(id),
  confirmed_profile   boolean not null default false,
  confirmed_items     boolean not null default false,
  confirmed_code      boolean not null default false,
  confirmed_mobile    boolean not null default false,
  ready               boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique(room_id, user_id)
);

-- trade items
create table public.trade_items (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.trade_rooms(id) on delete cascade,
  owner_id     uuid not null references public.profiles(id),
  name         text not null,
  float_value  numeric(10,8),
  wear         text,
  rarity       text,
  image_url    text,
  price_usd    numeric(10,2),
  created_at   timestamptz not null default now()
);

-- reports
create table public.reports (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.trade_rooms(id),
  reporter_id  uuid not null references public.profiles(id),
  reason       text not null,
  status       text not null default 'open'
                 check (status in ('open','resolved','dismissed')),
  resolved_by  uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);

-- activity log (append-only audit trail)
create table public.activity_log (
  id           bigserial primary key,
  room_id      uuid references public.trade_rooms(id),
  actor_id     uuid references public.profiles(id),
  action       text not null,
  metadata     jsonb,
  created_at   timestamptz not null default now()
);

-- auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, username, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1)),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Enable Realtime on key tables
alter publication supabase_realtime add table trade_rooms;
alter publication supabase_realtime add table trade_confirmations;
alter publication supabase_realtime add table trade_items;

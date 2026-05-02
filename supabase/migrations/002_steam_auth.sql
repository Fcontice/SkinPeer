-- Add Steam fields to profiles
alter table public.profiles
  add column if not exists steam_id      text unique,
  add column if not exists steam_persona text,
  add column if not exists steam_avatar  text;

-- Replace handle_new_user trigger to support Steam metadata
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, username, avatar_url, steam_id, steam_persona, steam_avatar)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'steam_persona',
      new.raw_user_meta_data->>'username',
      split_part(new.email, '@', 1)
    ),
    coalesce(new.raw_user_meta_data->>'steam_avatar', new.raw_user_meta_data->>'avatar_url'),
    new.raw_user_meta_data->>'steam_id',
    new.raw_user_meta_data->>'steam_persona',
    new.raw_user_meta_data->>'steam_avatar'
  )
  on conflict (id) do update set
    steam_id      = excluded.steam_id,
    steam_persona = excluded.steam_persona,
    steam_avatar  = excluded.steam_avatar,
    username      = coalesce(excluded.steam_persona, profiles.username);
  return new;
end;
$$;

-- Inventory cache table
create table if not exists public.steam_inventories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  steam_id   text not null,
  items      jsonb not null default '[]',
  fetched_at timestamptz not null default now(),
  unique(user_id)
);

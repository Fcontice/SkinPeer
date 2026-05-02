-- 009_handle_new_user_unique_username.sql
-- Steam personas are not unique — two distinct Steam accounts can share the
-- same display name (`xFrankus` and `xFrankus`). The previous handle_new_user
-- trigger used the persona directly as `profiles.username`, which is UNIQUE,
-- so the second Steam-OpenID login with a colliding persona failed:
--
--   ERROR: duplicate key value violates unique constraint "profiles_username_key"
--   → GoTrue surfaces this as 500 unexpected_failure on createUser
--
-- This migration:
--   1. Replaces the trigger with a collision-resilient version that appends
--      a numeric suffix (-1, -2, …) until it finds a free username.
--   2. Stops overwriting `username` on subsequent logins — usernames are now
--      stable for the life of the account, only steam_persona/avatar are
--      refreshed per login.
--
-- The username column stays UNIQUE (other code paths may rely on it as a
-- handle); only the *derivation* changes.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
declare
  base_username text;
  candidate     text;
  suffix        integer := 0;
begin
  base_username := coalesce(
    nullif(new.raw_user_meta_data->>'steam_persona', ''),
    nullif(new.raw_user_meta_data->>'username', ''),
    split_part(new.email, '@', 1)
  );
  candidate := base_username;

  -- Loop until we find a free username. In practice the loop runs once
  -- (no collision) or twice; an unbounded persona collision storm would
  -- still terminate because suffix increases monotonically.
  while exists (select 1 from public.profiles where username = candidate) loop
    suffix := suffix + 1;
    candidate := base_username || '-' || suffix;
  end loop;

  insert into public.profiles (id, username, avatar_url, steam_id, steam_persona, steam_avatar)
  values (
    new.id,
    candidate,
    coalesce(new.raw_user_meta_data->>'steam_avatar', new.raw_user_meta_data->>'avatar_url'),
    new.raw_user_meta_data->>'steam_id',
    new.raw_user_meta_data->>'steam_persona',
    new.raw_user_meta_data->>'steam_avatar'
  )
  on conflict (id) do update set
    steam_id      = excluded.steam_id,
    steam_persona = excluded.steam_persona,
    steam_avatar  = excluded.steam_avatar;
    -- intentionally NOT updating username here: see header comment.

  return new;
end;
$$;

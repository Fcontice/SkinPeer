-- 008_steam_webapi_token.sql
-- Adds Supabase Vault-backed storage for the optional Steam WebAPI token.
-- The token lets the server retrieve recently-added items via the
-- authenticated WebAPI endpoint (the public /inventory/ endpoint is
-- 5-min cached and excludes anything within ~10 days).
--
-- Encryption pattern (all sensitive fields on profiles follow this):
--   * column on profiles is a uuid pointer — NOT plaintext
--   * the actual secret lives in vault.secrets, encrypted at rest
--   * server-side only — set/clear via SECURITY DEFINER RPCs below
--   * client never sees the plaintext; GET endpoints expose only the
--     derived boolean has_steam_webapi_token

create extension if not exists supabase_vault with schema vault;

-- =====================================================================
-- 1. Pointer column on profiles
-- =====================================================================

alter table public.profiles
  add column if not exists steam_webapi_token_secret_id uuid;

comment on column public.profiles.steam_webapi_token_secret_id is
  'References vault.secrets row holding the encrypted Steam WebAPI token. NULL when not configured. Plaintext is never exposed to the client.';

-- =====================================================================
-- 2. Set RPC — validates token has already been verified by the server
--    (we ping Steam in the route handler, not here), then atomically
--    rotates the secret. Replaces any previously stored secret for this
--    user so we never leak old ciphertext.
-- =====================================================================

create or replace function public.set_steam_webapi_token(p_user_id uuid, p_token text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_existing_id uuid;
  v_new_id uuid;
begin
  if p_token is null or length(trim(p_token)) = 0 then
    raise exception 'token must be a non-empty string';
  end if;

  select steam_webapi_token_secret_id
    into v_existing_id
    from public.profiles
    where id = p_user_id;

  -- Create the new secret first so a failure here leaves the existing
  -- (still-valid) secret intact.
  v_new_id := vault.create_secret(p_token, 'steam_webapi_token_' || p_user_id::text);

  update public.profiles
     set steam_webapi_token_secret_id = v_new_id
   where id = p_user_id;

  if v_existing_id is not null then
    delete from vault.secrets where id = v_existing_id;
  end if;
end;
$$;

revoke all on function public.set_steam_webapi_token(uuid, text) from public;
grant execute on function public.set_steam_webapi_token(uuid, text) to service_role;

-- =====================================================================
-- 3. Clear RPC — drops the pointer and the underlying secret in one shot.
-- =====================================================================

create or replace function public.clear_steam_webapi_token(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_existing_id uuid;
begin
  select steam_webapi_token_secret_id
    into v_existing_id
    from public.profiles
    where id = p_user_id;

  update public.profiles
     set steam_webapi_token_secret_id = null
   where id = p_user_id;

  if v_existing_id is not null then
    delete from vault.secrets where id = v_existing_id;
  end if;
end;
$$;

revoke all on function public.clear_steam_webapi_token(uuid) from public;
grant execute on function public.clear_steam_webapi_token(uuid) to service_role;

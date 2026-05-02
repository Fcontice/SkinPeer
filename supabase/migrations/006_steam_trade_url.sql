-- 006_steam_trade_url.sql
-- PR 1 — Send-on-Steam deeplink
-- Adds a per-account Steam trade URL on profiles. Used to construct the
-- /tradeoffer/new/ deeplink. Steam does not allow item pre-population, so
-- the URL only carries partner+token+message (verification_code).

alter table public.profiles
  add column if not exists steam_trade_url text;

-- Format check: must be the canonical Steam trade URL with partner (digits)
-- and token (alphanumerics, _, -). Either order of query params is allowed.
alter table public.profiles
  drop constraint if exists profiles_steam_trade_url_format;

alter table public.profiles
  add constraint profiles_steam_trade_url_format
  check (
    steam_trade_url is null
    or (
      steam_trade_url like 'https://steamcommunity.com/tradeoffer/new/?%'
      and steam_trade_url ~ '(\?|&)partner=[0-9]+(&|$)'
      and steam_trade_url ~ '(\?|&)token=[A-Za-z0-9_-]+(&|$)'
    )
  );

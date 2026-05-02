-- legacy_policies_snapshot.sql
--
-- Snapshot of RLS policies that were applied via Supabase MCP during the
-- trade-room MVP build (see DEV_LOG entry 2026-05-01: "Applied RLS policies
-- migration via MCP — all 6 tables secured"). Captured against the live
-- SkinPeer Supabase project (ref awvcjiobgffsqbzvcapd) on 2026-05-01.
--
-- This file is an ARCHIVE ONLY. It is never re-applied. The trader-network
-- refactor's Phase 1 migration (003_trader_network.sql) drops trade_rooms,
-- trade_items, reports, activity_log, and trade_confirmations, taking these
-- policies with them. Survivor tables (profiles, steam_inventories) keep
-- their existing RLS state; replacement tables get new policies inline in
-- 003_trader_network.sql.
--
-- Migration that originally installed these (per `supabase migration list`):
--   20260501182747_enable_rls_policies
--
-- ============================================================================
-- profiles
-- ============================================================================
-- RLS enabled. Applies to anon and authenticated roles.

CREATE POLICY profiles_select ON public.profiles
  AS PERMISSIVE FOR SELECT
  TO public
  USING (true);

CREATE POLICY profiles_update ON public.profiles
  AS PERMISSIVE FOR UPDATE
  TO public
  USING (auth.uid() = id);

-- ============================================================================
-- trade_rooms (DROPPED in 003_trader_network.sql)
-- ============================================================================

CREATE POLICY rooms_insert ON public.trade_rooms
  AS PERMISSIVE FOR INSERT
  TO public
  WITH CHECK (auth.uid() = creator_id);

CREATE POLICY rooms_select ON public.trade_rooms
  AS PERMISSIVE FOR SELECT
  TO public
  USING (auth.uid() = creator_id OR auth.uid() = invitee_id);

CREATE POLICY rooms_update ON public.trade_rooms
  AS PERMISSIVE FOR UPDATE
  TO public
  USING (auth.uid() = creator_id OR auth.uid() = invitee_id);

-- ============================================================================
-- trade_confirmations (DROPPED in 003_trader_network.sql)
-- ============================================================================

CREATE POLICY confirmations_insert ON public.trade_confirmations
  AS PERMISSIVE FOR INSERT
  TO public
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY confirmations_select ON public.trade_confirmations
  AS PERMISSIVE FOR SELECT
  TO public
  USING (EXISTS (
    SELECT 1 FROM trade_rooms r
    WHERE r.id = trade_confirmations.room_id
      AND (r.creator_id = auth.uid() OR r.invitee_id = auth.uid())
  ));

CREATE POLICY confirmations_update ON public.trade_confirmations
  AS PERMISSIVE FOR UPDATE
  TO public
  USING (auth.uid() = user_id);

-- ============================================================================
-- trade_items (DROPPED and recreated with new shape in 003_trader_network.sql)
-- ============================================================================

CREATE POLICY items_select ON public.trade_items
  AS PERMISSIVE FOR SELECT
  TO public
  USING (EXISTS (
    SELECT 1 FROM trade_rooms r
    WHERE r.id = trade_items.room_id
      AND (r.creator_id = auth.uid() OR r.invitee_id = auth.uid())
  ));

CREATE POLICY items_insert ON public.trade_items
  AS PERMISSIVE FOR INSERT
  TO public
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY items_delete ON public.trade_items
  AS PERMISSIVE FOR DELETE
  TO public
  USING (auth.uid() = owner_id);

-- ============================================================================
-- reports (DROPPED and recreated with new shape in 003_trader_network.sql)
-- ============================================================================

CREATE POLICY reports_insert ON public.reports
  AS PERMISSIVE FOR INSERT
  TO public
  WITH CHECK (auth.uid() = reporter_id);

CREATE POLICY reports_select ON public.reports
  AS PERMISSIVE FOR SELECT
  TO public
  USING (
    auth.uid() = reporter_id
    OR EXISTS (
      SELECT 1 FROM trade_rooms r
      WHERE r.id = reports.room_id
        AND (r.creator_id = auth.uid() OR r.invitee_id = auth.uid())
    )
  );

-- ============================================================================
-- activity_log (DROPPED in 003_trader_network.sql; recreated as trade_activity_log)
-- ============================================================================

CREATE POLICY activity_select ON public.activity_log
  AS PERMISSIVE FOR SELECT
  TO public
  USING (EXISTS (
    SELECT 1 FROM trade_rooms r
    WHERE r.id = activity_log.room_id
      AND (r.creator_id = auth.uid() OR r.invitee_id = auth.uid())
  ));

-- ============================================================================
-- steam_inventories
-- ============================================================================
-- RLS DISABLED. No policies. Server-only table accessed via service_role.
-- Confirmed via pg_tables: rls_enabled = false.

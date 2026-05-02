-- 007_mark_completed.sql
-- PR 2 — replace the per-key checklist with a two-button mark-completed flow.
--
-- The original CLAUDE.md spec referenced trade_confirmations + a four-boolean
-- ready check; that table was already removed in 003. The current checklist
-- system is trade_checklist_items (six keys) plus creator_ready/recipient_ready
-- columns + the ready_to_verify status. This migration replaces all of that
-- with two booleans on trade_proposals.
--
-- Pre-launch MVP — no production data preserved.

-- =====================================================================
-- 1. Drop the checklist table (and remove from realtime first)
-- =====================================================================

alter publication supabase_realtime drop table public.trade_checklist_items;
drop table if exists public.trade_checklist_items cascade;

-- =====================================================================
-- 2. Migrate any existing ready_to_verify rows back to draft, then
--    drop the per-user ready columns and the ready_to_verify status.
-- =====================================================================

update public.trade_proposals
   set status = 'draft'
 where status = 'ready_to_verify';

alter table public.trade_proposals
  drop column if exists creator_ready,
  drop column if exists recipient_ready;

alter table public.trade_proposals
  drop constraint if exists trade_proposals_status_check;

alter table public.trade_proposals
  add constraint trade_proposals_status_check
  check (status in ('draft','completed','cancelled','disputed','in_review'));

-- =====================================================================
-- 3. Add the two per-user mark-completed flags.
--    First mark locks the room (no item edits, no offer changes).
--    Second mark flips status -> completed.
-- =====================================================================

alter table public.trade_proposals
  add column if not exists creator_marked_completed boolean not null default false,
  add column if not exists recipient_marked_completed boolean not null default false;

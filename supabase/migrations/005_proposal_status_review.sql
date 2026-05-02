-- 005_proposal_status_review.sql
-- Adds 'in_review' to trade_proposals.status check constraint.
-- Per AUDIT.md decision D10: schema-only addition. No handler currently transitions
-- into 'in_review'; the value is reserved for future moderation workflows.
-- ('disputed' was already in the enum from 003_trader_network.sql.)

alter table public.trade_proposals
  drop constraint if exists trade_proposals_status_check;

alter table public.trade_proposals
  add constraint trade_proposals_status_check
  check (status in ('draft','ready_to_verify','completed','cancelled','disputed','in_review'));

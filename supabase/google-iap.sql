-- ============================================================================
-- Roll for Rating — Android (Google Play Billing) entitlement support
-- Run in the Supabase SQL editor. Safe to re-run (idempotent).
--
-- The entitlements table originally allowed source in ('apple','comp'). Adding
-- Google Play subscriptions introduces a third source, 'google'. Without this
-- migration every Android purchase upsert in the validate-purchase edge
-- function is rejected by the CHECK constraint (check_violation) and no Android
-- user can ever be entitled. This widens the allowed set; it does not remove
-- 'apple'/'comp', so existing rows and the live iOS path are unaffected.
-- ============================================================================

-- The original constraint is inline and unnamed; Postgres auto-names it
-- `entitlements_source_check`. Drop it (if present) and re-add a named one that
-- also permits 'google'. Widening a CHECK can never invalidate existing rows.
alter table public.entitlements
  drop constraint if exists entitlements_source_check;

alter table public.entitlements
  add constraint entitlements_source_check
  check (source in ('apple','google','comp'));

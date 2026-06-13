-- ============================================================================
-- Roll for Rating — weight on profiles (for weight-class leaderboards)
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- Age needs no schema change — profiles.birthdate already exists and clients
-- compute age from it. Weight is self-reported in pounds and powers the
-- leaderboard weight-class filters (IBJJF-style classes + Absolute).
-- ============================================================================

alter table public.profiles add column if not exists weight_lbs numeric(5,1)
  check (weight_lbs is null or (weight_lbs >= 40 and weight_lbs <= 500));

-- Members may update their own weight (own-row policy already exists).
grant update (weight_lbs) on public.profiles to authenticated;

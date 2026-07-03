-- ============================================================================
-- Roll for Rating — performance indexes for 100k users (from the 100k audit).
-- Run last (after the migrations that add these columns). Safe to re-run.
--
-- Without these, hot queries seq-scan / full-sort the whole profiles table:
--   * every leaderboard + "champion" lookup sorts all 100k rows by rating
--   * gym rosters / member counts / gym-delete SET NULL scan profiles by gym_id
--   * a guardian's junior lookup scans profiles by managed_by
--   * the unread-notification badge scans notifications per user
-- ============================================================================

-- Leaderboards / champions: ORDER BY rating DESC over the whole table.
create index if not exists idx_profiles_rating on public.profiles (rating desc);

-- Gym rosters, member counts, and gym-delete SET NULL fan-out.
create index if not exists idx_profiles_gym_id
  on public.profiles (gym_id) where gym_id is not null;

-- Guardian -> managed junior profiles (fetchJuniors).
create index if not exists idx_profiles_managed_by
  on public.profiles (managed_by) where managed_by is not null;

-- Unread-count badge: notifications filtered by (user_id, read).
create index if not exists idx_notifications_user_read
  on public.notifications (user_id, read);

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

-- Quest / submission RPCs and FK checks filter matches by winner_id.
create index if not exists idx_matches_winner
  on public.matches (winner_id) where winner_id is not null;

-- notifications.match_id FK: match deletion + account deletion cascade-scan this
-- per match row without an index.
create index if not exists idx_notifications_match_id
  on public.notifications (match_id) where match_id is not null;

-- Season standings: ORDER BY points within a season (PK is season_id,user_id).
create index if not exists idx_season_scores_standings
  on public.season_scores (season_id, points desc);

-- Age-scoped leaderboards (e.g. the 13-and-under board): filter age_tier, sort rating.
create index if not exists idx_profiles_age_tier_rating
  on public.profiles (age_tier, rating desc);

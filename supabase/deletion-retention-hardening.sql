-- ============================================================================
-- Roll for Rating -- Batch 2: account deletion + video retention (audit 2026-07-20)
--
-- RUN AFTER schema.sql, match-waive-and-wager.sql, match-disputes.sql and
-- managed-juniors.sql. Safe to re-run.
--
-- Pairs with redeployed edge functions delete-account and purge-old-videos;
-- deploy those in the same window (delete-account needs the R2_* secrets added).
--
-- Fixes two halves of the same problem: deletion currently removes too LITTLE
-- of the deleted user's own data, and too MUCH of everyone else's.
--
--   1. TOO LITTLE (compliance). delete-account removed match videos from the
--      Supabase storage bucket, but every native upload lives in Cloudflare R2
--      (functions/video-url presigns a PUT there). So a deleted user's videos -
--      and their managed juniors' videos, which can show a child - survived in
--      R2 forever. Worse, deleting the auth user cascades match_videos away,
--      and purge-old-videos finds files to delete by walking match_videos rows,
--      so once the rows are gone NOTHING in the system can ever reach those
--      objects again. Managed juniors' avatar photos were left behind too (the
--      cleanup only covered the deleting user's own avatar_path). Handled in
--      the edge function; this file adds the residue audit table it writes to.
--
--   2. TOO MUCH (third-party data loss). matches.referee_id was
--      ON DELETE CASCADE (schema.sql:50), so when anyone who had ever
--      REFEREED deleted their account, every completed match they officiated -
--      between two OTHER people - was hard-deleted, taking the video rows and
--      the rating audit trail with it, while both competitors' profiles.wins /
--      losses counters kept counting those results. A profile could read 12-3
--      with only 9 matches in its history.
--
-- STILL OPEN, needs a product decision (NOT changed here): leagues.created_by,
-- tournaments.host_id and gyms.owner_id are also ON DELETE CASCADE, so one
-- organizer deleting their account erases an entire league / tournament / gym
-- for every participant. Fixing that needs an ownership-transfer story
-- (promote another organizer? block deletion until transferred?), which is a
-- product call rather than a mechanical fix.
-- ============================================================================

-- Fail fast instead of queueing behind a long-running query: an ACCESS
-- EXCLUSIVE request that waits will also block every request that arrives
-- behind it, turning a schema change into an app-wide stall.
set lock_timeout = '5s';

-- ---- 1. Residue audit trail ------------------------------------------------
-- Storage cleanup during account deletion is best-effort on purpose: Apple
-- 5.1.1(v) requires in-app deletion to SUCCEED, so a failing R2 call must not
-- block it. But silent best-effort is how the current residue went unnoticed,
-- so every object we could not delete is recorded here and can be swept later.
-- No FK on user_id: the user row is being deleted in the same breath.
create table if not exists public.deletion_residue (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('r2-video', 'bucket-video', 'avatar')),
  path       text not null,
  user_id    uuid,
  reason     text,
  created_at timestamptz not null default now()
);
create index if not exists deletion_residue_created_idx on public.deletion_residue (created_at desc);

-- Service-role only: RLS on with NO policy means no client role can read or
-- write it. The delete-account edge function uses the service key.
alter table public.deletion_residue enable row level security;
revoke all on public.deletion_residue from anon, authenticated;

-- ---- 2. Deleting a referee must not delete other people's matches ----------
-- Two changes are needed together, because matches carries a CHECK constraint
-- (referee_mode, match-waive-and-wager.sql:36) that requires a non-waived match
-- to HAVE a referee. A bare ON DELETE SET NULL would violate it and make the
-- account deletion fail outright, so the constraint has to admit a terminal
-- match whose referee is gone, and unfinished matches have to be released
-- before the FK action runs.

-- 2a. Allow a FINISHED match to have no referee. A completed/cancelled/declined
--     match is history: it has already been settled, and losing the referee's
--     account should not rewrite it. Live matches keep the original rule.
--     NOT VALID + VALIDATE deliberately: the plain form holds ACCESS EXCLUSIVE
--     on matches for a full scan while every screen in the app is querying it.
--     The new predicate is strictly WEAKER than the one prod already enforces,
--     so validation cannot fail; splitting it just keeps the hard lock brief.
alter table public.matches drop constraint if exists referee_mode;
alter table public.matches add constraint referee_mode
  check (
    status in ('completed', 'cancelled', 'declined')
    or (referee_waived and referee_id is null)
    or (not referee_waived and referee_id is not null)
  ) not valid;
alter table public.matches validate constraint referee_mode;

--     Who officiated has to survive the referee's account being deleted.
--     Without a tombstone, nulling referee_id makes a properly refereed match
--     render as "No referee - both competitors confirm" (src/app/match/[id].tsx,
--     src/components/match-card.tsx), a false statement about a permanent
--     competitive record, and a competitor disputing an old result can no
--     longer say who scored it.
alter table public.matches add column if not exists referee_name_snapshot text;

-- 2b. Release unfinished matches BEFORE the row is deleted. A match that is
--     still waiting on this referee cannot be officiated as arranged, so it is
--     cancelled rather than silently retargeted or left in a broken state.
--     Wagers are only applied at settlement (ror-symmetric-stake.sql), never
--     escrowed, so cancelling costs the competitors nothing and they are free
--     to re-challenge with another referee.
create or replace function public._release_matches_on_profile_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Tombstone the officiator on matches that will SURVIVE (the FK nulls
  -- referee_id a moment later), so the record still says who scored it.
  update public.matches
     set referee_name_snapshot = coalesce(referee_name_snapshot, old.display_name)
   where referee_id = old.id;

  update public.matches
     set status = 'cancelled', referee_id = null
   where referee_id = old.id
     and status not in ('completed', 'cancelled', 'declined');
  return old;
end $$;

drop trigger if exists trg_release_matches_on_profile_delete on public.profiles;
create trigger trg_release_matches_on_profile_delete
  before delete on public.profiles
  for each row execute function public._release_matches_on_profile_delete();

revoke execute on function public._release_matches_on_profile_delete() from public, anon, authenticated;

-- 2c. Now the FK can safely null out the referee on the remaining (finished)
--     matches instead of deleting them.
--     NOT VALID again: adding a validated FK scans matches and probes profiles
--     per row under a lock that blocks writes on BOTH tables. Existing rows all
--     already satisfy it (they satisfied the stricter CASCADE version), so
--     validation is a formality - just not one worth an outage.
--     RUN THIS FILE AS ONE TRANSACTION. The constraint has to be dropped before
--     it can be re-added under the same name, and that name is load-bearing far
--     beyond the database: the app embeds the referee through it by name
--     (`profiles!matches_referee_id_fkey` in src/lib/matches.ts), so between the
--     drop and the add there is a window where My Matches, the Watch feed and
--     every match screen fail to load. The Supabase SQL editor wraps a script in
--     a transaction, so an abort rolls the drop back - but running this file
--     statement by statement, or with "run selection", does not, and a
--     lock_timeout firing on the ADD would leave the table with no referee FK at
--     all and the file un-re-runnable.
alter table public.matches drop constraint if exists matches_referee_id_fkey;
alter table public.matches
  add constraint matches_referee_id_fkey
  foreign key (referee_id) references public.profiles (id) on delete set null not valid;
alter table public.matches validate constraint matches_referee_id_fkey;

--     Fail LOUDLY rather than leaving a half-applied schema: if the constraint
--     is not present and correct at this point, the app is already broken and
--     the operator needs to know now, not from a support ticket.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'matches_referee_id_fkey'
       and conrelid = 'public.matches'::regclass
       and confdeltype = 'n'
  ) then
    raise exception 'matches_referee_id_fkey is missing or not SET NULL. The app embeds the referee through this constraint BY NAME, so match screens are broken until it is restored. Re-run this file as a single transaction.';
  end if;
end $$;

notify pgrst, 'reload schema';

-- ---- Post-install diagnostics ----------------------------------------------
-- One statement: the Supabase SQL editor shows only the last result set.
-- referee_fk_action: expect 'n' (SET NULL). 'c' means the cascade is still live.
-- release_trigger: expect 1. This is the load-bearing piece - if the FK lands
--   but the trigger does not, every account deletion by someone with a LIVE
--   refereed match fails with a referee_mode violation, which surfaces to the
--   user as "we couldn't delete your account" (an App Store 5.1.1(v) failure).
-- referee_mode_relaxed: expect true. False means the strict constraint is back
--   (e.g. match-waive-and-wager.sql was re-run) and deletions will start
--   failing again.
-- residue_rows: 0 on a fresh install; grows only when a storage delete fails
--   during account deletion, and each row is a file that still needs sweeping.
select
  (select confdeltype from pg_constraint
    where conname = 'matches_referee_id_fkey' and conrelid = 'public.matches'::regclass
  ) as referee_fk_action,
  (select count(*) from pg_trigger
    where tgrelid = 'public.profiles'::regclass
      and tgname = 'trg_release_matches_on_profile_delete'
  ) as release_trigger,
  (select pg_get_constraintdef(oid) like '%completed%' from pg_constraint
    where conname = 'referee_mode' and conrelid = 'public.matches'::regclass
  ) as referee_mode_relaxed,
  (select count(*) from public.deletion_residue) as residue_rows,
  'deletion-retention-hardening installed' as ok;

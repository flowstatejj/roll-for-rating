-- ============================================================================
-- Roll for Rating - League ruleset + scoring style (mirror of tournament-rulesets)
-- Run in the Supabase SQL editor AFTER leagues.sql. Safe to re-run.
--
-- Brings the two host-facing federation choices tournaments already have onto
-- leagues, which run weekly over a season rather than in one day:
--   scoring        submission_only | points  (how a bout is scored)
--   ruleset_preset naga | ibjjf | grappling_industries | adcc | custom
--
-- Like tournaments, the preset stamps the league and, in the app, seeds the
-- standings-scoring defaults (win/draw/loss points + submission bonuses) for the
-- chosen federation. 'submission_only' is a LABEL today (see the note in
-- tournament-rulesets.sql): no settlement function branches on it - all scoring
-- is the win/draw/loss + sub-bonus math the league already stores - so these are
-- purely additive columns with checks. create_league is a plain client INSERT
-- (src/lib/leagues.ts), so no function changes here.
--
-- PROD RE-RUN ORDER (idempotent): ... -> leagues.sql -> league-rulesets.sql
-- ============================================================================

alter table public.leagues
  add column if not exists scoring text not null default 'points';
do $$ begin
  alter table public.leagues
    add constraint leagues_scoring_chk check (scoring in ('submission_only','points'));
exception when duplicate_object then null; end $$;

alter table public.leagues
  add column if not exists ruleset_preset text not null default 'custom';
do $$ begin
  alter table public.leagues
    add constraint leagues_ruleset_preset_chk
      check (ruleset_preset in ('naga','ibjjf','grappling_industries','adcc','custom'));
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
select 'league rulesets installed' as ok;

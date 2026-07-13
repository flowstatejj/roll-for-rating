-- ============================================================================
-- Roll for Rating - Tournament ruleset + scoring style
-- Run in the Supabase SQL editor AFTER tournaments-pro.sql. Safe to re-run.
--
-- Two host choices made up front when creating an event:
--   scoring        submission_only | points  (how a bout is won)
--   ruleset_preset naga | ibjjf | grappling_industries | adcc | custom
--
-- v1 ("scoring + label"): the preset stamps the event and, in the app, seeds the
-- standings-scoring defaults (win/draw/loss points + submission bonuses) for the
-- chosen federation. A later slice will let a preset auto-generate that
-- federation's standard weight classes and age brackets as divisions.
-- create_tournament is a plain client INSERT (see src/lib/tournaments.ts), so no
-- function changes here - just the two columns + checks.
-- ============================================================================

alter table public.tournaments
  add column if not exists scoring text not null default 'points';
do $$ begin
  alter table public.tournaments
    add constraint tournaments_scoring_chk check (scoring in ('submission_only','points'));
exception when duplicate_object then null; end $$;

alter table public.tournaments
  add column if not exists ruleset_preset text not null default 'custom';
do $$ begin
  alter table public.tournaments
    add constraint tournaments_ruleset_preset_chk
      check (ruleset_preset in ('naga','ibjjf','grappling_industries','adcc','custom'));
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
select 'tournament rulesets installed' as ok;

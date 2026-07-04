-- ============================================================================
-- Roll for Rating - IBJJF youth belts
-- Adds the kids' belt colors to the belt_rank enum. Run this FIRST, on its own,
-- BEFORE belt-starting-rating.sql (Postgres won't let a new enum value be USED
-- in the same transaction it's added). Safe to re-run (if not exists).
--
-- Youth system: gray / yellow / orange / green, each in solid, white-stripe, and
-- black-stripe. Plain white already exists (shared with the adult entry belt).
-- ============================================================================
alter type public.belt_rank add value if not exists 'gray_white';
alter type public.belt_rank add value if not exists 'gray';
alter type public.belt_rank add value if not exists 'gray_black';
alter type public.belt_rank add value if not exists 'yellow_white';
alter type public.belt_rank add value if not exists 'yellow';
alter type public.belt_rank add value if not exists 'yellow_black';
alter type public.belt_rank add value if not exists 'orange_white';
alter type public.belt_rank add value if not exists 'orange';
alter type public.belt_rank add value if not exists 'orange_black';
alter type public.belt_rank add value if not exists 'green_white';
alter type public.belt_rank add value if not exists 'green';
alter type public.belt_rank add value if not exists 'green_black';

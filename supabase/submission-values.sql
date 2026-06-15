-- ============================================================================
-- Roll for Rating — Submission RoR values
-- Run in the Supabase SQL editor (after submission-hunt.sql). Safe to re-run.
--
-- Each submission now grants its OWN bonus Elo (the "RoR value") the first time
-- you win with it, instead of a flat +15. The referee's dropdown pick is stored
-- as matches.submission_type; claim_submission_rewards looks the value up here.
-- Unknown / legacy submissions fall back to 15.
-- ============================================================================

create table if not exists public.submission_values (
  name text primary key,
  ror  integer not null
);

-- Readable by anyone signed in (the app shows each value on the hunt screen).
alter table public.submission_values enable row level security;
drop policy if exists "submission_values_read" on public.submission_values;
create policy "submission_values_read" on public.submission_values for select to authenticated using (true);

-- Seed / refresh the 53 values (re-runnable).
insert into public.submission_values (name, ror) values
  ('Rear naked choke', 12), ('Guillotine', 12), ('Arm-in guillotine', 16),
  ('Mounted triangle', 18), ('Side triangle', 20), ('Reverse triangle', 22),
  ('Inverted triangle', 22), ('Ezekiel', 18), ('Bow and arrow', 18),
  ('Cross collar', 14), ('Clock choke', 18), ('Loop choke', 20),
  ('Baseball bat choke', 24), ('Paper cutter', 20), ('Arm triangle', 15),
  ('D''Arce/Brabo', 20), ('Anaconda', 20), ('North-south', 20),
  ('Peruvian necktie', 28), ('Japanese necktie', 28), ('Von Flue', 30),
  ('Bulldog', 24), ('Gogoplata', 35), ('Buggy choke', 30),
  ('Murder choke', 26), ('Smother', 26), ('Mother''s milk', 30),
  ('Short choke', 22),
  ('Armbar', 12), ('Kimura', 14), ('Americana', 14), ('Omoplata', 20),
  ('Monoplata', 25), ('Bicep slicer', 22), ('Wrist lock', 18),
  ('Thunder lock', 30), ('Violin armbar', 26), ('Shotgun armbar', 26),
  ('Choi bar', 30), ('Straight arm lock', 14), ('Reverse omoplata', 28),
  ('Straight ankle lock', 15), ('Kneebar', 22), ('Toe hold', 22),
  ('Heel hook', 28), ('Calf slicer', 22), ('Aoki lock', 30), ('Z-lock', 30),
  ('Banana split/electric chair', 28), ('Woj lock', 30), ('Texas cloverleaf', 26),
  ('Mikey lock', 28), ('Twister', 32)
on conflict (name) do update set ror = excluded.ror;

-- Grant each submission's own RoR value for every NEW submission type won with.
create or replace function public.claim_submission_rewards()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  rec    record;
  gained integer := 0;
  claimed text[] := '{}';
begin
  for rec in
    select distinct m.submission_type as st
    from public.matches m
    where m.status = 'completed'
      and m.winner_id = auth.uid()
      and m.submission_type is not null
      and not exists (
        select 1 from public.submission_rewards r
        where r.user_id = auth.uid() and r.submission_type = m.submission_type
      )
  loop
    insert into public.submission_rewards (user_id, submission_type) values (auth.uid(), rec.st)
      on conflict do nothing;
    gained := gained + coalesce((select ror from public.submission_values where name = rec.st), 15);
    claimed := array_append(claimed, rec.st);
  end loop;

  if gained > 0 then
    update public.profiles set rating = rating + gained where id = auth.uid();
  end if;

  return jsonb_build_object(
    'gained', gained,
    'claimed', to_jsonb(claimed),
    'new_rating', (select rating from public.profiles where id = auth.uid())
  );
end; $$;

select 'submission-values-installed' as ok;

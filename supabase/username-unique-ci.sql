-- ============================================================================
-- Roll for Rating — case-insensitive unique usernames
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- profiles.username already has a UNIQUE constraint (schema.sql) and the
-- signup trigger uniquifies case-insensitively (signup-username.sql), and the
-- app lowercases usernames at signup. This closes the last gap: the DB itself
-- did not forbid two usernames differing only in case ("John" vs "john").
--
-- 1) Dedupe any existing case-insensitive collisions (keeps the OLDEST account
--    untouched; later ones get a numeric suffix, mirroring the signup rule).
-- 2) Enforce with a unique index on lower(username).
-- ============================================================================

do $$
declare
  rec record;
  candidate text;
  n int;
begin
  for rec in
    select p.id, p.username
    from public.profiles p
    where exists (
      select 1 from public.profiles q
      where lower(q.username) = lower(p.username)
        and q.created_at < p.created_at
    )
    order by p.created_at
  loop
    n := 1;
    candidate := rec.username || n::text;
    while exists (select 1 from public.profiles where lower(username) = lower(candidate)) loop
      n := n + 1;
      candidate := rec.username || n::text;
    end loop;
    update public.profiles set username = candidate where id = rec.id;
    raise notice 'deduped username % -> %', rec.username, candidate;
  end loop;
end $$;

create unique index if not exists idx_profiles_username_ci
  on public.profiles (lower(username));

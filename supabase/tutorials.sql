-- ============================================================================
-- Roll for Rating - Video tutorials ("How the app works")
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- The app lists published rows from this table on the Tutorials screen
-- (Community -> How the app works). Add a tutorial by inserting a row - no
-- app update needed. Host videos anywhere tappable (YouTube works great).
-- ============================================================================

create table if not exists public.tutorials (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  url         text not null,          -- YouTube link (or any video URL)
  sort_order  integer not null default 100,
  published   boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.tutorials enable row level security;
drop policy if exists "tutorials_read" on public.tutorials;
create policy "tutorials_read" on public.tutorials for select to authenticated
  using (published);
-- No insert/update policies: manage rows from the SQL editor (owner only).

-- Example (run one of these per video when you record them):
-- insert into public.tutorials (title, description, url, sort_order) values
--   ('Start your first challenge', 'Pick an opponent and a referee, set the stakes, and roll.', 'https://youtu.be/XXXX', 10);

notify pgrst, 'reload schema';
select 'tutorials installed' as ok;

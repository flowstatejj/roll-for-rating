-- ============================================================================
-- Rollr — Per-match messaging + "when & where" plan
-- Run in the Supabase SQL Editor (after schema.sql). Safe to re-run.
-- ============================================================================

-- Agreed meeting details, set by any participant.
alter table public.matches add column if not exists meet_when text;
alter table public.matches add column if not exists meet_where text;

-- ---------------------------------------------------------------------------
-- match_messages — chat between the match's participants
-- ---------------------------------------------------------------------------
create table if not exists public.match_messages (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references public.matches (id) on delete cascade,
  sender_id  uuid not null references public.profiles (id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists match_messages_match_idx on public.match_messages (match_id, created_at);

alter table public.match_messages enable row level security;

-- Only the challenger / opponent / referee of the match can read or post.
drop policy if exists "match_messages_read" on public.match_messages;
create policy "match_messages_read" on public.match_messages
  for select to authenticated using (
    exists (
      select 1 from public.matches m
      where m.id = match_id and auth.uid() in (m.challenger_id, m.opponent_id, m.referee_id)
    )
  );

drop policy if exists "match_messages_insert" on public.match_messages;
create policy "match_messages_insert" on public.match_messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.matches m
      where m.id = match_id and auth.uid() in (m.challenger_id, m.opponent_id, m.referee_id)
    )
  );

-- Realtime for live chat.
do $$ begin
  alter publication supabase_realtime add table public.match_messages;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- set_match_plan — any participant sets the when/where
-- ---------------------------------------------------------------------------
create or replace function public.set_match_plan(p_match_id uuid, p_when text, p_where text)
returns void
language plpgsql security definer set search_path = public
as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match_id;
  if not found then raise exception 'Match not found'; end if;
  if auth.uid() not in (m.challenger_id, m.opponent_id, m.referee_id) then
    raise exception 'Only a participant can set the plan';
  end if;
  update public.matches
     set meet_when = nullif(trim(p_when), ''), meet_where = nullif(trim(p_where), '')
   where id = p_match_id;
end; $$;

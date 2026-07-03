-- ============================================================================
-- Roll for Rating — Family plan + guardian accounts
-- Run in the Supabase SQL editor (after subscriptions.sql, minors.sql,
-- managed-juniors.sql, belt-starting-rating.sql, kid-privacy.sql). Safe to re-run.
--
-- Two subscription tiers (both 7-day trial, sold via Apple IAP):
--   * Individual  com.flowstatejj.rollforrating.pro.monthly    $4.99 — holder + up to ONE managed child
--   * Family      com.flowstatejj.rollforrating.family.monthly $9.99 — holder + UNLIMITED managed children
--
-- A managed child (kid OR teen) is operated by the account holder in-session,
-- exactly like the existing under-14 "junior" flow — no login of their own.
--
-- A "guardian" is a NON-PARTICIPATING account holder: they pay and manage
-- children but do not compete. participating=false hides them from leaderboards
-- and match search and shows a Guardian badge. A guardian can be on either tier
-- (one child on $4.99, more on $9.99) — the capacity rule is plan-based, not
-- tied to whether the holder competes.
-- ============================================================================

-- --- 1. participating flag (guardian = false) ------------------------------
alter table public.profiles
  add column if not exists participating boolean not null default true;

comment on column public.profiles.participating is
  'False for a guardian account: pays and manages children but does not compete; hidden from leaderboards and match search.';

-- --- 2. Plan-aware entitlement helpers -------------------------------------

-- Does this user hold an active FAMILY entitlement (unlimited managed children)?
create or replace function public.has_active_family(p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.entitlements e
    where e.user_id = p_user
      and e.product_id ilike '%family%'
      and (
        e.source = 'comp'
        or e.status = 'grace' -- billing-retry grace period IS active (expires_at is already past)
        or (e.status = 'active' and (e.expires_at is null or e.expires_at > now()))
      )
  );
$$;

-- Active access now also covers a managed child whose manager is active. The
-- child is operated inside the manager's (already paywalled) session, so once
-- the manager is active the child rows they operate are usable. The 1-vs-many
-- capacity limit is enforced at INSERT time (section 4), not here.
create or replace function public.has_active_entitlement(p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.entitlements e
    where e.user_id = p_user
      and (
        e.source = 'comp'
        or e.status = 'grace' -- billing-retry grace period IS active (expires_at is already past)
        or (e.status = 'active' and (e.expires_at is null or e.expires_at > now()))
      )
  )
  or exists (
    -- covered as a managed child of an active manager
    select 1
    from public.profiles ch
    join public.entitlements e on e.user_id = ch.managed_by
    where ch.id = p_user
      and ch.managed_by is not null
      and (
        e.source = 'comp'
        or e.status = 'grace' -- billing-retry grace period IS active (expires_at is already past)
        or (e.status = 'active' and (e.expires_at is null or e.expires_at > now()))
      )
  );
$$;

-- Expose the plan tier to the client (so it can show "unlimited" vs "1 child"
-- and prompt an upgrade). Adds a `plan` column to the existing return shape.
-- Drop first: CREATE OR REPLACE can't change an existing function's return type.
drop function if exists public.my_subscription();
create or replace function public.my_subscription()
returns table (
  active      boolean,
  status      text,
  source      text,
  product_id  text,
  expires_at  timestamptz,
  auto_renew  boolean,
  plan        text
)
language sql stable security definer set search_path = public as $$
  select
    public.has_active_entitlement(auth.uid()),
    e.status, e.source, e.product_id, e.expires_at, e.auto_renew,
    case when e.product_id ilike '%family%' then 'family' else 'individual' end
  from public.entitlements e
  where e.user_id = auth.uid()
  union all
  select false, null, null, null, null::timestamptz, null, null
  where not exists (select 1 from public.entitlements where user_id = auth.uid())
  limit 1;
$$;

grant execute on function public.has_active_family(uuid) to authenticated;
grant execute on function public.has_active_entitlement(uuid) to authenticated;
grant execute on function public.my_subscription() to authenticated;

-- How many children does a user currently manage? (used by the client to gate
-- the "add another" button and decide whether to prompt a Family upgrade.)
create or replace function public.my_managed_count()
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.profiles where managed_by = auth.uid();
$$;
grant execute on function public.my_managed_count() to authenticated;

-- --- 3. Authoritative handle_new_user (resolves the prior duplicate) --------
-- belt-starting-rating.sql and minors.sql each defined this; this merged version
-- supersedes both: belt-based starting rating + birthdate + parent-consent seed
-- for self-registered minors + the participating/guardian flag.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  bd     date       := nullif(new.raw_user_meta_data ->> 'birthdate', '')::date;
  v_belt belt_rank  := coalesce((new.raw_user_meta_data ->> 'belt_rank')::belt_rank, 'white');
  v_part boolean    := coalesce((new.raw_user_meta_data ->> 'participating')::boolean, true);
begin
  insert into public.profiles (id, username, display_name, belt_rank, rating, birthdate, participating)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', 'user_' || left(new.id::text, 8)),
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'username', 'New Grappler'),
    v_belt,
    public.starting_rating(v_belt),
    bd,
    v_part
  );

  -- Self-registered minor (teen) with a parent email → seed the consent row.
  if public.tier_for(bd) <> 'adult'
     and nullif(new.raw_user_meta_data ->> 'parent_email', '') is not null then
    insert into public.parent_consents (user_id, parent_email)
    values (new.id, new.raw_user_meta_data ->> 'parent_email')
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

-- --- 4. Managed child INSERT: capacity + teen support ----------------------
-- An adult may create a managed child (kid OR teen) pointing at themselves when:
--   * they hold an active FAMILY entitlement  → unlimited, OR
--   * they hold any active entitlement        → only their FIRST child (count = 0).
-- The existing column grant already allows the insertable columns.
drop policy if exists "profiles_insert_managed_junior" on public.profiles;
create policy "profiles_insert_managed_junior" on public.profiles
  for insert to authenticated with check (
    managed_by = auth.uid()
    and public.my_age_tier() = 'adult'
    and public.tier_for(birthdate) in ('kid','teen')
    and (
      public.has_active_family(auth.uid())
      or (
        public.has_active_entitlement(auth.uid())
        and (select count(*) from public.profiles p where p.managed_by = auth.uid()) = 0
      )
    )
  );

-- --- 5. Hide non-participating guardians from competitive surfaces ----------
-- Match search: never surface a guardian as an opponent. (kid already excluded
-- by existing matches.ts filters; this adds the participating gate server-side
-- via a helper the client can also use.)
create or replace function public.is_opponent_eligible(p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.participating and p.age_tier <> 'kid' from public.profiles p where p.id = p_user),
    false
  );
$$;
grant execute on function public.is_opponent_eligible(uuid) to authenticated;

-- Leaderboards: exclude guardians. The main + geo leaderboards read profiles
-- directly in the client / views; gate them on participating there. For any
-- SECURITY DEFINER leaderboard fn that filters in SQL, add participating below
-- if/when present. (Client query filters are updated alongside this migration.)

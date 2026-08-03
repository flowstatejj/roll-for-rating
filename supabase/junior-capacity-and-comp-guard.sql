-- ============================================================================
-- Roll for Rating -- Batch 3: junior capacity + comp-entitlement protection
--
-- RUN AFTER family-plan.sql, admin-founders.sql, gym-accounts.sql and
-- subscriptions.sql. Safe to re-run.
--
-- THIS FILE OWNS junior_capacity, my_subscription and the
-- profiles_insert_managed_junior policy. Re-running family-plan.sql reverts the
-- policy and my_subscription to the one-child string-matching behaviour below.
--
-- WHY (owner report, 2026-07-20): "my account only lets me add one child... as
-- an owner or founding member it should be up to 5, for more they can submit a
-- request".
--
-- ROOT CAUSE. Capacity was decided in two places, both testing the same fragile
-- string: has_active_family (family-plan.sql:30-43) and the client's
-- `plan === 'family'` (juniors.tsx), where plan comes from my_subscription's
-- `case when e.product_id ilike '%family%'`. A founder only matches that string
-- through the exact literal 'comp:founding-member-family' written by
-- admin_set_founding_member (admin-founders.sql:40-44, a suffix added later
-- with a one-time backfill). Two independent ways a real founder misses it:
--   (a) prod still holds the pre-suffix value 'comp:founding-member', because
--       the updated admin-founders.sql was never re-run; or
--   (b) validate-purchase overwrote the comp row with a store product - see
--       section 3 - because entitlements is one row per user upserted on
--       user_id with no guard for source = 'comp'.
-- Either way has_active_family() is false and the policy falls to the
-- "any active entitlement -> first child only" arm. Hence a cap of exactly 1.
--
-- THE FIX. Capacity stops depending on a product-id string and becomes one
-- SQL function, derived from durable facts (the founding-member flag, an
-- explicit admin override), with the string test kept only for genuine paid
-- family subscriptions.
-- ============================================================================

-- ---- 1. Capacity: one source of truth --------------------------------------

-- An admin-granted allowance for people who asked for more than their tier
-- gives (the "submit a request" path). Null = use the tier default.
alter table public.profiles add column if not exists junior_cap_override int
  check (junior_cap_override is null or (junior_cap_override >= 0 and junior_cap_override <= 100));
comment on column public.profiles.junior_cap_override is
  'Admin-approved managed-junior allowance; overrides the tier default in junior_capacity().';

-- How many managed juniors may this user have IN TOTAL?
--   override        -> exactly that
--   paid family     -> effectively unlimited (unchanged from the advertised plan)
--   founder / admin -> 5
--   any active sub  -> 1
--   no entitlement  -> 0
create or replace function public.junior_capacity(p_user uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(
    (select junior_cap_override from public.profiles where id = p_user),
    case
      -- Founder / admin FIRST, on purpose. Section 4 normalises a founder's comp
      -- product_id to 'comp:founding-member-family' for display, which makes
      -- has_active_family() true - so if the family arm came first every founder
      -- would silently land on 999 and the requested tier of 5 (and the
      -- Request-more path with it) would be dead code.
      when exists (
        select 1 from public.profiles
         where id = p_user and (coalesce(is_founding_member, false) or coalesce(is_admin, false))
      ) then 5
      -- A genuinely PAID family subscription is the unlimited tier.
      when public.has_active_family(p_user) then 999
      when public.has_active_entitlement(p_user) then 1
      else 0
    end
  );
$$;

-- Read-only and self-scoped in practice; safe for clients, never for anon.
revoke execute on function public.junior_capacity(uuid) from public, anon;
grant  execute on function public.junior_capacity(uuid) to authenticated;

-- ---- 2. Enforce it at INSERT + expose it to the app ------------------------
-- Server side is authoritative: the client only renders what this allows.
drop policy if exists "profiles_insert_managed_junior" on public.profiles;
create policy "profiles_insert_managed_junior" on public.profiles
  for insert to authenticated with check (
    managed_by = auth.uid()
    and public.my_age_tier() = 'adult'
    and public.tier_for(birthdate) in ('kid','teen')
    -- Keep the original guarantee EXPLICIT: managing a child still requires
    -- active access. junior_capacity alone would not enforce it, because the
    -- override and founder/admin arms short-circuit before the
    -- has_active_entitlement arm - so a lapsed subscriber holding an override,
    -- or a founder whose comp grant was revoked, would otherwise still pass.
    and public.has_active_entitlement(auth.uid())
    and (select count(*) from public.profiles p where p.managed_by = auth.uid())
        < public.junior_capacity(auth.uid())
  );

-- my_subscription gains junior_cap so the app stops re-deriving capacity from
-- the plan string. Return type changes, so it must be dropped first.
-- family-plan.sql owns the original; re-running it reverts this.
drop function if exists public.my_subscription();
create or replace function public.my_subscription()
returns table (
  active      boolean,
  status      text,
  source      text,
  product_id  text,
  expires_at  timestamptz,
  auto_renew  boolean,
  plan        text,
  junior_cap  int
)
language sql stable security definer set search_path = public as $$
  select
    public.has_active_entitlement(auth.uid()),
    e.status, e.source, e.product_id, e.expires_at, e.auto_renew,
    case when e.product_id ilike '%family%' then 'family' else 'individual' end,
    public.junior_capacity(auth.uid())
  from public.entitlements e
  where e.user_id = auth.uid()
  union all
  select false, null, null, null, null::timestamptz, null, null,
         public.junior_capacity(auth.uid())
  where not exists (select 1 from public.entitlements where user_id = auth.uid())
  limit 1;
$$;

revoke execute on function public.my_subscription() from public, anon;
grant  execute on function public.my_subscription() to authenticated;

-- ---- 3. A store purchase must never destroy a comp grant -------------------
-- entitlements holds ONE row per user, upserted on user_id by validate-purchase
-- with no source guard, so a founder / elite / free-gym account that ever hits
-- Subscribe or Restore has their comp grant overwritten by the store product -
-- silently converting free lifetime access into a paid subscription and, via
-- section 1, dropping their junior capacity. This trigger makes the row itself
-- refuse the downgrade, so it holds no matter which code path writes.
--
-- Deliberately a trigger, not an edit to validate-purchase: the edge function
-- is one caller, and the same clobber is reachable from any admin script or a
-- future store integration.
create or replace function public._protect_comp_entitlement()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and old.source = 'comp'
     and coalesce(new.source, '') <> 'comp'
     and (old.expires_at is null or old.expires_at > now())
     and coalesce(old.status, 'active') in ('active', 'grace')
  then
    insert into public.comp_purchase_conflicts (user_id, attempted_product_id, attempted_source, attempted_txn)
    values (old.user_id, new.product_id, new.source, new.original_transaction_id);

    -- Keep the comp ACCESS (source/product/status/expiry) but ADOPT the store's
    -- identifiers. Returning a bare OLD would make a real, paid subscription
    -- vanish: validate-purchase's "already linked to another account" check and
    -- the whole apple-notifications pipeline both look a subscription up by
    -- original_transaction_id, so with no row carrying it the member would be
    -- billed monthly forever with nothing recorded, renewals/refunds/revokes
    -- would be silent no-ops, and the same receipt could be restored onto a
    -- DIFFERENT account for free access. Carrying the ids keeps the purchase
    -- discoverable and refundable while the free grant still wins.
    new.source                  := old.source;
    new.product_id              := old.product_id;
    new.status                  := old.status;
    new.expires_at              := old.expires_at;
    new.auto_renew              := old.auto_renew;
    new.original_transaction_id := coalesce(new.original_transaction_id, old.original_transaction_id);
    new.latest_transaction_id   := coalesce(new.latest_transaction_id, old.latest_transaction_id);
    new.purchased_at            := coalesce(new.purchased_at, old.purchased_at);
    return new;
  end if;
  return new;
end $$;

create table if not exists public.comp_purchase_conflicts (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid,
  attempted_product_id text,
  attempted_source     text,
  attempted_txn        text,
  created_at           timestamptz not null default now()
);
alter table public.comp_purchase_conflicts enable row level security;
revoke all on public.comp_purchase_conflicts from anon, authenticated;

drop trigger if exists trg_protect_comp_entitlement on public.entitlements;
create trigger trg_protect_comp_entitlement
  before update on public.entitlements
  for each row execute function public._protect_comp_entitlement();

revoke execute on function public._protect_comp_entitlement() from public, anon, authenticated;

-- ---- 4. Repair founders whose comp row predates the family suffix ----------
-- admin-founders.sql started writing 'comp:founding-member-family' only after
-- family-plan.sql shipped; rows created before that still say
-- 'comp:founding-member'. Capacity no longer depends on this string (section 1
-- reads is_founding_member), but my_subscription still reports the plan from
-- it, so normalise it for display.
update public.entitlements e
   set product_id = 'comp:founding-member-family'
  from public.profiles p
 where p.id = e.user_id
   and e.source = 'comp'
   and e.product_id = 'comp:founding-member'
   and coalesce(p.is_founding_member, false);

notify pgrst, 'reload schema';

-- ---- Post-install diagnostics ----------------------------------------------
-- One statement: the Supabase SQL editor renders only the last result set.
-- owner_capacity: the app owner's capacity - expect 5 (or 999 on a paid family
--   plan, or their override). 1 means the founding-member flag is not set on
--   that profile, which is then the thing to fix.
-- founders_without_family_product: expect 0 after section 4.
-- comp_rows_active: how many live comp grants are now protected by the trigger.
select
  (select public.junior_capacity(p.id) from public.profiles p
    where p.is_founding_member order by p.created_at limit 1) as first_founder_capacity,
  (select count(*) from public.entitlements e
     join public.profiles p on p.id = e.user_id
    where p.is_founding_member and e.source = 'comp'
      and e.product_id not ilike '%family%') as founders_without_family_product,
  (select count(*) from public.entitlements where source = 'comp') as comp_rows_active,
  'junior-capacity-and-comp-guard installed' as ok;

-- ============================================================================
-- Roll for Rating — Subscriptions / entitlements (StoreKit 2, hard paywall)
-- Run in the Supabase SQL editor (after schema.sql). Safe to re-run.
--
-- The app is a $4.99/mo auto-renewable subscription (7-day free trial) sold
-- through Apple In-App Purchase. We never see card data — Apple processes the
-- payment and we record an *entitlement* derived from the StoreKit transaction.
--
-- Flow:
--   1. Client buys via StoreKit 2 → gets a signed transaction (JWS).
--   2. Client POSTs it to the `validate-purchase` edge function, which verifies
--      it with Apple's App Store Server API and upserts the row here.
--   3. Apple's App Store Server Notifications V2 hit the `apple-notifications`
--      edge function for renewals / cancellations / refunds / expirations.
--
-- `source = 'comp'` is a complimentary entitlement we grant without a purchase
-- (the App Review demo account; later, gym-sponsored seats). Comp rows never
-- expire and always count as active.
-- ============================================================================

create table if not exists public.entitlements (
  user_id                 uuid primary key references public.profiles(id) on delete cascade,
  product_id              text not null,
  status                  text not null default 'active'
                            check (status in ('active','grace','expired','revoked')),
  source                  text not null default 'apple'
                            check (source in ('apple','google','comp')),
  environment             text not null default 'Production'
                            check (environment in ('Production','Sandbox')),
  -- StoreKit identifiers — original_transaction_id is the stable subscription key.
  original_transaction_id text,
  latest_transaction_id   text,
  purchased_at            timestamptz,
  expires_at              timestamptz,
  auto_renew              boolean not null default true,
  updated_at              timestamptz not null default now()
);

-- A subscription's original transaction belongs to exactly ONE account.
-- Partial-UNIQUE (comp rows have a null transaction id and are excluded) so a
-- single Apple/Google receipt can never entitle multiple users. Doubles as the
-- lookup index. This is the hard backstop behind validate-purchase's own check.
drop index if exists public.idx_entitlements_orig;
create unique index if not exists idx_entitlements_orig_unique
  on public.entitlements (original_transaction_id)
  where original_transaction_id is not null;

alter table public.entitlements enable row level security;

-- Members may read their OWN entitlement so the app can show subscription state.
-- All writes happen server-side (edge functions use the service role, which
-- bypasses RLS) — there is intentionally NO client insert/update/delete policy.
drop policy if exists "entitlements_select_own" on public.entitlements;
create policy "entitlements_select_own" on public.entitlements
  for select to authenticated using (user_id = auth.uid());

-- ---- Active-access check ---------------------------------------------------
-- The single source of truth the app (and other policies) can call.
-- NOTE: gym-accounts.sql OWNS the final has_active_entitlement (grace-period
-- arm + verified-gym arm). Re-running THIS file reverts it - re-run
-- gym-accounts.sql afterward. This copy is kept only for fresh-database setup.
create or replace function public.has_active_entitlement(p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.entitlements e
    where e.user_id = p_user
      and (
        e.source = 'comp'                                    -- comp never expires
        or (
          e.status in ('active','grace')
          and (e.expires_at is null or e.expires_at > now())
        )
      )
  );
$$;

-- Convenience wrapper for the current caller (used by the client on launch).
create or replace function public.my_subscription()
returns table (
  active      boolean,
  status      text,
  source      text,
  product_id  text,
  expires_at  timestamptz,
  auto_renew  boolean
)
language sql stable security definer set search_path = public as $$
  select
    public.has_active_entitlement(auth.uid()),
    e.status, e.source, e.product_id, e.expires_at, e.auto_renew
  from public.entitlements e
  where e.user_id = auth.uid()
  union all
  -- no row yet → report inactive without forcing the client to special-case null
  select false, null, null, null, null::timestamptz, null
  where not exists (select 1 from public.entitlements where user_id = auth.uid())
  limit 1;
$$;

grant execute on function public.has_active_entitlement(uuid) to authenticated;
grant execute on function public.my_subscription() to authenticated;

-- ---- Complimentary access (admin / service-role only) ----------------------
-- Not granted to `authenticated`; callable from the SQL editor or an edge
-- function running as the service role. Used to comp the App Review account and
-- (later) gym-sponsored members.
create or replace function public.grant_comp_entitlement(p_user uuid, p_note text default null)
returns void
language sql security definer set search_path = public as $$
  insert into public.entitlements (user_id, product_id, source, status, expires_at)
  values (p_user, coalesce(p_note, 'comp'), 'comp', 'active', null)
  on conflict (user_id) do update
    set source = 'comp', status = 'active', expires_at = null,
        product_id = excluded.product_id, updated_at = now()
    -- Don't clobber an ACTIVE paying (Apple/Google) subscription with a comp row:
    -- they already have access, and overwriting loses the real store state until
    -- the next renewal re-validates. Only comp when there's no live store sub.
    where entitlements.source not in ('apple','google')
       or entitlements.status not in ('active','grace')
       or (entitlements.expires_at is not null and entitlements.expires_at <= now());
$$;

-- SECURITY: Postgres grants EXECUTE to PUBLIC on new functions by default, and
-- Supabase additionally grants it to anon/authenticated in the public schema,
-- which PostgREST exposes as an RPC. Without this revoke, ANY signed-in user
-- could POST /rest/v1/rpc/grant_comp_entitlement with their own id and self-grant
-- a permanent free subscription (total paywall bypass). Service-role edge
-- functions and the SQL editor (postgres) bypass this revoke and still work.
revoke execute on function public.grant_comp_entitlement(uuid, text) from public, anon, authenticated;

-- Comp the App Review demo account so the reviewer always gets past the paywall,
-- independent of StoreKit sandbox behaviour. (No-op if the account isn't present.)
insert into public.entitlements (user_id, product_id, source, status, expires_at)
select u.id, 'comp:app-review', 'comp', 'active', null
from auth.users u
where lower(u.email) = 'applereview@rollforrating.com'
on conflict (user_id) do update
  set source = 'comp', status = 'active', expires_at = null, updated_at = now();

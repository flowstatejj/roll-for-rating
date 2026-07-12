-- ============================================================================
-- Roll for Rating — Founder affiliate program (single-level)
-- Run AFTER subscriptions.sql + admin-founders.sql. Safe to re-run.
--
-- RUN ORDER: affiliate-statements.sql must run AFTER this file and OWNS the
-- final versions of referral_est_cents and admin_referral_owed (it overrides
-- both). Re-running referrals.sql ALONE reverts those overrides - always
-- re-run affiliate-statements.sql after this file.
--
-- Each FOUNDING member gets a referral code/link. Anyone who signs up with it is
-- tied to that founder for life. The founder earns 50% of the NET revenue of
-- each referred subscriber. "Net" = price minus Apple's commission; refunds /
-- revoked subs are excluded. Because the app can't see Apple's exact per-user
-- commission tier or partial refunds, the earnings here are an ESTIMATE the
-- owner reconciles against the App Store Connect payout report before paying.
-- Payouts happen OUT OF APP (we never move money in-app); the owner records them.
-- ============================================================================

-- ---- Tables ---------------------------------------------------------------

create table if not exists public.referral_codes (
  founder_id uuid primary key references public.profiles(id) on delete cascade,
  code       text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.referrals (
  referred_user_id uuid primary key references public.profiles(id) on delete cascade,
  referrer_id      uuid not null references public.profiles(id) on delete cascade,
  code             text not null,
  created_at       timestamptz not null default now(),
  constraint no_self_referral check (referrer_id <> referred_user_id)
);
create index if not exists referrals_referrer_idx on public.referrals (referrer_id);

create table if not exists public.referral_payouts (
  id          uuid primary key default gen_random_uuid(),
  founder_id  uuid not null references public.profiles(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  note        text,
  paid_at     timestamptz not null default now(),
  created_by  uuid references public.profiles(id)
);
create index if not exists referral_payouts_founder_idx on public.referral_payouts (founder_id);

alter table public.referral_codes  enable row level security;
alter table public.referrals       enable row level security;
alter table public.referral_payouts enable row level security;

-- A founder reads referrals they own; the referred user reads their own; admins all.
drop policy if exists "referrals_read" on public.referrals;
create policy "referrals_read" on public.referrals for select to authenticated
  using (referrer_id = auth.uid() or referred_user_id = auth.uid() or public.is_admin());

-- ---- Earnings estimate -----------------------------------------------------
-- Monthly net to the founder (50% of price after Apple's commission), per
-- referred subscriber. Apple commission is taken as a flat 30% (conservative;
-- it can drop to 15% after a year, which only makes the estimate low). Price is
-- product-aware so the $9.99 family plan slots in automatically later.
create or replace function public.referral_est_cents(p_user uuid)
returns integer language sql stable security definer set search_path = public as $$
  with e as (
    select * from public.entitlements
     where user_id = p_user and source = 'apple' and status <> 'revoked'
     limit 1
  ),
  calc as (
    select
      case when product_id ilike '%family%' then 999 else 499 end as price_cents,
      -- paid window: from trial end (purchase + 7 days) to now or expiry.
      greatest(0, floor(
        extract(epoch from (least(now(), coalesce(expires_at, now())) - (purchased_at + interval '7 days'))) / (30 * 86400)
      )::int + 1) as paid_months,
      purchased_at
    from e
  )
  select coalesce((
    select case when purchased_at is null or paid_months <= 0 then 0
                else paid_months * round(round(price_cents * 0.70) * 0.50)::int end
    from calc
  ), 0);
$$;
grant execute on function public.referral_est_cents(uuid) to authenticated;

-- ---- Codes -----------------------------------------------------------------
-- The caller's referral code (founders only); generates a unique one on first call.
create or replace function public.my_referral_code()
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); existing text; gen text; tries int := 0;
begin
  if not exists (select 1 from public.profiles where id = me and is_founding_member) then
    raise exception 'Referral codes are for founding members.';
  end if;
  select code into existing from public.referral_codes where founder_id = me;
  if existing is not null then return existing; end if;
  loop
    -- 6 chars, unambiguous alphabet.
    gen := upper(substr(translate(encode(gen_random_bytes(6), 'base64'), '+/=Ol01I', 'XYZ23489'), 1, 6));
    exit when not exists (select 1 from public.referral_codes where code = gen);
    tries := tries + 1; if tries > 12 then raise exception 'Could not allocate a code, retry.'; end if;
  end loop;
  insert into public.referral_codes (founder_id, code) values (me, gen);
  return gen;
end; $$;
grant execute on function public.my_referral_code() to authenticated;

-- The signed-in user redeems a referral code (once, at/after signup). No-op if
-- they already have a referrer, the code is unknown, or it's their own.
create or replace function public.redeem_referral_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); founder uuid; fname text; norm text := upper(btrim(p_code));
begin
  if me is null or norm = '' then return jsonb_build_object('ok', false); end if;
  if exists (select 1 from public.referrals where referred_user_id = me) then
    return jsonb_build_object('ok', false, 'reason', 'already');
  end if;
  select founder_id into founder from public.referral_codes where code = norm;
  if founder is null or founder = me then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  insert into public.referrals (referred_user_id, referrer_id, code) values (me, founder, norm)
    on conflict (referred_user_id) do nothing;
  select display_name into fname from public.profiles where id = founder;
  return jsonb_build_object('ok', true, 'name', fname);
end; $$;
grant execute on function public.redeem_referral_code(text) to authenticated;

-- ---- Dashboards ------------------------------------------------------------
-- The caller-founder's referrals + estimated earnings.
create or replace function public.founder_referrals()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'code', (select code from public.referral_codes where founder_id = auth.uid()),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'display_name', p.display_name, 'username', p.username,
        'active', public.has_active_entitlement(p.id),
        'est_cents', public.referral_est_cents(p.id),
        'joined', r.created_at
      ) order by r.created_at desc)
      from public.referrals r join public.profiles p on p.id = r.referred_user_id
      where r.referrer_id = auth.uid()
    ), '[]'::jsonb),
    'total', (select count(*) from public.referrals where referrer_id = auth.uid()),
    'active', (select count(*) from public.referrals r where r.referrer_id = auth.uid() and public.has_active_entitlement(r.referred_user_id)),
    'est_total_cents', coalesce((select sum(public.referral_est_cents(r.referred_user_id)) from public.referrals r where r.referrer_id = auth.uid()), 0),
    'paid_cents', coalesce((select sum(amount_cents) from public.referral_payouts where founder_id = auth.uid()), 0)
  );
$$;
grant execute on function public.founder_referrals() to authenticated;

-- Owner view: estimated amount owed to every founder, net of recorded payouts.
create or replace function public.admin_referral_owed()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_admin() then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object(
      'founder_id', f.id, 'name', f.display_name, 'code', rc.code,
      'referred', (select count(*) from public.referrals r where r.referrer_id = f.id),
      'est_total_cents', coalesce((select sum(public.referral_est_cents(r.referred_user_id)) from public.referrals r where r.referrer_id = f.id), 0),
      'paid_cents', coalesce((select sum(amount_cents) from public.referral_payouts where founder_id = f.id), 0)
    ) order by f.display_name)
    from public.profiles f
    left join public.referral_codes rc on rc.founder_id = f.id
    where f.is_founding_member
      and exists (select 1 from public.referrals r where r.referrer_id = f.id)
  ), '[]'::jsonb) end;
$$;
grant execute on function public.admin_referral_owed() to authenticated;

-- Owner records a payout made out-of-app to a founder.
create or replace function public.record_referral_payout(p_founder uuid, p_amount_cents integer, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_amount_cents <= 0 then raise exception 'Amount must be positive'; end if;
  insert into public.referral_payouts (founder_id, amount_cents, note, created_by)
  values (p_founder, p_amount_cents, p_note, auth.uid());
end; $$;
grant execute on function public.record_referral_payout(uuid, integer, text) to authenticated;

notify pgrst, 'reload schema';
select 'referrals installed' as ok;

-- ============================================================================
-- Roll for Rating - Affiliate monthly statements (Phase 1+2)
-- Run AFTER referrals.sql. Safe to re-run.
--
-- Turns the live affiliate ESTIMATE into a frozen monthly LEDGER you can pay
-- against. On the 1st of each month a pg_cron job snapshots, per founder:
-- Apple/Android paying-member counts, new signups, gross, store fees, net,
-- and the founder's share. Paid statements are immutable. Founders get an
-- in-app notification when their statement lands (push rides the existing
-- pipeline if deployed). Also fixes referral_est_cents to count Google subs.
--
-- Fee model lives in affiliate_config so it is tunable without redeploying:
--   apple_fee     0.30 (drop to 0.15 once enrolled in Apple's Small Business
--                       Program: update public.affiliate_config
--                       set value = 0.15 where key = 'apple_fee';)
--   google_fee    0.15 (Google's subscription rate)
--   founder_share 0.50 (founder's cut of net)
-- The numbers remain a model; reconcile against App Store Connect / Play
-- payout reports before large payouts. US-only pricing keeps this clean.
-- ============================================================================

-- ---- Config -----------------------------------------------------------------

create table if not exists public.affiliate_config (
  key   text primary key,
  value numeric not null
);
alter table public.affiliate_config enable row level security;
-- No policies: read via the definer functions only.

insert into public.affiliate_config (key, value) values
  ('apple_fee', 0.30), ('google_fee', 0.15), ('founder_share', 0.50)
on conflict (key) do nothing;

create or replace function public.affiliate_cfg(p_key text, p_default numeric)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.affiliate_config where key = p_key), p_default);
$$;

-- ---- Statements table -------------------------------------------------------

create table if not exists public.affiliate_statements (
  id            uuid primary key default gen_random_uuid(),
  founder_id    uuid not null references public.profiles(id) on delete cascade,
  month         date not null,            -- first day of the statement month
  apple_active  integer not null default 0,
  google_active integer not null default 0,
  signups       integer not null default 0,  -- new referred signups that month
  gross_cents   integer not null default 0,
  fees_cents    integer not null default 0,
  net_cents     integer not null default 0,
  share_cents   integer not null default 0,  -- what the founder is owed
  status        text not null default 'pending' check (status in ('pending','paid')),
  paid_at       timestamptz,
  paid_by       uuid references public.profiles(id),
  generated_at  timestamptz not null default now(),
  unique (founder_id, month)
);
create index if not exists affiliate_statements_month_idx on public.affiliate_statements (month desc);

alter table public.affiliate_statements enable row level security;
drop policy if exists "statements_read" on public.affiliate_statements;
create policy "statements_read" on public.affiliate_statements for select to authenticated
  using (founder_id = auth.uid() or public.is_admin());

-- ---- Generation -------------------------------------------------------------
-- Snapshot one month (default: last month). A referred member counts as paying
-- if their trial (7 days) ended before the month closed and their entitlement
-- covered any part of the month and was never revoked (refunds drop out).
-- Members joining mid-month count the full month (simple + founder-friendly).
-- Comped accounts and family MEMBERS pay nothing so they earn nothing; only
-- the actual purchaser's entitlement generates revenue. Paid statements are
-- never overwritten on re-runs; pending ones refresh.
create or replace function public.generate_affiliate_statements(p_month date default null)
returns jsonb language sql security definer set search_path = public as $$
  with m as (
    select date_trunc('month', coalesce(p_month, (now() - interval '1 month')::date))::date as ms,
           (date_trunc('month', coalesce(p_month, (now() - interval '1 month')::date)) + interval '1 month')::date as me
  ),
  cfg as (
    select public.affiliate_cfg('apple_fee', 0.30) as apple_fee,
           public.affiliate_cfg('google_fee', 0.15) as google_fee,
           public.affiliate_cfg('founder_share', 0.50) as share
  ),
  paying as (
    select r.referrer_id, e.source,
           case when e.product_id ilike '%family%' then 999 else 499 end as price_cents,
           case when e.source = 'apple'
                then round((case when e.product_id ilike '%family%' then 999 else 499 end) * (select apple_fee from cfg))::int
                else round((case when e.product_id ilike '%family%' then 999 else 499 end) * (select google_fee from cfg))::int
           end as fee_cents
    from public.referrals r
    join public.entitlements e on e.user_id = r.referred_user_id
    cross join m
    where e.source in ('apple','google')
      and e.status <> 'revoked'
      and r.created_at < m.me            -- a code redeemed today never counts for a prior month
      and e.purchased_at + interval '7 days' < m.me
      and coalesce(e.expires_at, 'infinity'::timestamptz) > m.ms
  ),
  agg as (
    select f.referrer_id as founder_id,
           count(*) filter (where f.source = 'apple') as apple_active,
           count(*) filter (where f.source = 'google') as google_active,
           coalesce(sum(f.price_cents), 0)::int as gross_cents,
           coalesce(sum(f.fee_cents), 0)::int as fees_cents,
           coalesce(sum(f.price_cents - f.fee_cents), 0)::int as net_cents,
           coalesce(sum(round((f.price_cents - f.fee_cents) * (select share from cfg))), 0)::int as share_cents
    from paying f group by f.referrer_id
  ),
  joins as (
    select r.referrer_id as founder_id, count(*)::int as signups
    from public.referrals r cross join m
    where r.created_at >= m.ms and r.created_at < m.me
    group by r.referrer_id
  ),
  rows_ as (
    select coalesce(a.founder_id, j.founder_id) as founder_id,
           (select ms from m) as month,
           coalesce(a.apple_active, 0) as apple_active,
           coalesce(a.google_active, 0) as google_active,
           coalesce(j.signups, 0) as signups,
           coalesce(a.gross_cents, 0) as gross_cents,
           coalesce(a.fees_cents, 0) as fees_cents,
           coalesce(a.net_cents, 0) as net_cents,
           coalesce(a.share_cents, 0) as share_cents
    from agg a full outer join joins j on j.founder_id = a.founder_id
  ),
  up as (
    insert into public.affiliate_statements
      (founder_id, month, apple_active, google_active, signups, gross_cents, fees_cents, net_cents, share_cents)
    select founder_id, month, apple_active, google_active, signups, gross_cents, fees_cents, net_cents, share_cents
    from rows_
    on conflict (founder_id, month) do update set
      apple_active = excluded.apple_active,
      google_active = excluded.google_active,
      signups = excluded.signups,
      gross_cents = excluded.gross_cents,
      fees_cents = excluded.fees_cents,
      net_cents = excluded.net_cents,
      share_cents = excluded.share_cents,
      generated_at = now()
    where public.affiliate_statements.status = 'pending'
    returning founder_id, share_cents, apple_active + google_active as members, (xmax = 0) as inserted
  ),
  notif as (
    -- One bell (+ push, when the pipeline is live) per founder, first run only.
    insert into public.notifications (user_id, type, title, body, data)
    select founder_id, 'affiliate', 'Affiliate statement',
           '$' || to_char(share_cents / 100.0, 'FM990.00') || ' earned from ' || members || ' active members last month',
           jsonb_build_object('k', 'affiliate.statement',
                              'amt', '$' || to_char(share_cents / 100.0, 'FM990.00'),
                              'n', members::text)
    from up where inserted and share_cents > 0
    returning 1
  )
  select jsonb_build_object(
    'month', (select ms from m),
    'founders', (select count(*) from up),
    'total_share_cents', coalesce((select sum(share_cents) from up), 0),
    'notified', (select count(*) from notif)
  );
$$;
revoke execute on function public.generate_affiliate_statements(date) from public, anon, authenticated;

-- Admin-callable wrapper (the app's Generate button + backfill).
create or replace function public.admin_generate_statements(p_month date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return public.generate_affiliate_statements(p_month);
end; $$;
grant execute on function public.admin_generate_statements(date) to authenticated;

-- ---- Reads ------------------------------------------------------------------

-- The caller-founder's statements, newest first.
create or replace function public.founder_statements()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'month', s.month,
      'apple_active', s.apple_active, 'google_active', s.google_active,
      'signups', s.signups, 'gross_cents', s.gross_cents, 'fees_cents', s.fees_cents,
      'net_cents', s.net_cents, 'share_cents', s.share_cents,
      'status', s.status, 'paid_at', s.paid_at
    ) order by s.month desc)
    from (select * from public.affiliate_statements
          where founder_id = auth.uid() order by month desc limit 24) s
  ), '[]'::jsonb);
$$;
grant execute on function public.founder_statements() to authenticated;

-- Admin: every founder's statement for the most recent generated month, PLUS
-- any still-pending statement from an earlier month (nothing owed can hide
-- behind a newer generation). The single where-clause OR dedupes naturally:
-- a latest-month pending row matches both arms but appears once. Each row
-- carries its own 'month' so the app can label overdue months.
create or replace function public.admin_affiliate_statements()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_admin() then jsonb_build_object('month', null, 'rows', '[]'::jsonb) else
    jsonb_build_object(
      'month', (select max(month) from public.affiliate_statements),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', s.id, 'founder_id', s.founder_id, 'name', f.display_name,
          'month', s.month,
          'apple_active', s.apple_active, 'google_active', s.google_active,
          'signups', s.signups, 'gross_cents', s.gross_cents, 'net_cents', s.net_cents,
          'share_cents', s.share_cents,
          'status', s.status, 'paid_at', s.paid_at
        ) order by s.month desc, s.share_cents desc, f.display_name)
        from public.affiliate_statements s
        join public.profiles f on f.id = s.founder_id
        where s.month = (select max(month) from public.affiliate_statements)
           or s.status = 'pending'
      ), '[]'::jsonb)
    ) end;
$$;
grant execute on function public.admin_affiliate_statements() to authenticated;

-- Admin marks a statement paid; also records the legacy payout row so the
-- lifetime estimate view stays consistent.
create or replace function public.admin_mark_statement_paid(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_founder uuid; v_share int; v_month date;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  update public.affiliate_statements
     set status = 'paid', paid_at = now(), paid_by = auth.uid()
   where id = p_id and status = 'pending'
   returning founder_id, share_cents, month into v_founder, v_share, v_month;
  if v_founder is null then raise exception 'Statement not found or already paid'; end if;
  if v_share > 0 then
    insert into public.referral_payouts (founder_id, amount_cents, note, created_by)
    values (v_founder, v_share, 'Statement ' || to_char(v_month, 'YYYY-MM'), auth.uid());
  end if;
end; $$;
grant execute on function public.admin_mark_statement_paid(uuid) to authenticated;

-- ---- Leaderboard (Phase 2) --------------------------------------------------
-- Founders see the top 20 founders by active referred members. Friendly
-- competition; only names + counts + lifetime share are exposed.
create or replace function public.affiliate_leaderboard()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not exists (
    select 1 from public.profiles where id = auth.uid() and (is_founding_member or is_admin)
  ) then '[]'::jsonb else coalesce((
    select jsonb_agg(row_ order by row_->>'sort_active' is null) from (
      select jsonb_build_object(
        'founder_id', f.id, 'name', f.display_name,
        'active', (select count(*) from public.referrals r
                   where r.referrer_id = f.id and public.has_active_entitlement(r.referred_user_id)),
        'referred', (select count(*) from public.referrals r where r.referrer_id = f.id),
        'lifetime_cents', coalesce((select sum(share_cents) from public.affiliate_statements s
                                    where s.founder_id = f.id), 0)
      ) as row_
      from public.profiles f
      where f.is_founding_member
        and exists (select 1 from public.referrals r where r.referrer_id = f.id)
      order by (select count(*) from public.referrals r
                where r.referrer_id = f.id and public.has_active_entitlement(r.referred_user_id)) desc,
               (select count(*) from public.referrals r where r.referrer_id = f.id) desc
      limit 20
    ) t
  ), '[]'::jsonb) end;
$$;
grant execute on function public.affiliate_leaderboard() to authenticated;

-- ---- Fix: the live estimate now counts Google subs too ----------------------
-- (referrals.sql only counted source='apple'; Android subscribers earned $0.)
-- The paid window is also floored at the REFERRAL date: a subscriber who
-- redeemed a founder's code months into their subscription only earns the
-- founder from redemption onward, not retroactively. greatest() ignores the
-- null when no referral row exists (direct call on an unreferred user).
create or replace function public.referral_est_cents(p_user uuid)
returns integer language sql stable security definer set search_path = public as $$
  with e as (
    select * from public.entitlements
     where user_id = p_user and source in ('apple','google') and status <> 'revoked'
     limit 1
  ),
  calc as (
    select
      case when product_id ilike '%family%' then 999 else 499 end as price_cents,
      case when source = 'apple' then public.affiliate_cfg('apple_fee', 0.30)
           else public.affiliate_cfg('google_fee', 0.15) end as fee,
      greatest(0, floor(
        extract(epoch from (least(now(), coalesce(expires_at, now()))
          - greatest(purchased_at + interval '7 days',
                     (select created_at from public.referrals where referred_user_id = p_user)))) / (30 * 86400)
      )::int + 1) as paid_months,
      purchased_at
    from e
  )
  select coalesce((
    select case when purchased_at is null or paid_months <= 0 then 0
                else paid_months * round(round(price_cents * (1 - fee)) * public.affiliate_cfg('founder_share', 0.50))::int end
    from calc
  ), 0);
$$;
grant execute on function public.referral_est_cents(uuid) to authenticated;

-- ---- Admin drill-down + live pulse -------------------------------------------

-- Admin: one founder's referred members, same shape founder_referrals builds
-- for the founder themself (display_name, username, active, est_cents, joined).
create or replace function public.admin_founder_referrals(p_founder uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_admin() then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'display_name', p.display_name, 'username', p.username,
      'active', public.has_active_entitlement(p.id),
      'est_cents', public.referral_est_cents(p.id),
      'joined', r.created_at
    ) order by r.created_at desc)
    from public.referrals r join public.profiles p on p.id = r.referred_user_id
    where r.referrer_id = p_founder
  ), '[]'::jsonb) end;
$$;
grant execute on function public.admin_founder_referrals(uuid) to authenticated;

-- Override of referrals.sql's admin_referral_owed: same rows + launch-week
-- pulse scalars per founder (this file runs AFTER referrals.sql and owns the
-- final version). paying_* mirror the statement 'paying' test, evaluated now:
-- store entitlement, never revoked, trial (7 days) over, coverage still open.
create or replace function public.admin_referral_owed()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_admin() then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object(
      'founder_id', f.id, 'name', f.display_name, 'code', rc.code,
      'referred', (select count(*) from public.referrals r where r.referrer_id = f.id),
      'est_total_cents', coalesce((select sum(public.referral_est_cents(r.referred_user_id)) from public.referrals r where r.referrer_id = f.id), 0),
      'paid_cents', coalesce((select sum(amount_cents) from public.referral_payouts where founder_id = f.id), 0),
      'signups_7d', (select count(*) from public.referrals r
                     where r.referrer_id = f.id and r.created_at > now() - interval '7 days'),
      'signups_month', (select count(*) from public.referrals r
                        where r.referrer_id = f.id and r.created_at >= date_trunc('month', now())),
      'paying_apple', (select count(*) from public.referrals r
                       join public.entitlements e on e.user_id = r.referred_user_id
                       where r.referrer_id = f.id and e.source = 'apple' and e.status <> 'revoked'
                         and e.purchased_at + interval '7 days' < now()
                         and coalesce(e.expires_at, 'infinity'::timestamptz) > now()),
      'paying_google', (select count(*) from public.referrals r
                        join public.entitlements e on e.user_id = r.referred_user_id
                        where r.referrer_id = f.id and e.source = 'google' and e.status <> 'revoked'
                          and e.purchased_at + interval '7 days' < now()
                          and coalesce(e.expires_at, 'infinity'::timestamptz) > now())
    ) order by f.display_name)
    from public.profiles f
    left join public.referral_codes rc on rc.founder_id = f.id
    where f.is_founding_member
      and exists (select 1 from public.referrals r where r.referrer_id = f.id)
  ), '[]'::jsonb) end;
$$;
grant execute on function public.admin_referral_owed() to authenticated;

-- ---- Monthly schedule ---------------------------------------------------------
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('affiliate-statements');
exception when others then
  null; -- job didn't exist yet
end $$;

select cron.schedule(
  'affiliate-statements',
  '0 12 1 * *', -- 12:00 UTC on the 1st (~6 AM Mountain) for the month just ended
  $$select public.generate_affiliate_statements()$$
);

notify pgrst, 'reload schema';
select 'affiliate statements installed' as ok;

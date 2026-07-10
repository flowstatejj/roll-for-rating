// Founder affiliate program — referral codes/links + 50%-net earnings (estimate).
// Backed by SECURITY DEFINER RPCs in supabase/referrals.sql.
import { supabase } from './supabase';

/** AsyncStorage key for a referral code captured at signup, redeemed on first session. */
export const PENDING_REFERRAL_KEY = 'pendingReferral';

export interface ReferredMember {
  id: string;
  display_name: string;
  username: string;
  active: boolean;
  est_cents: number;
  joined: string;
}

export interface FounderReferrals {
  code: string | null;
  members: ReferredMember[];
  total: number;
  active: number;
  est_total_cents: number;
  paid_cents: number;
}

export interface OwedRow {
  founder_id: string;
  name: string;
  code: string | null;
  referred: number;
  est_total_cents: number;
  paid_cents: number;
}

/** Founder's referral code, generated on first call. Founders only. */
export async function myReferralCode(): Promise<string> {
  const { data, error } = await supabase.rpc('my_referral_code');
  if (error) throw error;
  return (data as string) ?? '';
}

/** Redeem a referral code for the signed-in user (once). Best-effort.
 *  `reason` is set on a definitive server outcome (already/invalid); absent means
 *  the call didn't reach the server (caller should retry later). */
export async function redeemReferralCode(code: string): Promise<{ ok: boolean; name?: string; reason?: string }> {
  const { data, error } = await supabase.rpc('redeem_referral_code', { p_code: code });
  if (error) return { ok: false };
  const row = (data ?? {}) as { ok?: boolean; name?: string; reason?: string };
  return { ok: !!row.ok, name: row.name, reason: row.reason };
}

/** The caller-founder's referrals + estimated earnings. */
export async function fetchFounderReferrals(): Promise<FounderReferrals> {
  const { data, error } = await supabase.rpc('founder_referrals');
  if (error) throw error;
  const r = (data ?? {}) as Partial<FounderReferrals>;
  return {
    code: r.code ?? null,
    members: r.members ?? [],
    total: r.total ?? 0,
    active: r.active ?? 0,
    est_total_cents: r.est_total_cents ?? 0,
    paid_cents: r.paid_cents ?? 0,
  };
}

/** Owner: estimated amount owed to every founder. Admins only (returns [] otherwise). */
export async function fetchReferralOwed(): Promise<OwedRow[]> {
  const { data, error } = await supabase.rpc('admin_referral_owed');
  if (error) throw error;
  return (data ?? []) as OwedRow[];
}

/** Owner records a payout made out-of-app. */
export async function recordReferralPayout(founderId: string, amountCents: number, note?: string): Promise<void> {
  const { error } = await supabase.rpc('record_referral_payout', {
    p_founder: founderId,
    p_amount_cents: amountCents,
    p_note: note ?? null,
  });
  if (error) throw error;
}

/** A shareable signup link that carries the founder's code. */
export function referralLink(code: string): string {
  // rfr-site.onrender.com is the live site; roll.flowstatejj.com does NOT resolve.
  return `https://rfr-site.onrender.com/?ref=${encodeURIComponent(code)}`;
}

export const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// ---------------------------------------------------------------------------
// Monthly statements (frozen ledger) + leaderboard
// ---------------------------------------------------------------------------

export interface FounderStatement {
  id: string;
  month: string; // first day of the statement month (ISO date)
  apple_active: number;
  google_active: number;
  signups: number;
  gross_cents: number;
  fees_cents: number;
  net_cents: number;
  share_cents: number;
  status: 'pending' | 'paid';
  paid_at: string | null;
}

export interface AdminStatementRow {
  id: string;
  founder_id: string;
  name: string;
  apple_active: number;
  google_active: number;
  signups: number;
  share_cents: number;
  status: 'pending' | 'paid';
  paid_at: string | null;
}

export interface LeaderboardRow {
  founder_id: string;
  name: string;
  active: number;
  referred: number;
  lifetime_cents: number;
}

/** The caller-founder's monthly statements, newest first (up to 24). */
export async function fetchFounderStatements(): Promise<FounderStatement[]> {
  const { data, error } = await supabase.rpc('founder_statements');
  if (error) throw error;
  return (data ?? []) as FounderStatement[];
}

/** Admin: every founder's statement for the latest generated month. */
export async function fetchAdminStatements(): Promise<{ month: string | null; rows: AdminStatementRow[] }> {
  const { data, error } = await supabase.rpc('admin_affiliate_statements');
  if (error) throw error;
  const r = (data ?? {}) as { month?: string | null; rows?: AdminStatementRow[] };
  return { month: r.month ?? null, rows: r.rows ?? [] };
}

/** Admin: mark one statement paid (also records the legacy payout row). */
export async function markStatementPaid(statementId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_mark_statement_paid', { p_id: statementId });
  if (error) throw error;
}

/** Admin: (re)generate statements for a month (defaults to last month). */
export async function generateStatements(): Promise<void> {
  const { error } = await supabase.rpc('admin_generate_statements');
  if (error) throw error;
}

/** Top founders by active referred members. Founders + admins only. */
export async function fetchAffiliateLeaderboard(): Promise<LeaderboardRow[]> {
  const { data, error } = await supabase.rpc('affiliate_leaderboard');
  if (error) throw error;
  return (data ?? []) as LeaderboardRow[];
}

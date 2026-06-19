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
  return `https://roll.flowstatejj.com/join?ref=${encodeURIComponent(code)}`;
}

export const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

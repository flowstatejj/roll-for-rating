// Elite memberships — a founding member grants up to 10 complimentary
// free-access memberships. Backed by SECURITY DEFINER RPCs (see
// supabase/elite-memberships.sql) that re-check is_founding_member + the quota.
import { redeemReferralCode } from './referrals';
import { supabase } from './supabase';

export interface EliteMember {
  id: string;
  display_name: string;
  username: string;
  belt_rank: string;
  rating: number;
  granted_at: string;
}

export interface EliteGrants {
  quota: number;
  used: number;
  members: EliteMember[];
}

/** Grant an elite (free-access) membership by account email. Returns whether a
 *  matching account was found (they must have signed up first). */
export async function grantElite(
  email: string,
): Promise<{ found: boolean; name: string | null; already: boolean }> {
  const { data, error } = await supabase.rpc('grant_elite', { p_email: email.trim() });
  if (error) throw error;
  const row = (data ?? {}) as { found?: boolean; name?: string | null; already?: boolean };
  return { found: !!row.found, name: row.name ?? null, already: !!row.already };
}

/** Revoke an elite membership the caller granted. */
export async function revokeElite(memberId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_elite', { p_member: memberId });
  if (error) throw error;
}

/** The caller's elite members + quota usage. */
export async function fetchMyEliteGrants(): Promise<EliteGrants> {
  const { data, error } = await supabase.rpc('my_elite_grants');
  if (error) throw error;
  const row = (data ?? {}) as Partial<EliteGrants>;
  return { quota: row.quota ?? 10, used: row.used ?? 0, members: row.members ?? [] };
}

// --- Shareable elite invite links -------------------------------------------
// A founder mints a code and shares the link; a friend redeems it (captured at
// sign-up, or pasted in-app) and gets elite on the spot. See elite-invites.sql.

/** AsyncStorage key for a code captured from a deep link before sign-up. */
export const PENDING_ELITE_INVITE_KEY = 'pendingEliteInvite';

export interface EliteInviteCode {
  id: string;
  code: string;
  claimed: boolean;
  created_at: string;
  expires_at: string;
}

export interface MyEliteInvites {
  slots_left: number;
  codes: EliteInviteCode[];
}

/** Mint a new shareable elite invite code (reserves one of the founder's slots). */
export async function mintEliteInviteCode(): Promise<string> {
  const { data, error } = await supabase.rpc('mint_elite_invite_code');
  if (error) throw error;
  return (data as string) ?? '';
}

/** Redeem an elite invite code — the caller gets elite access. */
export async function redeemEliteInviteCode(
  code: string,
): Promise<{ ok: boolean; grantor_name?: string; reason?: string }> {
  const { data, error } = await supabase.rpc('redeem_elite_invite_code', { p_code: code.trim() });
  if (error) return { ok: false };
  const row = (data ?? {}) as { ok?: boolean; grantor_name?: string; reason?: string };
  return { ok: !!row.ok, grantor_name: row.grantor_name, reason: row.reason };
}

/** The caller's outstanding invite codes + slots left. */
export async function fetchMyEliteInvites(): Promise<MyEliteInvites> {
  const { data, error } = await supabase.rpc('my_elite_invite_codes');
  if (error) throw error;
  const row = (data ?? {}) as Partial<MyEliteInvites>;
  return { slots_left: row.slots_left ?? 0, codes: row.codes ?? [] };
}

/** The shareable web link for an elite invite code (deep-links into sign-up). */
export function eliteInviteLink(code: string): string {
  // rfr-site.onrender.com is the live site; roll.flowstatejj.com does NOT resolve.
  return `https://rfr-site.onrender.com/?elite=${encodeURIComponent(code)}`;
}

// --- In-app code entry (Settings + paywall) ----------------------------------

/** Outcome of applying a pasted code whose kind (referral vs elite) is unknown. */
export type CodeApplyOutcome =
  | { kind: 'referral'; name: string | null }
  | { kind: 'referralAlready' }
  | { kind: 'elite'; grantorName: string | null }
  | { kind: 'eliteAlready' }
  | { kind: 'invalid' };

/** Apply a code the user pasted in-app without knowing which kind it is:
 *  referral attribution first, then the elite invite path (the same redeemer
 *  the signup flow uses). Elite is still tried when the referral RPC says
 *  'already' - an account that already has a referrer must remain able to
 *  redeem an elite invite. */
export async function applyInviteOrReferralCode(raw: string): Promise<CodeApplyOutcome> {
  const code = raw.trim().toUpperCase();
  const ref = await redeemReferralCode(code);
  if (ref.ok) return { kind: 'referral', name: ref.name ?? null };
  const el = await redeemEliteInviteCode(code);
  if (el.ok) return { kind: 'elite', grantorName: el.grantor_name ?? null };
  if (el.reason === 'already_elite') return { kind: 'eliteAlready' };
  if (ref.reason === 'already') return { kind: 'referralAlready' };
  return { kind: 'invalid' };
}

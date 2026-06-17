// Elite memberships — a founding member grants up to 10 complimentary
// free-access memberships. Backed by SECURITY DEFINER RPCs (see
// supabase/elite-memberships.sql) that re-check is_founding_member + the quota.
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

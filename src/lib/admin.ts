// Admin actions — backed by SECURITY DEFINER functions that re-check is_admin()
// server-side (see supabase/admin-founders.sql). Non-admins get an error.
import { supabase } from './supabase';

export interface Founder {
  id: string;
  display_name: string;
  username: string;
  belt_rank: string;
  rating: number;
}

/** Flag (or unflag) a founding member by their account email. Returns whether a
 *  matching account was found (they must have signed up first). */
export async function makeFoundingByEmail(
  email: string,
  on = true,
): Promise<{ found: boolean; display_name: string | null }> {
  const { data, error } = await supabase.rpc('admin_make_founding_by_email', {
    p_email: email.trim(),
    p_on: on,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { found: !!row?.found, display_name: row?.display_name ?? null };
}

/** Flag/unflag a founding member by user id (used to remove from the list). */
export async function setFoundingById(userId: string, on: boolean): Promise<void> {
  const { error } = await supabase.rpc('admin_set_founding_member', { p_user: userId, p_on: on });
  if (error) throw error;
}

export async function listFounders(): Promise<Founder[]> {
  const { data, error } = await supabase.rpc('admin_list_founders');
  if (error) throw error;
  return (data ?? []) as Founder[];
}

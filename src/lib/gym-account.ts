// Gym accounts - free, verified organizer accounts (no competing).
// Backed by SECURITY DEFINER RPCs in supabase/gym-accounts.sql.
import { supabase } from './supabase';

export interface GymApplication {
  status: 'pending' | 'approved' | 'denied';
  gym_name: string;
  note: string | null;
  created_at: string;
}

export interface AdminGymApplication {
  id: string;
  profile_id: string;
  gym_name: string;
  address: string;
  link: string;
  owner_name: string;
  created_at: string;
  account_name: string;
  account_username: string;
  /** participating members already listing a same-named gym in the app */
  vouch: number;
}

/** Apply (or re-apply after a denial). Works while paywalled. */
export async function applyGymAccount(
  gymName: string, address: string, link: string, ownerName: string,
): Promise<void> {
  const { error } = await supabase.rpc('apply_gym_account', {
    p_gym_name: gymName, p_address: address, p_link: link, p_owner_name: ownerName,
  });
  if (error) throw error;
}

/** The caller's application, or null when they never applied. */
export async function myGymApplication(): Promise<GymApplication | null> {
  const { data, error } = await supabase.rpc('my_gym_application');
  if (error) throw error;
  return (data ?? null) as GymApplication | null;
}

/** Admin: pending applications with the member-vouch signal. */
export async function fetchGymApplications(): Promise<AdminGymApplication[]> {
  const { data, error } = await supabase.rpc('admin_gym_applications');
  if (error) throw error;
  return (data ?? []) as AdminGymApplication[];
}

/** Admin: approve or deny an application (note shown to the gym on denial). */
export async function decideGymApplication(id: string, approve: boolean, note?: string): Promise<void> {
  const { error } = await supabase.rpc('admin_decide_gym', {
    p_id: id, p_approve: approve, p_note: note ?? null,
  });
  if (error) throw error;
}

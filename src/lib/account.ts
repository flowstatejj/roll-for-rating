import { supabase } from './supabase';

/**
 * Permanently delete the signed-in user's account and all their data, then
 * sign out locally. Backed by the `delete-account` edge function (Apple
 * requires in-app account deletion for apps with sign-up).
 */
export async function deleteAccount(): Promise<void> {
  const { error } = await supabase.functions.invoke('delete-account');
  if (error) {
    let message = 'We couldn’t delete your account right now. Please try again in a moment, or contact support if it keeps happening.';
    try {
      const body = await (error as { context?: Response }).context?.json?.();
      if (body?.error) message = body.error;
    } catch {
      // keep fallback
    }
    throw new Error(message);
  }
  // The server row is gone; clear the local session too.
  await supabase.auth.signOut();
}

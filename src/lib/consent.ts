import { supabase } from './supabase';

export interface ConsentRequestResult {
  ok: boolean;
  /** true when the approval email was sent to the parent */
  sent?: boolean;
  /** present only when no email provider is configured yet — share manually */
  link?: string;
  parent_email?: string;
  alreadyVerified?: boolean;
}

/**
 * Ask the backend to (re)send the parental-consent approval email for the
 * currently signed-in minor. If no email provider is configured, the edge
 * function returns a `link` the parent can be sent manually instead.
 */
export async function requestParentConsent(): Promise<ConsentRequestResult> {
  const { data, error } = await supabase.functions.invoke<ConsentRequestResult>('request-parent-consent');
  if (error) throw error;
  return data ?? { ok: false };
}

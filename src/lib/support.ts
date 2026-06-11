// In-app customer support — tickets land in public.support_requests for the
// team to work via the dashboard. Backs the Help / Contact Support screen.
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { supabase } from './supabase';

export type SupportCategory = 'general' | 'bug' | 'account' | 'billing' | 'safety' | 'feature';

export async function submitSupportRequest(args: {
  category: SupportCategory;
  subject?: string;
  body: string;
}): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const me = auth.user?.id;
  if (!me) throw new Error('Not signed in');
  const { error } = await supabase.from('support_requests').insert({
    user_id: me,
    email: auth.user?.email ?? null,
    category: args.category,
    subject: args.subject?.trim() || null,
    body: args.body.trim(),
    app_version: Constants.expoConfig?.version ?? null,
    platform: Platform.OS,
  });
  if (error) throw error;
}

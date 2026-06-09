import { createClient } from '@supabase/supabase-js';

// The anon key is public by design (Row-Level Security gates every write).
// Falls back to the project's public values so the build works without env vars;
// override via VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY on Render if needed.
const URL = import.meta.env.VITE_SUPABASE_URL || 'https://vrpmqwkpsrftjokwzwsi.supabase.co';
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_uxIpt5SCF_dBWb31RidXrw_xq24gvOL';

export const supabase = createClient(URL, ANON, {
  auth: { persistSession: true, autoRefreshToken: true },
});

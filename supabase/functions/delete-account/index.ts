// Supabase Edge Function: delete-account
// Permanently deletes the signed-in user's account. Apple requires apps with
// account creation to offer in-app deletion (App Store Guideline 5.1.1(v)).
//
// Deleting the auth user cascades through the schema (profiles.id references
// auth.users on delete cascade, and matches/attempts/consent/etc. reference
// profiles on delete cascade), so all of the user's data is removed.
//
// Deploy normally (keep "Verify JWT" ON). No extra secrets — SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY are injected automatically.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Identify the caller from their JWT — they can only delete themselves.
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: 'Not authenticated' }, 401);
    const uid = userData.user.id;

    // Deleting the auth user cascades DB rows via FKs, but storage FILES and a
    // couple of PII tables are NOT cascaded — clean them up first so nothing
    // (especially a minor's match video in the public bucket) is left behind.
    // All best-effort: account deletion must still succeed if a cleanup step
    // fails (Apple 5.1.1(v) requires deletion to work).
    try {
      const { data: vids } = await admin
        .from('match_videos').select('path').eq('uploader_id', uid);
      const paths = (vids ?? []).map((v: { path: string }) => v.path).filter(Boolean);
      if (paths.length) await admin.storage.from('match-videos').remove(paths);
    } catch { /* best-effort */ }

    try {
      const { data: prof } = await admin
        .from('profiles').select('avatar_path').eq('id', uid).maybeSingle();
      if (prof?.avatar_path) await admin.storage.from('avatars').remove([prof.avatar_path]);
    } catch { /* best-effort */ }

    // PII tables that reference the user but do not cascade on delete.
    try { await admin.from('analytics_events').delete().eq('user_id', uid); } catch { /* best-effort */ }
    try { await admin.from('support_requests').delete().eq('user_id', uid); } catch { /* best-effort */ }

    const { error: delErr } = await admin.auth.admin.deleteUser(uid);
    if (delErr) return json({ error: delErr.message }, 400);

    return json({ ok: true }, 200);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

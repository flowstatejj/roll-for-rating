// Supabase Edge Function: purge-old-videos
// Deletes match videos older than the retention window (storage FILES + the
// match_videos rows) so video storage doesn't grow unbounded. Triggered daily
// by a pg_cron job - see supabase/video-retention.sql.
//
// Deploy WITHOUT JWT verification:
//   supabase functions deploy purge-old-videos --no-verify-jwt
// Recommended: set a PURGE_SECRET function secret and pass it as the
// `x-purge-secret` header from the cron job (this function enforces it when set).
import { createClient } from 'npm:@supabase/supabase-js@2';

const RETENTION_DAYS = 14;
const BUCKET = 'match-videos';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  // If a secret is configured, only a caller that knows it may trigger a purge.
  const secret = Deno.env.get('PURGE_SECRET');
  if (secret && req.headers.get('x-purge-secret') !== secret) {
    return json({ error: 'forbidden' }, 403);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400_000).toISOString();

  let deleted = 0;
  try {
    // Batched so one run can clear a backlog without an oversized request.
    for (let i = 0; i < 40; i++) {
      const { data: old, error } = await admin
        .from('match_videos')
        .select('id, path')
        .lt('created_at', cutoff)
        .limit(500);
      if (error) return json({ error: error.message, deleted }, 500);
      if (!old?.length) break;

      // Remove the storage files first (best-effort), then the DB rows, so a
      // failure never leaves a row pointing at a deleted file.
      await admin.storage.from(BUCKET).remove(old.map((v: { path: string }) => v.path));
      const { error: delErr } = await admin
        .from('match_videos')
        .delete()
        .in('id', old.map((v: { id: string }) => v.id));
      if (delErr) return json({ error: delErr.message, deleted }, 500);

      deleted += old.length;
      if (old.length < 500) break;
    }
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e), deleted }, 500);
  }

  return json({ ok: true, deleted, cutoff });
});

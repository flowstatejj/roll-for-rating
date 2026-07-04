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
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';

const RETENTION_DAYS = 14;
const R2_ENDPOINT = `https://${Deno.env.get('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`;
const R2_BUCKET = Deno.env.get('R2_BUCKET') ?? 'match-videos';
const r2 = new AwsClient({
  accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
  secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
  service: 's3',
  region: 'auto',
});

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

      // Remove the R2 files first (best-effort, in parallel), then the DB rows,
      // so a failure never leaves a row pointing at a deleted file.
      await Promise.all(
        old.map((v: { path: string }) =>
          r2.fetch(`${R2_ENDPOINT}/${R2_BUCKET}/${v.path}`, { method: 'DELETE' }).catch(() => {}),
        ),
      );
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

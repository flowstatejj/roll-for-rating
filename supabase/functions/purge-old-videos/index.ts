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
import { deleteR2Objects } from '../_shared/r2.ts';

const RETENTION_DAYS = 14;

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
  let failed = 0;
  const failedIds = new Set<string>();
  try {
    // Batched so one run can clear a backlog without an oversized request.
    for (let i = 0; i < 40; i++) {
      // Ordered so pages advance deterministically (oldest first), and rows
      // that already failed this run are excluded - otherwise a single
      // permanently failing object is re-read at the front of every one of the
      // 40 iterations, inflating `failed` and burning the batch budget.
      let q = admin
        .from('match_videos')
        .select('id, path')
        .lt('created_at', cutoff)
        .order('created_at', { ascending: true })
        .limit(500);
      if (failedIds.size) q = q.not('id', 'in', `(${[...failedIds].join(',')})`);
      const { data: old, error } = await q;
      if (error) return json({ error: error.message, deleted, failed }, 500);
      if (!old?.length) break;

      // Delete the R2 file first, then the row - but ONLY for the files that
      // actually went away. r2.fetch resolves on 403/5xx rather than throwing,
      // so the previous `.catch(() => {})` treated a rejected credential as
      // success and deleted the rows anyway. Since the rows are the only index
      // into R2, that turned one bad run into a permanently unreachable
      // backlog: files kept, pointers gone, and {ok:true} reported.
      // A row left pointing at a deleted file is the harmless direction - the
      // next run retries it and a 404 counts as success.
      const rows = old as { id: string; path: string }[];
      // path -> ALL row ids sharing it. match_videos has no unique index on
      // path and the offline queue can re-insert on retry, so a plain
      // path -> id map would strand every duplicate but the last.
      const byPath = new Map<string, string[]>();
      for (const v of rows) {
        if (!v.path) continue;
        const list = byPath.get(v.path);
        if (list) list.push(v.id);
        else byPath.set(v.path, [v.id]);
      }
      const outcomes = await deleteR2Objects([...byPath.keys()]);

      const okIds = outcomes.filter((o) => o.ok).flatMap((o) => byPath.get(o.path) ?? []);
      const bad = outcomes.filter((o) => !o.ok);
      failed += bad.length;
      if (bad.length) {
        bad.forEach((o) => (byPath.get(o.path) ?? []).forEach((id) => failedIds.add(id)));
        console.error(
          `purge-old-videos: ${bad.length} R2 delete(s) failed, rows kept. First: ` +
            `${bad[0].path} -> ${bad[0].error ?? bad[0].status}`,
        );
      }
      // Rows whose path was empty have no file to remove; drop them too.
      const emptyPathIds = rows.filter((v) => !v.path).map((v) => v.id);
      const removable = [...new Set([...okIds, ...emptyPathIds])];

      if (removable.length) {
        const { error: delErr } = await admin
          .from('match_videos').delete().in('id', removable);
        if (delErr) return json({ error: delErr.message, deleted, failed }, 500);
        deleted += removable.length;
      }

      if (rows.length < 500) break;
    }
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e), deleted, failed }, 500);
  }

  // Non-200 when anything failed: the cron caller (video-retention.sql) only
  // records the HTTP status via pg_net, so a 200 with {ok:false} would be
  // invisible and retention could silently stop working for weeks.
  return json({ ok: failed === 0, deleted, failed, cutoff }, failed > 0 ? 503 : 200);
});

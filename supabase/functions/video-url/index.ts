// Supabase Edge Function: video-url
// Presigns Cloudflare R2 URLs for match-video upload (PUT) and playback (GET),
// enforcing the same access rules as the app:
//   - upload: caller must be a participant of the match
//   - play:   caller must be a participant OR the match must be public
// R2 egress is free, so serving videos via these presigned links is far cheaper
// than Supabase Storage at scale, while access stays controlled here.
//
// Deploy with Verify JWT ON. Requires secrets: R2_ACCOUNT_ID, R2_BUCKET,
// R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';

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

const ENDPOINT = `https://${Deno.env.get('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`;
const BUCKET = Deno.env.get('R2_BUCKET') ?? 'match-videos';
const r2 = new AwsClient({
  accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
  secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
  service: 's3',
  region: 'auto',
});

// A presigned URL valid for `expires` seconds. The signature is in the query
// string, so the client needs no auth headers to use it.
async function presign(path: string, method: 'GET' | 'PUT', expires = 3600): Promise<string> {
  const url = `${ENDPOINT}/${BUCKET}/${path}?X-Amz-Expires=${expires}`;
  const signed = await r2.sign(new Request(url, { method }), { aws: { signQuery: true } });
  return signed.url;
}

// Object keys are ALWAYS `<matchId>/<name>.<ext>` and nothing else.
//
// Why this is strict: authorization below is derived from the FIRST path
// segment, but the whole string is what gets signed or deleted. `new Request()`
// runs WHATWG URL normalisation, which collapses `..` BEFORE aws4fetch signs,
// so a path like `<my match>/../<your match>/clip.mp4` authorised as my match
// but resolved to yours - handing any signed-in user read, overwrite and delete
// on every object in the bucket, including minors' videos. Validating the shape
// and re-checking the prefix after validation closes that.
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Returns the matchId the key belongs to, or null if the key is not well formed. */
function parseKey(path: string): string | null {
  if (!path || path.length > 200) return null;
  // Reject anything that could survive as a traversal or escape an object name.
  if (path.includes('..') || path.includes('//') || path.includes('\\')) return null;
  if (/%2e|%2f|%5c/i.test(path)) return null;
  const parts = path.split('/');
  if (parts.length !== 2) return null;
  const [matchId, name] = parts;
  if (!UUID_RE.test(matchId)) return null;
  if (!NAME_RE.test(name) || name.includes('..')) return null;
  return matchId;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const { data: userData, error: uErr } = await admin.auth.getUser(jwt);
    if (uErr || !userData?.user) return json({ error: 'Not authenticated' }, 401);
    const uid = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const op = body?.op;

    if (op === 'upload') {
      const matchId = String(body?.matchId ?? '');
      const stamp = String(body?.stamp ?? '');
      const ext = (String(body?.ext ?? 'mp4').match(/^[a-z0-9]+$/i)?.[0] ?? 'mp4').toLowerCase();
      if (!matchId || !stamp) return json({ error: 'matchId and stamp are required' }, 400);
      // The client only ever sends Date.now(). Keeping the key deterministic
      // (rather than randomising it here) is what lets the offline queue retry
      // an upload without orphaning the previous partial object.
      if (!UUID_RE.test(matchId) || !/^[0-9]{1,20}$/.test(stamp)) {
        return json({ error: 'Invalid matchId or stamp' }, 400);
      }

      const { data: m } = await admin
        .from('matches')
        .select('challenger_id, opponent_id, referee_id')
        .eq('id', matchId)
        .maybeSingle();
      if (!m || ![m.challenger_id, m.opponent_id, m.referee_id].includes(uid)) {
        return json({ error: 'Not a participant of this match' }, 403);
      }

      const path = `${matchId}/${stamp}.${ext}`;
      if (parseKey(path) !== matchId) return json({ error: 'Invalid path' }, 400);
      return json({ url: await presign(path, 'PUT'), path });
    }

    if (op === 'play') {
      const path = String(body?.path ?? '');
      const matchId = parseKey(path);
      if (!matchId) return json({ error: 'Invalid path' }, 400);

      const { data: m } = await admin
        .from('matches')
        .select('challenger_id, opponent_id, referee_id, is_public')
        .eq('id', matchId)
        .maybeSingle();
      if (!m) return json({ error: 'Match not found' }, 404);
      const canView = m.is_public || [m.challenger_id, m.opponent_id, m.referee_id].includes(uid);
      if (!canView) return json({ error: 'Not allowed' }, 403);

      return json({ url: await presign(path, 'GET') });
    }

    if (op === 'delete') {
      const path = String(body?.path ?? '');
      const matchId = parseKey(path);
      if (!matchId) return json({ error: 'Invalid path' }, 400);
      const { data: m } = await admin
        .from('matches')
        .select('challenger_id, opponent_id, referee_id')
        .eq('id', matchId)
        .maybeSingle();
      if (!m || ![m.challenger_id, m.opponent_id, m.referee_id].includes(uid)) {
        return json({ error: 'Not allowed' }, 403);
      }
      const del = await r2.fetch(`${ENDPOINT}/${BUCKET}/${path}`, { method: 'DELETE' });
      // R2 resolves (not throws) on 403/5xx, so surface a real failure instead
      // of reporting success while the object survives.
      if (!del.ok && del.status !== 404) {
        return json({ error: `R2 delete failed (${del.status})` }, 502);
      }
      return json({ ok: true });
    }

    return json({ error: 'Unknown op' }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

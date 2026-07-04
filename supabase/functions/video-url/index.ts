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

      const { data: m } = await admin
        .from('matches')
        .select('challenger_id, opponent_id, referee_id')
        .eq('id', matchId)
        .maybeSingle();
      if (!m || ![m.challenger_id, m.opponent_id, m.referee_id].includes(uid)) {
        return json({ error: 'Not a participant of this match' }, 403);
      }

      const path = `${matchId}/${stamp}.${ext}`;
      return json({ url: await presign(path, 'PUT'), path });
    }

    if (op === 'play') {
      const path = String(body?.path ?? '');
      if (!path.includes('/')) return json({ error: 'path is required' }, 400);
      const matchId = path.split('/')[0];

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
      if (!path.includes('/')) return json({ error: 'path is required' }, 400);
      const matchId = path.split('/')[0];
      const { data: m } = await admin
        .from('matches')
        .select('challenger_id, opponent_id, referee_id')
        .eq('id', matchId)
        .maybeSingle();
      if (!m || ![m.challenger_id, m.opponent_id, m.referee_id].includes(uid)) {
        return json({ error: 'Not allowed' }, 403);
      }
      await r2.fetch(`${ENDPOINT}/${BUCKET}/${path}`, { method: 'DELETE' });
      return json({ ok: true });
    }

    return json({ error: 'Unknown op' }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

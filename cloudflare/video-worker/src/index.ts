// Cloudflare Worker: video playback presigner.
//
// Does the same job as the `video-url` Supabase edge function's `op=play`, but
// on Cloudflare (~$0.30/M requests vs Supabase's ~$2/M) - at 100k users x 200
// views/video this is the single biggest infra saving. Only PLAYBACK runs here;
// upload/delete stay on the Supabase edge function (low volume).
//
// Flow: client POSTs { path } with its Supabase JWT. We confirm the caller may
// view the video via an RLS-gated read of match_videos (returns the row only for
// a participant or a public match), then return a presigned R2 GET URL. The
// client fetches R2 directly (free egress).
import { AwsClient } from 'aws4fetch';

export interface Env {
  R2_ACCOUNT_ID: string;
  R2_BUCKET: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    if (!token) return json({ error: 'Not authenticated' }, 401);

    let path = '';
    try {
      path = ((await req.json()) as { path?: string })?.path ?? '';
    } catch {
      /* bad body */
    }
    if (!path.includes('/')) return json({ error: 'path is required' }, 400);

    // Access check: RLS-gated read of the row with the caller's own JWT. It comes
    // back only if they may view it (participant, or the match is public).
    const check = await fetch(
      `${env.SUPABASE_URL}/rest/v1/match_videos?select=id&limit=1&path=eq.${encodeURIComponent(path)}`,
      { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } },
    );
    if (!check.ok) return json({ error: 'Auth check failed' }, 403);
    const rows = (await check.json()) as unknown[];
    if (!Array.isArray(rows) || rows.length === 0) return json({ error: 'Not allowed' }, 403);

    const r2 = new AwsClient({
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      service: 's3',
      region: 'auto',
    });
    const url = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/${path}?X-Amz-Expires=3600`;
    const signed = await r2.sign(new Request(url, { method: 'GET' }), { aws: { signQuery: true } });
    return json({ url: signed.url });
  },
};

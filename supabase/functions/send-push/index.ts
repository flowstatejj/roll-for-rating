// send-push — Supabase Database Webhook target for INSERTs on public.notifications.
//
// Every user-facing notification is a row in public.notifications. A Database
// Webhook (Database -> Webhooks in the dashboard) fires this function on each
// INSERT. We honor the recipient's per-category toggle (profiles.notif_prefs),
// look up their Expo push tokens, and deliver via Expo's push service (no APNs/
// FCM keys needed — Expo relays). Invalid tokens are pruned.
//
// Deploy with "Verify JWT" OFF (the webhook is not a signed-in user). Optionally
// set a PUSH_WEBHOOK_SECRET function secret and configure the webhook to send an
// `x-webhook-secret` header with the same value to reject spoofed calls.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// Mirror of public.notif_category(type): the 8 user-facing toggle categories.
function categoryFor(type: string): string {
  switch (type) {
    case 'challenge': case 'accepted': case 'declined': case 'cancelled': case 'referee':
      return 'challenges';
    case 'result': return 'results';
    case 'message': return 'messages';
    case 'video': return 'videos';
    case 'reaction': return 'reactions';
    case 'friend_request': case 'friend_accepted': return 'friends';
    case 'league_invite': case 'tournament_invite': case 'league_matchup': case 'league_message':
      return 'leagues';
    case 'gym_request': return 'gym';
    default: return 'other'; // e.g. match_disputed (admins) — always delivered
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    // FAIL CLOSED. This function is deployed with JWT verification off (it is
    // called by a DB webhook), so the shared secret is the ONLY thing standing
    // between the public internet and "push arbitrary text to any user id".
    // The previous `if (secret && ...)` made the check evaporate whenever the
    // secret was unset - the one configuration where it actually matters - so a
    // missing secret silently turned this into an open relay for spoofed
    // notifications. Refuse to run rather than run unauthenticated.
    const secret = Deno.env.get('PUSH_WEBHOOK_SECRET');
    if (!secret) {
      console.error('send-push: PUSH_WEBHOOK_SECRET is not set; refusing to send.');
      return json({ error: 'push not configured' }, 503);
    }
    if (req.headers.get('x-webhook-secret') !== secret) return json({ error: 'unauthorized' }, 401);

    const payload = await req.json();
    const rec = payload?.record ?? payload; // webhook sends {type,table,record,...}
    if (!rec?.user_id || !rec?.type) return json({ ok: true, skipped: 'no record' });

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // 1. Honor the recipient's per-category toggle (missing key = enabled).
    const category = categoryFor(rec.type);
    if (category !== 'other') {
      const { data: prof } = await admin.from('profiles').select('notif_prefs').eq('id', rec.user_id).single();
      const prefs = (prof?.notif_prefs ?? {}) as Record<string, boolean>;
      if (prefs[category] === false) return json({ ok: true, skipped: 'category off', category });
    }

    // 2. The recipient's devices.
    const { data: toks } = await admin.from('expo_push_tokens').select('token').eq('user_id', rec.user_id);
    const tokens: string[] = (toks ?? []).map((r: { token: string }) => r.token);
    if (tokens.length === 0) return json({ ok: true, skipped: 'no tokens' });

    // 3. Deep-link hints for the tap handler.
    const d = (rec.data ?? {}) as Record<string, unknown>;
    const data = {
      notifId: rec.id, type: rec.type, match_id: rec.match_id ?? null,
      lid: d.lid ?? null, tid: d.tid ?? null, fid: d.fid ?? null,
    };

    // 4. Send to Expo in chunks of 100, pruning dead tokens.
    const dead: string[] = [];
    for (let i = 0; i < tokens.length; i += 100) {
      const chunk = tokens.slice(i, i + 100);
      const messages = chunk.map((to) => ({
        to, title: rec.title ?? 'Roll for Rating', body: rec.body ?? undefined,
        sound: 'default', data, channelId: 'default',
      }));
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages),
      });
      const body = await res.json().catch(() => ({}));
      const tickets = Array.isArray(body?.data) ? body.data : [];
      tickets.forEach((tk: { status?: string; details?: { error?: string } }, idx: number) => {
        if (tk?.status === 'error' && tk?.details?.error === 'DeviceNotRegistered') dead.push(chunk[idx]);
      });
    }
    if (dead.length) await admin.from('expo_push_tokens').delete().in('token', dead);

    return json({ ok: true, sent: tokens.length - dead.length, pruned: dead.length });
  } catch (e) {
    // Always 200 so the webhook doesn't retry-storm; log for debugging.
    console.error('send-push error', e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) });
  }
});

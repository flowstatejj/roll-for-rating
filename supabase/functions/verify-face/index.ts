// Supabase Edge Function: verify-face
// Confirms a profile photo actually shows ONE clear human face, using Claude
// vision. Used for ADULT profiles only — the client skips this for minors /
// managed juniors (their photos just need to exist and are gated behind an
// accepted match by storage RLS). Returns { face: boolean, reason: string }.
//
// Requires secret: ANTHROPIC_API_KEY  (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// are injected automatically.) Deploy in the Supabase dashboard.
import { createClient } from 'npm:@supabase/supabase-js@2';

const MODEL = 'claude-haiku-4-5';

const SYSTEM = `You are a strict photo moderator for a Brazilian Jiu-Jitsu app's profile photos.

You are shown ONE image. Decide whether it is acceptable as a real profile photo.

Call record_check with face=true ONLY if ALL of these hold:
- There is exactly one clearly visible, real HUMAN face (eyes/nose/mouth discernible).
- It is an actual photograph of a person — NOT a cartoon, drawing, emoji, meme,
  avatar, logo, text, screenshot, animal, object, or AI-rendered illustration.
- The face is reasonably front-facing and not fully obscured by a mask, hands, or
  heavy blur/crop.

Set face=false for: no human face, multiple prominent faces, drawings/cartoons/
avatars, animals, objects, memes, screenshots, blank/abstract images, or anything
where you are not confident a single real human face is present. When in doubt,
choose face=false. Keep reason to a short phrase.`;

const SCHEMA = {
  type: 'object',
  properties: {
    face: { type: 'boolean', description: 'true only if exactly one clear real human face is present' },
    reason: { type: 'string', description: 'short phrase explaining the decision' },
  },
  required: ['face', 'reason'],
  additionalProperties: false,
};

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

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const { image_base64, media_type } = await req.json();
    const data = String(image_base64 ?? '').replace(/^data:[^;]+;base64,/, '');
    const mt = ALLOWED.has(media_type) ? media_type : 'image/jpeg';

    if (!data || data.length < 100) return json({ error: 'image_base64 is required' }, 400);
    // ~ guard against oversized payloads (base64 is ~4/3 of byte size). ~7MB image cap.
    if (data.length > 9_500_000) return json({ error: 'Image is too large.' }, 413);

    // Require an authenticated caller (don't expose the AI to anonymous traffic).
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: 'Not authenticated' }, 401);

    const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 150,
        system: SYSTEM,
        tools: [{ name: 'record_check', description: 'Record the face-check result.', input_schema: SCHEMA }],
        tool_choice: { type: 'tool', name: 'record_check' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mt, data } },
              { type: 'text', text: 'Is this an acceptable profile photo of one real human face? Call record_check.' },
            ],
          },
        ],
      }),
    });
    const aiData = await aiResp.json();
    if (!aiResp.ok) return json({ error: aiData?.error?.message ?? 'Face check failed' }, 502);

    const out = aiData.content?.find((b: any) => b.type === 'tool_use')?.input ?? {};
    return json({ face: out.face === true, reason: String(out.reason ?? '') }, 200);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

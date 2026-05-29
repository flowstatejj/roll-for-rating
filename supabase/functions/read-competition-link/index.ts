// Supabase Edge Function: read-competition-link
// Fetches a pasted Smoothcomp/IBJJF/ADCC profile URL and uses Claude Haiku to
// extract the athlete's total wins/losses from whatever page text comes back.
//
// NOTE: these sites are heavily JavaScript-rendered, so a plain server fetch
// often returns little usable data. When that happens the function returns
// found=false and the user enters their W/L manually. Deploy in the dashboard.
//
// Requires secret: ANTHROPIC_API_KEY.

const MODEL = 'claude-haiku-4-5';

const SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean' },
    wins: { type: 'integer' },
    losses: { type: 'integer' },
  },
  required: ['found', 'wins', 'losses'],
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

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12000);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const { source, url } = await req.json();
    if (!url || !/^https?:\/\//i.test(url)) return json({ error: 'A valid URL is required' }, 400);

    // Fetch the page (best effort).
    let pageText = '';
    try {
      const pageResp = await fetch(url, {
        headers: { 'user-agent': 'Mozilla/5.0 (RollForRating link reader)' },
      });
      pageText = htmlToText(await pageResp.text());
    } catch {
      return json({ found: false, wins: 0, losses: 0, note: 'Could not fetch that URL.' });
    }
    if (pageText.length < 40) {
      return json({ found: false, wins: 0, losses: 0, note: 'No readable content (page likely needs JavaScript).' });
    }

    const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        system:
          `You extract a grappler's overall competition record from the text of a ${source ?? 'competition'} ` +
          `athlete profile page. Count total career WINS and LOSSES across the matches/results shown. ` +
          `If the page does not clearly show a win/loss record, set found=false and wins=0, losses=0. ` +
          `Respond ONLY in the provided JSON schema.`,
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content: `PAGE TEXT:\n${pageText}` }],
      }),
    });
    const aiData = await aiResp.json();
    if (!aiResp.ok) return json({ error: aiData?.error?.message ?? 'Read failed' }, 502);

    const text = aiData.content?.find((b: any) => b.type === 'text')?.text ?? '{}';
    const parsed = JSON.parse(text);
    return json({
      found: !!parsed.found,
      wins: Math.max(0, Math.round(parsed.wins ?? 0)),
      losses: Math.max(0, Math.round(parsed.losses ?? 0)),
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

// Supabase Edge Function: read-competition-link
// Reads an athlete's total wins/losses off a pasted Smoothcomp/IBJJF/ADCC
// profile URL. Uses Claude (Haiku) with the server-side WEB FETCH tool so the
// page is fetched and rendered Anthropic-side -- this handles the JavaScript-
// rendered profile pages that a plain server fetch can't read. Web search is
// intentionally NOT enabled (web fetch only), to keep the per-read cost minimal.
//
// Requires secret: ANTHROPIC_API_KEY.
// Deploy in the Supabase dashboard.

// Sonnet 4.6 supports the web_fetch server tool (Haiku does not); a competition
// import is one-time per customer, so the few extra cents don't matter.
const MODEL = 'claude-sonnet-4-6';

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

// Pull the first {...} JSON object out of the model's final text.
function extractRecord(text: string): { found: boolean; wins: number; losses: number } | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    return {
      found: !!o.found,
      wins: Math.max(0, Math.round(Number(o.wins) || 0)),
      losses: Math.max(0, Math.round(Number(o.losses) || 0)),
    };
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const { source, url } = await req.json();
    if (!url || !/^https?:\/\//i.test(url)) return json({ error: 'A valid URL is required' }, 400);

    const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        // web_fetch is a server-side tool: Anthropic fetches + renders the page,
        // then the model extracts the record and returns the final JSON.
        tools: [{ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 5 }],
        system:
          `You read a grappler's overall competition record from their ${source ?? 'competition'} ` +
          `athlete profile page. Use the web_fetch tool to fetch the URL the user gives you, then count ` +
          `their total career WINS and LOSSES across the matches/results shown. If the page does not ` +
          `clearly show a win/loss record, report found=false with wins=0 and losses=0. ` +
          `Respond with ONLY a JSON object and nothing else: {"found": boolean, "wins": integer, "losses": integer}.`,
        messages: [{ role: 'user', content: `Fetch this ${source ?? 'competition'} athlete profile and report their total wins and losses:\n${url}` }],
      }),
    });

    const aiData = await aiResp.json();
    if (!aiResp.ok) {
      console.error('read-competition-link: Anthropic error', aiResp.status, JSON.stringify(aiData?.error ?? aiData));
      return json({ error: aiData?.error?.message ?? 'Read failed' }, 502);
    }

    // The final text block carries the JSON (web_fetch_tool_result blocks precede it).
    const texts = (aiData.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text);
    const parsed = extractRecord(texts.join('\n')) ?? { found: false, wins: 0, losses: 0 };
    console.log('read-competition-link:', JSON.stringify(parsed), 'stop=', aiData?.stop_reason);
    return json(parsed);
  } catch (e) {
    console.error('read-competition-link: exception', String((e as Error)?.message ?? e));
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

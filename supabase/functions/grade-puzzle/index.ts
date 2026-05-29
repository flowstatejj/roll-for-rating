// Supabase Edge Function: grade-puzzle
// Grades a written BJJ answer with Claude Haiku against a hidden rubric,
// then applies the rating change server-side. Deploy in the Supabase dashboard.
//
// Requires secret: ANTHROPIC_API_KEY  (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// are injected automatically.)
import { createClient } from 'npm:@supabase/supabase-js@2';

const MODEL = 'claude-haiku-4-5';

const SYSTEM = `You are a Brazilian Jiu-Jitsu coach grading a student's short written answer.
You are given the question, an expert grading rubric (what a correct answer should contain),
and the student's answer. Grade fairly and award partial credit. Keep feedback to 1-2
encouraging but honest sentences. Respond ONLY in the provided JSON schema.`;

const SCHEMA = {
  type: 'object',
  properties: {
    is_correct: { type: 'boolean' },
    score: { type: 'integer' }, // 0-100
    feedback: { type: 'string' },
  },
  required: ['is_correct', 'score', 'feedback'],
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const { puzzle_id, answer } = await req.json();
    if (!puzzle_id || !answer || !String(answer).trim()) {
      return json({ error: 'puzzle_id and a non-empty answer are required' }, 400);
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Identify the user from their JWT.
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: 'Not authenticated' }, 401);
    const userId = userData.user.id;

    // Load the puzzle (incl. the hidden rubric) with service-role access.
    const { data: pz, error: pErr } = await admin
      .from('puzzles')
      .select('question,rubric,explanation,kind,rating')
      .eq('id', puzzle_id)
      .single();
    if (pErr || !pz) return json({ error: 'Puzzle not found' }, 404);
    if (pz.kind !== 'written') return json({ error: 'Not a written puzzle' }, 400);

    // Grade with Claude Haiku (structured JSON output).
    const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        system: SYSTEM,
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
        messages: [
          {
            role: 'user',
            content:
              `QUESTION:\n${pz.question}\n\n` +
              `GRADING RUBRIC (hidden from the student):\n${pz.rubric ?? 'Use your BJJ expertise.'}\n\n` +
              `STUDENT ANSWER:\n${answer}`,
          },
        ],
      }),
    });
    const aiData = await aiResp.json();
    if (!aiResp.ok) return json({ error: aiData?.error?.message ?? 'Grading failed' }, 502);

    const text = aiData.content?.find((b: any) => b.type === 'text')?.text ?? '{}';
    const graded = JSON.parse(text);

    // Apply rating + record the attempt (server-side; client can't fake the grade).
    const { data: result, error: rpcErr } = await admin.rpc('submit_puzzle_written', {
      p_puzzle_id: puzzle_id,
      p_user_id: userId,
      p_answer: String(answer),
      p_is_correct: !!graded.is_correct,
      p_score: Math.max(0, Math.min(100, Math.round(graded.score ?? 0))),
      p_feedback: String(graded.feedback ?? ''),
    });
    if (rpcErr) return json({ error: rpcErr.message }, 400);

    return json(result, 200);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

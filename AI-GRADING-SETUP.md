# Setup: AI grading (Claude) — do this when ready

This turns on two Claude-powered features that are already built in the app:

1. **Written puzzles** — an AI coach grades typed answers (Puzzles → Written answer).
   Grading is **belt-aware** (a white belt and a black belt are held to different
   standards), and the student gets back a **score, what they got right, what they
   missed, and a model answer**. Gibberish / off-topic / "just give me 100"
   answers are detected and scored accordingly.
2. **Competition link auto-read** — reads wins/losses off a pasted profile link
   (Profile → Import competition record → "Read from link")

Until this setup is done, both show a friendly "not set up yet" message and you
enter values manually. Everything else in the app works without this.

**Roughly 15 minutes, one time.** Go in order.

---

## Part A — Get an Anthropic (Claude) API key

1. Go to **https://console.anthropic.com** → sign up / log in.
2. **Billing → add a payment method** and add a little credit (even **$5** lasts
   a long time — grading a puzzle costs ~⅛ of a cent). The key won't work
   without credit.
3. **API Keys → Create Key** → name it `rollforrating` → **copy** the key
   (starts with `sk-ant-...`) and paste it somewhere safe. You only see it once.

---

## Part B — Give the key to Supabase

1. Supabase dashboard → left sidebar **Edge Functions** → **Secrets**
   (or *Project Settings → Edge Functions → Secrets*).
2. **Add new secret:**
   - **Name:** `ANTHROPIC_API_KEY`  ← exactly this
   - **Value:** your `sk-ant-...` key
3. **Save.**

---

## Part C — Create the two functions

Supabase → **Edge Functions** → **Create a function** (use the in-dashboard
editor). Do this **twice**. Delete the sample code, paste the file's contents,
then **Deploy**.

| Function name (exact)     | Paste the contents of this file |
| ------------------------- | ------------------------------- |
| `grade-puzzle`            | `supabase/functions/grade-puzzle/index.ts` |
| `read-competition-link`   | `supabase/functions/read-competition-link/index.ts` |

> The files live in your project at:
> `C:\Users\Ryan K\code\jj-ladder\supabase\functions\...`
> Open each `.ts` file (right-click → Open with → Notepad or VS Code),
> **Ctrl+A → Ctrl+C** to copy everything, then paste into the dashboard editor.

The function names must match exactly — the app calls them by those names.

---

## Part D — Run the last database snippet

Supabase → **SQL Editor → New query** → paste the block below → **Run**
(expect "Success. No rows returned.").

```sql
create or replace function public.submit_puzzle_written(
  p_puzzle_id uuid, p_user_id uuid, p_answer text,
  p_is_correct boolean, p_score integer, p_feedback text
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  pz public.puzzles; k constant integer := 12;
  u_rating integer; already boolean; expected double precision;
  score_frac double precision; r_before integer; r_after integer; did_rate boolean := false;
begin
  select * into pz from public.puzzles where id = p_puzzle_id;
  if not found then raise exception 'Puzzle not found'; end if;
  select exists(select 1 from public.puzzle_attempts where puzzle_id = p_puzzle_id and user_id = p_user_id and rated) into already;
  select rating into u_rating from public.profiles where id = p_user_id for update;
  r_before := u_rating; r_after := u_rating;
  score_frac := greatest(0, least(1, coalesce(p_score,0)::double precision/100));
  if not already then
    expected := public.elo_expected(u_rating, pz.rating);
    r_after := round(u_rating + k*(score_frac - expected));
    update public.profiles set rating = r_after where id = p_user_id;
    did_rate := true;
  end if;
  insert into public.puzzle_attempts (puzzle_id,user_id,given_answer,is_correct,score,feedback,rating_before,rating_after,rated)
  values (p_puzzle_id,p_user_id,p_answer,coalesce(p_is_correct,false),p_score,p_feedback,r_before,r_after,did_rate);
  return jsonb_build_object('is_correct',coalesce(p_is_correct,false),'score',p_score,'feedback',p_feedback,
    'explanation',pz.explanation,'rating_before',r_before,'rating_after',r_after,'delta',r_after-r_before,'rated',did_rate);
end; $$;

revoke execute on function public.submit_puzzle_written(uuid,uuid,text,boolean,integer,text) from public, anon, authenticated;
grant execute on function public.submit_puzzle_written(uuid,uuid,text,boolean,integer,text) to service_role;

insert into public.puzzles (kind,title,image_url,question,rubric,explanation,rating) values
('written','Escaping side control','https://placehold.co/800x480/312e2b/9bb4d4?text=Side+Control',
 'Your opponent has strong side control on you. Describe your first priorities and one escape you would attempt.',
 'A strong answer covers: (1) framing to make space and protect the neck / stop the cross-face, (2) getting onto your side and recovering hip mobility, (3) a concrete escape — shrimp to recover guard, ghost/granby roll, or underhook to come up. Partial credit for any.',
 'Frame and protect, get to your side, then shrimp to recover guard or underhook to come up.',1200),
('written','Principles of guard passing','https://placehold.co/800x480/312e2b/9bb4d4?text=Guard+Pass',
 'What general principles make a guard pass effective? Name at least two and explain briefly.',
 'Strong answers name principles like: controlling the hips/legs, heavy connected forward pressure, staying based / off the heels, controlling inside space, head position, denying frames and angle. Two well-explained = good.',
 'Effective passing centers on hip/leg control, heavy connected pressure, base, and denying space and frames.',1300)
on conflict do nothing;
```

> This SQL is also saved at `supabase/written-puzzles.sql`.

### More written puzzles (optional but recommended)

Paste and run the contents of **`supabase/written-puzzles-extra.sql`** too — it
adds a dozen more written puzzles (guard retention, mount/back escapes, passing,
takedowns, leg-lock safety, grip fighting, etc.). It's safe to re-run.

---

## Then test it

Refresh the app (**localhost:8088**) →
- **Puzzles → Written answer** → answer one → submit → you should get an AI
  **score (0–100)**, **coaching feedback**, and a rating change.
- **Profile → Import competition record** → paste a link → **Read from link**.

---

## Cost reference (Claude Haiku 4.5: $1 / $5 per million tokens in/out)

| Operation | ~Cost per call | Per 10,000 / month |
| --- | --- | --- |
| Grade a written puzzle | ~$0.003 (under ½ cent) | ~$30 |
| Read a competition link | ~$0.008 (under a cent) | ~$80 (rare — once per import) |

Supabase function hosting is free up to 500k calls/month.

---

## Troubleshooting

- **"not set up yet" / grading fails** → check the function names are exactly
  `grade-puzzle` and `read-competition-link`, and that they deployed without
  errors (Edge Functions → the function → Logs).
- **401 / auth error** → make sure you're signed in to the app.
- **Anthropic 400/credit error** → confirm `ANTHROPIC_API_KEY` is set as a
  Supabase secret and your Anthropic account has credit.
- **Link reader returns 0 wins / 0 losses** → expected for JavaScript-heavy
  sites (Smoothcomp/IBJJF/ADCC); enter your W/L manually for now.

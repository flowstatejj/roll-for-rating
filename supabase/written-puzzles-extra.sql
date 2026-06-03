-- ============================================================================
-- Rollr — extra written puzzles (run after written-puzzles.sql)
-- Safe to re-run: each row is only inserted if a written puzzle with the same
-- title doesn't already exist. Grading is belt-aware (handled by grade-puzzle),
-- so `rating` here is the puzzle's difficulty/Elo.
-- ============================================================================

insert into public.puzzles (kind, title, image_url, question, rubric, explanation, rating)
select v.kind, v.title, v.image_url, v.question, v.rubric, v.explanation, v.rating
from (values
  ('written', 'Guard retention vs the knee cut',
   'https://placehold.co/800x480/312e2b/9bb4d4?text=Knee+Cut',
   'Your opponent is driving a knee-cut (knee-slice) pass through your guard. What are your priorities to retain guard?',
   'Strong answers cover: getting the underhook / fighting the cross-face, framing on the shoulder and hip, keeping the knee-shield / bottom knee in to block the slice, hip escaping to recover, and re-pummeling the inside leg or coming up to a single. Partial credit for any.',
   'Win the underhook and stop the cross-face, keep your knee-shield in, hip-escape to make space, then recover guard or come up to the leg.',
   1300),

  ('written', 'Escaping mount',
   'https://placehold.co/800x480/312e2b/9bb4d4?text=Mount+Escape',
   'You are flat on your back with your opponent in mount. Describe your priorities and one escape.',
   'Covers: protect the neck and avoid getting arms crossed/high, trap an arm and same-side foot for the elbow-escape (bridge to your side, knee in to recover half/guard), or a strong bridge-and-roll (trap arm + leg, bridge over the shoulder). Note not to push straight up and give the armbar. Partial credit.',
   'Protect your neck, then either trap-arm-and-foot and bridge to elbow-escape to half guard, or trap an arm and bridge-and-roll them over.',
   1250),

  ('written', 'Finishing the rear naked choke',
   'https://placehold.co/800x480/312e2b/9bb4d4?text=RNC',
   'You have back control with a seatbelt grip. Walk through finishing a rear naked choke and the most common reason it fails.',
   'Covers: get the choking arm under the chin (clear the chin / use the strong-side hand to fight hands), connect hands (palm-to-bicep, second hand behind the head), expand the chest / squeeze elbows together rather than cranking, and keep hooks or a body triangle to stay attached. Common failure: leaving space under the chin or not controlling the hands first.',
   'Clear the chin, get the blade of the forearm under it, lock palm-to-bicep with the other hand behind the head, then squeeze by expanding your chest. It usually fails when you rush before clearing the chin/hands.',
   1200),

  ('written', 'Defending the triangle',
   'https://placehold.co/800x480/312e2b/9bb4d4?text=Triangle+Defense',
   'Your opponent has locked a triangle from guard but hasn''t finished. What do you do, early and late?',
   'Early: posture up, get the trapped arm OUT or both arms in, drop hips/stack, control the hips. Stack-pass or "hitchhiker" / Saulo-style escape. Late (it''s tight): protect the neck, control the angle, stack heavy and walk to the trapped-arm side. Partial credit for posture + stack + clearing the angle.',
   'Posture up and either pull the trapped arm free or stack heavy and walk toward the trapped-arm side to flatten their angle and relieve the choke, then pass.',
   1350),

  ('written', 'Half guard bottom priorities',
   'https://placehold.co/800x480/312e2b/9bb4d4?text=Half+Guard',
   'You are on bottom in half guard. What is your #1 priority and what are your main options from there?',
   'Number one priority is the UNDERHOOK (and getting off your back onto your side). From there: come up to a single/dogfight, hit a sweep (old-school, plan B, or back-take off the underhook), or recover full guard. Losing the underhook and getting flattened/cross-faced is the failure mode.',
   'Get the underhook and get onto your side. From there you can come up to the dogfight/single, sweep, or take the back. Don''t get flattened and cross-faced.',
   1300),

  ('written', 'Passing the closed guard',
   'https://placehold.co/800x480/312e2b/9bb4d4?text=Closed+Guard',
   'You are standing inside your opponent''s closed guard. Outline how you open and begin to pass it.',
   'Covers: establish posture and grips (control the hips/belt, strong base, hands on hips or lapels), don''t get pulled forward, stand and break the legs open by driving knee in / pushing the leg down, then enter a pass (knee-cut, leg-drag, stack/double-under, or toreando). Posture + open + commit to a pass = good.',
   'Posture up with strong grips on the hips so you can''t be broken down, stand to open the legs, push a leg down, and immediately commit to a pass like a knee-cut or leg drag.',
   1200),

  ('written', 'Escaping back control',
   'https://placehold.co/800x480/312e2b/9bb4d4?text=Back+Escape',
   'Your opponent has your back with two hooks and a seatbelt. How do you defend the choke and escape?',
   'Covers: two-on-one fight the choking arm and protect the neck, keep your chin down, then slide your hips/shoulders to the floor on the choking-arm side (escape toward the strong side, away from the under-hook), clear the bottom hook, and turn in to come on top or into their guard. Hand-fight first, escape toward the choking-arm side.',
   'Two-on-one on the choking arm and protect your neck, scoot your back to the mat on the choking-arm side, clear the hook, and turn in to end up on top or in their guard.',
   1350),

  ('written', 'Wrestling up from open guard',
   'https://placehold.co/800x480/312e2b/9bb4d4?text=Wrestle+Up',
   'From seated/open guard, you want to come up and take the opponent down rather than play off your back. Describe a sound approach.',
   'Covers: connect to a leg (single-leg / ankle pick / collar-drag), use a frame or grip to off-balance them, get to your feet by posting and elevating hips, keep your head up and drive, finish with a run-the-pipe / ankle-pick / drag to the back. Off-balancing before standing and controlling a tie are key.',
   'Attach to a leg or get a strong tie, off-balance them, post and stand up keeping your head up, then finish a single, ankle pick, or collar-drag to the back.',
   1400),

  ('written', 'Heel hook safety (intro)',
   'https://placehold.co/800x480/312e2b/9bb4d4?text=Leg+Locks',
   'Why are heel hooks considered dangerous, and what should a developing grappler keep in mind when training them?',
   'Covers: heel hooks torque the knee (ACL/MCL/meniscus) and give little pain warning before damage, so injuries happen fast and silently. Train with trusted partners, tap EARLY (to position, not pain), apply the finish slowly/with control, understand ankle vs knee rotation, and follow your gym/ruleset on when they''re allowed. Safety + tap-early = good.',
   'Heel hooks rotate the knee and often hurt the ligaments before you feel pain, so there''s no late tap. Go slow, tap early to position, and train them only with control and trusted partners.',
   1450),

  ('written', 'Maintaining side control',
   'https://placehold.co/800x480/312e2b/9bb4d4?text=Side+Control',
   'You have side control. What keeps it tight and stops the common escapes?',
   'Covers: cross-face and far-side underhook (the "100kg"/shoulder pressure), keep hips low and chest connected, kill the near elbow/frame so they can''t get the underhook or frame to recover, switch hips / sprawl to follow re-guard attempts, and stay heavy. Cross-face + underhook + killing the inside frames = good.',
   'Pin with a cross-face and far-side underhook, stay chest-to-chest and heavy, and kill their near-side frames so they can''t shrimp or get the underhook to escape.',
   1250),

  ('written', 'Breaking grips in the gi',
   'https://placehold.co/800x480/312e2b/9bb4d4?text=Grip+Fighting',
   'Your opponent has a strong same-side sleeve and collar grip on you. How do you break the grips and why does it matter?',
   'Covers: grips control distance/posture and set up their attacks, so winning grips is winning position. Break with leverage against the thumb (two-on-one rip, bicep slicer-style peel, standing up / using bodyweight), then immediately establish your own grip or pass before they re-grip. Mentions not just yanking with the arm. Concept + a real mechanic = good.',
   'Whoever controls the grips controls the exchange. Break against the weak point (the thumb) using two hands or your bodyweight, then immediately get your own grip or start your pass before they re-grip.',
   1200),

  ('written', 'Takedown entries for BJJ',
   'https://placehold.co/800x480/312e2b/9bb4d4?text=Takedowns',
   'Name two reliable takedown options for a BJJ match and what makes them lower-risk than others.',
   'Covers: options like the single-leg, double-leg, ankle pick, snap-down to front headlock, or arm-drag to the back. Lower-risk because they keep you on top, don''t expose your back/guard, and have a built-in transition if they fail (e.g. snap-down to front headlock, or pulling guard as a fallback). Two named options + a risk-aware reason = good.',
   'Good BJJ takedowns (single-leg, ankle pick, snap-down to front headlock, arm-drag) keep you on top and have a safe fallback if they fail, instead of giving up your back or a scramble.',
   1300)
) as v(kind, title, image_url, question, rubric, explanation, rating)
where not exists (
  select 1 from public.puzzles p where p.title = v.title and p.kind = 'written'
);

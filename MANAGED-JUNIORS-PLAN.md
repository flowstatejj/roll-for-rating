# Plan: parent-managed junior (under-14) accounts

Status: **PHASE 1 BUILT** (data model + management + guardrails). **PHASE 2 TODO**
(wire juniors into the match flow). Replaces under-14 self-signup with a
parent-managed model so the app stays clean for COPPA / Apple review.

## Phase 1 — DONE (in code; needs `supabase/managed-juniors.sql` run + dev restart for the new /juniors route)
- profiles.managed_by + self-FK; profiles can exist without an auth user
  (dropped profiles_id_fkey, id now defaults to gen_random_uuid(), and an
  on_auth_user_deleted trigger replaces the old cascade).
- enforce_minor_profile: a managed junior (managed_by set) is consent='verified'.
- enforce_minor_match: + conflict rule (referee != managed_by of either competitor).
- RLS: guardian can read/insert(adult only, under-14)/update/delete their juniors.
- Sign-up blocks under-14 (shows "ask a parent to add you"); 14-17 keeps the
  parent-email flow.
- Profile → "My juniors" (adults): add (name/belt/DOB), list, delete a junior.

## Phase 2 — TODO (operate juniors in matches)
- matches insert RLS: allow guardian to create where challenger/opponent is a
  managed junior. respond_to_match / cancel_match: allow guardian of the junior.
- match/new: "who's competing" selector (self or a junior). Junior pending-
  challenge acceptance from the guardian. Guardian's match list includes juniors.

## Decisions
- Under-14 ("kid" tier, = "13 and younger") accounts are **created and managed
  by a parent/guardian's adult account**. No coach/gym management (parent only).
- **Adult-operated: the child has NO independent login.** The parent operates
  the child's profile from their own signed-in session (e.g. records a match
  for them). Consent is inherent — the parent IS the account holder.
- Existing kid rules still apply: profile not publicly searchable, no
  leaderboard, no wagering, and only matched against other minors.
- **Conflict-of-interest rule:** for a match involving a managed junior, the
  referee may NOT be the managing parent/guardian of either competitor. A
  parent can't referee their own (or the opponent's) child — a neutral adult
  (e.g. the coach) records the result. Enforced server-side.
- **Under-14 self-signup goes away.** If someone enters a DOB under 14 on the
  sign-up screen, we tell them: "Ask a parent or guardian to add you from their
  account." Teen (14-17, self-signup + verified parent email) and adult flows
  are unchanged.

## Why this is the compliant path
COPPA restricts collecting data *directly from* an under-13 without verifiable
parental consent + control. Making the parent the account holder/operator (the
child never independently authenticates or self-enters data online) is the
structure regulators and Apple expect — same shape as Apple Family Sharing /
console kids' accounts. It also matches the app's reality: matches happen in
person at a gym under a supervising adult.

## Implementation sketch

### Data model
- `profiles.managed_by uuid references public.profiles(id) on delete cascade`
  — set to the guardian's profile id for a managed junior; null for everyone else.
- A managed junior has a `profiles` row (so it can be a match competitor and
  carry a rating) but **no login**.
  - **Decision to make at build time:** either (a) managed juniors are NOT
    auth.users rows — requires relaxing `profiles.id references auth.users` and
    adding a nullable `auth_user_id` (cleaner data model, bigger change), or
    (b) a managed junior is still an auth user created behind the scenes whose
    credentials the parent never uses, operated via guardian authorization
    (smaller change, slightly less "pure"). Recommend (a) for a clean model.
- Consent: a managed junior is treated as consent-satisfied (managed_by set),
  so `enforce_minor_match` lets their matches through without the email step.

### RLS / server
- Guardian can read/manage profiles where `managed_by = my profile id`.
- Guardian can create/act on matches on behalf of their managed juniors
  (insert policy allows challenger/opponent = a junior they manage).
- `enforce_minor_match` gains a conflict check: if either competitor is a
  managed junior, reject the match when `referee_id` equals the `managed_by`
  (guardian) of the challenger or the opponent. (i.e. a parent can't ref their
  own/opponent's kid — a neutral adult must.)
- All existing minor enforcement (no wager, private, minors-only opponents,
  no leaderboard) continues to apply to managed juniors.

### App / UX
- Sign-up: block under-14 with a friendly "ask a parent to add you" message.
- Parent's Profile/Settings → **"My juniors"**: add a junior (name, belt,
  date of birth confirming <14), view each junior's rating + match history,
  edit settings, and delete.
- Recording a match for a junior: from the parent session, pick which junior
  is competing (pairs naturally with the existing kiosk flow at the gym).
- Account deletion: deleting the parent cascades to managed juniors; parent can
  also delete an individual junior.

## Scope estimate
Medium-large: touches the profiles schema + RLS, sign-up, a new juniors
management area, and the match-create path. Best done as its own focused build.
No urgency — Apple Developer account is still pending.

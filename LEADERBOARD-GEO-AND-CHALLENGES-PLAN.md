# Plan: geographic leaderboard levels + kid-vs-kid challenges

Status: **DESIGN LOCKED — not built yet.** Build as the next focused unit (two
phases). Decisions captured from the design discussion.

## Phase A — Geographic leaderboard levels (from gym location)

Levels: **City · State · Country · Continent · World** on BOTH the Overall and
13-&-under boards. A member's geography follows the gym they train at; kids
inherit their gym. Members with no gym (or a gym missing location) appear only
at **World**.

Build:
- `gyms`: add `state`, `country`, `continent` (text). The APP derives continent
  from country (a country→continent map in JS) and stores it, so SQL can filter
  on it cheaply. Update `create_gym` + the gym create/edit UI to capture
  state + country (city already exists). Backfill existing gyms = null → World only.
- Overall board: client query joins gym location; fetch a wider top-N and filter
  client-side to the selected level relative to the viewer's gym geo. Excludes kids.
- Kids board: extend `kids_leaderboard(p_level, p_limit)` (SECURITY DEFINER) to
  compute the viewer's gym geo and filter kids to the same City/State/Country/
  Continent (World = no filter). STILL returns only first_name + rating
  (geography is used for filtering, never exposed). Visibility gate (minors +
  guardians) stays.
- A small `fetchMyGeo()` returns the viewer's gym {city,state,country,continent}
  to drive the client-side filter + the kids RPC arg.

## Phase B — Kid-vs-kid challenges off the leaderboard (invite model)

Use case: a kid travels for comps/vacation and wants to roll a "good kid"
elsewhere. SAFE because every kid is parent-operated on both sides and the match
is in person with a neutral referee — it's really one parent arranging with
another kid's parent (like a comp sign-up), never a stranger contacting a child.

Flow: **invite → arrange → match.**
- New table `match_requests`: id, from_junior (challenger's kid), to_junior
  (challenged kid), created_by (challenger's guardian), status
  (pending/accepted/declined/cancelled), created_at. RLS: a guardian creates
  where from_junior is their managed junior; the target's guardian reads/responds
  where to_junior is theirs; both sides read their own.
- The kids board's `kids_leaderboard` returns an **opaque profile id** alongside
  first_name + rating ONLY to eligible viewers (so a guardian can target a row).
  The id is an opaque handle — RLS still blocks reading the kid's real
  name/gym/profile, so the board stays anonymous (you still see only a first
  name). A "Challenge" button on a row creates a match_request to that kid.
- The target kid's **guardian** gets the request in an inbox, with accept/decline.
- On accept → opens the existing in-app chat between the two guardians to set
  when/where; when they meet, they create the actual refereed match via the
  existing Phase-2 flow (challenger junior vs opponent junior, neutral referee).
  The match_request is marked accepted/closed.
- All existing kid rules still apply to the resulting match (no wager, not
  public, minors-only, parent can't ref).

## Separate track — parent identity verification + offender screening
See APP-STORE-PREP / discussion: needs a third-party vendor + legal, not code
alone. Not part of A/B. Scaffolding can be added when a vendor is chosen.

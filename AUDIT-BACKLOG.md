# Roll for Rating - audit remediation backlog (triaged)

From the 100k-user audit (85 findings). This is the DEFERRED set, prioritized by
launch impact x effort. Full detail per item is in `AUDIT-100K-REPORT.md`.
Effort: S = <1h, M = a few hours, L = a day+ / needs design.

**Already fixed (not in this list):** all 5 criticals, ~11 highs, and ~6 index
mediums - shipped in PRs #59-65 (server-side deployed to prod; client OTA'd).
The kids'-video-privacy fix is code-complete and one command from done (pending
your device playback test → then run `videos.sql`).

---

## TIER 0 - Fix before PUBLIC launch (compliance / review / paying-user harm)

| Item | Sev | Effort | Where | Fix |
|---|---|---|---|---|
| Minors' **exact birthdate + full PII** selectable by any authenticated user (teens 14-17) | HIGH | M | `kid-privacy.sql`, `kid-challenges.sql`, `schema.sql` profiles SELECT `using(true)` | Column-restrict the profiles read grant (drop birthdate/PII from what `authenticated` can select), OR a view for public reads. Careful not to break leaderboard / opponent-picking. This is the COPPA sibling of the video fix. |
| **Gym self-join unlocks kids' full rows** | HIGH | M | `social.sql` gym join + profiles read | Same root as above (profiles read policy). Fix together. |
| Signup **fails opaquely on duplicate username** (`handle_new_user` raises → "Database error saving new user") | MED | S-M | `schema.sql` / `minors.sql` handle_new_user | Pre-check/uniquify username in the trigger or return a clean error the client can show. Signup must be robust for reviewers + real users. |
| Match detail / chat **spin forever on any load failure** (incl. push deep links) | MED | S | `match/[id].tsx`, `chat/[id].tsx` | Surface the error + a retry instead of an infinite spinner. Reviewers hit deep links. |
| Age tier rests on **unverified client birthdate** (a kid can claim adult, bypassing minor protections) | MED | L/policy | `minors.sql` | Hard to fully fix (birthdate is self-reported). At minimum document the limitation for review; consider a soft speed-bump. Legal/policy call. |

## TIER 1 - Fix during the closed test / shortly after launch (real bugs, money, small scale)

| Item | Sev | Effort | Where | Fix |
|---|---|---|---|---|
| **Android renewals never re-entitle** - every Android subscriber locked out at each monthly renewal until they tap Restore | HIGH | M | `subscription.tsx` | Re-validate on renewal / app foreground. **Needs a device billing test.** Bites ~1 month post-launch. |
| **Purchase finished even when `validate-purchase` fails** - user charged, no entitlement, no error | HIGH | M | `subscription.tsx` | Don't `finishTransaction` on validation failure; surface an error + retry. Device test. |
| **Grace-period payers locked out** - `has_active_entitlement` needs `expires_at > now()`, but grace is exactly when it's passed | MED | S | `subscriptions.sql:62` | Treat `status='grace'` as active regardless of `expires_at`. One-line SQL, but payment-adjacent - verify. |
| **Comp grant clobbers a real paid entitlement row** (single-row upsert conflates comp + store) | MED | M | `subscriptions.sql` | Don't let a comp upsert overwrite an active apple/google row (guard the on-conflict). |
| Leaderboard + **Biggest Pots boards fetch global top-N then filter client-side** → city/gym boards wrong/empty | HIGH/MED | M | `leaderboard.tsx`, `high-rollers.tsx`, `matches.ts` | Push the scope filter server-side (RPC params) so each board queries its own scope. |
| **Wagered draw shows "opponent won the N ROR pot!"** when nobody won | MED | S | `match/[id].tsx` | Handle the draw case in the result copy. Quick win. |
| Wager cap enforced **only at INSERT, not settlement** - stacked pending wagers + 100-floor mint Elo | HIGH | L | `wager-cap.sql`, `_settle_match` | Check total outstanding wager exposure at settlement. Economy math - design carefully. |
| **Referral earnings ignore the referral date** - commission owed on months predating the referral | HIGH | M | `referrals.sql` | Scope earnings to purchases after the referral. Affects real payouts. |
| `fetchMyMatches` **downloads entire lifetime history** (5 call sites incl. the pending-count badge; 3 duplicate refetches per realtime event) | MED | M | `matches.ts`, `use-pending.ts`, `index.tsx` | Add a LIMIT/pagination; count pending via a cheap count query, not full history. (The caching-layer plan also dedupes the 3 refetches.) |
| Family-plan **seat limit is INSERT-time only + race-bypassable** (downgrade keeps unlimited kids; concurrent inserts exceed cap) | MED | M | `family-plan.sql` | Enforce capacity in a locked function, not an RLS `count=0` check; re-check on plan change. |
| Entitlement **never re-checked mid-session** - expired/refunded keep access until app restart | MED | M | `subscription.tsx` | Re-check on AppState foreground. |
| Paywall is **client-routing only - no RLS/API gate** uses `has_active_entitlement` | MED | L | app-wide RLS | A non-paying authenticated user can read app data via direct API. Real revenue hole, but a big change (gate reads behind entitlement). Weigh vs. launch timing. |

## TIER 2 - Scale hardening (bites at ~10k-100k, not at launch)

- **Realtime architecture**: ~10-16k filtered `matches` subscriptions at 2k concurrent exceeds Supabase guidance → move to broadcast-from-trigger or polling. (HIGH, L)
- `king_slayer_progress` 6x full-scan of profiles per quests open → rewrite w/ early scope filter + `EXPLAIN`. (HIGH→MED, M, needs test DB)
- `searchProfiles` leading-wildcard ILIKE can't index → trigram (`pg_trgm`) index. (MED, M)
- Unbounded fetches: `fetchTournaments`, `fetchFriendlyOpponents`/network opponents, `fetchMatchReactions`, `fetchOpenMatRegions`, `fetchMatchMessages`, `wager_leaderboard` re-aggregation → add LIMITs / server aggregation / indexes. (MED-LOW, M total)
- Concurrency races: `claim_submission_rewards` double-award, `grant_elite` quota, `_settle_match` lock ordering deadlock. (MED-LOW, M - add locks/uniqueness)
- Data growth / cost: `notifications` unbounded (+ fan-out), `analytics_events` no retention + client can insert unbounded rows, `send-push` never prunes dead tokens, match-video files orphan on match-cascade delete. (MED, M - retention jobs + token pruning + storage cleanup)
- `verify-face` no rate limiting (Anthropic budget burn). (MED, S - add a rate limit)
- ILIKE city filters bypass `lower(city)` indexes across leagues/tournaments/gyms/open-mats. (LOW, S)

## TIER 3 - Post-launch polish (LOW)

- `REPLICA IDENTITY FULL` missing → filtered subscribers miss DELETE events.
- Unused tables in realtime publication (`league_messages`, tournament tables) - trim.
- Chat refetches whole history per INSERT + double-fetch on send; `match_messages.body` no length cap.
- Avatar replacement cleanup fire-and-forget → orphaned files accumulate.
- Comp/founding-member entitlements inflate referral "active" counts.
- `restore()` races its own validation (transient "no purchases" flash).
- `validate-purchase` iOS path fails OPEN (defaults to 'active' when Apple lookup returns null) - tighten to fail closed.

---

## Suggested sequence
1. **Tier 0** before flipping to public (minor-PII read policy is the big one; pair it with the gym-join fix).
2. **Tier 1** across the 14-day closed test - start with the S/quick wins (grace-period, draw-copy, spinner) then the billing pair (needs your device).
3. **Tier 2** before you push real growth / marketing.
4. **Tier 3** whenever.

Nothing here is a known critical - those are all fixed. This is the hardening path from "safe to launch small" to "ready for 100k."

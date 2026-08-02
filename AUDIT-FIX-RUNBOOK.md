# Audit fix batches - deploy runbook

Six branches, all HELD (committed, not pushed, not merged, not deployed) from the
2026-07-20 audit. Full findings: `AUDIT-2026-07-20.md`.

| Batch | Branch | Prod SQL | Edge fns | App (OTA) |
|---|---|---|---|---|
| 1 | `fix/batch1-criticals` | yes | video-url | yes |
| 2 | `fix/batch2-deletion-retention` | yes | delete-account, purge-old-videos | yes |
| 3 | `fix/batch3-entitlements` | yes | validate-purchase | yes |
| 4 | `fix/batch4-minors-tournaments` | yes | send-push | yes |
| 5 | `fix/batch5-leagues-rerun` | yes | - | - |
| 6 | `fix/batch6-tournament-correctness` | yes | - | yes |

## Before anything

1. **Nothing here has been run against a database.** Every SQL file ends with a
   one-row diagnostic; read it after each run and stop if a value is unexpected.
2. **Deno is not installed on the dev machine**, so no edge function in batches
   1-4 has ever been compiled. Run `deno check supabase/functions/*/index.ts`
   (or deploy to a staging project) before production.
3. The Android billing change (batch 1) needs a **real Play license-tester
   upgrade purchase**. It cannot be verified any other way.

## Order

SQL first within a batch, then the edge function, then the app - except where
noted. Files are additive and idempotent unless stated.

### Batch 1 - criticals
1. `supabase/settlement-and-teams-hardening.sql` (run LAST of the SQL files;
   requires tournaments-pro.sql to already exist)
   - Expect `anon_callable_definers = 0`, `suspect_settled_matches = 0`,
     `outsider_captain_teams = 0`. **A non-zero suspect count means the
     unilateral-settlement hole was actually used** - investigate before moving on.
2. Deploy `video-url`.
3. OTA the app.

### Batch 2 - deletion + retention
1. **Add the R2 secrets to `delete-account`** (`R2_ACCOUNT_ID`, `R2_BUCKET`,
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`). It never needed them before.
   Without them deletion still succeeds but every video is recorded as residue.
2. `supabase/deletion-retention-hardening.sql`
   - Expect `referee_fk_action = n`, `release_trigger = 1`,
     `referee_mode_relaxed = true`. If the FK lands but the trigger does not,
     account deletion starts FAILING for anyone with a live refereed match.
3. Deploy `delete-account` and `purge-old-videos`.
4. OTA the app.

### Batch 3 - entitlements
1. `supabase/junior-capacity-and-comp-guard.sql`
   - Expect `first_founder_capacity = 5`, `founders_without_family_product = 0`.
     If capacity is 1, the founding-member flag is not set on that profile.
2. Deploy `validate-purchase`.
3. OTA the app.

### Batch 4 - minors + tournaments + push
1. `supabase/minors-and-tournament-state.sql`
   - Expect `kid_unlock_requires_accepted = true`, `complete_guard = 1`.
2. Deploy `send-push`. **Safe to deploy alone**: the function no longer trusts
   the request body (it re-reads the notification row), and the shared secret
   stayed optional precisely so this deploy cannot cause a push outage.
   If you later add `PUSH_WEBHOOK_SECRET`, add the webhook's
   `x-webhook-secret` header FIRST, then set the secret.
3. OTA the app.

### Batch 5 - leagues RLS + re-run traps
1. `supabase/leagues-rls-followup.sql`
   - Expect `invite_branch_fixed = true`, `membership_lock = 1`,
     `orphan_memberships = 0`.
   No app change.

### Batch 6 - tournament correctness
1. `supabase/tournament-correctness.sql`
   - Expect `event_bypass = true`, `delete_guard = true`.
2. OTA the app.

## Standing hazards these batches introduce

Several fixes now OWN objects that older files also define. Re-running the older
file silently reverts the fix. Each new file names what it owns in its header;
the short version:

- `settlement-and-teams-hardening.sql` owns `confirm_match_result`,
  `set_submission_type`, `add_team_member` and the tournament-team RLS policies.
  **Re-running `tournaments-pro.sql` reverts most of batch 1.**
- `deletion-retention-hardening.sql` owns the `referee_mode` constraint
  (`match-waive-and-wager.sql` carries the matching relaxed version).
- `junior-capacity-and-comp-guard.sql` owns `my_subscription` and the
  managed-junior insert policy (`family-plan.sql` reverts them).
- `minors-and-tournament-state.sql` owns `profiles_read_visible` and
  `complete_tournament` (the source files now carry the safe version too).
- `leagues-rls-followup.sql` owns `leagues_read`.

Batch 5 adds a re-run banner to every file that redefines the signup trigger,
naming `signup-trigger-consolidated.sql` as authoritative.

## Deliberately NOT fixed - these need a product decision

- **Leagues / tournaments / gyms cascade on delete.** One organizer deleting
  their account still erases an entire league, tournament or gym for everyone in
  it. Needs an ownership-transfer story.
- **Gym membership is self-service and unlocks every child at that gym**
  (`profiles_read_visible`). Narrowing it changes what gym-mates can see.
- **Guest competitors are stamped as adults by design**, so a child entered by a
  host has their real name and weight world-readable with no minor protections.
  Needs a guest privacy model.
- **Once a kid challenge is accepted, the unlock is permanent and whole-row.**
  The right shape is a SECURITY DEFINER projection (like `my_match_requests`)
  rather than an RLS arm, so the other family sees only what the screen needs.
- **No notification is sent when a kid challenge arrives**, and the app tells the
  challenger the other guardian "will be notified". Now that acceptance is the
  load-bearing gate, that copy is wrong or the trigger is missing.
- **Password-reset email rate limit.** Config, not code: production SMTP plus a
  raised limit, or resets fail fleet-wide at scale.
- **Watch-feed sort and realtime subscription count.** Both need EXPLAIN against
  real data / a device smoke test before touching; no safe change was available
  without measurement, so nothing was changed.

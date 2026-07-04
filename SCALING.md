# Roll for Rating - scaling roadmap (100k -> 1M)

Where the stack holds, where it breaks, and the fix for each - so the work is
mapped when growth demands it. Nothing here is needed pre-launch; the audit
fixes (see AUDIT-BACKLOG.md) get you safely through the low-thousands, and this
is the path beyond.

## TL;DR

| Subsystem | Holds to | Breaks at 1M because | Fix |
|---|---|---|---|
| Video serving (R2 + Worker) | 1M+ | per-view DB access check | JWT-verify-only or KV cache in the Worker |
| Video storage (R2) | 1M | storage grows with retention x length | shorter retention / duration cap / 540p |
| Realtime (postgres_changes) | ~100k (already tight) | O(subscribers x events) fanout | Broadcast / dedicated pub-sub / polling |
| Analytics writes | ~100k | billions of rows into the app DB | ship to ClickHouse/BigQuery or a queue |
| Leaderboards / quests | ~100k | live sort/scan over 1M profiles | precompute on a schedule (materialized) |
| Push fan-out | ~10k-100k | per-row webhook to send-push | batch (100/req) + a queue |
| Postgres (general) | ~100k | single hot instance | read replicas, pooling, partition big tables |
| Auth (GoTrue) | 1M+ | - | JWTs are stateless; fine |

## Video path (R2 + Cloudflare Worker) - 1M-ready with two tweaks

At 1M users x 2 videos/week x 200 views ~= **1.7B views/month**.

- **Serving:** Workers + R2 scale flat, egress stays $0. ~1.7B presigns x $0.30/M
  ~= **$500/mo**.
- **Tweak 1 - access check.** The Worker currently does one RLS read of
  `match_videos` per view (~650/sec at 1M) - the weak link. Switch it to verify
  the Supabase JWT *signature* only (pure crypto, no DB) and rely on the
  row-read gate + unguessable paths, OR cache the allow/deny in Cloudflare KV
  keyed by (user, path) for the URL lifetime. One-file Worker change, no app
  change.
- **Tweak 2 - storage.** 2-week retention holds ~4M live videos; at 720p that is
  roughly **$2-6k/mo** in R2 depending on average length. Egress is still free -
  storage is the cost now. Dials: retention window, a duration cap, or 540p.
  Video length is the single biggest lever on the video bill.

## The real 1M ceiling: Postgres as the single hot datastore

1. **Realtime is #1.** `postgres_changes` (live match list, badge, chat) is
   already past Supabase's comfort zone at 100k. At 1M / ~15-20k concurrent it
   won't hold. Move live updates to **Supabase Broadcast** (scales far better),
   a dedicated pub/sub (Ably/Pusher), or polling cheap cached endpoints. The
   per-user subscription scoping (PR #56) buys headroom but is not the endgame.
2. **Analytics writes.** Every screen event as a Postgres row = billions/month.
   Send analytics to a purpose-built store (ClickHouse/BigQuery) or a queue;
   keep it out of the app DB. Add retention regardless.
3. **Leaderboards / quests.** Sorting/scanning 1M profiles live on every open is
   too heavy even indexed. Precompute the boards on a schedule (a cron +
   materialized table) and serve the cached result.
4. **Standard big-DB moves:** read replicas (route heavy reads off the primary),
   connection pooling (Supavisor), and time-partition the giant tables
   (analytics_events, notifications, match_messages).

## Push fan-out

`send-push` fires per notification row (a webhook per insert). A single league
announcement to 1M members would melt it. Batch to the Expo push API's 100
messages/request, put it behind a queue, and prune dead tokens on send failure
(also an audit item).

## Rough monthly cost at 1M

| | Cost | Note |
|---|---|---|
| Video serving (Worker) | ~$500 | flat |
| Video storage (R2) | ~$2-6k | retention x length is the dial |
| Postgres (+replicas) | ~$1-5k | architecture is the blocker, not the price |
| Analytics store | +$ | move off Postgres |
| Push | needs a queue | not a raw $ line, an architecture one |

## Staging - what to actually do, when

- **Now (pre-launch -> low thousands):** ship the audit fixes. Nothing here.
- **~10k-100k users:** deploy the video Worker (this repo), precompute
  leaderboards, batch push, add analytics retention, turn on a Postgres read
  replica.
- **Approaching 1M:** re-architect realtime (Broadcast/pubsub), move analytics
  to a warehouse, apply the two video-Worker tweaks, partition big tables.

Hitting 1M is the problem you *want* - this is the map for when you get there.

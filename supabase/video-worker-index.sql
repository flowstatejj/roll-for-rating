-- Index for the video-url Cloudflare Worker's per-view access check
-- (match_videos lookup by path). Paths are unique (one row per stored file), so
-- a unique index both speeds the lookup and enforces the invariant. Safe to re-run.
create unique index if not exists idx_match_videos_path on public.match_videos (path);

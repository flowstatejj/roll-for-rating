# video-url Cloudflare Worker (playback presigner)

Cheaper playback presigning at scale (~$0.30/M vs Supabase ~$2/M). The client
(`videoSignedUrl`) uses this Worker when `EXPO_PUBLIC_VIDEO_WORKER_URL` is set,
and falls back to the Supabase `video-url` edge function otherwise - so this is
optional and safe to leave undeployed until video traffic is real.

## Deploy

```bash
cd cloudflare/video-worker
npm install

# Auth wrangler to your Cloudflare account (opens a browser once):
npx wrangler login
#   or export CLOUDFLARE_API_TOKEN=<token with Workers Scripts:Edit>

# Secrets (same values as the Supabase R2 secrets):
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
npx wrangler secret put SUPABASE_ANON_KEY

npx wrangler deploy
# -> prints the URL, e.g. https://video-url.<your-subdomain>.workers.dev
```

## Wire it up

1. Add to the app `.env`:  `EXPO_PUBLIC_VIDEO_WORKER_URL=https://video-url.<subdomain>.workers.dev`
2. OTA the client. Playback presigning now runs on Cloudflare; upload/delete
   stay on the Supabase edge function.

Requires the `match_videos(path)` index (supabase/video-worker-index.sql) so the
Worker's per-view access check stays fast at scale.

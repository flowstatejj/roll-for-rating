# RollCall 🥋

Gamified Jiu-Jitsu rolling. Two competitors agree to a match in the app, a
third person referees and records the result, and Elo-style ratings update
automatically. Built for open mats.

- **App:** Expo (React Native) + Expo Router + TypeScript
- **Backend:** Supabase (auth, Postgres, realtime)

## How a match works

1. **Challenger** creates a match and picks an **opponent** + a **referee**.
2. **Opponent** accepts or declines the challenge.
3. After the roll, the **referee** records the winner and how it ended.
4. Both competitors' **Elo ratings** update automatically (server-side, so
   nobody can edit their own rating).

## First-time setup

### 1. Create a Supabase project
- Go to [supabase.com](https://supabase.com) → New project (free tier is fine).
- In **Project Settings → API**, copy the **Project URL** and the **anon public** key.

### 2. Configure the app
Copy `.env.example` to `.env` and paste your values:

```
EXPO_PUBLIC_SUPABASE_URL=https://your-ref.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Create the database
In the Supabase dashboard → **SQL Editor** → New query, paste the contents of
[`supabase/schema.sql`](./supabase/schema.sql) and run it. This creates the
tables, security rules, the auto-profile trigger, and the server-side Elo logic.

> Optional for easy testing: **Authentication → Providers → Email** → turn
> *Confirm email* off so new sign-ups can log in immediately.

### 4. Run it

```bash
npm install
npx expo start
```

Then press `a` (Android emulator), `i` (iOS simulator), or scan the QR code
with the **Expo Go** app on your phone.

## Project layout

```
src/
  app/                 # screens (Expo Router file-based routing)
    (auth)/            # sign-in / sign-up
    (tabs)/            # home, matches, leaderboard, profile
    match/             # new challenge + match detail
  components/          # MatchCard + UI kit
  lib/                 # supabase client, auth, data layer, types
supabase/schema.sql    # database schema (run in Supabase SQL editor)
```

## Rating system

Standard Elo with K-factor 32. Everyone starts at **1200**. A draw counts as
half a win for each competitor. All rating math lives in the
`record_match_result()` Postgres function so it can't be tampered with from the
client.

## Roadmap ideas

- AI match review / commentary
- Offline result queue (record at the mat, sync when back online)
- QR code to add an opponent/referee instantly
- Tournament result import

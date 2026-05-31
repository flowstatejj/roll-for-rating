# App Store / TestFlight prep — Roll for Rating

Status of getting the app onto iPhones via the Apple Developer account.

## ✅ Done in the code (no action needed)

- **Supabase keys in builds** — `eas.json` now passes `EXPO_PUBLIC_SUPABASE_URL`
  + anon key as build-time env for development/preview/production, so cloud
  builds connect to the backend. (The anon/publishable key is safe to ship.)
- **Export-compliance flag** — `app.json` → `ios.config.usesNonExemptEncryption
  = false`, so submission won't stall on the encryption question (the app only
  uses standard HTTPS).
- **In-app account deletion** — Profile → **Delete account** (double-confirm)
  calls the `delete-account` edge function, which removes the auth user; FK
  cascades wipe their profile/matches/stats. Required by App Store Guideline
  5.1.1(v). **DEPLOYED ✅** (edge function live on the project).
- **Parent-managed under-14 (juniors)** — under-14 self-signup is blocked; a
  parent adds/operates juniors from their own account (no kid login). Removes
  the core COPPA problem. SQL run; see the COPPA section below.
- **Permission strings** — camera/photos usage descriptions set via the
  expo-image-picker plugin in `app.json`.
- **Bundle ID** — `com.flowstatejj.rollforrating` (iOS + Android).

## 📝 You-side, before submitting

1. **Apple Developer Program** — enroll ($99/yr).
2. **Free Expo account** — sign up at expo.dev. Then, in the project, run
   `npx eas init` (links the project + adds the EAS projectId to app.json) and
   `npx eas build -p ios --profile production`, then `npx eas submit -p ios`.
   (We'll walk through these together when you're ready.)
3. **Privacy policy** — draft is in `PRIVACY-POLICY.md`. Fill in the contact
   email + date, host it at a public URL, and put that URL in App Store Connect
   → App Privacy. Also answer the App Privacy "data collection" questions
   (collects: contact info, user content, identifiers; not used for tracking).
4. **App icon** — currently the **default Expo placeholder** (`assets/images/
   icon.png` + `assets/expo.icon`). Replace with a real Roll for Rating icon
   (1024×1024, no transparency) before launch.
5. **Store listing** — name, subtitle, description, keywords, **support URL**,
   category (Sports), and **screenshots** (need a build running on a device or
   simulator). I can draft all the text whenever you want.

## COPPA / minors posture (RESOLVED — this is our story for review)

Decision made: **under-14 ("kid") accounts are parent-managed and adult-operated**
(no child login). This is the structurally correct COPPA arrangement and removes
the biggest review risk. How each tier works:

- **Adult (18+):** full access.
- **Teen (14–17):** self-signup, but **restricted until a parent approves** via an
  emailed link. No wagering.
- **Under-14 ("kid"):** **cannot self-sign-up** (blocked in-app). A parent/guardian
  creates and operates the profile from their own account. The child never logs
  in or independently enters data. Not publicly searchable, no leaderboard, no
  wagering, only matched against other minors, and a parent can't referee their
  own junior's match. The parent can delete the junior anytime.

**Do NOT enrol in the "Kids Category."** Roll for Rating is a general grappling
app that *supports* juniors, not a kids' app, and it uses third-party services
(Supabase, Anthropic) that the Kids Category forbids. Answer the App Store age
questionnaire as a general app → expect a **12+** rating.

**Still required before a public launch:**
- Host the privacy policy and answer the App Privacy data questions.
- A one-time **attorney review** of the minors handling (COPPA + your state) is
  cheap insurance — recommended, not done.

**Open item:** the teen parent-consent **email functions are not deployed yet**
(`request-parent-consent` / `verify-parent-consent`). Until they are, a teen
account stays in "waiting for approval" forever. Before submitting, either deploy
those two functions, or set a 13+/18+ minimum for v1, or call it out in the
review notes (below).

## App Review notes — paste into App Store Connect → App Review Information

> Notes field. Critical because reviewers cannot fully exercise an in-person app.

```
Roll for Rating records IN-PERSON Brazilian Jiu-Jitsu matches. A match needs
three real people who are physically together: two competitors who agree to the
match in the app, plus a third person (a referee/witness) who records the
result. Because of this, a single reviewer on one device cannot complete a full
match alone. We've provided demo accounts below so you can see every screen and
flow; to walk a match end-to-end, sign in as each of the three accounts in turn
(e.g. on the simulator) and accept/record from each.

Demo accounts (password for all: <SET A PASSWORD>):
  • Competitor A — <email>
  • Competitor B — <email>
  • Referee     — <email>
These accounts are pre-loaded with completed and pending matches so you can see
ratings, history, leaderboards, puzzles, and the public "Watch" feed without
needing live opponents.

Minors: under-14 members do NOT create their own accounts. A parent/guardian
adds and operates a junior profile from their own adult account (Profile → My
juniors); the child never logs in. Under-14 self-signup is blocked in the app.
Minors cannot wager, are not publicly searchable, and can only be matched
against other under-18 members. This app is a general sports app and is NOT
intended for the Kids Category. Account deletion is available in-app at
Profile → Delete account.

Contact for any questions: <YOUR SUPPORT EMAIL>
```

### Demo-account setup (do this before submitting)
1. Sign up 3 normal accounts (Competitor A, Competitor B, Referee) — these can be
   real sign-ups on the live app.
2. Run a couple of matches between A and B with Referee recording results, so
   there's visible history/ratings. Leave one challenge pending so the reviewer
   sees the accept flow. Publish one completed match so the Watch feed isn't empty.
3. Optionally add a managed junior under Competitor A to demonstrate the
   parent-managed flow.
4. Put the three emails + one shared password into the review notes above.
   (Use throwaway emails you control; you can delete these accounts after review.)

## TestFlight reality check

- **Internal testing (just your own devices):** lightest path — mainly needs
  the keys (done) + the compliance flag (done) + a build.
- **External testers / public App Store:** also needs the privacy policy hosted,
  a real icon, screenshots, the age-rating answers, and the App Review notes +
  demo accounts above — plus Apple's Beta App Review. (Account deletion is done
  and deployed.)

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
  5.1.1(v). **Needs the function deployed (see below).**
- **Permission strings** — camera/photos usage descriptions set via the
  expo-image-picker plugin in `app.json`.
- **Bundle ID** — `com.flowstatejj.rollforrating` (iOS + Android).

## 🔧 One-time deploy for account deletion

Deploy the function in the Supabase dashboard (Edge Functions → Create via
editor), name it exactly `delete-account`, keep **Verify JWT ON**, paste
`supabase/functions/delete-account/index.ts`, Deploy. No extra secrets needed.
Until deployed, the button shows a friendly "not set up yet" message.

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

## ⚠️ Decision to make: the under-14 tier

Allowing **under-13** users + collecting data invites COPPA / Apple "Kids"
scrutiny and can complicate review. The verified-parental-consent system we
built mitigates this, but consider either:
- keep the under-14 ("kid") tier with parental consent (more review risk), or
- set a **13+ minimum** at sign-up to sidestep the strictest rules.

Settle this before submitting and answer the age-rating questionnaire to match.

## TestFlight reality check

- **Internal testing (just your own devices):** lightest path — mainly needs
  the keys (done) + the compliance flag (done) + a build.
- **External testers / public App Store:** also needs the privacy policy,
  account deletion (done, just deploy it), a real icon, screenshots, and the
  age-rating answers — plus Apple's Beta App Review.

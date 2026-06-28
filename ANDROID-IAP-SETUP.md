# Android In-App Purchases (Google Play Billing) - go-live setup

How to take Roll for Rating's Android subscriptions from "code merged" to
"actually charging money". The same two products ($4.99 individual, $9.99
family) that already work on iOS, wired through Google Play Billing.

## Status (2026-06-28)

DONE (in code + on prod):
- Client + server code merged to `master` (PRs #51, #52).
- DB migration run live: `entitlements.source` now allows `'google'`
  (`supabase/google-iap.sql`, also folded into `supabase/subscriptions.sql`).
- `app.json` is Android-ready: `expo-iap` plugin (auto-adds the
  `com.android.vending.BILLING` permission), `google-services.json`, package
  `com.flowstatejj.rollforrating`.
- Reviewed by a 4-lens adversarial pass; iOS path verified unchanged.

NOT done (the steps below, all need your accounts / banking):
1. Google Play Payments merchant profile.
2. Two subscription products in Play Console.
3. Google service account + Play Developer API access + JSON key.
4. Supabase edge secrets.
5. Deploy the `validate-purchase` edge function.
6. New Android build + upload to closed testing.
7. Test a real purchase.

## Steps

### 1. Payments merchant profile
Play Console > Setup > Payments profile. Add bank account + tax info. Required
before you can create paid products.

### 2. Create the two subscription products
Play Console > Monetize > Products > Subscriptions > Create subscription.
Use these EXACT product IDs (they must match iOS so the app's family-vs-individual
tier logic works unchanged):
- `com.flowstatejj.rollforrating.pro.monthly` - "Roll for Rating Pro
  (Individual)", base plan monthly auto-renewing, $4.99. Optionally add a 7-day
  free-trial offer to match iOS.
- `com.flowstatejj.rollforrating.family.monthly` - "Roll for Rating Pro
  (Family)", base plan monthly auto-renewing, $9.99.
Activate both.

### 3. Google service account for purchase verification
The edge function verifies purchases via the Google Play Developer API, which
needs a service account.
- a. Google Cloud Console (the project linked to your Play account) > IAM & Admin
  > Service Accounts > Create. Name it e.g. `play-iap-verifier`. No GCP roles
  needed.
- b. That service account > Keys > Add key > JSON. Download it. Keep it secret;
  do not commit it.
- c. APIs & Services > Library > enable "Google Play Android Developer API".
- d. Play Console > Users and permissions > Invite new user > the service-account
  email > grant "View financial data, orders, and cancellation survey responses"
  and "Manage orders and subscriptions" (app-level is enough). This links the
  service account to your Play account.

### 4. Supabase edge secrets
Set on project ref `vrpmqwkpsrftjokwzwsi` (Dashboard > Edge Functions > Secrets,
or CLI):
```
supabase secrets set GOOGLE_PLAY_SERVICE_ACCOUNT_JSON="$(cat path/to/service-account.json)" --project-ref vrpmqwkpsrftjokwzwsi
supabase secrets set GOOGLE_PLAY_PACKAGE_NAME=com.flowstatejj.rollforrating --project-ref vrpmqwkpsrftjokwzwsi
```
(`GOOGLE_PLAY_PACKAGE_NAME` is optional; the code defaults to it.)

### 5. Deploy the validate-purchase edge function
The Google branch is merged but NOT yet deployed. From the repo (supabase CLI
logged in):
```
supabase functions deploy validate-purchase --project-ref vrpmqwkpsrftjokwzwsi
```
iOS keeps working on the current version until this runs; the new version is
backward-compatible (the Apple branch is byte-for-byte the same logic).

### 6. Build + upload to closed testing
Do this AFTER steps 2-5. The app has a hard paywall, so if the subscription
products do not exist yet, testers get stuck at the paywall with no way in.
```
# from WSL, in the repo:
eas build -p android --profile production
```
Upload the `.aab` to Play Console > Testing > Closed testing, add your 12
testers, and start the 14-day test (required for a personal Play developer
account).

### 7. Test a real purchase
Add yourself as a license tester (Play Console > Setup > License testing) so the
purchase is free. Install the closed-test build, subscribe, and confirm:
- the purchase completes and access unlocks,
- `public.entitlements` has a row with `source='google'` (and
  `environment='Sandbox'` for license testers).

## Notes
- Product IDs MUST match iOS exactly; the tier is derived from the `product_id`
  string (`%family%` -> family plan).
- The edge function fails closed: if the secrets / service account are wrong,
  validation errors and NO access is granted. It never mis-grants.
- The Apple / iOS path is unaffected by any of this.

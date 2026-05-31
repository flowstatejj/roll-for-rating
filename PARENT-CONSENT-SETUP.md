# Parental consent (under-18 protection) — setup

This is how the minor-account safety system fits together and what you need to
turn on. The **app + database work today**; only the *email sending* needs a
provider key, and there's a manual fallback until you add one.

## How it works

- At sign-up, members enter a **date of birth**. The server computes an age tier
  (it can't be faked from the app):
  - **adult (18+)** — full access.
  - **teen (14–17)** — after a parent approves: public matches, leaderboard,
    match anyone. **Never wagering.**
  - **kid (<14)** — locked down: no public matches, no leaderboard, not
    searchable, no wagering, matches only within their own gym.
- A minor also enters a **parent/guardian email**. The account is created but
  **restricted** (`consent_status = 'pending'`) until the parent clicks an
  approval link. Minors can't start matches and aren't publicly visible until
  approved.
- Approval link → `verify-parent-consent` edge function flips the account to
  `verified`.

Everything is enforced in Postgres (RLS policies + triggers), so the app can't
bypass it even if the client code were tampered with.

## 1. Run the SQL

In the Supabase SQL Editor, paste and run **`supabase/minors.sql`**
(safe to re-run). It adds the columns, the `parent_consents` table, the tier
helper, and the enforcement triggers/policies.

## 2. Deploy the edge functions

From the project root (needs the Supabase CLI, logged in to the project):

```bash
# Parent's approval landing page — MUST be public (no JWT):
supabase functions deploy verify-parent-consent --no-verify-jwt

# Sends/re-sends the approval email — keep JWT on (caller must be signed in):
supabase functions deploy request-parent-consent
```

## 3. Add an email provider (Resend)

Until this is set, the app's "Resend email" button returns the approval **link**
so you can send it to the parent manually (good enough for testing).

1. Make a free account at resend.com, verify a sending domain (or use their
   `onboarding@resend.dev` test sender), and create an API key.
2. Set the secrets on the Supabase project:

```bash
supabase secrets set RESEND_API_KEY=re_xxxxxxxx
supabase secrets set CONSENT_FROM_EMAIL="Roll for Rating <noreply@yourdomain.com>"
# Optional: only if your functions URL differs from <project>.supabase.co/functions/v1
# supabase secrets set PUBLIC_FUNCTIONS_URL="https://<project>.supabase.co/functions/v1"
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are provided
to edge functions automatically — don't set them by hand.

## Testing without email

To approve a test minor account by hand, run this in the SQL Editor (replace the
username):

```sql
update public.parent_consents pc
   set status = 'verified', verified_at = now()
  from public.profiles p
 where p.id = pc.user_id and p.username = 'TEST_USERNAME';

update public.profiles
   set consent_status = 'verified'
 where username = 'TEST_USERNAME';
```

## Notes / future hardening

- The `parent_consents` table has **no RLS policies**, so only the service role
  (the edge functions) can read the token — a minor can't approve themselves
  from the app.
- The age tier is recomputed from the birthdate on every profile write, so a
  teen automatically becomes an adult after they turn 18.
- Possible later additions: token expiry, re-consent on tier change, parental
  dashboard, COPPA-style data-minimization review before public launch.

// Supabase Edge Function: validate-purchase
// Verifies an in-app purchase server-side and records the entitlement.
//
// iOS (StoreKit 2): the client sends the StoreKit `transactionId`. We read the
// authoritative transaction from Apple's App Store Server API.
// Android (Play Billing): the client sends the `purchaseToken` (+ productId).
// We read the authoritative subscription from Google's Play Developer API.
// Either way we never trust client-supplied product/expiry, and upsert the row
// in public.entitlements keyed by the signed-in user.
//
// Deploy with "Verify JWT" ON (the caller is an authenticated app user).
// Requires the APPLE_IAP_* / APPLE_BUNDLE_ID secrets (see _shared/apple.ts) and,
// for Android, GOOGLE_PLAY_SERVICE_ACCOUNT_JSON / GOOGLE_PLAY_PACKAGE_NAME
// (see _shared/google.ts).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { BUNDLE_ID, getTransaction, getSubscriptionStatus, mapStatus } from '../_shared/apple.ts';
import { acknowledgeSubscription, getSubscriptionV2 } from '../_shared/google.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// The only product ids we sell. The entitlement tier (family vs individual) is
// derived downstream from product_id, so an unknown id must never be stored.
const KNOWN_ANDROID_SKUS = new Set([
  'rollforrating.pro.monthly',
  'rollforrating.family.monthly',
]);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Who is calling? They can only entitle themselves.
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: 'Not authenticated' }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const transactionId = body?.transactionId;
    const purchaseToken = body?.purchaseToken;

    // The entitlement row each store path fills in, plus the values we echo back.
    let row: Record<string, unknown>;
    let status: 'active' | 'grace' | 'expired' | 'revoked';
    let productId: string;
    let expiresAt: string | null;

    if (purchaseToken) {
      // ---- Android (Google Play Billing) ----
      // Read the authoritative subscription straight from Google.
      const sub = await getSubscriptionV2(String(purchaseToken));
      if (!sub) return json({ error: 'Subscription not found at Google' }, 404);

      // Trust ONLY Google's product id (never the client-supplied one) and
      // require it to be a known SKU; the tier is derived from this string.
      productId = sub.productId;
      if (!KNOWN_ANDROID_SKUS.has(productId)) return json({ error: 'Unknown product' }, 400);
      status = sub.status;
      expiresAt = sub.expiresMs ? new Date(sub.expiresMs).toISOString() : null;

      // Acknowledge so Google doesn't auto-refund within 3 days (best-effort,
      // the client's finishTransaction also acknowledges).
      if (!sub.acknowledged) {
        await acknowledgeSubscription(productId, String(purchaseToken));
      }

      row = {
        user_id: userId,
        product_id: productId,
        status,
        source: 'google',
        // License-tester / sandbox purchases are tagged like iOS sandbox rows.
        environment: sub.isTest ? 'Sandbox' : 'Production',
        // The purchaseToken is stable across auto-renewals; use it as the
        // "original" linking id; latestOrderId is the most recent order.
        original_transaction_id: String(purchaseToken),
        latest_transaction_id: sub.latestOrderId,
        purchased_at: sub.startMs ? new Date(sub.startMs).toISOString() : null,
        expires_at: expiresAt,
        auto_renew: sub.autoRenew,
        updated_at: new Date().toISOString(),
      };
    } else if (transactionId) {
      // ---- iOS (StoreKit 2 / Apple) ----
      // 1) Read the transaction straight from Apple.
      const txn = await getTransaction(String(transactionId));
      if (!txn) return json({ error: 'Transaction not found at Apple' }, 404);
      if (txn.bundleId && txn.bundleId !== BUNDLE_ID) {
        return json({ error: 'Transaction is for a different app' }, 400);
      }

      // 2) Resolve the authoritative subscription state (status + renewal).
      const env = (txn.environment === 'Sandbox' ? 'Sandbox' : 'Production') as 'Sandbox' | 'Production';
      const sub = await getSubscriptionStatus(txn.originalTransactionId, env);

      status = sub ? mapStatus(sub.status) : 'active';
      productId = sub?.productId ?? txn.productId;
      const expiresMs = sub?.expiresDate ?? txn.expiresDate ?? null;
      expiresAt = expiresMs ? new Date(expiresMs).toISOString() : null;

      row = {
        user_id: userId,
        product_id: productId,
        status,
        source: 'apple',
        environment: env,
        original_transaction_id: txn.originalTransactionId,
        latest_transaction_id: txn.transactionId,
        purchased_at: txn.purchaseDate ? new Date(txn.purchaseDate).toISOString() : null,
        expires_at: expiresAt,
        auto_renew: sub?.autoRenew ?? true,
        updated_at: new Date().toISOString(),
      };
    } else {
      return json({ error: 'Missing transactionId or purchaseToken' }, 400);
    }

    // 3) A subscription belongs to exactly ONE account. If this receipt's
    // original transaction is already linked to a different user, reject it —
    // otherwise one paid sub could entitle unlimited accounts (paywall bypass).
    // The partial-unique index on entitlements is the hard backstop; this gives
    // a clean 409 instead of a raw constraint error.
    const origTxn = row.original_transaction_id as string;
    const { data: claimed } = await admin
      .from('entitlements')
      .select('user_id')
      .eq('original_transaction_id', origTxn)
      .neq('user_id', userId)
      .maybeSingle();
    if (claimed) {
      return json({ error: 'This subscription is already linked to another account.' }, 409);
    }

    // 4) Upsert the entitlement.
    const { error: upErr } = await admin.from('entitlements').upsert(row, { onConflict: 'user_id' });
    if (upErr) return json({ error: upErr.message }, 400);

    const active = status === 'active' || status === 'grace';
    return json({ active, status, expires_at: expiresAt, product_id: productId });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

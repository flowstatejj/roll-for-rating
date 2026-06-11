// Supabase Edge Function: validate-purchase
// Verifies a StoreKit 2 purchase server-side and records the entitlement.
//
// The client sends the StoreKit transactionId after a successful purchase /
// restore. We read the authoritative transaction from Apple's App Store Server
// API (never trusting client-supplied product/expiry) and upsert the row in
// public.entitlements keyed by the signed-in user.
//
// Deploy with "Verify JWT" ON (the caller is an authenticated app user).
// Requires the APPLE_IAP_* / APPLE_BUNDLE_ID secrets (see _shared/apple.ts).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { BUNDLE_ID, getTransaction, getSubscriptionStatus, mapStatus } from '../_shared/apple.ts';

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

    const { transactionId } = await req.json().catch(() => ({}));
    if (!transactionId) return json({ error: 'Missing transactionId' }, 400);

    // 1) Read the transaction straight from Apple.
    const txn = await getTransaction(String(transactionId));
    if (!txn) return json({ error: 'Transaction not found at Apple' }, 404);
    if (txn.bundleId && txn.bundleId !== BUNDLE_ID) {
      return json({ error: 'Transaction is for a different app' }, 400);
    }

    // 2) Resolve the authoritative subscription state (status + renewal).
    const env = (txn.environment === 'Sandbox' ? 'Sandbox' : 'Production') as 'Sandbox' | 'Production';
    const sub = await getSubscriptionStatus(txn.originalTransactionId, env);

    const status = sub ? mapStatus(sub.status) : 'active';
    const expiresMs = sub?.expiresDate ?? txn.expiresDate ?? null;
    const expiresAt = expiresMs ? new Date(expiresMs).toISOString() : null;

    // 3) Upsert the entitlement.
    const { error: upErr } = await admin.from('entitlements').upsert(
      {
        user_id: userId,
        product_id: sub?.productId ?? txn.productId,
        status,
        source: 'apple',
        environment: env,
        original_transaction_id: txn.originalTransactionId,
        latest_transaction_id: txn.transactionId,
        purchased_at: txn.purchaseDate ? new Date(txn.purchaseDate).toISOString() : null,
        expires_at: expiresAt,
        auto_renew: sub?.autoRenew ?? true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
    if (upErr) return json({ error: upErr.message }, 400);

    const active = status === 'active' || status === 'grace';
    return json({ active, status, expires_at: expiresAt, product_id: sub?.productId ?? txn.productId });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

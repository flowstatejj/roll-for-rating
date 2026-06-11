// Supabase Edge Function: apple-notifications
// Receives Apple's App Store Server Notifications V2 and keeps entitlements in
// sync across the subscription lifecycle (renewals, cancellations, billing
// retries, refunds, expirations) — the events that happen WITHOUT the app open.
//
// IMPORTANT: deploy with "Verify JWT" OFF — Apple posts here directly and will
// not send a Supabase JWT. We instead (a) confirm the bundle id and (b) re-read
// the authoritative state from Apple's API before writing anything.
//
// Configure the URL in App Store Connect → your app → App Store Server
// Notifications (Production + Sandbox) to:
//   https://<project-ref>.supabase.co/functions/v1/apple-notifications
import { createClient } from 'npm:@supabase/supabase-js@2';
import { BUNDLE_ID, decodeSigned, getSubscriptionStatus, mapStatus } from '../_shared/apple.ts';

function ok() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface NotifPayload {
  notificationType?: string;
  subtype?: string;
  data?: {
    bundleId?: string;
    environment?: string; // 'Production' | 'Sandbox'
    signedTransactionInfo?: string;
    signedRenewalInfo?: string;
  };
}

Deno.serve(async (req) => {
  // Always answer 200 quickly so Apple doesn't retry on our internal hiccups.
  try {
    const { signedPayload } = await req.json().catch(() => ({}));
    if (!signedPayload) return ok();

    const payload = decodeSigned<NotifPayload>(signedPayload);
    const data = payload.data ?? {};

    const txn = data.signedTransactionInfo
      ? decodeSigned<{ bundleId?: string; originalTransactionId?: string }>(data.signedTransactionInfo)
      : null;

    // Reject anything that isn't for this app.
    if (txn?.bundleId && txn.bundleId !== BUNDLE_ID) return ok();
    const originalTransactionId = txn?.originalTransactionId;
    if (!originalTransactionId) return ok();

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Only act on subscriptions we already know about (the client validated the
    // initial purchase). If we've never seen it, there's nothing to update yet.
    const { data: row } = await admin
      .from('entitlements')
      .select('user_id')
      .eq('original_transaction_id', originalTransactionId)
      .maybeSingle();
    if (!row) return ok();

    // Re-read the authoritative state from Apple rather than trusting the push.
    const env = data.environment === 'Sandbox' ? 'Sandbox' : 'Production';
    const sub = await getSubscriptionStatus(originalTransactionId, env);

    // REFUND / REVOKE are explicit even if the status read is stale.
    let status = sub ? mapStatus(sub.status) : 'expired';
    if (payload.notificationType === 'REFUND' || payload.notificationType === 'REVOKE') {
      status = 'revoked';
    }
    const expiresAt = sub?.expiresDate ? new Date(sub.expiresDate).toISOString() : null;

    await admin
      .from('entitlements')
      .update({
        status,
        expires_at: expiresAt,
        auto_renew: sub?.autoRenew ?? false,
        product_id: sub?.productId ?? undefined,
        updated_at: new Date().toISOString(),
      })
      .eq('original_transaction_id', originalTransactionId);

    return ok();
  } catch {
    return ok();
  }
});

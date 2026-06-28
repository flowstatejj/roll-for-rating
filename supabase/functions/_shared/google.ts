// Shared helpers for talking to Google Play's Developer API (Play Billing).
//
// The Android counterpart to _shared/apple.ts. We verify a subscription
// purchase server-side rather than trusting the client. The flow:
//   • Sign a short-lived RS256 JWT with the Play service-account key and
//     exchange it for an OAuth2 access token (androidpublisher scope).
//   • Read the authoritative subscription state from the Play Developer API
//     (purchases.subscriptionsv2.get) using the package name + purchaseToken.
//   • Optionally acknowledge the purchase (best-effort; the client's
//     finishTransaction already acknowledges via Play Billing).
//
// Required function secrets (set via `supabase secrets set` or the dashboard):
//   GOOGLE_PLAY_SERVICE_ACCOUNT_JSON - the full service-account JSON (string)
//                                      with `client_email` + `private_key`.
//   GOOGLE_PLAY_PACKAGE_NAME         - com.flowstatejj.rollforrating (default)
import * as jose from 'npm:jose@5';

export const PACKAGE_NAME =
  Deno.env.get('GOOGLE_PLAY_PACKAGE_NAME') ?? 'com.flowstatejj.rollforrating';

const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const API_BASE = 'https://androidpublisher.googleapis.com/androidpublisher/v3';

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

function serviceAccount(): ServiceAccount {
  const raw = Deno.env.get('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON') ?? '';
  if (!raw) throw new Error('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not set');
  const sa = JSON.parse(raw) as ServiceAccount;
  // `private_key` carries literal "\n" sequences when stored as an env string.
  sa.private_key = (sa.private_key ?? '').replace(/\\n/g, '\n');
  return sa;
}

/** Exchange the service-account key for a short-lived OAuth2 access token. */
async function accessToken(): Promise<string> {
  const sa = serviceAccount();
  const tokenUri = sa.token_uri ?? 'https://oauth2.googleapis.com/token';
  const key = await jose.importPKCS8(sa.private_key, 'RS256');
  const assertion = await new jose.SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience(tokenUri)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key);

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) {
    // Log the upstream detail server-side; never surface it to the client.
    console.error(`Google token exchange failed: ${res.status} ${await res.text()}`);
    throw new Error('Google auth failed');
  }
  const { access_token } = await res.json();
  if (!access_token) throw new Error('Google token exchange returned no access_token');
  return access_token as string;
}

/** Map Google's SubscriptionState to our entitlements.status. */
export function mapSubState(state: string): 'active' | 'grace' | 'expired' | 'revoked' {
  switch (state) {
    case 'SUBSCRIPTION_STATE_ACTIVE':
    case 'SUBSCRIPTION_STATE_CANCELED': // canceled but still entitled until expiry
      return 'active';
    case 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD':
      return 'grace';
    case 'SUBSCRIPTION_STATE_ON_HOLD':
    case 'SUBSCRIPTION_STATE_PAUSED':
    case 'SUBSCRIPTION_STATE_PENDING':
    case 'SUBSCRIPTION_STATE_EXPIRED':
    default:
      return 'expired';
  }
}

export interface PlaySubInfo {
  productId: string;
  status: 'active' | 'grace' | 'expired' | 'revoked';
  expiresMs: number | null;
  startMs: number | null;
  autoRenew: boolean;
  latestOrderId: string | null;
  acknowledged: boolean;
  /** true for Play license-tester / sandbox purchases (Apple "Sandbox" analogue) */
  isTest: boolean;
}

interface LineItemV2 {
  productId?: string;
  expiryTime?: string;
  autoRenewingPlan?: { autoRenewEnabled?: boolean };
}
interface SubscriptionPurchaseV2 {
  subscriptionState?: string;
  latestOrderId?: string;
  startTime?: string;
  acknowledgementState?: string;
  lineItems?: LineItemV2[];
  /** Present only for license-tester / sandbox purchases. */
  testPurchase?: Record<string, unknown> | null;
}

/** Authoritative subscription state for a purchase token (subscriptionsv2.get). */
export async function getSubscriptionV2(purchaseToken: string): Promise<PlaySubInfo | null> {
  const token = await accessToken();
  const res = await fetch(
    `${API_BASE}/applications/${PACKAGE_NAME}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  // 400 invalid token / 404 unknown / 410 expired-too-long → treat as not-found
  // (the caller maps null to a clean 404 rather than a 500).
  if (res.status === 400 || res.status === 404 || res.status === 410) return null;
  if (!res.ok) {
    console.error(`Play subscriptionsv2.get failed: ${res.status} ${await res.text()}`);
    throw new Error('Play verification failed');
  }
  const body = (await res.json()) as SubscriptionPurchaseV2;
  const status = mapSubState(body.subscriptionState ?? '');

  // Pick the line item with the furthest expiry, considering ONLY items that
  // actually carry an expiryTime (an active/grace sub always has one).
  let best: LineItemV2 | undefined;
  let bestMs = -Infinity;
  for (const it of body.lineItems ?? []) {
    if (!it.expiryTime) continue;
    const ms = new Date(it.expiryTime).getTime();
    if (ms > bestMs) {
      bestMs = ms;
      best = it;
    }
  }
  const expiresMs = best?.expiryTime ? new Date(best.expiryTime).getTime() : null;

  // Fail closed: never write a never-expiring "active" row. If Google reports an
  // entitled state but no line item carries an expiry, treat it as not-found.
  if ((status === 'active' || status === 'grace') && expiresMs === null) return null;

  return {
    productId: best?.productId ?? '',
    status,
    expiresMs,
    startMs: body.startTime ? new Date(body.startTime).getTime() : null,
    autoRenew: best?.autoRenewingPlan?.autoRenewEnabled ?? false,
    latestOrderId: body.latestOrderId ?? null,
    acknowledged: body.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
    isTest: body.testPurchase != null,
  };
}

/** Acknowledge a subscription purchase. Best-effort: the client's
 *  finishTransaction also acknowledges, so a duplicate ack is expected and
 *  harmless. Never let an ack failure block granting the entitlement. */
export async function acknowledgeSubscription(productId: string, purchaseToken: string): Promise<void> {
  try {
    const token = await accessToken();
    await fetch(
      `${API_BASE}/applications/${PACKAGE_NAME}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      },
    );
  } catch {
    // ignore - already acknowledged by the client, or a transient error.
  }
}

// Shared helpers for talking to Apple's App Store Server API (StoreKit 2).
//
// We verify purchases server-side rather than trusting the client. The flow:
//   • Sign a short-lived ES256 JWT with our In-App Purchase key (.p8).
//   • Call the App Store Server API to read the authoritative transaction /
//     subscription state, then decode Apple's signed JWS payloads.
//
// Required function secrets (set via `supabase secrets set` or the dashboard):
//   APPLE_IAP_KEY_ID        – Key ID of the In-App Purchase key
//   APPLE_IAP_ISSUER_ID     – Issuer ID (Users and Access → Integrations)
//   APPLE_IAP_PRIVATE_KEY   – the .p8 contents (PEM, "-----BEGIN PRIVATE KEY-----…")
//   APPLE_BUNDLE_ID         – com.flowstatejj.rollforrating
import * as jose from 'npm:jose@5';

const KEY_ID = Deno.env.get('APPLE_IAP_KEY_ID')!;
const ISSUER_ID = Deno.env.get('APPLE_IAP_ISSUER_ID')!;
const PRIVATE_KEY = (Deno.env.get('APPLE_IAP_PRIVATE_KEY') ?? '').replace(/\\n/g, '\n');
export const BUNDLE_ID = Deno.env.get('APPLE_BUNDLE_ID') ?? 'com.flowstatejj.rollforrating';

const HOSTS = {
  Production: 'https://api.storekit.itunes.apple.com',
  Sandbox: 'https://api.storekit-sandbox.itunes.apple.com',
} as const;
export type AppleEnv = keyof typeof HOSTS;

/** Mint the bearer JWT the App Store Server API expects. */
async function apiToken(): Promise<string> {
  const key = await jose.importPKCS8(PRIVATE_KEY, 'ES256');
  return await new jose.SignJWT({ bid: BUNDLE_ID })
    .setProtectedHeader({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' })
    .setIssuer(ISSUER_ID)
    .setIssuedAt()
    .setExpirationTime('20m')
    .setAudience('appstoreconnect-v1')
    .sign(key);
}

/** Decode an Apple-signed JWS (x5c chain) WITHOUT verifying — callers only use
 *  this on payloads they fetched from the authenticated API over TLS. */
export function decodeSigned<T = Record<string, unknown>>(jws: string): T {
  return jose.decodeJwt(jws) as T;
}

async function apiGet(path: string, env: AppleEnv): Promise<Response> {
  const token = await apiToken();
  return fetch(`${HOSTS[env]}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export interface TxnInfo {
  productId: string;
  originalTransactionId: string;
  transactionId: string;
  bundleId: string;
  expiresDate?: number; // ms epoch
  purchaseDate?: number;
  environment?: string;
  type?: string;
}

/** Get a single transaction's decoded info. Tries Production then Sandbox. */
export async function getTransaction(transactionId: string): Promise<TxnInfo | null> {
  for (const env of ['Production', 'Sandbox'] as AppleEnv[]) {
    const res = await apiGet(`/inApps/v1/transactions/${transactionId}`, env);
    if (res.status === 404) continue; // wrong environment — try the other one
    if (!res.ok) continue;
    const { signedTransactionInfo } = await res.json();
    if (!signedTransactionInfo) continue;
    const p = decodeSigned<TxnInfo>(signedTransactionInfo);
    return { ...p, environment: p.environment ?? env };
  }
  return null;
}

export interface SubStatus {
  productId: string;
  originalTransactionId: string;
  expiresDate?: number;
  /** Apple status: 1 active, 2 expired, 3 retry(grace/billing), 4 grace, 5 revoked */
  status: number;
  autoRenew: boolean;
  environment: AppleEnv;
}

/** Authoritative subscription state for an original transaction id. */
export async function getSubscriptionStatus(
  originalTransactionId: string,
  preferred: AppleEnv = 'Production',
): Promise<SubStatus | null> {
  const order: AppleEnv[] = preferred === 'Sandbox' ? ['Sandbox', 'Production'] : ['Production', 'Sandbox'];
  for (const env of order) {
    const res = await apiGet(`/inApps/v1/subscriptions/${originalTransactionId}`, env);
    if (res.status === 404) continue;
    if (!res.ok) continue;
    const body = await res.json();
    const group = body?.data?.[0];
    const last = group?.lastTransactions?.[0];
    if (!last) continue;
    const txn = decodeSigned<TxnInfo>(last.signedTransactionInfo);
    let autoRenew = true;
    if (last.signedRenewalInfo) {
      const renew = decodeSigned<{ autoRenewStatus?: number }>(last.signedRenewalInfo);
      autoRenew = renew.autoRenewStatus !== 0;
    }
    return {
      productId: txn.productId,
      originalTransactionId: txn.originalTransactionId,
      expiresDate: txn.expiresDate,
      status: Number(last.status),
      autoRenew,
      environment: env,
    };
  }
  return null;
}

/** Map Apple's numeric subscription status to our entitlements.status. */
export function mapStatus(appleStatus: number): 'active' | 'grace' | 'expired' | 'revoked' {
  switch (appleStatus) {
    case 1: return 'active';
    case 3: // billing retry
    case 4: return 'grace';
    case 5: return 'revoked';
    case 2:
    default: return 'expired';
  }
}

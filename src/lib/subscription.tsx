// Subscription state + StoreKit 2 purchase flow (hard paywall).
//
// Access is decided SERVER-SIDE: `active` reflects public.entitlements (read via
// the my_subscription RPC), never the raw client IAP state. The StoreKit flow's
// only job is to hand a verified transaction to the `validate-purchase` edge
// function, which writes the entitlement. That keeps a jailbroken client from
// faking access.
//
// expo-iap is native-only; on web (dev) the IAP calls are skipped and access is
// whatever the entitlement RPC says (e.g. a comp grant).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Alert, AppState, Platform } from 'react-native';
import {
  endConnection,
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  restorePurchases,
  type Purchase,
  type ProductSubscription,
  type ProductSubscriptionAndroid,
} from 'expo-iap';

import { supabase } from './supabase';
import { useAuth } from './auth';
import { useTranslation } from './i18n';

/** Auto-renewable subscription SKUs. Apple uses the App Store Connect product
 *  ids; Google Play caps product ids at 40 chars, so Android uses shorter ids
 *  (the backend keys the family tier off the id containing "family"). */
export const PRO_MONTHLY_SKU =
  Platform.OS === 'android' ? 'rollforrating.pro.monthly' : 'com.flowstatejj.rollforrating.pro.monthly';
export const FAMILY_MONTHLY_SKU =
  Platform.OS === 'android' ? 'rollforrating.family.monthly' : 'com.flowstatejj.rollforrating.family.monthly';

/** The two plan tiers. `individual` covers the holder + one managed child;
 *  `family` covers the holder + unlimited managed children. */
export type Plan = 'individual' | 'family';
const SKU_FOR: Record<Plan, string> = {
  individual: PRO_MONTHLY_SKU,
  family: FAMILY_MONTHLY_SKU,
};

const IAP_AVAILABLE = Platform.OS === 'ios' || Platform.OS === 'android';

/** Foreground entitlement re-checks are throttled to once per this window. */
const FOREGROUND_RECHECK_MS = 6 * 60 * 60 * 1000;

export interface SubInfo {
  active: boolean;
  status: string | null;
  source: string | null;
  productId: string | null;
  expiresAt: string | null;
  /** which tier the active entitlement is, when there is one */
  plan: Plan | null;
}

interface SubscriptionContextValue {
  /** initial entitlement check finished — gate on this before redirecting */
  ready: boolean;
  /** has active access (real subscription, grace period, or comp) */
  active: boolean;
  /** the active plan tier, or null when not subscribed */
  plan: Plan | null;
  info: SubInfo | null;
  /** the individual ($4.99) StoreKit product, when loaded */
  product: ProductSubscription | null;
  /** the family ($9.99) StoreKit product, when loaded */
  familyProduct: ProductSubscription | null;
  purchasing: boolean;
  refresh: () => Promise<boolean>;
  /** buy a tier — defaults to individual to preserve the old call sites */
  purchase: (plan?: Plan) => Promise<void>;
  restore: () => Promise<boolean>;
}

const SubscriptionContext = createContext<SubscriptionContextValue | undefined>(undefined);

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { session, initializing } = useAuth();
  const { t } = useTranslation();
  const [ready, setReady] = useState(false);
  const [info, setInfo] = useState<SubInfo | null>(null);
  const [product, setProduct] = useState<ProductSubscription | null>(null);
  const [familyProduct, setFamilyProduct] = useState<ProductSubscription | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const purchasingRef = useRef(false);
  // Mirrors `info` so refresh() can read the last known state without taking it
  // as a dependency (which would churn every callback identity on each poll).
  const infoRef = useRef<SubInfo | null>(null);
  const lastForegroundCheckRef = useRef(0);

  // Read the authoritative entitlement from our backend. Returns current access.
  const refresh = useCallback(async (): Promise<boolean> => {
    if (!session?.user) {
      infoRef.current = null;
      setInfo(null);
      setReady(true);
      return false;
    }
    const { data, error } = await supabase.rpc('my_subscription');
    let active = false;
    if (error) {
      // A failed RPC is NOT a definitive "no subscription": keep the last known
      // state so a transient error on a later re-check never bounces a paying
      // user to the paywall. A first read (no state yet) still surfaces
      // "inactive", and the `ready` gate lets a retry recover on launch.
      active = !!infoRef.current?.active;
      if (!infoRef.current) {
        infoRef.current = { active: false, status: null, source: null, productId: null, expiresAt: null, plan: null };
        setInfo(infoRef.current);
      }
    } else {
      const row = Array.isArray(data) ? data[0] : data;
      active = !!row?.active;
      const planTier: Plan | null = row?.plan === 'family' ? 'family' : row?.plan === 'individual' ? 'individual' : null;
      infoRef.current = {
        active,
        status: row?.status ?? null,
        source: row?.source ?? null,
        productId: row?.product_id ?? null,
        expiresAt: row?.expires_at ?? null,
        plan: active ? planTier : null,
      };
      setInfo(infoRef.current);
    }
    setReady(true);
    return active;
  }, [session]);

  // Send a completed purchase to the server for verification. iOS hands us a
  // StoreKit transactionId; Android a Play purchaseToken. The edge function
  // verifies whichever it receives against the right store. Throws when the
  // server can't confirm the purchase so callers know NOT to finish it.
  const validate = useCallback(
    async (purchase: Purchase) => {
      let body: Record<string, string>;
      if (Platform.OS === 'android') {
        const p = purchase as { purchaseToken?: string | null; productId?: string; ids?: string[] };
        if (!p.purchaseToken) throw new Error('Android purchase is missing its purchaseToken');
        body = { purchaseToken: p.purchaseToken, productId: p.productId ?? p.ids?.[0] ?? '' };
      } else {
        const transactionId = (purchase as { transactionId?: string }).transactionId;
        if (!transactionId) throw new Error('iOS purchase is missing its transactionId');
        body = { transactionId };
      }
      const { error } = await supabase.functions.invoke('validate-purchase', { body });
      if (error) throw error;
      await refresh();
    },
    [refresh],
  );

  // Fetch the subscription products and cache them. Returns the fetched list so
  // a caller (e.g. purchase) can read an Android offer token immediately without
  // waiting on a state update.
  const loadProducts = useCallback(async (): Promise<ProductSubscription[]> => {
    try {
      const products = await fetchProducts({ skus: [PRO_MONTHLY_SKU, FAMILY_MONTHLY_SKU], type: 'subs' });
      const list = products as ProductSubscription[];
      const indiv = list.find((p) => p.id === PRO_MONTHLY_SKU);
      const fam = list.find((p) => p.id === FAMILY_MONTHLY_SKU);
      if (indiv) setProduct(indiv);
      if (fam) setFamilyProduct(fam);
      return list;
    } catch {
      // Store unavailable (e.g. no sandbox account); paywall shows a fallback price.
      return [];
    }
  }, []);

  // Initialise IAP, fetch the product, and wire purchase listeners (native only).
  useEffect(() => {
    // Wait for auth to settle before deciding access, or we'd read "no session"
    // and set ready+inactive, flashing the paywall until the real check lands.
    // A (new) user starts unready so we re-check from scratch on account change.
    if (initializing) return;
    setReady(false);

    // Decide access FIRST via the fast entitlement RPC; the StoreKit product
    // load below is only needed once the paywall is actually shown, so let it lag
    // (this also gets the user into the app quicker on launch).
    refresh();

    if (!IAP_AVAILABLE) return;

    let purchaseSub: { remove: () => void } | undefined;
    let errorSub: { remove: () => void } | undefined;

    (async () => {
      try {
        await initConnection();
      } catch {
        // IAP unavailable; the entitlement RPC above still drives access.
      }
      await loadProducts();

      purchaseSub = purchaseUpdatedListener(async (purchase) => {
        try {
          // Android can deliver still-pending (deferred-payment) purchases here.
          // Don't validate or acknowledge until the payment actually clears; an
          // early acknowledge would leave the user paid-but-unentitled.
          if ((purchase as { purchaseState?: string }).purchaseState === 'pending') return;
          await validate(purchase);
          // Finish ONLY after the server accepted the purchase. Finishing an
          // unvalidated transaction would consume the user's money with no
          // entitlement written; left unfinished, the store re-delivers it on
          // the next launch so validation retries by itself. A failed finish is
          // harmless for the same reason (re-delivered, re-validated, retried).
          await finishTransaction({ purchase, isConsumable: false }).catch(() => {});
        } catch {
          // Validation failed; the purchase stays unfinished for a later retry.
          Alert.alert(t('pw.error'));
        } finally {
          purchasingRef.current = false;
          setPurchasing(false);
        }
      });
      errorSub = purchaseErrorListener(() => {
        purchasingRef.current = false;
        setPurchasing(false);
      });
    })();

    return () => {
      purchaseSub?.remove();
      errorSub?.remove();
      endConnection().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, initializing]);

  // Renewal pickup on foreground, throttled to once per 6 hours. Apple renewals
  // reach the server through the replayed StoreKit transaction, but no Google
  // server notification is wired up, so an Android renewal only re-extends the
  // entitlement when the app re-validates the (renewal-stable) purchaseToken.
  // Validation runs BEFORE the refresh so a renewed sub never flashes the
  // paywall; every step is best-effort and a failure leaves access untouched.
  useEffect(() => {
    if (!session?.user) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const now = Date.now();
      if (now - lastForegroundCheckRef.current < FOREGROUND_RECHECK_MS) return;
      lastForegroundCheckRef.current = now;
      (async () => {
        if (Platform.OS === 'android') {
          try {
            const owned = await getAvailablePurchases();
            for (const p of owned) {
              if (p.productId !== PRO_MONTHLY_SKU && p.productId !== FAMILY_MONTHLY_SKU) continue;
              await validate(p);
            }
          } catch {
            // Store or server unavailable; the refresh below still decides.
          }
        }
        await refresh();
      })().catch(() => {});
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, refresh, validate]);

  const purchase = useCallback(async (plan: Plan = 'individual') => {
    if (!IAP_AVAILABLE) throw new Error('Subscriptions are only available in the mobile app.');
    if (purchasingRef.current) return;
    purchasingRef.current = true;
    setPurchasing(true);
    try {
      const sku = SKU_FOR[plan];
      if (Platform.OS === 'android') {
        // Play Billing REQUIRES the base-plan offer token; a request without one
        // is unbuyable and fails silently. If the product hasn't loaded yet,
        // fetch once more and read the token directly before giving up.
        let prod = (plan === 'family' ? familyProduct : product) as ProductSubscriptionAndroid | null;
        let offerToken = prod?.subscriptionOfferDetailsAndroid?.[0]?.offerToken;
        if (!offerToken) {
          const list = await loadProducts();
          prod = (list.find((p) => p.id === sku) as ProductSubscriptionAndroid | undefined) ?? null;
          offerToken = prod?.subscriptionOfferDetailsAndroid?.[0]?.offerToken;
        }
        if (!offerToken) {
          throw new Error('Subscription details are still loading. Please try again in a moment.');
        }
        await requestPurchase({
          request: { google: { skus: [sku], subscriptionOffers: [{ sku, offerToken }] } },
          type: 'subs',
        });
      } else {
        await requestPurchase({ request: { apple: { sku } }, type: 'subs' });
      }
      // Outcome is delivered via purchaseUpdatedListener / purchaseErrorListener.
    } catch (e) {
      purchasingRef.current = false;
      setPurchasing(false);
      throw e;
    }
  }, [product, familyProduct, loadProducts]);

  const restore = useCallback(async (): Promise<boolean> => {
    if (!IAP_AVAILABLE) return false;
    await restorePurchases();
    // restorePurchases triggers the update listener for owned items; also poll
    // the server in case nothing replayed.
    return await refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      ready,
      active: !!info?.active,
      plan: info?.plan ?? null,
      info,
      product,
      familyProduct,
      purchasing,
      refresh,
      purchase,
      restore,
    }),
    [ready, info, product, familyProduct, purchasing, refresh, purchase, restore],
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

export function useSubscription() {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error('useSubscription must be used inside <SubscriptionProvider>');
  return ctx;
}

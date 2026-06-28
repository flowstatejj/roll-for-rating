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
import { Platform } from 'react-native';
import {
  endConnection,
  fetchProducts,
  finishTransaction,
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

/** Auto-renewable subscription SKUs — must match the product ids in App Store Connect. */
export const PRO_MONTHLY_SKU = 'com.flowstatejj.rollforrating.pro.monthly';
export const FAMILY_MONTHLY_SKU = 'com.flowstatejj.rollforrating.family.monthly';

/** The two plan tiers. `individual` covers the holder + one managed child;
 *  `family` covers the holder + unlimited managed children. */
export type Plan = 'individual' | 'family';
const SKU_FOR: Record<Plan, string> = {
  individual: PRO_MONTHLY_SKU,
  family: FAMILY_MONTHLY_SKU,
};

const IAP_AVAILABLE = Platform.OS === 'ios' || Platform.OS === 'android';

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
  const { session } = useAuth();
  const [ready, setReady] = useState(false);
  const [info, setInfo] = useState<SubInfo | null>(null);
  const [product, setProduct] = useState<ProductSubscription | null>(null);
  const [familyProduct, setFamilyProduct] = useState<ProductSubscription | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const purchasingRef = useRef(false);

  // Read the authoritative entitlement from our backend. Returns current access.
  const refresh = useCallback(async (): Promise<boolean> => {
    if (!session?.user) {
      setInfo(null);
      setReady(true);
      return false;
    }
    const { data, error } = await supabase.rpc('my_subscription');
    let active = false;
    if (error) {
      // Fail CLOSED would lock everyone out on a transient error; the gate also
      // checks `ready`, so we surface "inactive" but let a retry recover.
      setInfo({ active: false, status: null, source: null, productId: null, expiresAt: null, plan: null });
    } else {
      const row = Array.isArray(data) ? data[0] : data;
      active = !!row?.active;
      const planTier: Plan | null = row?.plan === 'family' ? 'family' : row?.plan === 'individual' ? 'individual' : null;
      setInfo({
        active,
        status: row?.status ?? null,
        source: row?.source ?? null,
        productId: row?.product_id ?? null,
        expiresAt: row?.expires_at ?? null,
        plan: active ? planTier : null,
      });
    }
    setReady(true);
    return active;
  }, [session]);

  // Send a completed purchase to the server for verification. iOS hands us a
  // StoreKit transactionId; Android a Play purchaseToken. The edge function
  // verifies whichever it receives against the right store.
  const validate = useCallback(
    async (purchase: Purchase) => {
      let body: Record<string, string>;
      if (Platform.OS === 'android') {
        const p = purchase as { purchaseToken?: string; productId?: string; ids?: string[] };
        if (!p.purchaseToken) return;
        body = { purchaseToken: p.purchaseToken, productId: p.productId ?? p.ids?.[0] ?? '' };
      } else {
        const transactionId = (purchase as { transactionId?: string }).transactionId;
        if (!transactionId) return;
        body = { transactionId };
      }
      const { error } = await supabase.functions.invoke('validate-purchase', { body });
      if (!error) await refresh();
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
    if (!IAP_AVAILABLE) {
      refresh();
      return;
    }
    let purchaseSub: { remove: () => void } | undefined;
    let errorSub: { remove: () => void } | undefined;

    (async () => {
      try {
        await initConnection();
      } catch {
        // IAP unavailable; the entitlement RPC below still drives access.
      }
      await loadProducts();

      purchaseSub = purchaseUpdatedListener(async (purchase) => {
        try {
          // Android can deliver still-pending (deferred-payment) purchases here.
          // Don't validate or acknowledge until the payment actually clears; an
          // early acknowledge would leave the user paid-but-unentitled.
          if ((purchase as { purchaseState?: string }).purchaseState === 'pending') return;
          await validate(purchase);
          // Non-consumable / subscription: finish so it isn't replayed each launch.
          await finishTransaction({ purchase, isConsumable: false });
        } finally {
          purchasingRef.current = false;
          setPurchasing(false);
        }
      });
      errorSub = purchaseErrorListener(() => {
        purchasingRef.current = false;
        setPurchasing(false);
      });

      await refresh();
    })();

    return () => {
      purchaseSub?.remove();
      errorSub?.remove();
      endConnection().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

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

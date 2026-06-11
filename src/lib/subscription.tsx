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
  type ProductSubscriptionIOS,
} from 'expo-iap';

import { supabase } from './supabase';
import { useAuth } from './auth';

/** Auto-renewable subscription SKU — must match the product id in App Store Connect. */
export const PRO_MONTHLY_SKU = 'com.flowstatejj.rollforrating.pro.monthly';

const IAP_AVAILABLE = Platform.OS === 'ios' || Platform.OS === 'android';

export interface SubInfo {
  active: boolean;
  status: string | null;
  source: string | null;
  productId: string | null;
  expiresAt: string | null;
}

interface SubscriptionContextValue {
  /** initial entitlement check finished — gate on this before redirecting */
  ready: boolean;
  /** has active access (real subscription, grace period, or comp) */
  active: boolean;
  info: SubInfo | null;
  product: ProductSubscriptionIOS | null;
  purchasing: boolean;
  refresh: () => Promise<boolean>;
  purchase: () => Promise<void>;
  restore: () => Promise<boolean>;
}

const SubscriptionContext = createContext<SubscriptionContextValue | undefined>(undefined);

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [ready, setReady] = useState(false);
  const [info, setInfo] = useState<SubInfo | null>(null);
  const [product, setProduct] = useState<ProductSubscriptionIOS | null>(null);
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
      setInfo({ active: false, status: null, source: null, productId: null, expiresAt: null });
    } else {
      const row = Array.isArray(data) ? data[0] : data;
      active = !!row?.active;
      setInfo({
        active,
        status: row?.status ?? null,
        source: row?.source ?? null,
        productId: row?.product_id ?? null,
        expiresAt: row?.expires_at ?? null,
      });
    }
    setReady(true);
    return active;
  }, [session]);

  // Send a completed StoreKit transaction to the server for verification.
  const validate = useCallback(
    async (purchase: Purchase) => {
      const transactionId = (purchase as { transactionId?: string }).transactionId;
      if (!transactionId) return;
      const { error } = await supabase.functions.invoke('validate-purchase', {
        body: { transactionId },
      });
      if (!error) await refresh();
    },
    [refresh],
  );

  // Initialise IAP, fetch the product, and wire purchase listeners (native only).
  useEffect(() => {
    if (!IAP_AVAILABLE) {
      refresh();
      return;
    }
    let purchaseSub: { remove: () => void } | undefined;
    let errorSub: { remove: () => void } | undefined;
    let cancelled = false;

    (async () => {
      try {
        await initConnection();
        const products = await fetchProducts({ skus: [PRO_MONTHLY_SKU], type: 'subs' });
        const sub = (products as ProductSubscriptionIOS[]).find((p) => p.id === PRO_MONTHLY_SKU);
        if (!cancelled && sub) setProduct(sub);
      } catch {
        // Store unavailable (e.g. no sandbox account) — paywall shows a fallback price.
      }

      purchaseSub = purchaseUpdatedListener(async (purchase) => {
        try {
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
      cancelled = true;
      purchaseSub?.remove();
      errorSub?.remove();
      endConnection().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  const purchase = useCallback(async () => {
    if (!IAP_AVAILABLE) throw new Error('Subscriptions are only available in the mobile app.');
    if (purchasingRef.current) return;
    purchasingRef.current = true;
    setPurchasing(true);
    try {
      await requestPurchase({ request: { apple: { sku: PRO_MONTHLY_SKU } }, type: 'subs' });
      // Outcome is delivered via purchaseUpdatedListener / purchaseErrorListener.
    } catch (e) {
      purchasingRef.current = false;
      setPurchasing(false);
      throw e;
    }
  }, []);

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
      info,
      product,
      purchasing,
      refresh,
      purchase,
      restore,
    }),
    [ready, info, product, purchasing, refresh, purchase, restore],
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

export function useSubscription() {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error('useSubscription must be used inside <SubscriptionProvider>');
  return ctx;
}

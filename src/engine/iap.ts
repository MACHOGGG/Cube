import { applyStorePrices, plans, planFor, type PlanPeriod } from './pricing';
import type { Entitlement, PurchaseOutcome } from './subscription';

/**
 * The store counter: App Store and Google Play, at their own regional
 * price — ¥2 / month and ¥9.9 / year on the mainland-China tier.
 *
 * This is how the app is sold, and it is not an alternative to the web
 * checkout so much as the only thing that works: a phone in mainland China
 * cannot reach Creem's page, and Apple's rules require digital content
 * inside an app to be sold through the store in any case. The stores handle
 * regional pricing, tax, receipts, renewal and refunds themselves, and they
 * already know who the player is — which is why nothing in this file asks
 * anyone to register.
 *
 * ── What still has to be installed ──────────────────────────────────────
 * Capacitor has no billing API of its own, so the actual purchase is made by
 * a native plugin, and no such plugin is in package.json yet. Until one is
 * added every call below reports 'unavailable', and the paywall says the
 * subscription is not open yet rather than pretending to charge anyone.
 *
 * Any plugin satisfying `BillingPlugin` will do — the community
 * in-app-purchase plugins and RevenueCat all expose these three operations
 * under one of the names in PLUGIN_NAMES. Adding it is a native change
 * (Xcode / Gradle) plus the products themselves in App Store Connect and the
 * Play Console, under the two identifiers in engine/pricing.ts.
 */

/** The shape this file needs, whichever plugin ends up providing it. */
interface BillingPlugin {
  getProducts(o: { productIds: string[] }): Promise<{ products?: StoreProduct[] }>;
  purchase(o: { productId: string }): Promise<StorePurchase>;
  restorePurchases(): Promise<{ purchases?: StorePurchase[] }>;
}

interface StoreProduct {
  /** The identifier as registered with the store. */
  id?: string;
  productId?: string;
  /** Already localised and formatted by the store — "¥2.00", "NT$60". */
  price?: string;
  displayPrice?: string;
}

interface StorePurchase {
  productId?: string;
  transactionId?: string;
  /** ISO date or epoch ms, depending on the plugin. */
  expiresAt?: string | number;
  expiryDate?: string | number;
  cancelled?: boolean;
}

const PLUGIN_NAMES = ['InAppPurchase', 'InAppPurchases', 'Purchases', 'SlidesBilling'];

function billing(): BillingPlugin | null {
  const registry = window.Capacitor?.Plugins;
  if (!registry) return null;
  for (const name of PLUGIN_NAMES) {
    const found = registry[name] as Partial<BillingPlugin> | undefined;
    if (found?.purchase && found.restorePurchases) return found as BillingPlugin;
  }
  return null;
}

/**
 * Replace our built-in ¥2 / ¥9.9 with what the store says it will really
 * charge. Apple and Google localise and format that string themselves, and
 * theirs is the number that will appear on the receipt, so it wins wherever
 * it is available.
 */
export async function loadStorePrices(): Promise<void> {
  const store = billing();
  if (!store) return;
  try {
    const { products } = await store.getProducts({ productIds: storeProductIds() });
    const shown: Record<string, string> = {};
    for (const product of products ?? []) {
      const id = product.id ?? product.productId;
      const price = product.displayPrice ?? product.price;
      if (id && price) shown[id] = price;
    }
    applyStorePrices(shown);
  } catch {
    // The fallback figures stand; they are the tier we configured anyway.
  }
}

export async function storePurchase(period: PlanPeriod): Promise<PurchaseOutcome> {
  const store = billing();
  if (!store) return { ok: false, reason: 'unavailable' };
  const productId = planFor(period).productId;
  if (!productId) return { ok: false, reason: 'notConfigured' };
  try {
    const result = await store.purchase({ productId });
    if (result.cancelled) return { ok: false, reason: 'cancelled' };
    return { ok: true, entitlement: toEntitlement(period, result) };
  } catch (err) {
    // Every store cancels by throwing, and the word is in the message.
    return /cancel/i.test(String(err))
      ? { ok: false, reason: 'cancelled' }
      : { ok: false, reason: 'network' };
  }
}

/**
 * 恢复购买 — the same subscription on a new phone, or after a reinstall.
 * Apple requires an app that sells a subscription to offer this, and it is
 * the store build's entire answer to "log in".
 *
 * `silent` is the boot-time sweep: there is no one watching it, so a missing
 * plugin or an empty result are the same nothing, and neither is surfaced.
 */
export async function storeRestore(silent = false): Promise<PurchaseOutcome> {
  const store = billing();
  if (!store) return { ok: false, reason: silent ? 'none' : 'unavailable' };
  try {
    const { purchases } = await store.restorePurchases();
    for (const purchase of purchases ?? []) {
      const period = periodOf(purchase.productId);
      if (period) return { ok: true, entitlement: toEntitlement(period, purchase) };
    }
    return { ok: false, reason: 'none' };
  } catch {
    return { ok: false, reason: silent ? 'none' : 'network' };
  }
}

/** The two identifiers this build can ask the store about. */
function storeProductIds(): string[] {
  return plans()
    .map((p) => p.productId)
    .filter((id): id is string => Boolean(id));
}

function periodOf(productId: string | undefined): PlanPeriod | null {
  if (!productId) return null;
  return plans().find((p) => p.productId === productId)?.period ?? null;
}

function toEntitlement(period: PlanPeriod, purchase: StorePurchase): Entitlement {
  return {
    active: true,
    period,
    until: expiryMs(purchase.expiresAt ?? purchase.expiryDate),
    channel: window.Capacitor?.getPlatform?.() === 'android' ? 'android' : 'ios',
  };
}

function expiryMs(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const ms = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

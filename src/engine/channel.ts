/**
 * Which shop the player is standing in.
 *
 * Slides is sold through two different counters, and which one a player
 * reaches is decided entirely by how they opened the game:
 *
 *   web      — the site. Creem takes the money, in US dollars, one price
 *              worldwide.
 *   ios      — the App Store build. Apple takes the money, at the store's
 *              own regional tier, which in mainland China is priced in yuan.
 *   android  — the Google Play build, on the same terms.
 *
 * The split is not a preference and not a guess about where the player is:
 * it is the only channel that can actually charge them. A phone in mainland
 * China cannot reach Creem's checkout at all, so the app build never offers
 * it; a browser has no store to bill through, so the site never offers an
 * in-app purchase. Every price, every button and every line of the pricing
 * document downstream of here asks this one question first, which is what
 * keeps a player from ever being shown a price they cannot pay.
 *
 * Nothing is imported to find this out. Capacitor's native runtime puts a
 * `Capacitor` object on `window` before the web bundle loads; a browser has
 * no such object. Reading the global rather than importing @capacitor/core
 * keeps the site's bundle byte-for-byte free of native code — the same
 * principle capacitor.config.ts is written to.
 */

export type SalesChannel = 'web' | 'ios' | 'android';

/** The slice of Capacitor's injected global this file relies on. */
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, unknown>;
}

declare global {
  interface Window {
    Capacitor?: CapacitorGlobal;
  }
}

/** Read once: the shell cannot change under a running page. */
let cached: SalesChannel | null = null;

export function salesChannel(): SalesChannel {
  if (cached) return cached;
  cached = detect();
  return cached;
}

function detect(): SalesChannel {
  const cap = typeof window === 'undefined' ? undefined : window.Capacitor;
  // `isNativePlatform` is false in Capacitor's own browser fallback, which is
  // what `npm run dev` serves — that is a website and pays like one.
  if (!cap?.isNativePlatform?.()) return 'web';
  return cap.getPlatform?.() === 'android' ? 'android' : 'ios';
}

/** True in the App Store / Google Play builds, where the store bills. */
export function isStoreChannel(): boolean {
  return salesChannel() !== 'web';
}

/**
 * The name to print when a document has to say who takes the money — the
 * one place a player is told which company will appear on their statement.
 */
export function payeeName(): string {
  switch (salesChannel()) {
    case 'ios':
      return 'App Store';
    case 'android':
      return 'Google Play';
    default:
      return 'Creem';
  }
}

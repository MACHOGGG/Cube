import type { Lang } from '../i18n';
import { salesChannel, type SalesChannel } from './channel';

/**
 * What 「Slides 天才」 costs, and — the whole point of this file — which of
 * the two price lists a player is allowed to see.
 *
 * The site and the app builds are priced separately, in their own currency,
 * because they are billed by different companies:
 *
 *   web    US$0.99 / month, US$4.99 / year — one price for the whole world,
 *          charged by Creem.
 *   store  ¥2 / month, ¥9.9 / year — the mainland-China tier of the App
 *          Store / Google Play price the product is configured at.
 *
 * `plans()` returns exactly one of those lists — never both, never the other
 * one. That is what makes the split real rather than cosmetic: a player in
 * the app is not shown a dollar price they would have to leave the country's
 * network to pay, and a player on the site is not shown a yuan price no
 * browser can charge. Anything that wants to print a price goes through
 * here, so there is no second place for the wrong currency to leak out of.
 *
 * On the store channel the numbers below are only a fallback. Apple and
 * Google localise and display the price themselves, and their figure is the
 * one that will actually be charged — including whenever a tier is
 * repriced — so `PLANS` is overwritten with the store's own strings as soon
 * as they load (see engine/iap.ts). The constants here are what the paywall
 * shows in the moment before that answer arrives.
 */

export type PlanPeriod = 'monthly' | 'yearly';
export type Currency = 'USD' | 'CNY';

export interface Plan {
  period: PlanPeriod;
  currency: Currency;
  /** Minor units — cents, or 分 — so no price is ever a binary fraction. */
  minor: number;
  /**
   * The identifier the product carries in App Store Connect and the Play
   * Console — deliberately the same two strings on both stores, so one 天才
   * subscription means one thing everywhere.
   *
   * Absent on the web, and deliberately so: the Creem product ids live in
   * the server's environment and the browser only ever names a period. That
   * keeps the whole Creem catalogue out of the bundle, so switching between
   * the test and live catalogues is a Vercel setting rather than a rebuild.
   */
  productId?: string;
  /**
   * Set once the store has told us what it will really print — StoreKit and
   * Play Billing both hand back a fully localised, already-formatted string
   * ("¥2.00", "NT$60"), and when we have it, it wins over `minor`.
   */
  storePrice?: string;
}

/** The App Store / Google Play product identifiers, under the bundle id. */
const STORE_MONTHLY = 'com.slides.game.genius.monthly';
const STORE_YEARLY = 'com.slides.game.genius.yearly';

const WEB_PLANS: Plan[] = [
  { period: 'monthly', currency: 'USD', minor: 99 },
  { period: 'yearly', currency: 'USD', minor: 499 },
];

const STORE_PLANS: Plan[] = [
  { period: 'monthly', currency: 'CNY', minor: 200, productId: STORE_MONTHLY },
  { period: 'yearly', currency: 'CNY', minor: 990, productId: STORE_YEARLY },
];

/** The one list this build is allowed to sell from. */
export function plans(channel: SalesChannel = salesChannel()): Plan[] {
  return channel === 'web' ? WEB_PLANS : STORE_PLANS;
}

export function planFor(period: PlanPeriod): Plan {
  return plans().find((p) => p.period === period)!;
}

/** The currency this build charges in — 'USD' on the site, 'CNY' in a store. */
export function currency(): Currency {
  return plans()[0].currency;
}

/**
 * Records what the store says it will charge, so the paywall can stop
 * showing the built-in figure. Ignored on the web, which has no store to
 * hear it from.
 */
export function applyStorePrices(prices: Record<string, string>): void {
  for (const plan of STORE_PLANS) {
    const shown = plan.productId && prices[plan.productId];
    if (shown) plan.storePrice = shown;
  }
}

/** "0.99" · "4.99" · "2" · "9.9" — the minimum number of digits that is
 *  still the exact amount, since ¥2.00 reads as fussy where ¥9.90 does not. */
function decimals(minor: number): string {
  return (minor / 100).toFixed(2).replace(/\.?0+$/, '');
}

/**
 * The price as that language writes it. Four languages, two currencies, and
 * the conventions genuinely differ — French puts the sign after the number
 * and uses a decimal comma; Chinese names the currency in words, the way the
 * pricing document already does.
 */
export function formatPrice(plan: Plan, lang: Lang): string {
  if (plan.storePrice) return plan.storePrice;
  const n = decimals(plan.minor);
  if (plan.currency === 'USD') {
    switch (lang) {
      case 'en':
        return `US$${n}`;
      case 'fr':
        return `${n.replace('.', ',')} $US`;
      default:
        return `${n} 美元`;
    }
  }
  switch (lang) {
    case 'en':
      return `CN¥${n}`;
    case 'fr':
      return `${n.replace('.', ',')} ¥`;
    default:
      return `${n} 元`;
  }
}

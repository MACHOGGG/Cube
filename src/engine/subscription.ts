import { report } from './analytics';
import { salesChannel, type SalesChannel } from './channel';
import type { PlanPeriod } from './pricing';

/**
 * Whether this player is a 「Slides 天才」, and the one door through which
 * they can become one.
 *
 * Two channels sell the subscription and they prove it in entirely different
 * ways. The store builds get their answer from Apple or Google, who know who
 * the player is because they are signed into the device — nothing is
 * registered, nothing is typed, and a reinstall is recovered with 恢复购买.
 * The web has no such signed-in identity, so a subscription bought on the
 * site belongs to the email address it was bought with, and coming back to
 * it later means naming that address again.
 *
 * That asymmetry is why 注册 exists on the site and does not exist in the
 * app: an account is not a feature we wanted, it is the web's substitute for
 * the identity a store already has. Neither channel is ever asked to
 * understand the other's proof.
 *
 * What is cached here is only a cache. It lets the game know, offline and
 * instantly, what it last established — it is never the authority. The
 * authority is Creem (asked through api/subscription) or the store receipt,
 * and both are re-checked on the next launch that has a network.
 */

export interface Entitlement {
  active: boolean;
  period?: PlanPeriod;
  /** Epoch ms at which the paid period runs out, when the seller says. */
  until?: number;
  /**
   * Which counter it came from — a store purchase is never resolved by
   * Creem, and vice versa. `'code'` is the exception: a redeemed code is
   * granted by us rather than sold by anyone, so it belongs to the address
   * it was redeemed with and travels with the player across every build.
   */
  channel: SalesChannel | 'code';
  /** The address a web subscription is attached to. Unused in the app. */
  email?: string;
  /**
   * Rotated on every sign-in to a code-granted account, and the only proof
   * of it we hold: the passcode is never kept on the device. It is what the
   * server checks before letting this player open a multiplayer room.
   */
  token?: string;
}

export type PurchaseOutcome =
  | { ok: true; entitlement: Entitlement }
  /** The site hands off to Creem's page; the tab is on its way out. */
  | { ok: 'redirecting' }
  | { ok: false; reason: PurchaseFailure; detail?: string };

export type PurchaseFailure =
  /** The player backed out of the store sheet or the checkout page. */
  | 'cancelled'
  /** No store to talk to — a native build whose billing plugin is absent. */
  | 'unavailable'
  /** Products aren't set up yet: no Creem ids, or the store has no listing. */
  | 'notConfigured'
  | 'network'
  /** 恢复购买 / signing back in found nothing to restore. */
  | 'none';

const KEY = 'slides_genius';

const NOBODY: Entitlement = { active: false, channel: salesChannel() };

let cached: Entitlement | null = null;
const listeners = new Set<(e: Entitlement) => void>();

function read(): Entitlement {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return NOBODY;
    const saved = JSON.parse(raw) as Entitlement;
    // A subscription bought in one channel proves nothing in the other: the
    // same phone can run the app and the site, and the app must not inherit
    // a web entitlement it has no way to renew or refund. A redeemed code is
    // the exception — nobody sold it, so no channel owns it.
    if (saved.channel !== 'code' && saved.channel !== salesChannel()) return NOBODY;
    return saved;
  } catch {
    // Private mode, a cleared profile, or something else's key on ours.
    return NOBODY;
  }
}

/** What we last established. Cheap, synchronous, and safe to call in render. */
export function entitlement(): Entitlement {
  if (!cached) cached = read();
  return cached;
}

/** The question every locked feature actually asks. */
export function isGenius(): boolean {
  const e = entitlement();
  if (!e.active) return false;
  // An expiry we were given is honoured even with no network to re-check it,
  // so a lapsed subscription doesn't stay unlocked forever offline. One day
  // of slack absorbs the gap between a renewal and the next time we can ask.
  if (e.until && Date.now() > e.until + 24 * 60 * 60 * 1000) return false;
  return true;
}

/** The address a web subscription is attached to, when there is one. */
export function signedInEmail(): string | undefined {
  return entitlement().email;
}

export function setEntitlement(next: Entitlement): void {
  cached = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Nothing to do — the in-memory copy still serves this session.
  }
  for (const fn of listeners) fn(next);
}

/** Signing out of the site, and what a store build has no button for. */
export function clearEntitlement(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Same as above: the in-memory clear below is what matters.
  }
  cached = { active: false, channel: salesChannel() };
  for (const fn of listeners) fn(cached);
}

/** Fires whenever the answer changes, so open screens can re-draw. */
export function onGeniusChange(fn: (e: Entitlement) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Buy it. Which counter this reaches is not a parameter and not a choice the
 * caller gets to make — it is whichever one can charge this build.
 */
export async function purchase(period: PlanPeriod, email?: string): Promise<PurchaseOutcome> {
  const channel = salesChannel();
  report('subscribe_start', { channel, period });
  const outcome =
    channel === 'web'
      ? await (await import('./creem')).webCheckout(period, email)
      : await (await import('./iap')).storePurchase(period);
  if (outcome.ok === true) setEntitlement(outcome.entitlement);
  report('subscribe_result', {
    channel,
    period,
    result: outcome.ok === true ? 'active' : outcome.ok === 'redirecting' ? 'redirecting' : outcome.reason,
  });
  return outcome;
}

/**
 * Get an existing subscription back: 恢复购买 in the app, and on the web
 * naming the address it was bought with. Apple requires the app to offer
 * this, and a player who reinstalls has every right to expect it.
 */
export async function restore(email?: string): Promise<PurchaseOutcome> {
  const channel = salesChannel();
  const outcome =
    channel === 'web'
      ? await (await import('./creem')).webRestore(email ?? '')
      : await (await import('./iap')).storeRestore();
  if (outcome.ok === true) setEntitlement(outcome.entitlement);
  report('subscribe_restore', {
    channel,
    result: outcome.ok === true ? 'active' : outcome.ok === 'redirecting' ? 'redirecting' : outcome.reason,
  });
  return outcome;
}

/**
 * Quietly re-ask the seller whether the subscription is still live, and
 * settle a checkout the player has just come back from. Called once at boot;
 * it never blocks a screen and it never reports an error to anyone — with no
 * network the cache stands, which is exactly what it is for.
 */
export async function refreshEntitlement(): Promise<void> {
  try {
    if (salesChannel() === 'web') {
      const creem = await import('./creem');
      // A return from Creem's page carries the order in the URL; that is a
      // fresh purchase to record, and it takes precedence over the cache.
      const settled = await creem.settleReturn();
      if (settled) {
        setEntitlement(settled);
        return;
      }
      // A redeemed code carries its own end date and cannot be extended
      // without another code, so there is nothing to re-ask anyone about.
      if (entitlement().channel === 'code') return;
      const email = signedInEmail();
      if (!email) return;
      const current = await creem.webRestore(email);
      if (current.ok === true) setEntitlement(current.entitlement);
      else if (current.ok === false && current.reason === 'none') clearEntitlement();
      return;
    }
    if (entitlement().channel === 'code') return;
    const iap = await import('./iap');
    // Loading the store's own price list is part of the same round trip, so
    // the paywall shows Apple's or Google's figure rather than our fallback.
    await iap.loadStorePrices();
    const current = await iap.storeRestore(true);
    if (current.ok === true) setEntitlement(current.entitlement);
  } catch {
    // Offline, or a store that would not answer. The cache stands.
  }
}

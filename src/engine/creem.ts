import type { PlanPeriod } from './pricing';
import type { Entitlement, PurchaseOutcome } from './subscription';

/**
 * The web counter: Creem, in US dollars, one price for the whole world.
 *
 * This file only ever talks to our own two endpoints under /api. The secret
 * half of Creem — CREEM_API_KEY — lives there and never reaches the bundle,
 * which is also why there is no Creem SDK here: the browser's part of a
 * hosted checkout is to be sent to a URL and to come back from it.
 *
 * A web subscription is attached to the email it was bought with, because
 * that is the only identity the site has. There is no password anywhere in
 * this flow: what proves the subscription is Creem's own record of that
 * address, asked for fresh each time, so there is no credential of ours for
 * anyone to lose. Signing in on a new device means naming the address and
 * having Creem confirm it.
 *
 * None of this is reachable from the App Store or Google Play builds —
 * engine/subscription.ts routes those to the store instead. A phone in
 * mainland China cannot open Creem's checkout at all, which is the reason
 * the app is sold through the stores rather than through this page.
 */

/** What api/subscription answers with. */
interface SubscriptionReply {
  active: boolean;
  /** Present on a password sign-in; stands in for it on this device after. */
  token?: string;
  /** 'code' when the entitlement came from a redeemed code rather than a
   *  card — it belongs to the address, not to this channel. */
  kind?: 'code';
  period?: PlanPeriod;
  /** Epoch ms, when Creem gives an end date for the paid period. */
  until?: number;
  email?: string;
  /** Paid up, but no password set yet — see api/subscription.js. */
  needsPasscode?: boolean;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as T;
}

/**
 * Hand the tab to Creem's hosted checkout. On success this function does not
 * really return — the page is replaced — so the caller is told 'redirecting'
 * rather than being left waiting for a result that will arrive in a new
 * document, through settleReturn() below.
 */
export async function webCheckout(period: PlanPeriod, email?: string): Promise<PurchaseOutcome> {
  try {
    const { url } = await postJson<{ url?: string }>('/api/checkout', {
      period,
      email,
      // Where Creem sends them afterwards: back to this page, which will
      // find the order in the query string and record it.
      returnUrl: window.location.origin + window.location.pathname,
    });
    if (!url) return { ok: false, reason: 'notConfigured' };
    window.location.assign(url);
    return { ok: 'redirecting' };
  } catch (err) {
    // 503 is the server saying it has no Creem key or no products yet — the
    // subscription is genuinely not on sale, which is not a network fault.
    return { ok: false, reason: String(err) === 'Error: 503' ? 'notConfigured' : 'network' };
  }
}

/**
 * Ask Creem whether this address has a live subscription. This is both
 * "log in" and "restore" on the web — there is nothing else to check.
 */
export async function webRestore(email: string, password: string): Promise<PurchaseOutcome> {
  const address = email.trim();
  if (!address) return { ok: false, reason: 'none' };
  try {
    const reply = await postJson<SubscriptionReply>('/api/subscription', {
      email: address,
      password,
    });
    // Paid, but the password step never happened. Sending them to finish it
    // is the only honest answer: they own this subscription, and the way to
    // prove it on the next device is the password they have yet to choose.
    if (reply.needsPasscode) return { ok: false, reason: 'needsPasscode' };
    if (!reply.active) return { ok: false, reason: 'none' };
    return { ok: true, entitlement: toEntitlement(reply, address) };
  } catch (err) {
    return { ok: false, reason: failureFor(err) };
  }
}

/**
 * Sets the password on a subscription just paid for.
 *
 * The proof is the checkout id the browser was sent back with, never
 * anything the player has to read or type — they see the window, choose a
 * password, and that is the whole of it. Resolves to true when it took.
 */
export async function setWebPasscode(
  checkoutId: string,
  password: string,
): Promise<{ email: string; token: string } | 'exists' | 'unavailable' | null> {
  try {
    const reply = await postJson<{ email?: string; token?: string }>('/api/passcode', {
      checkoutId,
      password,
    });
    return reply.token ? { email: reply.email ?? '', token: reply.token } : null;
  } catch (err) {
    // 503: nowhere to keep an account yet — the player can do nothing about
    // it, so say so plainly rather than blaming their connection.
    // 409: this address already has a password, which is not a failure at all.
    const code = String(err).replace('Error: ', '');
    if (code === '503') return 'unavailable';
    if (code === '409') return 'exists';
    return null;
  }
}

/**
 * 401 and 423 are answers about the password. A 5xx is the server admitting
 * it could not answer at all — which is emphatically not the same thing as
 * the phone being offline, and saying so cost an afternoon once.
 */
function failureFor(err: unknown): 'wrong' | 'locked' | 'server' | 'network' {
  const code = String(err).replace('Error: ', '');
  if (code === '401') return 'wrong';
  if (code === '423') return 'locked';
  const status = Number(code);
  return status >= 500 && status < 600 ? 'server' : 'network';
}

/**
 * A player coming back from the checkout page. Creem appends the order to
 * the return URL; we ask our own endpoint to confirm it with Creem rather
 * than believing the query string, since anyone can type one of those.
 *
 * The parameters are stripped afterwards, so a reload or a shared link is
 * not a second attempt to settle the same order.
 */
export interface SettledReturn {
  entitlement: Entitlement;
  /** Kept so the password window can prove which address it may set one for.
   *  The player never sees it: it arrives in the URL and is wiped from the
   *  address bar the moment it is read, one line below. */
  checkoutId: string;
}

export async function settleReturn(): Promise<SettledReturn | null> {
  const params = new URLSearchParams(window.location.search);
  const checkoutId = params.get('checkout_id') || params.get('checkoutId');
  if (!checkoutId) return null;
  clearReturnParams(params);
  try {
    const reply = await postJson<SubscriptionReply>('/api/subscription', { checkoutId });
    if (!reply.active) return null;
    return { entitlement: toEntitlement(reply, reply.email ?? ''), checkoutId };
  } catch {
    return null;
  }
}

/**
 * The silent re-ask at launch, on a device that has already typed the
 * password once. The token stands in for it; Creem is still the one who says
 * whether the subscription is paid up, so a cancelled one lapses here on its
 * own. Null means "no answer" — the caller keeps whatever it had.
 */
export async function webRefresh(email: string, token: string): Promise<Entitlement | null> {
  try {
    const reply = await postJson<SubscriptionReply>('/api/subscription', { email, token });
    if (!reply.active) return null;
    return toEntitlement(reply, reply.email ?? email);
  } catch {
    return null;
  }
}

/**
 * Open Creem's customer portal — cancelling, cards and receipts, all on
 * Creem's own page. Returns false when there is nothing to open, so the
 * caller can say so rather than leaving a button that does nothing.
 */
export async function webPortal(email: string, password: string): Promise<boolean> {
  try {
    const { url } = await postJson<{ url?: string }>('/api/portal', { email, password });
    if (!url) return false;
    window.open(url, '_blank', 'noopener');
    return true;
  } catch {
    return false;
  }
}

function toEntitlement(reply: SubscriptionReply, email: string): Entitlement {
  return {
    active: true,
    period: reply.period,
    until: reply.until,
    channel: reply.kind === 'code' ? 'code' : 'web',
    email: reply.email ?? email,
    ...(reply.token ? { token: reply.token } : {}),
  };
}

/** Take Creem's parameters back out of the address bar, leaving the rest. */
function clearReturnParams(params: URLSearchParams): void {
  for (const key of ['checkout_id', 'checkoutId', 'order_id', 'customer_id', 'subscription_id', 'signature', 'product_id', 'request_id']) {
    params.delete(key);
  }
  const query = params.toString();
  history.replaceState(null, '', window.location.pathname + (query ? '?' + query : '') + window.location.hash);
}

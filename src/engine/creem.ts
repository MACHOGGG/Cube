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
  period?: PlanPeriod;
  /** Epoch ms, when Creem gives an end date for the paid period. */
  until?: number;
  email?: string;
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
export async function webRestore(email: string): Promise<PurchaseOutcome> {
  const address = email.trim();
  if (!address) return { ok: false, reason: 'none' };
  try {
    const reply = await postJson<SubscriptionReply>('/api/subscription', { email: address });
    if (!reply.active) return { ok: false, reason: 'none' };
    return { ok: true, entitlement: toEntitlement(reply, address) };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

/**
 * A player coming back from the checkout page. Creem appends the order to
 * the return URL; we ask our own endpoint to confirm it with Creem rather
 * than believing the query string, since anyone can type one of those.
 *
 * The parameters are stripped afterwards, so a reload or a shared link is
 * not a second attempt to settle the same order.
 */
export async function settleReturn(): Promise<Entitlement | null> {
  const params = new URLSearchParams(window.location.search);
  const checkoutId = params.get('checkout_id') || params.get('checkoutId');
  if (!checkoutId) return null;
  clearReturnParams(params);
  try {
    const reply = await postJson<SubscriptionReply>('/api/subscription', { checkoutId });
    if (!reply.active) return null;
    return toEntitlement(reply, reply.email ?? '');
  } catch {
    return null;
  }
}

/**
 * Open Creem's customer portal — cancelling, cards and receipts, all on
 * Creem's own page. Returns false when there is nothing to open, so the
 * caller can say so rather than leaving a button that does nothing.
 */
export async function webPortal(email: string): Promise<boolean> {
  try {
    const { url } = await postJson<{ url?: string }>('/api/portal', { email });
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
    channel: 'web',
    email: reply.email ?? email,
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

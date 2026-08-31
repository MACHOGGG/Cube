/**
 * The server's half of the web subscription.
 *
 * Everything Creem-shaped lives on this side of the wire: the API key, the
 * two product ids, and the decision about what counts as a paid-up player.
 * The browser never sees any of it — it names a billing period, or an email
 * address, and gets back a yes or a no.
 *
 * There is no database here, and that is deliberate rather than a shortcut.
 * Creem already keeps the authoritative record of who is subscribed, so a
 * second copy of it in our own store would only be a thing that could
 * disagree. Every answer below is read from Creem at the moment it is asked.
 *
 * These endpoints serve the site alone. The App Store and Google Play builds
 * never call them: those are billed by the store, in yuan, and their receipts
 * are checked on the device.
 */

const key = () => process.env.CREEM_API_KEY || '';

/** Test keys start with creem_test_ and belong to the sandbox catalogue. */
const base = () =>
  key().startsWith('creem_test_') ? 'https://test-api.creem.io' : 'https://api.creem.io';

export const configured = () => Boolean(key());

/** The two products 「Slides 天才」 is sold as, by billing period. */
export const products = () => ({
  monthly: process.env.CREEM_PRODUCT_MONTHLY || '',
  yearly: process.env.CREEM_PRODUCT_YEARLY || '',
});

export async function creem(path, { method = 'GET', query, body } = {}) {
  const url = new URL(base() + path);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    method,
    headers: {
      'x-api-key': key(),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = new Error(`creem ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * The statuses that mean the player has paid for the period they are in.
 *
 * `scheduled_cancel` is included on purpose: someone who has cancelled keeps
 * what they bought until the period runs out, which is exactly what the
 * pricing document promises — "已经付过费的当期会用到期末". `past_due` and
 * `unpaid` are not: those are a payment that did not go through.
 */
const ENTITLED = new Set(['active', 'trialing', 'scheduled_cancel']);

export const entitled = (sub) => Boolean(sub) && ENTITLED.has(sub.status);

/** Creem returns a nested entity or a bare id, depending on the endpoint. */
const idOf = (value) => (typeof value === 'string' ? value : value?.id);

export function periodOf(sub) {
  const id = idOf(sub?.product);
  const { monthly, yearly } = products();
  if (id && id === yearly) return 'yearly';
  if (id && id === monthly) return 'monthly';
  return undefined;
}

export function untilOf(sub) {
  const ms = Date.parse(sub?.current_period_end_date || '');
  return Number.isFinite(ms) ? ms : undefined;
}

export function emailOf(entity) {
  const customer = entity?.customer;
  return typeof customer === 'string' ? undefined : customer?.email;
}

/** What the browser is told about a subscription — no more than it needs. */
export const answer = (sub, email) => ({
  active: true,
  period: periodOf(sub),
  until: untilOf(sub),
  email,
});

export const NOBODY = { active: false };

export function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

export function send(res, status, payload) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // A subscription answer is per-player and must never be cached by a CDN.
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

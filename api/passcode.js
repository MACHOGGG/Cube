import { configured, creem, emailOf, entitled, periodOf, readBody, send } from './_creem.js';
import {
  EMAIL_RE,
  PASS_RE,
  SECRET_RE,
  checkPin,
  codeHolder,
  ensureGiftCodes,
  loadAccount,
  newAccount,
  normalizeEmail,
  saveAccount,
  takeAccount,
} from './_accounts.js';
import { storeConfigured } from './_store.js';

/**
 * The password on a card subscription.
 *
 * Before this existed, naming the address was the whole of signing in: type
 * any subscriber's email and the site handed over their subscription. The
 * address is not a secret — it is printed on every receipt and known to
 * everyone they have ever written to — so it could never have been the proof.
 * This endpoint is where the proof gets set.
 *
 * Two ways in, and what each one proves:
 *
 *   { checkoutId, password }            — a checkout Creem confirms is paid.
 *     Only whoever came back from that payment holds the id, so holding it
 *     is the evidence that the address is theirs to claim. This is the one
 *     the app uses, the moment the player lands back from Creem.
 *
 *   { code, token, email, password }    — the token a redeemed code
 *     returned. It attaches an address to what the code granted, so the
 *     month or year travels to the player's next phone instead of living
 *     and dying in one browser.
 *
 *   { email, password, newPassword }    — the current password.
 *     Changing one already set. Nothing else can authorise this; a fresh
 *     checkout id will not overwrite an account that already has a password,
 *     or paying twice would be a way to take one over.
 *
 * Creem still owns the answer to "is this subscription paid up". Nothing
 * here grants an entitlement — it only decides who is allowed to ask.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  // No store, no accounts: say so rather than accepting a password that
  // would evaporate and lock the player out of what they just bought.
  if (!storeConfigured()) return send(res, 503, { error: 'notConfigured' });

  const { checkoutId, code, token, email, password, newPassword } = readBody(req);
  if (checkoutId) return create(res, String(checkoutId), password);
  if (code) return bind(res, String(code), String(token || ''), email, password);
  return change(res, email, password, newPassword);
}

/**
 * Attaching an address to what a code granted.
 *
 * The proof is the token the redemption returned, held only by the browser
 * that spent the code — guessing the code itself buys nothing, since the code
 * is deleted the moment it is spent and this needs the token as well.
 *
 * An address that already has an account is refused rather than merged: the
 * only honest way to add time to an existing account is to prove that account
 * is yours first, and this request carries no such proof. Nothing is lost by
 * refusing — the code's month is still there under its own key, and still
 * works on this device, so the player can attach it to another address or
 * write in.
 */
async function bind(res, rawCode, token, email, password) {
  const address = normalizeEmail(email);
  if (!EMAIL_RE.test(address)) return send(res, 400, { error: 'invalid' });
  if (!PASS_RE.test(String(password || ''))) return send(res, 400, { error: 'weak' });

  const holder = codeHolder(rawCode);

  // Look before claiming. A wrong token must not so much as touch the
  // entitlement — otherwise anyone who guessed a code could take it out of
  // its owner's hands for as long as it takes to put it back.
  const seen = await loadAccount(holder);
  if (!seen || !seen.token || token !== seen.token) {
    return send(res, 401, { error: 'wrong' });
  }

  // Now claim it, in one step that only one caller can win.
  //
  // This used to be four separate steps — read the holder, check the
  // address, write the account, delete the holder — with nothing stopping a
  // second request from starting its own read while the first was still
  // between them. On Upstash every one of those steps is an HTTP round trip,
  // so "between them" is a long time, and two requests could each have come
  // away with the same month under a different address. GETDEL closes it:
  // the loser gets null.
  const granted = await takeAccount(holder);
  // Gone between the look and the claim: another request won it and has
  // already bound it to an address. From here that is indistinguishable
  // from — and means the same thing as — a code that has been used.
  if (!granted) return send(res, 409, { error: 'code' });

  // Taken. From here every way out that is not success has to put it back,
  // or the player loses what the code gave them to a refusal.
  const giveBack = () => saveAccount(holder, granted);

  if (!granted.token || token !== granted.token) {
    await giveBack();
    return send(res, 401, { error: 'wrong' });
  }
  if (await loadAccount(address)) {
    await giveBack();
    return send(res, 409, { error: 'exists' });
  }

  // Everything the code was worth moves across; only the secret is new.
  const account = newAccount(String(password), 'code');
  account.until = granted.until;
  account.plan = granted.plan;
  try {
    await saveAccount(address, account);
  } catch (err) {
    await giveBack();
    throw err;
  }

  return send(res, 200, { ok: true, email: address, token: account.token });
}

/** First password, proven by the checkout the player has just come back from. */
async function create(res, checkoutId, password) {
  if (!PASS_RE.test(String(password || ''))) return send(res, 400, { error: 'weak' });
  if (!configured()) return send(res, 503, { error: 'notConfigured' });

  let address;
  let period;
  try {
    const checkout = await creem('/v1/checkouts', { query: { checkout_id: checkoutId } });
    if (checkout?.status !== 'completed') return send(res, 403, { error: 'unpaid' });
    const sub =
      typeof checkout.subscription === 'string'
        ? await creem('/v1/subscriptions', { query: { subscription_id: checkout.subscription } })
        : checkout.subscription;
    if (!entitled(sub)) return send(res, 403, { error: 'unpaid' });
    address = normalizeEmail(emailOf(checkout) ?? emailOf(sub) ?? '');
    // Which product they bought, so the two gift codes a yearly subscriber
    // gets can be minted the moment the account exists.
    period = periodOf(sub);
  } catch (err) {
    console.error('passcode create failed:', err?.message || err);
    return send(res, 502, { error: 'upstream' });
  }
  if (!EMAIL_RE.test(address)) return send(res, 502, { error: 'upstream' });

  // An address that already has a password keeps it. Otherwise a second
  // checkout — anyone's — would be a way to overwrite someone else's.
  if (await loadAccount(address)) return send(res, 409, { error: 'exists' });

  const account = newAccount(String(password), 'card');
  account.period = period;
  await saveAccount(address, account);
  // A year is a long thing to buy on your own recommendation, so a yearly
  // subscriber gets two months to hand out. Minted here, where the account
  // first exists, and remembered on it so they are never minted twice.
  const gifts = await ensureGiftCodes(address, account, period);
  // Hand back the token with it, so the device that just chose the password
  // is signed in by that act and never asked for it again.
  return send(res, 200, {
    ok: true,
    email: address,
    token: account.token,
    ...(gifts?.length ? { gifts } : {}),
  });
}

/** Changing a password, proven by the one it replaces. */
async function change(res, email, password, newPassword) {
  const address = normalizeEmail(email);
  if (!EMAIL_RE.test(address) || !SECRET_RE.test(String(password || ''))) {
    return send(res, 400, { error: 'invalid' });
  }
  if (!PASS_RE.test(String(newPassword || ''))) return send(res, 400, { error: 'weak' });

  const account = await loadAccount(address);
  // Same answer for "no such account" as for "wrong password", so this
  // cannot be used to find out who has one.
  if (!account) return send(res, 401, { error: 'wrong' });

  const verdict = await checkPin(address, String(password), account);
  if (verdict === 'blocked') return send(res, 423, { error: 'blocked' });
  if (verdict === 'locked') return send(res, 423, { error: 'locked' });
  if (verdict !== 'ok') return send(res, 401, { error: 'wrong' });

  const fresh = newAccount(String(newPassword), account.kind || 'card');
  // A change keeps everything the account is worth — a redeemed code's
  // remaining time included — and replaces only the secret and its salt.
  // A change keeps what the account is worth and retires every token, so a
  // device someone else still holds stops working the moment you change it.
  const next = { ...account, ...fresh, until: account.until, plan: account.plan };
  await saveAccount(address, next);
  return send(res, 200, { ok: true, email: address, token: next.token });
}

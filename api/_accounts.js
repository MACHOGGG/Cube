import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mintCodes } from './_codes.js';
import { del, get, set } from './_store.js';

/**
 * The accounts a redeemed code creates — the only accounts this app has.
 *
 * A card subscription needs none of this: Creem holds that record and is
 * asked about it directly. But a redeemed code is ours to honour, so it
 * needs somewhere to live and some way for the player to prove, on a new
 * phone, that it is theirs. That is an address and a passcode.
 *
 * ── About a 4-digit passcode ─────────────────────────────────────────────
 * Four digits is ten thousand possibilities, and six is a million; allowing
 * anything from four to six makes the union 1.11 million, but an attacker
 * enumerates the short ones first, so whoever chooses four digits is sitting
 * in a ten-thousand-wide space no matter what the other players chose.
 *
 * The length is therefore not what protects the account. These two things
 * are, and they are why a short passcode is defensible here at all:
 *
 *   scrypt, not a plain hash. Every single guess costs real CPU time, so an
 *   attacker who somehow walked off with the whole store still cannot run
 *   ten thousand guesses per account for free.
 *
 *   A hard lockout. Five wrong tries and the account stops answering, for
 *   fifteen minutes, then thirty, then an hour, up to a day. Ten thousand
 *   guesses at five per lockout is not an attack anyone finishes.
 *
 * What is behind the account is a game subscription, which is what makes
 * that trade — a passcode short enough to actually remember, defended by
 * cost and by lockout rather than by length — a reasonable one to offer.
 */

/** A redeemed code's passcode: 4 to 6 digits, as chosen. */
export const PIN_RE = /^\d{4,6}$/;

/**
 * A card subscriber's password.
 *
 * Six characters is the floor because that is what a person picks and types.
 * There is deliberately no low ceiling: a phone's password manager offers to
 * generate one, and what it generates is twenty-odd mixed characters — a rule
 * of "exactly six digits" would reject the strong password the platform just
 * made, which is the opposite of the point. Anything goes above six.
 *
 * The two credentials are hashed and rate-limited identically; only the shape
 * accepted at the door differs, because the two doors were opened for
 * different reasons.
 */
export const PASS_RE = /^.{6,128}$/;

/**
 * What an endpoint accepts before it knows which kind of account it is
 * looking at. Deliberately loose: the stored hash is what actually decides,
 * and rejecting a shape here early would tell a stranger which kind of
 * account an address has.
 */
export const SECRET_RE = /^.{4,128}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Wrong tries are counted cumulatively and only a correct passcode clears
 * them, so waiting out a lock does not buy a fresh budget of guesses.
 *
 *   4 wrong  the account stops answering for four hours
 *   6 wrong  it stops answering at all, until the address behind it proves
 *            itself and sets a new passcode
 *
 * Six guesses out of ten thousand is not an attack; it is a person who has
 * forgotten which four digits they picked, which is why the way out is the
 * email rather than a longer wait.
 */
const LOCK_AFTER = 4;
const BLOCK_AFTER = 6;
const LOCK_MS = 4 * 3600e3;

export const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

/**
 * The identifier a redeemed code lives under before any address is attached.
 *
 * A code grants its month or year the instant it is typed — that is the whole
 * point of a code, and asking for an address and a password first turned a
 * gift into a form to fill in. But the entitlement still has to live
 * somewhere the server can find again, or clearing the browser would take
 * away something that was given. So it lives here, under the code itself,
 * until the player attaches an address to it — which is what api/passcode.js
 * does, and what the app asks for right after the code goes in.
 *
 * Shaped so it can never collide with a real address: an email cannot
 * contain a colon before its @, and this has no @ at all.
 */
export const codeHolder = (ticket) => 'code:' + String(ticket || '').toUpperCase();
const accountKey = (email) => 'acct:' + normalizeEmail(email);

export const loadAccount = (email) => get(accountKey(email));
export const deleteAccount = (email) => del(accountKey(email));
export const saveAccount = (email, account) => set(accountKey(email), account);

function hash(pin, saltHex) {
  return scryptSync(String(pin), Buffer.from(saltHex, 'hex'), 32).toString('hex');
}

export function newAccount(secret, kind = 'code') {
  const salt = randomBytes(16).toString('hex');
  return {
    /** 'card' — Creem holds the entitlement, this only proves identity.
     *  'code' — a redeemed code, whose entitlement lives in `until` below. */
    kind,
    salt,
    hash: hash(secret, salt),
    until: 0,
    fails: 0,
    lockUntil: 0,
    /** Set once the address itself has to vouch for whoever is trying. */
    blocked: false,
    token: randomBytes(24).toString('hex'),
    createdAt: Date.now(),
  };
}

/**
 * Checks a passcode and records the attempt. Returns one of
 * 'ok' | 'wrong' | 'locked' | 'blocked'. Callers must give the same answer
 * for 'wrong' as for an address with no account at all, so that this cannot
 * be used to find out who has one.
 */
export async function checkPin(email, pin, account) {
  const now = Date.now();
  if (account.blocked) return 'blocked';
  if (account.lockUntil && account.lockUntil > now) return 'locked';

  const attempt = Buffer.from(hash(pin, account.salt), 'hex');
  const known = Buffer.from(account.hash, 'hex');
  const ok = attempt.length === known.length && timingSafeEqual(attempt, known);

  if (ok) {
    // Only getting it right clears the count.
    if (account.fails || account.lockUntil) {
      account.fails = 0;
      account.lockUntil = 0;
      await saveAccount(email, account);
    }
    return 'ok';
  }

  account.fails = (account.fails || 0) + 1;
  if (account.fails >= BLOCK_AFTER) account.blocked = true;
  else if (account.fails >= LOCK_AFTER) account.lockUntil = now + LOCK_MS;
  await saveAccount(email, account);
  return account.blocked ? 'blocked' : account.lockUntil > now ? 'locked' : 'wrong';
}

/** Cleared by the address proving itself — see api/unlock.js. */
export function unblock(account, newPin) {
  account.salt = randomBytes(16).toString('hex');
  account.hash = hash(newPin, account.salt);
  account.fails = 0;
  account.lockUntil = 0;
  account.blocked = false;
  return account;
}

/** How long a timed lock still has to run, for the message shown. */
export const lockRemainingMs = (account) =>
  Math.max(0, (account.lockUntil || 0) - Date.now());

/** A fresh session token on every successful sign-in, so the old one dies. */
export function rotateToken(account) {
  account.token = randomBytes(24).toString('hex');
  return account.token;
}

/** How long a redeemed code is worth. 'life' is handled separately below. */
export const PLAN_MS = {
  month: 31 * 24 * 3600e3,
  half: 184 * 24 * 3600e3,
  year: 366 * 24 * 3600e3,
};

/** The four tiers a code can carry, in the order they are worth. */
export const PLANS = ['month', 'half', 'year', 'life'];
export const isPlan = (plan) => PLANS.includes(plan);

/**
 * "Forever", as a date.
 *
 * Everything downstream — isGenius on the device, entitlementOf here — asks
 * the same question of every entitlement: has `until` passed yet. Giving
 * lifetime a date a thousand years out lets it answer that question the same
 * way as every other tier, instead of every one of those places growing a
 * second branch it would eventually get wrong.
 */
export const LIFETIME_UNTIL = Date.UTC(2999, 0, 1);
export const isLifetime = (account) => (account?.until || 0) >= LIFETIME_UNTIL;

/**
 * Adds a plan to whatever the account already has. Redeeming a second code
 * extends the run rather than replacing it, so nothing a player has already
 * paid for is thrown away by using a gift code early.
 */
export function extend(account, plan) {
  // Adding time to forever is not an error, it is simply nothing.
  if (isLifetime(account)) return account.until;
  if (plan === 'life') {
    account.until = LIFETIME_UNTIL;
    account.plan = 'life';
    return account.until;
  }
  const from = Math.max(Date.now(), account.until || 0);
  account.until = from + (PLAN_MS[plan] ?? PLAN_MS.month);
  account.plan = plan;
  return account.until;
}

/**
 * 年付赠码 — two one-month codes a yearly subscriber can pass to friends.
 *
 * A year is a long thing to ask someone to buy on their own recommendation,
 * so a yearly subscriber gets two months to hand out. They carry a use-by
 * date because a gift with no deadline is one that sits in a drawer: the
 * point of it is that someone plays this month.
 *
 * Issued once and remembered on the account, so this can be called on every
 * sign-in without a subscriber quietly accumulating codes — which is also
 * what makes it work for people who subscribed before the gift existed.
 */
export const GIFT_PLAN = 'month';
export const GIFT_COUNT = 2;
export const GIFT_DAYS = 30;

export async function ensureGiftCodes(email, account, period) {
  if (Array.isArray(account.gifts)) return account.gifts;
  if (period !== 'yearly') return null;
  const expiresAt = Date.now() + GIFT_DAYS * 24 * 3600e3;
  const codes = await mintCodes(GIFT_PLAN, GIFT_COUNT, expiresAt, { source: 'gift' });
  // An empty mint means the store refused; leaving `gifts` unset lets the
  // next sign-in try again rather than recording that they got nothing.
  if (!codes.length) return null;
  account.gifts = codes.map((code) => ({ code, expiresAt }));
  await saveAccount(email, account);
  return account.gifts;
}

/** The gifts as the browser should see them, minus any already spent. */
export async function liveGifts(account) {
  if (!Array.isArray(account?.gifts)) return [];
  const alive = [];
  for (const gift of account.gifts) {
    // A code that is no longer in the store has been redeemed by somebody;
    // showing it would have the subscriber hand out a code that is dead.
    const doc = await get('code:' + String(gift.code).toUpperCase());
    alive.push({ ...gift, spent: !doc });
  }
  return alive;
}

/** What the browser is told. Never the hash, the salt or the attempt count. */
export const entitlementOf = (account, email) => ({
  active: (account.until || 0) > Date.now(),
  // The app only draws two words, and `until` carries the real answer — a
  // half-year and a lifetime both read as the longer of the two.
  period: account.plan === 'month' ? 'monthly' : 'yearly',
  plan: account.plan,
  until: account.until || undefined,
  email,
  token: account.token,
});

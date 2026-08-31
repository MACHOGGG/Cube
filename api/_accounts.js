import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { get, set } from './_store.js';

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

/** 4 to 6 digits, as chosen. */
export const PIN_RE = /^\d{4,6}$/;
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
const accountKey = (email) => 'acct:' + normalizeEmail(email);

export const loadAccount = (email) => get(accountKey(email));
export const saveAccount = (email, account) => set(accountKey(email), account);

function hash(pin, saltHex) {
  return scryptSync(String(pin), Buffer.from(saltHex, 'hex'), 32).toString('hex');
}

export function newAccount(pin) {
  const salt = randomBytes(16).toString('hex');
  return {
    salt,
    hash: hash(pin, salt),
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

/** How long a redeemed code is worth. */
export const PLAN_MS = {
  month: 31 * 24 * 3600e3,
  year: 366 * 24 * 3600e3,
};

/**
 * Adds a plan to whatever the account already has. Redeeming a second code
 * extends the run rather than replacing it, so nothing a player has already
 * paid for is thrown away by using a gift code early.
 */
export function extend(account, plan) {
  const from = Math.max(Date.now(), account.until || 0);
  account.until = from + (PLAN_MS[plan] ?? PLAN_MS.month);
  account.plan = plan;
  return account.until;
}

/** What the browser is told. Never the hash, the salt or the attempt count. */
export const entitlementOf = (account, email) => ({
  active: (account.until || 0) > Date.now(),
  period: account.plan === 'year' ? 'yearly' : 'monthly',
  until: account.until || undefined,
  email,
  token: account.token,
});

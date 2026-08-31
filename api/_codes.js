import { randomInt } from 'node:crypto';
import { get, set } from './_store.js';

/**
 * Minting 「Slides 天才内部码」.
 *
 * Shared by the two places codes are made: the minting page, where a batch is
 * asked for by hand, and the two a yearly subscriber is given automatically.
 * Both write the same document under the same key shape, so /api/redeem never
 * has to know which of the two made the code it is being handed.
 *
 * The alphabet drops the four characters that get misread when a code is
 * copied off a screen or read down a phone — 0/O and 1/I are the whole reason
 * a support email about a code that "doesn't work" ever gets written.
 */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const LENGTH = 6;

export const codeKey = (code) => 'code:' + String(code || '').toUpperCase();

const oneCode = () =>
  Array.from({ length: LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

/**
 * Mints `count` unused codes of one tier and returns them.
 *
 * `expiresAt` is stored on the code as a date rather than as a key lifetime,
 * so a player who is late is told their code expired instead of being told it
 * never existed — the difference between an answerable support question and
 * an argument. Omit it for a code that never goes stale.
 *
 * 6 characters of a 32-letter alphabet is 1.07 billion, so a collision is not
 * a thing that happens — but a new code silently overwriting somebody's
 * unused one would be, so each is checked rather than assumed.
 */
export async function mintCodes(plan, count, expiresAt, extra = {}) {
  const wanted = Math.max(0, Math.floor(count));
  const made = [];
  for (let guard = 0; made.length < wanted && guard < wanted * 4 + 8; guard++) {
    const code = oneCode();
    if (await get(codeKey(code))) continue;
    await set(codeKey(code), {
      plan,
      mintedAt: Date.now(),
      ...(expiresAt ? { expiresAt } : {}),
      ...extra,
    });
    made.push(code);
  }
  return made;
}

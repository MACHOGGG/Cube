/**
 * Mints redeem codes.
 *
 *   node scripts/make-codes.mjs month 20
 *   node scripts/make-codes.mjs year 5
 *
 * Writes each code into the same store the app reads, then prints them —
 * printing is the only time they exist in readable form, since redeeming
 * deletes the key. Needs the store's two environment variables:
 *
 *   KV_REST_API_URL / KV_REST_API_TOKEN   (or the UPSTASH_ pair)
 *
 * Codes avoid 0/O and 1/I, so nothing is lost reading one off a screen or a
 * card. Eight characters from a 32-letter alphabet is about 1.1e12 codes:
 * guessing one is not a thing that happens.
 */
import { randomInt } from 'node:crypto';
import { set, storeConfigured } from '../api/_store.js';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const plan = process.argv[2] === 'year' ? 'year' : 'month';
const count = Math.max(1, Math.min(500, Number(process.argv[3]) || 10));

if (!storeConfigured()) {
  console.error('No store configured — set KV_REST_API_URL and KV_REST_API_TOKEN.');
  console.error('(Without them this would only write into a memory that disappears.)');
  process.exit(1);
}

const pretty = (raw) => raw.slice(0, 4) + '-' + raw.slice(4);
const made = [];
while (made.length < count) {
  let raw = '';
  for (let i = 0; i < 8; i++) raw += ALPHABET[randomInt(0, ALPHABET.length)];
  // Codes are stored under the same normalisation api/redeem.js applies.
  await set('code:' + raw, { plan, mintedAt: Date.now() });
  made.push(pretty(raw));
}

console.log(`${count} × ${plan === 'year' ? '一年' : '一个月'}：`);
for (const code of made) console.log('  ' + code);

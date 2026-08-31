import { randomInt } from 'node:crypto';
import { send, readBody } from './_creem.js';
import {
  EMAIL_RE,
  PIN_RE,
  entitlementOf,
  loadAccount,
  normalizeEmail,
  rotateToken,
  saveAccount,
  unblock,
} from './_accounts.js';
import { callerId, tooMany } from './_ratelimit.js';
import { del, get, set, storeConfigured } from './_store.js';
import { mailConfigured, sendMail } from './_mail.js';

/**
 * The way back in after six wrong passcodes.
 *
 * Six wrong guesses is not an attack on a ten-thousand-wide space; it is
 * someone who has forgotten which four digits they chose. So the way out is
 * the address the account is attached to, and it ends by setting a new
 * passcode — unlocking without resetting would only hand the player back the
 * same lock they were already standing in front of.
 *
 * The verification code is six digits, good for thirty minutes, and dies
 * after five wrong tries. Requesting one says nothing about whether the
 * address has an account: the same answer comes back either way, so this
 * cannot be turned into a way of finding out who plays.
 */

const CODE_TTL_S = 30 * 60;
const MAX_TRIES = 5;
const key = (email) => 'unlock:' + email;

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (!storeConfigured()) return send(res, 503, { error: 'notConfigured' });

  const body = readBody(req);
  const address = normalizeEmail(body.email);
  if (!EMAIL_RE.test(address)) return send(res, 400, { error: 'email' });

  return body.action === 'confirm'
    ? confirm(res, address, body)
    : request(res, req, address);
}

async function request(res, req, address) {
  // No provider, no code. Saying so lets the app point at the support
  // address instead of leaving the player waiting for mail that never sends.
  if (!mailConfigured()) return send(res, 503, { error: 'noMail' });

  // Two limits, because there are two different things worth stopping.
  //
  //   by address — anyone who knows where a blocked account lives could
  //     otherwise point this endpoint at it and post them an unlock code
  //     every few seconds. Three an hour is more than a person who has
  //     genuinely lost the mail ever needs.
  //   by caller  — and one machine cannot work through a list of addresses
  //     either, whoever they belong to.
  //
  // Both answer 429 rather than pretending to have sent it: a player who is
  // really waiting deserves to know why nothing arrived.
  if (await tooMany('unlock:to', address, 3, 3600)) {
    return send(res, 429, { error: 'tooMany' });
  }
  if (await tooMany('unlock:from', callerId(req), 10, 3600)) {
    return send(res, 429, { error: 'tooMany' });
  }

  const account = await loadAccount(address);
  // Only a blocked account gets a code — but an address with no account, or
  // one that is not blocked, is answered exactly the same way.
  if (account?.blocked) {
    const code = String(randomInt(0, 1e6)).padStart(6, '0');
    await set(key(address), { code, tries: 0 }, CODE_TTL_S);
    await sendMail({
      to: address,
      subject: 'Slides — 解锁验证码 / unlock code',
      text:
        `你的 Slides 解锁验证码是 ${code}，30 分钟内有效。\n` +
        `输入后可以设置一个新的密码。如果这不是你本人操作，忽略这封邮件即可。\n\n` +
        `Your Slides unlock code is ${code}. It is valid for 30 minutes and lets you\n` +
        `set a new passcode. If this was not you, you can ignore this message.`,
    });
  }
  return send(res, 200, { sent: true });
}

async function confirm(res, address, { code, password }) {
  const pin = String(password || '');
  if (!PIN_RE.test(pin)) return send(res, 400, { error: 'password' });

  const pending = await get(key(address));
  if (!pending) return send(res, 400, { error: 'expired' });
  if ((pending.tries || 0) >= MAX_TRIES) {
    await del(key(address));
    return send(res, 429, { error: 'expired' });
  }
  if (String(code || '').trim() !== pending.code) {
    pending.tries = (pending.tries || 0) + 1;
    await set(key(address), pending, CODE_TTL_S);
    return send(res, 401, { error: 'wrongCode' });
  }

  const account = await loadAccount(address);
  if (!account) return send(res, 400, { error: 'expired' });
  unblock(account, pin);
  rotateToken(account);
  await saveAccount(address, account);
  await del(key(address));
  return send(res, 200, entitlementOf(account, address));
}

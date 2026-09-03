import { send, readBody } from './_creem.js';
import {
  EMAIL_RE,
  SECRET_RE,
  burnGuess,
  checkPin,
  entitlementOf,
  loadAccount,
  lockRemainingMs,
  normalizeEmail,
  rotateToken,
  saveAccount,
} from './_accounts.js';
import { storeConfigured } from './_store.js';

/**
 * Signing in to an account a redeemed code created.
 *
 * This is not how a card subscriber gets their subscription back — that is
 * api/subscription.js, which asks Creem about the address and needs no
 * passcode at all. This endpoint exists only for entitlements we granted
 * ourselves and therefore have to remember.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (!storeConfigured()) return send(res, 503, { error: 'notConfigured' });

  const { email, password } = readBody(req);
  const address = normalizeEmail(email);
  // 形状只做最松的一道（SECRET_RE），和别的登录入口一样：真正说了算的是
  // 存下来的那个哈希。原来这里卡的是「4 到 6 位纯数字」——比全站的规矩
  // （PASS_RE，正好 6 位数字或字母）严，于是一个含字母的合法密码在这儿会
  // 被直接退回，而且退在计数之前：错多少次都不会累加，「错太多次改用邮箱
  // 找回」那条路对这些人等于不存在。
  if (!EMAIL_RE.test(address) || !SECRET_RE.test(String(password || ''))) {
    return send(res, 400, { error: 'invalid' });
  }

  const account = await loadAccount(address);
  // An address with no account and a wrong passcode get the same answer, so
  // this cannot be used to find out who has one. 连花掉的时间也对齐：有账号
  // 的那一路真的算一次 scrypt，没账号的这一路也烧同一份，别让快慢把答案说
  // 出去（burnGuess 的注释里写了这只是压小差距，不是消到零）。
  if (!account) {
    burnGuess(password);
    return send(res, 401, { error: 'wrong' });
  }

  const verdict = await checkPin(address, String(password), account);
  if (verdict === 'blocked') return send(res, 423, { error: 'blocked' });
  if (verdict === 'locked') {
    return send(res, 423, { error: 'locked', retryInMs: lockRemainingMs(account) });
  }
  if (verdict !== 'ok') return send(res, 401, { error: 'wrong' });

  rotateToken(account);
  await saveAccount(address, account);
  return send(res, 200, entitlementOf(account, address));
}

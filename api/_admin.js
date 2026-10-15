import { createHash, timingSafeEqual } from 'node:crypto';
import { send } from './_creem.js';

/**
 * ADMIN_TOKEN 的比对，`mint.js`、`scores.js` 共用这一份（10-15 补充 S7，L-4 ⑨）。
 *
 * 原先两处各抄一份，函数体逐行相同，旁边各写一句「和那边一字不差（同一把锁）」——这种话只在写下的那一天成立：
 * 哪天调一边（比如改最短长度），另一边照旧按老规矩开门，而两边守的是同一扇后门。
 */

/**
 * ADMIN_TOKEN 至少要多长（10-11 方案 A-11）。它背后是「无限发码」「导出全部玩家邮箱」「重建 / 清空
 * 排行榜」，短了就是能猜的。CLAUDE.md 一直写着「至少 32 个随机字符」，可从前代码里只要非空就收。
 */
export const ADMIN_TOKEN_MIN = 32;

const digest = (s) => createHash('sha256').update(String(s), 'utf8').digest();

/**
 * 比对 ADMIN_TOKEN：'ok' | 'wrong' | 'short'。
 *
 * **两边先各做一次 sha256，再 timingSafeEqual**（10-11 方案 A-11）。原先是「长度不等就 false，等长
 * 才逐字节比」：
 *   · 光是长度那一句就把令牌的长度送了出去——不等长立刻答 401；
 *   · 更糟的是 `Buffer.from(given)` 按 UTF-8 编码：交一串和真令牌**字符数**相同、却含多字节字符的
 *     东西，两个 Buffer 字节数不同，timingSafeEqual 当场抛异常、回 500——500 和 401 一对照，令牌
 *     有几个字符就量出来了（10-11 实测）。
 * 两边都换成 32 字节的摘要之后，比较的永远是两个等长的东西：不抛、不早退，什么都量不出来。
 *
 * 'short'：服务器上配的那一把短于 ADMIN_TOKEN_MIN（没配也算）。调用方一律答 503、日志写一句
 * 「ADMIN_TOKEN 太短」——**不打印值**。宁可把后台关掉，也不拿一把能猜的锁守着它。
 */
export function adminToken(given) {
  const want = process.env.ADMIN_TOKEN || '';
  if (want.length < ADMIN_TOKEN_MIN) return 'short';
  if (typeof given !== 'string') return 'wrong';
  return timingSafeEqual(digest(given), digest(want)) ? 'ok' : 'wrong';
}

/** 管理动作共用：令牌不过关就替调用方把话答了（503 adminToken / 401 wrong），返回 true；过关返回 false。 */
export function adminRefused(res, given) {
  const verdict = adminToken(given);
  if (verdict === 'short') {
    console.error('ADMIN_TOKEN 太短');
    send(res, 503, { error: 'adminToken' });
    return true;
  }
  if (verdict !== 'ok') {
    send(res, 401, { error: 'wrong' });
    return true;
  }
  return false;
}

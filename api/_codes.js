import { randomInt } from 'node:crypto';
import { msetnx } from './_store.js';

/**
 * Minting 「Slides 天才内部码」.
 *
 * Shared by the places codes are made, so they all write the same document
 * under the same key shape and /api/redeem never has to know which one made
 * the code it is being handed. Today that is only the minting page (a batch
 * asked for by hand); the two a yearly subscriber used to be given
 * automatically stopped being minted in 10-09 补充方案 7-15 (see the note above
 * liveGifts in _accounts.js).
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
 * 一批最多造几张（10-08 方案第五批第 2 条：「单批上限 50 张」）。api/mint.js 的单次上限就是它。
 *
 * 一批是一条 MSETNX：五十张码、一百个参数，请求体几 KB，一次往返。原先一次能要两百张，每张两次
 * 往返（四百次），管理员在手机上发一批大的，函数跑满时限被掐掉——掐在半路的那一批，已经写进库
 * 的那些码谁也不知道（回包没发出去），等于一批孤儿码。
 */
export const MINT_BATCH_MAX = 50;

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
 * unused one would be, so it is ruled out rather than assumed.
 *
 * 一步写入（10-08 方案第五批第 2 条）：整批码一条 MSETNX 写进去——**一张都不在库里才全写，有一
 * 张撞上了就一张都不写**，换一整批新的再来。原先是一张一张「先 GET 看有没有人、再 SET」，两
 * 步之间隔着一次往返，查了也只是「刚才没人」。超过 MINT_BATCH_MAX 的部分不造（调用方自己
 * 照这个数封顶，见 api/mint.js）。四轮都撞上（实际不会发生）就回空数组，不半批交差。
 */
export async function mintCodes(plan, count, expiresAt, extra = {}) {
  const wanted = Math.min(MINT_BATCH_MAX, Math.max(0, Math.floor(count)));
  if (!wanted) return [];
  const doc = {
    plan,
    mintedAt: Date.now(),
    ...(expiresAt ? { expiresAt } : {}),
    ...extra,
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    const batch = new Set();
    while (batch.size < wanted) batch.add(oneCode());
    const codes = [...batch];
    if (await msetnx(codes.map((code) => [codeKey(code), doc]))) return codes;
  }
  return [];
}

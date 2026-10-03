/**
 * 种子码——服务器这一份（第 19 推）。
 *
 * **和 src/engine/seedCode.ts 是同一套算法的两份抄本**：那边给浏览器用（TypeScript），这
 * 边给 api/ 用（纯 JS，不过 tsc，也不能 import src/ 下面的 .ts）。服务器要它只为一件事：
 * 每日挑战的成绩报上来时，**自己**算出那一天的种子码去核对——客户端说「我打的是 10 月 3 日
 * 的每日挑战」，服务器不信这句话，信它自己算的那串码（scores.js 的 push）。
 *
 * 两份走散了的后果不报错：那一天的每一局都被服务器当成「伪造的每日」拒掉，今日榜上一个
 * 人都没有。门 check-seed-code 拿两边算同一批天、同一批码，一个数对不上就红。**改那边一
 * 定要一起改这边**，反过来也一样。
 *
 * 字段、编码、校验、每日轮换的说明都在那边的文件头，这儿不再抄一遍。
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const DEAL_VERSION = 1;
const RAND_SPAN = 2 ** 27;

/**
 * 编号表——和 seedCode.ts 的 VARIANTS 一行对一行（下标就是写进码里的那 5 位）。服务器要它只为
 * 一件事：每日挑战那一局报上来的是不是**那一天的那个玩法、那副棋盘**（scores.js 的 pushDaily）。
 * 只核对码不核对玩法的话，有人拿当天那串码、报一局别的（更好打的）玩法上来，照样进今日榜。
 */
export const VARIANTS = [
  ['base', 'square'],
  ['base', 'circle'],
  ['base', 'squareDiamond'],
  ['base', 'circleHex'],
  ['base', 'circleSeven'],
  ['base', 'triangleBig'],
  ['timed', 'square'],
  ['timed', 'circle'],
  ['bomb', 'square'],
  ['bomb', 'circle'],
  ['bombTimed', 'square'],
  ['bombTimed', 'circle'],
  ['bombAdv', 'squareDiamond'],
  ['bombAdv', 'circleHex'],
  ['slot', 'square'],
  ['slot', 'circle'],
  ['flip', 'square'],
  ['flip', 'circle'],
  ['puzzle', 'square'],
  ['puzzle', 'circle'],
].map(([mode, board]) => ({ mode, board }));

/**
 * 一局报上来的是编号表里的哪一种玩法（seedCode.ts 的 variantForGame 那一段，同一个判断）：
 * 存档里只有 modeKey、棋盘 id 和老虎机那个标记；进阶炸弹的 modeKey 和基础炸弹一样是 'bomb'，
 * 分开它们的是棋盘。
 */
export function seedModeOf(modeKey, board, slot) {
  const advanced = board === 'squareDiamond' || board === 'circleHex';
  return slot ? 'slot' : modeKey === 'bomb' && advanced ? 'bombAdv' : String(modeKey || 'base');
}

/** 每日轮换的那二十个编号——和 seedCode.ts 的 DAILY_ROTATION 一字不差。 */
export const DAILY_ROTATION = [0, 17, 8, 4, 10, 3, 18, 15, 6, 11, 2, 9, 14, 7, 12, 1, 16, 13, 5, 19];
/** 编号表有几行（seedCode.ts 的 VARIANTS.length）。 */
export const VARIANT_COUNT = VARIANTS.length;

function crc5(value, bits) {
  let reg = 0;
  for (let i = bits - 1; i >= 0; i--) {
    const bit = Math.floor(value / 2 ** i) % 2;
    const top = (reg >> 4) & 1;
    reg = (reg << 1) & 0x1f;
    if (top ^ bit) reg ^= 0x05;
  }
  return reg;
}

export function encodeSeed(version, variant, rand) {
  const data = (version % 8) * 2 ** 32 + (variant % 32) * 2 ** 27 + (Math.floor(rand) % RAND_SPAN);
  let n = data * 32 + crc5(data, 35);
  let out = '';
  for (let i = 0; i < 8; i++) {
    out = ALPHABET[n % 32] + out;
    n = Math.floor(n / 32);
  }
  return out;
}

export function normalizeSeed(input) {
  const s = String(input ?? '')
    .toUpperCase()
    .replace(/[\s\-_]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (s.length !== 8) return null;
  for (const ch of s) if (ALPHABET.indexOf(ch) < 0) return null;
  return s;
}

export function hash32(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

const DAY_MS = 86_400_000;
const BEIJING_MS = 8 * 3_600_000;

/** 那一天北京时间零点的时间戳（UTC 毫秒）。 */
export function dayStartOf(dayIndex) {
  return dayIndex * DAY_MS - BEIJING_MS;
}

export function dayIndexOf(now) {
  return Math.floor((now + BEIJING_MS) / DAY_MS);
}

export function dayKey(dayIndex) {
  const t = new Date(dayIndex * DAY_MS);
  return `${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, '0')}${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** YYYYMMDD → 第几天；不是一个真日期就 null。 */
export function dayIndexOfKey(key) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(key ?? ''));
  if (!m) return null;
  const idx = Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
  return dayKey(idx) === key ? idx : null;
}

export function dailyVariant(dayIndex) {
  const n = DAILY_ROTATION.length;
  return DAILY_ROTATION[((dayIndex % n) + n) % n];
}

export function dailySeed(dayIndex) {
  return encodeSeed(DEAL_VERSION, dailyVariant(dayIndex), hash32('daily:' + dayIndex) % RAND_SPAN);
}

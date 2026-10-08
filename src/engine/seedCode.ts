/**
 * 种子码（第 19 推 19a）：一串 8 位的码，说清「哪个玩法、哪副棋盘、哪一副牌」。
 *
 *   显示：XXXX-XXXX（Crockford base32，大小写不敏感，O 当 0、I 和 L 当 1）
 *   40 位：发牌版本 3 位 ＋ 玩法/棋盘编号 5 位 ＋ 随机数 27 位 ＋ 校验 5 位
 *
 * 每一局单人游戏都用种子发牌（gameController 的 newGame 在发牌之前 `seedRandom('s1:' +
 * 码)`），所以同一串码在任何一台设备上发出来的都是同一副牌——这就是「输入种子」和「每
 * 日挑战」能成立的全部理由：牌不用传，每台设备照着码自己发，发不出另一副来。
 *
 * ── 为什么是这几段 ────────────────────────────────────────────
 *
 * · **发牌版本**：发牌的写法（rng.ts 的流、每副棋盘怎么从流里取色）哪天改了，同一串
 *   码就发出另一副牌——旧码得认得出来是旧的，说一句「这个种子已过期」，而不是悄悄发一
 *   副别的牌冒充。3 位，够改 7 次。
 * · **玩法/棋盘编号**：码自己知道是哪一局，输进去直接开那一局，不用再问「哪个玩法」。
 *   编号表（VARIANTS）**只增不改**：一行定了就是那个意思，换掉一行等于让所有发出去的码
 *   换了意思。5 位，最多 32 行，现在用了 20 行。
 * · **随机数**：真正决定是哪副牌的那 27 位（一亿三千多万种）。
 * · **校验**：CRC-5（x⁵ + x² + 1）。一个字符正好是连续的 5 位，CRC-5 拦得住任意一个
 *   字符抄错（长度 ≤ 5 的连续错位它一个都不漏）；相邻两个字符抄反，理论上拦下 31/32
 *   （check-seed-code 抽了两千多种抄反逐个试，实测一个没漏）。
 *
 * ── 为什么不用 BigInt、不用位运算 ──────────────────────────────
 *
 * 40 位超过了 JS 位运算的 32 位，而小红书那一端跑在 Chrome 61 上，没有 BigInt。所以全
 * 程用普通的 Number 做乘除（40 位远小于 2⁵³，算得准）。
 *
 * ── 服务器那一份 ──────────────────────────────────────────────
 *
 * 每日挑战的成绩要进「今日」榜，服务器得**自己**算出当天那串码去核对（api/_seedcode.js）。
 * 那边是纯 JS，不过 tsc，所以同一套算法在那儿抄了一份；门 check-seed-code 拿两边算同一批
 * 天、同一批码，一个数对不上就红。改这儿一定要一起改那儿。
 */

/** Crockford base32：去掉了 I L O U 的 32 个字符。 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * 发牌版本。改了发牌的写法（rng.ts 的流、哪一副棋盘从流里取东西的顺序）就加一——旧码
 * 从此报「已过期」，不会悄悄发出另一副牌。
 */
export const DEAL_VERSION = 1;

/** 种子流的前缀：rng.ts 那条流用 `'s1:' + 码` 起头（方案原话）。 */
export const DEAL_PREFIX = 's1:';

/**
 * 一局是什么：玩法 ＋ 棋盘。
 *
 * mode 的几个值和 RunData.modeKey 同名（runRecord.ts），另加三个 modeKey 说不出的：
 * 'bombAdv'（进阶炸弹，modeKey 是 'bomb'，棋盘不一样）、'slot'（老虎机，modeKey 是
 * 'base'）。
 */
export type SeedMode = 'base' | 'timed' | 'bomb' | 'bombTimed' | 'bombAdv' | 'slot' | 'flip' | 'puzzle';
export interface SeedVariant {
  mode: SeedMode;
  /** 棋盘的 id（shapes/*.ts 的 card.id）。 */
  board: string;
}

/**
 * **只增不改。** 下标就是写进码里的那 5 位——换掉一行，等于让所有已经发出去、已经写在分
 * 享卡上的码换了意思。新玩法、新棋盘一律接在最后。
 */
export const VARIANTS: readonly SeedVariant[] = [
  { mode: 'base', board: 'square' }, //            0
  { mode: 'base', board: 'circle' }, //            1
  { mode: 'base', board: 'squareDiamond' }, //     2
  { mode: 'base', board: 'circleHex' }, //         3
  { mode: 'base', board: 'circleSeven' }, //       4
  { mode: 'base', board: 'triangleBig' }, //       5
  { mode: 'timed', board: 'square' }, //           6
  { mode: 'timed', board: 'circle' }, //           7
  { mode: 'bomb', board: 'square' }, //            8
  { mode: 'bomb', board: 'circle' }, //            9
  { mode: 'bombTimed', board: 'square' }, //      10
  { mode: 'bombTimed', board: 'circle' }, //      11
  { mode: 'bombAdv', board: 'squareDiamond' }, // 12
  { mode: 'bombAdv', board: 'circleHex' }, //     13
  { mode: 'slot', board: 'square' }, //           14
  { mode: 'slot', board: 'circle' }, //           15
  { mode: 'flip', board: 'square' }, //           16
  { mode: 'flip', board: 'circle' }, //           17
  { mode: 'puzzle', board: 'square' }, //         18
  { mode: 'puzzle', board: 'circle' }, //         19
];

/** 这一局在表里是第几行；表里没有（不该发生）就 -1。 */
export function variantIndex(mode: SeedMode, board: string): number {
  return VARIANTS.findIndex((v) => v.mode === mode && v.board === board);
}

/**
 * 一局开出来之后，它是表里的哪一种玩法——棋盘那头只知道 modeKey（runRecord.ts 那一套）、
 * 棋盘 id 和是不是老虎机。进阶炸弹的 modeKey 和基础炸弹一样是 'bomb'，分开它们的是棋盘
 * （菱形方块、六边形小球只有进阶炸弹那一档用）。服务器那一份是 api/_seedcode.js 的同名函数，
 * 两份一个判断（check-seed-code ⑧ 每一行都对过）。
 *
 * 开局倒数页按它挑图（ui/modeIcons.ts 的 iconFor，10-08 方案 3-F-4）：倒数页那张图和第二层
 * 按下去的那一格是同一张，靠的就是两头说的是表里同一种玩法。
 */
export function seedModeOf(modeKey: string, board: string, slot: boolean): SeedMode {
  const advanced = board === 'squareDiamond' || board === 'circleHex';
  return slot ? 'slot' : modeKey === 'bomb' && advanced ? 'bombAdv' : (modeKey as SeedMode);
}

/** 一局开出来之后，它在表里是第几行（玩法按 seedModeOf 认）。 */
export function variantForGame(modeKey: string, board: string, slot: boolean): number {
  return variantIndex(seedModeOf(modeKey, board, slot), board);
}

/**
 * 这一局的种子是从哪儿来的（RunData.seedSource）：
 *   random  —— 平常开的一局，随手抽的（「再来一局」换一串新的）；
 *   entered —— 玩家自己敲进来的（「再来一局」还是这一串）；
 *   daily   —— 每日挑战（「再来一局」还是这一串）；
 *   room    —— 小屋那一局，由房间给的种子换算出来（main.ts 的小屋那一路）。
 */
export type SeedSource = 'random' | 'entered' | 'daily' | 'room';

/** 一局带着的种子。 */
export interface SeedRun {
  /** 规范的 8 个字符（不带横杠）。 */
  code: string;
  source: SeedSource;
  /** 每日挑战那一天的日期键 YYYYMMDD。 */
  daily?: string;
  /**
   * 不把这串码印出来（小屋老虎机「各抽各的」：牌是同一副，目标各人不同——这串码输进去
   * 只能还原牌、还原不了他那个目标，印出来就是在骗人，方案原话「不显示」）。
   */
  hideCode?: boolean;
}

const RAND_BITS = 27;
const RAND_SPAN = 2 ** RAND_BITS;

/** CRC-5（多项式 x⁵ + x² + 1，0b100101），对 `bits` 位的数从高位往低位算。 */
function crc5(value: number, bits: number): number {
  let reg = 0;
  for (let i = bits - 1; i >= 0; i--) {
    const bit = Math.floor(value / 2 ** i) % 2;
    const top = (reg >> 4) & 1;
    reg = (reg << 1) & 0x1f;
    if (top ^ bit) reg ^= 0x05;
  }
  return reg;
}

/** 三段拼成 40 位的码（不带横杠，8 个字符）。 */
export function encodeSeed(version: number, variant: number, rand: number): string {
  const data = (version % 8) * 2 ** 32 + (variant % 32) * 2 ** 27 + (Math.floor(rand) % RAND_SPAN);
  let n = data * 32 + crc5(data, 35);
  let out = '';
  for (let i = 0; i < 8; i++) {
    out = ALPHABET[n % 32] + out;
    n = Math.floor(n / 32);
  }
  return out;
}

/** 玩家敲进来的那一串 → 规范的 8 个字符；不是 8 个合法字符就 null。 */
export function normalizeSeed(input: string): string | null {
  const s = String(input ?? '')
    .toUpperCase()
    .replace(/[\s\-_]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (s.length !== 8) return null;
  for (const ch of s) if (ALPHABET.indexOf(ch) < 0) return null;
  return s;
}

/** 显示用：XXXX-XXXX。 */
export function formatSeed(code: string): string {
  return code.slice(0, 4) + '-' + code.slice(4, 8);
}

export type DecodedSeed =
  | { ok: true; code: string; version: number; variant: number; rand: number }
  | { ok: false; reason: 'format' | 'check' | 'version' | 'newer' | 'variant' };

/**
 * 认一串码。四种认不出来的：
 *   format  —— 不是 8 个合法字符；
 *   check   —— 校验位对不上（抄错了一个字符，或者两个字符抄反了）；
 *   version —— 校验对，可它是旧的发牌版本发出来的（「这个种子已过期」）；
 *   newer   —— 校验对，可它是**更新**的发牌版本发出来的（新版本发的码拿到还没更新的客户端
 *              上——那不是过期，说「过期」是在冤枉那串码）；
 *   variant —— 校验对、版本对，可编号在表里没有（同上，新版本加了一行玩法）。
 */
export function decodeSeed(input: string): DecodedSeed {
  const code = normalizeSeed(input);
  if (!code) return { ok: false, reason: 'format' };
  let n = 0;
  for (const ch of code) n = n * 32 + ALPHABET.indexOf(ch);
  const check = n % 32;
  const data = Math.floor(n / 32);
  if (crc5(data, 35) !== check) return { ok: false, reason: 'check' };
  const version = Math.floor(data / 2 ** 32);
  const variant = Math.floor(data / 2 ** 27) % 32;
  const rand = data % RAND_SPAN;
  if (version < DEAL_VERSION) return { ok: false, reason: 'version' };
  if (version > DEAL_VERSION) return { ok: false, reason: 'newer' };
  if (!VARIANTS[variant]) return { ok: false, reason: 'variant' };
  return { ok: true, code, version, variant, rand };
}

/** 一局随手发的种子：这个玩法、这副棋盘，随机数现抽。 */
export function randomSeed(variant: number, rand: () => number = Math.random): string {
  return encodeSeed(DEAL_VERSION, variant, Math.floor(rand() * RAND_SPAN));
}

/** rng.ts 那条流用的字符串。 */
export function dealSeed(code: string): string {
  return DEAL_PREFIX + code;
}

/**
 * 字符串 → 32 位（xmur3，和 rng.ts 的 hashSeed 是同一个算法）。每日挑战的随机数和小屋
 * 的种子码都从这儿来；服务器那一份（api/_seedcode.js）抄的也是它。
 */
export function hash32(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/**
 * 小屋那一局的种子码（方案：「用 match.seed 换算出种子码显示」）。小屋本来用房间给的
 * 那串字符串直接种流；第 19 推起它先换算成一串种子码，再照单人局的规矩种——于是分享卡
 * 上那串码输进去，发出来的就是小屋那一副牌。
 */
export function roomSeed(matchSeed: string, variant: number): string {
  return encodeSeed(DEAL_VERSION, variant, hash32('room:' + matchSeed) % RAND_SPAN);
}

// ── 每日挑战（19b）────────────────────────────────────────────

const DAY_MS = 86_400_000;
const BEIJING_MS = 8 * 3_600_000;

/**
 * 北京时间的第几天（方案：固定 UTC+8，不用 Intl）。`now` 是毫秒时间戳——网页端传服务器
 * 时间（room.ts 的 serverTime），小红书传本机时间。
 */
export function dayIndexOf(now: number): number {
  return Math.floor((now + BEIJING_MS) / DAY_MS);
}

/** 那一天北京时间零点的时间戳（UTC 毫秒）。 */
export function dayStartOf(dayIndex: number): number {
  return dayIndex * DAY_MS - BEIJING_MS;
}

/** 那一天的北京日期：年、月（1–12）、日、星期（1＝周一 … 7＝周日）。 */
export function beijingDate(dayIndex: number): { y: number; m: number; d: number; weekday: number } {
  const t = new Date(dayIndex * DAY_MS); // 读 UTC 那几位，正好是北京的日历日
  const wd = t.getUTCDay(); // 0＝周日
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), weekday: wd === 0 ? 7 : wd };
}

/** 排行榜和存档用的日期键：YYYYMMDD。 */
export function dayKey(dayIndex: number): string {
  const { y, m, d } = beijingDate(dayIndex);
  return `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
}

/** YYYYMMDD → 第几天；不是一个真日期就 null。 */
export function dayIndexOfKey(key: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(key ?? ''));
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const idx = Math.floor(t / DAY_MS);
  return dayKey(idx) === key ? idx : null;
}

/**
 * 每日挑战轮换的玩法池：**所有玩法和棋盘都进池**（方案原话），二十天一圈。顺序是有意排
 * 的（搜出来的一个排列，首尾也接得上）：挨着的两天**不是同一个玩法**（炸弹那三档算一个）、
 * **不是同一族棋盘**（方块和菱形方块算一族，三种小球算一族）——今天打了方块，明天一定不
 * 是方块。
 *
 * **只增不改**：在中间插一行，从那天起往后每一天的挑战都换了，而那几天的「今日」榜、
 * 分享卡上的「每日 MM/DD」都对不上了。要加就接在最后。门 check-seed-code 量着「二十个
 * 编号一个不少、一个不重」和上面那两条「挨着的两天」。
 */
export const DAILY_ROTATION: readonly number[] = [
  0, 17, 8, 4, 10, 3, 18, 15, 6, 11, 2, 9, 14, 7, 12, 1, 16, 13, 5, 19,
];

/** 那一天的玩法。 */
export function dailyVariant(dayIndex: number): number {
  const n = DAILY_ROTATION.length;
  return DAILY_ROTATION[((dayIndex % n) + n) % n];
}

/** 那一天的种子码（方案：`variant = rotation[dayIndex % N]`、`rng = hash('daily:' + dayIndex)`）。 */
export function dailySeed(dayIndex: number): string {
  return encodeSeed(DEAL_VERSION, dailyVariant(dayIndex), hash32('daily:' + dayIndex) % RAND_SPAN);
}

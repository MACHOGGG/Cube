/**
 * 排行榜三行筛选的规则（10-31 方案推14 Z-B15，lb-filter §9.3，按 §10 改；站长 10-22 原话：「化简排行榜……第一栏是 方块、
 * 小球、三角；然后是 Pro 和普通；然后是不同玩法……也可以自选某几行。比如点击了三角，玩法的部分就是灰色的不能点开」）。
 *
 * 纯函数，不碰 DOM——界面（ui/leaderboard.ts）只管画，点一下变成什么、哪颗灰、要说哪句话都在这儿；门
 * （scripts/check-lb-cells.mjs）穷举所有选择 × 每颗药丸点一下来量它，并且对上服务端那一份（api/scores.js 的 LB_CELLS）。
 *
 * 记号：F / T / M = 三行已选集合，空数组 = 「全部」（∗）。
 *   · 结果榜 = { 族 f 里的棋盘 b、玩法 k、普通/Pro t ：f∈F、k∈M、t∈T，且 (b, k) 这一格存在 }；
 *   · 点「全部」：这一行回 ∗；这一行是 ∗ 时点 c：变成 {c}；已有选择时点没选的 c：加上；点已选的 c：去掉，空了回 ∗；
 *     **一行每一颗都选上了就收回 ∗**（有灰药丸的行永远不会因此收回：灰的点不上）；
 *   · 变灰（只对照另外两行）：族 c 灰 ⟺ M ≠ ∗ 且 c 这一族的玩法和 M 没有交集；玩法 m 灰 ⟺ F ≠ ∗ 且 F 里没有一族有 m；
 *     第二行永远不灰；「全部」永远不灰；**已选的不画成灰**；
 *   · 点灰的那颗：不选中，三行下面出一句（玩法灰 rankGreyMode、族灰 rankGreyFamily）；
 *   · 已选但对结果没有贡献的药丸（例 F={方块, 三角}、M={炸弹} 里的三角）保留选中，表头加 rankPartialNote；
 *   · 唯一会变空的那一步（F 里只剩三角、M 没有基础）：照常去掉，**玩法行回 ∗**，出 rankResetNote。
 */
import { VARIANTS } from './seedCode';

export type LbFamily = 'square' | 'circle' | 'triangle';
export type LbTier = 'normal' | 'pro';
export type LbMode = 'base' | 'timed' | 'bomb' | 'slot' | 'flip' | 'puzzle';
export type LbRow = 'families' | 'tiers' | 'modes';

export const LB_FAMILIES: readonly LbFamily[] = ['square', 'circle', 'triangle'];
export const LB_TIERS: readonly LbTier[] = ['normal', 'pro'];
export const LB_MODES: readonly LbMode[] = ['base', 'timed', 'bomb', 'slot', 'flip', 'puzzle'];
const ROW_ALL: Readonly<Record<LbRow, readonly string[]>> = { families: LB_FAMILIES, tiers: LB_TIERS, modes: LB_MODES };

/** 棋盘 → 族（和服务端 api/scores.js 的 FAMILY_OF 同一张表）。 */
export const LB_FAMILY_OF: Readonly<Record<string, LbFamily>> = Object.freeze({
  square: 'square',
  squareDiamond: 'square',
  circle: 'circle',
  circleHex: 'circle',
  circleSeven: 'circle',
  triangleBig: 'triangle',
});
/** 编号表里的玩法 → 榜上的玩法（定时炸弹、进阶炸弹并进炸弹）。 */
const MODE_OF_VARIANT: Readonly<Record<string, LbMode>> = Object.freeze({
  base: 'base', timed: 'timed', bomb: 'bomb', bombTimed: 'bomb', bombAdv: 'bomb', slot: 'slot', flip: 'flip', puzzle: 'puzzle',
});

/** 「族 × 玩法 → 棋盘」：由 VARIANTS 推出（例：方块 × 炸弹 → 经典方块、菱形方块）。 */
export const LB_CELLS: Readonly<Record<LbFamily, Partial<Record<LbMode, readonly string[]>>>> = (() => {
  const out: Record<LbFamily, Partial<Record<LbMode, string[]>>> = { square: {}, circle: {}, triangle: {} };
  for (const v of VARIANTS) {
    const f = LB_FAMILY_OF[v.board];
    const m = MODE_OF_VARIANT[v.mode];
    if (!f || !m) continue;
    const list = (out[f][m] ??= []);
    if (!list.includes(v.board)) list.push(v.board);
  }
  return out;
})();

export interface LbSelection {
  families: readonly LbFamily[];
  tiers: readonly LbTier[];
  modes: readonly LbMode[];
}

/** 每次打开都是「全部 · 全部 · 全部」（不记上次的选择）。 */
export const DEFAULT_SELECTION: LbSelection = Object.freeze({ families: [], tiers: [], modes: [] });

/** 规范化：去重、按白名单次序排、一行全选上收成 ∗（和服务端 parseSelection 同一条，缓存键才对得上）。 */
export function normalize(sel: LbSelection): LbSelection {
  const one = <T extends string>(row: LbRow, v: readonly T[]): T[] => {
    const all = ROW_ALL[row] as readonly T[];
    const kept = all.filter((x) => v.includes(x));
    return kept.length === all.length ? [] : kept;
  };
  return { families: one('families', sel.families), tiers: one('tiers', sel.tiers), modes: one('modes', sel.modes) };
}

/** 缓存键：`[]`、全集、乱序得到同一个键。 */
export function selectionKey(sel: LbSelection): string {
  const n = normalize(sel);
  return `${n.families.join(',')}|${n.tiers.join(',')}|${n.modes.join(',')}`;
}

const pick = <T>(v: readonly T[], all: readonly T[]): readonly T[] => (v.length ? v : all);

/** 这一族有哪些玩法。 */
export const modesOf = (f: LbFamily): LbMode[] => LB_MODES.filter((m) => (LB_CELLS[f][m]?.length ?? 0) > 0);

/** 结果榜：每一格 { board, mode, tier }。 */
export function expand(sel: LbSelection): { board: string; mode: LbMode; tier: LbTier }[] {
  const out: { board: string; mode: LbMode; tier: LbTier }[] = [];
  for (const f of pick(sel.families, LB_FAMILIES)) {
    for (const m of pick(sel.modes, LB_MODES)) {
      for (const board of LB_CELLS[f][m] ?? []) {
        for (const tier of pick(sel.tiers, LB_TIERS)) out.push({ board, mode: m, tier });
      }
    }
  }
  return out;
}

/** 每颗药丸灰不灰（只对照另外两行；已选的不画成灰；第二行、「全部」永远不灰）。 */
export function greyed(sel: LbSelection): { families: Record<LbFamily, boolean>; tiers: Record<LbTier, boolean>; modes: Record<LbMode, boolean> } {
  const families = {} as Record<LbFamily, boolean>;
  for (const f of LB_FAMILIES) {
    const has = modesOf(f);
    families[f] = !sel.families.includes(f) && sel.modes.length > 0 && !sel.modes.some((m) => has.includes(m));
  }
  const modes = {} as Record<LbMode, boolean>;
  for (const m of LB_MODES) {
    modes[m] = !sel.modes.includes(m) && sel.families.length > 0 && !sel.families.some((f) => modesOf(f).includes(m));
  }
  return { families, tiers: { normal: false, pro: false }, modes };
}

/** 点了之后三行下面要说的那一句（界面按键名取当地的字）。 */
export type LbNote =
  | { key: 'rankGreyMode'; families: LbFamily[]; mode: LbMode }
  | { key: 'rankGreyFamily'; family: LbFamily }
  | { key: 'rankResetNote' };

/**
 * 点一下：回新选择和要说的那句话（没有就 null）。`chip` 是 'all' 或那一行的某一颗。
 */
export function tap(sel: LbSelection, row: LbRow, chip: string): { sel: LbSelection; note: LbNote | null } {
  const all = ROW_ALL[row];
  if (chip !== 'all' && !all.includes(chip)) return { sel, note: null };
  if (chip === 'all') return { sel: normalize({ ...sel, [row]: [] }), note: null };
  const cur = sel[row] as readonly string[];
  const g = greyed(sel);
  if (!cur.includes(chip)) {
    // 灰的那颗：不选中，说一句。
    if (row === 'modes' && g.modes[chip as LbMode]) {
      return { sel, note: { key: 'rankGreyMode', families: [...sel.families], mode: chip as LbMode } };
    }
    if (row === 'families' && g.families[chip as LbFamily]) {
      return { sel, note: { key: 'rankGreyFamily', family: chip as LbFamily } };
    }
  }
  const next = cur.includes(chip) ? cur.filter((x) => x !== chip) : [...cur, chip];
  let out = normalize({ ...sel, [row]: next } as LbSelection);
  // 唯一会变空的那一步（F 里只剩三角、M 没有基础）：照常去掉，玩法行回 ∗，说一句。
  if (!expand(out).length) {
    out = normalize({ ...out, modes: [] });
    return { sel: out, note: { key: 'rankResetNote' } };
  }
  return { sel: out, note: null };
}

/**
 * 已选但对结果没有贡献的族（例 F={方块, 三角}、M={炸弹} 里的三角）：表头那句 rankPartialNote 要它。没有就 null。
 * 回 { idle: 没贡献的那几族, others: 有贡献的那几族, modes: 选中的玩法 }。
 */
export function partialNote(sel: LbSelection): { idle: LbFamily[]; others: LbFamily[]; modes: LbMode[] } | null {
  if (!sel.families.length || !sel.modes.length) return null;
  const idle = sel.families.filter((f) => !sel.modes.some((m) => modesOf(f).includes(m)));
  if (!idle.length) return null;
  return { idle: [...idle], others: sel.families.filter((f) => !idle.includes(f)), modes: [...sel.modes] };
}

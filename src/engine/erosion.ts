/**
 * 侵蚀阶梯——《侵蚀阶梯》v1.2 §2。
 *
 * 一句话：**每翻一枚（含拆掉一枚炸弹），当前这一级的段数少一段；段数归零，得分
 * 图案就少一枚**：1×4 → 1×3 → 1×2 → 1×1。一步翻了好几枚、超出这一级剩下的段数
 * 时，多出来的**结转**到下一级接着扣（一步之内可以连降两级）。
 *
 * 为什么段数合计正好等于全盘枚数：三级的段数加起来 = N（见下面那张表，每一行都
 * 核过）。所以「擦完最后一段」和「全部棋子翻成星星」是同一件事——到 1 级的那一下
 * 记一枚「解锁 1 枚」徽章，但**不再翻任何东西**，徽章就只是徽章。
 *
 * 不吃侵蚀的只有《无限反转》（玩家 2026-09-27 拍板）：那一局翻过去还能翻回来，
 * 吃侵蚀的话几步就降到 1×1、随便一枚都得分，玩法当场塌了。它的图案永远停在开局
 * 那一级。
 */

/** 图案现在是几枚。开局 4，最小 1。 */
export type ErosionLevel = 4 | 3 | 2 | 1;

export interface ErosionTable {
  /** 三级各有几段：[4→3, 3→2, 2→1]。合计 = 全盘枚数。 */
  readonly seg: readonly [number, number, number];
  /** 基准步数 par = ceil(可用格数 ÷ 4 × 颜色数)，只在结算页的步数系数里用（§5）。 */
  readonly par: number;
}

/**
 * 通式（§2）：r = round(N/12)（0.5 进位），三级 = [N−r−max(1,r−1), r, max(1,r−1)]。
 *
 * 表里六副棋盘的字面值为准，这个通式只用来**校验**（check-erosion.mjs 逐行复
 * 算），以及给表里没有的棋盘兜底。
 */
export function ladderFor(tiles: number): readonly [number, number, number] {
  const r = Math.round(tiles / 12);
  const low = Math.max(1, r - 1);
  return [tiles - r - low, r, low];
}

/** par = ceil(可用格数 ÷ 4 × 颜色数)。 */
export function parFor(tiles: number, colors: number): number {
  return Math.ceil((tiles / 4) * colors);
}

/**
 * 六副棋盘的字面值（§2 那张表）。
 *
 * 键是棋盘 id（`ShapeCardMeta.id`）。表里没有的棋盘走通式兜底——眼下只有两副三角
 * （id `triangle` 与 `triangleAdvanced`），它们在 PR-6 里会被删掉。
 *
 * 六边圆球与七色圆球按表**直接上线**（玩家拍板），上线后按真实数据复核，本次不调。
 */
export const EROSION_TABLE: Readonly<Record<string, ErosionTable>> = {
  // 方块 36×6
  square: { seg: [31, 3, 2], par: 54 },
  // 小球 28×4
  circle: { seg: [25, 2, 1], par: 28 },
  // 菱形方块 36×6
  squareDiamond: { seg: [31, 3, 2], par: 54 },
  // 六边三角 54×6（天才限定）。**id 是 triangleBig，代码在 shapes/triangle.ts**
  // ——两副三角 2026-09 对调过身份，认 id 不认文件名（见 CLAUDE.md 那一条）。
  triangleBig: { seg: [45, 5, 4], par: 81 },
  // 六边圆球 36（可用）×6：中心那个永久空位不算可用格。
  circleHex: { seg: [31, 3, 2], par: 54 },
  // 七色圆球 49×7
  circleSeven: { seg: [42, 4, 3], par: 86 },
};

/** 这副棋盘的阶梯：表里有就照表，没有就按通式和颜色数现算。 */
export function tableFor(shapeId: string, tiles: number, colors: number): ErosionTable {
  return EROSION_TABLE[shapeId] ?? { seg: ladderFor(tiles), par: parFor(tiles, colors) };
}

export interface ErosionSpend {
  /** 这一下之后图案是几枚。 */
  level: ErosionLevel;
  /** 降了几级（0 = 没降）。跨级结转时可能是 2。 */
  dropped: number;
  /** 这一下之后，当前这一级还剩几段。 */
  segLeft: number;
  /** 本局是不是刚走到 1 枚（「解锁 1 枚」徽章，一局只记一次）。 */
  unlocked: boolean;
}

export interface Erosion {
  level(): ErosionLevel;
  segLeft(): number;
  /** 当前这一级一共几段（画刻度环要它，见 PR-7 的《得分图案》块）。 */
  segTotal(): number;
  par(): number;
  /** 本局到过 1 枚没有。 */
  unlocked(): boolean;
  /** 翻了 n 枚（含拆除）：扣段、必要时降级，多出来的结转。 */
  spend(n: number): ErosionSpend;
  /** 新的一局：回到 4 枚、第一级的段数满格、徽章清掉。 */
  reset(): void;
}

/**
 * @param table 这副棋盘的段数与基准
 * @param frozen 给 true 就永不降级（《无限反转》）：段照扣，图案不变。
 */
export function createErosion(table: ErosionTable, frozen = false): Erosion {
  let level: ErosionLevel = 4;
  let idx = 0; // 0 → 4→3 那一级，1 → 3→2，2 → 2→1
  let left = table.seg[0];
  let everUnlocked = false;

  function spend(n: number): ErosionSpend {
    let dropped = 0;
    let rest = Math.max(0, Math.floor(n));
    while (rest > 0 && level > 1) {
      if (rest < left) {
        left -= rest;
        rest = 0;
        break;
      }
      // 这一级的段扣光了：降一级，多出来的接着扣下一级（§2「超出段数结转」）。
      rest -= left;
      if (frozen) {
        // 无限反转：段扣完就停在这一级，不降级也不结转。
        left = 0;
        rest = 0;
        break;
      }
      idx += 1;
      level = (level - 1) as ErosionLevel;
      dropped += 1;
      left = table.seg[idx] ?? 0;
      if (level === 1) {
        everUnlocked = true;
        left = 0;
        rest = 0;
      }
    }
    return { level, dropped, segLeft: left, unlocked: everUnlocked };
  }

  return {
    level: () => level,
    segLeft: () => left,
    segTotal: () => (level === 1 ? 0 : (table.seg[idx] ?? 0)),
    par: () => table.par,
    unlocked: () => everUnlocked,
    spend,
    reset() {
      level = 4;
      idx = 0;
      left = table.seg[0];
      everUnlocked = false;
    },
  };
}

/**
 * 侵蚀阶梯——《侵蚀阶梯》v1.2 §2。
 *
 * 一句话：**每翻一枚（含拆掉一枚炸弹），当前这一级的段数少一段；段数归零，得分
 * 图案就少一枚**：1×4 → 1×3 → 1×2 → 1×1。一步翻了好几枚、超出这一级剩下的段数
 * 时，多出来的**结转**到下一级接着扣（一步之内可以连降两级）。
 *
 * **1×1 是真的一段，不是终点上的一枚徽章**（2026-10 二版，10-08 方案 3-A，玩家拍板方案
 * B）。三级段数加起来**小于**全盘枚数，差出来的那几枚（方块 4 枚、小球 3 枚、六边三角 8
 * 枚……）就是 1×1 那一段要翻的：图案只剩一枚，滑动的那一条线上没翻的每一枚都单独成组。
 *
 * 一版的不变量是「三级合计 = N」：擦完最后一段和全部棋子翻成星星是同一件事，到 1 级那
 * 一下盘上已经没东西可翻，「解锁 1 枚」只是一枚徽章；方块要翻满 31 枚才第一次降级。二版
 * 照玩家给的「15 步」把第一次降级提前到第 15 枚，1×1 也成了打得到的一段，这条不变量于是
 * 作废——到 1×1 ≠ 全盘翻完。到 1 级那一下照旧记「解锁 1 枚」徽章，控制器另外给一下和整
 * 线消除同一套的庆祝（见 gameController 的 bigMoment）。
 *
 * 不吃侵蚀的只有《无限反转》（玩家 2026-09-27 拍板）：那一局翻过去还能翻回来，
 * 吃侵蚀的话几步就降到 1×1、随便一枚都得分，玩法当场塌了。它的图案永远停在开局
 * 那一级。
 */

/** 图案现在是几枚。开局 4，最小 1。 */
export type ErosionLevel = 4 | 3 | 2 | 1;

export interface ErosionTable {
  /** 三级各有几段：[4→3, 3→2, 2→1]。合计**小于**全盘枚数，余下的是 1×1 那一段（见文件头）。 */
  readonly seg: readonly [number, number, number];
  /** 基准步数 par = ceil(可用格数 ÷ 4 × 颜色数)，只在结算页的步数系数里用（§5）。 */
  readonly par: number;
}

/**
 * 通式：三级约是 [0.42N, 0.30N, 0.17N]（各自四舍五入、至少 1 段），1×1 那一段至少留 3
 * 枚——小盘上四舍五入凑巧把余数吃到 3 以下时，从第一级里让出来。
 *
 * **只给表外的棋盘兜底，表为准**。它是新表的近似比例，不是新表的来历：方块、小球两行
 * 恰好算得一样，六边三角、七色圆球两行是玩家照手感单独定的（[20,15,11] 而不是通式的
 * [23,16,9]）。所以门（check-erosion.mjs）不再拿它逐行复算字面表——一版那条「通式 =
 * 表」在二版里不成立，也不该成立。
 */
export function ladderFor(tiles: number): readonly [number, number, number] {
  let a = Math.max(1, Math.round(tiles * 0.42));
  const b = Math.max(1, Math.round(tiles * 0.3));
  const c = Math.max(1, Math.round(tiles * 0.17));
  const spare = tiles - (a + b + c);
  if (spare < 3) a = Math.max(1, a - (3 - spare));
  return [a, b, c];
}

/** par = ceil(可用格数 ÷ 4 × 颜色数)。 */
export function parFor(tiles: number, colors: number): number {
  return Math.ceil((tiles / 4) * colors);
}

/**
 * 六副棋盘的字面值。**2026-10 二版，按真实局数据再校**（10-08 方案 3-A，玩家拍板方案 B）。
 *
 * 键是棋盘 id（`ShapeCardMeta.id`）。表里没有的棋盘走通式兜底。
 *
 * 每一行三个数依次是「翻满第几枚降到 1×3」「再翻几枚降到 1×2」「再翻几枚降到 1×1」，
 * 合计和全盘枚数的差就是 1×1 那一段能翻的枚数（行尾注释里那几个累计数，就是方案里的验
 * 收数，check-erosion.mjs 一枚一枚翻着核）。表计量的是**翻面枚数**，玩家原话是「15 步」
 * ——方块基础局两者基本重合；别的玩法实测解锁过早的话，**调表值，不改结构**。
 *
 * par 这一列和一版一样（《无限反转》的 frozen 豁免也没动）。
 */
export const EROSION_TABLE: Readonly<Record<string, ErosionTable>> = {
  // 方块 36×6：第 15 枚到 1×3、第 26 枚到 1×2、第 32 枚到 1×1，1×1 那一段翻 4 枚
  square: { seg: [15, 11, 6], par: 54 },
  // 小球 28×4：第 12 / 20 / 25 枚，1×1 那一段翻 3 枚
  circle: { seg: [12, 8, 5], par: 28 },
  // 菱形方块 36×6：同方块
  squareDiamond: { seg: [15, 11, 6], par: 54 },
  // 六边三角 54×6（天才限定）：第 20 / 35 / 46 枚，1×1 那一段翻 8 枚。**id 是 triangleBig，
  // 代码在 shapes/triangle.ts**——两副三角 2026-09 对调过身份，认 id 不认文件名（见 CLAUDE.md）。
  triangleBig: { seg: [20, 15, 11], par: 81 },
  // 六边圆球 36（可用）×6：同方块。中心那个永久空位不算可用格。
  circleHex: { seg: [15, 11, 6], par: 54 },
  // 七色圆球 49×7：第 18 / 32 / 42 枚，1×1 那一段翻 7 枚
  circleSeven: { seg: [18, 14, 10], par: 86 },
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

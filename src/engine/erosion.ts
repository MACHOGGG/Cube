/**
 * 侵蚀阶梯——《侵蚀阶梯》v1.2 §2，ero2 起按 F5（10-31 方案推14 Z-B02，站长 10-22 晚定 F5）。
 *
 * 一句话：**每翻一枚（含拆掉一枚炸弹），当前这一级的段数少一段；段数归零，得分
 * 图案就少一枚**：1×4 → 1×3 → 1×2，**到 2 枚为止**。一步翻了好几枚、超出这一级剩下
 * 的段数时，多出来的**结转**到下一级接着扣（一步之内可以连降两级）；降到这一局的最低
 * 级那一下，余数丢掉。
 *
 * **两级合计比满盘枚数少 2 枚以上**：最后几枚色块要两两凑对翻掉。站长原话：「可以不解锁
 * 1 枚……从 3 到 2 的解锁需要更多，然后 2 至 1 不存在」。基础局的最低级（floor）是 2，
 * 永远走不到 1 枚，所以基础局没有《解锁 1 枚》徽章（Z-B03）。
 *
 * **1×1 只留给老虎机**：老虎机照旧走 ero1 那张三段表（SLOT_TABLE，4 → 3 → 2 → 1，1×1 是真的
 * 一段），降到底那一下照旧记「降到底」徽章、照旧全盘重找（控制器 `if (hooks.slot)
 * stepper.rescanAll()`）。基础局降级**不重扫**：新图案从玩家接下来动到的地方算。
 *
 * 不吃侵蚀的只有《无限反转》（玩家 2026-09-27 拍板）：那一局翻过去还能翻回来，吃侵蚀的话
 * 几步就降到底、随便一对都得分，玩法当场塌了。它的图案永远停在开局那一级。Pro 局同样冻结
 * 在开局那一级，只在卡死时松一级（release，Z-B13）。
 */

/** 图案现在是几枚。开局 4，最小 1。 */
export type ErosionLevel = 4 | 3 | 2 | 1;

export interface ErosionTable {
  /**
   * 各级有几段：基础局两段 [4→3, 3→2]（F5），老虎机三段 [4→3, 3→2, 2→1]（SLOT_TABLE）。合计都**小于**全盘
   * 枚数（见文件头）。
   */
  readonly seg: readonly number[];
  /** 基准步数 par = ceil(可用格数 ÷ 4 × 颜色数)，只在结算页的步数系数里用（§5）。 */
  readonly par: number;
}

/**
 * 基础局的通式（F5，两段）：a = round(0.61N)、b = round(0.33N)（各自至少 1 段），余量 N − (a+b) 至少留 2 枚——小盘
 * 上四舍五入凑巧把余量吃到 2 以下时，从第一级里让出来。36 枚得 [22,12]，28 枚得 [17,9]，正好是方块、小球两行。
 *
 * **只给表外的棋盘兜底，表为准**（六边三角、七色两行是照手感单独定的）。
 */
export function ladderFor(tiles: number): readonly number[] {
  let a = Math.max(1, Math.round(tiles * 0.61));
  const b = Math.max(1, Math.round(tiles * 0.33));
  const spare = tiles - (a + b);
  if (spare < 2) a = Math.max(1, a - (2 - spare));
  return [a, b];
}

/**
 * 老虎机的通式：ero1 那一套三段（[0.42N, 0.30N, 0.17N]，1×1 那一段至少留 3 枚）。老虎机照旧一级一级降到 1 枚，
 * 表外的棋盘按它兜底（10-31 方案推14 Z-B02：原 ladderFor 改名留给老虎机）。
 */
export function ladder3For(tiles: number): readonly number[] {
  let a = Math.max(1, Math.round(tiles * 0.42));
  const b = Math.max(1, Math.round(tiles * 0.3));
  const c = Math.max(1, Math.round(tiles * 0.17));
  const spare = tiles - (a + b + c);
  if (spare < 3) a = Math.max(1, a - (3 - spare));
  return [a, b, c];
}

/** 基准步数的系数（F5 下 par ×1.2，rerun-f5 最终数）。服务器手抄的 par 一列（api/_maxscore.js 的 BOARD_LIMITS）跟着它。 */
export const PAR_FACTOR = 1.2;

/** par = ceil(ceil(可用格数 ÷ 4 × 颜色数) × 1.2)。表里六副都等于它（check-erosion ① 逐行核）。 */
export function parFor(tiles: number, colors: number): number {
  return Math.ceil(Math.ceil((tiles / 4) * colors) * PAR_FACTOR);
}

/** Pro 的基准步数 = 普通 par × 1.5（站长 D05 甲；计时、炸弹三档同一个系数）。服务器手抄 proPar 一列。 */
export const PRO_PAR_FACTOR = 1.5;
export const proParOf = (par: number): number => Math.ceil(par * PRO_PAR_FACTOR);

/**
 * 六副棋盘基础局的字面值（F5，站长 10-22 晚，10-31 方案推14 Z-B02）。
 *
 * 键是棋盘 id（`ShapeCardMeta.id`）。表里没有的棋盘走通式兜底。每一行两个数依次是「翻满第几枚降到 1×3」「再翻几枚
 * 降到 1×2」；行尾注释是方案里的验收数（check-erosion.mjs 一枚一枚翻着核）。之后图案停在 2 枚。
 */
export const EROSION_TABLE: Readonly<Record<string, ErosionTable>> = {
  // 方块 36×6：第 22 枚到 1×3、第 34 枚到 1×2
  square: { seg: [22, 12], par: 65 },
  // 小球 28×4：第 17 / 26 枚
  circle: { seg: [17, 9], par: 34 },
  // 菱形方块 36×6：同方块
  squareDiamond: { seg: [22, 12], par: 65 },
  // 六边三角 54×6：第 30 / 50 枚。**id 是 triangleBig，代码在 shapes/triangle.ts**——两副三角 2026-09 对调过身份，
  // 认 id 不认文件名（见 CLAUDE.md）。
  triangleBig: { seg: [30, 20], par: 98 },
  // 六边圆球 36（可用）×6：同方块。中心那个永久空位不算可用格。
  circleHex: { seg: [22, 12], par: 65 },
  // 七色圆球 49×7：第 27 / 44 枚
  circleSeven: { seg: [27, 17], par: 104 },
};

/**
 * 老虎机那一张表（照搬 ero1 现行那两行；老虎机不乘步数系数，par 不进分）。老虎机只开在方块、小球上。
 */
export const SLOT_TABLE: Readonly<Record<string, ErosionTable>> = {
  square: { seg: [15, 11, 6], par: 54 },
  circle: { seg: [12, 8, 5], par: 28 },
};

/** 这副棋盘基础局的阶梯：表里有就照表，没有就按通式和颜色数现算。 */
export function tableFor(shapeId: string, tiles: number, colors: number): ErosionTable {
  return EROSION_TABLE[shapeId] ?? { seg: ladderFor(tiles), par: parFor(tiles, colors) };
}

/** 老虎机的阶梯：表里有照表，没有按三段通式兜底。 */
export function slotTableFor(shapeId: string, tiles: number, colors: number): ErosionTable {
  return SLOT_TABLE[shapeId] ?? { seg: ladder3For(tiles), par: Math.ceil((tiles / 4) * colors) };
}

export interface ErosionSpend {
  /** 这一下之后图案是几枚。 */
  level: ErosionLevel;
  /** 降了几级（0 = 没降）。跨级结转时可能是 2。 */
  dropped: number;
  /** 这一下之后，当前这一级还剩几段。 */
  segLeft: number;
  /** 本局是不是到过 1 枚（老虎机的「降到底」徽章，一局只记一次；基础局封底 2，永远是 false）。 */
  unlocked: boolean;
}

export interface Erosion {
  level(): ErosionLevel;
  segLeft(): number;
  /** 当前这一级一共几段（画刻度环要它，见 PR-7 的《得分图案》块）。到了这一局的最低级是 0。 */
  segTotal(): number;
  par(): number;
  /** 本局到过 1 枚没有（只有老虎机走得到）。 */
  unlocked(): boolean;
  /** 翻了 n 枚（含拆除）：扣段、必要时降级，多出来的结转。 */
  spend(n: number): ErosionSpend;
  /**
   * 新的一局：回到 4 枚、第一级的段数满格、徽章清掉。`frozen` 给了就这一局按它（Pro 局冻结，10-31 方案推14 Z-B13）；
   * 不给就照构造时的那个（无限反转）。
   */
  reset(opts?: { frozen?: boolean }): void;
  /**
   * 松一级（只给 Pro 的卡死松级用，Z-B13）：还没到最低级就降一级、这一级剩下的段数记 0（不结转），回 true；到了
   * 最低级回 false。
   */
  release(): boolean;
}

/**
 * @param table 这副棋盘的段数与基准
 * @param frozen 给 true 就永不降级（《无限反转》）：段照扣，图案不变。
 * @param floor 这一局的最低级：缺省从表长推（两段表 → 2，三段表 → 1）；控制器另外显式传（基础局 2、老虎机 1）。
 */
export function createErosion(table: ErosionTable, frozen = false, floor: number = 4 - table.seg.length): Erosion {
  const bottom = Math.max(1, Math.min(4, Math.floor(floor))) as ErosionLevel;
  let level: ErosionLevel = 4;
  let idx = 0; // 0 → 4→3 那一级，1 → 3→2，2 → 2→1（只有三段表有）
  let left = table.seg[0] ?? 0;
  let everUnlocked = false;
  let frozenNow = frozen;

  function spend(n: number): ErosionSpend {
    let dropped = 0;
    let rest = Math.max(0, Math.floor(n));
    while (rest > 0 && level > bottom) {
      if (rest < left) {
        left -= rest;
        rest = 0;
        break;
      }
      // 这一级的段扣光了：降一级，多出来的接着扣下一级（§2「超出段数结转」）。
      rest -= left;
      if (frozenNow) {
        // 无限反转、Pro：段扣完就停在这一级，不降级也不结转。
        left = 0;
        rest = 0;
        break;
      }
      idx += 1;
      level = (level - 1) as ErosionLevel;
      dropped += 1;
      left = table.seg[idx] ?? 0;
      if (level === bottom) {
        // 降到这一局的最低级：余数丢掉（基础局停在 2 枚；老虎机到 1 枚）。
        if (level === 1) everUnlocked = true;
        left = 0;
        rest = 0;
      }
    }
    return { level, dropped, segLeft: left, unlocked: everUnlocked };
  }

  return {
    level: () => level,
    segLeft: () => left,
    segTotal: () => (level === bottom ? 0 : (table.seg[idx] ?? 0)),
    par: () => table.par,
    unlocked: () => everUnlocked,
    spend,
    reset(opts?: { frozen?: boolean }) {
      level = 4;
      idx = 0;
      left = table.seg[0] ?? 0;
      everUnlocked = false;
      frozenNow = opts && opts.frozen !== undefined ? opts.frozen : frozen;
    },
    release() {
      if (level <= bottom) return false;
      idx += 1;
      level = (level - 1) as ErosionLevel;
      // 不结转：松下来的这一级段数从 0 记（Pro 局本来就冻结，段扣不扣都不降级；段数环按新一级画）。
      left = 0;
      if (level === 1) everUnlocked = true;
      return true;
    },
  };
}

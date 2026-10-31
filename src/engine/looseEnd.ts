/**
 * 死后散边（10-31 方案推14 Z-B04）：收尾放开之后又判死时，最外面一条**很短、全是星星**的边不论颜色**一颗一颗**削掉，
 * 每颗 1 分、算进已清格数。
 *
 *   · 站长 10-19 定 F1（V11、V12）：五副外边棋盘一起改。为什么要它：三角格阵上最小的核每条边都是 3 枚——六边三角
 *     打到最后剩一个小六边形、颜色凑不齐时，原先 1.4 秒判死；现在一颗一颗削完、以「全部消完了」收场。
 *   · D28（10-25）：**一颗一颗削**——同一串连锁里把这条边削完，断口合上。挑出来的那一条，第一颗这一拍交，其余进队列，
 *     后面几拍先从队列里交（nextQueued）。
 *   · D68：**只写一份**，五副棋盘只各接几行线（findWholeLineBonuses 里）。推41（Z-K10）会把它收进 edgeFamily.ts。
 *   · 孤儿色块不削（orphan 10-25 定案 3）：剩下的是色块的局照旧判死、打九折（Z-B08）。
 *   · 活炸弹不许被削（isLooseStar 里由棋盘排除）；盘上只剩活炸弹时照现行规则判「全部消完了」。
 *
 * 「≤ EDGE_MIN 枚」是规则本身（常态门槛那个数）；规则书照 C-12（站长 10-29）不写数字，写成「很短、全是星星的边」。
 * 不写签名：散边削完那几格就离场了，不会被认第二次。纯函数＋小闭包，不碰 DOM。
 */
import { outerEdges, EDGE_MIN, EDGE_MIN_ENDGAME, type EdgeBoard } from './outerEdge';
import type { Cell } from './types';

export interface LooseEndBoard {
  edgeBoard: EdgeBoard;
  /** 这一格是星星、而且不是活炸弹（七色没有炸弹，只看 face）。 */
  isLooseStar(r: number, c: number): boolean;
  /** 门槛放到 EDGE_MIN_ENDGAME 时是不是判死（各棋盘的 stuckAt）。 */
  stuck(): boolean;
}

export interface LooseEnd {
  /** 队列里还有没削完的就先交一枚；没有回 null。 */
  nextQueued(): Cell[][] | null;
  /** 判死时挑一条：≤ EDGE_MIN 枚、全是星星（不含活炸弹）的最外边，最短的先；回第一枚，其余进队列。挑不到回 []。 */
  pick(): Cell[][];
  /** 队列里还剩几枚（finalGroupNext 要它：队列非空时只在「只剩一枚」才算最后一组）。 */
  pending(): number;
  /** 新的一局：清空队列。 */
  reset(): void;
}

export function createLooseEnd(b: LooseEndBoard): LooseEnd {
  let queue: Cell[] = [];

  function nextQueued(): Cell[][] | null {
    // 队列里的格子在同一串连锁里一颗一颗交；万一哪一颗已经不在了（不该发生），跳过它，不交一个空格子出去。
    while (queue.length) {
      const cell = queue.shift()!;
      if (b.edgeBoard.isLive(cell[0], cell[1]) && b.isLooseStar(cell[0], cell[1])) return [[cell]];
    }
    return null;
  }

  function pick(): Cell[][] {
    if (!b.stuck()) return [];
    let best: Cell[] | null = null;
    for (const { live } of outerEdges(b.edgeBoard, EDGE_MIN_ENDGAME)) {
      if (live.length > EDGE_MIN) continue;
      if (!live.every(([r, c]) => b.isLooseStar(r, c))) continue;
      if (!best || live.length < best.length) best = live;
    }
    if (!best || !best.length) return [];
    queue = best.slice(1);
    return [[best[0]]];
  }

  return {
    nextQueued,
    pick,
    pending: () => queue.length,
    reset() {
      queue = [];
    },
  };
}

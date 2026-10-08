import { cellKey, type Cell, type Tile } from './types';

export type BombTier = 'basic' | 'timed' | 'advanced';

/** Shared across every bomb-mode shape so the hazard reads as "the same red" everywhere. */
export const BOMB_RED_HEX = '#C63B3B';
/** Flat score penalty applied once a live red cluster reaches 4+ tiles. */
export const BOMB_HAZARD_PENALTY = 100;
/** The forceEnd() reason string every bomb shape passes on a hazard-cluster game over — gameController matches on this to know to show the 💥 background. */
export const BOMB_HAZARD_REASON = '红色炸弹相连';

/**
 * 炸弹这一套规则的版本号。
 *
 * 2026-09 改过两次：
 *
 *   1（起初）—— 一局里每一枚红块都是炸弹、永不翻面，活到最后要躲六枚。
 *   2 —— 炸弹挨着得分图案会被连带拆成星星，但**留一枚永久炸弹**（反面仍是红），
 *        所以最后还要躲一枚。
 *   3（现在）—— **那一枚也取消了**：拆掉的炸弹全部变成普通颜色的星星，一局打到
 *        最后盘上一枚活炸弹都不剩。
 *
 * 第 3 版就是《外边消除决策》的 D1b，玩家 2026-09-25 拍板落地。它当初的理由
 * （「外边消除下棋盘会一圈一圈变小，不需要那一颗」）在外边消除取消之后一度不成立、
 * 那一格因此在文档里挂了一阵「待重议」——最后是玩家自己定的：还是取消。
 *
 * 同样一副棋盘，躲六枚、躲一枚、一枚都不躲，分数根本不是一把尺子量出来的。所以存档
 * 和排行榜都按这个号分开：本地存在 `<bestKey>_bomb3` 底下（`_bomb2`、`_bomb` 原样
 * 留着，不删也不再显示），服务器记在 `square:bomb3` 这样的新榜上（老的两张归档，
 * rebuild 不碰它们——除非 `drop` 点名，见 api/scores.js）。每一局自己带着这个号存进
 * RunData.bombRules，所以从云端取回来的老局会认回老键，不会混进新榜。
 */
export const BOMB_RULES_VERSION = 3;

/**
 * 这一枚此刻是不是一颗**活**炸弹。
 *
 * 从前红块永不翻面，「是不是炸弹」和「颜色是不是红」是同一件事，所以六副棋盘
 * 里判四连、数活棋子、闪三连预警的地方一律只看 `color === RED_IDX`。现在炸弹
 * 挨着得分图案会被连带拆掉、翻成星星，那三处就各会出一种错：
 *
 *   · 判四连：一枚拆掉的红星星挨着三枚活炸弹，按颜色数是 4 枚相连——误爆；
 *   · 三连预警：会闪在一颗已经是星星的棋子上；
 *   · 活棋子表：拆出来的星星被当成炸弹剔掉，死局判定少数几枚，把活局判成
 *     「无法继续匹配」提前结算。
 *
 * 所以改成问**露在外面的那一面**是不是红（effColor）：正面红 = 还没拆；拆成基础色
 * 星星的，不再是炸弹。
 *
 * 第 3 版（见上面 BOMB_RULES_VERSION）之后**没有反面是红的炸弹了**，所以
 * `face === 'dot'` 那一支现在永远回 false。这一行照旧按两面问，不改成只看正面：
 * 它是「露在外面的那一面是不是红」这句话的实现，而那句话和有没有永久炸弹无关；
 * 哪天又要加回一枚红反面（这件事已经来回过两轮），这儿一个字都不用动。
 */
export const isLiveBomb = (t: { color: number; face: string; dotColor: number }, redIdx: number): boolean =>
  (t.face === 'dot' ? t.dotColor : t.color) === redIdx;

/**
 * 得分图案旁边的炸弹要被打中几下才拆。玩家 2026-09 定的：**两下**。
 *
 * 一下就拆（改版最初那一版）太软：炸弹几乎构不成威胁；一下不拆、三下才拆又
 * 回到了改版之前——炸弹事实上拆不掉。两下是三档里最均衡的那一档：方块上不谨
 * 慎的玩家炸死率从 66% 降到 16%（**不是归零**，它仍然是个威胁），谨慎的玩家
 * 仍然零死亡，一局打完炸弹存在率还有八成（棋盘不会被清空成普通局），综合得分
 * 126 最接近基础方块的 139，而「要不要绕过去拆它」这件事玩家还完全做得了主。
 *
 * 第一下留一道裂纹（ui/bombCrack.ts）。没有那道裂纹，两层规则在屏幕上就不存
 * 在了，玩家只会觉得「贴着打了一次怎么没掉」。
 */
export const BOMB_HITS_TO_DEFUSE = 2;

/**
 * 这一枚炸弹挨了一下。回 true 表示这一下把它拆了（翻面由调用方做——六副棋盘
 * 翻面各有各的动画）。
 */
export function hitBomb(t: { bombHits?: number }): boolean {
  t.bombHits = (t.bombHits ?? 0) + 1;
  return t.bombHits >= BOMB_HITS_TO_DEFUSE;
}

/** 挨过打、还没拆掉——身上要画那道裂纹的，就是它。 */
export const isCrackedBomb = (t: { bombHits?: number }): boolean => {
  const n = t.bombHits ?? 0;
  return n > 0 && n < BOMB_HITS_TO_DEFUSE;
};

/**
 * 得分图案旁边的炸弹，跟着这一拍挨一下。**两下才拆**（玩家定的，见上面的
 * BOMB_HITS_TO_DEFUSE）：第一下只留一道裂纹，第二下才翻成它自己的反面（一枚基础色
 * 星星）。挨着的全算，没有上限。
 *
 * 回传拆掉的那几格，连锁那边会把它们并进**下一拍的遮罩**（见 scoring.ts 的
 * afterCommit）。不并的话会出这种事：蓝色 2×2 得分，右边的炸弹翻成绿星星，这颗绿星
 * 星另一侧恰好有三枚绿正面、四枚正好凑成一个绿色 2×2——可它一格都不在遮罩里，这一
 * 步找不到它，图案摆在盘上不给分，要等以后某次滑动碰巧碰到。玩家看见的是「拼好了
 * 却没给分，过几步又莫名其妙给了」。
 *
 * 拆弹本身不给分、weight 也不记，所以计分和「有效得分率」的口径不变。
 *
 * 五副有炸弹的棋盘（方块、菱形方块、小球、六边小球、三角）原先各抄一份、连注释逐字
 * 相同；10-08 方案第五批第 3 条抽到这儿，规矩只写一遍（和上面那几样同一个先例）。各
 * 副只交代自己那副盘：谁挨着谁（neighbors）、某一格上是哪一枚（tileAt）、哪一枚还是
 * 活炸弹（isLive——不在炸弹局时恒 false，于是这儿一枚都不打）。
 */
export function defuseAround(
  scored: readonly Cell[],
  neighbors: (r: number, c: number) => readonly Cell[],
  tileAt: (r: number, c: number) => Tile,
  isLive: (t: Tile) => boolean,
): Cell[] {
  const hit: Cell[] = [];
  const seen = new Set<string>();
  for (const [r, c] of scored) {
    for (const [nr, nc] of neighbors(r, c)) {
      const key = cellKey(nr, nc);
      if (seen.has(key)) continue;
      const t = tileAt(nr, nc);
      // 只打还立着的那些。已经翻过去的（包括那枚翻完仍算炸弹的永久
      // 炸弹）不再动它，不然它会被反复算进「这一拍又拆了几枚」。
      if (t.face !== 'flavor' || !isLive(t)) continue;
      // 一拍之内同一枚最多挨一下——seen 拦的正是「两组图案同时贴着它」。
      seen.add(key);
      // 第一下只裂，不翻面，也不并进遮罩：盘面对配对来说一个字没变，它
      // 仍旧是一枚立着的红障碍。裂纹由 render 照着 bombHits 画。
      if (!hitBomb(t)) continue;
      t.face = 'dot';
      hit.push([nr, nc]);
    }
  }
  return hit;
}

/**
 * 发牌时给这一局的炸弹排反面。
 *
 * **为什么在发牌时定，不在翻面时抽。** 两种做法玩家看不见，但「是不是同一副
 * 牌」看得见：翻面时抽的话，同一个种子、同一副初始盘，两个人因为拆弹顺序不同
 * 抽出来的颜色就不同——种子码、《加入指定小屋》、分享卡回放、以及 check-*.mjs
 * 那几台确定性的门，全都建立在「给定种子，整局可复现」之上。发牌时定则完全沿
 * 用这个仓库原有的「印好的卡片」模型：每枚棋子的反面在发牌时就用带种子的
 * shuffle 印死，炸弹只是从「反面印红」改成「反面印基础色」。
 *
 * **没有永久炸弹了**（《外边消除决策》D1b，玩家 2026-09-25 拍板）：每一枚炸弹的反面
 * 都印基础色，拆完就是一颗普通星星，一局打到最后盘上一枚活炸弹都不剩。
 *
 * 这一颗来回过两轮——起初是玩家定的「留一颗拆不掉的」；D1b 要取消它，靠的理由是
 * 「外边消除下棋盘会一圈一圈变小，不需要那一颗」；外边消除取消之后那个理由又成立
 * 了，于是 D1b 在文档里挂了一阵「待重议」；最后是玩家自己定的：**还是取消**。
 * 改这儿之前先看那份文档（连带 `BOMB_RULES_VERSION` 要不要再往上加一版）。
 *
 * **其余按基础色配平，不是每枚独立抽。** 独立抽 5 色的话，6 枚里有 48% 的发牌
 * 会出现某一色 3 枚以上，只有 11.5% 五色齐全。配平法把颜色表先洗一遍再依次
 * 取，每种颜色的期望枚数相同，单次发牌最多只差 1 枚——「基本等概率」落到实现
 * 上就是这个。洗一遍才取，是为了让「哪一色多一枚 / 哪一色缺席」也跟着种子走。
 *
 * 六副棋盘的炸弹枚数不同（方块/菱形/六边小球 6、小球 7、三角 9、大三角 5），
 * 这个函数按 count 自己算，不用各写一份。
 */
export function dealBombBacks(
  count: number,
  normalColors: readonly number[],
  redIdx: number,
  shuffle: <T>(arr: T[]) => T[],
): number[] {
  if (count <= 0) return [];
  /**
   * 反面只从**基础色**里取，而且把红滤掉。
   *
   * 第 3 版的规矩是「一局打到最后一枚活炸弹都不剩」，而这个函数是唯一决定反面颜色
   * 的地方——所以 `redIdx` 这个参数留着不是摆设：万一哪天 `normalColors` 里混进了红
   * （调色板改动、色盲那一套换表），这一道当场把它挡掉，不会悄悄发回一枚永久炸弹。
   *
   * 滤完一个都不剩（只有整张调色板全是红才会发生）就退回原样：那时候盘上颜色已经全
   * 一样、是另一种坏了，而发不出反面会让最后几枚拿到 undefined，更糟。
   */
  const usable = [...normalColors].filter((c) => c !== redIdx);
  const order = shuffle(usable.length ? usable : [...normalColors]);
  const backs: number[] = [];
  for (let i = 0; i < count && order.length; i++) backs.push(order[i % order.length]);
  // 再洗一次：哪一枚拿到哪一色也该由种子决定，不然永远按颜色表的顺序发。
  //
  // （第 3 版之前这儿第一张写的是 redIdx——那一枚拆不掉的永久炸弹，循环也因此只走
  // count−1 次。取消它之后两处一起改：不再塞红，循环走满 count。少改一处就是「六
  // 枚炸弹只发五个反面」，最后那一枚的反面是 undefined。）
  return shuffle(backs);
}

// ── 四连判爆、三连预警、发一副干净的开局（第 14 推从五副棋盘里抽出来）──────────
//
// 方块、小球、六边小球、菱形方块、大三角各抄过一遍这三样，三十来行一字不差，差的只有两
// 件事：盘上有哪些格、一格的邻居是谁（方块和菱形是上下左右，小球、六边小球、三角各有各
// 的邻接）。抄五份的毛病是改一处漏四处——「挨着」的定义要是哪天改了（比如斜角也算），
// 改到第三副就会有人忘了第四副，而那一副的炸弹从此按另一种规矩爆。现在那两件事作参数，
// 规矩只写这一遍。

/** 一格：[行, 列]。 */
export type BombCell = readonly [number, number];
/** 一副盘：行优先，每行长短可以不一样（小球、三角那几副是阶梯形的）。 */
export type BombGrid<T> = readonly (readonly T[])[];

/**
 * 一副棋盘的「哪些格、谁挨着谁」。
 *
 * 都收着这一副盘本身：方块那一副的尺寸跟着盘走（不是写死的 6×6），按盘去量最稳；别的几
 * 副不看它。
 */
export interface BombAdjacency {
  /** 盘上每一格（离场的也在里头——活不活由 isLive 判）。 */
  cells(g: BombGrid<unknown>): Iterable<BombCell>;
  /** 这一格的邻居，已经裁在盘内。 */
  neighbors(r: number, c: number, g: BombGrid<unknown>): Iterable<BombCell>;
}

/** 方块、菱形方块：上下左右四个邻居，盘多大按这一副盘算。 */
export const GRID_ADJACENCY: BombAdjacency = {
  *cells(g) {
    for (let r = 0; r < g.length; r++) for (let c = 0; c < g[r].length; c++) yield [r, c] as const;
  },
  *neighbors(r, c, g) {
    const near: BombCell[] = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
    for (const [nr, nc] of near) if (nr >= 0 && nr < g.length && nc >= 0 && nc < g[nr].length) yield [nr, nc] as const;
  },
};

/** 四连就炸：这一局到此为止。三连只是预警（render 那一圈闪）。 */
export const BOMB_CLUSTER_SIZE = 4;

/**
 * 活炸弹连成 minSize 枚以上的那些格（`cellKey` 的 `r,c`）。四连判爆、三连预警各问一次。
 *
 * 只认**活**炸弹（isLive 由棋盘给：`isBomb && isLiveBomb(t, RED_IDX)`）——拆成星星的那
 * 几枚就算还是红的，也不连（见上面 isLiveBomb 那一段）。
 */
export function redClusterKeys<T>(
  g: BombGrid<T>,
  minSize: number,
  adj: BombAdjacency,
  isLive: (t: T) => boolean,
): Set<string> {
  const found = new Set<string>();
  const seen = new Set<string>();
  for (const [r, c] of adj.cells(g)) {
    if (!isLive(g[r][c])) continue;
    const startKey = cellKey(r, c);
    if (seen.has(startKey)) continue;
    const comp: string[] = [];
    const stack: BombCell[] = [[r, c]];
    seen.add(startKey);
    while (stack.length) {
      const [cr, cc] = stack.pop() as BombCell;
      comp.push(cellKey(cr, cc));
      for (const [nr, nc] of adj.neighbors(cr, cc, g)) {
        const key = cellKey(nr, nc);
        if (seen.has(key) || !isLive(g[nr][nc])) continue;
        seen.add(key);
        stack.push([nr, nc]);
      }
    }
    if (comp.length >= minSize) for (const k of comp) found.add(k);
  }
  return found;
}

/** 盘上有没有一团四连的活炸弹。 */
export function hasRedCluster<T>(g: BombGrid<T>, adj: BombAdjacency, isLive: (t: T) => boolean): boolean {
  return redClusterKeys(g, BOMB_CLUSTER_SIZE, adj, isLive).size > 0;
}

/**
 * 四连爆炸：盘上有一团连成 BOMB_CLUSTER_SIZE 枚的活炸弹，就先把盘面画出来（让人看见炸的是哪一
 * 团），再按炸弹惩罚收场。回 true 表示炸了——这一局已经结束。
 *
 * **只在这一步的连锁全部走完之后查一次**，由 gameController 的 checkHazard 钩子调（见那里的注
 * 释）。从前是拖拽一落地就立刻查：那时红块永不消也永不翻，滑动是它们唯一会挨到一起的原因，落地
 * 查就够了。现在炸弹挨着得分图案会被拆成星星，连锁每一拍都在改「谁还算活炸弹」——落地那一刻查，
 * 会把下一拍马上要被拆掉的那几枚算进四连，白白炸掉一局；两个时机都查又会让同一堆红块报两遍。所
 * 以只在盘面安定下来之后查这一次。
 *
 * 五副有炸弹的棋盘原先各抄一份 checkBombHazard（连上面这段注释逐字相同）；10-08 方案第五批第 3 条
 * 抽到这儿，惩罚的分数、理由、结算页那一行的说明只写一遍。各副只交代自己的盘和怎么收场（render、
 * 控制器的 forceEnd）。
 */
export function blowUpIfClustered<T>(
  g: BombGrid<T>,
  adj: BombAdjacency,
  isLive: (t: T) => boolean,
  end: { render(): void; forceEnd(reason: string, penalty: number, label: string): void },
): boolean {
  if (!hasRedCluster(g, adj, isLive)) return false;
  end.render();
  end.forceEnd(BOMB_HAZARD_REASON, BOMB_HAZARD_PENALTY, '炸弹惩罚');
  return true;
}

/** 发一副干净开局最多重发几次。五百次还发不出来，就用最后那一副（不卡死开局）。 */
export const CLEAN_BOMB_DEAL_TRIES = 500;

/**
 * 发一副干净的炸弹开局：开局就成团（hasInitialClump，各副自己的「同色挨太多」）、开局
 * 就有四连炸弹的，重发。
 *
 * `deal` 每调一次就是完整的一次发牌（洗牌 + 摆盘）——随机数照原来的顺序消耗，同一个种子
 * 发出来的还是同一副（种子码、小屋、门里那几台确定性的体检都靠这一条）。
 */
export function generateCleanBombBoard<T>(
  deal: () => T[][],
  hasInitialClump: (g: T[][]) => boolean,
  adj: BombAdjacency,
  isLive: (t: T) => boolean,
  maxTries = CLEAN_BOMB_DEAL_TRIES,
): T[][] {
  let g: T[][];
  let tries = 0;
  do {
    g = deal();
    tries++;
  } while ((hasInitialClump(g) || hasRedCluster(g, adj, isLive)) && tries < maxTries);
  return g;
}

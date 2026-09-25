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
 * 2026-09 改过一次：从前一局里每一枚红块都是炸弹、永不翻面；现在炸弹挨着得分
 * 图案会被连带拆成星星，一局只剩一枚永久炸弹（见 dealBombBacks）。同样一副棋
 * 盘，改之前活到最后要躲六枚，改之后只躲一枚——分数根本不是一把尺子量出来的。
 *
 * 所以存档和排行榜都按这个号分开：本地存在 `<bestKey>_bomb2` 底下（老的
 * `_bomb` 原样留着，不删也不再显示），服务器记在 `square:bomb2` 这样的新榜上
 * （老的 `square:bomb` 归档，rebuild 不碰它）。每一局自己带着这个号存进
 * RunData.bombRules，所以从云端取回来的老局会认回老键，不会混进新榜。
 */
export const BOMB_RULES_VERSION = 2;

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
 * 所以改成问**露在外面的那一面**是不是红（effColor）：正面红 = 还没拆；反面
 * 红 = 那一枚永久炸弹（见 dealBombBacks）；拆成基础色星星的，不再是炸弹。
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
 * 发牌时给这一局的炸弹排反面。
 *
 * **为什么在发牌时定，不在翻面时抽。** 两种做法玩家看不见，但「是不是同一副
 * 牌」看得见：翻面时抽的话，同一个种子、同一副初始盘，两个人因为拆弹顺序不同
 * 抽出来的颜色就不同——种子码、《加入指定小屋》、分享卡回放、以及 check-*.mjs
 * 那几台确定性的门，全都建立在「给定种子，整局可复现」之上。发牌时定则完全沿
 * 用这个仓库原有的「印好的卡片」模型：每枚棋子的反面在发牌时就用带种子的
 * shuffle 印死，炸弹只是从「反面印红」改成「反面印基础色」。
 *
 * **一枚永久炸弹。** 玩家定的：拆出来的星星里留一颗仍然是炸弹（红 + 「！」），
 * 照旧按炸弹的规则算。它的反面还是红，所以拆完还是 isLiveBomb。
 *
 * ⚠️ **《外边消除决策》的 D1b 曾决定取消这一颗，但那是外边消除时期的决定，现在待
 * 重议——改这儿之前先看那份文档。** 当时推翻它的理由是「外边消除下棋盘会一圈一圈
 * 变小，所以不需要这一颗」；外边消除已经取消（改走《星星跟随色块消除》，棋盘不再
 * 缩），那个理由又成立了。D1b 的支撑数据（终局活炸弹 0.26 枚 / 残留 20% / 综合分
 * 1639）也是在已取消的规则下跑出来的。状态表上那一格写的是「仍然有效」，读的人很
 * 容易以为该照着删——所以在这儿留一句路标，免得下一个人真去删了。
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
  const order = shuffle([...normalColors]);
  const backs: number[] = [redIdx];
  for (let i = 0; i < count - 1 && order.length; i++) backs.push(order[i % order.length]);
  // 再洗一次：永久炸弹落在哪一枚上也该由种子决定，不然永远是牌堆里第一颗。
  return shuffle(backs);
}

import type { Tile } from './types';

/**
 * 开发时手摆一副牌——**只在 dev 下存在**。
 *
 * ── 为什么要它 ────────────────────────────────────────────────
 *
 * 残局那一套（`engine/residueSearch.ts` ＋ `residueBoard.ts`，《侵蚀阶梯》§4）只在「可用
 * ≤16 枚」时才跑，而一局正常的棋要打到那个份上得翻掉二三十枚。自检机器人每十步左右才翻一
 * 枚，一局 300 步里能不能走到残局很看开局那副牌——所以「残局判死之后真的会结算」这件事从
 * 落地那天起**没有任何端到端的验收**：接错了也只是「某些局不结束」，而那种局本来就少见。
 *
 * 这个入口把那一步变成可点的：手摆一副已经是残局的盘面，开一局，看它该不该在 1.4 秒之后
 * 结算。
 *
 * ── 只在 dev 下 ───────────────────────────────────────────────
 *
 * `import.meta.env.DEV` 是 Vite 在构建时替换掉的常量，所以正式包里下面那个 `if` 整段被
 * 摇掉——不是「运行时判断一下」，是**根本不在产物里**。这一点要紧：一个能手摆盘面的入口在
 * 线上等于一个作弊器（摆一副一步就能清的盘，分数想多少有多少），而排行榜是真的。
 *
 * 门怎么用它：`npm run dev` 起开发服务器（不是 `dist`），往 localStorage 里写一个
 * `slides.devDeal`，再开那一局。格式见下面 `parseDevDeal`。
 */

/** 一格：`null` = 空白（已经削掉，不在盘上）；别的就是一枚棋子。 */
export type DevCell = null | { color: number; face: 'flavor' | 'dot'; dotColor: number };

/**
 * 一行一行写，每格一个符号，空格分开：
 *
 *   `.`      空白（削掉了）
 *   `2`      正面朝上的 2 号色（`face: 'flavor'`，反面随手给 0 号色）
 *   `2*`     已经翻成星星的 2 号色（`face: 'dot'`，`dotColor: 2`）
 *   `2>3`    正面 2 号色、反面 3 号色
 *   `2*3`    已经翻成星星、而且星星是 3 号色
 *
 * 例（小球那一副 7 行，只在最后两行留四枚）：
 *
 *   localStorage['slides.devDeal'] = JSON.stringify({
 *     circle: ['.', '. .', '. . .', '. . . .', '. . . . .', '. . 0* 0* . .', '. . . 1* 1* . .'],
 *   });
 */
export function parseDevDeal(rows: readonly string[]): DevCell[][] {
  return rows.map((row) =>
    row
      .trim()
      .split(/\s+/)
      .filter((tok) => tok.length > 0)
      .map((tok): DevCell => {
        if (tok === '.') return null;
        const star = tok.indexOf('*');
        const arrow = tok.indexOf('>');
        if (star >= 0) {
          const front = Number(tok.slice(0, star));
          const back = tok.length > star + 1 ? Number(tok.slice(star + 1)) : front;
          return { color: front, face: 'dot', dotColor: back };
        }
        if (arrow >= 0) {
          return { color: Number(tok.slice(0, arrow)), face: 'flavor', dotColor: Number(tok.slice(arrow + 1)) };
        }
        const n = Number(tok);
        return { color: n, face: 'flavor', dotColor: 0 };
      }),
  );
}

/** localStorage 里那个键。只有 dev 下有人读它。 */
export const DEV_DEAL_KEY = 'slides.devDeal';

/**
 * 这一副棋盘此刻有没有一副手摆的牌。正式包里永远回 null。
 *
 * `boardId` 就是棋盘自己的 id（`circle`、`square`、`squareDiamond`…，见 shapes/registry.ts）。
 */
export function devDealFor(boardId: string): DevCell[][] | null {
  if (!import.meta.env.DEV) return null;
  try {
    const raw = localStorage.getItem(DEV_DEAL_KEY);
    if (!raw) return null;
    const all = JSON.parse(raw) as Record<string, string[]>;
    const rows = all?.[boardId];
    if (!Array.isArray(rows) || !rows.length) return null;
    return parseDevDeal(rows);
  } catch {
    // 写坏了就当没写——一个手摆的盘面不值得把这一局弄崩。
    return null;
  }
}

/**
 * 把手摆的那副牌盖到真的 grid 上。
 *
 * **只盖，不改形状**：行数、每行几格都由棋盘自己说（手摆那一份多出来的格子忽略，少写的那
 * 几格原样留着上一副发的牌）。这样一副写错的 devDeal 不会把棋盘的几何弄坏，而几何一坏，
 * 后面每一处坐标计算都会错得没法看。
 *
 * `blank` 是那副棋盘自己的空白哨兵（各副都是 -1，但各自私有，所以由调用方传进来）。
 */
export function applyDevDeal(grid: Tile[][], rows: DevCell[][], blank: number): void {
  for (let r = 0; r < grid.length && r < rows.length; r++) {
    for (let c = 0; c < grid[r].length && c < rows[r].length; c++) {
      const want = rows[r][c];
      const tile = grid[r][c];
      if (!tile) continue;
      if (want === null) {
        tile.color = blank;
        tile.dotColor = blank;
        tile.face = 'flavor';
        continue;
      }
      tile.color = want.color;
      tile.face = want.face;
      tile.dotColor = want.dotColor;
    }
  }
}

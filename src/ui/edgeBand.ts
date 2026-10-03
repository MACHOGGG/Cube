import type { Cell } from '../engine/types';

/**
 * 外边指引 · 方案 B「**双色托盘**」——《侵蚀阶梯》v1.2 PR-7。
 *
 * 在托盘上、棋子**之下**，沿着「此刻哪几条线削得动」描一条粗带。玩家一眼看见的是
 * 「盘子现在的外圈在这儿」，而不是又一处要读的文字。
 *
 * 只有外边族那五副棋盘画它（方块 36 不画：它是任意整行整列都能消，没有「最外边」
 * 这回事）。
 *
 * ── 为什么是「只动明度不动色相」 ──────────────────────────────────
 * 带子不携带**任何颜色语义**：它说的是位置，不是「这条边是红的」。所以它只能是托
 * 盘自己那个颜色亮一点或暗一点——换成强调色的话，玩家会去找「这个颜色对应哪一
 * 族」，而根本没有那回事。色盲配色也因此不用另做一套。
 *
 * 亮色托盘（--board-bg 一系）：托盘色向墨色混 8%；暗色托盘：向亮色混 6%。两个数都
 * 是量出来的「看得见、但不抢棋子」的下限——再淡一成在 iPhone 的户外亮度下就没了。
 *
 * ── 为什么每条边各画一条，而不是拼成一个闭合多边形 ──────────────
 * 拼多边形要先把几条边按首尾接起来，而「哪几条边可削」随时在变（收尾放开之后可能
 * 只剩两条不相邻的）。各画各的、拐角处靠 `stroke-linejoin: round` 自然接上，出来的
 * 形状一模一样，少一整段排序逻辑。
 */

/** 带子有多粗：1.15 × 格径。比棋子略宽，所以棋子压上去两边各露一点。 */
export const BAND_RATIO = 1.15;

/** 这一层的类名——CSS 那头按它上色、做过渡。 */
export const BAND_CLASS = 'edge-band';

/**
 * 小球那一副的带子一呼一吸要多久（毫秒）——**和 style.css 里 `edge-band-breathe` 那条
 * `animation` 的时长是同一个数**，两处一起改（第 15 推）。
 *
 * 为什么 JS 这头也要知道它：这一层每次 render 都是新建的（棋盘每走一步重画一次，小球那一
 * 副拖动时每一帧都重画），新建的元素动画从 0% 起跳——不处理的话，带子每走一步就从「正
 * 暗着」一下跳回「最亮」，一条本该慢慢呼吸的带子变成一跳一跳的。所以按墙上的钟给它一个负
 * 的 animation-delay：不管哪一刻新建，都接着同一个相位往下走。
 */
export const BAND_BREATHE_MS = 3200;

export interface EdgeBandOpts {
  /** 这几条边此刻削得动（每条是它自己的活格，按线上的顺序）。 */
  edges: readonly (readonly Cell[])[];
  /** 这一格的中心画在托盘的哪儿（像素，和棋子用的是同一套坐标）。 */
  centerOf(r: number, c: number): [number, number];
  /** 一枚棋子的直径（像素）。带子按它乘 BAND_RATIO。 */
  pieceSize: number;
  /** 托盘有多大（像素），SVG 的 viewBox 用它。 */
  width: number;
  height: number;
}

/**
 * 画出（或更新）那一层。回传那个 SVG——调用方把它塞进棋盘容器的**最前面**，
 * 于是它在所有棋子底下。
 *
 * 一条边只有一格时画不出线段（两点才成线），所以那种情况画一个圆点：收尾放开之后
 * 真会出现一枚的外边，那时候带子不该整个消失。
 */
export function buildEdgeBand(opts: EdgeBandOpts): SVGSVGElement | null {
  const { edges, centerOf, pieceSize, width, height } = opts;
  if (!edges.length || width <= 0 || height <= 0) return null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', BAND_CLASS);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('aria-hidden', 'true');
  // 接着墙上的钟往下呼吸（见 BAND_BREATHE_MS）。别的四副外边族没有这条动画，这一句对它们
  // 什么都不做。
  svg.style.animationDelay = `${-(Date.now() % BAND_BREATHE_MS)}ms`;
  const w = Math.max(1, pieceSize * BAND_RATIO);
  for (const cells of edges) {
    if (!cells.length) continue;
    const pts = cells.map(([r, c]) => centerOf(r, c));
    if (pts.length === 1) {
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', pts[0][0].toFixed(1));
      dot.setAttribute('cy', pts[0][1].toFixed(1));
      dot.setAttribute('r', (w / 2).toFixed(1));
      dot.setAttribute('fill', 'currentColor');
      svg.appendChild(dot);
      continue;
    }
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('points', pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', 'currentColor');
    line.setAttribute('stroke-width', w.toFixed(1));
    line.setAttribute('stroke-linejoin', 'round');
    line.setAttribute('stroke-linecap', 'round');
    svg.appendChild(line);
  }
  return svg.childNodes.length ? svg : null;
}

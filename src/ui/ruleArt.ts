/**
 * 教学挑选页六条规则的配图。
 *
 * 每条是一段循环的小动画，画法借自基础教学的分镜（storyTutorial / tutorial.ts）：
 * 圆角方块是正面，暗底一颗点是反面（和棋盘上一样），白箭头拉一下是「这一列
 * 要滑」，白色对勾闪几下是「得分了」，消掉的格子留一个虚线空位闪两下。玩家
 * 的原话：「检查教学内容下面的文字配套的图/动画，要能够清晰地展示对应的教学
 * 内容。可以根据前面制作的基础教学动画内容采取局部作为样式」。
 *
 * 全部是 CSS 动画（style.css 的「规则配图」一节）：一幅图里的每个元素共用同一
 * 个周期（--T），各自只在周期里自己的那一段百分比动，所以「滑 → 对勾 → 翻面」
 * 永远按这个顺序来；循环时整幅图淡出再从头开始。
 */

// 方块教学分镜用的那套颜色（tutorial.ts）。
const O = '#EE8A2E'; // 橙（正面）
const B = '#4A67C0'; // 蓝（正面）
const M = '#B5499B'; // 品红（正面）
const Y = '#ADADAD'; // 灰（正面）
const G = '#1E8B31'; // 绿（正面 / 点）
const R = '#B34D2B'; // 红（点）
const T = '#2F8A96'; // 青（点）

/**
 * 一枚棋子：正面一块实色（--f），反面暗底一颗点（--d）。
 *   ra-back  一开始就露着反面
 *   ra-flip  得分之后翻过去
 *   ra-peek  翻过去露一下再翻回来
 *   ra-clear 得分之后整枚消掉
 *   ra-f0…7  一枚接一枚翻（第 5 条）
 */
function tile(front: string, dot: string, cls = ''): string {
  return (
    `<span class="ra-tile${cls ? ' ' + cls : ''}" style="--f:${front};--d:${dot}">` +
    `<span class="ra-f"></span><span class="ra-b"><span></span></span></span>`
  );
}

// 三个基础图形各自的正反面，画法照棋盘上的样子（也是基础教学分镜的画法）：
// 方块反面是深褐的一块加一颗点；小球反面是浅色球面上一个六角星标；三角反面
// 是浅色大三角里嵌一个描了黑边的小三角。
const PAPER = '#FBF8F1';
const DARK = '#3D3128';
const sqFront = (c: string) =>
  `<svg viewBox="0 0 100 100" aria-hidden="true"><rect x="4" y="4" width="92" height="92" rx="20" fill="${c}"/></svg>`;
const sqBack = (d: string) =>
  `<svg viewBox="0 0 100 100" aria-hidden="true"><rect x="4" y="4" width="92" height="92" rx="20" fill="${DARK}"/>` +
  `<circle cx="50" cy="50" r="22" fill="${d}"/></svg>`;
const ballFront = (c: string) =>
  `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46" fill="${c}"/></svg>`;
const ballBack = (d: string) =>
  `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="45" fill="${PAPER}" stroke="#9A9A9A" stroke-width="3.5"/>` +
  `<g stroke="${d}" stroke-width="10" stroke-linecap="round"><line x1="50" y1="23" x2="50" y2="77"/>` +
  `<line x1="27" y1="36.5" x2="73" y2="63.5"/><line x1="27" y1="63.5" x2="73" y2="36.5"/></g></svg>`;
const triFront = (c: string) =>
  `<svg viewBox="0 0 100 100" aria-hidden="true"><polygon points="50,6 96,92 4,92" fill="${c}" stroke="${c}" stroke-width="6" stroke-linejoin="round"/></svg>`;
const triBack = (d: string) =>
  `<svg viewBox="0 0 100 100" aria-hidden="true"><polygon points="50,6 96,92 4,92" fill="${PAPER}" stroke="#9A9A9A" stroke-width="3.5" stroke-linejoin="round"/>` +
  `<polygon points="50,40 73,82 27,82" fill="${d}" stroke="#1A1A1A" stroke-width="3.5" stroke-linejoin="round"/></svg>`;

/** 一枚正反面都是 SVG 的棋子（小球、三角，还有第 1 条里的方块）。 */
function svgTile(front: string, back: string, cls = '', vars = ''): string {
  return (
    `<span class="ra-tile ra-tile--svg${cls ? ' ' + cls : ''}"${vars ? ` style="${vars}"` : ''}>` +
    `<span class="ra-f">${front}</span><span class="ra-b">${back}</span></span>`
  );
}

/**
 * 会消掉的那一枚要再包一层：淡出的动画不能直接压在棋子上——一个元素的
 * opacity 一动，浏览器就把它「压平」，它里面正反两面那套 3D 翻转就失效，露
 * 出来的成了正面。所以淡出和缩小都动在外面这一层，棋子自己只管露着反面。
 */
const gone = (inner: string): string => `<span class="ra-gone">${inner}</span>`;

/** 占位：被会滑的那一列的窗口盖住的格子，本身不画。 */
const blank = '<span class="ra-tile ra-blank"></span>';

/** 小棋盘（默认 4 列 2 行）：浅底、圆角。 */
function board(inner: string, cls = '', cols = 4): string {
  return `<span class="ra-board${cls ? ' ' + cls : ''}"${cols !== 4 ? ` style="--cols:${cols}"` : ''}>${inner}</span>`;
}

/**
 * 最右那一列会滑：窗口盖住两格，里面三枚棋子上下叠着（最下面一枚是最上面
 * 那枚的补位影子），整条向上滑一格——和游戏里滑一列、超出的从另一头补回
 * 来是同一件事。
 */
function slidingCol(top: string, mid: string, ghost: string): string {
  return `<span class="ra-win" style="--c:3"><span class="ra-strip">${top}${mid}${ghost}</span></span>`;
}

/** 白色对勾，盖在某一格上，得分那一段闪几下。 */
const check = (c: number, r: number): string =>
  `<svg class="ra-check" style="--c:${c};--r:${r}" viewBox="0 0 60 60" aria-hidden="true">` +
  `<path d="M12 32 L26 47 L50 12" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** 白箭头：盖在要滑的那一列上，向上，开头拉一下（教学里箭头的那个动作）。 */
const arrowUp = (c: number): string =>
  `<svg class="ra-arrow" style="--c:${c}" viewBox="-16 -30 32 70" aria-hidden="true"><g class="ra-arrow-nudge">` +
  `<line x1="0" y1="34" x2="0" y2="4" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-dasharray="9 8"/>` +
  `<path d="M-9 -2 L0 -20 L9 -2 Z" fill="#fff" stroke="#fff" stroke-width="6" stroke-linejoin="round"/></g></svg>`;

const checksRow0 = check(0, 0) + check(1, 0) + check(2, 0) + check(3, 0);

/** 第 5 条最后出的那个「完成」：白底绿勾。 */
const endMark =
  `<svg class="ra-end" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46" fill="#fff"/>` +
  `<path d="M29 52 L44 66 L72 36" fill="none" stroke="${G}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// 第 6 条用的几个符号：秒表（针会走）、滑动、星星（会闪）、等号、奖杯（会亮）。
const symStopwatch =
  `<svg class="ra-sym" viewBox="0 0 100 100" aria-hidden="true">` +
  `<circle cx="50" cy="56" r="34" fill="none" stroke="currentColor" stroke-width="9"/>` +
  `<path d="M40 12 H60 M50 12 V22" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round"/>` +
  `<line class="ra-hand" x1="50" y1="56" x2="50" y2="34" stroke="currentColor" stroke-width="9" stroke-linecap="round"/></svg>`;
const symMoves =
  `<svg class="ra-sym" viewBox="0 0 100 100" aria-hidden="true">` +
  `<path d="M14 50 H86 M30 32 L12 50 L30 68 M70 32 L88 50 L70 68" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const symStar =
  `<svg class="ra-sym" viewBox="0 0 100 100" aria-hidden="true">` +
  `<path class="ra-star" d="M50 8 L62 36 L92 38 L69 58 L76 88 L50 72 L24 88 L31 58 L8 38 L38 36 Z" fill="#D89B1E"/></svg>`;
const symEq =
  `<svg class="ra-sym ra-sym--eq" viewBox="0 0 60 100" aria-hidden="true">` +
  `<path d="M12 40 H48 M12 60 H48" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round"/></svg>`;
const symTrophy =
  `<svg class="ra-sym ra-trophy" viewBox="0 0 100 100" aria-hidden="true">` +
  `<path d="M28 10 H72 V40 A22 22 0 0 1 28 40 Z" fill="#D89B1E"/>` +
  `<path d="M28 18 H14 V28 A14 14 0 0 0 28 42 M72 18 H86 V28 A14 14 0 0 1 72 42" fill="none" stroke="#D89B1E" stroke-width="8" stroke-linecap="round"/>` +
  `<path d="M50 62 V74" fill="none" stroke="#D89B1E" stroke-width="10" stroke-linecap="round"/>` +
  `<rect x="32" y="76" width="36" height="14" rx="5" fill="#D89B1E"/></svg>`;

export const RULE_ART: string[] = [
  // 1. 正反两面：方块、小球、三角各一列——上排正面，下排它的反面。上排的
  //    三枚轮流翻过去露一下反面再翻回来，翻出来的正是底下那一枚（玩家的原话：
  //    「各展示一个正面和反面……用户需要看明白正-反关系，能用图示的尽量不要
  //    文字」）。正面用的就是上面三颗入口键的三种颜色。
  board(
    svgTile(sqFront('#2F9E52'), sqBack(O), 'ra-peek') +
      svgTile(ballFront('#B23A3A'), ballBack('#4C68B0'), 'ra-peek', 'animation-delay:0.5s') +
      svgTile(triFront('#4C68B0'), triBack('#B23A3A'), 'ra-peek', 'animation-delay:1s') +
      svgTile(sqFront('#2F9E52'), sqBack(O), 'ra-back') +
      svgTile(ballFront('#B23A3A'), ballBack('#4C68B0'), 'ra-back') +
      svgTile(triFront('#4C68B0'), triBack('#B23A3A'), 'ra-back'),
    'ra-still',
    3,
  ),
  // 2. 同色凑成图案：最右那列往上滑一格，橙色凑满一行 → 对勾 → 四枚翻面，反面各是不同的颜色。
  board(
    tile(O, R, 'ra-flip') + tile(O, G, 'ra-flip') + tile(O, Y, 'ra-flip') + blank +
      tile(G, T) + tile(M, R) + tile(Y, G) + blank +
      slidingCol(tile(B, T), tile(O, M, 'ra-flip'), tile(B, T)) +
      arrowUp(3) + checksRow0,
  ),
  // 3. 反面和正面同色：两枚绿点的反面 + 两枚绿正面凑成一行照样得分；只有正面的那两枚翻过去。
  board(
    tile(G, G, 'ra-back') + tile(G, G, 'ra-back') + tile(G, R, 'ra-flip') + blank +
      tile(B, O) + tile(M, R) + tile(Y, G) + blank +
      slidingCol(tile(B, T), tile(G, T, 'ra-flip'), tile(B, T)) +
      arrowUp(3) + checksRow0,
  ),
  // 4. 反面同色连成一行：四颗蓝点排成一行 → 对勾 → 四颗一起缩小消失（玩家的
  //    原话：「四个点然后消失消除的动画」）。
  board(
    gone(tile(B, B, 'ra-back')) + gone(tile(B, B, 'ra-back')) + gone(tile(B, B, 'ra-back')) + gone(tile(B, B, 'ra-back')) +
      tile(O, R) + tile(M, G) + tile(G, T) + tile(Y, M) +
      checksRow0,
  ),
  // 5. 经典结束：八枚一枚接一枚翻到反面，全翻完了就出「完成」。
  board(
    tile(B, R, 'ra-f0') + tile(O, G, 'ra-f1') + tile(M, T, 'ra-f2') + tile(Y, R, 'ra-f3') +
      tile(G, M, 'ra-f4') + tile(B, O, 'ra-f5') + tile(O, R, 'ra-f6') + tile(M, G, 'ra-f7') +
      endMark,
  ),
  // 6. 时间短、步数少、得分多 → 综合得分高：秒表、滑动、星星，等号右边是奖杯。
  symStopwatch + symMoves + symStar + symEq + symTrophy,
];

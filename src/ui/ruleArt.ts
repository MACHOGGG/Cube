/**
 * 教学挑选页那**五条**规则的配图。
 *
 * 《侵蚀阶梯》v1.2（2026-09）把规则从六条改成五条，这五幅图跟着一条一条重新
 * 对过。对不上的后果不是「图不好看」——`rulesModal.ts` 是按下标取图的
 * （`art[i]`），文字改了、图没动，第 3 条就会配上第 2 条那幅画，而屏幕上看不出
 * 是错位，只看得出「这幅图和这句话没关系」。
 *
 * 退役的两幅：从前第 1 条那幅「每个图形都有正反两面」（方块/小球/三角并排），
 * 和从前第 6 条那幅「时间短、步数少 → 综合得分高」（秒表＋奖杯）。前者是因为
 * 「翻面/正反面」这套中间概念玩家 2026-09 就定下不再讲了；后者是因为时间这一
 * 项不再进分（综合分 = 拼出分 × 步数系数，见 engine/stepCoef.ts），那幅画里的
 * 秒表是一句假话。
 *
 * 每条是一段循环的小动画，画法借自基础教学的分镜（storyTutorial / tutorial.ts）：
 * 圆角方块是色块，暗底一颗「＊」是星星（和棋盘上同一个记号，见 dotFaceMark.ts），
 * 白箭头拉一下是「这一列要滑」，白色对勾闪几下是「得分了」，消掉的格子缩小淡出。玩家
 * 的原话：「检查教学内容下面的文字配套的图/动画，要能够清晰地展示对应的教学
 * 内容。可以根据前面制作的基础教学动画内容采取局部作为样式」。
 *
 * 全部是 CSS 动画（style.css 的「规则配图」一节）：一幅图里的每个元素共用同一
 * 个周期（--T），各自只在周期里自己的那一段百分比动，所以「滑 → 对勾 → 翻面」
 * 永远按这个顺序来；循环时整幅图淡出再从头开始。
 */

import { ASTERISK_SEGS, ASTERISK_STROKE } from './dotFaceMark';
import { CHECK_PATH, CHECK_TIGHT_VIEWBOX } from './checkMark';

// 方块教学分镜用的那套颜色（tutorial.ts）。
const O = '#EE8A2E'; // 橙（正面）
const B = '#4A67C0'; // 蓝（正面）
const M = '#B5499B'; // 品红（正面）
const Y = '#ADADAD'; // 灰（正面）
const G = '#1E8B31'; // 绿（正面 / 点）
const R = '#B34D2B'; // 红（点）
const T = '#2F8A96'; // 青（点）

/**
 * 星星那一面上的记号：和棋盘上是同一个三笔的「＊」（ui/dotFaceMark.ts）。
 *
 * 从前这儿画的是一颗实心小圆——那是 2026-09 统一之前方块的反面记号。玩家那次定
 * 的是「把正方形和三角形的反面后变成和小球一样的星星标记『*』」，棋盘上改了，教
 * 学配图没跟上；等到教学文案 2026-09 改成五条、五条里说了五次「星星」之后，这颗
 * 圆点就成了「字说星星、图画圆点」，一眼看不出说的是同一样东西。
 *
 * 线段表从 dotFaceMark 引，不在这儿抄一份：抄一份的下场就是上一次那样——一处改
 * 了另一处没改，而两处看上去都还是「对的」。
 */
const STAR_MARK =
  `<svg class="ra-mark" viewBox="0 0 24 24" stroke-width="${ASTERISK_STROKE}" aria-hidden="true">` +
  ASTERISK_SEGS.map(([[x1, y1], [x2, y2]]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`).join('') +
  `</svg>`;

/**
 * 一枚棋子：正面一块实色（--f），反面暗底一颗星（--d）。
 *   ra-back  一开始就露着星星那一面
 *   ra-flip  得分之后翻成星星
 *   ra-clear 得分之后整枚消掉
 *   ra-lad1…3  第 3 条：得分图案降到 1/2/3 枚时，这一枚退场
 *   ra-w0…7    第 5 条：一枚接一枚消掉
 */
function tile(front: string, dot: string, cls = ''): string {
  return (
    `<span class="ra-tile${cls ? ' ' + cls : ''}" style="--f:${front};--d:${dot}">` +
    `<span class="ra-f"></span><span class="ra-b">${STAR_MARK}</span></span>`
  );
}

// 三个基础图形各自的正反面，画法照棋盘上的样子（也是基础教学分镜的画法）：
// 反面都是浅色的一块加一颗「＊」。三族现在共用同一个记号（玩家 2026-09 定
// 的统一，见 ui/dotFaceMark.ts）——从前方块是深褐底加一颗点、三角是浅色大三
// 角里嵌一个描了黑边的小三角，只有小球是这三笔。
//
// 棋盘上反面是「底板透出来」，这儿不能照搬：这几幅小图背后没有棋盘，抽掉底
// 色就只剩三根悬空的线，认不出是哪一种图形。所以底色换成纸色加一圈浅灰边
// ——小球那一枚本来就是这么画的，另外两个跟上。
const PAPER = '#FBF8F1';
/** 那颗星，画在 100×100 的格子里。k=1 就是小球那一枚的大小。 */
const star100 = (cx: number, cy: number, d: string, k = 1) =>
  `<g stroke="${d}" stroke-width="${(10 * k).toFixed(1)}" stroke-linecap="round" ` +
  `transform="translate(${cx} ${cy}) scale(${k}) translate(-50 -50)">` +
  `<line x1="50" y1="23" x2="50" y2="77"/>` +
  `<line x1="27" y1="36.5" x2="73" y2="63.5"/><line x1="27" y1="63.5" x2="73" y2="36.5"/></g>`;
// sqFront / triFront / triBack 跟着退役的第 1 幅（「每个图形都有正反两面」，三族
// 并排）一起删了——noUnusedLocals 不留没人用的东西，而且留着会让人以为还有一幅
// 三族并排的图在某处用着。sqBack / ballBack 留着：炸弹那幅提示图还在用。
const sqBack = (d: string) =>
  `<svg viewBox="0 0 100 100" aria-hidden="true"><rect x="4" y="4" width="92" height="92" rx="20" fill="${PAPER}" stroke="#9A9A9A" stroke-width="3.5"/>` +
  star100(50, 50, d) +
  `</svg>`;
const ballFront = (c: string) =>
  `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46" fill="${c}"/></svg>`;
const ballBack = (d: string) =>
  `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="45" fill="${PAPER}" stroke="#9A9A9A" stroke-width="3.5"/>` +
  star100(50, 50, d) +
  `</svg>`;

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

/**
 * 白色对勾，盖在某一格上，得分那一段闪几下。
 *
 * 形状是全站那一枚（checkMark.ts 的 CHECK_PATH，10-09 补充方案 6-5「全站统一一种勾」），画布裁到勾的周围
 * （CHECK_TIGHT_VIEWBOX）：勾占格子的六成多，和这儿原来自己画的那一枚一样大；线宽照原来 60 格里的 10
 * 折算成 68 格里的 11.3，一样粗。
 */
const check = (c: number, r: number): string =>
  `<svg class="ra-check" style="--c:${c};--r:${r}" viewBox="${CHECK_TIGHT_VIEWBOX}" aria-hidden="true">` +
  `<path d="${CHECK_PATH}" fill="none" stroke="#fff" stroke-width="11.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** 白箭头：盖在要滑的那一列上，向上，开头拉一下（教学里箭头的那个动作）。 */
const arrowUp = (c: number): string =>
  `<svg class="ra-arrow" style="--c:${c}" viewBox="-16 -30 32 70" aria-hidden="true"><g class="ra-arrow-nudge">` +
  `<line x1="0" y1="34" x2="0" y2="4" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-dasharray="9 8"/>` +
  `<path d="M-9 -2 L0 -20 L9 -2 Z" fill="#fff" stroke="#fff" stroke-width="6" stroke-linejoin="round"/></g></svg>`;

/** 横着四颗对勾，从第 `from` 格起——得分的是哪四颗就盖哪四颗。 */
const checksAt = (from: number): string =>
  check(from, 0) + check(from + 1, 0) + check(from + 2, 0) + check(from + 3, 0);
const checksRow0 = checksAt(0);

/** 第 5 条最后出的那个「完成」：白底绿勾，就是游戏里《完成》键那副圆盘（同一枚 checkMark.ts 的 CHECK_PATH）。棋盘清空之后才冒出来。 */
const endMark =
  `<svg class="ra-end" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46" fill="#fff"/>` +
  `<path d="${CHECK_PATH}" fill="none" stroke="${G}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** 小球的一枚棋子：正面实色球，反面浅球面 + 星标（和棋盘上一个样）。 */
const ball = (front: string, dot: string, cls = ''): string =>
  svgTile(ballFront(front), ballBack(dot), cls);

/*
 * 这儿原先有一对 ballVoid / ballClears：消掉之后底下留一颗淡灰的空球，因为从前
 * 小球消行是「原地留空位」。
 *
 * 《侵蚀阶梯》v1.2 §3 之后不是了——削掉的那条外边**整条离场**，格子不在盘上了
 * （circle.ts 的 render 直接跳过它们）。再画一颗空球就是在教一件不发生的事：玩
 * 家会以为那个位置还能滑进东西去。所以第 4 条的小球版和方块版现在一样，四颗淡
 * 出之后底下什么都不剩。
 */

/** 一行六颗小球，第二行整体往右挪半格——棋盘上小球就是这样交错排的。 */
const STAG = 'ra-stag';

/**
 * 小球那一版的滑动窗口：横着来，而且**整行一起走**。
 *
 * 传进来的是这一行**滑完之后**该有的样子（六颗，从左到右）。窗口盖住整整
 * 一行，条子比它多一颗：开头先摆一份 `after` 的最后那颗，整条向左滑一格，
 * 于是「从左边挤出去的」和「从右边补回来的」看着就是同一颗——棋盘上滑一行
 * 就是这么回事。
 *
 * 原先这个窗口只盖两格、条子只有三颗：一行六颗小球，滑的只有中间那两颗，
 * 另外四颗一动不动，紧接着四颗打上勾得分。玩家看见的是「一行里的几颗小球
 * 自己滑动了，剩下的不滑动就得分了」——那不是这个游戏的规矩。方块那一版没
 * 踩到：它的窗口竖着盖两格，而那块小棋盘本来就只有两行，两格正好是整整一
 * 列，所以它一直是整条线在走。
 *
 * 还有一件跟着改的：既然整行一起走，行内相邻的四颗滑之前就已经相邻了，靠
 * 滑动是凑不出来的。所以那四颗改成**跨着接缝**凑——滑之前三颗挤在右头、一
 * 颗落在最左边，滑一格之后那一颗绕回右边，四连才成立。补位这件事于是有了
 * 实实在在的用处，不再只是个摆设。
 */
function slidingRow(after: readonly string[]): string {
  const n = after.length;
  const strip = after[n - 1] + after.join('');
  return (
    `<span class="ra-hwin" style="--c:0;--r:0;--w:${n};--n:${n + 1}">` +
    `<span class="ra-hstrip">${strip}</span></span>`
  );
}

/** 白箭头，横着的，指向左边（那一行往左滑）。 */
const arrowLeft = (c: number, r: number): string =>
  // 视野收紧到只比图形本身大一圈：横着的窗口只有一格高，viewBox 留白多一分，
  // 箭头就小一分——竖着那一支上下有两格可占，用不着这么省。
  `<svg class="ra-arrow ra-arrow--x" style="--c:${c};--r:${r}" viewBox="-22 -11 60 22" aria-hidden="true"><g class="ra-arrow-nudge">` +
  `<line x1="34" y1="0" x2="2" y2="0" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-dasharray="8 7"/>` +
  `<path d="M-4 -8 L-20 0 L-4 8 Z" fill="#fff" stroke="#fff" stroke-width="5" stroke-linejoin="round"/></g></svg>`;

/** 一行六颗的底排：颜色摆得杂一点，别让人以为底下那排也在凑图案。 */
const ballRow2 = (cls = STAG): string =>
  ball(G, T, cls) + ball(M, R, cls) + ball(Y, G, cls) + ball(B, M, cls) + ball(O, R, cls) + ball(G, B, cls);

/**
 * 五条的小球版：上下两行各六颗，下面那行错开半格。
 *
 * 玩家的原话：「把逐步教学的图形从方块改为小球，除了第一条以外……两行小球
 * 然后交叉排列比如上面 6 颗下面 6 颗，教学的内容一样你只是把图形、反面样式
 * 更改」。讲的还是那五件事，只是棋子换成小球、星星换成星标的球，节奏（滑 →
 * 对勾 → 翻面）一拍不改。
 *
 * 「除了第一条以外」那一句指的是**当年的**第 1 条（三族并排的正反面图）——那一
 * 幅 2026-09 退役了，所以现在五条全都有小球版，一条不落。
 */
function ballArt(): string[] {
  const b = (inner: string) => board(inner, 'ra-board--stag', 6);
  // 上面那一行整条都在窗口里滑（slidingRow），所以格子里摆的全是占位——真正
  // 画出来的六颗在窗口里面。
  const blankRow = blank + blank + blank + blank + blank + blank;
  return [
    // 1. 色块拼出得分图案：整行往左滑一格，最左边那颗橙的绕回右头，和原先挤在
    //    右头的三颗凑成四连 → 对勾 → 四颗翻成星星（星星各是不同的颜色）。
    b(
      blankRow + ballRow2() +
        slidingRow([
          ball(B, T), ball(M, Y),
          ball(O, R, 'ra-flip'), ball(O, G, 'ra-flip'), ball(O, Y, 'ra-flip'), ball(O, M, 'ra-flip'),
        ]) +
        arrowLeft(2, 0) + checksAt(2),
    ),
    // 2. 星星和色块一同再拼一次：两颗绿星星，和两颗绿色块凑成一线照样得分；只有
    //    色块那两颗翻过去。滑法和上一条一样，绕回右头的是那颗绿色块。
    b(
      blankRow + ballRow2() +
        slidingRow([
          ball(B, O), ball(M, Y),
          ball(G, G, 'ra-back'), ball(G, G, 'ra-back'),
          ball(G, R, 'ra-flip'), ball(G, T, 'ra-flip'),
        ]) +
        arrowLeft(2, 0) + checksAt(2),
    ),
    // 3. 得分图案会变小：横着一条橙的，4 → 3 → 2 → 1，末位那颗一颗一颗退场。
    ladderArt(ball),
    // 4. 同色星星在外边得分并消除：最上面那一条四颗蓝星星 → 对勾 → 四颗一起淡出，
    //    底下什么都不剩（削掉的外边整条离场，见上面那段说明）。
    b(
      gone(ball(B, B, 'ra-back')) + gone(ball(B, B, 'ra-back')) +
        gone(ball(B, B, 'ra-back')) + gone(ball(B, B, 'ra-back')) + ball(O, R) + ball(M, G) +
        ballRow2() + checksRow0,
    ),
    // 5. 尝试全部消除：十二颗星星一颗接一颗消掉，一颗不剩了才出「完成」。
    //    两行错开一拍（下排比上排晚两格），扫过去像一道斜的波。
    b(
      sweep(ball(B, R, 'ra-back'), 0) + sweep(ball(O, G, 'ra-back'), 1) + sweep(ball(M, T, 'ra-back'), 2) +
        sweep(ball(Y, R, 'ra-back'), 3) + sweep(ball(G, M, 'ra-back'), 4) + sweep(ball(B, O, 'ra-back'), 5) +
        sweep(ball(O, T, 'ra-back'), 2, STAG) + sweep(ball(M, G, 'ra-back'), 3, STAG) +
        sweep(ball(G, R, 'ra-back'), 4, STAG) + sweep(ball(B, Y, 'ra-back'), 5, STAG) +
        sweep(ball(Y, B, 'ra-back'), 6, STAG) + sweep(ball(O, M, 'ra-back'), 7, STAG) +
        endMark,
    ),
  ];
}

/**
 * 第 5 条那道波里的一枚：到了自己那一拍就缩小消失。
 *
 * 外面这一层和 `gone()` 是同一件事（淡出必须动在棋子外面，见 ra-gone 上的说
 * 明），只是把节奏换成第 k 拍——`.ra-gone` 的简写里带着 animation-name: ra-clear，
 * `.ra-w0…7` 在样式表里排在它后面，同特指度、后来居上，只改名字不改盒子。
 */
const sweep = (inner: string, k: number, extra = ''): string =>
  `<span class="ra-gone ra-w${k}${extra ? ' ' + extra : ''}">${inner}</span>`;

/**
 * 第 3 条：得分图案 4 → 3 → 2 → 1。
 *
 * 画的就是 HUD 上那块《得分图案》讲的同一件事（ui/patternBlock.ts）——横着一条
 * 同色的，每降一级末位那枚退场。所以这幅图不画棋盘上的事，它画的是「要凑的那个
 * 东西本身在缩短」。
 *
 * 退场顺序是从右往左（末位先走），和 HUD 上那块一致：那儿末位那枚的不透明度随
 * 本级剩余段数往下掉，掉到底就是这一枚消失。两处不一样的话，玩家会以为是两件事。
 */
function ladderArt(piece: (front: string, dot: string, cls?: string) => string): string {
  return board(
    piece(O, R) +
      `<span class="ra-gone ra-lad1">${piece(O, G)}</span>` +
      `<span class="ra-gone ra-lad2">${piece(O, M)}</span>` +
      `<span class="ra-gone ra-lad3">${piece(O, T)}</span>`,
    '',
    4,
  );
}

/**
 * 教学那五条的配图，一条一幅，下标就是条号减一。
 *
 * `shape: 'circle'` 时整套换成小球那一版（ballArt）——玩家的原话：「把逐步教学
 * 的图形从方块改为小球……教学的内容一样你只是把图形、反面样式更改」。三角没有
 * 自己的一套，走方块那一份。
 *
 * 从前这个函数还收一个 `triangle`，因为退役的第 1 幅要把方块/小球/三角并排画出
 * 来，小红书那一版得把三角那一列摘掉。那一幅没了，这个参数也就没有了意义——留
 * 着一个「传了也不起作用」的开关比删掉更难查。
 */
export function buildRuleArt(opts: { shape?: 'square' | 'circle' } = {}): string[] {
  const balls = opts.shape === 'circle' ? ballArt() : null;
  if (balls) return balls;
  return [
    // 1. 色块拼出得分图案会得分翻面：最右那列往上滑一格，橙色凑满一线 → 对勾 →
    //    四枚翻成星星，星星各是不同的颜色。
    board(
      tile(O, R, 'ra-flip') + tile(O, G, 'ra-flip') + tile(O, Y, 'ra-flip') + blank +
        tile(G, T) + tile(M, R) + tile(Y, G) + blank +
        slidingCol(tile(B, T), tile(O, M, 'ra-flip'), tile(B, T)) +
        arrowUp(3) + checksRow0,
    ),
    // 2. 星星可以和色块一同再拼一次：两枚绿星星 + 两枚绿色块凑成一线照样得分；
    //    只有色块那两枚翻过去。
    board(
      tile(G, G, 'ra-back') + tile(G, G, 'ra-back') + tile(G, R, 'ra-flip') + blank +
        tile(B, O) + tile(M, R) + tile(Y, G) + blank +
        slidingCol(tile(B, T), tile(G, T, 'ra-flip'), tile(B, T)) +
        arrowUp(3) + checksRow0,
    ),
    // 3. 得分图案会随着游戏解锁而变化：横着一条橙的，4 → 3 → 2 → 1。
    ladderArt(tile),
    // 4. 同色星星在外边得分并消除：四枚蓝星星排成一线 → 对勾 → 四枚一起缩小消失
    //    （玩家的原话：「四个点然后消失消除的动画」）。
    board(
      gone(tile(B, B, 'ra-back')) + gone(tile(B, B, 'ra-back')) + gone(tile(B, B, 'ra-back')) + gone(tile(B, B, 'ra-back')) +
        tile(O, R) + tile(M, G) + tile(G, T) + tile(Y, M) +
        checksRow0,
    ),
    // 5. 尝试全部消除：八枚星星一枚接一枚消掉，一枚不剩了才出「完成」。
    //
    //    从前这一幅画的是「八枚一枚接一枚**翻到反面**，全翻完出完成」——那是上一
    //    套规则里的终局。现在终局是一枚不剩（六副棋盘的 isGameOver），画翻面就是
    //    在教一个到不了的结束条件；玩家撞过一次同源的事故：结算页写着「全部已變
    //    成星星」，盘面上还躺着四颗同色蓝星。
    board(
      sweep(tile(B, R, 'ra-back'), 0) + sweep(tile(O, G, 'ra-back'), 1) +
        sweep(tile(M, T, 'ra-back'), 2) + sweep(tile(Y, R, 'ra-back'), 3) +
        sweep(tile(G, M, 'ra-back'), 4) + sweep(tile(B, O, 'ra-back'), 5) +
        sweep(tile(O, R, 'ra-back'), 6) + sweep(tile(M, G, 'ra-back'), 7) +
        endMark,
    ),
  ];
}

/**
 * 炸弹 / 无限反转 那两句首玩提示的配图（见 ui/modeTips.ts）。
 *
 * 和上面五条那一套是同一批零件（同一块小棋盘、同一种棋子、同一个周期），所以
 * 玩家在教学条里看熟的画法，换到这三个玩法的提示里还是那一套。
 */
/** 炸弹色。和棋盘上那一枚是同一个红（circle.ts / square.ts 的 BOMB_PALETTES）。 */
const RED = '#B3392B';
/**
 * 炸弹色那一枚身上的白色「！」。
 *
 * 棋盘上它是一个字（.hazard-mark 里那个 '!'，字号取棋子的一半）；这儿画成两块
 * 白色——一竖一点，和字一个样子，但不看设备上装了什么字体。玩家的原话：「炸弹
 * 的提示上放上与游戏中一样的感叹号」。
 */
const BANG =
  `<g fill="#FFFFFF"><rect x="43.5" y="21" width="13" height="37" rx="6.5"/>` +
  `<circle cx="50" cy="72" r="7.5"/></g>`;
/** 红方块 / 红小球，身上带那个「！」——就是棋盘上危险的那一枚。 */
const sqHazard =
  `<svg viewBox="0 0 100 100" aria-hidden="true">` +
  `<rect x="4" y="4" width="92" height="92" rx="20" fill="${RED}"/>${BANG}</svg>`;
const ballHazard =
  `<svg viewBox="0 0 100 100" aria-hidden="true">` +
  `<circle cx="50" cy="50" r="46" fill="${RED}"/>${BANG}</svg>`;
/** 炸开的那一下：和第 5 条的「完成」同一个位置、同一个节奏，只是换了张脸、大一圈。 */
const boomMark =
  `<svg class="ra-end ra-boom" viewBox="0 0 100 100" aria-hidden="true">` +
  `<path d="M50 3 L61 29 L88 19 L75 45 L97 58 L70 63 L76 93 L50 77 L24 93 L30 63 L3 58 L25 45 L12 19 L39 29 Z"` +
  ` fill="#D8452A" stroke="#FFF3E0" stroke-width="5" stroke-linejoin="round"/></svg>`;

/** 这两幅提示图按玩家挑的图形画：他点开炸弹时挑了方块，图里就是方块。 */
const pieceFor = (shape: 'square' | 'circle') =>
  shape === 'circle'
    ? (f: string, d: string, cls = '') => ball(f, d, cls)
    : (f: string, d: string, cls = '') => tile(f, d, cls);

/** 炸弹：一行四颗带「！」的红的挨在一起 → 一起没了 → 炸开。 */
export function bombTipArt(shape: 'square' | 'circle'): string {
  const p = pieceFor(shape);
  // 反面这一路走不到（这四枚只会淡出，不会翻过去），给一个正常的反面占位即可。
  const hazard = () =>
    shape === 'circle' ? svgTile(ballHazard, ballBack(RED)) : svgTile(sqHazard, sqBack(RED));
  return board(
    gone(hazard()) + gone(hazard()) + gone(hazard()) + gone(hazard()) +
      p(B, T) + p(G, M) + p(Y, O) + p(M, G) +
      boomMark,
  );
}

/** 无限反转：三枚图形正面 ↔ 反面来回翻，3 秒一次，一直翻下去。 */
export function flipTipArt(shape: 'square' | 'circle'): string {
  const p = pieceFor(shape);
  return board(
    p(O, O, 'ra-toss') + p(B, B, 'ra-toss') + p(G, G, 'ra-toss'),
    'ra-still ra-board--toss',
    3,
  );
}

/** 网页版用的那一份：三种图形都在。 */
export const RULE_ART: string[] = buildRuleArt();

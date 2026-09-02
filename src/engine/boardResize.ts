/**
 * Redraws a board whenever the box it lives in actually changes size.
 *
 * A window `resize` listener is not enough on a phone. Turning the device
 * fires resize while the viewport is still settling — Safari animates its
 * chrome and only then reports the final `100dvh` — so a board that
 * measures its panel at that moment lays itself out against the old, taller
 * box and comes out too big for the new one, and stays that way until
 * something else happens to trigger a render. (Which is why it looked fixed
 * "as soon as you touched it".)
 *
 * A ResizeObserver on the panel itself is the honest signal: it fires when
 * the panel is the size it is going to be, however many frames that takes.
 * The window listeners stay as a backstop for the browsers without one and
 * for changes that don't resize the panel at all.
 */
export function observeBoardSize(el: HTMLElement, redraw: () => void): () => void {
  let w = -1;
  let h = -1;
  const tick = () => {
    const r = el.getBoundingClientRect();
    // Nothing moved: skip, so a redraw that itself touches layout can never
    // feed back into another one.
    if (Math.abs(r.width - w) < 0.5 && Math.abs(r.height - h) < 0.5) return;
    w = r.width;
    h = r.height;
    redraw();
  };
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(tick) : null;
  ro?.observe(el);
  window.addEventListener('resize', tick);
  window.addEventListener('orientationchange', tick);
  return () => {
    ro?.disconnect();
    window.removeEventListener('resize', tick);
    window.removeEventListener('orientationchange', tick);
  };
}

/**
 * 地板（棋盘底下那块圆角面板）该多大。
 *
 * 玩家定的顺序，照这个顺序读这两个函数：
 *   1. 棋盘最大——它拿到那一格能给的全部空间；
 *   2. 图形在棋盘里最大；
 *   3. 图形已经最大之后，地板再大也不会让图形更大了，那就把地板尽量收成一个
 *      圆角正方形。
 *
 * 关键是第三条只在「不要钱」的时候才做。从前我把顺序弄反了：先把地板定成正
 * 方形，再让棋盘去将就它——七色圆球的菱形因此从 609px 宽缩到 303px，整整一
 * 半。现在是反过来的：棋盘先按整格算满，算完了才问一句「收成正方形装得下
 * 吗」，装得下就收，装不下就不收。
 */

/**
 * 量这一格本来有多大——先把我们自己上一轮压上去的尺寸摘掉。
 *
 * 不摘的话量到的是上一轮收出来的那个正方形，窗口变大也长不回去：地板会一轮
 * 比一轮小，直到看不见。每个玩法排版的第一句都该是这一句，而不是直接
 * getBoundingClientRect()。
 */
export function floorBox(wrap: HTMLElement): DOMRect {
  wrap.style.width = '';
  wrap.style.height = '';
  wrap.style.flex = '';
  wrap.style.margin = '';
  // 圆角也一起摘掉。下面 fitPanelRadius 会照这一轮的棋盘重算一个，而算的时
  // 候要读得到样式表里那个设计值——不摘的话读到的是上一轮自己写下的那个，
  // 于是圆角只会一轮比一轮小。
  wrap.style.borderRadius = '';
  return wrap.getBoundingClientRect();
}

/**
 * 地板的圆角，照着棋子来定。
 *
 * 毛病是这样的：地板是个圆角矩形，棋盘却是照着整格算满的，两者的方框一样大。
 * 于是角上那枚方块的方框虽然在地板的方框之内（差 2px），它的角却落在圆角那
 * 道弧的外面——量矩形量不出来，眼睛一看就是「这个游戏没做完」。
 *
 * 修的办法有两条，选了不花钱的那条：
 *
 *   甲、把棋盘缩进去几个像素，留出让弧线走的地方。代价是棋盘小一圈，而
 *       「游戏版图最大化」是第一原则。
 *   乙、把圆角收到「切不到棋子」为止。代价是各个玩法的圆角不再一样大——菱形
 *       方块的四个角本来就是空的，它保得住设计值；方块的四个角都顶着棋子，
 *       它就得收。这一条是玩家自己拍板的：「哪怕圆角不统一也要修复」。
 *
 * 算法（一个角一个角地算，所以 border-radius 是四个值不是一个）：
 *
 * 把这个角当原点。半径 R 的圆角，圆心在 (R, R)。一枚棋子离这个角最近的那个
 * 点是 (a, b)。它被切到，当且仅当 a < R 且 b < R 且 (R−a)² + (R−b)² > R²。
 * 解出来 R ≤ a + b + √(2ab)——这就是这枚棋子允许的最大圆角。四个角各取所有
 * 棋子里最小的那个，再和设计值取小。
 *
 * a、b 里还要把棋子自己的圆角算进去：一枚圆角为 r 的方块，它最外那个点不在
 * 方框的角上，而是沿对角线往里 r(1 − 1/√2)。不算这一项就白白少了几个像素，
 * 而这几个像素恰恰是圆角看起来还像不像圆角的那几个。
 */
const PIECE_SELECTOR = '.tile, .ball, .tri';
/** 一枚圆角为 r 的方块，它最外那个角点比方框的角往里缩多少。 */
const CORNER_PULL = 1 - Math.SQRT1_2;

export function fitPanelRadius(wrap: HTMLElement): void {
  const pieces = wrap.querySelectorAll<HTMLElement>(PIECE_SELECTOR);
  if (!pieces.length) return;
  const design = parseFloat(getComputedStyle(wrap).borderTopLeftRadius) || 0;
  if (!(design > 0)) return;

  // 一枚棋子的圆角就够了：同一个棋盘上它们长得一样。三角是 clip-path 画的，
  // 读到 0，那就当它是方的——保守一点，不会切到。
  const pieceR = parseFloat(getComputedStyle(pieces[0]).borderTopLeftRadius) || 0;
  const pull = pieceR * CORNER_PULL;

  const W = wrap.offsetWidth;
  const H = wrap.offsetHeight;
  if (!(W > 0) || !(H > 0)) return;
  // 顺序照 CSS 的 border-radius：左上、右上、右下、左下。
  const limit = [design, design, design, design];

  for (const p of pieces) {
    const box = offsetIn(p, wrap);
    if (!box || box.w <= 0 || box.h <= 0) continue;
    const left = box.x + pull;
    const top = box.y + pull;
    const right = W - (box.x + box.w) + pull;
    const bottom = H - (box.y + box.h) + pull;
    limit[0] = Math.min(limit[0], maxRadius(left, top, design));
    limit[1] = Math.min(limit[1], maxRadius(right, top, design));
    limit[2] = Math.min(limit[2], maxRadius(right, bottom, design));
    limit[3] = Math.min(limit[3], maxRadius(left, bottom, design));
  }

  // 没被任何棋子管到的角，原样保留设计值——那些角本来就是空的（菱形方块的
  // 四个角就是），没有理由为了取整少掉一个像素。被管到的才往下取整再退半格，
  // 亚像素的舍入不该把一枚棋子露在外面。
  if (limit.every((r) => r >= design)) return;
  const px = limit.map((r) => (r >= design ? design : Math.max(0, Math.floor(r - 0.5))));
  wrap.style.borderRadius = `${px[0]}px ${px[1]}px ${px[2]}px ${px[3]}px`;
}

/**
 * 棋子在地板里的位置——量的是排版排到哪儿，不是这一帧画在哪儿。
 *
 * 差别在 transform 上。得分收拢、拖动、落位弹一下，这些都是给棋子挂一个
 * transform，getBoundingClientRect() 会把它算进去。平时无所谓（排版跑的时候
 * 没有动画在跑），但「消行动画演到一半，人把手机转了个方向」这一下就撞上了：
 * 那一帧某枚棋子正飘在地板外面，圆角照着它算就成了 0，而且要等到下次转屏才
 * 会重算——一个方棱棱的角就这么留在那儿。offsetLeft 这条线读的是排版位置，
 * 从头到尾不认 transform，那一下就撞不上了。
 *
 * 顺带还准一点：整局最紧的是方块那一档（棋子离边正好 2px），而它的
 * offsetLeft / offsetWidth 都是整数，读出来分毫不差。
 *
 * 走不到 wrap 就返回 null（理论上不会——.board-wrap 是 position: relative，
 * 一定在 offsetParent 链上；但链子断了的时候少算一枚棋子，比算错一个角好）。
 */
function offsetIn(el: HTMLElement, root: HTMLElement): { x: number; y: number; w: number; h: number } | null {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  for (let hop = 0; node && node !== root && hop < 16; hop++) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  if (node !== root) return null;
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

/** 这一枚棋子允许这个角有多圆。推导见上。 */
function maxRadius(a: number, b: number, design: number): number {
  // 离得够远就管不着这个角——它的两个坐标里有一个不小于 R，那条件根本不成立。
  if (a >= design || b >= design) return design;
  if (a <= 0 || b <= 0) return 0;
  return a + b + Math.sqrt(2 * a * b);
}

/**
 * 排完版之后叫一声：把地板收成正方形，前提是这不会动到棋盘。
 *
 * boardW / boardH 是棋盘那个元素自己的框（不是格子的尺寸，也不是图形画出来
 * 的那一块——地板收得比元素还小的话，元素会顶出地板）。边长取两
 * 者的大者，所以正方形一定装得下棋盘；而棋盘的尺寸本来就是照着整格算满的，
 * 收到这个边长之后再算一遍，得到的比例分毫不变——数学上是这样：棋盘的两边是
 * K₁·R 和 K₂·R，边长 = R·max(K₁,K₂)，再算一次得到的
 * R' = 边长 / max(K₁,K₂) = R。
 *
 * 装不下（比如躺着的菱形比这一格的高度还宽）就什么都不做，地板保持整格——那
 * 时候「方」已经要拿棋盘的大小去换了，而那是第一条。
 *
 * 居中用 margin: auto，不用 align-self：竖屏那一列的交叉轴是横的，一句
 * align-self: center 会让地板在没被钉住尺寸的那一瞬间横向塌成内容宽，
 * 下一次量格子就量错了。
 */
export function squareFloor(wrap: HTMLElement, boardW: number, boardH: number): void {
  // 圆角要等棋子画出来才算得了，而排版跑在渲染之前——所以推到下一帧。八个玩
  // 法排版的最后一句都是这一行，写在这儿等于八处都接上了，一处都不用改。
  requestAnimationFrame(() => fitPanelRadius(wrap));

  const rect = wrap.getBoundingClientRect();
  const side = Math.max(boardW, boardH);
  if (!(side > 0) || side > rect.width + 0.5 || side > rect.height + 0.5) return;
  wrap.style.width = side + 'px';
  wrap.style.height = side + 'px';
  wrap.style.flex = '0 0 auto';
  wrap.style.margin = 'auto';
}

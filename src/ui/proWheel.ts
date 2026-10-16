/**
 * 《Pro》颜色关系轮盘（站长 2026-10-14 定的新 Pro，10-15 补充 S10：K-4）。
 *
 * 这一局的每一色按调色板序号顺时针围一圈，形状 = 这副棋盘的棋子形状；白色虚线箭头从 i 指向 next(i)
 * （engine/proCycle.ts 那一圈）。**某一色的正面色块在场上一枚都不剩时，从它出发的箭头淡出**（400ms，减弱动态时
 * 直接消失）；无限反转里色块翻回来，箭头跟着回来。
 *
 * 几何照站长选定的样品「甲·花环」，数一个都不改（见 draw）。
 *
 * 摆放（fit）：
 *   · 竖屏：放进棋盘和暂停牌之间那段空当（流里，最大 136）；放不下退到棋盘空角（position:fixed，垫一块底色圆片，
 *     最大 120）；空角也不到 48 才不显示。
 *   · 横屏（矮）：放在棋盘右边、按键栏左边那段空当里，和地板竖直居中；空当不如空角就退空角。
 *   · 电脑：位置交给样式表（右栏，和分数牌对称，194；教学条露着的那几局缩到 136 贴右栏底），教学条和它相交才藏。
 * ⚠️ 退到空角或不显示时，一定是 display:none 或 position:fixed，**不能只把高设成 0**：一个 0 高的块留在文档流里
 * 也会多出一道 gap，七色小球会缩 5–11px（实测过）。
 *
 * ⚠️ 这个模块也打进小红书的包（Chrome 61，没有 ResizeObserver）：模块顶层不调 matchMedia / ResizeObserver，用之前
 * 先判断有没有。小红书那一版从不开 Pro，所以这儿从来不会被 show——但 import 本身不能抛。
 */
import { onColorblindChange } from '../engine/palettePref';

export type WheelShape = 'square' | 'diamond' | 'ball' | 'tri';

export interface ProView {
  shape: WheelShape;
  /** 这一局正在用的调色板（标准 / 色盲 / 棋子配色），按序号。 */
  palette: readonly string[];
  /** 这一圈：调色板序号，k → k+1 就是一枚箭头。 */
  cycle: readonly number[];
  /** 场上还有正面色块的那几色（调色板序号）。 */
  left: ReadonlySet<number>;
}

export interface ProWheel {
  show(v: ProView): void;
  sync(v: ProView): void;
  hide(): void;
  destroy(): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** n 色时每一枚多大（viewBox 200 里）。样品上量的，别改。 */
const ITEM_SIZE: Record<number, number> = { 3: 78, 4: 72, 5: 66, 6: 62, 7: 56 };

/** 手机上最大边长、最小边长（小于它就不显示）。 */
const PHONE_MAX = 136;
const MIN_SIDE = 48;
/** 退到棋盘空角时：离地板边内缩多少、离每一枚棋子至少多远、最大多大。 */
const CORNER_INSET = 6;
const PIECE_CLEAR = 4;
const CORNER_MAX = 120;
/** 竖屏那段空当里，轮盘上下至少留出的余量（两边合计）。 */
const FLOW_SLACK = 24;
/** 叠在棋盘上（空角）时，每一步结算完隔多久重新找一次角：棋子消掉、放大之后最好的那个角可能变了。 */
const OVERLAY_REFIT_MS = 450;

const DESKTOP_MQ = '(min-width: 1000px) and (min-height: 561px)';
const LANDSCAPE_MQ = '(orientation: landscape) and (max-height: 560px)';
const PIECE_SELECTOR = '.tile, .ball, .tri';

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) node.setAttribute(k, String(attrs[k]));
  return node;
}

const f2 = (n: number) => (Math.round(n * 100) / 100).toString();

function mq(query: string): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

/** 画一只轮盘。px 是它在屏幕上实际的边长：箭头线宽有个下限（太小的轮盘上细线会糊成一片）。 */
function draw(v: ProView, px: number): SVGSVGElement {
  const n = v.cycle.length;
  const svg = el('svg', { viewBox: '0 0 200 200', 'aria-hidden': 'true', focusable: 'false' });
  if (n < 2) return svg;
  const ball = v.shape === 'ball';
  const S = ITEM_SIZE[n] ?? (n < 3 ? 78 : 56);
  const d = S / (ball ? 1.25 : 1.1);
  const R = d / (2 * Math.sin(Math.PI / n));
  const step = (2 * Math.PI) / n;
  const angle = (k: number) => -Math.PI / 2 + k * step;
  const at = (a: number, r = R): [number, number] => [100 + r * Math.cos(a), 100 + r * Math.sin(a)];

  for (let k = 0; k < n; k++) {
    const [cx, cy] = at(angle(k));
    const fill = v.palette[v.cycle[k]] ?? '#999';
    const g = el('g', { class: 'wh-item', 'data-i': k, opacity: 0.92 });
    if (v.shape === 'ball') {
      g.appendChild(el('circle', { cx: f2(cx), cy: f2(cy), r: f2(S / 2), fill }));
    } else if (v.shape === 'square') {
      g.appendChild(el('rect', { x: f2(cx - S / 2), y: f2(cy - S / 2), width: f2(S), height: f2(S), rx: f2(S * 0.17), fill }));
    } else if (v.shape === 'diamond') {
      const a = S * 0.72;
      g.appendChild(
        el('rect', {
          x: f2(cx - a / 2),
          y: f2(cy - a / 2),
          width: f2(a),
          height: f2(a),
          rx: f2(S * 0.08),
          transform: `rotate(45 ${f2(cx)} ${f2(cy)})`,
          fill,
        }),
      );
    } else {
      // 圆角三角：同色描边 + 圆角接头，把三个尖磨圆。
      const sw = S * 0.14;
      const h = S * 0.84;
      const w = S * 0.94;
      const top = cy - 0.62 * h;
      const bot = cy + 0.38 * h;
      const pts = [
        [cx, top + 0.5 * sw],
        [cx + w / 2 - 0.45 * sw, bot - 0.25 * sw],
        [cx - w / 2 + 0.45 * sw, bot - 0.25 * sw],
      ]
        .map(([x, y]) => f2(x) + ',' + f2(y))
        .join(' ');
      g.appendChild(el('polygon', { points: pts, fill, stroke: fill, 'stroke-width': f2(sw), 'stroke-linejoin': 'round' }));
    }
    svg.appendChild(g);
  }

  // 箭头画在色块上面：白色虚线弧（顺时针），尖在弧的末端、方向沿切线。
  const sw = Math.max(S * 0.065, px > 0 ? (1.6 * 200) / px : 0);
  const hl = S * 0.24;
  for (let k = 0; k < n; k++) {
    const a0 = angle(k) + 0.2 * step;
    const a1 = angle(k) + 0.8 * step;
    const [x0, y0] = at(a0);
    const [x1, y1] = at(a1);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const g = el('g', { class: 'wh-arrow', 'data-i': k });
    g.appendChild(
      el('path', {
        d: `M ${f2(x0)} ${f2(y0)} A ${f2(R)} ${f2(R)} 0 ${large} 1 ${f2(x1)} ${f2(y1)}`,
        fill: 'none',
        stroke: '#FFFFFF',
        'stroke-width': f2(sw),
        'stroke-linecap': 'round',
        'stroke-dasharray': `${f2(1.6 * sw)} ${f2(2.1 * sw)}`,
      }),
    );
    const t = angle(k) + 0.84 * step;
    const [tx, ty] = at(t);
    // 切线方向（顺时针）= 角度 + π/2。
    const ux = -Math.sin(t);
    const uy = Math.cos(t);
    const bx = tx - hl * ux;
    const by = ty - hl * uy;
    const half = (0.82 * hl) / 2;
    const head = [
      [tx, ty],
      [bx + half * Math.cos(t), by + half * Math.sin(t)],
      [bx - half * Math.cos(t), by - half * Math.sin(t)],
    ]
      .map(([x, y]) => f2(x) + ',' + f2(y))
      .join(' ');
    g.appendChild(
      el('polygon', {
        points: head,
        fill: '#FFFFFF',
        stroke: '#FFFFFF',
        'stroke-width': f2(0.18 * hl),
        'stroke-linejoin': 'round',
      }),
    );
    svg.appendChild(g);
  }
  return svg;
}

/** 一个点到一个矩形的距离（点在矩形里就是 0）。 */
function distToRect(x: number, y: number, r: DOMRect): number {
  const dx = Math.max(r.left - x, 0, x - r.right);
  const dy = Math.max(r.top - y, 0, y - r.bottom);
  return Math.sqrt(dx * dx + dy * dy);
}

interface Corner {
  side: number;
  left: number;
  top: number;
}

/**
 * 棋盘四个角里最大的那块空地：依次试右下、右上、左下、左上；圆心 = 角内缩 6 + s/2，要求圆心到每一枚棋子外接矩形
 * 的距离 ≥ s/2 + 4。取最大的 s（≤ 120）；一样大取先试的那个角。
 */
function bestCorner(floor: DOMRect, pieces: DOMRect[]): Corner {
  let best: Corner = { side: 0, left: 0, top: 0 };
  const corners: Array<[boolean, boolean]> = [
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ];
  for (const [right, bottom] of corners) {
    for (let s = Math.min(CORNER_MAX, Math.floor(Math.min(floor.width, floor.height) - 2 * CORNER_INSET)); s > best.side; s--) {
      const cx = right ? floor.right - CORNER_INSET - s / 2 : floor.left + CORNER_INSET + s / 2;
      const cy = bottom ? floor.bottom - CORNER_INSET - s / 2 : floor.top + CORNER_INSET + s / 2;
      const need = s / 2 + PIECE_CLEAR;
      if (pieces.every((p) => distToRect(cx, cy, p) >= need)) {
        best = { side: s, left: cx - s / 2, top: cy - s / 2 };
        break;
      }
    }
  }
  return best;
}

export function mountProWheel(host: HTMLElement, label: string, pull?: () => ProView | null): ProWheel {
  host.setAttribute('aria-label', label);
  let view: ProView | null = null;
  /** 画出来那一版的配色、形状、这一圈、实际边长——变了才重画。 */
  let drawnKey = '';
  let shown = false;
  /** 现在是不是叠在棋盘上（空角）：是的话每一步结算完要重新找角。 */
  let overlay = false;
  let refitTimer = 0;
  let rafA = 0;
  let rafB = 0;

  const app = host.parentElement;
  const floorEl = () => app?.querySelector<HTMLElement>('#boardWrap') ?? null;

  function sideNow(): number {
    const r = host.getBoundingClientRect();
    return Math.min(r.width, r.height);
  }

  function paint(): void {
    if (!view) return;
    const px = Math.round(sideNow());
    const key = view.shape + '|' + view.palette.join(',') + '|' + view.cycle.join(',') + '|' + px;
    if (key !== drawnKey) {
      drawnKey = key;
      host.textContent = '';
      host.appendChild(draw(view, px));
    }
    const arrows = host.querySelectorAll<SVGGElement>('.wh-arrow');
    arrows.forEach((g) => {
      const k = Number(g.getAttribute('data-i'));
      const off = !view!.left.has(view!.cycle[k]);
      // classList.toggle(name, force) 在 SVG 元素上老内核也认；这儿不用 toggleAttribute。
      if (off) g.classList.add('wh-arrow--off');
      else g.classList.remove('wh-arrow--off');
    });
  }

  function setBox(side: number, left?: number, top?: number): void {
    host.style.width = side + 'px';
    host.style.height = side + 'px';
    if (left !== undefined) host.style.left = f2(left) + 'px';
    if (top !== undefined) host.style.top = f2(top) + 'px';
  }

  function piecesIn(floor: HTMLElement): DOMRect[] {
    return Array.from(floor.querySelectorAll<HTMLElement>(PIECE_SELECTOR)).map((p) => p.getBoundingClientRect());
  }

  /** 竖屏那一列里，从顶排到按键排、相邻两个看得见的子项之间空着多少（减掉 gap），逐道加起来。 */
  function freeInColumn(column: HTMLElement): number {
    const kids = Array.from(column.children) as HTMLElement[];
    const from = kids.findIndex((k) => k.classList.contains('hud'));
    const to = kids.findIndex((k) => k.classList.contains('controls'));
    if (from < 0 || to < from) return 0;
    const gap = parseFloat(getComputedStyle(column).rowGap || '0') || 0;
    let free = 0;
    let prev: DOMRect | null = null;
    for (let i = from; i <= to; i++) {
      const k = kids[i];
      if (k.getClientRects().length === 0) continue;
      const pos = getComputedStyle(k).position;
      if (pos === 'fixed' || pos === 'absolute') continue;
      const r = k.getBoundingClientRect();
      if (prev) free += Math.max(0, r.top - prev.bottom - gap);
      prev = r;
    }
    return free;
  }

  function placeCorner(floor: HTMLElement): boolean {
    const c = bestCorner(floor.getBoundingClientRect(), piecesIn(floor));
    if (c.side < MIN_SIDE) return false;
    host.classList.add('pro-wheel--fixed', 'pro-wheel--corner');
    setBox(c.side, c.left, c.top);
    overlay = true;
    return true;
  }

  function fit(): void {
    window.clearTimeout(refitTimer);
    if (!shown || !app) return;
    host.classList.remove('pro-wheel--off', 'pro-wheel--fixed', 'pro-wheel--corner');
    host.style.width = '';
    host.style.height = '';
    host.style.left = '';
    host.style.top = '';
    overlay = false;
    const floor = floorEl();

    if (mq(DESKTOP_MQ)) {
      // 位置、大小都在样式表里。教学条露着、又和它碰上了，就藏起来（教学条比轮盘要紧）。
      const coach = app.querySelector<HTMLElement>('.coach-bar');
      if (coach && !coach.hidden) {
        const a = coach.getBoundingClientRect();
        const b = host.getBoundingClientRect();
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) host.classList.add('pro-wheel--off');
      }
      paint();
      return;
    }

    if (!floor) {
      host.classList.add('pro-wheel--off');
      return;
    }

    if (mq(LANDSCAPE_MQ)) {
      // 样式表已经把它拿出流（position:fixed）。棋盘右边、按键栏左边那段空当。
      const fr = floor.getBoundingClientRect();
      const controls = app.querySelector<HTMLElement>('.controls');
      const cr = controls?.getBoundingClientRect();
      const colGap = parseFloat(getComputedStyle(app).columnGap || '0') || 0;
      const zone = cr ? cr.left - colGap - fr.right : 0;
      const side = Math.floor(Math.min(PHONE_MAX, zone - 12, fr.height));
      const corner = bestCorner(fr, piecesIn(floor));
      if (side < MIN_SIDE && corner.side < MIN_SIDE) {
        host.classList.add('pro-wheel--off');
        return;
      }
      if (side >= corner.side) {
        host.classList.add('pro-wheel--fixed');
        setBox(side, fr.right + (zone - side) / 2, fr.top + (fr.height - side) / 2);
      } else {
        host.classList.add('pro-wheel--fixed', 'pro-wheel--corner');
        setBox(corner.side, corner.left, corner.top);
        overlay = true;
      }
      paint();
      return;
    }

    // 竖屏：先设成 0×0 留在流里量空当（用矩形相减，不读 auto 外边距的计算值）。
    host.style.width = '0px';
    host.style.height = '0px';
    const s = Math.min(PHONE_MAX, Math.floor(freeInColumn(app) - FLOW_SLACK));
    if (s >= MIN_SIDE) {
      setBox(s);
      paint();
      return;
    }
    // 流里放不下：先出流（--fixed），再量地板和棋子——出流之后那道 gap 没了，棋盘的位置会挪一点。
    host.classList.add('pro-wheel--fixed');
    if (!placeCorner(floor)) {
      host.classList.remove('pro-wheel--fixed');
      host.classList.add('pro-wheel--off');
      return;
    }
    paint();
  }

  /** 窗口变了：先立刻藏起来（别让旧位置压在新排版上），等两帧排版落定再摆。 */
  function onViewport(): void {
    if (!shown) return;
    host.classList.add('pro-wheel--off');
    cancelAnimationFrame(rafA);
    cancelAnimationFrame(rafB);
    rafA = requestAnimationFrame(() => {
      rafB = requestAnimationFrame(fit);
    });
  }

  let ro: ResizeObserver | null = null;
  let mo: MutationObserver | null = null;
  let roSkip = 0;
  const lastSizes = new Map<Element, string>();

  function watch(): void {
    window.addEventListener('resize', onViewport);
    window.addEventListener('orientationchange', onViewport);
    const coach = app?.querySelector('.coach-bar');
    if (coach && typeof MutationObserver === 'function') {
      mo = new MutationObserver(() => {
        if (shown) requestAnimationFrame(fit);
      });
      mo.observe(coach, { attributes: true, attributeFilter: ['hidden', 'class'], childList: true, subtree: true });
    }
    if (typeof ResizeObserver === 'function' && app) {
      // 只在尺寸真的变了才重摆：fit 自己改轮盘大小也可能让 .app--game 的观察者报一次，同一个尺寸报过就不理。
      ro = new ResizeObserver((entries) => {
        if (!shown) return;
        let changed = false;
        for (const e of entries) {
          const r = e.contentRect;
          const key = Math.round(r.width) + 'x' + Math.round(r.height);
          if (lastSizes.get(e.target) !== key) {
            lastSizes.set(e.target, key);
            changed = true;
          }
        }
        if (!changed || roSkip > 0) return;
        roSkip++;
        requestAnimationFrame(() => {
          roSkip = 0;
          fit();
        });
      });
      ro.observe(app);
      const floor = floorEl();
      if (floor) ro.observe(floor);
    }
  }

  function unwatch(): void {
    window.removeEventListener('resize', onViewport);
    window.removeEventListener('orientationchange', onViewport);
    mo?.disconnect();
    mo = null;
    ro?.disconnect();
    ro = null;
    lastSizes.clear();
  }

  // 局中拨色盲友好：棋盘换一套颜色，轮盘也跟着换（配色是现取的）。
  const stopColorblind = onColorblindChange(() => {
    if (!shown || !pull) return;
    const next = pull();
    if (next) {
      view = next;
      paint();
    }
  });

  function hide(): void {
    if (!shown) {
      host.hidden = true;
      return;
    }
    shown = false;
    unwatch();
    window.clearTimeout(refitTimer);
    cancelAnimationFrame(rafA);
    cancelAnimationFrame(rafB);
    host.hidden = true;
    host.classList.remove('pro-wheel--off', 'pro-wheel--fixed', 'pro-wheel--corner');
    host.style.width = '';
    host.style.height = '';
    host.style.left = '';
    host.style.top = '';
  }

  return {
    show(v) {
      view = v;
      drawnKey = '';
      if (!shown) {
        shown = true;
        host.hidden = false;
        watch();
      }
      fit();
      paint();
    },
    sync(v) {
      if (!shown) return;
      view = v;
      paint();
      if (overlay) {
        window.clearTimeout(refitTimer);
        refitTimer = window.setTimeout(fit, OVERLAY_REFIT_MS);
      }
    },
    hide,
    destroy() {
      hide();
      stopColorblind();
      host.textContent = '';
      drawnKey = '';
      view = null;
    },
  };
}

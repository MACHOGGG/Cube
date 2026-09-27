/**
 * The splash: a rounded square window onto a ball board much larger than
 * itself, playing slide → score → flip before the app appears.
 *
 * Three things separate this from the boards in src/shapes:
 *
 * 1. Nothing here follows a finger, so the travel can be *authored* — an
 *    eased drive through the board's own magnetize curve, so the line still
 *    detents into each slot the way a real drag does.
 * 2. The balls in the sliding line are sprung to each other, not moved as a
 *    rigid block: each one's target is a blend of the authored drive and its
 *    predecessor's live position, so a wave runs down the line and the tail
 *    keeps swinging for a beat after the head has seated.
 * 3. The lines either side get entrained — dragged a little along the slide
 *    axis in proportion to the moving line's velocity, then sprung home.
 *
 * All of it integrates on one fixed-step loop; anime.js drives the authored
 * scalars (the travel, the flip's keyframes) and the physics reads them.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 2026-09-27 换了一版（玩家给的那份文件包）
 *
 * 得分的那一组从 2×2 改成**斜线上的 1×4**，动作从「一条横线一次滑两格」改成
 * **两次各滑一格的斜向滑动**，取景框放大、球缩小。
 *
 * 改的理由是这一版的规则：得分图案只剩 1×N 一种（《侵蚀阶梯》v1.2 §1），开场
 * 动画再演一个 2×2 就是在演一件游戏里不存在的事——它是新玩家看见的第一样东西。
 *
 * **时钟一个数都没动**：总时长 2800ms，得分 1600ms，翻面 2080ms 起、每颗隔
 * 72ms，淡出 2592ms。两步滑动合起来正好占满原先那一次滑动的窗口（200–1400），
 * 中间空 80ms 让第一条线落稳。手感那一串常数（弹簧、碰撞、带动、翻面）逐字照
 * 旧，所以「这个游戏摸起来什么样」一点没变，变的只是它在演哪一条规则。
 *
 * 棋盘换成 10×13（下面的 FRONT / DOT，种子 2302）。玩家那边用和本作一致的
 * 「1×N 同色连线」判定逐状态核过：开局没有任何 4 连，第 1 步之后仍然没有，第 2
 * 步之后**恰好一个**——就是 (3,3)(4,4)(5,5)(6,6) 那四颗；翻面之后的星星色是
 * 蓝/金/绿/蓝，不会再连出新的 4 连。
 *
 * 两项无障碍处理原样留着，它们不在那份影片版里，接进来必须自己补回：
 *   · 色盲友好配色跟着 colorblindOn() 走（见 COLOR_SETS）；
 *   · prefers-reduced-motion 时不播滑动和翻面，直接摆出落定、翻好的结果。
 */
import { animate } from 'animejs';
import { playMove, playScore, playFlip } from '../engine/juice';
import { colorblindOn } from '../engine/palettePref';

// ---------------------------------------------------------------------------
// Tunables. The frame side is expressed in ball diameters because that is the
// constraint that actually matters: the scoring pattern has to fit inside it.
// 2×2 是 2.61 个直径，**斜着的 1×4 是 3.79 个**——所以这个数从 2.75 抬到 3.95，
// 框里多看见一圈棋盘，球本身反而小了约 16%（玩家要的「整体画面大一点、小球小
// 一点」）。
// ---------------------------------------------------------------------------
const SIDE_IN_BALLS = 3.95;

/** 整段开场放多快。1 是原速，1.25 是现在——每一个时刻和每一段时长都
 *  一起除以它，所以节奏的比例分毫不变，只是整段跑得快了四分之一。
 *  要调回去改这一个数就够，底下那串数字是「原速下的毫秒」，不用动。 */
const SPEED = 1.25;
const fast = (ms: number) => Math.round(ms / SPEED);

const TOTAL_MS = fast(3500);

const T_SLIDE = fast(250);     // travel starts
const D_SLIDE = fast(1500);    // …and the whole travel window is this long
/** 两步之间喘的那一口：让第一条线落稳再动第二条。 */
const GAP = 80;
/** 一步滑多久。两步加上中间那一口气，正好填满 D_SLIDE。 */
const D_MOVE = (D_SLIDE - GAP) / 2;
const MOVES_T = [T_SLIDE, T_SLIDE + D_MOVE + GAP];
const T_SCORE = fast(2000);    // outlines flash
const T_FLIP = fast(2600);     // faces turn over
const FLIP_STAGGER = fast(90);
const FLIP_MS = fast(530);   // ~1.5x the game's 340ms — heavier, still brisk
const T_OUT = fast(3240);      // splash fades

// The flip's feel, all as fractions of the piece so it reads the same at any
// size. The old code inherited perspective(300px) from the CSS keyframes,
// which is 5.7x a 53px game ball but only 3.3x a 91px splash ball — the same
// animation looked flat in game and solid here purely because of the piece's
// size. These are ratios, so it cannot drift again.
const THICK = 0.020;        // face separation in Z, x piece diameter
const PERSPECTIVE = 3.3;    // viewing distance, x piece diameter
const LIFT = 0.050;         // how far it rises toward the viewer mid-turn
const OVERSHOOT = 26;       // degrees past the half-turn before it rocks back
const SHADOW = 0.46;        // peak opacity of the cast shadow
const GROUND = '#FFFFFF';   // the frame's own surface, so a back face reads as flat

/**
 * A piece rolls about the axis perpendicular to the way its line travelled,
 * so its leading edge dives away from the viewer. Rather than build that axis
 * per case, the plank always turns about its own Y and the whole turn is
 * conjugated by a Z rotation of the travel angle:
 *   rotateZ(f) rotateY(t) rotateZ(-f)
 * which is exactly a turn about the axis at f + 90 degrees, so one
 * construction covers horizontal, vertical and diagonal moves alike.
 *
 * The direction is a flourish in the air only: where a piece lands must not
 * depend on which way it rolled. That is not automatic. A half-turn about any
 * in-plane axis is, seen flat on, a mirror across that axis — roll a piece
 * about the horizontal and it lands upside down, about a diagonal and it
 * lands cocked over. Round pieces hide it; a triangle does not, and neither
 * would the boards in src/shapes, where a turned-over piece has to keep the
 * lattice orientation it started with.
 *
 * No rotation can undo a mirror, so it is undone by the only thing that can:
 * the back face is built already carrying that same half-turn. The plank then
 * turns through it, HALF_TURN lands on HALF_TURN, and the two cancel exactly —
 * the settled piece sits in its rest pose with nothing changed but its face.
 * It is what a real double-sided chip printed to land upright would look like.
 */
function rollAngleDeg(dx: number, dy: number): number {
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

// Physics. COUPLE is how much of each ball's target comes from the ball ahead
// of it rather than from the authored drive: 0 is a rigid block, 1 is a pure
// chain (which drifts). K/C are the spring and damping on that pull.
const COUPLE = 0.55;
const K = 260;
const C = 26;
// Contact. These discs are 1.86R across on a 2R pitch, so there is only
// 0.07 of a slot of daylight between neighbours — a spring chain that ignores
// that will happily push them through each other on the rebound (measured:
// 21px of interpenetration on a 91px ball). Positions are clamped to that
// clearance and the contact is inelastic, with the squeeze shown as a small
// squash along the axis instead of an overlap.
const CLEARANCE = 1 - 1.86 / 2;
const SQUASH = 0.9;

// Entrainment of the neighbouring lines, and how far it reaches.
const ENTRAIN = 0.030;
const K_N = 190;
const C_N = 17;
const REACH = [0, 1, 0.45, 0.18];

// Verbatim from src/shapes/circle.ts — PALETTES.standard, with the four
// Okabe–Ito hues the boards themselves switch to beside it: the opening
// animation is the first thing anyone sees, so it follows the colourblind
// setting like every other screen.
const COLOR_SETS = {
  standard: ['#C0666B', '#DDA857', '#7A9C4A', '#4F72C4'],
  colorblind: ['#D55E00', '#E69F00', '#009E73', '#0072B2'],
} as const;
const COLORS: readonly string[] = COLOR_SETS[colorblindOn() ? 'colorblind' : 'standard'];

/**
 * 这副棋盘：10 行 × 13 列，远大于那扇窗，所以框外还有一圈接得上的棋盘——被顶出
 * 框的球和补进来的球都是真的，不是凭空生灭。颜色编号 0 粉 / 1 金 / 2 绿 / 3 蓝。
 *
 * 玩家那边按和本作一致的判定逐状态核过（横、竖、斜三个方向全查）：开局没有 4
 * 连，第 1 步后没有，第 2 步后**恰好一个**（就是 SCORERS 那四格），翻面后也不会
 * 连出新的。粉色只出现在参与得分的那四颗上，其余三色在框里各露 4 颗。
 */
const FRONT: readonly (readonly number[])[] = [
  [0, 2, 3, 2, 1, 0, 3, 3, 0, 3, 1, 0, 2],
  [0, 3, 1, 0, 1, 3, 3, 2, 2, 1, 2, 1, 0],
  [3, 2, 1, 3, 2, 1, 0, 2, 2, 0, 1, 1, 0],
  [2, 0, 2, 0, 1, 3, 2, 1, 1, 0, 3, 0, 3],
  [3, 0, 3, 0, 0, 2, 3, 3, 2, 1, 3, 3, 1],
  [1, 1, 2, 1, 3, 0, 1, 1, 3, 1, 0, 3, 1],
  [1, 0, 3, 2, 1, 2, 3, 2, 0, 0, 3, 1, 2],
  [0, 3, 0, 0, 3, 3, 1, 2, 0, 2, 0, 1, 2],
  [3, 2, 0, 3, 2, 3, 1, 3, 2, 2, 1, 2, 1],
  [2, 0, 3, 0, 3, 2, 2, 1, 2, 3, 1, 3, 1],
];
const DOT: readonly (readonly number[])[] = [
  [3, 3, 0, 3, 2, 3, 0, 0, 3, 2, 2, 2, 3],
  [2, 2, 2, 1, 3, 1, 0, 3, 3, 3, 1, 2, 2],
  [1, 1, 2, 0, 1, 2, 1, 1, 1, 3, 2, 0, 1],
  [1, 2, 1, 1, 2, 0, 0, 2, 2, 3, 1, 3, 0],
  [2, 3, 1, 3, 2, 1, 1, 0, 3, 0, 0, 2, 0],
  [3, 3, 0, 2, 1, 3, 2, 0, 0, 2, 2, 0, 2],
  [3, 2, 1, 1, 0, 1, 1, 0, 2, 3, 2, 3, 0],
  [2, 0, 3, 2, 2, 1, 0, 3, 1, 0, 1, 0, 3],
  [0, 1, 1, 0, 1, 0, 2, 0, 1, 1, 3, 0, 3],
  [3, 1, 1, 3, 0, 1, 0, 3, 3, 1, 0, 1, 2],
];
const ROWS = FRONT.length;
const COLS = FRONT[0].length;

/** 两步走完之后连成一线的那四格（斜着的 1×4）。 */
const SCORERS: readonly [number, number][] = [[3, 3], [4, 4], [5, 5], [6, 6]];
/** 第 2 步动的是这一颗所在的那条线——左边那颗粉球。 */
const LEFT_BALL: readonly [number, number] = [4, 3];

/**
 * 这副三角格子里的「一条线」有两族，两族都是屏幕上的斜线：
 *
 *   dr  —— c − r 不变。往下一格、往右一格，屏幕上是**右下**。
 *   col —— c 不变。往上一格，屏幕上是**右上**（因为每往上一行整排右移半格）。
 *
 * 这两条正是棋盘上小球真的能拖的两个方向，所以开场演的滑动和玩家进去之后手指
 * 做的是同一件事。
 */
type Family = 'dr' | 'col';

/** src/engine/drag.ts — the detent curve every board slides through. */
function magnetize(x: number, power = 2.2): number {
  const nearest = Math.round(x);
  const t = (x - nearest) * 2;
  return nearest + (Math.sign(t) * Math.abs(t) ** power) / 2;
}

/** src/shapes/circle.ts — the dot face, three crossing strokes. */
function starSVG(size: number, color: string): string {
  const s = Math.round(size * 0.95);
  return (
    `<svg viewBox="0 0 24 24" width="${s}" height="${s}">` +
    `<g stroke="${color}" stroke-width="5.5" stroke-linecap="round">` +
    `<line x1="12" y1="2.5" x2="12" y2="21.5"/>` +
    `<line x1="4" y1="6.75" x2="20" y2="17.25"/>` +
    `<line x1="20" y1="6.75" x2="4" y2="17.25"/>` +
    `</g></svg>`
  );
}

interface Ball {
  /** 出生的那一格。屏幕上的家在哪儿只由它决定，一局里不变。 */
  r: number;
  c: number;
  /** 此刻**逻辑上**占着哪一格。每走完一步，整条线上的球各往前挪一格。 */
  cr: number;
  cc: number;
  col: number;
  dot: number;
  /** 家的屏幕坐标（球心）。 */
  hx: number;
  hy: number;
  /** 这一刻相对家的位移，由每一步累加。 */
  dx: number;
  dy: number;
  /** 被后面那颗挤了多少（0..1），以及挤的方向。 */
  press: number;
  pressAng: number;
  /** 框外太远的球不建 DOM——建了也永远看不见。 */
  el: HTMLElement | null;
}

interface MoveState {
  line: Ball[];
  /** 每颗在这条线上走了多少格。 */
  p: Float64Array;
  v: Float64Array;
  press: Float64Array;
  /** 上一帧的驱动值，用来算驱动速度。 */
  prev: number;
  /** 被带动的邻线：偏移 → [位移, 速度]。 */
  nud: Map<number, [number, number]>;
  par: Map<number, Ball[]>;
  /** 这一步往哪儿走，一格是多少像素。 */
  u: readonly [number, number];
  ang: number;
  /** 卡位声响过没有（一格只响一下）。 */
  ticked: boolean;
  /** 驱动值，由 anime.js 写。 */
  drive: { x: number };
}

/**
 * Plays the splash and resolves once it is done *and* the web fonts have
 * landed — so whatever renders next never reflows under the player.
 */
export function showLoadingScreen(): Promise<void> {
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const splash = document.createElement('div');
  splash.className = 'splash';
  const frame = document.createElement('div');
  frame.className = 'splash-frame';
  const board = document.createElement('div');
  board.className = 'splash-board';
  frame.appendChild(board);
  splash.appendChild(frame);
  document.body.appendChild(splash);

  // The frame is a square that stays comfortably inside the smaller viewport
  // axis. 0.70 / 360（从前是 0.58 / 320）：玩家要「整体画面大一点」，390 宽的
  // 手机上从 226px 变成 273px。
  const side = Math.round(Math.max(200, Math.min(360, Math.min(window.innerWidth, window.innerHeight) * 0.7)));
  frame.style.width = side + 'px';
  frame.style.height = side + 'px';

  const R = side / (SIDE_IN_BALLS * 1.86);
  const d = R * 1.86;
  const rowH = R * Math.sqrt(3);
  const X = (r: number, c: number) => (2 * c - r) * R;
  const Y = (r: number) => r * rowH;
  // 镜头对准那条 1×4 的正中——第 2、3 颗球的中点。
  const XC = (X(...SCORERS[1]) + X(...SCORERS[2])) / 2;
  const YC = (Y(SCORERS[1][0]) + Y(SCORERS[2][0])) / 2;
  const sx = (r: number, c: number) => side / 2 + X(r, c) - XC;
  const sy = (r: number) => side / 2 + Y(r) - YC;

  const balls: Ball[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const hx = sx(r, c);
      const hy = sy(r);
      const b: Ball = {
        r, c, cr: r, cc: c,
        col: FRONT[r][c], dot: DOT[r][c],
        hx, hy, dx: 0, dy: 0, press: 0, pressAng: 0, el: null,
      };
      // 只建看得见的那些：离框一格半以内。这副棋盘 130 格，框里只装得下三十
      // 几个——全建一遍是白给手机添一百个图层。
      if (hx > -3 * R && hx < side + 3 * R && hy > -3.2 * R && hy < side + 3.2 * R) {
        const el = document.createElement('div');
        el.className = 'splash-ball';
        el.style.width = d + 'px';
        el.style.height = d + 'px';
        el.style.background = COLORS[b.col];
        board.appendChild(el);
        b.el = el;
      }
      balls.push(b);
    }
  }

  // --- 两步 ---------------------------------------------------------------
  /** 一格在屏幕上走多远：右下 / 右上。 */
  const U1 = [R, rowH] as const;
  const U2 = [R, -rowH] as const;
  const PLAN: { t0: number; fam: Family; id: number; u: readonly [number, number] }[] = [
    // 第 1 步：过 (3,3) 的那条右下斜线——三颗连着的粉球往右下滑一格。
    { t0: MOVES_T[0], fam: 'dr', id: SCORERS[0][1] - SCORERS[0][0], u: U1 },
    // 第 2 步：左边那颗粉球所在的那一列——往右上滑一格，补齐 1×4。
    { t0: MOVES_T[1], fam: 'col', id: LEFT_BALL[1], u: U2 },
  ];

  /** 此刻占着这一族这条线的球，按行进方向从**队尾**排到队头。 */
  function lineBallsAt(fam: Family, id: number): Ball[] {
    const list = balls.filter((b) => (fam === 'dr' ? b.cc - b.cr === id : b.cc === id));
    // dr 往右下走，队尾在左上（行号小）；col 往右上走，队尾在下面（行号大）。
    list.sort((a, b) => (fam === 'dr' ? a.cr - b.cr : b.cr - a.cr));
    return list;
  }
  /** 这一步走完了：整条线上的球各接手下一格（首尾相接，绕回去的那一段在框外）。 */
  function advanceCells(line: Ball[]): void {
    const cells = line.map((b) => [b.cr, b.cc] as [number, number]);
    line.forEach((b, k) => {
      const [r, c] = cells[(k + 1) % cells.length];
      b.cr = r;
      b.cc = c;
    });
  }

  const MV: (MoveState | null)[] = PLAN.map(() => null);

  function beginMove(m: number): void {
    if (m > 0) {
      const prev = MV[m - 1];
      if (prev) advanceCells(prev.line);
    }
    const spec = PLAN[m];
    const line = lineBallsAt(spec.fam, spec.id);
    const par = new Map<number, Ball[]>();
    for (let dd = -3; dd <= 3; dd++) {
      if (!dd || !REACH[Math.abs(dd)]) continue;
      par.set(dd, lineBallsAt(spec.fam, spec.id + dd));
    }
    MV[m] = {
      line,
      p: new Float64Array(line.length),
      v: new Float64Array(line.length),
      press: new Float64Array(line.length),
      prev: 0,
      nud: new Map(),
      par,
      u: spec.u,
      ang: Math.atan2(spec.u[1], spec.u[0]),
      ticked: false,
      drive: { x: 0 },
    };
  }

  // --- painting ----------------------------------------------------------
  function paint() {
    for (const b of balls) {
      b.dx = 0;
      b.dy = 0;
      b.press = 0;
    }
    for (const S of MV) {
      if (!S) continue;
      S.line.forEach((b, k) => {
        b.dx += S.u[0] * S.p[k];
        b.dy += S.u[1] * S.p[k];
        if (S.press[k] > b.press) {
          b.press = S.press[k];
          b.pressAng = S.ang;
        }
      });
      for (const [dd, z] of S.nud) {
        if (Math.abs(z[0]) < 1e-6) continue;
        for (const b of S.par.get(dd) ?? []) {
          b.dx += S.u[0] * z[0];
          b.dy += S.u[1] * z[0];
        }
      }
    }
    for (const b of balls) {
      if (!b.el) continue;
      let tr = `translate(${b.hx + b.dx - d / 2}px, ${b.hy + b.dy - d / 2}px)`;
      // 追上前一颗时轻轻压扁——沿行进方向压，垂直方向鼓一点，不是各向同性地缩。
      if (b.press > 0.01) {
        const a = (b.pressAng * 180) / Math.PI;
        const s1 = 1 - b.press * (1 - SQUASH);
        const s2 = 1 + b.press * (1 - SQUASH) * 0.7;
        tr += ` rotate(${a}deg) scale(${s1}, ${s2}) rotate(${-a}deg)`;
      }
      b.el.style.transform = tr;
    }
  }

  const t = d * THICK;

  /** Turns a flat disc into a two-faced plank, ready to be rotated. */
  function makePlank(b: Ball, halfTurn: string): HTMLElement {
    const el = b.el!;
    el.style.background = 'transparent';
    el.style.boxShadow = 'none';
    el.style.perspective = d * PERSPECTIVE + 'px';
    el.innerHTML =
      `<div class="splash-shadow" style="filter:blur(${(d * 0.06).toFixed(1)}px)"></div>` +
      `<div class="splash-plank">` +
      `<div class="splash-face" style="transform:translateZ(${t / 2}px);background:${COLORS[b.col]};` +
      `box-shadow:inset 0 0 0 1px rgba(0,0,0,0.1)"></div>` +
      // The back gets a body in the board's own paper colour. At rest that is
      // invisible — paper on paper, exactly the flat dot face the game draws —
      // but through the turn it means the plank has two real surfaces rather
      // than a printed front and a hole behind it.
      //
      // It is mounted on halfTurn, not a bare rotateY(180deg): see the note
      // by rollAngleDeg. That is what puts the piece back in its rest pose
      // once the turn is over, whichever way it rolled.
      `<div class="splash-face" style="transform:${halfTurn} translateZ(${t / 2}px);` +
      `background:${GROUND}">${starSVG(d, COLORS[b.dot])}</div>` +
      `</div>`;
    return el.querySelector<HTMLElement>('.splash-plank')!;
  }

  // 翻面绕的是**第 2 步**的行进方向（右上）——最后动它们的就是那一步。
  const ROLL_DEG = rollAngleDeg(U2[0], U2[1]);
  const HALF_TURN = `rotateZ(${ROLL_DEG}deg) rotateY(180deg) rotateZ(${-ROLL_DEG}deg)`;

  /** The settled result, for the reduced-motion path — no turn, just the back. */
  function setDot(b: Ball) {
    makePlank(b, HALF_TURN).style.transform = HALF_TURN;
  }

  /** 两步都走完之后，占着这一格的是哪一颗球。 */
  const ballAt = (r: number, c: number) => balls.find((b) => b.cr === r && b.cc === c)!;

  // --- the integrator ----------------------------------------------------
  let raf = 0;
  let last = performance.now();

  function step(now: number) {
    const dt = Math.min(0.032, (now - last) / 1000);
    last = now;

    for (const S of MV) {
      if (!S) continue;
      const dx = S.drive.x;
      const driveV = (dx - S.prev) / Math.max(dt, 1e-4);
      S.prev = dx;
      // The same detent tick a real drag gives, one per slot crossed. 一步只
      // 滑一格，所以一步响一下，两步共两下。Whether it is audible depends on
      // the browser: a page that has had no gesture yet is not allowed to
      // start audio, so on a first-ever visit the splash is silent and the
      // game's first sound arrives on the first tap.
      if (!S.ticked && dx >= 0.5) {
        S.ticked = true;
        playMove();
      }

      // 1. the driven line: head pinned to the authored travel, everyone
      //    behind it pulled partly by that same travel and partly by the ball
      //    ahead — which is what makes the line stretch and then whip back.
      S.p[0] = dx;
      S.v[0] = driveV;
      S.press[0] = S.press.length > 1 ? S.press[1] * 0.6 : 0;
      for (let k = 1; k < S.line.length; k++) {
        const target = dx * (1 - COUPLE) + S.p[k - 1] * COUPLE;
        S.v[k] += (K * (target - S.p[k]) - C * S.v[k]) * dt;
        S.p[k] += S.v[k] * dt;
        // Contact with the ball ahead: never closer than the discs allow. The
        // overlap it would have had becomes the squash, and the velocity that
        // caused it is absorbed rather than bounced.
        const floor = S.p[k - 1] - CLEARANCE;
        if (S.p[k] < floor) {
          S.press[k] = Math.min(1, (floor - S.p[k]) / CLEARANCE);
          S.p[k] = floor;
          if (S.v[k] < 0) S.v[k] = 0;
        } else {
          // 衰减写成和帧率无关的样子：原先是每帧乘 0.86，120Hz 的屏上挤压会
          // 比 60Hz 的消得快一倍——同一段动画在两台机器上手感不一样。
          S.press[k] *= 0.86 ** (dt * 60);
        }
      }

      // 2. the lines either side get dragged along a little and sprung home.
      let mean = 0;
      for (let k = 0; k < S.line.length; k++) mean += S.v[k];
      mean /= Math.max(1, S.line.length);
      for (const dd of S.par.keys()) {
        const reach = REACH[Math.abs(dd)] ?? 0;
        const q = S.nud.get(dd) ?? [0, 0];
        q[1] += (ENTRAIN * reach * mean * K_N - K_N * q[0] - C_N * q[1]) * dt;
        q[0] += q[1] * dt;
        S.nud.set(dd, q);
      }
    }

    paint();
    raf = requestAnimationFrame(step);
  }

  paint();
  requestAnimationFrame(() => splash.classList.add('show'));

  const timers: number[] = [];
  const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));

  function score() {
    for (const [r, c] of SCORERS) {
      const o = document.createElement('div');
      o.className = 'splash-outline';
      o.style.width = d + 'px';
      o.style.height = d + 'px';
      o.style.left = sx(r, c) - d / 2 + 'px';
      o.style.top = sy(r) - d / 2 + 'px';
      board.appendChild(o);
    }
    playScore(1);
  }

  /**
   * The turn: a half-rotation about the axis the line travelled across, going
   * a little past the half-turn and rocking back, with a quick lift toward the
   * viewer and a shadow that opens under the piece while it is off the board.
   * The lift is short on purpose — it should read as "picked up and turned",
   * not slow the turn down.
   */
  function flip() {
    // 这时候第 2 步也走完了，得把它的格子交接掉——不然 ballAt 找到的是走之前
    // 占着那一格的球，翻过去的会是错的四颗。
    const lastMove = MV[MV.length - 1];
    if (lastMove) advanceCells(lastMove.line);
    SCORERS.forEach(([r, c], n) => {
      const b = ballAt(r, c);
      if (!b.el) return;
      later(n * FLIP_STAGGER, () => {
        const plank = makePlank(b, HALF_TURN);
        const shadow = b.el!.querySelector<HTMLElement>('.splash-shadow')!;
        const peak = d * LIFT;
        const k = { rot: 0, z: 0 };
        const write = () => {
          plank.style.transform =
            `translateZ(${k.z}px) rotateZ(${ROLL_DEG}deg) rotateY(${k.rot}deg) rotateZ(${-ROLL_DEG}deg)`;
          // A piece resting on the board casts nothing; the shadow only opens
          // as it comes up, spreading and fading the higher it gets.
          const up = peak > 0 ? k.z / peak : 0;
          shadow.style.opacity = String(SHADOW * up);
          shadow.style.scale = String(1 + 0.16 * up);
        };
        write();
        playFlip();
        animate(k, {
          rot: [
            { to: 180 + OVERSHOOT, duration: FLIP_MS * 0.62, ease: 'out(2)' },
            { to: 180 - OVERSHOOT * 0.4, duration: FLIP_MS * 0.2 },
            { to: 180 + OVERSHOOT * 0.15, duration: FLIP_MS * 0.1 },
            { to: 180, duration: FLIP_MS * 0.08 },
          ],
          z: [
            { to: peak, duration: FLIP_MS * 0.3, ease: 'out(3)' },
            { to: 0, duration: FLIP_MS * 0.45, ease: 'in(2)' },
          ],
          onUpdate: write,
          // A piece lying flat casts no gap-shadow.
          onComplete: () => shadow.remove(),
        });
      });
    });
  }

  return new Promise<void>((resolve) => {
    const finish = () => {
      cancelAnimationFrame(raf);
      for (const t of timers) clearTimeout(t);
      splash.remove();
      resolve();
    };

    if (still) {
      // The splash is decoration, not content: under reduced motion just show
      // the settled result for a beat and move on. 两步都当作已经走完：线照样
      // 建、位移直接填满，所以摆出来的是真正的终局，不是另画一张图。
      for (let m = 0; m < PLAN.length; m++) {
        beginMove(m);
        const S = MV[m]!;
        S.p.fill(1);
      }
      paint();
      const lastMove = MV[MV.length - 1];
      if (lastMove) advanceCells(lastMove.line);
      for (const [r, c] of SCORERS) {
        const b = ballAt(r, c);
        if (b.el) setDot(b);
      }
      score();
      later(900, () => {
        splash.classList.add('out');
        later(260, finish);
      });
      return;
    }

    raf = requestAnimationFrame(step);
    PLAN.forEach((spec, m) => {
      later(spec.t0, () => {
        beginMove(m);
        const S = MV[m]!;
        animate(S.drive, { x: 1, duration: D_MOVE, ease: 'inOut(2.2)', modifier: magnetize });
      });
    });
    later(T_SCORE, score);
    later(T_FLIP, flip);
    later(T_OUT, () => splash.classList.add('out'));
    // Whichever is slower: the cut, or the fonts the next screen needs.
    const done = new Promise<void>((r) => later(TOTAL_MS, () => r()));
    Promise.all([done, document.fonts?.ready ?? Promise.resolve()]).then(finish);
  });
}

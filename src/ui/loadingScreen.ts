/**
 * The splash: a rounded square window onto a ball board much larger than
 * itself, playing one slide → score → flip before the app appears.
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
 */
import { animate } from 'animejs';

// ---------------------------------------------------------------------------
// Tunables. The frame side is expressed in ball diameters because that is the
// constraint that actually matters: the 2+2 scoring pattern is 4.86R wide, and
// a ball is 1.86R, so anything under 2.61 diameters cannot contain it.
// ---------------------------------------------------------------------------
const SIDE_IN_BALLS = 2.75;
const TOTAL_MS = 3500;

const T_SLIDE = 250;     // travel starts
const D_SLIDE = 1500;    // …and takes this long
const T_SCORE = 2000;    // outlines flash
const T_FLIP = 2600;     // faces turn over
const FLIP_STAGGER = 90;
const T_OUT = 3240;      // splash fades

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

// Verbatim from src/shapes/circle.ts — PALETTES.standard.
const COLORS = ['#C0666B', '#DDA857', '#7A9C4A', '#4F72C4'];
const COLS = 6;
// Rows 1 and 2 carry the four reds; rows 0 and 3 are dressing, and crop in
// half at the frame's top and bottom edges. Checked with the board's own
// pattern detection: no match of any family exists before the slide, and
// exactly one — rhombus22B(1,2) — exists after it.
const FRONT = [
  [3, 1, 2, 3, 1, 2],
  [0, 0, 3, 1, 2, 3],
  [1, 2, 0, 0, 3, 1],
  [1, 3, 2, 3, 2, 3],
];
const DOT = [
  [2, 3, 1, 2, 3, 1],
  [2, 3, 1, 3, 0, 1],
  [3, 1, 1, 3, 1, 2],
  [2, 1, 3, 1, 3, 1],
];
const SLIDE_ROW = 1;
const SLIDE_STEPS = 2;
const TARGET: [number, number][] = [[1, 2], [1, 3], [2, 2], [2, 3]];

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
  r: number;
  c: number;
  el: HTMLElement;
  ghost: HTMLElement;
  flipped: boolean;
  /** Written by the flip; when set it overrides the normal transform. */
  flipT: string | null;
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
  // axis; roughly four app-icon widths on a phone.
  const side = Math.round(Math.max(200, Math.min(320, Math.min(window.innerWidth, window.innerHeight) * 0.58)));
  frame.style.width = side + 'px';
  frame.style.height = side + 'px';

  const R = side / (SIDE_IN_BALLS * 1.86);
  const d = R * 1.86;
  const rowH = R * Math.sqrt(3);
  // Centre the camera on the pattern this all lands in.
  const boardLeft = side / 2 - 3.5 * R;
  const boardTop = side / 2 - R - 1.5 * rowH;
  const cy = (r: number) => boardTop + R + r * rowH;

  const balls: Ball[] = [];
  for (let r = 0; r < FRONT.length; r++) {
    for (let c = 0; c < COLS; c++) {
      const el = document.createElement('div');
      el.className = 'splash-ball';
      el.style.width = d + 'px';
      el.style.height = d + 'px';
      el.style.background = COLORS[FRONT[r][c]];
      board.appendChild(el);
      // The wrapped copy, so a ball leaving one edge is already arriving at
      // the other rather than blinking across.
      const ghost = el.cloneNode(false) as HTMLElement;
      board.appendChild(ghost);
      balls.push({ r, c, el, ghost, flipped: false, flipT: null });
    }
  }

  // --- state -------------------------------------------------------------
  // Per-ball offset along its row, in slot units.
  const p = new Float64Array(balls.length);
  const v = new Float64Array(balls.length);
  /** How hard this ball is being pressed by the one behind it, 0..1. */
  const press = new Float64Array(balls.length);
  const nudge = new Float64Array(FRONT.length);
  const nv = new Float64Array(FRONT.length);
  const drive = { x: 0 };
  let prevDrive = 0;
  let driveV = 0;

  const idx = (r: number, c: number) => r * COLS + c;
  /**
   * The ball now sitting in grid column `c` of row `r`.
   *
   * TARGET names post-slide grid positions, but `balls` is indexed by each
   * ball's *starting* column — so on the row that moved, the ball that ends
   * up at column c is the one that began SLIDE_STEPS to its left. Reading
   * that wrong flips the balls that slid out of frame instead of the four
   * the outlines are drawn around.
   */
  const ballAt = (r: number, c: number) =>
    balls[idx(r, r === SLIDE_ROW ? (((c - SLIDE_STEPS) % COLS) + COLS) % COLS : c)];
  const rowBalls = (r: number) => Array.from({ length: COLS }, (_, c) => idx(r, c));

  // src/shapes/circle.ts — the wraparound preview's edge fade.
  const FADE = 0.4;
  const edge = (pos: number) => {
    const over = pos < 0 ? -pos : pos > COLS - 1 ? pos - (COLS - 1) : 0;
    return Math.max(0, 1 - over / FADE);
  };

  function place(el: HTMLElement, r: number, pos: number, opacity: number, squeeze = 0) {
    const x = boardLeft + (pos - r / 2) * 2 * R - d / 2;
    const sx = 1 - squeeze * (1 - SQUASH);
    const sy = 1 + squeeze * (1 - SQUASH) * 0.7;
    el.style.transform =
      `translate(${x}px, ${cy(r) - d / 2}px)` + (squeeze > 0.01 ? ` scale(${sx}, ${sy})` : '');
    el.style.opacity = String(opacity);
  }

  function paint() {
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (b.flipT) {
        b.el.style.transform = b.flipT;
        b.ghost.style.opacity = '0';
        continue;
      }
      const pos = b.c + p[i] + nudge[b.r];
      place(b.el, b.r, pos, edge(pos), press[i]);
      const alt = pos > (COLS - 1) / 2 ? pos - COLS : pos + COLS;
      place(b.ghost, b.r, alt, edge(alt));
    }
  }

  function setDot(b: Ball) {
    b.flipped = true;
    const color = COLORS[DOT[b.r][b.c]];
    for (const el of [b.el, b.ghost]) {
      el.style.background = 'transparent';
      el.style.boxShadow = 'none';
      el.innerHTML = starSVG(d, color);
    }
  }

  // --- the integrator ----------------------------------------------------
  const moving = rowBalls(SLIDE_ROW);
  let raf = 0;
  let last = performance.now();

  function step(now: number) {
    const dt = Math.min(0.032, (now - last) / 1000);
    last = now;

    driveV = (drive.x - prevDrive) / Math.max(dt, 1e-4);
    prevDrive = drive.x;

    // 1. the driven line: head pinned to the authored travel, everyone
    //    behind it pulled partly by that same travel and partly by the ball
    //    ahead — which is what makes the line stretch and then whip back.
    p[moving[0]] = drive.x;
    v[moving[0]] = driveV;
    press[moving[0]] = press[moving[1]] * 0.6;
    for (let k = 1; k < moving.length; k++) {
      const i = moving[k];
      const ahead = p[moving[k - 1]];
      const target = drive.x * (1 - COUPLE) + ahead * COUPLE;
      v[i] += (K * (target - p[i]) - C * v[i]) * dt;
      p[i] += v[i] * dt;
      // Contact with the ball ahead: never closer than the discs allow. The
      // overlap it would have had becomes the squash, and the velocity that
      // caused it is absorbed rather than bounced.
      const floor = p[moving[k - 1]] - CLEARANCE;
      if (p[i] < floor) {
        press[i] = Math.min(1, (floor - p[i]) / CLEARANCE);
        p[i] = floor;
        if (v[i] < 0) v[i] = 0;
      } else {
        press[i] *= 0.86;
      }
    }

    // 2. the lines either side get dragged along a little and sprung home.
    let mean = 0;
    for (const i of moving) mean += v[i];
    mean /= moving.length;
    for (let r = 0; r < FRONT.length; r++) {
      const reach = REACH[Math.abs(r - SLIDE_ROW)] ?? 0;
      if (!reach) continue;
      nv[r] += (ENTRAIN * reach * mean * K_N - K_N * nudge[r] - C_N * nv[r]) * dt;
      nudge[r] += nv[r] * dt;
    }

    paint();
    raf = requestAnimationFrame(step);
  }

  paint();
  requestAnimationFrame(() => splash.classList.add('show'));

  const timers: number[] = [];
  const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));

  function score() {
    for (const [r, c] of TARGET) {
      const o = document.createElement('div');
      o.className = 'splash-outline';
      o.style.width = d + 'px';
      o.style.height = d + 'px';
      o.style.left = boardLeft + (c - r / 2) * 2 * R - d / 2 + 'px';
      o.style.top = cy(r) - d / 2 + 'px';
      board.appendChild(o);
    }
  }

  /** src/style.css @keyframes flip-in, so the face turns the same way it does in game. */
  function flip() {
    TARGET.forEach(([r, c], n) => {
      const b = ballAt(r, c);
      later(n * FLIP_STAGGER, () => {
        const k = { rx: 0, sy: 1 };
        let swapped = false;
        // Pinned to the grid slot the outline is drawn around, not to the
        // ball's own offset — by now they are the same place, and this way
        // they cannot drift apart.
        const x = boardLeft + (c - r / 2) * 2 * R - d / 2;
        const y = cy(r) - d / 2;
        animate(k, {
          rx: [
            { to: 88, duration: 129 },
            { to: -14, duration: 68 },
            { to: 5, duration: 68 },
            { to: 0, duration: 75 },
          ],
          sy: [
            { to: 0.88, duration: 129 },
            { to: 1.07, duration: 68 },
            { to: 0.98, duration: 68 },
            { to: 1, duration: 75 },
          ],
          onUpdate: () => {
            if (!swapped && k.rx > 70) {
              swapped = true;
              setDot(b);
            }
            b.flipT = `translate(${x}px, ${y}px) perspective(300px) rotateX(${k.rx}deg) scaleY(${k.sy})`;
          },
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
      // the settled result for a beat and move on.
      for (const i of moving) p[i] = SLIDE_STEPS;
      for (const [r, c] of TARGET) setDot(ballAt(r, c));
      paint();
      score();
      later(900, () => {
        splash.classList.add('out');
        later(260, finish);
      });
      return;
    }

    raf = requestAnimationFrame(step);
    later(T_SLIDE, () => {
      animate(drive, { x: SLIDE_STEPS, duration: D_SLIDE, ease: 'inOut(2.2)', modifier: magnetize });
    });
    later(T_SCORE, score);
    later(T_FLIP, flip);
    later(T_OUT, () => splash.classList.add('out'));
    // Whichever is slower: the cut, or the fonts the next screen needs.
    const done = new Promise<void>((r) => later(TOTAL_MS, () => r()));
    Promise.all([done, document.fonts?.ready ?? Promise.resolve()]).then(finish);
  });
}

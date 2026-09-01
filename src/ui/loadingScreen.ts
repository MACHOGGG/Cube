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
import { playMove, playScore, playFlip } from '../engine/juice';
import { colorblindOn } from '../engine/palettePref';

// ---------------------------------------------------------------------------
// Tunables. The frame side is expressed in ball diameters because that is the
// constraint that actually matters: the 2+2 scoring pattern is 4.86R wide, and
// a ball is 1.86R, so anything under 2.61 diameters cannot contain it.
// ---------------------------------------------------------------------------
const SIDE_IN_BALLS = 2.75;

/** 整段开场放多快。1 是原速，1.25 是现在——每一个时刻和每一段时长都
 *  一起除以它，所以节奏的比例分毫不变，只是整段跑得快了四分之一。
 *  要调回去改这一个数就够，底下那串数字是「原速下的毫秒」，不用动。 */
const SPEED = 1.25;
const fast = (ms: number) => Math.round(ms / SPEED);

const TOTAL_MS = fast(3500);

const T_SLIDE = fast(250);     // travel starts
const D_SLIDE = fast(1500);    // …and takes this long
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
/** This board slides along +x, so that is the direction the pieces roll. */
const ROLL_DEG = rollAngleDeg(1, 0);
/** The finished turn about that axis — where the plank ends, and how the
 *  back face is pre-mounted so the two cancel. */
const HALF_TURN = `rotateZ(${ROLL_DEG}deg) rotateY(180deg) rotateZ(${-ROLL_DEG}deg)`;

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
      balls.push({ r, c, el, ghost, flipped: false });
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
  let lastDetent = 0;

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
      const pos = b.c + p[i] + nudge[b.r];
      place(b.el, b.r, pos, edge(pos), press[i]);
      const alt = pos > (COLS - 1) / 2 ? pos - COLS : pos + COLS;
      place(b.ghost, b.r, alt, edge(alt));
    }
  }

  const t = d * THICK;

  /** Turns a flat disc into a two-faced plank, ready to be rotated. */
  function makePlank(b: Ball): HTMLElement {
    const front = COLORS[FRONT[b.r][b.c]];
    const back = COLORS[DOT[b.r][b.c]];
    b.el.style.background = 'transparent';
    b.el.style.boxShadow = 'none';
    b.el.style.perspective = d * PERSPECTIVE + 'px';
    b.el.innerHTML =
      `<div class="splash-shadow" style="filter:blur(${(d * 0.06).toFixed(1)}px)"></div>` +
      `<div class="splash-plank">` +
      `<div class="splash-face" style="transform:translateZ(${t / 2}px);background:${front};` +
      `box-shadow:inset 0 0 0 1px rgba(0,0,0,0.1)"></div>` +
      // The back gets a body in the board's own paper colour. At rest that is
      // invisible — paper on paper, exactly the flat dot face the game draws —
      // but through the turn it means the plank has two real surfaces rather
      // than a printed front and a hole behind it.
      //
      // It is mounted on HALF_TURN, not a bare rotateY(180deg): see the note
      // by HALF_TURN. That is what puts the piece back in its rest pose once
      // the turn is over, whichever way it rolled.
      `<div class="splash-face" style="transform:${HALF_TURN} translateZ(${t / 2}px);` +
      `background:${GROUND}">${starSVG(d, back)}</div>` +
      `</div>`;
    b.ghost.style.opacity = '0';
    b.flipped = true;
    return b.el.querySelector<HTMLElement>('.splash-plank')!;
  }

  /** The settled result, for the reduced-motion path — no turn, just the back. */
  function setDot(b: Ball) {
    makePlank(b).style.transform = HALF_TURN;
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
    // The same detent tick a real drag gives, one per slot crossed. Whether
    // it is audible depends on the browser: a page that has had no gesture
    // yet is not allowed to start audio, so on a first-ever visit the splash
    // is silent and the game's first sound arrives on the first tap.
    const detent = Math.round(drive.x);
    if (detent !== lastDetent) {
      lastDetent = detent;
      playMove();
    }

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
    TARGET.forEach(([r, c], n) => {
      const b = ballAt(r, c);
      later(n * FLIP_STAGGER, () => {
        const plank = makePlank(b);
        const shadow = b.el.querySelector<HTMLElement>('.splash-shadow')!;
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

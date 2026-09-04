/**
 * The inter-piece forces of the splash's slide (src/ui/loadingScreen.ts's
 * integrator, ported verbatim into slot units), made available to every
 * board's live drag:
 *
 *  - The grabbed piece stays 1:1 with the finger. Every other piece in the
 *    line is sprung partly toward the finger's travel and partly toward the
 *    piece between it and the finger, so a wave runs down the line and the
 *    far end keeps swinging for a beat after the near end has seated.
 *  - Contact is real: a piece can close its free gap on the piece ahead and
 *    no further — the overlap it would have had becomes a brief squash, and
 *    the velocity that caused it is absorbed rather than bounced.
 *  - The lines either side get entrained — dragged a little along the slide
 *    axis in proportion to the moving line's velocity, then sprung home.
 *
 * Everything is in slot units (one slot = the line's own pitch), so the same
 * numbers feel identical on a 40px triangle and a 90px ball. The chain owns
 * a rAF loop and repaints through `onFrame`, which is expected to be the
 * board's own drag-preview renderer reading `at()`/`press()`/`side()`.
 *
 * Under prefers-reduced-motion the chain degrades to rigid: `at()` is the
 * drive for every slot, presses and side nudges are 0, and `settle` resolves
 * immediately — callers keep a single code path.
 */
// 只从 reducedMotion.ts 拿，不从 juice 拿：微信小游戏那边也要用这套弹簧，而
// juice 一加载就去读本地存档和音频 API，那边没有。
import { reducedMotion } from './reducedMotion';

/**
 * How far the pieces may depart from moving as one rigid line.
 *
 * 1 is the splash's own strength, and it is what the played-back animations
 * keep — the opening sequence and the three tutorials pass no force at all,
 * so they stay at the default. Nothing there is under a finger, so the full
 * wave only reads as character.
 *
 * A live board passes 0.03, which is the edge of noticing rather than the
 * absence of it: the coupling between neighbours, the pull on the lines
 * either side and the contact squash all scale with this, and at this value
 * the worst piece in a line trails the finger by about 0.4px on a 60px
 * tile — enough that the line reads as matter rather than as a rigid
 * sprite, not enough to get in the way of aiming a move. The simulation
 * itself is untouched (it is what keeps the seat and the release sprung
 * rather than snapped); only how much of it shows is turned down.
 */
export const BOARD_FORCE = 0.03;
const COUPLE = 0.55; // how much of a follower's target is the piece ahead
const K = 260; // spring on the followers
const C = 26; // damping on the followers
const SQUASH = 0.1; // max squash at full contact press
const ENTRAIN = 0.03; // how much of the line's velocity the sides borrow
const K_N = 190; // spring pulling an entrained side line home
const C_N = 17;
const REACH = [0, 1, 0.45, 0.18]; // entrainment by line distance
/** The spring that carries the drive to its final slot after release. */
const K_SETTLE = 430;
const C_SETTLE = 42;
const SETTLE_CAP_MS = 260;

export interface DragChainOpts {
  /** Pieces in the moving line, in line order. */
  n: number;
  /** Index (in that order) of the piece under the finger. */
  grabbed: number;
  /** Free gap between adjacent pieces, in slots (0.07 = the ball boards'). */
  clearance?: number;
  /** Strength of the effect, 0..1 — BOARD_FORCE for a live board, 1 (the
   *  default) for a played-back animation. */
  force?: number;
  /** Repaint using at()/press()/side() — the board's drag-preview renderer. */
  onFrame(): void;
}

export interface DragChain {
  /** The finger's current travel, in slots (magnetized, signed). */
  drive(slots: number): void;
  /** Slot i's own travel — lags the drive by the physics above. */
  at(i: number): number;
  /** Slot i's contact squash, 0..1. */
  press(i: number): number;
  /** The entrained travel of a line `dist` lines away from the dragged one. */
  side(dist: number): number;
  /** Carries the drive to its final slot, lets the wave die down (capped at
   *  a beat), then calls `done` exactly once. */
  settle(finalSlots: number, done: () => void): void;
  /** Ends a settle immediately, firing its `done` — what a fresh touch does
   *  while the previous line is still swinging, so fast play never has an
   *  input swallowed waiting for a wave to die. No-op if not settling. */
  flush(): boolean;
  stop(): void;
}

export function createDragChain(opts: DragChainOpts): DragChain {
  if (reducedMotion()) {
    let s = 0;
    return {
      drive: (x) => {
        s = x;
        opts.onFrame();
      },
      at: () => s,
      press: () => 0,
      side: () => 0,
      settle: (finalSlots, done) => {
        s = finalSlots;
        opts.onFrame();
        done();
      },
      flush: () => false,
      stop: () => {},
    };
  }

  const { n, grabbed } = opts;
  const clearance = opts.clearance ?? 0.07;
  const force = opts.force ?? 1;
  const couple = COUPLE * force;
  const entrain = ENTRAIN * force;
  const p = new Array<number>(n).fill(0);
  const v = new Array<number>(n).fill(0);
  const press = new Array<number>(n).fill(0);
  const nudge = new Array<number>(REACH.length).fill(0);
  const nv = new Array<number>(REACH.length).fill(0);
  let s = 0;
  let prevS = 0;
  let raf = 0;
  let last = performance.now();
  let settling: { final: number; sv: number; start: number; done: () => void } | null = null;
  let stopped = false;

  /** One side of the chain, walking outward from the grabbed piece. */
  function relax(i: number, ahead: number, dt: number) {
    const target = s * (1 - couple) + p[ahead] * couple;
    v[i] += (K * (target - p[i]) - C * v[i]) * dt;
    p[i] += v[i] * dt;
    // Contact with the piece ahead, from either side: never closer than the
    // free gap allows. The overlap becomes the squash, the velocity that
    // caused it is absorbed.
    const gap = p[i] - p[ahead];
    if (gap > clearance) {
      press[i] = Math.min(1, (gap - clearance) / clearance);
      p[i] = p[ahead] + clearance;
      if (v[i] > 0) v[i] = 0;
    } else if (gap < -clearance) {
      press[i] = Math.min(1, (-gap - clearance) / clearance);
      p[i] = p[ahead] - clearance;
      if (v[i] < 0) v[i] = 0;
    } else {
      press[i] *= 0.86;
    }
  }

  function step(now: number) {
    if (stopped) return;
    const dt = Math.min(0.032, (now - last) / 1000);
    last = now;

    if (settling) {
      settling.sv += (K_SETTLE * (settling.final - s) - C_SETTLE * settling.sv) * dt;
      s += settling.sv * dt;
    }
    const driveV = (s - prevS) / Math.max(dt, 1e-4);
    prevS = s;

    p[grabbed] = s;
    v[grabbed] = driveV;
    for (let i = grabbed + 1; i < n; i++) relax(i, i - 1, dt);
    for (let i = grabbed - 1; i >= 0; i--) relax(i, i + 1, dt);
    press[grabbed] = ((press[grabbed - 1] ?? 0) + (press[grabbed + 1] ?? 0)) * 0.3;

    // The neighbouring lines, dragged a little and sprung home.
    let mean = 0;
    for (let i = 0; i < n; i++) mean += v[i];
    mean /= n;
    for (let d = 1; d < REACH.length; d++) {
      nv[d] += (entrain * REACH[d] * mean * K_N - K_N * nudge[d] - C_N * nv[d]) * dt;
      nudge[d] += nv[d] * dt;
    }

    opts.onFrame();

    if (settling) {
      let rest = Math.abs(s - settling.final) < 0.008 && Math.abs(settling.sv) < 0.05;
      for (let i = 0; rest && i < n; i++) {
        if (Math.abs(p[i] - settling.final) > 0.012 || Math.abs(v[i]) > 0.06) rest = false;
      }
      if (rest || now - settling.start > SETTLE_CAP_MS) {
        const done = settling.done;
        s = settling.final;
        p.fill(settling.final);
        v.fill(0);
        press.fill(0);
        settling = null;
        stopped = true;
        opts.onFrame();
        done();
        return;
      }
    }
    raf = requestAnimationFrame(step);
  }
  raf = requestAnimationFrame((t) => {
    last = t;
    step(t);
  });

  return {
    drive: (x) => {
      s = x;
    },
    /**
     * Slot i's travel, with the simulation's departure from the rigid line
     * scaled by `force`.
     *
     * The scaling has to happen here rather than inside the integrator. The
     * grabbed piece is pinned exactly to the finger while every follower only
     * springs toward its target, so a follower trails by a fixed fraction of
     * a cell that comes from the spring itself, not from the coupling — which
     * meant that turning `force` all the way down still left the line
     * visibly stretching under the finger (measured: 21% of a cell at every
     * value of force, 1 through 0). Blending the read value back toward the
     * drive makes `force` mean what it says: 0 is a rigid line, 1 is the full
     * wave, and the physics underneath — contact, squash, the sprung settle —
     * is untouched, so the release still eases rather than snapping.
     */
    at: (i) => {
      const at = p[i];
      return at === undefined ? s : s + (at - s) * force;
    },
    press: (i) => press[i] ?? 0,
    side: (dist) => nudge[dist] ?? 0,
    settle: (finalSlots, done) => {
      if (settling) return;
      settling = { final: finalSlots, sv: 0, start: performance.now(), done };
    },
    flush: () => {
      if (!settling) return false;
      const { final, done } = settling;
      s = final;
      p.fill(final);
      v.fill(0);
      press.fill(0);
      settling = null;
      stopped = true;
      cancelAnimationFrame(raf);
      opts.onFrame();
      done();
      return true;
    },
    stop: () => {
      stopped = true;
      cancelAnimationFrame(raf);
    },
  };
}

/** The squash a pressed piece shows, as a `scale` string along the drag
 *  axis (ux, uy is the axis unit vector). Component-wise, since the CSS
 *  `scale` property has no rotation of its own. Boards pass BOARD_FORCE so
 *  the squash is dialled back with the rest of the effect. */
export function pressScale(press: number, ux: number, uy: number, force = 1): string {
  if (press <= 0.01) return '';
  const k = press * SQUASH * force;
  return `${(1 - k * Math.abs(ux)).toFixed(3)} ${(1 - k * Math.abs(uy)).toFixed(3)}`;
}

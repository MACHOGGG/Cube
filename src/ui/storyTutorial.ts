import { trackTutorialStart, trackTutorialEnd } from '../engine/analytics';
import { STRINGS, type Lang } from '../i18n';
import { CTL_FINISH, CTL_NEXT, CTL_PREV, CTL_REPLAY } from './ctlIcons';
import { playMove, playScore, playFlip, playClear, seatEls } from '../engine/juice';
import { createDragChain } from '../engine/dragChain';
import { plankFlipEl, flipMs, flipStaggerMs } from '../engine/plankFlip';
import { roundTriPath } from '../engine/roundTri';

/**
 * The keyframe-playback engine behind all three basic tutorials.
 *
 * Each tutorial is authored as a sequence of exact keyframes (transcribed
 * cell-for-cell from the design storyboards) plus a script of beats. The
 * player only WATCHES: the board takes no input, and navigation is limited
 * to 上一条 / 再一次 / 下一条 / 结束(完成). Entering a beat plays its script:
 * the arrow hint stretches on the line about to move, the line then slides
 * slowly and legibly (with low-opacity wraparound ghosts refilling in order,
 * exactly like the real game's drag), settles, and blinking checkmarks call
 * out whatever scored.
 */
export interface StoryCell {
  x: number;
  y: number;
  w: number;
  h: number;
  shape: 'sq' | 'ci' | 'up' | 'dn';
  fill: string;
  /** Dot-face marker: draws the 6-ray asterisk in this colour. */
  star?: string;
  /** Triangle dot face: the same triangle shrunk toward its own centroid and
   *  drawn in this colour with a dark outline, exactly as src/shapes puts a
   *  turned-over triangle on the board. Set `fill` to the board's paper so
   *  the surround reads as the white margin the small triangle sits in. */
  inner?: string;
  /** Blanked cell: light fill + dashed outline. */
  dashed?: boolean;
  /** Thin gray outline (the white dot-face balls). */
  ring?: boolean;
}

export type StoryStep =
  | { t: 'show'; f: number }
  | { t: 'arrow'; x: number; y: number; ang: number; color: string; mode?: 'static' }
  | { t: 'slide'; f: number; idx: number[]; dx: number; dy: number; wx: number; wy: number; snap: number }
  | { t: 'checks'; pts: { x: number; y: number }[]; color: string }
  | {
      t: 'flip';
      f: number;
      idx: number[];
      snap: number;
      /** Roll direction in screen degrees (+x = 0, +y = 90) — the direction
       *  of the move that caused this score, a flourish in the air only. */
      dir?: number;
    }
  | { t: 'fade'; snap: number }
  /** Blinks a set of cells on and off `times` over, then lands on `snap`.
   *  Written for the square tutorial's last beat: the emptied slots stand
   *  there as dashed holes, blink twice to say "these are the ones that
   *  went", and are gone by the time the board settles. */
  | { t: 'blink'; idx: number[]; times: number; snap: number }
  | { t: 'pause'; ms: number };

export interface StorySpec {
  /** Which tutorial this is, for analytics — 'square' | 'circle' | 'triangle'. */
  id: string;
  w: number;
  h: number;
  frames: StoryCell[][];
  beats: StoryStep[][];
}

const sleepRaw = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Global playback rate. Every duration below — the JS waits, the slide's own
 * tween, and (through the --story-speed custom property) the CSS animations
 * for the arrow, the checkmarks and the flip — is written at its original
 * pace and divided by this, so the whole sequence stays in proportion when
 * the speed changes.
 */
const SPEED = 2.25;
const sleep = (ms: number) => sleepRaw(ms / SPEED);

/** The hand-off gap between one beat finishing and the next starting on its
 *  own. Deliberately NOT scaled by SPEED: it is a beat of reading time, not
 *  part of the animation. */
const AUTO_ADVANCE_MS = 1500;

/**
 * Every wait in the playback, at its authored pace (SPEED divides them at
 * the point of use). They live here as named constants rather than inline
 * numbers because the progress bar times its segments by summing exactly
 * these: if the two lists could drift apart, retiming a step would silently
 * desync the bar from the animation it is supposed to be tracking.
 */
const WAIT = {
  show: 350,
  arrowStatic: 180,
  arrowArmed: 780,   // one 720ms stretch cycle, plus a short tail
  checks: 2100,
  flip: 960,
  flipSettle: 300,
  fadeOut: 320,
  fadeIn: 340,
  blinkOff: 300,
  blinkOn: 300,
  blinkHold: 420,
  slideLead: 250,
  slide: 2600,
  slideRelease: 260,
  slideSettle: 300,
} as const;

/** How long one step occupies, in authored ms — the mirror of runStep. */
function stepMs(st: StoryStep): number {
  switch (st.t) {
    case 'show': return WAIT.show;
    case 'pause': return st.ms;
    case 'arrow': return st.mode === 'static' ? WAIT.arrowStatic : WAIT.arrowArmed;
    case 'checks': return WAIT.checks;
    // The plank flips run at their own real-world pace (they are the game's
    // shipped feel, not a slowed-down lesson) — expressed here in authored
    // ms so the progress bar's SPEED division lands back on the real time.
    case 'flip': return ((st.idx.length - 1) * flipStaggerMs() + flipMs() + 140) * SPEED + WAIT.flipSettle;
    case 'fade': return WAIT.fadeOut + WAIT.fadeIn;
    case 'blink': return st.times * (WAIT.blinkOff + WAIT.blinkOn) + WAIT.blinkHold;
    // +420 authored ≈ the chain's post-travel settle wave (capped ~300ms
    // real), so the progress bar keeps tracking the step it is timing.
    case 'slide': return WAIT.slideLead + WAIT.slide + 420 + WAIT.slideRelease + WAIT.slideSettle;
  }
}
const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
/** The drag profile: ease out to just past half way, hesitate like a real
 *  finger deciding, then commit the rest — never one instant jump. */
function humanP(t: number): number {
  if (t < 0.42) return ease(t / 0.42) * 0.58;
  if (t < 0.56) return 0.58;
  return 0.58 + ease((t - 0.56) / 0.44) * 0.42;
}

/** How far a turned-over triangle's printed face is shrunk inside its own
 *  silhouette. */
export const TRI_DOT_SCALE = 0.46;

function cellSvg(c: StoryCell): string {
  const dash = c.dashed ? ' stroke="#6F6F6F" stroke-width="4" stroke-dasharray="12 9"' : '';
  const ring = c.ring && !c.dashed ? ' stroke="#9A9A9A" stroke-width="3.5"' : '';
  let shape = '';
  if (c.shape === 'ci') shape = `<circle cx="50" cy="50" r="45" fill="${c.fill}"${ring}${dash}/>`;
  else if (c.shape === 'sq') shape = `<rect x="4" y="4" width="92" height="92" rx="20" fill="${c.fill}"${dash}/>`;
  else {
    const pts: [number, number][] =
      c.shape === 'up' ? [[50, 3], [97, 93], [3, 93]] : [[3, 7], [97, 7], [50, 97]];
    shape = `<path d="${roundTriPath(pts)}" fill="${c.fill}"${dash} stroke-linejoin="round"/>`;
    if (c.inner) {
      // Well under the 0.6 the boards themselves use: at this size the two
      // triangles have to be tellable apart at a glance, and the margin
      // around the small one is what does that.
      const k = TRI_DOT_SCALE;
      const cx = (pts[0][0] + pts[1][0] + pts[2][0]) / 3;
      const cy = (pts[0][1] + pts[1][1] + pts[2][1]) / 3;
      const inner = pts.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k] as [number, number]);
      shape +=
        `<path d="${roundTriPath(inner)}" fill="${c.inner}" stroke="#1A1A1A"` +
        ` stroke-width="3.5" stroke-linejoin="round"/>`;
    }
  }
  const star = c.star
    ? `<g stroke="${c.star}" stroke-width="10" stroke-linecap="round">` +
      `<line x1="50" y1="23" x2="50" y2="77"/><line x1="27" y1="36.5" x2="73" y2="63.5"/>` +
      `<line x1="27" y1="63.5" x2="73" y2="36.5"/></g>`
    : '';
  return `<svg viewBox="0 0 100 100">${shape}${star}</svg>`;
}

const ARROW_SVG = (color: string) =>
  `<svg viewBox="-34 -16 62 32"><line x1="-28" y1="0" x2="0" y2="0" stroke="${color}" stroke-width="7"` +
  ` stroke-linecap="round" stroke-dasharray="9 8"/>` +
  // The head is stroked with a round join over its own fill, which rounds
  // all three corners without changing its overall size.
  `<path d="M4 -8.5 L21 0 L4 8.5 Z" fill="${color}" stroke="${color}" stroke-width="6" stroke-linejoin="round"/></svg>`;

const CHECK_SVG = (color: string) =>
  `<svg viewBox="0 0 60 60"><path d="M12 32 L26 47 L50 12" fill="none" stroke="${color}"` +
  ` stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function renderStoryTutorial(container: HTMLElement, lang: Lang, spec: StorySpec, onDone: () => void): void {
  const s = STRINGS[lang];
  container.innerHTML = `
    <div class="app story-tut">
      <div class="story-prog" id="stProg"></div>
      <div class="story-stage" id="stStage"><div class="story-board" id="stBoard"></div></div>
      <!-- 四颗都是图示，不写字（玩家的原话：⬅️ ➡️ 🔄 ✅ 那样的图示）。
           名字留在 aria-label 里给读屏软件。 -->
      <div class="controls story-controls">
        <button class="icon-btn story-ctl" id="stPrev" aria-label="${s.prev}">${CTL_PREV}</button>
        <button class="icon-btn story-ctl" id="stReplay" aria-label="${s.replay}">${CTL_REPLAY}</button>
        <button class="icon-btn story-ctl" id="stNext" aria-label="${s.next}">${CTL_NEXT}</button>
        <button class="icon-btn story-ctl" id="stFinish" aria-label="${s.finishBtn}">${CTL_FINISH}</button>
      </div>
    </div>
  `;
  container.querySelector<HTMLElement>('.story-tut')!.style.setProperty('--story-speed', String(SPEED));
  const stage = container.querySelector<HTMLElement>('#stStage')!;
  const board = container.querySelector<HTMLElement>('#stBoard')!;
  const bPrev = container.querySelector<HTMLButtonElement>('#stPrev')!;
  const bReplay = container.querySelector<HTMLButtonElement>('#stReplay')!;
  const bNext = container.querySelector<HTMLButtonElement>('#stNext')!;
  const bFinish = container.querySelector<HTMLButtonElement>('#stFinish')!;

  // Playback progress, Instagram-story style: one equal-width segment per
  // beat, the active one's dark fill sweeping left to right.
  const prog = container.querySelector<HTMLElement>('#stProg')!;
  const progFills = spec.beats.map(() => {
    const seg = document.createElement('div');
    seg.className = 'story-prog-seg';
    const fill = document.createElement('i');
    fill.className = 'story-prog-fill';
    seg.appendChild(fill);
    prog.appendChild(seg);
    return fill;
  });

  /**
   * Points the bar at beat i: the beats behind it read full, the ones ahead
   * empty, and this one sweeps over its own running time.
   *
   * That time is the sum of the beat's steps *plus* the hand-off pause, so
   * the segment tops out at the moment the next beat starts rather than
   * sitting full through the reading gap — filling up IS the cue that the
   * next animation is starting.
   */
  function runProgress(i: number) {
    for (let k = 0; k < progFills.length; k++) {
      const f = progFills[k];
      f.style.transition = 'none';
      f.style.width = k < i ? '100%' : '0';
    }
    void prog.offsetWidth; // flush the reset, or a replay never restarts
    const own = spec.beats[i].reduce((a, st) => a + stepMs(st), 0) / SPEED;
    const total = own + (i >= spec.beats.length - 1 ? 0 : AUTO_ADVANCE_MS);
    progFills[i].style.transition = `width ${Math.round(total)}ms linear`;
    progFills[i].style.width = '100%';
  }

  board.style.width = spec.w + 'px';
  board.style.height = spec.h + 'px';
  const app = container.querySelector<HTMLElement>('.story-tut')!;
  /**
   * Fits the example to whatever room is left, in both directions.
   *
   * Scaling off the width alone is fine upright and wrong sideways: a phone
   * turned over has plenty of width and almost no height, so the example
   * came out full size and pushed the progress bar and the buttons off the
   * screen. The height left over is the viewport minus everything on the
   * page that isn't the stage, measured rather than assumed.
   */
  function layout() {
    const cs = getComputedStyle(app);
    const gap = parseFloat(cs.rowGap) || 0;
    const padV = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const stageTop = parseFloat(getComputedStyle(stage).marginTop) || 0;
    const kids = Array.from(app.children) as HTMLElement[];
    const others = kids.reduce((n, c) => (c === stage ? n : n + c.getBoundingClientRect().height), 0);
    const roomH = window.innerHeight - padV - others - gap * Math.max(0, kids.length - 1) - stageTop - 8;
    const scale = Math.max(0.3, Math.min(1, (stage.clientWidth || spec.w) / spec.w, roomH / spec.h));
    board.style.transform = `scale(${scale})`;
    stage.style.height = spec.h * scale + 'px';
    // Then check the answer against the page itself: margins, a control row
    // that wrapped, a browser's own rounding — the arithmetic above cannot
    // see all of it, so whatever is still hanging past the bottom comes off
    // the stage directly.
    const over = document.documentElement.scrollHeight - window.innerHeight;
    if (over > 1) {
      const h = Math.max(spec.h * 0.3, spec.h * scale - over);
      board.style.transform = `scale(${h / spec.h})`;
      stage.style.height = h + 'px';
    }
  }
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', layout);
  // Rotating a phone settles its viewport over several frames; a plain
  // resize listener measures the first of them.
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(layout).observe(app);

  let els: HTMLElement[] = [];
  let curFrame = -1;
  function renderFrame(f: number, keepArrows = false) {
    // Mid-beat frame swaps keep the arrow hints standing (re-appended last,
    // so they stay on top): one line can slide while the hints for the moves
    // still to come hold their places, exactly like the printed sheet.
    const arrows = keepArrows ? Array.from(board.querySelectorAll<HTMLElement>('.story-arrow')) : [];
    board.innerHTML = '';
    curFrame = f;
    els = spec.frames[f].map((c) => {
      const el = document.createElement('div');
      el.className = 'story-cell';
      el.style.left = c.x + 'px';
      el.style.top = c.y + 'px';
      el.style.width = c.w + 'px';
      el.style.height = c.h + 'px';
      el.innerHTML = cellSvg(c);
      board.appendChild(el);
      return el;
    });
    for (const a of arrows) board.appendChild(a);
  }

  let gen = 0;
  let beat = 0;

  async function runStep(st: StoryStep, my: number): Promise<void> {
    if (st.t === 'show') {
      renderFrame(st.f);
      await sleep(WAIT.show);
    } else if (st.t === 'pause') {
      await sleep(st.ms);
    } else if (st.t === 'arrow') {
      // A hint already standing at this spot (shown statically when the beat
      // opened) is replaced in place, so the same arrow appears to wake up
      // and start stretching when its turn comes.
      const key = `${st.x},${st.y}`;
      for (const old of Array.from(board.querySelectorAll<HTMLElement>('.story-arrow'))) {
        if (old.dataset.k === key) old.remove();
      }
      const a = document.createElement('div');
      a.className = 'story-arrow';
      a.dataset.k = key;
      a.style.left = st.x + 'px';
      a.style.top = st.y + 'px';
      a.style.transform = `translate(-50%,-50%) rotate(${st.ang}deg)`;
      if (st.mode === 'static') {
        a.innerHTML = ARROW_SVG(st.color);
        board.appendChild(a);
        await sleep(WAIT.arrowStatic);
      } else {
        // Armed: one stretch cycle (the CSS iteration count), then the move
        // starts on its own; the slide that follows retires it.
        a.classList.add('story-arrow--armed');
        a.innerHTML = `<span class="story-arrow-nudge">${ARROW_SVG(st.color)}</span>`;
        board.appendChild(a);
        await sleep(WAIT.arrowArmed);
      }
    } else if (st.t === 'checks') {
      for (const p of st.pts) {
        const c = document.createElement('div');
        c.className = 'story-check';
        c.style.left = p.x + 'px';
        c.style.top = p.y + 'px';
        c.innerHTML = CHECK_SVG(st.color);
        board.appendChild(c);
      }
      playScore(1);
      await sleep(WAIT.checks);
    } else if (st.t === 'flip') {
      if (curFrame !== st.f) renderFrame(st.f, true);
      // The splash's own plank turn (engine/plankFlip.ts), piece by piece:
      // lift, roll about the scoring move's axis, overshoot, seat — landing
      // in the rest pose with nothing changed but the face. It runs at the
      // game's real pace, not the lesson's slowed one: this is exactly the
      // motion the player will meet on the boards.
      const dir = st.dir ?? 0;
      playFlip();
      st.idx.forEach((i, n) => {
        window.setTimeout(() => {
          if (gen !== my) return;
          const el = els[i];
          if (!el?.isConnected) return;
          const front = document.createElement('div');
          front.style.position = 'absolute';
          front.style.inset = '0';
          front.innerHTML = cellSvg(spec.frames[st.f][i]);
          el.innerHTML = cellSvg(spec.frames[st.snap][i]);
          plankFlipEl(el, front, dir);
        }, n * flipStaggerMs());
      });
      await sleepRaw((st.idx.length - 1) * flipStaggerMs() + flipMs() + 140);
      if (gen !== my) return;
      renderFrame(st.snap, true);
      await sleep(WAIT.flipSettle);
    } else if (st.t === 'fade') {
      board.style.transition = 'opacity 300ms ease';
      board.style.opacity = '0.25';
      playClear();
      await sleep(WAIT.fadeOut);
      if (gen !== my) return;
      renderFrame(st.snap);
      board.style.opacity = '1';
      await sleep(WAIT.fadeIn);
    } else if (st.t === 'blink') {
      const marks = st.idx.map((i) => els[i]).filter(Boolean);
      for (const el of marks) el.style.transition = 'opacity 200ms ease';
      for (let n = 0; n < st.times; n++) {
        for (const el of marks) el.style.opacity = '0';
        await sleep(WAIT.blinkOff);
        if (gen !== my) return;
        for (const el of marks) el.style.opacity = '1';
        await sleep(WAIT.blinkOn);
        if (gen !== my) return;
      }
      renderFrame(st.snap);
      await sleep(WAIT.blinkHold);
    } else if (st.t === 'slide') {
      if (curFrame !== st.f) renderFrame(st.f, true);
      await sleep(WAIT.slideLead);
      if (gen !== my) return;
      const movers = st.idx.map((i) => els[i]);
      // Wraparound refill, exactly like the live game's drag preview: a
      // low-opacity copy of every moving cell trails one full period behind,
      // so whatever slides off one end is visibly re-entering the other, in
      // the same order, before the drop.
      const ghosts = movers.map((el) => {
        const g = el.cloneNode(true) as HTMLElement;
        g.style.opacity = '0.4';
        g.style.left = parseFloat(el.style.left) - st.wx + 'px';
        g.style.top = parseFloat(el.style.top) - st.wy + 'px';
        board.appendChild(g);
        return g;
      });
      const DUR = WAIT.slide / SPEED; // authored pace, scaled by the global rate
      const { dx, dy, wx, wy } = st; // narrowed copies for the closures below
      // The authored travel still follows the human drag profile, but the
      // pieces no longer ride it as one rigid block: each one is sprung to
      // the piece ahead of it through the splash's own integrator
      // (engine/dragChain.ts), so a wave runs down the line and the tail
      // keeps swinging for a beat after the head has seated.
      const n = movers.length;
      // One chain slot = one authored step (dx,dy); the wrap distance is a
      // whole period of them, which recovers the per-slot step vector even
      // when a single move covers two slots (dx = 2 steps).
      const stepX = wx / n;
      const stepY = wy / n;
      const slots = stepX || stepY ? Math.round(Math.hypot(dx, dy) / Math.hypot(stepX, stepY)) || 1 : 1;
      const chain = createDragChain({ n, grabbed: 0, onFrame: paintChain });
      function paintChain() {
        for (let i = 0; i < n; i++) {
          const off = chain.at(i);
          const tx = off * stepX;
          const ty = off * stepY;
          movers[i].style.transform = `translate(${tx}px, ${ty}px)`;
          const g = ghosts[i];
          if (g) g.style.transform = `translate(${tx}px, ${ty}px)`;
        }
      }
      const t0 = performance.now();
      await new Promise<void>((resolve) => {
        function tick(now: number) {
          if (gen !== my) return resolve();
          const p = humanP(Math.min(1, (now - t0) / DUR));
          chain.drive(slots * p * Math.sign((dx || dy) * (stepX || stepY) || 1));
          if (p >= 1) resolve();
          else requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
      if (gen !== my) {
        chain.stop();
        return;
      }
      playMove(); // the line reaching its detent, same tick the real board gives
      // Let the wave die into the slot before the pieces seat.
      await new Promise<void>((resolve) => {
        chain.settle(slots * Math.sign((dx || dy) * (stepX || stepY) || 1), resolve);
      });
      chain.stop();
      if (gen !== my) return;
      await sleep(WAIT.slideRelease); // the "release" beat before the pieces seat
      if (gen !== my) return;
      renderFrame(st.snap, true);
      // The same landing the live boards now give a released line, so the
      // lesson teaches the feel it will actually meet in the game.
      seatEls(st.idx.map((i) => els[i]));
      // This line has moved: its own stretched arrow retires, while hints
      // for the moves still to come keep standing.
      for (const a of Array.from(board.querySelectorAll<HTMLElement>('.story-arrow--armed'))) a.remove();
      await sleep(WAIT.slideSettle);
    }
  }

  async function play(i: number) {
    const my = ++gen;
    beat = i;
    sync();
    runProgress(i);
    board.style.opacity = '1';
    for (const st of spec.beats[i]) {
      if (gen !== my) return;
      await runStep(st, my);
    }
    // The tutorial runs itself: watching it through shouldn't need a tap
    // between every card. The buttons stay for going back or replaying, and
    // any of them bumps `gen`, which cancels this hand-off.
    if (i >= spec.beats.length - 1) return;
    await sleepRaw(AUTO_ADVANCE_MS);
    if (gen !== my) return;
    void play(i + 1);
  }

  function sync() {
    bPrev.disabled = beat === 0;
    bNext.disabled = beat === spec.beats.length - 1;
    bFinish.setAttribute('aria-label', beat === spec.beats.length - 1 ? s.doneBtn : s.finishBtn);
  }

  bPrev.addEventListener('click', () => beat > 0 && play(beat - 1));
  bNext.addEventListener('click', () => beat < spec.beats.length - 1 && play(beat + 1));
  bReplay.addEventListener('click', () => play(beat));
  bFinish.addEventListener('click', () => {
    gen++;
    window.removeEventListener('resize', layout);
    // The button is the only way out, and it reads 完成 only on the last beat
    // — so "was the player on the last beat" is exactly "did they finish".
    trackTutorialEnd(spec.id, beat === spec.beats.length - 1, beat + 1, spec.beats.length);
    onDone();
  });

  layout();
  trackTutorialStart(spec.id);
  play(0);
}

import { STRINGS, type Lang } from '../i18n';

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
  /** Blanked cell: light fill + dashed outline. */
  dashed?: boolean;
  /** Thin gray outline (the white dot-face balls). */
  ring?: boolean;
}

export type StoryStep =
  | { t: 'show'; f: number }
  | { t: 'arrow'; x: number; y: number; ang: number; color: string }
  | { t: 'slide'; f: number; idx: number[]; dx: number; dy: number; wx: number; wy: number; snap: number }
  | { t: 'checks'; pts: { x: number; y: number }[]; color: string }
  | { t: 'flip'; f: number; idx: number[]; snap: number }
  | { t: 'fade'; snap: number }
  | { t: 'pause'; ms: number };

export interface StorySpec {
  w: number;
  h: number;
  frames: StoryCell[][];
  beats: StoryStep[][];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
/** The drag profile: ease out to just past half way, hesitate like a real
 *  finger deciding, then commit the rest — never one instant jump. */
function humanP(t: number): number {
  if (t < 0.42) return ease(t / 0.42) * 0.58;
  if (t < 0.56) return 0.58;
  return 0.58 + ease((t - 0.56) / 0.44) * 0.42;
}

function cellSvg(c: StoryCell): string {
  const dash = c.dashed ? ' stroke="#6F6F6F" stroke-width="4" stroke-dasharray="12 9"' : '';
  const ring = c.ring && !c.dashed ? ' stroke="#9A9A9A" stroke-width="3.5"' : '';
  let shape = '';
  if (c.shape === 'ci') shape = `<circle cx="50" cy="50" r="45" fill="${c.fill}"${ring}${dash}/>`;
  else if (c.shape === 'sq') shape = `<rect x="4" y="4" width="92" height="92" rx="20" fill="${c.fill}"${dash}/>`;
  else {
    const pts = c.shape === 'up' ? '50,3 97,93 3,93' : '3,7 97,7 50,97';
    shape = `<polygon points="${pts}" fill="${c.fill}"${dash} stroke-linejoin="round"/>`;
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
  ` stroke-linecap="round" stroke-dasharray="9 8"/><path d="M2 -11 L24 0 L2 11 Z" fill="${color}"/></svg>`;

const CHECK_SVG = (color: string) =>
  `<svg viewBox="0 0 60 60"><path d="M12 32 L26 47 L50 12" fill="none" stroke="${color}"` +
  ` stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function renderStoryTutorial(container: HTMLElement, lang: Lang, spec: StorySpec, onDone: () => void): void {
  const s = STRINGS[lang];
  container.innerHTML = `
    <div class="app story-tut">
      <div class="story-stage" id="stStage"><div class="story-board" id="stBoard"></div></div>
      <div class="controls story-controls">
        <button class="icon-btn" id="stPrev">${s.prev}</button>
        <button class="icon-btn" id="stReplay">${s.replay}</button>
        <button class="icon-btn" id="stNext">${s.next}</button>
        <button class="icon-btn" id="stFinish">${s.finishBtn}</button>
      </div>
    </div>
  `;
  const stage = container.querySelector<HTMLElement>('#stStage')!;
  const board = container.querySelector<HTMLElement>('#stBoard')!;
  const bPrev = container.querySelector<HTMLButtonElement>('#stPrev')!;
  const bReplay = container.querySelector<HTMLButtonElement>('#stReplay')!;
  const bNext = container.querySelector<HTMLButtonElement>('#stNext')!;
  const bFinish = container.querySelector<HTMLButtonElement>('#stFinish')!;

  board.style.width = spec.w + 'px';
  board.style.height = spec.h + 'px';
  function layout() {
    const scale = Math.min(1, (stage.clientWidth || spec.w) / spec.w);
    board.style.transform = `scale(${scale})`;
    stage.style.height = spec.h * scale + 'px';
  }
  window.addEventListener('resize', layout);

  let els: HTMLElement[] = [];
  function renderFrame(f: number) {
    board.innerHTML = '';
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
  }

  let gen = 0;
  let beat = 0;

  async function runStep(st: StoryStep, my: number): Promise<void> {
    if (st.t === 'show') {
      renderFrame(st.f);
      await sleep(350);
    } else if (st.t === 'pause') {
      await sleep(st.ms);
    } else if (st.t === 'arrow') {
      const a = document.createElement('div');
      a.className = 'story-arrow';
      a.style.left = st.x + 'px';
      a.style.top = st.y + 'px';
      a.style.transform = `translate(-50%,-50%) rotate(${st.ang}deg)`;
      a.innerHTML = `<span class="story-arrow-nudge">${ARROW_SVG(st.color)}</span>`;
      board.appendChild(a);
      await sleep(1350);
    } else if (st.t === 'checks') {
      for (const p of st.pts) {
        const c = document.createElement('div');
        c.className = 'story-check';
        c.style.left = p.x + 'px';
        c.style.top = p.y + 'px';
        c.innerHTML = CHECK_SVG(st.color);
        board.appendChild(c);
      }
      await sleep(2100);
    } else if (st.t === 'flip') {
      renderFrame(st.f);
      for (const i of st.idx) {
        els[i].style.transition = 'transform 380ms ease-in';
        els[i].style.transform = 'scaleX(0.02)';
      }
      await sleep(400);
      if (gen !== my) return;
      renderFrame(st.snap);
      for (const i of st.idx) els[i].style.transform = 'scaleX(0.02)';
      void board.offsetWidth;
      for (const i of st.idx) {
        els[i].style.transition = 'transform 380ms ease-out';
        els[i].style.transform = '';
      }
      await sleep(430);
    } else if (st.t === 'fade') {
      board.style.transition = 'opacity 300ms ease';
      board.style.opacity = '0.25';
      await sleep(320);
      if (gen !== my) return;
      renderFrame(st.snap);
      board.style.opacity = '1';
      await sleep(340);
    } else if (st.t === 'slide') {
      renderFrame(st.f);
      await sleep(380);
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
      const DUR = 2600;
      const { dx, dy } = st; // narrowed copy — the closure below can't re-narrow st
      const t0 = performance.now();
      await new Promise<void>((resolve) => {
        function tick(now: number) {
          if (gen !== my) return resolve();
          const p = humanP(Math.min(1, (now - t0) / DUR));
          const tx = dx * p;
          const ty = dy * p;
          for (const el of movers) el.style.transform = `translate(${tx}px, ${ty}px)`;
          for (const g of ghosts) g.style.transform = `translate(${tx}px, ${ty}px)`;
          if (p >= 1) resolve();
          else requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
      if (gen !== my) return;
      await sleep(260); // the "release" beat before the pieces seat
      if (gen !== my) return;
      renderFrame(st.snap);
      await sleep(300);
    }
  }

  async function play(i: number) {
    const my = ++gen;
    beat = i;
    sync();
    board.style.opacity = '1';
    for (const st of spec.beats[i]) {
      if (gen !== my) return;
      await runStep(st, my);
    }
  }

  function sync() {
    bPrev.disabled = beat === 0;
    bNext.disabled = beat === spec.beats.length - 1;
    bFinish.textContent = beat === spec.beats.length - 1 ? s.doneBtn : s.finishBtn;
  }

  bPrev.addEventListener('click', () => beat > 0 && play(beat - 1));
  bNext.addEventListener('click', () => beat < spec.beats.length - 1 && play(beat + 1));
  bReplay.addEventListener('click', () => play(beat));
  bFinish.addEventListener('click', () => {
    gen++;
    window.removeEventListener('resize', layout);
    onDone();
  });

  layout();
  play(0);
}

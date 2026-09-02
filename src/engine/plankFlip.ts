/**
 * The flip, exactly as the splash performs it (src/ui/loadingScreen.ts is
 * the source of these numbers): a two-faced plank — the old print on the
 * front, the new print on the back, held a hair apart in Z, no strip closing
 * the sides — that lifts toward the viewer, rolls a half-turn about the axis
 * the scoring move travelled across, overshoots, rocks back and seats, with
 * a soft shadow opening underneath while it is off the board.
 *
 * It is direction-proof by construction. A half-turn about any in-plane axis
 * is, seen flat on, a mirror across that axis — roll a piece downwards and
 * it lands upside down, on a diagonal and it lands cocked over. No rotation
 * can undo a mirror, so the back face is mounted already carrying that same
 * half-turn: the plank turns through it, the two cancel exactly, and the
 * settled piece sits in its rest pose with nothing changed but its face.
 *
 * It is also shape-proof: instead of knowing how any board draws a tile, it
 * clones the tile's element as it looked before the commit (the old face)
 * and as it looks after the re-render (the new face), and turns one into
 * the other. gameController drives it for every shape from one place.
 */
import { animate } from 'animejs';
import { reducedMotion } from './juice';
import { flipRate } from './flipSpeed';

/**
 * 设计时长。真正用的是底下那两个函数——玩家在天才特供里那根拉杆能把它整体
 * 调快调慢（一半到两倍），所以任何地方都不该直接拿这两个常数去排时间，
 * 否则动画和等它的那段代码会各走各的，慢的那一档会被切掉半个翻面。
 */
export const FLIP_MS = 350;
export const FLIP_STAGGER_MS = 90;

/** 这一刻一次翻面要多久。 */
export const flipMs = (): number => FLIP_MS / flipRate();
/** 这一刻同一批里两枚之间错开多久。跟着一起缩放，队形才不变。 */
export const flipStaggerMs = (): number => FLIP_STAGGER_MS / flipRate();
const THICK = 0.020; // face separation in Z, x piece diameter
const PERSPECTIVE = 3.3; // viewing distance, x piece diameter
const LIFT = 0.05; // rise toward the viewer mid-turn, x piece diameter
const OVERSHOOT = 26; // degrees past the half-turn before it rocks back
const SHADOW = 0.46; // peak opacity of the cast shadow

/** A clone of `el` as it looks right now, restyled to fill whatever box it
 *  is later placed into — the inline left/top/size the boards put on their
 *  tiles would otherwise displace it inside the plank. */
export function faceClone(el: HTMLElement): HTMLElement {
  const c = el.cloneNode(true) as HTMLElement;
  c.style.position = 'absolute';
  c.style.left = '0';
  c.style.top = '0';
  c.style.right = 'auto';
  c.style.bottom = 'auto';
  c.style.width = '100%';
  c.style.height = '100%';
  c.style.margin = '0';
  c.style.opacity = '1';
  c.style.translate = '';
  c.style.scale = '';
  c.style.transform = '';
  c.style.animation = 'none';
  c.style.pointerEvents = 'none';
  return c;
}

const key = (r: number, c: number) => `${r},${c}`;

/**
 * Takes the boards' own one-shot `.flip-in` squish off a tile the plank is
 * about to turn.
 *
 * Every board applies that squish on the render right after a commit, which
 * is correct when nothing else is animating the tile — but when the plank
 * is coming, the player sees the squish play and *then* the plank turn, so
 * the piece flips twice. plankFlipEl already cancels it, but only when that
 * tile's own turn comes up in the stagger, which is up to a few hundred
 * milliseconds later — long enough for the squish to have played out. So it
 * is stripped from the whole group at once, before the first plank starts.
 *
 * The squish sometimes arrives as a class and sometimes as one component of
 * an `animation` shorthand shared with the ongoing score pulse (see
 * applyScoreAnimations), which is why this cannot simply clear the
 * property: the pulse has to survive.
 */
function muteSquish(el: HTMLElement): void {
  el.classList.remove('flip-in');
  const anim = el.style.animation;
  if (!anim.includes('flip-in')) return;
  const delays = (el.style.animationDelay || '').split(',').map((d) => d.trim());
  const keep: string[] = [];
  const keepDelays: string[] = [];
  // The shorthand does not read back the way it was written: browsers
  // serialise each component with its *name last* — "300ms ease-out 0s 1
  // normal both running flip-in" — so a component is recognised by the
  // token it contains, never by the one it starts with. Matching on the
  // start silently kept every component, which is how the squish survived
  // this and played a second flip under the plank.
  const isSquish = (part: string) => part.trim().split(/\s+/).includes('flip-in');
  anim.split(',').forEach((part, i) => {
    if (isSquish(part)) return;
    keep.push(part.trim());
    keepDelays.push(delays[i] ?? '0s');
  });
  el.style.animation = keep.join(', ');
  el.style.animationDelay = keepDelays.join(', ');
}

/**
 * Called just before a commit turns cells over, while their elements still
 * show the old face: snapshots each one for use as the plank's front.
 */
export function snapFlipFaces(boardEl: HTMLElement, cells: readonly (readonly [number, number])[]): Map<string, HTMLElement> {
  const snaps = new Map<string, HTMLElement>();
  if (reducedMotion()) return snaps;
  for (const [r, c] of cells) {
    const el = boardEl.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
    if (el) snaps.set(key(r, c), faceClone(el));
  }
  return snaps;
}

/**
 * Called right after the commit's re-render has painted the new faces:
 * finds each cell's fresh element and turns the old face into the new one.
 * `dirDeg` is the direction of the move that caused this score, in screen
 * degrees (+x = 0, +y = 90) — the flourish in the air; it never affects
 * where anything lands.
 */
export function plankFlipCells(
  boardEl: HTMLElement,
  cells: readonly (readonly [number, number])[],
  snaps: Map<string, HTMLElement>,
  dirDeg: number,
): void {
  if (reducedMotion()) return;
  // First, across the whole group: the plank owns this flip, so nothing
  // else may animate the turn while these tiles wait their stagger.
  for (const [r, c] of cells) {
    const el = boardEl.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
    if (el) muteSquish(el);
  }
  cells.forEach(([r, c], n) => {
    const el = boardEl.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
    const front = snaps.get(key(r, c));
    if (!el || !front) return;
    window.setTimeout(() => {
      if (!el.isConnected) return;
      plankFlipEl(el, front, dirDeg);
    }, n * flipStaggerMs());
  });
}

/** The turn itself, on one element whose content is already the new face. */
export function plankFlipEl(el: HTMLElement, front: HTMLElement, dirDeg: number): void {
  if (reducedMotion()) return;
  const box = el.getBoundingClientRect();
  const d = Math.max(box.width, box.height);
  if (!d) return;
  // The boards' own one-shot flip class (and any seat squash mid-flight)
  // would fight the plank for the same element — the plank owns this moment.
  muteSquish(el);
  for (const a of el.getAnimations()) a.cancel();
  el.dataset.flipping = '1';

  const back = faceClone(el);
  const saved = {
    html: el.innerHTML,
    bg: el.style.background,
    shadow: el.style.boxShadow,
    perspective: el.style.perspective,
  };
  const t = d * THICK;
  // 这一次翻面多久——玩家那根拉杆定的。整段动画的每一小节都按这个数分，
  // 所以快慢变的是速度，节奏的比例不变。
  const ms = flipMs();
  const halfTurn = `rotateZ(${dirDeg}deg) rotateY(180deg) rotateZ(${-dirDeg}deg)`;
  const radius = getComputedStyle(el).borderRadius || '30%';

  el.style.background = 'transparent';
  el.style.boxShadow = 'none';
  el.style.perspective = d * PERSPECTIVE + 'px';
  el.innerHTML = '';

  const shadow = document.createElement('div');
  shadow.className = 'plank-cast';
  shadow.style.borderRadius = radius;
  shadow.style.filter = `blur(${(d * 0.06).toFixed(1)}px)`;

  const plank = document.createElement('div');
  plank.className = 'plank-turn';
  const mkFace = (transform: string, content: HTMLElement) => {
    const f = document.createElement('div');
    f.className = 'plank-turn-face';
    f.style.transform = transform;
    f.appendChild(content);
    return f;
  };
  plank.appendChild(mkFace(`translateZ(${t / 2}px)`, front));
  plank.appendChild(mkFace(`${halfTurn} translateZ(${t / 2}px)`, back));
  el.appendChild(shadow);
  el.appendChild(plank);

  const peak = d * LIFT;
  const k = { rot: 0, z: 0 };
  const write = () => {
    plank.style.transform = `translateZ(${k.z}px) rotateZ(${dirDeg}deg) rotateY(${k.rot}deg) rotateZ(${-dirDeg}deg)`;
    const up = peak > 0 ? k.z / peak : 0;
    shadow.style.opacity = String(SHADOW * up);
    shadow.style.scale = String(1 + 0.16 * up);
  };
  write();
  animate(k, {
    rot: [
      { to: 180 + OVERSHOOT, duration: ms * 0.62, ease: 'out(2)' },
      { to: 180 - OVERSHOOT * 0.4, duration: ms * 0.2 },
      { to: 180 + OVERSHOOT * 0.15, duration: ms * 0.1 },
      { to: 180, duration: ms * 0.08 },
    ],
    z: [
      { to: peak, duration: ms * 0.3, ease: 'out(3)' },
      { to: 0, duration: ms * 0.45, ease: 'in(2)' },
    ],
    onUpdate: write,
    onComplete: () => {
      delete el.dataset.flipping;
      // A later render may already have replaced this element's content —
      // in that case the plank is gone and the newer paint must stand.
      if (!plank.isConnected || plank.parentElement !== el) return;
      el.innerHTML = saved.html;
      el.style.background = saved.bg;
      el.style.boxShadow = saved.shadow;
      el.style.perspective = saved.perspective;
    },
  });
}

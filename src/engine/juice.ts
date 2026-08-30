/**
 * Shared "game feel" toolkit — hit-stop, screen shake, particle bursts, a
 * punch/overshoot pop, and the interaction sounds — built once here
 * and driven from gameController.ts's cascade stepper (the one path every
 * shape's scoring/removal already funnels through) instead of six separate
 * per-shape implementations. Every visual effect checks prefers-reduced-
 * motion itself, so callers never have to remember to.
 */
import { play } from 'cuelume';

export function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Front-loaded deceleration — most of the travel happens early, then a long soft settle, reading as friction rather than a hard stop. */
export const EASE_GROUNDED = 'cubic-bezier(0.22, 1, 0.36, 1)';
/** Overshoots past 1.0 before settling back — the "punch" feel. */
export const EASE_PUNCH = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

/**
 * Forces the browser to notice a class was removed before it's re-added, so
 * retriggering the same CSS animation while it's already mid-flight (e.g. a
 * fast run of scores) actually restarts it instead of being a silent no-op.
 */
export function retrigger(el: HTMLElement, className: string): void {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

/**
 * A brief pause before continuing a sequence — the cheapest, highest-payoff
 * "impact" trick in action games: nothing animates any differently, time
 * just visibly catches for a beat right at the moment of contact. Resolves
 * immediately under reduced motion.
 */
export function hitStop(ms: number): Promise<void> {
  if (reducedMotion() || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type ShakeTier = 'light' | 'medium' | 'heavy';
const SHAKE_CLASS: Record<ShakeTier, string> = {
  light: 'juice-shake-light',
  medium: 'juice-shake-medium',
  heavy: 'juice-shake-heavy',
};
/** Translate *and* rotate jitter on el — pure translate alone reads as a display glitch, not a force. */
export function screenShake(el: HTMLElement, tier: ShakeTier): void {
  if (reducedMotion()) return;
  retrigger(el, SHAKE_CLASS[tier]);
}

export interface ParticleOpts {
  color: string;
  count?: number;
  spread?: number; // px
  life?: number; // ms
}
/**
 * Short-lived divs radiating out from (x, y), board-local pixels, appended
 * into container. Evenly spaced angles plus a little random jitter so the
 * burst reads as a ring without looking mechanically perfect; a slight
 * upward bias before the eased drift down mimics debris getting knocked
 * loose and then settling, rather than just dissolving in place.
 */
export function spawnParticles(container: HTMLElement, x: number, y: number, opts: ParticleOpts): void {
  if (reducedMotion()) return;
  const { color, count = 10, spread = 46, life = 560 } = opts;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.6;
    const dist = spread * (0.6 + Math.random() * 0.5);
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - spread * 0.25;
    const p = document.createElement('div');
    p.className = 'juice-particle';
    p.style.left = x + 'px';
    p.style.top = y + 'px';
    p.style.background = color;
    p.style.setProperty('--dx', dx.toFixed(1) + 'px');
    p.style.setProperty('--dy', dy.toFixed(1) + 'px');
    p.style.animationDuration = life + 'ms';
    container.appendChild(p);
    setTimeout(() => p.remove(), life + 40);
  }
}

/** One-shot punch/overshoot pop on el (a score digit strip, a gain badge, ...). */
export function punch(el: HTMLElement): void {
  if (reducedMotion()) return;
  retrigger(el, 'juice-punch');
}

// ---------- interaction sounds ----------
/*
 * Sound comes from cuelume (MIT): a curated palette of interaction cues,
 * each synthesized live through the Web Audio API. Nothing is downloaded and
 * no audio files ship — so the whole soundtrack costs a couple of kilobytes
 * and works offline, exactly like the fonts and icons do.
 *
 * The design work here is only picking which of its seventeen cues belongs
 * to which moment; the envelopes, the shimmer tails and the limiter are the
 * library's. Every cue is deliberately quiet: this is a puzzle game someone
 * may play for twenty minutes, so feedback has to stay under the threshold
 * of "musical menu that gets annoying very quickly".
 */

/** Which cue each event gets, and how loud. */
const CUE = {
  /** A dry detent click. Fires once per slot the drag crosses, not once per
   *  drop, so pulling a whole row reads as a run of ticks under the finger —
   *  the same notched feel the haptic buzz beside it already gives. */
  move: { name: 'tick', vol: 0.35 },
  /** A soft two-note bell: the reward beat. */
  score: { name: 'chime', vol: 0.6 },
  /** A mechanical click-clack: a tile turning over to its dot face. */
  flip: { name: 'toggle', vol: 0.4 },
  /** A note gliding downward: a whole line draining off the board. */
  clear: { name: 'droplet', vol: 0.8 },
  /** A warm swell as a window opens. */
  open: { name: 'bloom', vol: 0.55 },
  /** A soft hush as it goes. */
  close: { name: 'whisper', vol: 0.5 },
  /** 完成 / 结束 — a short warm three-note "done", not a fanfare. */
  finish: { name: 'success', vol: 0.6 },
  /** Caught by a bomb: a calm, recoverable refusal rather than a buzzer. */
  error: { name: 'error', vol: 0.6 },
  /** 开始游戏 — a lock-on sweep resolving to a clear tone. */
  ready: { name: 'ready', vol: 0.6 },
  /** 暂停 — a three-step locator, so pausing sounds like stepping aside. */
  pause: { name: 'scan', vol: 0.5 },
  /** Arriving at 个人主页 / 记录与排名 — a rising harmonic portal. */
  arrive: { name: 'arrival', vol: 0.55 },
  /** The run settling into its final score. */
  settle: { name: 'release', vol: 0.6 },
} as const;

/** One detent crossed mid-drag. Called from every shape's drag preview. */
export function playMove(): void {
  play(CUE.move.name, { volume: CUE.move.vol });
}

/**
 * A scoring step. The palette has fixed pitches, so escalation through a
 * chain reaction is carried by volume rather than by the rising scale the
 * old hand-rolled oscillator used.
 */
export function playScore(comboTier: number): void {
  play(CUE.score.name, { volume: Math.min(1, CUE.score.vol + (comboTier - 1) * 0.12) });
}

/** Matched pieces turning over. */
export function playFlip(): void {
  play(CUE.flip.name, { volume: CUE.flip.vol });
}

/** A whole line clearing — the bigger, rarer moment. */
export function playClear(): void {
  play(CUE.clear.name, { volume: CUE.clear.vol });
}

/** 完成 / 结束 — every button that closes something out for good. */
export function playFinish(): void {
  play(CUE.finish.name, { volume: CUE.finish.vol });
}

/** The run ended on a bomb. */
export function playError(): void {
  play(CUE.error.name, { volume: CUE.error.vol });
}

/** 开始游戏. */
export function playReady(): void {
  play(CUE.ready.name, { volume: CUE.ready.vol });
}

/** 暂停. */
export function playPause(): void {
  play(CUE.pause.name, { volume: CUE.pause.vol });
}

/** Landing on 个人主页 or 记录与排名. */
export function playArrive(): void {
  play(CUE.arrive.name, { volume: CUE.arrive.vol });
}

/** The end-of-run settlement panel. */
export function playSettle(): void {
  play(CUE.settle.name, { volume: CUE.settle.vol });
}

/** A window, panel or overlay coming up. */
export function playOpen(): void {
  play(CUE.open.name, { volume: CUE.open.vol });
}

/** ...and going away again. */
export function playClose(): void {
  play(CUE.close.name, { volume: CUE.close.vol });
}

/**
 * Opens the audio context from inside a real user gesture.
 *
 * Safari wants the AudioContext *created* during a gesture, not merely
 * resumed from one — and cuelume builds its context lazily on the first
 * play(), which in this game is always inside an animation timer or a
 * cascade callback. Left alone, that means a session with no sound at all.
 *
 * So the first pointerdown plays a real cue at an inaudible volume, purely
 * to get the context constructed while the gesture is still on the stack.
 * (A volume of exactly 0 would be short-circuited before the context is
 * touched, which is why this is a very small number rather than zero.)
 */
export function unlockAudio(): void {
  play('tick', { volume: 0.0002 });
}

/**
 * Gives every click in the app its own cue.
 *
 * Rather than sprinkling playOpen/playClose through twenty call sites (and
 * missing the twenty-first), one delegated listener classifies each click by
 * direction: anything that dismisses, closes or goes back gets the closing
 * hush, and everything else — starting a game, opening a panel, picking a
 * mode, moving to a page — gets the opening swell.
 *
 * The selectors are ids and classes, never button text, so the rule holds in
 * all four languages. Board tiles are plain <div>s and match nothing here, so
 * dragging a line stays on its own move cue instead of also clicking.
 *
 * Listening on the capture phase matters: several handlers in the app call
 * stopPropagation(), and a cue that only fires on the ones that don't would
 * be worse than no cue at all.
 */
const CUE_CLICKABLE = 'button, [role="button"], a[href]';
/** Anything that takes the player back out of where they are. */
const CUE_CLOSING = [
  '[data-cue="close"]',
  '[id$="Close"]',
  '[id$="CloseBtn"]',
  '[id$="BackBtn"]',
  '#backBtn',
  '#continueBtn',
  '#stFinish',
  '.profile-row--back',
  // Tapping the tab you are already on returns to the menu.
  '.home-nav-btn--active',
].join(',');

/**
 * Buttons that mean something more specific than "forward" or "back", and so
 * get their own cue ahead of the open/close default. Checked in order.
 *
 * The nav pair is matched only while it is NOT the active tab: tapping the
 * tab you are already on takes you back to the menu, which is a closing move,
 * not an arrival.
 */
const CUE_OVERRIDES: [selector: string, cue: () => void][] = [
  ['#startBtn', playReady],
  ['#stopBtn', playPause],
  ['#navProfile:not(.home-nav-btn--active), #navRecords:not(.home-nav-btn--active)', playArrive],
  ['#stFinish, #finishBtn, #stuckEndBtn, [data-cue="finish"]', playFinish],
];

export function wireClickCues(): void {
  if (typeof document === 'undefined') return;
  document.addEventListener(
    'click',
    (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const hit = target.closest(CUE_CLICKABLE);
      if (!hit || hit.closest('[data-cue="none"]')) return;
      for (const [selector, cue] of CUE_OVERRIDES) {
        if (hit.closest(selector)) {
          cue();
          return;
        }
      }
      if (hit.closest(CUE_CLOSING)) playClose();
      else playOpen();
    },
    true,
  );
}

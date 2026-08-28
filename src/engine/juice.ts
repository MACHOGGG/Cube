/**
 * Shared "game feel" toolkit — hit-stop, screen shake, particle bursts, a
 * punch/overshoot pop, and a tiny synthesized hit sound — built once here
 * and driven from gameController.ts's cascade stepper (the one path every
 * shape's scoring/removal already funnels through) instead of six separate
 * per-shape implementations. Every visual effect checks prefers-reduced-
 * motion itself, so callers never have to remember to.
 */

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

// ---------- synthesized audio (no audio files) ----------
let sharedCtx: AudioContext | null = null;
function audioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!sharedCtx) sharedCtx = new AC();
  if (sharedCtx.state === 'suspended') sharedCtx.resume().catch(() => {});
  return sharedCtx;
}

/**
 * A short "hit" blip: one oscillator through a fast-attack/exponential-decay
 * gain envelope. comboTier raises the base pitch a little each step (a
 * rising scale gives an "accumulating" feel across a chain) and every hit
 * gets a small random pitch jitter so a fast run of them doesn't sound like
 * the exact same sample replayed.
 */
export function playHit(comboTier: number, kind: 'match' | 'bonus' | 'explode' = 'match'): void {
  const c = audioCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.connect(gain);
  gain.connect(c.destination);
  const base = kind === 'bonus' ? 320 : kind === 'explode' ? 140 : 480;
  const jitter = 1 + (Math.random() - 0.5) * 0.07;
  osc.type = kind === 'explode' ? 'sawtooth' : 'sine';
  osc.frequency.value = (base + comboTier * 17) * jitter;
  const now = c.currentTime;
  const peak = kind === 'explode' ? 0.22 : 0.14;
  const decay = kind === 'explode' ? 0.32 : 0.18;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peak, now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);
  osc.start(now);
  osc.stop(now + decay + 0.02);
}

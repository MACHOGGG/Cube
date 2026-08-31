/**
 * The colourblind palette, as one setting for the whole app rather than a
 * button on each board.
 *
 * It used to be a per-game toggle that reset every time you started a run,
 * which is the wrong shape for what it is: someone who needs it needs it
 * everywhere, once. So it lives in 个人主页, is remembered, and every board
 * — plus the play screen's own ground, chips and pattern marks, through the
 * `data-cvd` attribute this puts on <html> — follows it.
 */
const KEY = 'slides_colorblind';
type Listener = () => void;

const listeners = new Set<Listener>();
let on = read();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Mirrors the setting onto <html> so the stylesheet can follow it too. */
function paint(): void {
  if (typeof document === 'undefined') return;
  if (on) document.documentElement.setAttribute('data-cvd', '1');
  else document.documentElement.removeAttribute('data-cvd');
}
paint();

export function colorblindOn(): boolean {
  return on;
}

export function setColorblind(next: boolean): void {
  if (next === on) return;
  on = next;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* private mode: the setting just won't outlive the session */
  }
  paint();
  for (const fn of Array.from(listeners)) fn();
}

/** Subscribes to changes; call the returned function to stop listening. */
export function onColorblindChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

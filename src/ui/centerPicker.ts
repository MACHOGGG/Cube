import { vibrate } from '../engine/haptics';

export interface PickerOption {
  /** Inline SVG for this option's icon. */
  glyph: string;
  label: string;
  /** Draws the label under the icon; off by default, since most options are
   *  told apart by the piece drawn inside them rather than by words. */
  showLabel?: boolean;
  onPick: () => void;
}

export interface CenterPickerOpts {
  /** The card that was tapped — the modal flies out of exactly this box. */
  originEl: HTMLElement;
  title: string;
  /** A row of individually pickable icons. */
  options?: PickerOption[];
  /** Or a whole pre-built panel (the bomb tiers), blown up as one piece. */
  panel?: HTMLElement;
  /** Class the blown-up panel gets — defaults to the bomb panel's own. */
  panelClass?: string;
  /** Start the options stacked on top of each other and let them fan apart
   *  as the modal lands — the "one clock splits into three" beat. */
  split?: boolean;
}

const FLIGHT_MS = 380;
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Blows a home-page card up into the middle of the screen.
 *
 * The flight is a FLIP: the modal is laid out at its real, final, centred
 * size first, then transformed *back* onto the tapped card's box for one
 * frame and released — so the thing that lands is always correctly sized and
 * laid out, however far it travelled, and no arithmetic has to predict the
 * final layout in advance.
 *
 * The page behind is faded rather than covered: the reference design washes
 * the home grid out to half strength instead of dropping a dark scrim over
 * it, which keeps the (bright, colourful) grid readable as context.
 */
export function openCenterPicker(opts: CenterPickerOpts): () => void {
  const appEl = document.querySelector<HTMLElement>('#app');
  appEl?.classList.add('home-dimmed');

  const overlay = document.createElement('div');
  overlay.className = 'center-pick';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', opts.title);

  const body = document.createElement('div');
  body.className = 'center-pick-body';

  const optionEls: HTMLElement[] = [];
  if (opts.panel) {
    opts.panel.classList.add(opts.panelClass ?? 'bomb-panel--big');
    body.appendChild(opts.panel);
  } else {
    const row = document.createElement('div');
    row.className = 'center-pick-row' + (opts.split ? ' center-pick-row--split' : '');
    for (const opt of opts.options ?? []) {
      const btn = document.createElement('button');
      btn.className = 'center-pick-opt';
      btn.setAttribute('aria-label', opt.label);
      btn.innerHTML = opt.glyph + (opt.showLabel ? `<span class="center-pick-label">${opt.label}</span>` : '');
      btn.addEventListener('pointerdown', () => {
        btn.classList.remove('home-tap');
        void btn.offsetWidth;
        btn.classList.add('home-tap');
      });
      btn.addEventListener('animationend', () => btn.classList.remove('home-tap'));
      btn.addEventListener('click', () => {
        vibrate(12);
        close();
        opt.onPick();
      });
      row.appendChild(btn);
      optionEls.push(btn);
    }
    body.appendChild(row);
  }

  overlay.appendChild(body);
  document.body.appendChild(overlay);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    appEl?.classList.remove('home-dimmed');
    overlay.classList.remove('center-pick--in');
    overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
    // Belt and braces: a display change or a reduced-motion setting can mean
    // no transition ever runs, and the overlay must not be left behind.
    setTimeout(() => overlay.remove(), FLIGHT_MS + 120);
    window.removeEventListener('keydown', onKey);
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  window.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  if (reduceMotion()) {
    overlay.classList.add('center-pick--in');
    return close;
  }

  // --- FLIP: measure where everything actually landed, then rewind ---------
  const from = opts.originEl.getBoundingClientRect();
  const to = body.getBoundingClientRect();
  // When the options fan apart, match the *single* option to the tapped card
  // rather than the whole row — the card that was tapped is one clock, so one
  // clock is what should appear to lift off it.
  const ref = opts.split && optionEls[0] ? optionEls[0].getBoundingClientRect() : to;
  const scale = ref.width > 0 ? from.width / ref.width : 0.3;
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);

  body.style.transition = 'none';
  body.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
  body.style.opacity = '0.55';

  const spreads: number[] = [];
  if (opts.split && optionEls.length) {
    const rowCenter = optionEls.reduce((sum, el) => {
      const r = el.getBoundingClientRect();
      return sum + r.left + r.width / 2;
    }, 0) / optionEls.length;
    for (const el of optionEls) {
      const r = el.getBoundingClientRect();
      const offset = rowCenter - (r.left + r.width / 2);
      spreads.push(offset);
      el.style.transition = 'none';
      el.style.transform = `translateX(${offset}px)`;
    }
  }

  void body.offsetWidth; // commit the rewound state before releasing it

  requestAnimationFrame(() => {
    overlay.classList.add('center-pick--in');
    body.style.transition = `transform ${FLIGHT_MS}ms cubic-bezier(0.22, 0.9, 0.28, 1.06), opacity 200ms ease`;
    body.style.transform = '';
    body.style.opacity = '';
    optionEls.forEach((el, i) => {
      if (!spreads.length) return;
      // A touch behind the flight itself, so the split reads as a second beat
      // rather than happening on the way over.
      el.style.transition = `transform ${FLIGHT_MS}ms cubic-bezier(0.2, 0.9, 0.25, 1.12) ${90 + i * 45}ms`;
      el.style.transform = '';
    });
  });

  return close;
}

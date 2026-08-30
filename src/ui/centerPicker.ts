import { vibrate } from '../engine/haptics';

export interface PickerOption {
  /** Inline SVG for this option's icon. */
  glyph: string;
  label: string;
  /** Draws the label under the icon; off by default, since most options are
   *  told apart by the piece drawn inside them rather than by words. */
  showLabel?: boolean;
  /** This glyph is a 2:1 box, not a square one (进阶三角's two arms) — it
   *  takes a double-width slot, and the row wraps rather than squeezing it. */
  wide?: boolean;
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
/** The fan-out after the flight — longer than the flight, and overshooting. */
const SPLIT_MS = 460;
/** How far apart the three are rotated while still stacked. */
const FAN_DEG = 11;
/** How small they start, before springing to full size. */
const STACK_SCALE = 0.62;
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
      btn.className = 'center-pick-opt' + (opt.wide ? ' center-pick-opt--wide' : '');
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
    setTimeout(() => overlay.remove(), FLIGHT_MS + SPLIT_MS + 120);
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

  // The split used to collapse the three onto the row's horizontal centre and
  // then slide them apart sideways, which reads as one blob tearing in two
  // rather than three pieces being dealt out. Instead each one starts stacked
  // on the body's centre — small, and fanned by a few degrees like cards held
  // in a hand — and springs out to its own place. Rotation is what sells them
  // as separate objects while they are still on top of each other.
  const split = opts.split && optionEls.length > 0;
  if (split) {
    const bodyRect = body.getBoundingClientRect();
    const cx = bodyRect.left + bodyRect.width / 2;
    const cy = bodyRect.top + bodyRect.height / 2;
    const last = optionEls.length - 1;
    optionEls.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const ox = cx - (r.left + r.width / 2);
      const oy = cy - (r.top + r.height / 2);
      const fan = (i - last / 2) * FAN_DEG;
      el.style.transition = 'none';
      el.style.transformOrigin = '50% 85%'; // pivot low, so they fan like cards
      el.style.transform = `translate(${ox}px, ${oy}px) rotate(${fan}deg) scale(${STACK_SCALE})`;
    });
  }

  void body.offsetWidth; // commit the rewound state before releasing it

  requestAnimationFrame(() => {
    overlay.classList.add('center-pick--in');
    body.style.transition = `transform ${FLIGHT_MS}ms cubic-bezier(0.22, 0.9, 0.28, 1.06), opacity 200ms ease`;
    body.style.transform = '';
    body.style.opacity = '';
    optionEls.forEach((el, i) => {
      if (!split) return;
      // Dealt out one after another, each on an overshooting curve so it
      // arrives with a little bounce instead of gliding to a stop. The
      // stagger is short — the three should feel flicked out, not queued.
      el.style.transition = `transform ${SPLIT_MS}ms cubic-bezier(0.18, 1.28, 0.32, 1.04) ${70 + i * 60}ms`;
      el.style.transform = '';
      // Hand the element back to CSS once it lands, or the hover lift would
      // inherit this long springy curve.
      el.addEventListener(
        'transitionend',
        () => {
          el.style.transition = '';
          el.style.transformOrigin = '';
        },
        { once: true },
      );
    });
  });

  return close;
}

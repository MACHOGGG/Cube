import { vibrate } from '../engine/haptics';
import { LANG_ORDER, STRINGS, type Lang } from '../i18n';

// Each language is a small horizontal strip of tiles, styled after the
// square board's own tiles — dragging a strip (the same gesture as sliding
// a row in the square game) past a threshold selects that language. A
// floating chevron chip hovers over the strip's trailing edge to hint that
// it can be swiped, the same discoverability problem every board's drag
// needs solving for a first-time player, just met here before they've even
// reached a board. No caption spells the gesture out in words — the glow,
// color and float are meant to carry that on their own.
const STRIP_COLOR_SETS: string[][] = [
  ['#E0654A', '#3F9E8C', '#4C7EAD', '#C2588F'],
  ['#4C7EAD', '#E8A93B', '#8067A8', '#3F9E8C'],
  ['#C2588F', '#4C7EAD', '#E0654A', '#E8A93B'],
  ['#3F9E8C', '#C2588F', '#E8A93B', '#4C7EAD'],
];

export function renderLanguageSelect(container: HTMLElement, onSelect: (lang: Lang) => void) {
  container.innerHTML = `
    <div class="app lang-select-page">
      <h1 class="lang-title">Slides</h1>
      <div class="lang-grid" id="langGrid"></div>
    </div>
  `;

  const grid = container.querySelector<HTMLElement>('#langGrid');
  if (!grid) throw new Error('languageSelect: #langGrid not found');

  LANG_ORDER.forEach((lang, i) => {
    const colors = STRIP_COLOR_SETS[i % STRIP_COLOR_SETS.length];
    const strip = document.createElement('div');
    strip.className = 'lang-strip';
    strip.dataset.lang = lang;
    strip.innerHTML = `
      <div class="lang-tiles">
        ${colors.map((c) => `<div class="lang-tile" style="background:${c}"></div>`).join('')}
      </div>
      <span class="lang-label">${STRINGS[lang].langName}</span>
      <div class="lang-arrows" aria-hidden="true"><span>&#8250;</span><span>&#8250;</span></div>
    `;
    grid.appendChild(strip);
  });

  const THRESHOLD = 64;
  const MAX_DRAG = 110;

  grid.querySelectorAll<HTMLElement>('.lang-strip').forEach((stripEl) => {
    let dragging = false;
    let startX = 0;
    let dx = 0;
    let settled = false;

    function down(e: PointerEvent) {
      if (settled) return;
      dragging = true;
      startX = e.clientX;
      stripEl.style.transition = 'none';
      stripEl.setPointerCapture(e.pointerId);
    }
    function move(e: PointerEvent) {
      if (!dragging) return;
      dx = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, e.clientX - startX));
      stripEl.style.transform = `translateX(${dx}px)`;
    }
    function up() {
      if (!dragging) return;
      dragging = false;
      stripEl.style.transition = 'transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1)';
      if (Math.abs(dx) > THRESHOLD) {
        settled = true;
        vibrate(20);
        stripEl.style.transform = `translateX(${dx > 0 ? MAX_DRAG + 40 : -(MAX_DRAG + 40)}px)`;
        stripEl.classList.add('selected');
        const lang = stripEl.dataset.lang as Lang;
        setTimeout(() => onSelect(lang), 280);
      } else {
        stripEl.style.transform = 'translateX(0)';
      }
      dx = 0;
    }

    stripEl.addEventListener('pointerdown', down);
    stripEl.addEventListener('pointermove', move);
    stripEl.addEventListener('pointerup', up);
    stripEl.addEventListener('pointercancel', up);
  });
}

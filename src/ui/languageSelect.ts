import { vibrate } from '../engine/haptics';
import { LANG_ORDER, STRINGS, type Lang } from '../i18n';

// Each language is one solid-colored rounded bar with its name on it, full
// width — no separate swatches or icons in front of the name, the bar
// itself *is* the language. A dashed connector and a small chevron sit
// outside the bar (never overlapping the text) as the swipe hint. Dragging
// the whole bar left/right past a threshold selects it — same gesture and
// physics as before, just a plainer, more unified visual.
const LANG_COLORS: string[] = ['#2F9E52', '#AD5C82', '#4C68B0', '#6B6560'];

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
    const color = LANG_COLORS[i % LANG_COLORS.length];
    const row = document.createElement('div');
    row.className = 'lang-row';
    row.innerHTML = `
      <div class="lang-strip" data-lang="${lang}" style="background:${color}">
        <span class="lang-label">${STRINGS[lang].langName}</span>
      </div>
      <span class="lang-connector" style="color:${color}"></span>
      <div class="lang-arrow" style="color:${color}" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
    `;
    grid.appendChild(row);
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

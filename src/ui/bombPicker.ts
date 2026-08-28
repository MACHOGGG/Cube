import type { ShapeCardMeta } from '../shapes/types';
import { BOMB_TIER_META, type BombTier } from '../engine/bomb';

/**
 * Popup shape picker for a bomb-challenge tier — overlays the current
 * screen (home page) instead of navigating to a new page, since a tier
 * only needs one extra choice (which shape/layout) before jumping
 * straight into the game.
 */
export function showBombPicker(
  tier: BombTier,
  cards: ShapeCardMeta[],
  onSelect: (id: ShapeCardMeta['id']) => void,
): () => void {
  const meta = BOMB_TIER_META[tier];
  const overlay = document.createElement('div');
  overlay.className = 'overlay show';
  overlay.innerHTML = `
    <div class="modal bomb-picker-modal">
      <h2>${meta.title}</h2>
      <p class="tag-line">${meta.tagline}</p>
      <div class="menu-grid" id="bombPickGrid"></div>
      <div class="btn-row"><button class="secondary" id="bombPickCloseBtn">关闭</button></div>
    </div>
  `;
  document.body.appendChild(overlay);

  function close() {
    overlay.remove();
  }

  const grid = overlay.querySelector<HTMLElement>('#bombPickGrid')!;
  for (const card of cards) {
    const btn = document.createElement('button');
    btn.className = 'shape-card';
    btn.innerHTML = `
      <span class="glyph">${card.glyph}</span>
      <span class="info">
        <span class="name">${card.name}</span>
        <span class="desc">${card.desc}</span>
      </span>
    `;
    btn.addEventListener('click', () => {
      close();
      onSelect(card.id);
    });
    grid.appendChild(btn);
  }

  overlay.querySelector<HTMLButtonElement>('#bombPickCloseBtn')!.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  return close;
}

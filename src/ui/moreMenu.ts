import type { ShapeCardMeta } from '../shapes/types';
import { loadBest } from '../engine/persistence';

export function renderTimedPicker(
  container: HTMLElement,
  cards: ShapeCardMeta[],
  onSelect: (id: ShapeCardMeta['id']) => void,
  onBack: () => void,
) {
  container.innerHTML = `
    <div class="app">
      <h1>计时挑战</h1>
      <p class="tag-line">选择一种棋盘形状，60 秒内尽可能得分</p>
      <div class="menu-grid" id="timedGrid"></div>
      <div class="controls">
        <button class="icon-btn" id="backBtn">返回</button>
      </div>
    </div>
  `;

  const grid = container.querySelector<HTMLElement>('#timedGrid');
  if (!grid) throw new Error('timedPicker: #timedGrid not found');

  for (const card of cards) {
    const best = loadBest(card.bestKey + '_timed');
    const btn = document.createElement('button');
    btn.className = 'shape-card';
    btn.innerHTML = `
      <span class="glyph">${card.glyph}</span>
      <span class="info">
        <span class="name">${card.name}</span>
        <span class="desc">${card.desc}</span>
      </span>
      <span class="best">
        <span class="k">计时最佳</span>
        <span class="v">${best}</span>
      </span>
    `;
    btn.addEventListener('click', () => onSelect(card.id));
    grid.appendChild(btn);
  }

  container.querySelector<HTMLButtonElement>('#backBtn')?.addEventListener('click', onBack);
}

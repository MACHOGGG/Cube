import type { ShapeCardMeta } from '../shapes/types';
import { loadBest } from '../engine/persistence';

export function renderMenu(container: HTMLElement, cards: ShapeCardMeta[], onSelect: (id: ShapeCardMeta['id']) => void, onMore: () => void) {
  container.innerHTML = `
    <div class="app">
      <h1>Slides</h1>
      <p class="tag-line">选择一种棋盘形状开始挑战</p>
      <div class="menu-grid" id="menuGrid"></div>
      <div class="menu-section-label">更多玩法</div>
      <div class="menu-grid" id="moreGrid"></div>
      <p class="assumptions">拖动整行/整列或整条斜线，拼出同色图案得分；得分方块会翻成点状的另一面，继续参与后续联通。三种棋盘形状规则相通，几何结构不同。</p>
    </div>
  `;

  const grid = container.querySelector<HTMLElement>('#menuGrid');
  if (!grid) throw new Error('menu: #menuGrid not found');

  for (const card of cards) {
    const best = loadBest(card.bestKey);
    const btn = document.createElement('button');
    btn.className = 'shape-card';
    btn.innerHTML = `
      <span class="glyph">${card.glyph}</span>
      <span class="info">
        <span class="name">${card.name}</span>
        <span class="desc">${card.desc}</span>
      </span>
      <span class="best">
        <span class="k">本机最佳</span>
        <span class="v">${best}</span>
      </span>
    `;
    btn.addEventListener('click', () => onSelect(card.id));
    grid.appendChild(btn);
  }

  const moreGrid = container.querySelector<HTMLElement>('#moreGrid');
  if (!moreGrid) throw new Error('menu: #moreGrid not found');
  const moreBtn = document.createElement('button');
  moreBtn.className = 'shape-card more-card';
  moreBtn.innerHTML = `
    <span class="glyph">
      <svg viewBox="0 0 32 32"><circle cx="8" cy="16" r="3" fill="currentColor"/><circle cx="16" cy="16" r="3" fill="currentColor"/><circle cx="24" cy="16" r="3" fill="currentColor"/></svg>
    </span>
    <span class="info">
      <span class="name">挑战更多</span>
      <span class="desc">计时挑战、随机得分目标、更多布局</span>
    </span>
  `;
  moreBtn.addEventListener('click', onMore);
  moreGrid.appendChild(moreBtn);
}

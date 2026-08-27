import type { ShapeCardMeta } from '../shapes/types';
import { loadBest } from '../engine/persistence';

export type MoreOptionId = 'timed' | 'randomTarget' | 'layouts';

interface MoreOption {
  id: MoreOptionId;
  name: string;
  desc: string;
  glyph: string;
}

const OPTIONS: MoreOption[] = [
  {
    id: 'timed',
    name: '计时挑战',
    desc: '任选一种棋盘形状，1 分钟内尽可能得分',
    glyph: '<svg viewBox="0 0 32 32"><circle cx="16" cy="17" r="12" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M16 9 V17 L22 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 3 H20" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  },
  {
    id: 'randomTarget',
    name: '随机得分目标',
    desc: '敬请期待',
    glyph: '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="16" cy="16" r="6.5" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="16" cy="16" r="1.6" fill="currentColor"/></svg>',
  },
  {
    id: 'layouts',
    name: '更多布局',
    desc: '同样的规则，不同的图案与棋盘',
    glyph: '<svg viewBox="0 0 32 32"><rect x="3" y="3" width="11" height="11" rx="2.5" fill="currentColor" opacity="0.9"/><rect x="18" y="3" width="11" height="11" rx="2.5" fill="currentColor" opacity="0.6"/><rect x="3" y="18" width="11" height="11" rx="2.5" fill="currentColor" opacity="0.6"/><rect x="18" y="18" width="11" height="11" rx="2.5" fill="currentColor" opacity="0.35"/></svg>',
  },
];

export function renderMoreMenu(container: HTMLElement, onSelect: (id: MoreOptionId) => void, onBack: () => void) {
  container.innerHTML = `
    <div class="app">
      <h1>挑战更多</h1>
      <p class="tag-line">选择一种额外玩法</p>
      <div class="menu-grid" id="moreOptionsGrid"></div>
      <div class="controls">
        <button class="icon-btn" id="backBtn">返回菜单</button>
      </div>
    </div>
  `;

  const grid = container.querySelector<HTMLElement>('#moreOptionsGrid');
  if (!grid) throw new Error('moreMenu: #moreOptionsGrid not found');

  for (const opt of OPTIONS) {
    const btn = document.createElement('button');
    btn.className = 'shape-card more-card';
    btn.innerHTML = `
      <span class="glyph">${opt.glyph}</span>
      <span class="info">
        <span class="name">${opt.name}</span>
        <span class="desc">${opt.desc}</span>
      </span>
    `;
    btn.addEventListener('click', () => onSelect(opt.id));
    grid.appendChild(btn);
  }

  container.querySelector<HTMLButtonElement>('#backBtn')?.addEventListener('click', onBack);
}

export function renderLayoutsPicker(
  container: HTMLElement,
  cards: ShapeCardMeta[],
  onSelect: (id: ShapeCardMeta['id']) => void,
  onBack: () => void,
) {
  container.innerHTML = `
    <div class="app">
      <h1>更多布局</h1>
      <p class="tag-line">同样的滑动与判分规则，不同的图案与棋盘</p>
      <div class="menu-grid" id="layoutsGrid"></div>
      <div class="controls">
        <button class="icon-btn" id="backBtn">返回</button>
      </div>
    </div>
  `;

  const grid = container.querySelector<HTMLElement>('#layoutsGrid');
  if (!grid) throw new Error('layoutsPicker: #layoutsGrid not found');

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

  container.querySelector<HTMLButtonElement>('#backBtn')?.addEventListener('click', onBack);
}

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

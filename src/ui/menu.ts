import type { ShapeCardMeta } from '../shapes/types';
import { loadBest } from '../engine/persistence';

export interface MenuHandlers {
  onSelectBase: (id: ShapeCardMeta['id']) => void;
  onSelectLayout: (id: ShapeCardMeta['id']) => void;
  onTimed: () => void;
  onRandomTarget: () => void;
  onBomb: () => void;
  onMultiplayer: () => void;
  onRankings: () => void;
  onSignIn: () => void;
  onExclusive: () => void;
  onHowToSlide: () => void;
}

const RANDOM_TARGET_GLYPH =
  '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="16" cy="16" r="6.5" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="16" cy="16" r="1.6" fill="currentColor"/></svg>';
const TIMED_GLYPH =
  '<svg viewBox="0 0 32 32"><circle cx="16" cy="17" r="12" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M16 9 V17 L22 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 3 H20" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
const BOMB_GLYPH =
  '<svg viewBox="0 0 32 32"><circle cx="15" cy="19" r="10" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M20 12 L25 7 M23 6 L27 10" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
const SIGNIN_GLYPH =
  '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 20 C4 15.6 7.6 13 12 13 C16.4 13 20 15.6 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

function compactCard(name: string, best: string | null, glyph: string, placeholder = false): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'shape-card-compact' + (placeholder ? ' placeholder' : '');
  btn.innerHTML = `
    <span class="glyph">${glyph}</span>
    <span class="name">${name}</span>
    <span class="best">${best ?? '敬请期待'}</span>
  `;
  return btn;
}

export function renderMenu(
  container: HTMLElement,
  baseCards: ShapeCardMeta[],
  layoutCards: ShapeCardMeta[],
  handlers: MenuHandlers,
) {
  container.innerHTML = `
    <div class="app">
      <h1>Slides</h1>
      <p class="tag-line">选择一种棋盘形状开始挑战</p>

      <div class="home-wide-card" id="multiplayerCard">
        <span class="wide-card-title">多人游玩</span>
        <span class="wide-card-sub">敬请期待</span>
      </div>

      <div class="menu-section-label">基础玩法</div>
      <div class="menu-grid-2col" id="baseGrid"></div>
      <button class="home-how-to" id="howToBtn">如何滑？· 重新观看新手教学</button>

      <hr class="menu-divider" />

      <div class="menu-section-label">挑战板块</div>
      <div class="menu-grid-2col" id="challengeGrid"></div>

      <hr class="menu-divider" />

      <div class="menu-section-label">更多布局</div>
      <div class="menu-grid-2col" id="layoutsGrid"></div>

      <div class="home-wide-card" id="rankingsCard">
        <span class="wide-card-title">成绩与排名</span>
        <span class="wide-card-sub">敬请期待</span>
      </div>

      <div class="home-signin-row">
        <button class="signin-circle" id="signInBtn" aria-label="Sign In">${SIGNIN_GLYPH}</button>
        <button class="exclusive-pill" id="exclusiveBtn">
          <span class="zh">天才入口</span>
          <span class="en">exclusive</span>
        </button>
      </div>
    </div>
  `;

  const req = <T extends HTMLElement>(id: string) => {
    const el = container.querySelector<T>('#' + id);
    if (!el) throw new Error(`menu: missing #${id}`);
    return el;
  };

  const baseGrid = req<HTMLElement>('baseGrid');
  for (const card of baseCards) {
    const best = loadBest(card.bestKey);
    const btn = compactCard(card.name, String(best), card.glyph);
    btn.addEventListener('click', () => handlers.onSelectBase(card.id));
    baseGrid.appendChild(btn);
  }

  const layoutsGrid = req<HTMLElement>('layoutsGrid');
  for (const card of layoutCards) {
    const best = loadBest(card.bestKey);
    const btn = compactCard(card.name, String(best), card.glyph);
    btn.addEventListener('click', () => handlers.onSelectLayout(card.id));
    layoutsGrid.appendChild(btn);
  }

  const challengeGrid = req<HTMLElement>('challengeGrid');
  const timedBtn = compactCard('计时挑战', '任选形状 · 60 秒', TIMED_GLYPH);
  timedBtn.addEventListener('click', handlers.onTimed);
  challengeGrid.appendChild(timedBtn);
  const randomBtn = compactCard('随机得分目标', null, RANDOM_TARGET_GLYPH, true);
  randomBtn.addEventListener('click', handlers.onRandomTarget);
  challengeGrid.appendChild(randomBtn);
  const bombBtn = compactCard('炸弹挑战', null, BOMB_GLYPH, true);
  bombBtn.addEventListener('click', handlers.onBomb);
  challengeGrid.appendChild(bombBtn);

  req<HTMLElement>('multiplayerCard').addEventListener('click', handlers.onMultiplayer);
  req<HTMLElement>('rankingsCard').addEventListener('click', handlers.onRankings);
  req<HTMLButtonElement>('signInBtn').addEventListener('click', handlers.onSignIn);
  req<HTMLButtonElement>('exclusiveBtn').addEventListener('click', handlers.onExclusive);
  req<HTMLButtonElement>('howToBtn').addEventListener('click', handlers.onHowToSlide);
}

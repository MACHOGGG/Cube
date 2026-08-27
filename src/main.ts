import './style.css';
import { renderMenu } from './ui/menu';
import { renderTimedPicker } from './ui/moreMenu';
import { renderLanguageSelect } from './ui/languageSelect';
import { renderTutorial } from './ui/tutorial';
import { renderCircleTutorial } from './ui/circleTutorial';
import { renderTriangleTutorial } from './ui/triangleTutorial';
import { loadLang, saveLang, hasSeenTutorial, markTutorialSeen, type Lang, type TutorialShape } from './i18n';
import { createSquareGame } from './shapes/square';
import { createTriangleGame } from './shapes/triangle';
import { createCircleGame } from './shapes/circle';
import { createCircleHexGame } from './shapes/circleHex';
import { createSquareDiamondGame } from './shapes/squareDiamond';
import { createTriangleBigGame } from './shapes/triangleBig';
import type { ShapeGame, ShapeGameOpts } from './shapes/types';

const rootEl = document.getElementById('app');
if (!rootEl) throw new Error('#app not found');
const root: HTMLElement = rootEl;

const games: ShapeGame[] = [createSquareGame(), createCircleGame(), createTriangleGame()];
const layoutGames: ShapeGame[] = [createCircleHexGame(), createSquareDiamondGame(), createTriangleBigGame()];

let activeDestroy: (() => void) | null = null;
let currentLang: Lang = 'zhHans';

function teardown() {
  if (activeDestroy) {
    activeDestroy();
    activeDestroy = null;
  }
}

function showMenu() {
  teardown();
  renderMenu(root, games.map((g) => g.card), layoutGames.map((g) => g.card), {
    onSelectBase: (id) => {
      const game = games.find((g) => g.card.id === id);
      if (game) showGame(game);
    },
    onSelectLayout: (id) => {
      const game = layoutGames.find((g) => g.card.id === id);
      if (game) showGame(game);
    },
    onTimed: showTimedPicker,
    onRandomTarget: () => showComingSoon('随机得分目标'),
    onBomb: () => showComingSoon('炸弹挑战'),
    onMultiplayer: () => showComingSoon('多人游玩'),
    onRankings: () => showComingSoon('成绩与排名'),
    onSignIn: () => showComingSoon('登录'),
    onExclusive: () => showComingSoon('天才入口'),
    onHowToSlide: showTutorialPicker,
  });
}

// Which shape a card id's tutorial covers, if any — layout games (the
// "更多布局" cards) don't get their own tutorial, since they teach nothing
// beyond what their base shape's tutorial already covers.
function shapeTutorialFor(id: string): TutorialShape | null {
  if (id === 'square') return 'square';
  if (id === 'circle') return 'circle';
  if (id === 'triangle') return 'triangle';
  return null;
}

function renderShapeTutorialByShape(shape: TutorialShape, onDone: () => void) {
  teardown();
  if (shape === 'square') renderTutorial(root, currentLang, onDone);
  else if (shape === 'circle') renderCircleTutorial(root, currentLang, onDone);
  else renderTriangleTutorial(root, currentLang, onDone);
}

function showTutorialPicker() {
  teardown();
  root.innerHTML = `
    <div class="app">
      <h1>如何滑？</h1>
      <p class="tag-line">选择一种玩法，重新观看新手教学</p>
      <div class="menu-grid" id="tutorialGrid"></div>
      <div class="controls"><button class="icon-btn" id="backBtn">返回菜单</button></div>
    </div>
  `;
  const grid = root.querySelector<HTMLElement>('#tutorialGrid')!;
  const entries: { shape: TutorialShape; name: string; desc: string }[] = [
    { shape: 'square', name: '方块', desc: '拖动整行/整列 · 基础教学' },
    { shape: 'circle', name: '圆球', desc: '三向滑动 · "22"/"121" 菱形' },
    { shape: 'triangle', name: '三角', desc: '三向滑动 · 大三角与朝向切换' },
  ];
  for (const entry of entries) {
    const btn = document.createElement('button');
    btn.className = 'shape-card';
    btn.innerHTML = `<span class="info"><span class="name">${entry.name}</span><span class="desc">${entry.desc}</span></span>`;
    btn.addEventListener('click', () => renderShapeTutorialByShape(entry.shape, showTutorialPicker));
    grid.appendChild(btn);
  }
  root.querySelector<HTMLButtonElement>('#backBtn')?.addEventListener('click', showMenu);
}

function showTimedPicker() {
  teardown();
  renderTimedPicker(
    root,
    [...games, ...layoutGames].map((g) => g.card),
    (id) => {
      const game = [...games, ...layoutGames].find((g) => g.card.id === id);
      if (game) showGame(game, { timeLimitSec: 60 });
    },
    showMenu,
  );
}

function showComingSoon(title: string) {
  teardown();
  root.innerHTML = `
    <div class="app">
      <h1>${title}</h1>
      <p class="tag-line">敬请期待</p>
      <div class="controls">
        <button class="icon-btn" id="backBtn">返回</button>
      </div>
    </div>
  `;
  root.querySelector<HTMLButtonElement>('#backBtn')?.addEventListener('click', showMenu);
}

function showGame(game: ShapeGame, opts?: ShapeGameOpts, onBack?: () => void) {
  const backFn = onBack ?? (opts?.timeLimitSec ? showTimedPicker : showMenu);
  const mountNow = () => {
    activeDestroy = game.mount(root, backFn, opts);
  };
  // A timed-challenge run or a replay from another shape's "更多布局" card
  // skips the tutorial gate — only the very first time a player opens this
  // shape's *own* base game gets the auto-popup.
  const tutorialShape = opts?.timeLimitSec ? null : shapeTutorialFor(game.card.id);
  if (tutorialShape && tutorialShape !== 'square' && !hasSeenTutorial(tutorialShape)) {
    renderShapeTutorialByShape(tutorialShape, () => {
      markTutorialSeen(tutorialShape);
      mountNow();
    });
    return;
  }
  mountNow();
}

function boot() {
  const savedLang = loadLang();
  if (!savedLang) {
    teardown();
    renderLanguageSelect(root, (lang) => {
      saveLang(lang);
      afterLangChosen(lang);
    });
    return;
  }
  afterLangChosen(savedLang);
}

function afterLangChosen(lang: Lang) {
  currentLang = lang;
  if (!hasSeenTutorial()) {
    teardown();
    renderTutorial(root, lang, () => {
      markTutorialSeen();
      showMenu();
    });
    return;
  }
  showMenu();
}

boot();

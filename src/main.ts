import './style.css';
import { renderMenu, type HomeLayout } from './ui/menu';
import { renderLanguageSelect } from './ui/languageSelect';
import { renderAccountPage, type AuthTab } from './ui/accountPage';
import { mountBottomNav } from './ui/bottomNav';
import { showLangSwitchModal } from './ui/langSwitchModal';
import { renderTutorial } from './ui/tutorial';
import { renderCircleTutorial } from './ui/circleTutorial';
import { renderTriangleTutorial } from './ui/triangleTutorial';
import { loadLang, saveLang, hasSeenTutorial, markTutorialSeen, STRINGS, type Lang, type TutorialShape } from './i18n';
import { shapeName } from './ui/shapeLabels';
import { createSquareGame } from './shapes/square';
import { createTriangleGame } from './shapes/triangle';
import { createCircleGame } from './shapes/circle';
import { createCircleHexGame } from './shapes/circleHex';
import { createSquareDiamondGame } from './shapes/squareDiamond';
import { createTriangleBigGame } from './shapes/triangleBig';
import { createCircleSevenGame } from './shapes/circleSeven';
import { createTriangleAdvancedGame } from './shapes/triangleAdvanced';
import type { ShapeGame, ShapeGameOpts } from './shapes/types';

const rootEl = document.getElementById('app');
if (!rootEl) throw new Error('#app not found');
const root: HTMLElement = rootEl;

const squareGame = createSquareGame();
const circleGame = createCircleGame();
const triangleGame = createTriangleGame();
const circleHexGame = createCircleHexGame();
const squareDiamondGame = createSquareDiamondGame();
const triangleBigGame = createTriangleBigGame();
const circleSevenGame = createCircleSevenGame();
const triangleAdvancedGame = createTriangleAdvancedGame();

const games: ShapeGame[] = [squareGame, circleGame, triangleGame];
// The 3 layouts bomb mode actually supports (进阶炸弹's own shape pool) —
// kept separate from the full "更多布局" list below since 七色圆球 doesn't
// have the red-hazard mechanic wired in.
const bombLayoutGames: ShapeGame[] = [circleHexGame, squareDiamondGame, triangleBigGame];
const layoutGames: ShapeGame[] = [...bombLayoutGames, circleSevenGame, triangleAdvancedGame];
// The home page's fixed square/circle/triangle column order — see
// HomeLayout in ui/menu.ts for why each of these needs its own explicit
// per-column arrangement rather than reusing games/layoutGames as-is.
const homeLayout: HomeLayout = {
  baseCards: [squareGame.card, circleGame.card, triangleGame.card],
  advancedBombCards: [squareDiamondGame.card, circleHexGame.card, triangleBigGame.card],
  layoutColumns: [[squareDiamondGame.card], [circleHexGame.card, circleSevenGame.card], [triangleBigGame.card, triangleAdvancedGame.card]],
};

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
  renderMenu(root, homeLayout, {
    onSelectBase: (id) => {
      const game = games.find((g) => g.card.id === id);
      if (game) showGame(game);
    },
    onSelectLayout: (id) => {
      const game = layoutGames.find((g) => g.card.id === id);
      if (game) showGame(game);
    },
    onTimedFor: (id) => {
      const game = games.find((g) => g.card.id === id);
      if (game) showGame(game, { timeLimitSec: 60 });
    },
    onBombFor: (tier, id) => {
      const pool = tier === 'advanced' ? bombLayoutGames : games;
      const game = pool.find((g) => g.card.id === id);
      if (game) showGame(game, { bomb: true, timeLimitSec: tier === 'timed' ? 90 : undefined }, showMenu);
    },
    onRandomTarget: () => showComingSoon(STRINGS[currentLang].randomTargetTitle),
    onMultiplayer: () => showComingSoon(STRINGS[currentLang].multiplayerTitle),
    onRankings: () => showComingSoon(STRINGS[currentLang].rankingsTitle),
    onSignIn: () => showAccountPage('login'),
    onExclusive: () => showAccountPage('register'),
    onHowToSlide: showTutorialPicker,
  }, currentLang);
}

function showAccountPage(tab: AuthTab) {
  teardown();
  renderAccountPage(root, tab, showMenu, currentLang);
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
  const s = STRINGS[currentLang];
  root.innerHTML = `
    <div class="app">
      <h1>${s.tutorialPickerTitle}</h1>
      <p class="tag-line">${s.tutorialPickerTagline}</p>
      <div class="menu-grid" id="tutorialGrid"></div>
      <div class="controls"><button class="icon-btn" id="backBtn">${s.backToMenu}</button></div>
    </div>
  `;
  const grid = root.querySelector<HTMLElement>('#tutorialGrid')!;
  const entries: { shape: TutorialShape; desc: string }[] = [
    { shape: 'square', desc: s.squareTutorialDesc },
    { shape: 'circle', desc: s.circleTutorialDesc },
    { shape: 'triangle', desc: s.triangleTutorialDesc },
  ];
  for (const entry of entries) {
    const btn = document.createElement('button');
    btn.className = 'shape-card';
    const name = shapeName(currentLang, entry.shape, entry.shape);
    btn.innerHTML = `<span class="info"><span class="name">${name}</span><span class="desc">${entry.desc}</span></span>`;
    btn.addEventListener('click', () => renderShapeTutorialByShape(entry.shape, showTutorialPicker));
    grid.appendChild(btn);
  }
  root.querySelector<HTMLButtonElement>('#backBtn')?.addEventListener('click', showMenu);
}

function showComingSoon(title: string) {
  teardown();
  const s = STRINGS[currentLang];
  root.innerHTML = `
    <div class="app">
      <h1>${title}</h1>
      <p class="tag-line">${s.comingSoon}</p>
      <div class="controls">
        <button class="icon-btn" id="backBtn">${s.back}</button>
      </div>
    </div>
  `;
  root.querySelector<HTMLButtonElement>('#backBtn')?.addEventListener('click', showMenu);
}

function showGame(game: ShapeGame, opts?: ShapeGameOpts, onBack?: () => void) {
  const fullOpts: ShapeGameOpts = { ...opts, lang: currentLang };
  const backFn = onBack ?? showMenu;
  const mountNow = () => {
    activeDestroy = game.mount(root, backFn, fullOpts);
  };
  // A timed-challenge run or a replay from another shape's "更多布局" card
  // skips the tutorial gate — only the very first time a player opens this
  // shape's *own* base game gets the auto-popup.
  const tutorialShape = opts?.timeLimitSec || opts?.bomb ? null : shapeTutorialFor(game.card.id);
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
  mountBottomNav(
    {
      onHome: showMenu,
      onLanguage: () => showLangSwitchModal(currentLang, onLanguageSwitched),
      onAccount: () => showAccountPage('login'),
    },
    lang,
  );
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

// Switching language always lands back on the (now newly localized) home
// page rather than trying to re-render whatever screen was showing — every
// screen builder in this file takes currentLang implicitly at render time,
// so there's no single "redraw the current screen" hook to call generically.
function onLanguageSwitched(lang: Lang) {
  saveLang(lang);
  afterLangChosen(lang);
}

boot();

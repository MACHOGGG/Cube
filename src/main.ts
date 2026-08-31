import { injectStyles } from './injectStyles';
import { unlockAudio, wireClickCues } from './engine/juice';
import { applyAppIcon } from './ui/appIcons';
import { showLoadingScreen } from './ui/loadingScreen';
import { initAnalytics, trackScreen, trackLanguage } from './engine/analytics';
import { renderMenu, type HomeLayout } from './ui/menu';
import { renderAccountPage, type AuthTab } from './ui/accountPage';
import { renderRecordsPage, type RecordSource } from './ui/recordsPage';
import { mountBottomNav, setActiveNavTab, type NavTab } from './ui/bottomNav';
import { showLangSwitchModal } from './ui/langSwitchModal';
import { renderTutorial } from './ui/tutorial';
import { renderCircleTutorial } from './ui/circleTutorial';
import { renderTriangleTutorial } from './ui/triangleTutorial';
import { loadLang, saveLang, detectLang, hasSeenTutorial, markTutorialSeen, STRINGS, type Lang, type TutorialShape } from './i18n';
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

injectStyles();

// The tab icon the player last chose, back on the tab before anything else
// draws. Falls back to the default when nothing is stored.
applyAppIcon();

// Every click in the app gets its own cue (see wireClickCues), and the very
// first gesture also opens the audio context — cuelume builds it lazily on
// first play, which otherwise happens inside a timer, too late for Safari.
wireClickCues();
function warmAudio() {
  unlockAudio();
  window.removeEventListener('pointerdown', warmAudio);
  window.removeEventListener('keydown', warmAudio);
}
window.addEventListener('pointerdown', warmAudio);
window.addEventListener('keydown', warmAudio);

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
// Everything on the home page, bucketed by the three base shapes the design
// is organised around — see HomeLayout in ui/menu.ts.
const homeLayout: HomeLayout = {
  base: { square: squareGame.card, circle: circleGame.card, triangle: triangleGame.card },
  advancedBomb: { square: squareDiamondGame.card, circle: circleHexGame.card, triangle: triangleBigGame.card },
  moreLayouts: {
    square: [squareDiamondGame.card],
    circle: [circleHexGame.card, circleSevenGame.card],
    triangle: [triangleBigGame.card, triangleAdvancedGame.card],
  },
};

// Every game/mode pairing the records page can show a stored best score for,
// keyed the same way each shape's own mount() saves it.
const recordSources: RecordSource[] = [
  ...games.map((g) => ({ card: g.card, suffix: '', mode: '' })),
  ...games.map((g) => ({ card: g.card, suffix: '_timed', mode: ' · 60s' })),
  ...games.map((g) => ({ card: g.card, suffix: '_bomb', mode: ' · 💥' })),
  ...layoutGames.map((g) => ({ card: g.card, suffix: '', mode: ' · +' })),
  ...bombLayoutGames.map((g) => ({ card: g.card, suffix: '_bomb', mode: ' · + 💥' })),
];

let activeDestroy: (() => void) | null = null;
let currentLang: Lang = 'zhHans';
// Which bottom-nav destination is on screen, so its icon can stay lifted and
// so tapping the same icon again closes it back to the home page instead of
// re-opening what the player is already looking at.
let navTab: NavTab = null;
// Set whenever a game is started from one of the home page's pop-up pickers:
// the key of the card that opened it, so "back" from that game can land on
// the home page and re-open the same picker rather than just dumping the
// player on the grid.
let reopenPickerKey: string | null = null;

function setNavTab(tab: NavTab) {
  navTab = tab;
  setActiveNavTab(tab);
}

/** True while a run is on the board — a browser reload is the one way out
 *  of a game we can still warn about, so the beforeunload prompt below is
 *  registered only for as long as this is set. */
let gameInProgress = false;

/** Wires the header's title on whichever screen was just rendered: it goes
 *  back to the top of the home page. */
function wireHomeTitle() {
  const title = root.querySelector<HTMLElement>('.home-title');
  if (!title) return;
  title.tabIndex = 0;
  title.setAttribute('role', 'button');
  const go = () => leaveGame(() => { showMenu(); toTop(); });
  title.addEventListener('click', go);
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
  });
}

const toTop = () => window.scrollTo(0, 0);

// A reload cannot be intercepted with our own dialog — browsers deliberately
// allow only their own, with wording we don't get to choose — so all a page
// can do is ask for it. Registering the handler only while a run is open
// keeps the prompt off every other screen.
addEventListener('beforeunload', (e) => {
  if (!gameInProgress) return;
  e.preventDefault();
  // Some engines still read the legacy return value; the text is ignored.
  e.returnValue = '';
});

/** Leaves whatever screen is up. While a run is open the bottom dock is
 *  hidden and the game page carries no home title, so in practice this is
 *  only ever reached from a non-game screen — it still closes out the run
 *  rather than leaving it half-alive if some future entry point does. */
function leaveGame(go: () => void) {
  gameInProgress = false;
  go();
}

function teardown() {
  if (activeDestroy) {
    activeDestroy();
    activeDestroy = null;
  }
  gameInProgress = false;
}

function showMenu() {
  teardown();
  trackScreen('menu');
  renderMenu(root, homeLayout, {
    onSelectBase: (id) => {
      const game = games.find((g) => g.card.id === id);
      if (game) showGame(game);
    },
    onSelectLayout: (id, reopenKey) => {
      const game = layoutGames.find((g) => g.card.id === id);
      if (game) showGame(game, undefined, undefined, reopenKey);
    },
    onTimedFor: (id, reopenKey) => {
      const game = games.find((g) => g.card.id === id);
      if (game) showGame(game, { timeLimitSec: 60 }, undefined, reopenKey);
    },
    onBombFor: (tier, id, reopenKey) => {
      const pool = tier === 'advanced' ? bombLayoutGames : games;
      const game = pool.find((g) => g.card.id === id);
      if (game) showGame(game, { bomb: true, timeLimitSec: tier === 'timed' ? 90 : undefined }, undefined, reopenKey);
    },
  }, currentLang);
  setNavTab(null);
  wireHomeTitle();
  // Re-opening a picker works by replaying the tap on the card that owns it:
  // the freshly rendered card is a real, correctly positioned element, so the
  // fly-to-centre animation has a valid origin to start from.
  if (reopenPickerKey) {
    const key = reopenPickerKey;
    reopenPickerKey = null;
    root.querySelector<HTMLElement>(`[data-reopen="${key}"]`)?.click();
  }
}

function showAccountPage(tab: AuthTab) {
  teardown();
  trackScreen('profile');
  renderAccountPage(
    root,
    tab,
    {
      onBack: showMenu,
      onSwitchLanguage: () => showLangSwitchModal(currentLang, onLanguageSwitched),
      onHowToSlide: showTutorialPicker,
      onRandomTarget: () => showComingSoon(STRINGS[currentLang].randomTargetTitle),
      onMultiplayer: () => showComingSoon(STRINGS[currentLang].multiplayerTitle),
    },
    currentLang,
  );
  setNavTab('profile');
  wireHomeTitle();
  toTop();
}

function showRecordsPage() {
  teardown();
  trackScreen('records');
  renderRecordsPage(root, recordSources, showMenu, currentLang);
  setNavTab('records');
  wireHomeTitle();
  toTop();
}

// Which shape's tutorial a card belongs to. A layout variant has no lesson
// of its own — it teaches nothing beyond its family's — but it still counts
// as that family: a newcomer who opens 七色圆球 first should meet the ball
// tutorial there, not only if they happen to start from the base game.
function shapeTutorialFor(id: string): TutorialShape | null {
  if (id.startsWith('square')) return 'square';
  if (id.startsWith('circle')) return 'circle';
  if (id.startsWith('triangle')) return 'triangle';
  return null;
}

function renderShapeTutorialByShape(shape: TutorialShape, onDone: () => void) {
  teardown();
  trackScreen('tutorial');
  if (shape === 'square') renderTutorial(root, currentLang, onDone);
  else if (shape === 'circle') renderCircleTutorial(root, currentLang, onDone);
  else renderTriangleTutorial(root, currentLang, onDone);
}

function showTutorialPicker() {
  teardown();
  trackScreen('tutorial_picker');
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

function showGame(game: ShapeGame, opts?: ShapeGameOpts, onBack?: () => void, reopenKey?: string) {
  const fullOpts: ShapeGameOpts = { ...opts, lang: currentLang };
  // Going back lands on the home page and, when this game was chosen from one
  // of its pop-up pickers, re-opens that picker — so "back" always means the
  // screen the player actually came from.
  const backFn =
    onBack ??
    (() => {
      reopenPickerKey = reopenKey ?? null;
      showMenu();
    });
  const mountNow = () => {
    activeDestroy = game.mount(root, backFn, fullOpts);
    gameInProgress = true;
  };
  // A timed-challenge run or a replay from another shape's "更多布局" card
  // skips the tutorial gate — only the very first time a player opens this
  // shape's *own* base game gets the auto-popup.
  const tutorialShape = opts?.timeLimitSec || opts?.bomb ? null : shapeTutorialFor(game.card.id);
  if (tutorialShape && tutorialShape !== 'square' && !hasSeenTutorial(tutorialShape)) {
    // Marked the moment it is shown, not when it finishes: it is offered
    // exactly once per family, and a player who skips out of it has still
    // been offered it.
    markTutorialSeen(tutorialShape);
    renderShapeTutorialByShape(tutorialShape, mountNow);
    return;
  }
  mountNow();
}

function boot() {
  const savedLang = loadLang();
  // Analytics starts before the first screen so the visit is counted even if
  // the player closes the tab on the language page. It is given the saved
  // language, or 'none' when this is a first run and nothing is chosen yet.
  initAnalytics(savedLang || 'none');
  if (!savedLang) {
    // No opening language picker any more: read the browser's own preference
    // and get straight into the game. It is only a default — 个人主页 has the
    // switcher, and the moment the player uses it that choice is what sticks.
    const guess = detectLang();
    saveLang(guess);
    trackLanguage(guess, 'auto');
    afterLangChosen(guess);
    return;
  }
  afterLangChosen(savedLang);
}

function afterLangChosen(lang: Lang) {
  currentLang = lang;
  mountBottomNav(
    {
      // Tapping the icon of the page you are already on closes it.
      onProfile: () => leaveGame(() => (navTab === 'profile' ? showMenu() : showAccountPage('login'))),
      onRecords: () => leaveGame(() => (navTab === 'records' ? showMenu() : showRecordsPage())),
    },
    lang,
  );
  if (!hasSeenTutorial()) {
    // Only ever on a first visit, and marked as soon as it appears — leaving
    // it half-watched still counts, so it never greets a returning player
    // again on the way to the menu.
    markTutorialSeen();
    teardown();
    renderTutorial(root, lang, showMenu);
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
  trackLanguage(lang, 'switch');
  afterLangChosen(lang);
}

// The splash owns the first 3.5 seconds, and hands over only once the web
// fonts have landed too — so the screen behind it never reflows on arrival.
showLoadingScreen().then(boot);

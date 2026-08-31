import { injectStyles } from './injectStyles';
import { unlockAudio, wireClickCues } from './engine/juice';
import { applyAppIcon } from './ui/appIcons';
import { showLoadingScreen } from './ui/loadingScreen';
import { initAnalytics, trackScreen, trackLanguage } from './engine/analytics';
import { renderMenu, WIDE_QUERY, type HomeLayout } from './ui/menu';
import { renderAccountPage, type AuthTab } from './ui/accountPage';
import { renderRecordsPage, type RecordSource } from './ui/recordsPage';
import { mountBottomNav, setActiveNavTab, type NavTab } from './ui/bottomNav';
import { applyPaletteToTree, onColorblindChange } from './engine/palettePref';
import { showLangSwitchModal } from './ui/langSwitchModal';
import { renderTutorial } from './ui/tutorial';
import { renderCircleTutorial } from './ui/circleTutorial';
import { renderTriangleTutorial } from './ui/triangleTutorial';
import { loadLang, saveLang, detectLang, hasSeenTutorial, markTutorialSeen, STRINGS, type Lang, type TutorialShape } from './i18n';
import { onGeniusChange, refreshEntitlement } from './engine/subscription';
import { openGeniusWindow, promptPasswordIfJustPaid } from './ui/subscribe';
import { renderMultiplayerPage, type MatchStart } from './ui/multiplayer';
import { mountScoreboard } from './ui/scoreboard';
import { forgetRoom } from './engine/room';
import { clearSeed, seedRandom } from './engine/rng';
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
// Every board a multiplayer host can put in front of the room — the same
// eight ids api/room.js will accept.
const everyGame: ShapeGame[] = [...games, ...layoutGames];
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

/** Re-paints the inline SVG glyphs of whatever was just rendered for the
 *  colourblind setting. The stylesheet covers everything drawn from a custom
 *  property; the page's own icons are literal SVG and need this. */
const repaintIcons = () => applyPaletteToTree(document);
// Flipping the setting re-paints what is already on screen — each glyph
// remembers the colour it was drawn with, so this works in both directions
// and no screen has to be rebuilt.
onColorblindChange(repaintIcons);

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
    onLockedLayout: () => openGeniusWindow(currentLang, showMenu),
    onBombFor: (tier, id, reopenKey) => {
      const pool = tier === 'advanced' ? bombLayoutGames : games;
      const game = pool.find((g) => g.card.id === id);
      if (game) showGame(game, { bomb: true, timeLimitSec: tier === 'timed' ? 90 : undefined }, undefined, reopenKey);
    },
  }, currentLang);
  setNavTab(null);
  wireHomeTitle();
  repaintIcons();
  // Re-opening a picker works by replaying the tap on the card that owns it:
  // the freshly rendered card is a real, correctly positioned element, so the
  // fly-to-centre animation has a valid origin to start from.
  if (reopenPickerKey) {
    const key = reopenPickerKey;
    reopenPickerKey = null;
    root.querySelector<HTMLElement>(`[data-reopen="${key}"]`)?.click();
  }
}

// The home page is built in one of two shapes — two columns on a phone,
// three centred rows on a wide screen — and which one is decided once, when
// it renders. Turning a phone sideways and back crosses that line without
// re-rendering, so a page built in landscape (four cards across one row)
// stayed that way upright, with its right-hand icons off the edge of the
// screen. Rebuild it whenever the breakpoint actually flips, and only while
// the home page is the thing on screen.
window.matchMedia(WIDE_QUERY).addEventListener('change', () => {
  if (root.querySelector('.home-page')) showMenu();
});

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
      onMultiplayer: showMultiplayer,
    },
    currentLang,
  );
  setNavTab('profile');
  wireHomeTitle();
  repaintIcons();
  toTop();
}

/**
 * 多人游玩. The page owns its own polling, so what it hands back is the
 * teardown, and that becomes this screen's destroy like any game's.
 */
function showMultiplayer() {
  teardown();
  trackScreen('multiplayer');
  activeDestroy = renderMultiplayerPage(
    root,
    {
      onBack: showMenu,
      onMatchStart: startMultiplayerRun,
      // Opening a room is the subscriber's; buying it lands back here.
      onNeedGenius: () => openGeniusWindow(currentLang, showMultiplayer),
    },
    currentLang,
  );
  setNavTab(null);
  wireHomeTitle();
  repaintIcons();
  toTop();
}

/**
 * The countdown has run out. Seeding the shared generator *before* the board
 * is built is the whole trick: the shape deals itself exactly the same cards
 * as everyone else's copy, with no board sent and nothing to keep in sync.
 *
 * The tutorial gate is deliberately skipped. Three other people are counting
 * down to this instant, and a lesson popping up in front of one of them
 * would leave that player behind for a race they have already started.
 */
function startMultiplayerRun(match: MatchStart) {
  const game = everyGame.find((g) => g.card.id === match.mode);
  if (!game) return showMenu();
  teardown();
  trackScreen('multiplayer_run');
  seedRandom(match.seed);
  const back = () => {
    forgetRoom();
    showMenu();
  };
  const destroyGame = game.mount(root, back, { lang: currentLang });
  // The countdown was the "get ready", and it ended for everyone at the same
  // instant. Leaving the start card up would undo exactly that: four players
  // would each press it a moment apart and the race would begin four times.
  requestAnimationFrame(() => root.querySelector<HTMLButtonElement>('#startBtn')?.click());
  const stopBoard = mountScoreboard(currentLang);
  activeDestroy = () => {
    stopBoard();
    // Back to a different board every time, for whatever is played next.
    clearSeed();
    destroyGame();
  };
  gameInProgress = true;
  repaintIcons();
}

function showRecordsPage() {
  teardown();
  trackScreen('records');
  renderRecordsPage(root, recordSources, showMenu, currentLang);
  setNavTab('records');
  wireHomeTitle();
  repaintIcons();
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
  repaintIcons();
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

// 个人主页 is written from the subscription as it stood when it rendered, so
// an answer that arrives later — a checkout just returned from, or a store
// receipt read at launch — has to redraw it. Nothing else on screen depends
// on it, which is why only this one page listens.
onGeniusChange(() => {
  // Both pages say something different once the subscription is live: 个人
  // 主页 changes what its pill and 天才 button offer, and the home page drops
  // the padlocks from the two 「+」 boards that just became playable.
  if (navTab === 'profile') showAccountPage('login');
  else if (root.querySelector('.home-page')) showMenu();
});

// The splash owns the first 3.5 seconds, and hands over only once the web
// fonts have landed too — so the screen behind it never reflows on arrival.
showLoadingScreen().then(boot);

// Asked during the splash, so the network round trip is spent on time nobody
// is waiting through. It settles a checkout the player has just come back
// from, re-reads the store receipt, and otherwise leaves the cached answer
// exactly as it was — offline, this does nothing at all.
//
// If this launch *was* a return from paying, choosing a password is the first
// thing that happens after the splash: the boards are already unlocked behind
// the window, and this is the step that makes the subscription belong to the
// player rather than to this one browser.
void refreshEntitlement().then(() => promptPasswordIfJustPaid(currentLang, showMenu));

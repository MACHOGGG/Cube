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
import { showRoomCard } from './ui/roomCard';
import { confirmLeaveRoom } from './ui/confirmLeaveRoom';
import {
  currentRoom,
  endRoom,
  forgetRoom,
  iAmHost,
  latestRoomState,
  leaveRoom,
  setLearning,
  startMatch,
  type RoomState,
} from './engine/room';
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
// 变量按「身份」命名，不按文件命名——这两行是有意交叉的。
// 2026-09 把两个三角的棋盘对调了：主菜单上的《三角》后面装整块大三角
// （triangleBig.ts 画的那块，上手容易得多），《更多布局》里的《大三角》
// 后面装六边蜂窝（triangle.ts 画的那块）。身份本身在各自文件里已经换过，
// 所以这里只要按新身份接上，main.ts 底下所有排布、记录、多人白名单都不
// 用动，图标也照旧（图标是按 id 查的）。
const triangleGame = createTriangleBigGame();
const circleHexGame = createCircleHexGame();
const squareDiamondGame = createSquareDiamondGame();
const triangleBigGame = createTriangleGame();
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

/**
 * 主菜单滚到哪儿了。
 *
 * 换页是把 #app 的内容整个换掉，那一瞬间文档变矮，浏览器就把滚动位置压回 0
 * ——不是谁调用了「回到顶部」，是页面自己塌了。结果是从游戏里退出来，永远
 * 落在最上面，刚刚翻到下面看的那几个玩法又得再翻一次。所以离开时记住位置，
 * 画完再放回去。
 */
let menuScrollY = 0;
const onMenuPage = () => !!root.querySelector('.home-page');
window.addEventListener(
  'scroll',
  () => {
    if (onMenuPage()) menuScrollY = window.scrollY;
  },
  { passive: true },
);
/** 放回刚才那个位置。同步做一次，是因为紧接着可能要重开某个弹窗，而那个飞入
 *  动画要量卡片此刻在屏幕上的真实位置；下一帧再放一次，挡住字体或图片加载
 *  完之后高度变化把它又冲掉。 */
function restoreMenuScroll() {
  if (!menuScrollY) return;
  window.scrollTo(0, menuScrollY);
  requestAnimationFrame(() => {
    if (onMenuPage()) window.scrollTo(0, menuScrollY);
  });
}

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

/**
 * The room the host is choosing a board for, or null.
 *
 * While this is set the home page is not the player's own: every board on it
 * puts four people on the same countdown. That is a big enough difference to
 * be worth saying twice — the banner across the top says it in words, and
 * the pink frame around the whole screen says it out of the corner of an eye
 * for the taps that happen faster than reading.
 */
let pickingForRoom: string | null = null;

function setPickingForRoom(code: string | null) {
  pickingForRoom = code;
  document.body.classList.toggle('is-room-host', Boolean(code));
}

/**
 * The host taps a board on the home page. Instead of opening it for them, it
 * goes to the room, and this device joins the countdown with everyone else.
 */
async function startRoundFor(mode: string) {
  const code = pickingForRoom;
  if (!code) return false;
  const banner = document.getElementById('roomPickMsg');
  if (banner) banner.textContent = STRINGS[currentLang].workingLabel;
  const begun = await startMatch(mode);
  if (begun.ok) {
    setPickingForRoom(null);
    showMultiplayer();
    return true;
  }
  // Still the host's page, still their room: say what went wrong and leave
  // them where they are to try another board (or wait for a fourth friend).
  if (banner) {
    banner.textContent =
      begun.reason === 'tooFew'
        ? STRINGS[currentLang].mpErrTooFew
        : STRINGS[currentLang].mpErrNotOpen;
  }
  return true;
}

function notAMultiplayerBoard() {
  const banner = document.getElementById('roomPickMsg');
  if (banner) banner.textContent = STRINGS[currentLang].mpNotAMode;
}

/**
 * The strip across the top of the home page while the host is choosing.
 *
 * It is drawn into the page rather than fixed over it so that it scrolls
 * away with the boards it is talking about; the frame is what stays.
 */
function paintRoomHostBanner() {
  document.getElementById('roomPickBar')?.remove();
  if (!pickingForRoom) return;
  const s = STRINGS[currentLang];
  const bar = document.createElement('div');
  bar.id = 'roomPickBar';
  bar.className = 'room-pick-bar';
  bar.innerHTML = `
    <div class="room-pick-title">${s.mpPickingTitle.replace('{code}', pickingForRoom)}</div>
    <div class="room-pick-msg" id="roomPickMsg" role="status"></div>
    <div class="room-pick-acts">
      <button class="room-pick-back" id="roomPickBack">${s.mpBackToRoom}</button>
      <!-- 一局刚打完、屋主被送回来挑下一个玩法的时候，走人的路只剩「先回房间
           页再点离开」。这颗小键把那一步省了：在这儿就能交座位。 -->
      <button class="room-pick-back room-pick-leave" id="roomPickLeave">${s.mpLeave}</button>
    </div>
  `;
  const page = root.querySelector('.home-page') ?? root.firstElementChild;
  page?.insertBefore(bar, page.firstChild);
  bar.querySelector<HTMLButtonElement>('#roomPickBack')!.addEventListener('click', () => {
    setPickingForRoom(null);
    showMultiplayer();
  });
  bar.querySelector<HTMLButtonElement>('#roomPickLeave')!.addEventListener('click', () => {
    confirmLeaveRoom(currentLang, leaveRoomWithCard);
  });
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
      if (pickingForRoom) return void startRoundFor(id);
      const game = games.find((g) => g.card.id === id);
      if (game) showGame(game);
    },
    onSelectLayout: (id, reopenKey) => {
      if (pickingForRoom) return void startRoundFor(id);
      const game = layoutGames.find((g) => g.card.id === id);
      if (game) showGame(game, undefined, undefined, reopenKey);
    },
    onTimedFor: (id, reopenKey) => {
      // Rooms deal one plain board from one seed. A clock or a bomb layer on
      // top of that is a different game and is not one of the eight the
      // server will accept, so the host is told rather than left guessing.
      if (pickingForRoom) return void notAMultiplayerBoard();
      const game = games.find((g) => g.card.id === id);
      if (game) showGame(game, { timeLimitSec: 60 }, undefined, reopenKey);
    },
    onLockedLayout: () => openGeniusWindow(currentLang, showMenu),
    // 主菜单上的多人游玩：直接进房间那一页。
    onMultiplayer: showMultiplayer,
    onBombFor: (tier, id, reopenKey) => {
      if (pickingForRoom) return void notAMultiplayerBoard();
      const pool = tier === 'advanced' ? bombLayoutGames : games;
      const game = pool.find((g) => g.card.id === id);
      if (game) showGame(game, { bomb: true, timeLimitSec: tier === 'timed' ? 90 : undefined }, undefined, reopenKey);
    },
  }, currentLang);
  setNavTab(null);
  paintRoomHostBanner();
  wireHomeTitle();
  repaintIcons();
  restoreMenuScroll();
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

/**
 * 给 :has() 备一份替身。
 *
 * 有四条样式靠 body:has(.app--game) 认出「现在正在打一局」——底下那排图标要
 * 藏起来、背景换成牌桌色、整页不许滚。:has() 是 2022 年下半年的东西
 * （Chrome 105 / Safari 15.4），和 dvh 同一辈分。旧一点的安卓浏览器不认它，
 * 整条规则连同选择器一起被丢掉：于是打着牌，底下那排「个人主页 / 记录与排名」
 * 还浮在屏幕下方，正好压住《暂停》和《完成》。
 *
 * 所以不再只靠选择器认，改由这里在 <html> 上盖一个类，样式两种写法都留着：
 * 认得 :has() 的浏览器用它，不认的用这个类，两边看到的是同一个画面。
 *
 * 只盯 root 的直接子节点（不看子树）：换页就是换掉这一层，而棋盘在拖动时每
 * 一帧都在重建 DOM——盯子树等于每帧都被叫醒一次。
 */
function syncScreenClass() {
  const cl = document.documentElement.classList;
  cl.toggle('is-playing', !!root.querySelector('.app--game'));
  cl.toggle('is-tutorial', !!root.querySelector('.story-tut'));
  // 屋里有人在看教学，其他人停在那一屏干等。这时底下那排「个人主页 / 记录与
  // 排名」没有用处——按下去就从小屋里走出来了，而人家学完这一屏随时会自己
  // 翻页。跟打一局时同样处理：藏起来。
  cl.toggle('is-waiting-learner', !!root.querySelector('.mp-learn-page'));
}
new MutationObserver(syncScreenClass).observe(root, { childList: true });
syncScreenClass();

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
  setPickingForRoom(null);
  trackScreen('multiplayer');
  activeDestroy = renderMultiplayerPage(
    root,
    {
      onBack: showMenu,
      onMatchStart: startMultiplayerRun,
      // Opening a room is the subscriber's; buying it lands back here.
      onNeedGenius: () => openGeniusWindow(currentLang, showMultiplayer),
      // Off to the home page, where all eight boards live with their icons.
      onPickMode: (code) => {
        setPickingForRoom(code);
        showMenu();
      },
      onRoomEnded: showRoomFinal,
      // 他说他不会这个玩法：放这一族的教学给他看。教学会把整页占掉（连同
      // 小屋页的轮询），所以看完之后走 showMultiplayer 那条「已经在屋里就
      // 接着往下走」的路回来——那一刻服务器已经把开赛时刻重新盖过了，
      // 于是全屋一起从 4 数起。
      onLearnTutorial: (shape) => {
        markTutorialSeen(shape);
        renderShapeTutorialByShape(shape, () => {
          void setLearning(false).then(showMultiplayer);
        });
      },
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
  // A finished round goes back to the room, not to the home page: the scores
  // are still up there and the host has another board to pick. Only a device
  // that has somehow lost its seat falls through to the home page.
  const back = () => (currentRoom() ? showMultiplayer() : showMenu());
  const destroyGame = game.mount(root, back, { lang: currentLang });
  // The countdown was the "get ready", and it ended for everyone at the same
  // instant. Leaving the start card up would undo exactly that: four players
  // would each press it a moment apart and the race would begin four times.
  requestAnimationFrame(() => root.querySelector<HTMLButtonElement>('#startBtn')?.click());
  const stopBoard = mountScoreboard(currentLang, {
    // 回房间页：比分和下一局都在那里。
    onRoom: showMultiplayer,
    // 屋主的「回主页继续玩」——回主菜单，横幅还挂着，挑的仍然是整房的下一局。
    onPickNext: () => {
      const code = currentRoom()?.code ?? null;
      teardown();
      setPickingForRoom(code);
      showMenu();
    },
    onLeave: leaveRoomWithCard,
    // 房间被取消：座位早就不存在了，没什么可结算的，也就不出卡片——按一下
    // 《ok》直接回主菜单。
    onHome: () => {
      teardown();
      setPickingForRoom(null);
      showMenu();
    },
  });
  activeDestroy = () => {
    stopBoard();
    // Back to a different board every time, for whatever is played next.
    clearSeed();
    destroyGame();
  };
  gameInProgress = true;
  repaintIcons();
}

/**
 * 离开房间：交出座位，然后把截止此刻的竞赛排名摆出来。
 *
 * 排名要在交座位之前先抓下来——leaveRoom() 会把最后一次看到的房间状态一起
 * 清掉，晚一步就什么都画不出来了。玩家自己那一行也一样：座位没了之后就认不
 * 出「我是谁」，所以 id 也先留一份。
 */
async function leaveRoomWithCard() {
  const state = latestRoomState();
  const meId = currentRoom()?.playerId;
  const host = iAmHost();
  if (host) {
    // 屋主按的是《解散小屋》，不管从哪一处按的：小屋页、局中那一排、还是他
    // 回主菜单挑玩法时顶上那条横幅。三处问的都是《解散小屋？》，做的也该是
    // 同一件事——先把屋子关掉，屋里其他人手上才会亮起「小屋散了」，正打着的
    // 人就地转成单人（见 scoreboard.ts 的 goSolo）。
    //
    // 从前这里只是自己走人：屋子还开着，剩下的人干坐在一间永远开不出下一局
    // 的屋里，等一个已经不在的人。
    await endRoom();
    // 关了就不必再发 leave——那只会在别人那张总战绩图上把屋主标成中途离席。
    forgetRoom();
  } else {
    void leaveRoom();
  }
  teardown();
  setPickingForRoom(null);
  if (!state) return showMenu();
  // 标题不另起一个：中途走的人和散场时看到的是同一间小屋的同一份战绩，
  // 一张写《小屋战绩》、另一张写《竞赛排名》，看图的人会以为是两件事。
  showRoomCard(root, state, currentLang, showMenu, { meId });
}

/**
 * 结束房间. The evening's card, and then out — the seat is given up here
 * rather than in the room page, so the card is the last thing that needed it.
 */
function showRoomFinal(state: RoomState) {
  teardown();
  setPickingForRoom(null);
  showRoomCard(root, state, currentLang, () => {
    forgetRoom();
    showMenu();
  });
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
  // 多人那一页的《开房间》上挂着锁和天才招牌，那是照 isGenius() 画的。只在
  // 它自己那一屏上重画：房间里、倒数中的时候重画等于把轮询打断一次，而那两
  // 屏上本来也没有这颗键。
  else if (root.querySelector('#mpCreate')) showMultiplayer();
});

// The splash owns the first 3.5 seconds, and hands over only once the web
// fonts have landed too — so the screen behind it never reflows on arrival.
const splash = showLoadingScreen();
void splash.then(boot);

// Asked during the splash, so the network round trip is spent on time nobody
// is waiting through. It settles a checkout the player has just come back
// from, re-reads the store receipt, and otherwise leaves the cached answer
// exactly as it was — offline, this does nothing at all.
const settled = refreshEntitlement();

// If a checkout is still waiting for a password, that window is the first
// thing the player sees — the boards are already unlocked behind it, and this
// is the step that makes the subscription theirs rather than this browser's.
//
// It waits on both promises, and the splash is the one that matters here:
// `currentLang` starts as the module's default and only becomes the player's
// own inside boot(). Opening as soon as the network answered — which is often
// well before the splash ends — asked a French player for a password in
// Chinese, at the one moment they are least inclined to forgive it.
void Promise.all([splash, settled]).then(() =>
  promptPasswordIfJustPaid(currentLang, showMenu),
);

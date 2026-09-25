import { injectStyles } from './injectStyles';
import { unlockAudio, wireClickCues } from './engine/juice';
import { applyAppIcon } from './ui/appIcons';
import { showLoadingScreen } from './ui/loadingScreen';
import { initAnalytics, trackScreen, trackLanguage } from './engine/analytics';
import { renderMenu, WIDE_QUERY, type HomeLayout } from './ui/menu';
import { renderAccountPage, type AuthTab } from './ui/accountPage';
import { renderRecordsPage, type RecordSource } from './ui/recordsPage';
import { restoreCloudRuns, type RunKeyFor } from './engine/cloudRestore';
import { BOMB_RULES_VERSION } from './engine/bomb';
import { FLIP_RULES_VERSION } from './engine/scoring';
import { mountBottomNav, setActiveNavTab, type NavTab } from './ui/bottomNav';
import { applyPaletteToTree, onColorblindChange } from './engine/palettePref';
// 只为它的副作用引进来：模块一加载就把玩家挑的那一套（米白 / 深紫）盖到
// <html> 上，并盯着权限变化（深紫是天才特供，过期要自己退回米白）。
// 个人主页那边本来也会引它，但那是换到那一页才发生的事——首页就该是对的。
import './engine/themePref';
import { showLangSwitchModal } from './ui/langSwitchModal';
import { renderTutorial } from './ui/tutorial';
import { renderCircleTutorial } from './ui/circleTutorial';
import { renderTriangleTutorial } from './ui/triangleTutorial';
import { loadLang, saveLang, detectLang, markTutorialSeen, isFirstRun, markFirstRunDone, seenTutorials, STRINGS, type Lang, type TutorialShape } from './i18n';
import { isGenius, onGeniusChange, refreshEntitlement } from './engine/subscription';
import { openAuthWindow, openGeniusWindow, promptPasswordIfJustPaid } from './ui/subscribe';
import { renderMultiplayerPage, type MatchStart } from './ui/multiplayer';
import { mountScoreboard } from './ui/scoreboard';
import { showRoomCard } from './ui/roomCard';
import { confirmLeaveRoom } from './ui/confirmLeaveRoom';
import { createNudgeSoak, type NudgeSoak } from './ui/nudgeRain';
import {
  currentRoom,
  endRoom,
  fetchState,
  forgetRoom,
  iAmHost,
  latestRoomState,
  leaveRoom,
  markRoundPlayed,
  setLearning,
  startMatch,
  type RoomState,
} from './engine/room';
import { clearSeed, random as seededRandom, seedRandom } from './engine/rng';
import { renderRandomTargetPage } from './ui/slotMachine';
import { renderSlotIntroPage } from './ui/slotIntro';
import { renderLayoutsShowcase, renderModesShowcase, renderTargetsShowcase, renderWorldRankPage } from './ui/perkPages';
import { renderTutorialPicker } from './ui/tutorialPicker';
import {
  BASIC_KEYS,
  claimFirstEndcard,
  claimFirstTotalTip,
  firstTimeIn,
  glowingBasics,
  lockedForFirstPlay,
  markOpened,
  type PlayKey,
} from './engine/firstPlay';
import { bombTip, flipTip, layoutTip, slotTip, timedTip, puzzleTip } from './ui/modeTips';
import { renderFlipModePage } from './ui/flipMode';
import { renderPuzzleModePage } from './ui/puzzleMode';
import { installBackNav, setScreenBack } from './engine/backNav';
import { drawPair, type Family, type TargetPattern } from './engine/targets';
import { createSquareGame } from './shapes/square';
import { cardOf, familyFromName, registerCards } from './shapes/registry';
import { createTriangleGame } from './shapes/triangle';
import { createCircleGame } from './shapes/circle';
import { createCircleHexGame } from './shapes/circleHex';
import { createSquareDiamondGame } from './shapes/squareDiamond';
import { createTriangleBigGame } from './shapes/triangleBig';
import { createCircleSevenGame } from './shapes/circleSeven';
import { createTriangleAdvancedGame } from './shapes/triangleAdvanced';
import type { ShapeGame, ShapeGameOpts } from './shapes/types';
import { reducedMotion } from './engine/reducedMotion';
import * as smoothScroll from './engine/smoothScroll';

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
/**
 * 把八张名片登记进 shapes/registry.ts。
 *
 * 「这一副归哪一族、按哪一套规则讲」从前是四处各猜一遍（按 id 前缀），对不认识的 id
 * 还给出三种不同的静默默认值——理由和那张对照表在 registry.ts 的文件头。现在由棋盘
 * 自己在 card 里声明，这儿只是把它们交给那张表。
 *
 * **为什么注册在这儿、不在 registry.ts 里直接 import 八个工厂**：八副棋盘每一副都
 * import gameShell，而 gameShell 要用 registry 的 cardOf——反过来 import 就成环，模块
 * 初始化的顺序会让那张表在第一次被查的时候还是空的。main.ts 是整张图的顶点，而且这
 * 八个实例本来就建在这儿，所以登记放在这一行：早于任何界面跑起来。
 */
registerCards([
  squareGame, circleGame, triangleGame, circleHexGame,
  squareDiamondGame, triangleBigGame, circleSevenGame, triangleAdvancedGame,
].map((g) => g.card));

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
  ...games.map((g) => ({ card: g.card, suffix: '_bomb3', mode: ' · 💥' })),
  ...layoutGames.map((g) => ({ card: g.card, suffix: '', mode: ' · +' })),
  ...bombLayoutGames.map((g) => ({ card: g.card, suffix: '_bomb3', mode: ' · + 💥' })),
  // 《无限反转》只有基础方块和小球有。
  // 后缀跟着规则版本走（和上面炸弹那两行写 '_bomb2' 同一个道理）：封顶之前那些局
  // 留在 '_flip' 那张榜上归档，记录页只摆现行规则这一张。
  ...[squareGame, circleGame].map((g) => ({ card: g.card, suffix: '_flip2', mode: ' · ∞' })),
  // 《真正解密 · 步步为营》三个基础玩法都有。三角这一栏用 triangleGame 变量，
  // 不按文件名推——菜单上的「三角」由 triangleBig.ts 造（见文件开头那几行）。
  ...[squareGame, circleGame, triangleGame].map((g) => ({ card: g.card, suffix: '_puzzle', mode: ' · 步' })),
];

/**
 * 一局归到哪个本地存档键下——从云上取回战绩时要按这个把每一局放回原处。
 *
 * 存的时候用的是「这副棋盘的 bestKey + 模式后缀」（见各个 shapes 文件末尾那
 * 一行），这里照同一条式子倒推回去。炸弹压过计时：定时炸弹存的也是 _bomb2。
 *
 * 炸弹还要看规则版本：2026-09 之前打的那些局（bombRules 是 undefined）是六枚
 * 炸弹的老规则，认回老的 _bomb 键——那个键《记录与排名》已经不显示了，等于原样
 * 归档。少了这一步，从云端取回来的老局会写进新键，和新规则的分混在一起比。
 */
const runKeyFor: RunKeyFor = (data) => {
  const card = recordSources.find((src) => src.card.id === data.shapeId)?.card;
  if (!card) return null;
  const mk = data.modeKey;
  // 三档：没有 bombRules 的老档是第 1 版，2 是留一枚永久炸弹那一版，3 起是现行规则。
  const bombRules = data.bombRules ?? 1;
  const bombSuffix = bombRules >= BOMB_RULES_VERSION ? '_bomb3' : bombRules >= 2 ? '_bomb2' : '_bomb';
  // 无限反转同理：连击封顶（scoring.ts 的 FLIP_STREAK_CAP）之前那些局能打出的分高
  // 一个量级，放一起比就是把老局钉死在榜首。老档没有 flipRules，是第一版。
  const flipSuffix = (data.flipRules ?? 1) >= FLIP_RULES_VERSION ? '_flip2' : '_flip';
  // 步步为营排在最前面：它和炸弹、计时不会同时出现（这一局没有钟也没有炸弹），
  // 摆在哪儿都不冲突，摆最前面是为了读起来一眼能看见「这一局另算一张榜」。
  const suffix =
    mk === 'puzzle' ? '_puzzle'
    : mk === 'flip' ? flipSuffix
    : mk === 'bomb' || mk === 'bombTimed' ? bombSuffix
    : mk === 'timed' ? '_timed'
    : '';
  return card.bestKey + suffix;
};

/** 《无限反转》一局多长：玩家定的 60 秒（原来 120 秒）。 */
const FLIP_SECONDS = 60;

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
  /**
   * 招牌那口气是**连着的**，不在换页时重来。
   *
   * 玩家 2026-09 第九轮：「我希望 slides 标题板块的呼吸感是连续的，不是在主菜
   * 单、个人主页、成绩与排名的界面切换的时候直接重置了」。三页的招牌是各自
   * 渲染出来的**新元素**，CSS 动画于是每次都从第 0 帧起步——他看到的就是「刚
   * 呼到一半，换个页，又从头吸起」。
   *
   * 补一个负的 animation-delay，等于把这口气拨到「从网页打开那一刻就一直在呼」
   * 的相位上：换几次页都接得上。时长从 computed style 上读，不在这儿再写一遍
   * 3.2s——那样改 CSS 就得记得同步改这儿。
   */
  const dur = parseFloat(getComputedStyle(title).animationDuration) || 0;
  if (dur > 0) title.style.animationDelay = `-${((performance.now() / 1000) % dur).toFixed(3)}s`;
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
/**
 * 个人主页滚到哪儿了——和主菜单同一个道理。
 *
 * 天才特供那几行点进去的页（多人游玩、老虎机模式、更多得分目标、更多布局、
 * 世界排名）按《退出》回来的时候，落回刚才看的那个位置，不是页面顶上、更不
 * 是主菜单（玩家的原话：「退回个人主页前面浏览的位置而不是主菜单」）。
 */
let profileScrollY = 0;
const onProfilePage = () => !!root.querySelector('.profile-page');
/**
 * 正在把位置放回去的那一小段时间里，不记新位置。
 *
 * 这是那个「有时候回来落在顶上、有时候好好的」的根子：画完菜单到真正滚回
 * 去，中间隔着一两帧；那几帧里文档还没长到原来那么高，浏览器会发一个
 * `scrollY = 0` 的滚动事件，而这时候 `.home-page` 已经在 DOM 里了——监听器
 * 就把这个 0 当成「玩家滚到了最上面」记下来，紧接着的还原自然还原到 0。
 *
 * 字体和图标晚一点解码完（真机上很常见），文档长高得更晚，这一下就更容易
 * 赶上，所以它时灵时不灵。
 */
let restoringScroll = 0;
window.addEventListener(
  'scroll',
  () => {
    if (restoringScroll > Date.now()) return;
    if (onMenuPage()) menuScrollY = window.scrollY;
    else if (onProfilePage()) profileScrollY = window.scrollY;
  },
  { passive: true },
);

/**
 * 把位置放回去，并且追着放——一次不够。
 *
 * 文档是慢慢长高的：先是骨架，然后字体落位、图标解码，高度一路往上走。在它
 * 还矮的时候 scrollTo 会被浏览器夹到「当前能滚到的最远处」，也就是没滚到
 * 位。所以每一帧再试一次，直到真的到了那个数，或者半秒过去（半秒还长不完
 * 的页面，再等下去玩家已经自己动手了）。
 */
function keepScrollAt(target: number, stillThere: () => boolean) {
  if (!target) return;
  const until = Date.now() + 500;
  restoringScroll = until;
  // 玩家在这半秒里自己动手了，就立刻松手——追着放本来是为了对付慢一拍的
  // 排版，不是为了跟玩家的手指抢。
  let handsOff = false;
  const letGo = () => {
    handsOff = true;
    restoringScroll = 0;
  };
  const watch = ['touchstart', 'wheel', 'keydown'] as const;
  watch.forEach((k) => window.addEventListener(k, letGo, { passive: true, once: true }));
  const stop = () => watch.forEach((k) => window.removeEventListener(k, letGo));
  const put = () => {
    if (handsOff) return stop();
    if (!stillThere()) return stop();
    if (Math.abs(window.scrollY - target) > 1) window.scrollTo(0, target);
    if (Date.now() < until) requestAnimationFrame(put);
    else {
      restoringScroll = 0;
      stop();
    }
  };
  put();
}

function restoreProfileScroll() {
  keepScrollAt(profileScrollY, onProfilePage);
}
/** 从个人主页点进去的那些页，按《退出》回来走的这条。 */
const backToProfile = () => showAccountPage('login', true);
/** 屋主在主菜单上替整屋挑玩法时，返回键等于横幅上那颗《回小屋》。 */
const backToRoomFromPick = () => {
  setPickingForRoom(null);
  showMultiplayer();
};
/**
 * 多人游玩和老虎机模式各有两个入口——主菜单上的那张卡，和个人主页里的那一
 * 行——《退出》要回到进来的那一边。记的是最近一次从哪儿进来的：一局打完回到
 * 多人页、从挑图形那屏退回来，都还算这一趟。
 */
let mpOrigin: 'menu' | 'profile' = 'menu';
let slotOrigin: 'menu' | 'intro' = 'menu';
/** 放回刚才那个位置。第一下是同步的，因为紧接着可能要重开某个弹窗，而那个
 *  飞入动画要量卡片此刻在屏幕上的真实位置；之后半秒里每帧再放一次，挡住字
 *  体和图标加载完之后高度变化把它冲掉（见 keepScrollAt）。 */
function restoreMenuScroll() {
  keepScrollAt(menuScrollY, onMenuPage);
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
  if (code) startPickWatch();
  else stopPickWatch();
}

/**
 * 屋主去主菜单替大家挑玩法的那几分钟，小屋那边还得听得见他。
 *
 * 小屋页自己一秒一轮地问服务器，而这一轮询正是「我还在」的凭据（api/room.js
 * 的 state 顺手写 lastSeen）。屋主一离开小屋页，那条轮询就停了，于是三十秒
 * 后屋里所有人看到《屋主等一下就来》，九十秒后是《屋主离家出走了，小屋暂时
 * 解散》——而他其实就在主菜单上，正低头挑玩法。玩家截到的就是这一屏。
 *
 * 顺带解决第二件事：催他的球。那套动画本来只挂在小屋页上，屋主不在那一页，
 * 催多少下都一个不掉，等他回小屋才一次性砸下来。现在这几分钟里的每一下都落
 * 在主菜单这块招牌里——他这会儿正看着它。
 *
 * 四秒一次：AWAY_MS 是三十秒，四秒一次给了七次机会，掉几次也判不出「不在」；
 * 而服务器那头 SEEN_WRITE_MS 也正好是四秒，再密也不会多写一笔。
 */
const PICK_BEAT_MS = 4000;
let pickBeat = 0;
let pickNudges: NudgeSoak | null = null;

function startPickWatch() {
  if (pickBeat) return;
  pickNudges = createNudgeSoak();
  const beat = async () => {
    if (!pickingForRoom) return;
    const st = await fetchState();
    // 这一趟答回来的时候他可能已经不在挑了（开了局、回了小屋、走了）。
    if (!pickingForRoom) return;
    if (st.ok) pickNudges?.soak(st.value);
  };
  void beat();
  pickBeat = window.setInterval(() => void beat(), PICK_BEAT_MS);
}

function stopPickWatch() {
  window.clearInterval(pickBeat);
  pickBeat = 0;
  pickNudges?.stop();
  pickNudges = null;
}

/**
 * The host taps a board on the home page. Instead of opening it for them, it
 * goes to the room, and this device joins the countdown with everyone else.
 */
/** 开局的请求正在路上：连点两张图只算第一张。 */
let startingRound = false;
async function startRoundFor(mode: string, slot?: 'same' | 'own', flip?: boolean) {
  const code = pickingForRoom;
  if (!code) return false;
  if (startingRound) return true;
  startingRound = true;
  const banner = document.getElementById('roomPickMsg');
  if (banner) banner.textContent = STRINGS[currentLang].workingLabel;
  const begun = await startMatch(mode, slot, flip);
  startingRound = false;
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
  // 催他的球掉进主菜单这块招牌里。主菜单每重画一次，画布就得重新接一块（旧
  // 的那块跟着旧的 DOM 一起没了）；「掉到哪一下了」那个书签留在 pickNudges
  // 里不动——书签跟着画布一起重置，攒下的那几十下会在下一轮一起砸下来。
  pickNudges?.attach(root.querySelector<HTMLElement>('.home-head-glass'));
}

/**
 * 换页时的那一点过渡：旧的先淡出去，新的再托上来。
 *
 * 玩家 2026-09 第七轮：「老虎机、无限反转、步步为营这几个版本，在点击主菜单
 * icon 到进入选择图形的过程做一个轻微的转化，而不是直接硬生生地切到下一个画
 * 面」。炸弹和计时本来就有（它们开的是居中挑选窗，从按到的那张卡飞到屏幕正
 * 中，见 ui/centerPicker.ts）；这三个进的是**整页**，整页是一次 DOM 替换——
 * 上一帧还是主菜单，下一帧就是另一屏，中间什么都没有。
 *
 * 为什么不是「新页淡入」就完了：旧页在那一瞬间已经没了，新页又从透明开始，
 * 中间会闪一下空白的底色——那比硬切还难看。所以分两拍：旧页先淡掉、同时不再
 * 接受点击（`pointer-events: none`，免得这 120ms 里他又按到一张已经在退场的
 * 卡），落幕之后才画新的那一屏，新页往上托一点点进来。
 *
 * 总共 120 + 200ms。再长就开始像「等它」了——站点原则第二条说的是不要出现意料
 * 之外的界面，不是要给每一次跳转配一段动画。
 *
 * reduced-motion 下直接换，一拍都不等（和轴、开局倒数同一条规矩）。
 */
const LEAVE_MS = 120;
let swapping = false;

function softSwap(render: () => void): void {
  const cur = root.firstElementChild as HTMLElement | null;
  if (!cur || reducedMotion()) return void render();
  // 上一次的过渡还没落幕就又按了一下：认后一下，但别让两拍叠在一起。
  if (swapping) return void render();
  swapping = true;
  cur.classList.add('app--leave');
  window.setTimeout(() => {
    swapping = false;
    render();
    const next = root.firstElementChild as HTMLElement | null;
    if (!next) return;
    next.classList.add('app--enter');
    next.addEventListener('animationend', () => next.classList.remove('app--enter'), { once: true });
  }, LEAVE_MS);
}

function teardown() {
  if (activeDestroy) {
    activeDestroy();
    activeDestroy = null;
  }
  gameInProgress = false;
  /**
   * 换屏默认「开阻尼」，进局内的那一条自己关（showGame 里那句 stop）。
   *
   * 这么接是为了**只改两处**：teardown 是每一屏进来时第一件事，所有内容页都经
   * 过它；局内是唯一的例外，就在那一处摘掉。反过来写（默认关、每个内容页各开
   * 一次）要改十几处，往后新加一页还得记得补——忘一处就是「这一页没有阻尼」，
   * 而那种毛病没人会报，只会觉得「怪怪的」。
   */
  smoothScroll.start();
}

/**
 * 头一回进这个玩法时，摊进开局那个大 opts 里的那一小撮字段。
 *
 * 五个玩法各有一句话，说的都是「这个玩法在基础规则上加的那一层」——炸弹为什
 * 么炸、反面为什么又翻回来、这一局的得分图案是随机的、头上那个数字在倒着
 * 走、这副棋盘换了摆法但规矩没变。摆一整局，不定时走掉（玩家定的）；第二回
 * 再进来就没有了，想再看去《暂停》和信息栏的《教学》里找。
 *
 * 不是头一回就返回空对象，什么也不加。
 */
function tipFor(kind: PlayKey, make: () => { text: string; art: string }): ShapeGameOpts {
  if (!firstTimeIn(kind)) return {};
  markOpened(kind);
  return { coach: true, coachTip: make() };
}

/**
 * 头一回点开一个基础玩法时，棋盘底下那块教学条按哪一路走。
 *
 * 玩家 2026-09 定的：「玩家玩的第一个，我们尽量教学」——所以看的是「这是不是
 * 他打的第一个基础玩法」，不是「这是哪一张卡」：
 *
 *   · 三张里他一张都没打过 → 'first'。六条里的前五条从第 1 条讲起，跟着他的
 *     手走四步讲完。方块、小球、三角哪一张都走这一路——条子上的字和图跟着这
 *     一局的图形走，讲方块就画方块。
 *   · 已经打过别的基础玩法 → 'second'。前几条他上一局跟着走过一遍了，这一局
 *     只讲第 4 条：这一族消掉之后是留下一个空图形（小球、三角），还是拿走不
 *     再出现（方块）。这块条子先不出声，等他自己打出三次得分再开口。
 *
 * 第 3 条（星星和色块同色也能一起凑）是个例外：上一局要是没真的做到，
 * coachBar 会在 'second' 这一路前面补讲一次（见它的 mixedTaught）。
 *
 * 头一回打开的玩家只能点方块和小球两张（engine/firstPlay.ts 的
 * lockedForFirstPlay），所以三角走到这儿时必定是 'second'。
 */
function basicCoach(id: string): ShapeGameOpts {
  const key: PlayKey | null =
    id === 'square' ? 'square' : id === 'circle' ? 'circle' : id === 'triangle' ? 'triangle' : null;
  if (!key || !firstTimeIn(key)) return {};
  // 先记下来再开局：这一局打到一半退出去，主菜单上这张卡也该熄了——他已经
  // 进去看过一遍了，光该让给还没点过的那一张。
  const firstOne = BASIC_KEYS.every((k) => firstTimeIn(k));
  markOpened(key);
  // 那一族的分镜也一并记成「看过」。这一局的规矩他是靠教学条学的，学的是同
  // 一批内容；不记的话，第二次点开这张卡（那时候没有教学条了）反而会被那段
  // 动画拦一次——「意料之外的界面」。想重看的人去《教学》里找得到。
  markTutorialSeen(key);
  return { coach: true, coachPlan: firstOne ? 'first' : 'second' };
}

/**
 * 炸弹 / 无限反转的那幅配图跟着他挑的图形走。配图只有两幅，三角没有自己那一份，
 * 当方块画。
 *
 * 问的是家族（棋盘自己在 card 里声明，见 shapes/registry.ts），不再按 id 前缀猜——
 * 行为和从前一模一样（circle 一族→circle，其余→square），只是判定不再是这个文件里
 * 自己的一份。这是第六处按前缀猜的地方，前五处见 registry.ts 文件头那张表。
 */
function tipShape(id: string): 'square' | 'circle' {
  return cardOf(id).family === 'circle' ? 'circle' : 'square';
}

function showMenu() {
  teardown();
  trackScreen('menu');
  renderMenu(root, homeLayout, {
    onSelectBase: (id) => {
      if (pickingForRoom) return void startRoundFor(id);
      const game = games.find((g) => g.card.id === id);
      if (game) showGame(game, basicCoach(id));
    },
    onSelectLayout: (id, reopenKey) => {
      if (pickingForRoom) return void startRoundFor(id);
      const game = layoutGames.find((g) => g.card.id === id);
      if (game) showGame(game, tipFor('layout', () => layoutTip(currentLang)), undefined, reopenKey);
    },
    onTimedFor: (id, reopenKey) => {
      // Rooms deal one plain board from one seed. A clock or a bomb layer on
      // top of that is a different game and is not one of the eight the
      // server will accept, so the host is told rather than left guessing.
      if (pickingForRoom) return void notAMultiplayerBoard();
      const game = games.find((g) => g.card.id === id);
      if (game) {
        showGame(
          game,
          { timeLimitSec: 60, ...tipFor('timed', () => timedTip(currentLang)) },
          undefined,
          reopenKey,
        );
      }
    },
    onLockedLayout: () => openGeniusWindow(currentLang, showMenu),
    /**
     * 这三张（老虎机 / 无限反转 / 步步为营）按下去进的是**整页**，所以在这儿
     * 包一层 softSwap：旧的淡出去、新的托上来，不再硬切（玩家第七轮点名的）。
     *
     * 包在**主菜单这一侧**，不是包进那三个 show 函数里：从开局页按《返回》回
     * 到这几页、或者开完一局再回来，走的是同一个函数——那是退回来，不该再演一
     * 次「进去」。
     */
    onRandomTarget: () => softSwap(() => showRandomTarget('menu')),
    // 屋主替整屋挑玩法时按到它也进挑图形那一屏：挑完不开单人局，而是把这一
    // 族交给小屋（见 showFlipMode 的 room）。
    onFlipMode: () => softSwap(showFlipMode),
    // 步步为营不进小屋（见 showPuzzleMode）：屋主替整屋挑玩法时按到它，只提示
    // 一句「不是小屋玩法」，和计时、炸弹同一条路——绝不能让他一个人开起来，
    // 那样整屋还等着他。
    onPuzzleMode: () => {
      if (pickingForRoom) return void notAMultiplayerBoard();
      softSwap(showPuzzleMode);
    },
    // 没打过的那几张基础卡镶一圈光，指路用；两张都打过了这里就是空的。
    glow: glowingBasics(),
    firstPlayLock: lockedForFirstPlay(),
    // 按了《我会玩》就地重画：锁和光都由上面这两个函数算，它们已经改口了。
    onKnowHow: showMenu,
    // 主菜单上的多人游玩：直接进房间那一页。
    onMultiplayer: () => {
      mpOrigin = 'menu';
      showMultiplayer();
    },
    onBombFor: (tier, id, reopenKey) => {
      if (pickingForRoom) return void notAMultiplayerBoard();
      const pool = tier === 'advanced' ? bombLayoutGames : games;
      const game = pool.find((g) => g.card.id === id);
      if (game) {
        showGame(
          game,
          {
            bomb: true,
            timeLimitSec: tier === 'timed' ? 90 : undefined,
            ...tipFor('bomb', () => bombTip(currentLang, tipShape(id))),
          },
          undefined,
          reopenKey,
        );
      }
    },
  }, currentLang);
  setNavTab(null);
  paintRoomHostBanner();
  wireHomeTitle();
  repaintIcons();
  restoreMenuScroll();
  // 手机 / 浏览器的返回键（见 backNav.ts）：主菜单是根，返回就真的离开网站；屋主替
  // 整屋挑玩法的时候不是——那一下回小屋。
  setScreenBack(pickingForRoom ? backToRoomFromPick : null);
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
  // 小屋的 4-3-2-1 那一幕也不留底排——玩家的原话：「4-3-2-1 的画面下方去除掉
  // 个人主页和成绩的选择」。
  cl.toggle('is-counting', !!root.querySelector('.mp-countdown-page'));
}
new MutationObserver(syncScreenClass).observe(root, { childList: true });
syncScreenClass();

/**
 * @param restore 从它自己的某一页《退出》回来：落回刚才看的位置。从底排导航
 *   点开的，照旧从最上面开始。
 */
function showAccountPage(tab: AuthTab, restore = false) {
  teardown();
  trackScreen('profile');
  // 刚登录完最常落在这一页：顺手把云上那份战绩接回这台设备。
  void restoreCloudRuns(runKeyFor);
  renderAccountPage(
    root,
    tab,
    {
      onBack: showMenu,
      onSwitchLanguage: () => showLangSwitchModal(currentLang, onLanguageSwitched),
      onHowToSlide: showTutorialPicker,
      onRandomTarget: showSlotIntro,
      onMultiplayer: () => {
        mpOrigin = 'profile';
        showMultiplayer();
      },
      onMoreTargets: showTargetsShowcase,
      onMoreLayouts: showLayoutsShowcase,
      onWorldRank: showWorldRankPage,
      onMoreModes: showModesShowcase,
    },
    currentLang,
  );
  setNavTab('profile');
  wireHomeTitle();
  repaintIcons();
  setScreenBack(showMenu);
  if (restore) restoreProfileScroll();
  else toTop();
}

/**
 * 《老虎机模式》从个人主页点进来的那一页：三台机器转着，底下一颗 STOP。
 * 开通了的人右下角多一颗《开始 〉》，去挑图形那一屏。
 */
function showSlotIntro() {
  teardown();
  trackScreen('slot-intro');
  activeDestroy = renderSlotIntroPage(
    root,
    currentLang,
    { onBack: backToProfile, onGo: () => showRandomTarget('intro') },
    !isGenius(),
  );
  wireHomeTitle();
  repaintIcons();
  setScreenBack(backToProfile);
  toTop();
}

/**
 * 《无限反转》：挑方块还是小球，60 秒，得分翻面来回翻。天才特供的一档——
 * 没开通的人看得见那一屏，按下去是订阅那扇窗。
 *
 * 只从主菜单那张卡进来（个人主页里《更多玩法》那一行是陈列页，见
 * showModesShowcase），所以《退出》和返回键都回主菜单——从前一律回个人主页，
 * 从主菜单进来的人开局前一退就被送到了个人主页。
 *
 * 屋主在为整屋挑玩法时也走这一屏：挑完不开单人局，而是把这一族连同「无限反
 * 转」的标记交给小屋，全屋一起倒数、一起打 60 秒（api/room.js 的 FLIP_MODES）。
 */
function showFlipMode() {
  teardown();
  trackScreen('flip-mode');
  renderFlipModePage(
    root,
    currentLang,
    {
      onBack: showMenu,
      onStart: (family) => {
        const game = family === 'square' ? squareGame : circleGame;
        showGame(
          game,
          {
            flip: true,
            timeLimitSec: FLIP_SECONDS,
            ...tipFor('flip', () => flipTip(currentLang, family === 'circle' ? 'circle' : 'square')),
          },
          showFlipMode,
        );
      },
      onGenius: () => openGeniusWindow(currentLang, showFlipMode),
      room: pickingForRoom ? { onStart: (family) => void startRoundFor(family, undefined, true) } : undefined,
    },
    !isGenius(),
  );
  wireHomeTitle();
  repaintIcons();
  setScreenBack(showMenu);
  toTop();
}

/**
 * 《真正解密 · 步步为营》：挑方块、小球还是三角。天才特供，只从主菜单那张卡进来。
 *
 * 三角那一栏用的是 **triangleGame 这个变量**，不是按文件名找的：这个仓库里
 * `const triangleGame = createTriangleBigGame()`——菜单上的「三角」由
 * triangleBig.ts 造，两个三角文件在 2026-09 对调过内容，照文件名推会正好推反
 * （见 CLAUDE.md《家族按 id 前缀认，但有一个陷阱》）。
 *
 * 没有 room 入口：这一局不比时间，和小屋「同一段时间里谁分高」凑不到一起。
 */
function showPuzzleMode() {
  teardown();
  trackScreen('puzzle-mode');
  renderPuzzleModePage(
    root,
    currentLang,
    {
      onBack: showMenu,
      onStart: (family) => {
        const game = family === 'square' ? squareGame : family === 'circle' ? circleGame : triangleGame;
        showGame(
          game,
          { steps: true, ...tipFor('puzzle', () => puzzleTip(currentLang)) },
          showPuzzleMode,
        );
      },
      onGenius: () => openGeniusWindow(currentLang, showPuzzleMode),
    },
    !isGenius(),
  );
  wireHomeTitle();
  repaintIcons();
  setScreenBack(showMenu);
  toTop();
}

/** 《更多玩法》：无限反转的图装在圆角矩形框里陈列着——玩还是要回主菜单去玩。 */
function showModesShowcase() {
  teardown();
  trackScreen('more-modes');
  renderModesShowcase(root, currentLang, backToProfile);
  setNavTab(null);
  wireHomeTitle();
  repaintIcons();
  setScreenBack(backToProfile);
  toTop();
}

/** 《更多得分目标》：二十个得分图案，三列。 */
function showTargetsShowcase() {
  teardown();
  trackScreen('more-targets');
  renderTargetsShowcase(root, currentLang, backToProfile);
  setNavTab(null);
  wireHomeTitle();
  repaintIcons();
  setScreenBack(backToProfile);
  toTop();
}

/** 《更多布局》：两副布局的缩图。 */
function showLayoutsShowcase() {
  teardown();
  trackScreen('more-layouts');
  renderLayoutsShowcase(root, currentLang, backToProfile, [
    { id: circleSevenGame.card.id, shape: 'circle' },
    { id: triangleAdvancedGame.card.id, shape: 'triangle' },
  ]);
  setNavTab(null);
  wireHomeTitle();
  repaintIcons();
  setScreenBack(backToProfile);
  toTop();
}

/** 《世界排名》：整页就是那张榜。 */
function showWorldRankPage() {
  teardown();
  trackScreen('world-rank');
  renderWorldRankPage(root, {
    lang: currentLang,
    onBack: backToProfile,
    onWantGenius: () => openGeniusWindow(currentLang, showWorldRankPage),
    onReLogin: () => openAuthWindow(currentLang, 'login', showWorldRankPage),
  });
  setNavTab(null);
  wireHomeTitle();
  repaintIcons();
  setScreenBack(backToProfile);
  toTop();
}

/**
 * 看教学的时候，每点一下就向小屋报一声「我还在学」。
 *
 * 教学页整页被教学占着、不轮询，服务器只能靠这一声知道人还在。五秒最多报
 * 一次——报得再密也没有意义，服务器那头二十秒不来一声才不等（api/room.js
 * 的 LEARN_IDLE_MS）。回来的是拆监听的函数。
 */
function learnHeartbeat(): () => void {
  let last = 0;
  const beat = () => {
    const now = Date.now();
    if (now - last < 5000) return;
    last = now;
    void setLearning(true);
  };
  window.addEventListener('pointerdown', beat, { capture: true, passive: true });
  window.addEventListener('keydown', beat, { capture: true, passive: true });
  return () => {
    window.removeEventListener('pointerdown', beat, { capture: true });
    window.removeEventListener('keydown', beat, { capture: true });
  };
}

/**
 * 多人游玩. The page owns its own polling, so what it hands back is the
 * teardown, and that becomes this screen's destroy like any game's.
 */
function showMultiplayer() {
  teardown();
  setPickingForRoom(null);
  trackScreen('multiplayer');
  // 返回键先按「回进来的那一边」登记；小屋页自己画到哪一屏（设置页 / 小屋里 /
  // 重连 / 倒数）会再各自盖上（见 ui/multiplayer.ts）。
  setScreenBack(() => (mpOrigin === 'profile' ? backToProfile() : showMenu()));
  activeDestroy = renderMultiplayerPage(
    root,
    {
      // 从哪儿进来的就回哪儿：主菜单，或者个人主页刚才看的位置。
      onBack: () => (mpOrigin === 'profile' ? backToProfile() : showMenu()),
      onMatchStart: startMultiplayerRun,
      // Opening a room is the subscriber's; buying it lands back here.
      onNeedGenius: () => openGeniusWindow(currentLang, showMultiplayer),
      // 服务器答「不认这台设备」：直接开登录窗。和上面那条不是一回事——这个
      // 人多半已经付过钱，缺的只是重登一次；走 openGeniusWindow 会因为本机缓
      // 存还以为自己是天才而拐进《账户》窗，那里没有登录入口。世界排行榜那
      // 一处（onReLogin）走的就是这一句。
      onSessionGone: () => openAuthWindow(currentLang, 'login', showMultiplayer),
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
        // 看教学的这几分钟里，每点一下都向小屋报一声「我还在学」；二十秒一下
        // 都没点，小屋那边就不再等他（api/room.js 的 LEARN_IDLE_MS）。
        const stopBeat = learnHeartbeat();
        renderShapeTutorialByShape(shape, () => {
          stopBeat();
          void setLearning(false, seenTutorials()).then((st) => {
            // 学完的时候这一局已经开了（小屋没等他——他走神太久，或者早就
            // 放行了）：这一局不是他的了，坐等待页看排行，下一局再入。开赛
            // 时刻还在前面的，才是「大家等到了他」，一起从 4 数起。
            if (st && st.round && !st.roundOver && st.startAt && st.startAt <= st.serverNow) {
              markRoundPlayed(st.round);
            }
            showMultiplayer();
          });
        });
      },
      // 等人学教学那一屏底下的练习盘：这一局的玩法，练习模式（不结算）。
      onPractice: (host, mode, flip) => {
        const game = everyGame.find((g) => g.card.id === mode);
        if (!game) return null;
        // 练习盘不能是真局那副：这时候真局的种子还没种下（下一次开局才种），
        // 这里只是把上一局残留的种子清掉，保险。
        clearSeed();
        // 无限反转那一局的练习盘也按无限反转的规矩来（翻来翻去、不消行）。
        const destroy = game.mount(host, () => {}, { lang: currentLang, practice: true, flip: !!flip });
        // 开局页那一幕不要：直接开打（和小屋开局那一下同一个按钮）。
        requestAnimationFrame(() => host.querySelector<HTMLButtonElement>('#startBtn')?.click());
        return destroy;
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
  // 随机得分目标那一局：'same' 从刚种下的那条随机流里抽——每台设备种的是同
  // 一个种子、抽的是同一下，所以抽出来的一对一样，而且棋盘接着从同一条流
  // 里发，仍然人人相同；'own' 用各自的 Math.random 抽，不碰那条流，棋盘照旧
  // 一样，只有认的图案各不相同。
  //
  // 抽这一下**照抽不误**，哪怕倒数那一屏已经把图案转出来交过来了：'same' 那
  // 一档的棋盘是接着这条流往下发的，少抽一次，这台设备发出来的牌就和别人的
  // 对不上了。抽出来的那一对和屏幕上转出来的是同一对（同一个种子、同一下）。
  // 'own' 那一档用的是本机的 Math.random，不碰这条流，所以以屏幕上停住的那
  // 一对为准——玩家看着轮子停在哪儿，手里要凑的就得是哪个。
  const dealt = match.slot
    ? drawPair(slotFamilyOf(match.mode), match.slot === 'same' ? seededRandom : Math.random) ?? undefined
    : undefined;
  const targets = match.targets ?? dealt;
  // 无限反转那一局：和单人那一局同一套规则（flip + 60 秒），只是全屋同一副牌。
  const flip = !!match.flip;
  // A finished round goes back to the room, not to the home page: the scores
  // are still up there and the host has another board to pick. Only a device
  // that has somehow lost its seat falls through to the home page.
  const back = () => (currentRoom() ? showMultiplayer() : showMenu());
  const destroyGame = game.mount(root, back, {
    lang: currentLang,
    targets,
    flip,
    timeLimitSec: flip ? FLIP_SECONDS : undefined,
  });
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
    // 交完卷正等着别人的时候小屋散了：和站在小屋列表页时同一个去处——那张
    // 小屋战绩卡。
    onRoomEnded: showRoomFinal,
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
  // 看完那张战绩卡，一步退回多人设置页——不是主菜单。走的人多半还想再进一
  // 间或者再开一间，回主菜单等于让他再点两下才回到这儿（玩家的原话：「屋主
  // 解散/离开后一步退回多人设置页，不再一层层退」）。座位已经交回去了，
  // showMultiplayer 在没有座位时画的就是设置页。
  if (!state) return showMultiplayer();
  // 标题不另起一个：中途走的人和散场时看到的是同一间小屋的同一份战绩，
  // 一张写《小屋战绩》、另一张写《竞赛排名》，看图的人会以为是两件事。
  showRoomCard(root, state, currentLang, showMultiplayer, { meId });
  setScreenBack(showMultiplayer);
}

/**
 * 结束房间. The evening's card, and then out — the seat is given up here
 * rather than in the room page, so the card is the last thing that needed it.
 */
function showRoomFinal(state: RoomState, meId?: string) {
  teardown();
  setPickingForRoom(null);
  const done = () => {
    forgetRoom();
    // 一步退回多人设置页（见 leaveRoomWithCard 那段）。
    showMultiplayer();
  };
  // meId 只有「中途走的人」会给：他的座位刚交回去，图上认不出哪一行是他，
  // 所以先留了一份 id 传进来（见 multiplayer.ts 的 leaveSeat）。散场的时候
  // 座位还在，不用给。
  showRoomCard(root, state, currentLang, done, meId ? { meId } : undefined);
  setScreenBack(done);
}

function showRecordsPage() {
  teardown();
  trackScreen('records');
  // 先把云上那份战绩接回这台设备，回来了就把这一页重画一遍。
  //
  // 这一步是补的，不是等的：先照本地有的画出来，取回来了再多几行。取不到
  // （没登录、没网）就什么都不发生——这一页本来什么样还是什么样。
  void restoreCloudRuns(runKeyFor).then((added) => {
    if (added > 0 && root.querySelector('.records-page')) showRecordsPage();
  });
  // 锁着的排行榜上那颗《成为 Slides 天才》：开订阅那一窗，关掉之后回到这一页。
  //
  // 《重新登录》直接开登录那一窗，不绕个人主页。绕不通：这台设备本地还以为
  // 自己是订阅着的，个人主页上那颗宽键这时写的是《订阅状态》，点开是看订单
  // 的，根本没有重新输邮箱密码的地方。而这个人恰恰需要的就是重新输一次——
  // 令牌每次登录换一发，服务器只认最新那一发。
  renderRecordsPage(
    root,
    recordSources,
    showMenu,
    currentLang,
    () => openGeniusWindow(currentLang, showRecordsPage),
    () => openAuthWindow(currentLang, 'login', showRecordsPage),
  );
  setNavTab('records');
  wireHomeTitle();
  repaintIcons();
  setScreenBack(showMenu);
  toTop();
}

/**
 * @param onBack 教学里按返回键去哪儿。不给就等同按《完成》（onDone）；开局前自动弹
 *   出的那一段例外——返回该回主菜单，不该把人送进那一局。
 */
function renderShapeTutorialByShape(shape: TutorialShape, onDone: () => void, onBack: () => void = onDone) {
  teardown();
  trackScreen('tutorial');
  if (shape === 'square') renderTutorial(root, currentLang, onDone);
  else if (shape === 'circle') renderCircleTutorial(root, currentLang, onDone);
  else renderTriangleTutorial(root, currentLang, onDone);
  setScreenBack(onBack);
}

function showTutorialPicker() {
  teardown();
  trackScreen('tutorial_picker');
  // 三个图形、六条规则、一颗《返回》，一屏装下——见 ui/tutorialPicker.ts。
  //
  // 《返回》回个人主页，不是主菜单：这一页只有一个入口，就是个人主页里的
  // 《如何滑？》那一行（accountPage 的 howToRow）。从那儿进来、退出去却落在
  // 主菜单，等于把人从他原来待的地方赶走了——和天才特供各页一样，退出要落
  // 回刚才那一页的原位置（backToProfile 的 restore）。
  renderTutorialPicker(root, currentLang, {
    onPick: (shape) => renderShapeTutorialByShape(shape, showTutorialPicker),
    onBack: backToProfile,
  });
  repaintIcons();
  setScreenBack(backToProfile);
  toTop();
}

/**
 * 《老虎机模式》挑图形那一屏：挑完转出这一局认哪两个得分图案，然后就是那个
 * 基础玩法本身。
 *
 * 它是天才特供的一档，所以没开通的人点到这儿是那扇订阅窗——和主菜单上那两
 * 张锁着的棋盘同一个去处。
 *
 * @param origin 从哪儿进来的：主菜单那张卡，还是个人主页那页介绍（三台机器
 *   右下角的《开始 〉》）。《退出》回的是进来的那一边。不给就沿用上一次的——
 *   一局打完退回这一屏、从订阅窗回来，都还算同一趟。
 */
function showRandomTarget(origin?: 'menu' | 'intro') {
  if (origin) slotOrigin = origin;
  teardown();
  trackScreen('random-target');
  renderRandomTargetPage(
    root,
    currentLang,
    {
      onBack: () => (slotOrigin === 'intro' ? showSlotIntro() : showMenu()),
      onStart: (family: Family, targets: TargetPattern[]) => {
        const game = randomTargetGame(family);
        showGame(
          game,
          { targets, ...tipFor('slot', () => slotTip(currentLang, targets)) },
          showRandomTarget,
        );
      },
      onGenius: () => openGeniusWindow(currentLang, showRandomTarget),
      // 屋主在为整屋挑玩法：这一屏多一个《相同 / 不同》开关，挑完不开单人
      // 局，而是把这一族和开关一起交给小屋，全屋一起倒数。
      room: pickingForRoom
        ? { onStart: (family: Family, slot: 'same' | 'own') => void startRoundFor(family, slot) }
        : undefined,
    },
    !isGenius(),
  );
  wireHomeTitle();
  repaintIcons();
  setScreenBack(() => (slotOrigin === 'intro' ? showSlotIntro() : showMenu()));
  toTop();
}

/**
 * 小屋那一局的 mode 就是族名（square / circle / triangle）——见 api/room.js 的
 * SLOT_MODES。判定搬到 shapes/registry.ts 的 `familyFromName`：**认不出来就抛**，
 * 不再拿 `'triangle'` 兜底。
 *
 * 兜底的后果是把三角的得分图案发到一副方块棋盘上，玩家要凑的图案根本凑不出来，而屏
 * 幕上一个字的错都没有。真收到别的值，那是前后端的协议对不上了，那种事该响。
 */
const slotFamilyOf = (mode: string): Family => familyFromName(mode);

/** 这一族对应的基础玩法。三角那一档是主菜单上《三角》后面那块整三角。 */
function randomTargetGame(family: Family): ShapeGame {
  if (family === 'square') return squareGame;
  if (family === 'circle') return circleGame;
  return triangleGame;
}


function showGame(game: ShapeGame, opts?: ShapeGameOpts, onBack?: () => void, reopenKey?: string) {
  // shouldLeadOut：结算页那对指路的光只在他头一回看见结算页时亮一次（玩家
  // 定的）。每一局都挂上，真正判「是不是头一回」的是结算页露面那一刻。
  const fullOpts: ShapeGameOpts = {
    shouldLeadOut: claimFirstEndcard,
    shouldTeachTotal: claimFirstTotalTip,
    ...opts,
    lang: currentLang,
  };
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
    /**
     * 局内不要滚动阻尼（玩家第八轮点名）。
     *
     * teardown 默认给所有屏开着（见那儿），局内是唯一的例外：棋盘那块自己吃
     * 手势（`touch-action: none`），再插一层接管滚动只会打架。关在挂载棋盘的
     * 这一句旁边，而不是 showGame 头上——开局页、倒数那几屏走的也是 showGame，
     * 它们是正经的内容页。
     */
    smoothScroll.stop();
    /**
     * 单人局一律从真随机发牌——把上一次留下的共享种子清掉。
     *
     * 小屋的倒数那一屏会种一条全屋共用的随机流（'相同' 那一档要全屋抽到同一
     * 对图案，见 ui/multiplayer.ts）。种下之后只有一处会清：真的开了那一局、
     * 而且那一局拆掉的时候（startMultiplayerRun 的 activeDestroy）。中途退出、
     * 断线、这一局没赶上的人，那条流就一直钉在那儿——他接下来打的每一局单人
     * 发的都是同一副牌，而且同一间屋里两个这样退出的人摸到的牌一模一样。刷新
     * 页面才恢复正常。
     *
     * 清在这儿而不是清在小屋那边：所有单人局都从这道门进来（等待页的练习盘
     * 另有一句，见 onPractice），一句话管住全部，也不必去操心小屋那几屏的拆
     * 除顺序会不会反过来把真局的种子抹掉。
     */
    clearSeed();
    activeDestroy = game.mount(root, backFn, fullOpts);
    gameInProgress = true;
  };
  // 开局前不再自己弹分镜动画（玩家定的）。
  //
  // 那一屏是一段没有互动的动画，把刚决定要玩的人挡在门外——不管他是头一回点
  // 基础方块，还是头一回点三角。规矩改由棋盘底下那块教学条一条一条讲，讲到
  // 哪一条就等他真的做到那一条，做到了才往下走，中间得分目标一直亮着（见
  // ui/coachBar.ts 和 basicCoach）。
  //
  // 分镜本身没有删：想看的人自己去个人主页那一行《如何滑？》点开（教学挑选
  // 页，showTutorialPicker）。小屋里那条也留着——那不是自动弹，是玩家自己回
  // 答了「我不会这个玩法」才放的（onLearnTutorial）。
  mountNow();
}

function boot() {
  // 返回键那套（见 backNav.ts）先立好：底下一条根、上面一条哨兵。
  installBackNav();
  // 登录着的话，顺手把云上那份战绩接回来——别等玩家点进记录页才发现是空的。
  void restoreCloudRuns(runKeyFor);
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
  afterLangChosen(savedLang, true);
}

/**
 * 页面框架（底排那两个字、图示）换一种语言重画。开机和切语言都走这儿——
 * 切语言的时候只有它够，屏幕上那一页由调用方自己原地重画。
 */
function relocalizeChrome(lang: Lang) {
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
}

/**
 * @param resume 刚打开页面（不是切语言）：这台设备要是还坐在哪间小屋里
 *   ——刷新了、或者关掉又打开——就直接回小屋页接着走，别落在主菜单上让
 *   屋里的人看着他「掉线」。小屋页自己会分辨座位还在不在、这一局打没打过。
 */
function afterLangChosen(lang: Lang, resume = false) {
  relocalizeChrome(lang);
  if (isFirstRun()) {
    // 第一次打开这台设备上的游戏：就落在主菜单，只是《基础方块》和《基础小
    // 球》两张卡镶着一圈光（玩家定的）。
    //
    // 中间试过两版：先是进来就放方块那段分镜，看完落主菜单——五张卡摊在眼
    // 前，新来的人不知道先按哪一张；后来改成不问自答直接开一局小球——路是指
    // 明了，可这一下他连主菜单长什么样都还没见过就被按进了游戏里，是「意料
    // 之外的界面」。
    //
    // 现在这一版两头都占：主菜单照常是第一屏，光替他挑好了先按哪两张；点进
    // 去还是那段分镜加那块教学条（见 showGame 那道闸口和 basicCoach）。打完
    // 一张那张就不亮了，另一张接着亮，直到两张都打过（engine/firstPlay.ts）。
    markFirstRunDone();
  }
  if (resume && currentRoom()) {
    mpOrigin = 'menu';
    showMultiplayer();
    return;
  }
  showMenu();
}

/**
 * 换语言：**原地换**，不换页。
 *
 * 原先这儿走的是 afterLangChosen()，也就是开机那条路——它最后一句是
 * showMenu()。于是玩家在个人主页上点一下《语言》，字是换了，人却被扔回了主
 * 菜单，刚才翻到哪儿也没了。玩家的原话：「现在在web端更换语言后会立刻跳回主
 * 页，不能这样」。这正是那条「不要出现意料之外的界面」。
 *
 * 《语言》这颗键只长在个人主页上（accountPage.ts 的 #langRow，全站独一
 * 处），所以「原地」就是把个人主页照新语言再画一遍，连带把滚动位置放回去
 * ——和天才特供那几页按《退出》回来走的是同一条（backToProfile）。
 */
function onLanguageSwitched(lang: Lang) {
  saveLang(lang);
  trackLanguage(lang, 'switch');
  relocalizeChrome(lang);
  showAccountPage('login', true);
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

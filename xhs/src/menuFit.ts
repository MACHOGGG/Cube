/**
 * 主菜单：把五张卡收进一屏，别压在底排上。
 *
 * ── 出了什么事 ──────────────────────────────────────────────────
 *
 * 给小红书顶栏让开 102px 之后，主菜单整体下移，最后一排那张《无限反转》就
 * 顶到底排那颗键上去了——量出来压住 93px：卡的下沿在 847pt，底排从 754pt
 * 起。滑一下能露出来，可玩家一进来看到的就是压着的那一帧。
 *
 * 网页版没这毛病，因为它十三张卡本来就要滑；这一版只有五张，本该一屏装完。
 *
 * ── 怎么算 ──────────────────────────────────────────────────────
 *
 * 卡有多大不能写死：让位多少跟着机器走（灵动岛 62 / 刘海 47 / 没有 0），
 * 屏幕又高高矮矮。所以这里现量现算：
 *
 *   1. 先把上一轮写下的尺寸摘掉，量出「样式表想要的那个大小」；
 *   2. 看整页比屏幕高出多少（scrollHeight − innerHeight）；
 *   3. 高出的这一截，由几排卡平摊——每排矮 δ，整页就矮 排数×δ，因为图是
 *      正方形，卡窄多少就矮多少；
 *   4. 算出来的宽度写进 `--xhs-card`，pages.css 里那条 max-width 读它。
 *
 * 装得下就把量到的设计值原样写回去，不缩。
 *
 * 摘掉再量、算完再写，都在同一个同步块里，浏览器不会在中间画一帧，屏幕上
 * 看不到那一瞬间的大小。
 */

/**
 * 再小就不像个能点的东西了。
 *
 * 从 76 降到 68：那三张卡上多了一行「进阶入口」，矮屏（375×667）三排一共多
 * 出五十来个像素，卡不再缩一档就会把最后一排顶到底排上。68px 的图配上底下
 * 那行小字，整张卡还有九十来个像素高，手指按得住。
 */
const MIN_CARD = 68;

/** 卡缩到头还是装不下时，把排与排之间那道缝也收一收。收到这儿为止。 */
const MIN_GAP = 10;

/** 再不够就收标题。收到这儿为止——再小就不像个招牌了。 */
const MIN_TITLE = 22;

function menuParts() {
  const app = document.querySelector<HTMLElement>('.app.home-page');
  const grid = app?.querySelector<HTMLElement>('.home-grid') ?? null;
  const rows = grid ? Array.from(grid.querySelectorAll<HTMLElement>('.home-row')) : [];
  const card = rows[0]?.querySelector<HTMLElement>('.home-icon-btn') ?? null;
  const art = rows[0]?.querySelector<HTMLElement>('.home-icon-art') ?? card;
  return { app, grid, rows, card, art };
}

/**
 * 最后一张卡的小字，和底排那一块之间要留多少——量出来是负数就是还没挨着。
 *
 * 从 8 放宽到 16：8px 在算术上够了（谁也没压着谁），可一眼看过去卡的小字几
 * 乎贴在底排那颗键上，像是「差一点就要压上」。玩家要的是「所有内容互相不
 * 遮蔽」，那就该看得出中间有条缝，而不是刚好没碰上。
 */
const CLEAR = 16;
function overlap(): number {
  const cards = document.querySelectorAll<HTMLElement>('.home-icon-btn');
  const last = cards[cards.length - 1];
  const nav = document.querySelector<HTMLElement>('.home-nav');
  if (!last || !nav) return 0;
  const tag = last.querySelector<HTMLElement>('.home-icon-tag') ?? last;
  return Math.ceil(tag.getBoundingClientRect().bottom + CLEAR - nav.getBoundingClientRect().top);
}

/**
 * 还差多少地方：整页高出屏幕的那一截，和「压着底排」的那一截，取大的。
 *
 * 只看 scrollHeight 不够。底排是 position: fixed 的，它不进文档高度——页面
 * 可以一点不滑，最后那张卡的小字却正正压在那颗键上。真机上更明显：底下那道
 * 安全区（home indicator，34pt 上下）把底排整块往上顶，无头浏览器量到的是
 * 0，于是本机看着刚好、玩家手里就压住了。所以这里两个都量，按坏的那个缩。
 */
function shortfall(): number {
  return Math.max(document.documentElement.scrollHeight - window.innerHeight, overlap());
}

/** 算一遍，把卡的宽度写到 `--xhs-card` 上。 */
export function fitMenu(): void {
  const { app, rows, card } = menuParts();
  if (!app || !card || !rows.length) return;

  // 摘掉自己上一轮写的，量到的才是样式表想要的那个大小；不摘的话每跑一次就
  // 在上一次的基础上再缩一点，越缩越小。
  document.body.style.removeProperty('--xhs-card');
  // 缝那个变量是 .home-page 自己定义的（pages.css），写在 body 上会被它盖
  // 掉——要压住它，只能写进同一个元素的行内样式。
  app.style.removeProperty('--narrow-gap');
  app.style.removeProperty('--xhs-title');
  const design = card.getBoundingClientRect().width;
  if (!(design > 0)) return;

  const over = shortfall();
  const shrink = over > 0 ? over / rows.length : 0;
  const want = Math.max(MIN_CARD, Math.floor(design - shrink));
  document.body.style.setProperty('--xhs-card', want + 'px');

  // 取整、小数、每排那点边边角角，算完可能还差一两个像素——差一像素也是要滑
  // 的，那一滑就把「一屏装完」这件事否掉了。所以照着剩下的再补。
  //
  // 补一次不一定够：一排的高度不是「卡宽」一个数说了算（底下还有一行小字、
  // 排与排之间还有间距），卡窄 1px 那一排未必正好矮 1px。所以追着量、追着
  // 缩，最多四轮——四轮还收不住就是别的地方撑着，再缩只会把卡缩没。
  // 门槛是 1 不是 0：scrollHeight 是取整往上进的，874.4 高的页面它报 875，
  // 差这一像素滑不动，追它只会白缩一圈。
  let now = want;
  for (let round = 0; round < 4; round++) {
    const left = shortfall();
    if (left <= 1 || now <= MIN_CARD) break;
    now = Math.max(MIN_CARD, now - Math.max(1, Math.ceil(left / rows.length)));
    document.body.style.setProperty('--xhs-card', now + 'px');
  }

  // 卡缩到头了还是装不下（矮屏幕，比如 375×667）：再从排与排之间那道缝里
  // 挤。缝比卡便宜——挤掉 8px 谁也看不出来，卡再小就不像个能按的东西了。
  const left = shortfall();
  if (left > 1) {
    // 量出来，不去读 --narrow-gap：自定义属性读回来的是写在样式表里的原话
    // （clamp(18px, 6vw, 34px)），不是算完的像素数，parseFloat 只会得到 NaN。
    // 两排之间的实际距离才是这道缝真正有多宽。
    const gap =
      rows.length > 1
        ? rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().bottom
        : NaN;
    if (Number.isFinite(gap)) {
      // 一排一道缝，外加上下各一道：整页矮 (排数+1)×δ。
      const shrinkGap = Math.ceil(left / (rows.length + 1));
      app.style.setProperty('--narrow-gap', Math.max(MIN_GAP, gap - shrinkGap) + 'px');
    }
  }

  // 缝也挤到头了还差（375×667 那种矮屏）：最后从顶上那块招牌里要。它是这一
  // 页最不必要的高度——玩家进来是找玩法的，不是读标题的。
  const title = app.querySelector<HTMLElement>('.home-title');
  if (title) {
    title.style.removeProperty('font-size');
    app.style.removeProperty('--xhs-title');
    const still = shortfall();
    if (still > 1) {
      const size = parseFloat(getComputedStyle(title).fontSize);
      if (Number.isFinite(size)) {
        app.style.setProperty('--xhs-title', Math.max(MIN_TITLE, size - still) + 'px');
      }
    }
  }
}

/**
 * 装上：主菜单每次画出来叫一次，转屏和尺寸变化也各算一遍。
 *
 * 画完要等一帧再量——这一版的主菜单是刚插进 DOM 的，排版还没跑完，当场量
 * 到的高度是上一屏的。
 */
export function scheduleFitMenu(): void {
  requestAnimationFrame(() => requestAnimationFrame(fitMenu));
}

let hooked = false;
export function installMenuFit(): void {
  if (hooked) return;
  hooked = true;
  const again = () => scheduleFitMenu();
  window.addEventListener('resize', again);
  window.addEventListener('orientationchange', again);
}

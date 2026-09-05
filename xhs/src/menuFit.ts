/**
 * 主菜单：把五张卡收进一屏，别压在底排上。
 *
 * ── 出了什么事 ──────────────────────────────────────────────────
 *
 * 给小红书顶栏让开 106px 之后，主菜单整体下移，最后一排那张《无限反转》就
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

/** 再小就不像个能点的东西了。 */
const MIN_CARD = 84;

function menuParts() {
  const app = document.querySelector<HTMLElement>('.app.home-page');
  const grid = app?.querySelector<HTMLElement>('.home-grid') ?? null;
  const rows = grid ? Array.from(grid.querySelectorAll<HTMLElement>('.home-row')) : [];
  const card = rows[0]?.querySelector<HTMLElement>('.home-icon-btn') ?? null;
  const art = rows[0]?.querySelector<HTMLElement>('.home-icon-art') ?? card;
  return { app, grid, rows, card, art };
}

/** 算一遍，把卡的宽度写到 `--xhs-card` 上。 */
export function fitMenu(): void {
  const { app, rows, card } = menuParts();
  if (!app || !card || !rows.length) return;

  // 摘掉自己上一轮写的，量到的才是样式表想要的那个大小；不摘的话每跑一次就
  // 在上一次的基础上再缩一点，越缩越小。
  document.body.style.removeProperty('--xhs-card');
  const design = card.getBoundingClientRect().width;
  if (!(design > 0)) return;

  const over = document.documentElement.scrollHeight - window.innerHeight;
  const shrink = over > 0 ? over / rows.length : 0;
  const want = Math.max(MIN_CARD, Math.floor(design - shrink));
  document.body.style.setProperty('--xhs-card', want + 'px');

  // 取整、小数、每排那点边边角角，算完可能还差一两个像素——差一像素也是要滑
  // 的，那一滑就把「一屏装完」这件事否掉了。所以照着剩下的再补一次。
  // 门槛是 1 不是 0：scrollHeight 是取整往上进的，874.4 高的页面它报 875，
  // 差这一像素滑不动，追它只会白缩一圈。
  const left = document.documentElement.scrollHeight - window.innerHeight;
  if (left > 1) {
    const fix = Math.max(MIN_CARD, want - Math.ceil(left / rows.length));
    document.body.style.setProperty('--xhs-card', fix + 'px');
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

/**
 * 「有新版本，点一下刷新」——招牌那块玻璃里的一行。
 *
 * ── 三条半规矩（和 engine/newVersion.ts 那边是同一套） ──────────────
 *
 * ① **绝不自己刷新。** 这一行是个按钮，按不按在玩家。
 * ② **对局中一个字都不说。** 这件事不用单独判：这一行长在主菜单那块招牌玻璃里
 *    （`.home-page .home-head-glass`），而打一局的时候屏幕上没有主菜单，于是它根本不存在。
 *    他打完回到菜单，它自己出现——「等这一局结束再提示」就是这么等的，不去猜这一局什么时候
 *    算结束。结算页上同样不说（那一屏三颗键挤得满，见 E21 那次三段式重排）。小屋那两屏也
 *    不说，理由见下面 HOST 那一段。
 * ③ **只说一遍，而且撤不掉。** 这不是一句飘过的提示（那种按不着），也不给「×」——给了之
 *    后他按掉，就再也不知道自己跑在旧版本上了。
 * ③半 **读不到就当没有新版本**，那一半在 engine/newVersion.ts 里。
 *
 * ── 为什么长在招牌里，而不是浮在屏幕上 ────────────────────────────
 *
 * 浮的那一版写过、量过、撤掉了：手机主菜单是那条占满整屏的鱼眼滚轴（`.mode-axis`，
 * PR-21/E18），招牌和底排本来就在轴的盒子里、卡片从它们底下滑过去——所以这一屏上没有一块
 * 空地。一块 192×37 摆在底排上面 8px 处，压住的正是炸弹那张卡和它的两枚 chip，而它自己要
 * 收下点击：他冲着炸弹按下去，页面刷新了。
 *
 * 招牌那块玻璃本来就收点击、本来就盖在卡片上面，所以长在里头没有新占走任何一块点得着的
 * 地方。摆位和宽度全交给 CSS（见 style.css 的 `.home-head-glass .newver-pill`）。
 */
import { STRINGS, type Lang } from '../i18n';
import { watchVersion } from '../engine/newVersion';

const ID = 'newVersionPill';
const CLS = 'newver-pill';
/**
 * 这一行该摆在哪儿——**主菜单**那块招牌玻璃，`<h1>` 和那句 tagline 后面。
 *
 * ⚠️ 前缀 `.home-page` 不是装饰：`.home-head-glass` 全站有七处（个人主页、战绩页、天才特
 * 供页、小屋那两屏、小屋卡片页，还有主菜单），只认后半截的话这一行会跟到每一页上去——其
 * 中最要命的是**小屋那两屏**：那上头按一下刷新，正赶上一局要开，他那一局就没了。方案说的
 * 是「在菜单上就提示」，那就只在菜单上。
 */
const HOST = '.home-page .home-head-glass';
/** 发现过新版本了。发现之后这一位不再变回去（见规矩③）。 */
let pending = false;
let lang: Lang = 'zhHans';

function make(): HTMLButtonElement {
  const el = document.createElement('button');
  el.id = ID;
  el.type = 'button';
  el.className = CLS;
  // 按下去只做一件事：重新加载。不留自作聪明的余地（不清缓存、不跳首页）——玩家按的是
  // 「刷新」，那就只刷新。
  el.addEventListener('click', () => location.reload());
  return el;
}

/**
 * 该不该把那一行摆出来，重新算一次。
 *
 * 换屏幕的时候要叫（main.ts 那个 MutationObserver 里）——主菜单每次重画都是一棵新的 DOM，
 * 上一棵里那一行跟着一起没了，得往新的那块玻璃里再放一次。换语言的时候也要叫：这一行是
 * **一直在**的，语言换了它不能还说着上一种话。
 */
export function syncNewVersionPill(next?: Lang): void {
  if (next) lang = next;
  // 还没发现新版本：什么都不建。绝大多数时候这一位一辈子不会翻过来（线上没出新版本），
  // 而且 syncScreenClass 在开机定下语言之前就会叫一次，那一下建出来的会是一句默认语言
  // 的话。
  if (!pending) return;
  const box = document.querySelector<HTMLElement>(HOST);
  // 不在主菜单上（打着一局、或者在别的页面）——这一行就不存在。这就是规矩②。
  if (!box) return;
  const had = box.querySelector<HTMLButtonElement>('.' + CLS);
  const el = had || make();
  el.textContent = STRINGS[lang].newVersionTip;
  if (!had) box.appendChild(el);
}

/** 开始盯着线上那一版。只叫一次（main.ts 开机那一路）。 */
export function armNewVersionPill(now: Lang): void {
  lang = now;
  watchVersion(() => {
    pending = true;
    syncNewVersionPill();
  });
}

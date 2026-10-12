/**
 * 「有新版本」——主菜单招牌底下那一格里的一张卡（10-11 方案 B-9，玩家定的 Q6）。
 *
 * 原先是招牌那块玻璃里的一行小字（ui/newVersionPill.ts，`newVersionTip`）。现在住进 GA 同意条那个位置、用同
 * 一套样子（ui/homeSlot.ts）：卡上一句话＋一颗按钮。
 *
 *   · 线上那一版的更新说明编号（`release`）比这一份大、而且写了这种语言的那一句：「新版本：{那一句}」；
 *   · 只有构建哈希变了（没写说明）：「有新版本」；
 *   · 按钮：刷新 / 重新載入 / Refresh / Recharger。没有关闭键：不理它就一直在，直到他刷新。
 *
 * ── 规矩（和 engine/newVersion.ts 那边是同一套） ───────────────────────
 *
 * ① **绝不自己刷新。** 那颗键是唯一会刷新的地方，按不按在玩家。
 * ② **体验冻结**：只在主菜单上、屋主不在替整屋挑玩法（pickingForRoom）、而且刚打完一局的两分钟里不出现。对局、
 *    倒数、小屋那几屏上它根本不存在（这一格住在主菜单那块招牌的盒子里）。两分钟那一条是新的：打完一局回到
 *    菜单，正是他要接着开下一局的时候，这时候冒出来一张「刷新」就是在半路上拦人。
 * ③ **只说一遍、撤不掉。** 发现之后这一位不再变回去；不给「×」——给了之后他按掉，就再也不知道自己跑在旧
 *    版本上了。读屏只在它头一回**看得见**的那一刻念一遍（卡里那一小块 role="status"），之后回到主菜单再摆出
 *    来的那一张不再念。叠在同意条底下的时候不算「看得见」（被盖着），升上来的那一下才念。
 * ③半 **读不到就当没有新版本**，那一半在 engine/newVersion.ts 里。
 */
import { STRINGS, type Lang } from '../i18n';
import { RELEASE } from '../changelog';
import { watchVersion, type NewVersionInfo } from '../engine/newVersion';
import { registerSlotCard, syncHomeSlot } from './homeSlot';

const ID = 'newVersionCard';
/** 刚打完一局多久之内不出现。 */
const FREEZE_MS = 2 * 60 * 1000;

interface Hooks {
  /** 此刻不该出现（屋主正在替整屋挑玩法）。 */
  suppressed: () => boolean;
  /** 上一局是什么时候结束的（毫秒时间戳；还没打完过就是 0）。 */
  lastGameEndAt: () => number;
}

let hooks: Hooks | null = null;
/** 发现过新版本了（带着线上那一版的 release / note）。发现之后不再变回 null（规矩③）。 */
let found: NewVersionInfo | null = null;
/** 读屏念过没有：只在头一回看得见的那一刻念（规矩③）。 */
let announced = false;
/** 念完多久把那一小块清空：留着的话，读屏一行一行往下读的时候同一句会念两遍。 */
const SAY_MS = 4000;
/** 两分钟一到再看一眼：那时候他要是还在主菜单上，卡就该出来了。 */
let thawTimer = 0;

function wanted(): boolean {
  if (!found || !hooks || hooks.suppressed()) return false;
  const left = hooks.lastGameEndAt() + FREEZE_MS - Date.now();
  if (left > 0) {
    window.clearTimeout(thawTimer);
    thawTimer = window.setTimeout(() => syncHomeSlot(), left + 50);
    return false;
  }
  return true;
}

/** 卡上那一句：线上的说明编号比这一份大、而且有这种语言的那一句，就说它；不然说通用那一句。 */
function sentence(lang: Lang): string {
  const s = STRINGS[lang];
  const note = found && found.release !== null && found.release > RELEASE ? found.note?.[lang] : undefined;
  return note ? s.newVersionNote.replace('{note}', note) : s.newVersionGeneric;
}

function make(): HTMLElement {
  const el = document.createElement('section');
  el.id = ID;
  el.className = 'home-card newver-card';
  el.innerHTML = `
    <p class="home-card-text newver-text"></p>
    <button type="button" class="home-card-btn newver-btn"></button>
    <span class="sr-only newver-say" role="status"></span>`;
  // 按下去只做一件事：重新加载。不留自作聪明的余地（不清缓存、不跳首页）——玩家按的是「刷新」，那就只刷新。
  el.querySelector<HTMLButtonElement>('.newver-btn')!.addEventListener('click', () => location.reload());
  return el;
}

function paint(el: HTMLElement, _compact: boolean, lang: Lang): void {
  el.querySelector('.newver-text')!.textContent = sentence(lang);
  el.querySelector('.newver-btn')!.textContent = STRINGS[lang].newVersionReload;
  if (announced || el.classList.contains('home-card--back')) return;
  announced = true;
  // 晚一帧再写：读屏念的是活动区域里「变了」的那一下，和区域本身同一拍挂上去的字可能一个字都不念。
  const say = el.querySelector<HTMLElement>('.newver-say')!;
  requestAnimationFrame(() => {
    say.textContent = sentence(lang);
    window.setTimeout(() => {
      say.textContent = '';
    }, SAY_MS);
  });
}

/** 开始盯着线上那一版。只叫一次（main.ts 开机那一路）。 */
export function armNewVersionCard(now: Lang, h: Hooks): void {
  if (hooks) return;
  hooks = h;
  registerSlotCard({ id: ID, rank: 1, compactable: false, wanted, make, paint }, now);
  watchVersion((info) => {
    found = info;
    syncHomeSlot();
  });
}

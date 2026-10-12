/**
 * 主菜单上那张 Google Analytics 同意条（10-11 方案 A-14，样式「② 奶油磨砂卡」）。
 *
 * ── 什么时候出现 ─────────────────────────────────────────────
 *
 * 只在网页端的**主菜单**上，而且四样同时成立：这一份构建配了 GA（VITE_GA_ID）、跑在线上的网址上、
 * 本机还没有答复（或者答复过期了，见 engine/consent.ts）、屋主不是在替整屋挑玩法（pickingForRoom）。
 * 对局、倒数、小屋那几屏上它根本不存在——它长在主菜单那块招牌的盒子里（`.home-page .home-head`），
 * 换屏就是换掉那一棵 DOM，和「有新版本」那张卡（ui/newVersionCard.ts）同一个办法。任何弹窗开着
 * 的时候藏起来（style.css 的 `.home-card` 那段：`:has()` 认得出就用它，认不出就用 ui/homeSlot.ts
 * 盖在 `<html>` 上的 `has-overlay`）。
 *
 * 小红书那一版（统计模块是空替身，gaConsentApplies 恒为 false）和 iOS 外壳（isLiveSite 为假）
 * 都不显示。
 *
 * ── 规矩（CNIL 2020-09-29 的指引） ───────────────────────────────
 *
 *   · 「接受」和「拒绝」**一样大、一样样子、一样好按**，不分主次；
 *   · 不点也能玩：它不挡任何东西，GA 不加载，下一次回到主菜单再出现；
 *   · 点了哪一颗都当场消失，答复记在本机（engine/consent.ts）。
 *
 * ── 摆在哪儿（不许压住任何一张玩法卡、招牌、底排） ───────────────────
 *
 * 招牌底下那一格，和「有新版本」那张卡（ui/newVersionCard.ts，10-11 方案 B-9）同一个位置、同一套样子；
 * 位置、紧凑版、整体往下让、两张叠在一起的样子和交替的动效都在 ui/homeSlot.ts。两张都要出的时候它在上层。
 */
import { STRINGS, type Lang } from '../i18n';
import { legalDoc } from '../legal';
import { consentChoice } from '../engine/consent';
import { acceptAnalytics, declineAnalytics, gaConsentApplies } from '../engine/analytics';
import { leaveSlot, registerSlotCard, syncHomeSlot } from './homeSlot';

const ID = 'consentBar';

interface Hooks {
  /** 点链接：打开隐私政策那扇窗（应用里那一扇，顶上有撤回的开关）。 */
  openPrivacy: () => void;
  /** 此刻不该出现（屋主正在替整屋挑玩法）。 */
  suppressed: () => boolean;
}

let hooks: Hooks | null = null;

/** 这一刻该不该摆出来：构建配了 GA、线上、没答过（或过期）、不在替整屋挑玩法。 */
function wanted(): boolean {
  return !!hooks && gaConsentApplies() && consentChoice() === null && !hooks.suppressed();
}

function make(): HTMLElement {
  const el = document.createElement('section');
  el.id = ID;
  el.className = 'home-card consent-bar';
  el.setAttribute('role', 'region');
  el.innerHTML = `
    <p class="home-card-text consent-text"><span class="consent-say"></span> <a class="consent-link" href="/privacy"></a></p>
    <div class="home-card-btns consent-btns">
      <button type="button" class="home-card-btn consent-btn" data-v="granted"></button>
      <button type="button" class="home-card-btn consent-btn" data-v="denied"></button>
    </div>`;
  // 链接写真网址（/privacy 是 build-legal 出的静态页，新标签页、复制链接都对），平常点一下开应用
  // 里那扇窗——那一扇顶上有撤回的开关，静态页上没有。
  el.querySelector<HTMLAnchorElement>('.consent-link')!.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    hooks?.openPrivacy();
  });
  for (const btn of Array.from(el.querySelectorAll<HTMLButtonElement>('.consent-btn'))) {
    btn.addEventListener('click', () => {
      if (btn.dataset.v === 'granted') acceptAnalytics();
      else declineAnalytics();
      // 底下要是叠着「有新版本」那张：这一张向上滑走，那一张升上来（ui/homeSlot.ts）。
      leaveSlot(ID);
    });
  }
  return el;
}

/** 把字填成这一种语言、这一档（完整 / 紧凑）。 */
function paint(el: HTMLElement, compact: boolean, lang: Lang): void {
  const s = STRINGS[lang];
  el.classList.toggle('consent-bar--compact', compact);
  el.setAttribute('aria-label', s.consentRegion);
  el.querySelector('.consent-say')!.textContent = compact ? s.consentShort : s.consentFull;
  // 链接用隐私政策自己的标题；紧凑版用短的那一个（只有法语不一样：« Confidentialité »）。
  el.querySelector('.consent-link')!.textContent = compact ? s.consentPrivacyShort : legalDoc(lang, 'privacy').title;
  const [yes, no] = Array.from(el.querySelectorAll<HTMLButtonElement>('.consent-btn'));
  yes.textContent = s.consentAccept;
  no.textContent = s.consentDecline;
}

/** 开机叫一次（main.ts 的 afterLangChosen）。不配 GA、不在线上：这张卡连这一格都不住进去。 */
export function armConsentBar(now: Lang, h: Hooks): void {
  if (hooks) return;
  hooks = h;
  if (!gaConsentApplies()) return;
  registerSlotCard({ id: ID, rank: 0, compactable: true, wanted, make, paint }, now);
  syncHomeSlot(now);
}

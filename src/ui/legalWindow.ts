/**
 * 法务文档那扇窗：标题、一句引言、一条一条的「词条 ＋ 正文」，和《游戏规则》同一个样子。
 *
 * 原先是 accountPage.ts 里的一个闭包（openLegal）。10-11 方案 A-14 把它抽出来，因为多了两件事：
 *   · 主菜单那张 Google Analytics 同意条上的链接也要开它（ui/consentBar.ts）；
 *   · **隐私政策**那一份顶上多一行「Google Analytics 统计」开关——撤回同意的那个口子（CNIL：撤回要
 *     和同意一样容易）。用的是全站现成的那颗开关（`.pill-switch`，和暂停面板里色盲那颗同一副样子）。
 *     只在这一份构建配了 GA、而且跑在线上的时候出现（gaConsentApplies）：别处 GA 从来不加载，摆一颗
 *     拨了也不起作用的开关就是假话。
 *
 * 正文照旧不转义：这几份文档从来没有 HTML（scripts/check-privacy-truth.mjs 那段「正文里不许有 **」
 * 写着为什么不开这个口子）。
 */
import { STRINGS, type Lang } from '../i18n';
import { legalDoc, type LegalKey } from '../legal';
import { pushLayer } from '../engine/backNav';
import { consentChoice } from '../engine/consent';
import { acceptAnalytics, declineAnalytics, gaConsentApplies } from '../engine/analytics';

/**
 * @param onClose 窗关上之后叫（主菜单那一路拿它把同意条重新算一遍：他在窗里拨过开关，条就该走了）。
 */
export function openLegalWindow(lang: Lang, key: LegalKey, onClose?: () => void): void {
  const s = STRINGS[lang];
  // Channel-aware: the clauses that belong to the other counter — its
  // prices, its cancellation route, the company that takes its money —
  // are not in this copy at all.
  const doc = legalDoc(lang, key);
  const ga = key === 'privacy' && gaConsentApplies();
  const overlay = document.createElement('div');
  overlay.className = 'overlay show';
  overlay.innerHTML = `
    <div class="modal rules-modal">
      <h2>${doc.title}</h2>
      ${
        ga
          ? `<div class="btn-row legal-ga">
               <button class="icon-btn pause-switch" id="gaSwitch" role="switch" aria-checked="${consentChoice() === 'granted'}">
                 <span>${s.gaSwitch}</span>
                 <span class="pill-switch" aria-hidden="true"><span class="pill-switch-knob"></span></span>
               </button>
             </div>`
          : ''
      }
      <div class="rules-body">
        <p class="legal-intro">${doc.intro}</p>
        ${doc.items.map((r) => `<div class="rule-item"><b>${r.term}</b><span>${r.body}</span></div>`).join('')}
      </div>
      <div class="btn-row"><button class="primary" id="legalClose">${s.closeBtn}</button></div>
    </div>
  `;
  document.body.appendChild(overlay);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.remove();
    onClose?.();
  };
  pushLayer(close, overlay);
  overlay.querySelector<HTMLButtonElement>('#legalClose')!.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  const sw = overlay.querySelector<HTMLButtonElement>('#gaSwitch');
  sw?.addEventListener('click', () => {
    const on = sw.getAttribute('aria-checked') !== 'true';
    // 拨到开 = 接受（当场加载）；拨到关 = 撤回（停用开关、删掉那两个 Cookie），见 engine/analytics.ts。
    if (on) acceptAnalytics();
    else declineAnalytics();
    sw.setAttribute('aria-checked', String(on));
  });
}

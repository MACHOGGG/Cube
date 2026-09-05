/**
 * 六条规则那一屏——这一版的教学。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 搬的是什么
 *
 * 网页版的教学有两层：三段可交互的分镜动画（storyTutorial，方块/小球/三角各
 * 一段，一段要玩两三分钟），和挑选页下半截那六条「一句话 + 一幅循环小动画」
 * 的规则。这一版只搬后者——玩家定的。
 *
 * 六条的文字是 i18n.ts 的 TUTORIAL_RULES，配图是 ui/ruleArt.ts 的 RULE_ART，
 * 样式是 style.css 里 .tut-rule / .ra-* 那一节。三样都原样用，一个字不抄：
 * 网页版哪天改了文案或改了那几幅动画，这一版跟着变。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 什么时候出现
 *
 *   · 第一次进游戏时自动弹一次，看过就记住，以后不再弹（localStorage）。
 *   · 局中按暂停，面板里有一颗《怎么玩》，随时能翻回来看。
 *   · 成绩与说明页上也有一颗，不在局中也能看。
 *
 * 「不要出现意料之外的界面」——所以它只在第一次自动出现那一次，之后全是玩家
 * 自己点开的。
 */
import { TUTORIAL_RULES, type Lang } from '../../src/i18n';
import { RULE_ART } from '../../src/ui/ruleArt';

/** 看过没有，记在这一格。存不进去（隐私模式）就当没看过，顶多多弹一次。 */
const SEEN_KEY = 'slides.xhs.tutorialSeen';

export function tutorialSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markTutorialSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* 存不下就算了，下次再弹一遍也不是什么大事 */
  }
}

const esc = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * 打开那一屏。返回一个关掉它的函数（换屏的时候要用——弹窗是挂在 body 上的，
 * 不跟着 #app 一起被清掉）。
 *
 * 关掉的三条路：《知道了》、点窗外、系统返回键（backNav 那一套只管 #app 里
 * 的屏，所以这里自己接一下键盘的 Esc；手机上真正管用的是前两条）。
 */
export function openTutorial(lang: Lang, onClose?: () => void): () => void {
  const rules = TUTORIAL_RULES[lang];

  const overlay = document.createElement('div');
  // 不加 opaque：这一屏多半是压在棋盘上弹出来的，半透明的遮罩才看得出
  // 「这是一层临时的窗」，不透明的会像是整个换了一屏。
  overlay.className = 'overlay xhs-tut';
  overlay.innerHTML = `
    <div class="modal xhs-tut-modal" role="dialog" aria-modal="true" aria-label="怎么玩">
      <h2>怎么玩</h2>
      <div class="tut-rules xhs-tut-rules">
        ${rules
          .map(
            (text, i) => `<div class="tut-rule">
              <span class="tut-rule-num">${i + 1}</span>
              <span class="tut-rule-art">${RULE_ART[i] ?? ''}</span>
              <span class="tut-rule-text">${esc(text)}</span>
            </div>`,
          )
          .join('')}
      </div>
      <div class="btn-row"><button class="primary" id="xhsTutOk">知道了</button></div>
    </div>
  `;

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };

  overlay.querySelector<HTMLButtonElement>('#xhsTutOk')?.addEventListener('click', close);
  // 点窗外也关：和这一版别处的弹窗一个规矩（网页版「弹窗外点击一律返回」）。
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);

  document.body.appendChild(overlay);
  // 加一帧再点亮，让入场那段过渡跑得起来（.overlay 的显隐靠 .show）。
  requestAnimationFrame(() => overlay.classList.add('show'));
  return close;
}

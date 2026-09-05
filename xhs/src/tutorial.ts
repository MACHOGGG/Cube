/**
 * 这一版的教学分两层，这个文件管第二层，外加两层各自「看过没有」的记账。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 第一层：分镜动画，没有一个字
 *
 * 第一次点开《经典方块》放方块那一段，第一次点开《经典小球》放小球那一段，
 * 各放一次，看过就记住。用的是网页版那两个原件（src/ui/tutorial.ts 与
 * src/ui/circleTutorial.ts），速度、下面那四颗键全是它们自带的，这一版不加不
 * 减不改。挂它的地方在 main.ts 的 showShapeStory。
 *
 * 炸弹、老虎机、无限反转不放——判断条件和网页版一字不差，见 storyFamilyFor。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 第二层：六条规则，有字有配图
 *
 * 就是这个文件画的那一屏。它**不会自己跳出来**，只有两个入口，都得玩家自己按：
 *
 *   · 成绩与说明页上一颗《怎么玩》（profile.ts）
 *   · 局中按暂停，面板里一颗《怎么玩》（main.ts 的 enhancePauseTutorial）
 *
 * 玩家定的分工：前面先看一段纯动画；还有疑问的人，自己到这两处来看字。
 *
 * 六条的文字是 i18n.ts 的 TUTORIAL_RULES，配图是 ui/ruleArt.ts 的 RULE_ART，
 * 样式是 style.css 里 .tut-rule / .ra-* 那一节。三样都原样用，一个字不抄：
 * 网页版哪天改了文案或改了那几幅动画，这一版跟着变。
 */
import { TUTORIAL_RULES, type Lang } from '../../src/i18n';
import { RULE_ART } from '../../src/ui/ruleArt';

/** 会放分镜动画的两族。三角整块不做，所以只有这两个。 */
export type StoryFamily = 'square' | 'circle';

/**
 * 哪一族的分镜动画看过了，各记一格。
 *
 * 键名带 `slides.xhs.` 前缀，和网页版那三个（slides_tutorial_seen…）分开：玩家
 * 的第一条要求是「分开保存，与网页端、微信端完全分离」。真机上本来就是两个
 * 域、两份存档，但在同一个浏览器里看预览页时这条前缀是唯一的隔离。
 *
 * 存不进去（隐私模式、容器把 localStorage 关了）就当没看过——顶多多放一遍，
 * 不会出错。
 */
const STORY_KEY: Record<StoryFamily, string> = {
  square: 'slides.xhs.story.square',
  circle: 'slides.xhs.story.circle',
};

export function storySeen(fam: StoryFamily): boolean {
  try {
    return localStorage.getItem(STORY_KEY[fam]) === '1';
  } catch {
    return false;
  }
}

export function markStorySeen(fam: StoryFamily): void {
  try {
    localStorage.setItem(STORY_KEY[fam], '1');
  } catch {
    /* 存不下就算了，下次再放一遍也不是什么大事 */
  }
}

const esc = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * 打开那一屏。返回一个关掉它的函数（换屏的时候要用——弹窗是挂在 body 上的，
 * 不跟着 #app 一起被清掉）。
 *
 * 只有玩家自己按了才会走到这儿——这一屏不自动跳出来。
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

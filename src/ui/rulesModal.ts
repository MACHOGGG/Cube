/**
 * 《怎么玩》那一屏：六条规则 + 底下两条玩法附注。
 *
 * 一份稿子，两处用：局中按《暂停》、面板里那一颗《怎么玩》（gameShell），和
 * 小红书版成绩与说明页上的同名那一颗（xhs/src/tutorial.ts）。玩家的原话是
 * 「网页端的《怎么玩》同步小红书的版本」——所以这一屏是从小红书那边搬过来
 * 的，不是各写一份：哪天文案改了、配图改了，两处一起变。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 里面有什么
 *
 *   六条规则   文字是 i18n.ts 的 TUTORIAL_RULES，配图是 ruleArt.ts 的
 *              buildRuleArt()——和个人主页那张教学挑选页同一份。
 *   一道黑线   分档用的。上面六条是「这个游戏怎么玩」，人人都要看。
 *   两条附注   炸弹和无限反转各自多的那一层（MODE_TIPS）。它们本来只在头一
 *              回进那个玩法时在棋盘底下摆一局，之后想再看一眼就没地方了。
 *
 * 唯一的分歧是三角：网页版有三角玩法，第 1 幅配图就要三列；小红书版整块没有
 * 三角，讲一个玩家在那儿见不到的图形只会让人以为自己漏了什么。这件事按整包
 * 记一次（setRulesTriangle），不是每次打开都判一遍。
 *
 * 这一屏**不会自己跳出来**，只有玩家自己按了才走到这儿。
 */
import { MODE_TIPS, STRINGS, TUTORIAL_RULES, type Lang } from '../i18n';
import { bombTipArt, buildRuleArt, flipTipArt } from './ruleArt';
import { menuTag } from './menuTags';
import { shapeName } from './shapeLabels';
import { ICON_BASE_CIRCLE, ICON_BASE_SQUARE } from './homeIcons';

/** 会放分镜动画的两族。三角那一段不摆在这一屏上（它有自己的入口）。 */
export type StoryFamily = 'square' | 'circle';

/**
 * 这一版有没有三角玩法。
 *
 * 是个「整包只有一个答案」的事实，不是某一次打开这一屏时的选择——所以摆成一
 * 个开机时喊一声的开关，而不是从八个形状模块一路往下传的参数。网页版有三
 * 角，默认就是 true；小红书版在 main.ts 里喊一声关掉。
 */
let hasTriangle = true;
export function setRulesTriangle(v: boolean): void {
  hasTriangle = v;
}

/** 配图一族画一次就够了，两处轮流开关这一屏不必每次重画。 */
const ART_CACHE = new Map<boolean, string[]>();
function ruleArt(triangle: boolean): string[] {
  let art = ART_CACHE.get(triangle);
  if (!art) {
    art = buildRuleArt({ triangle });
    ART_CACHE.set(triangle, art);
  }
  return art;
}

/**
 * 最下面那两条：炸弹和无限反转。
 *
 * 老虎机没有——它那句提示的配图是当局现抽的那两个得分图案，离开那一局就无从
 * 画起。
 */
const EXTRA_TIPS: readonly { key: 'bomb' | 'flip'; art: string }[] = [
  { key: 'bomb', art: bombTipArt('square') },
  { key: 'flip', art: flipTipArt('square') },
];

const esc = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface RulesModalOptions {
  lang: Lang;
  /**
   * 这一版有没有三角玩法。不给就按整包那一个答案来（见 setRulesTriangle）
   * ——绝大多数调用方都不该关心这件事。
   */
  triangle?: boolean;
  /** 关掉之后回哪儿。 */
  onClose?: () => void;
  /**
   * 给了就在六条上头摆两颗键（方块 / 小球），按下去放那一族的分镜动画。
   *
   * 只有从个人主页 / 成绩页进来的那个入口会给——分镜不再自己弹出来（玩家
   * 定的），想看的人从那儿自己点。局中按暂停开的这一屏不给：他正在玩，不该
   * 在这儿被一段动画接走。
   */
  onStory?: (fam: StoryFamily) => void;
}

/**
 * 打开那一屏。返回一个关掉它的函数——弹窗挂在 body 上，不跟着 #app 一起被清
 * 掉，换屏的时候得自己收。
 *
 * 关掉的三条路：《知道了》、点窗外、Esc（手机上管用的是前两条；系统返回键由
 * 各端自己那套 backNav 接）。
 */
export function openRulesModal(opts: RulesModalOptions): () => void {
  const { lang, onClose, onStory } = opts;
  const triangle = opts.triangle ?? hasTriangle;
  const s = STRINGS[lang];
  const rules = TUTORIAL_RULES[lang];
  const art = ruleArt(triangle);
  // 两颗分镜键上的字。图本身带着 Illustrator 留下的 <title>编组</title>，光靠
  // 里面的文字读出来会是「编组方块」——所以名字自己写一遍，图那半边设成
  // aria-hidden。
  const sq = shapeName(lang, 'square', '方块');
  const ci = shapeName(lang, 'circle', '小球');

  const overlay = document.createElement('div');
  // 不加 opaque：这一屏多半是压在棋盘上弹出来的，半透明的遮罩才看得出「这是
  // 一层临时的窗」，不透明的会像是整个换了一屏。
  overlay.className = 'overlay howto-ov';
  overlay.innerHTML = `
    <div class="modal howto-modal" role="dialog" aria-modal="true" aria-label="${esc(s.howToPlayBtn)}">
      <h2>${esc(s.howToPlayBtn)}</h2>
      ${
        onStory
          ? `<div class="howto-stories">
               <button class="howto-story" type="button" data-fam="square" aria-label="${esc(
                 sq,
               )}">${ICON_BASE_SQUARE}<span aria-hidden="true">${esc(sq)}</span></button>
               <button class="howto-story" type="button" data-fam="circle" aria-label="${esc(
                 ci,
               )}">${ICON_BASE_CIRCLE}<span aria-hidden="true">${esc(ci)}</span></button>
             </div>`
          : ''
      }
      <div class="tut-rules howto-list">
        ${rules
          .map(
            (text, i) => `<div class="tut-rule">
              <span class="tut-rule-num">${i + 1}</span>
              <span class="tut-rule-art">${art[i] ?? ''}</span>
              <span class="tut-rule-text">${esc(text)}</span>
            </div>`,
          )
          .join('')}
        <div class="howto-split" aria-hidden="true"></div>
        ${EXTRA_TIPS.map(
          ({ key, art: tip }) => `<div class="tut-rule tut-rule--extra">
              <span class="tut-rule-num tut-rule-num--word">${esc(menuTag(lang, key))}</span>
              <span class="tut-rule-art">${tip}</span>
              <span class="tut-rule-text">${esc(MODE_TIPS[lang][key])}</span>
            </div>`,
        ).join('')}
      </div>
      <div class="btn-row"><button class="primary" id="howtoOkBtn">${esc(s.gotItBtn)}</button></div>
    </div>
  `;

  let closed = false;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  function drop(): void {
    closed = true;
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  }
  function close(): void {
    if (closed) return;
    drop();
    onClose?.();
  }

  overlay.querySelector<HTMLButtonElement>('#howtoOkBtn')?.addEventListener('click', close);
  // 两颗分镜键：先关掉这一屏再放，不然动画会盖在这层遮罩底下。走的是 drop
  // 不是 close——接下来去哪儿由 onStory 说了算，不该再回一次 onClose。
  for (const b of Array.from(overlay.querySelectorAll<HTMLButtonElement>('.howto-story'))) {
    b.addEventListener('click', () => {
      if (closed) return;
      const fam: StoryFamily = b.getAttribute('data-fam') === 'circle' ? 'circle' : 'square';
      drop();
      onStory?.(fam);
    });
  }
  // 点窗外也关：和全站别处的弹窗一个规矩（「弹窗外点击一律返回」）。
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);

  document.body.appendChild(overlay);
  // 加一帧再点亮，让入场那段过渡跑得起来（.overlay 的显隐靠 .show）。
  requestAnimationFrame(() => overlay.classList.add('show'));
  return close;
}

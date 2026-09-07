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
 *   几条附注   这一局在基础规矩之外多的那一层（MODE_TIPS）——炸弹、无限反转、
 *              老虎机、计时、特殊布局，一个玩法一条。它们本来只在头一回进那
 *              个玩法时在棋盘底下摆一局，之后想再看一眼就没地方了。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 开在局中的时候，它认得出自己在哪一局
 *
 * 玩家的原话：「在每个游戏界面里的暂停里的怎么玩？教学中 都是针对这个玩法的
 * 内容。现在在基础玩法里的教学会带有特殊玩法的规则。」——所以 shape 和 tips
 * 这两个参数一给，这一屏就只讲当局的事：第 4 条换成这一族自己那一句，底下的
 * 附注只留当局那一条（基础局一条都没有，那道黑线也跟着不画）。两个都不给才
 * 是通稿，那是玩家还没挑玩法时的入口（小红书的信息页）。
 *
 * 还有一层：无限反转局用 omitRules 把第 4、5 条整条抽掉——那两条讲的事在那一
 * 局根本不会发生。
 *
 * 唯一的分歧是三角：网页版有三角玩法，第 1 幅配图就要三列；小红书版整块没有
 * 三角，讲一个玩家在那儿见不到的图形只会让人以为自己漏了什么。这件事按整包
 * 记一次（setRulesTriangle），不是每次打开都判一遍。
 *
 * 这一屏**不会自己跳出来**，只有玩家自己按了才走到这儿。
 */
import { MODE_TIPS, STRINGS, TUTORIAL_RULES, tutorialRules, type Lang, type RuleShape } from '../i18n';
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
const ART_CACHE = new Map<string, string[]>();
function ruleArt(triangle: boolean, shape?: RuleShape): string[] {
  const key = `${triangle}|${shape ?? ''}`;
  let art = ART_CACHE.get(key);
  if (!art) {
    // buildRuleArt 只认得方块和小球两套画法（三角没有自己的一套，用通稿那套）。
    art = buildRuleArt({ triangle, shape: shape === 'circle' ? 'circle' : undefined });
    ART_CACHE.set(key, art);
  }
  return art;
}

/**
 * 底下那几条附注，一个玩法一条。文案在 i18n 的 MODE_TIPS，和头一回进那个玩法
 * 时棋盘底下摆的那一句是同一份。
 *
 * 炸弹和无限反转有固定的配图；老虎机那一幅是当局现抽的两个得分图案（离开那
 * 一局就无从画起，所以由调用方随 art 传进来）；计时和特殊布局本来就没有配图
 * ——计时要说的是头上那个数字，他抬头看得见；特殊布局要说的是「这副棋盘和你
 * 学过的那副规矩一样」，另画一幅新棋盘反倒像在说「这里有新东西」。
 */
export type ExtraTip = 'bomb' | 'flip' | 'slot' | 'timed' | 'layout';
const TIP_ART: Record<ExtraTip, string> = {
  bomb: bombTipArt('square'),
  flip: flipTipArt('square'),
  slot: '',
  timed: '',
  layout: '',
};

/** 摆一条附注要知道的三件事。key 之外两样都可不给，见下面各自的注。 */
export interface ExtraTipView {
  /** 哪一条：决定那句话（MODE_TIPS）和默认配图。 */
  key: ExtraTip;
  /**
   * 左边那个词。不给就用这个玩法在主菜单上的小字（menuTag）。
   *
   * 'layout' 没有自己的那张卡——它说的是「这一副棋盘」，所以那个词该是这副棋
   * 盘自己的名字（菱形方块、六边形小球……），由局中那一方传进来。
   */
  label?: string;
  /** 配图。不给就用这一条的固定配图（老虎机要传当局那两个图案）。 */
  art?: string;
}

/** 没有「当局」可言的那个入口摆哪几条：只有这两条不依赖当局的任何东西。 */
const ALL_TIPS: readonly ExtraTipView[] = [{ key: 'bomb' }, { key: 'flip' }];

const esc = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface RulesModalOptions {
  lang: Lang;
  /**
   * 这一版有没有三角玩法。不给就按整包那一个答案来（见 setRulesTriangle）
   * ——绝大多数调用方都不该关心这件事。
   */
  triangle?: boolean;
  /**
   * 正在打的是哪一族棋盘。给了就把第 4 条换成这一族自己那一句（小球留空球、
   * 方块拿走不再出现、三角留空三角），配图也跟着换成这一族的画法。
   *
   * 不给 = 玩家还没挑玩法（小红书那个信息页的入口），那时候讲通稿——两边都得
   * 说，因为他等下可能去玩任何一个。
   */
  shape?: RuleShape;
  /**
   * 底下那几条附注里，这一次要摆哪几条。
   *
   * 玩家的原话：「在每个游戏界面里的暂停里的怎么玩？教学中 都是针对这个玩法
   * 的内容……现在在基础玩法里的教学会带有特殊玩法的规则」。所以局中开的这一
   * 屏只摆当局那一条：基础局一条都没有（连那道分档的黑线也不画），炸弹局只有
   * 炸弹，无限反转局只有无限反转。
   *
   * 不给 = 摆齐（没有当局可言的那个入口）。给空数组就是一条都不摆。
   */
  tips?: readonly ExtraTipView[];
  /**
   * 这一局不讲哪几条（按玩家看见的编号，从 1 数起）。
   *
   * 无限反转局给的是 [4, 5]：那一局星星同色不消除（第 4 条讲的事不会发生），
   * 也不会「全部翻成星星就结束」（第 5 条同理——正反面一直来回翻，60 秒到了才
   * 结束）。讲一条这一局根本不会发生的规矩，比不讲更糟：玩家会照着去凑，凑
   * 出来什么也没发生，然后以为是坏了。玩家 2026-09 定的。
   *
   * 剩下的几条重新从 1 编号——他看见的是 1234，不是 1236。
   */
  omitRules?: readonly number[];
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
  const { lang, onClose, onStory, shape } = opts;
  const triangle = opts.triangle ?? hasTriangle;
  const tips = opts.tips ?? ALL_TIPS;
  const s = STRINGS[lang];
  const art = ruleArt(triangle, shape);
  const omit = new Set(opts.omitRules ?? []);
  // 先配好图再筛：配图是按**原来的**条号排的（第 3 条那幅画的就是第 3 条的
  // 事），筛完再按下标去取就会错位。
  const rules = (shape ? tutorialRules(lang, shape) : TUTORIAL_RULES[lang])
    .map((text, i) => ({ text, art: art[i] ?? '' }))
    .filter((_, i) => !omit.has(i + 1));
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
            (r, i) => `<div class="tut-rule">
              <span class="tut-rule-num">${i + 1}</span>
              <span class="tut-rule-art">${r.art}</span>
              <span class="tut-rule-text">${esc(r.text)}</span>
            </div>`,
          )
          .join('')}
        ${tips.length ? '<div class="howto-split" aria-hidden="true"></div>' : ''}
        ${tips
          .map((t) => {
            // 没有配图的那几条（计时、特殊布局）连这块 span 也不画——它是定死
            // 5.2em 宽的，空着就是一句话左边挂着一大块白。
            const a = t.art ?? TIP_ART[t.key];
            return `<div class="tut-rule tut-rule--extra">
              <span class="tut-rule-num tut-rule-num--word">${esc(t.label ?? menuTag(lang, t.key))}</span>
              ${a ? `<span class="tut-rule-art">${a}</span>` : ''}
              <span class="tut-rule-text">${esc(MODE_TIPS[lang][t.key])}</span>
            </div>`;
          })
          .join('')}
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

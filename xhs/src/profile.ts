/**
 * 这一版唯一的第二屏：上面是成绩，下面是这个小工具的说明。
 *
 * 网页版那儿是两屏——《记录与排名》和《个人主页》，底排两颗键各进一个。这
 * 一版把它们并成一屏、底排只留一颗（玩家定的：「这两个可以合成一个页面……
 * 上面是成绩栏，下面是解释信息」）。并得起来是因为拿掉排行榜、登录、订阅、
 * 语言、图示之后，两屏各自都只剩一块内容了。
 *
 * 成绩那一块「和现在的成绩记录栏一样内容和制作」：类名全是网页版现成的
 * （.total-card / .records-panel / .records-row / .records-rule），样式一条
 * 都不用新写，两边看着是同一件东西。
 *
 * 数据也走网页版那一份存档：loadAllRuns 读的是每个玩法的 bestKey，
 * totalScoreOf 把它们加起来。上一版这里自己抄了一份键名清单，抄错了两处
 * （小球的键是 sugarcube_circles_best 不是 circle_best；分数在
 * data.totalScore 不在 data.score），于是小球的记录一条都读不出来、读出来
 * 的分也全是 0。现在键名直接问玩法自己要（card.bestKey），错不了。
 */
import { loadAllRuns, totalScoreOf, type StoredRun } from '../../src/engine/persistence';
import { formatRunTime, modeLabel } from '../../src/engine/runRecord';
import { colorblindOn, setColorblind } from '../../src/engine/palettePref';
import { shapeName } from '../../src/ui/shapeLabels';
import { openCenterPicker } from '../../src/ui/centerPicker';
import { STRINGS, type Lang } from '../../src/i18n';
import { xhsBottomNav } from './menu';
import type { ShapeCardMeta } from '../../src/shapes/types';

/** 一个「玩法 + 模式」，也就是一本存档。 */
export interface Book {
  card: ShapeCardMeta;
  /** 接在 bestKey 后面的后缀：'' 基础、'_bomb' 炸弹、'_flip' 无限反转。 */
  suffix: string;
}

export interface ProfileHandlers {
  onBack: () => void;
  /** 点开某一局，去看那一张战绩图（runSheet.ts）。 */
  onOpenRun: (run: StoredRun) => void;
  /** 打开那六条规则（tutorial.ts）。第一次进游戏会自动弹一次，这儿是随时重看的入口。 */
  onHowToPlay: () => void;
}

/**
 * 这一块摆几行。
 *
 * 两个意思，网页版（ui/recordsPage.ts）也是同一个数：空着的时候画几条横线
 * （「等着记录」比一块空白好看），有记录的时候只摆最近这么多场——剩下的点开
 * 那一层慢慢滑。从前这儿是一股脑全摆出来：打过三十局的人，中间那段介绍被顶
 * 到了很下面，得一直滑才看得到。
 */
const PLACEHOLDER_ROWS = 5;

// 这一页从前在介绍段落末尾摆着「详情请访问」加一行 play-slides.com。2026-09
// 玩家把它去掉了：那一行做不成链接（规范不让小工具把人带出容器，见
// check-submit.mjs 的禁用能力表），摆在这儿只是一串要人手抄的字母——完整版
// 值不值得去，前面那两句已经说清了。

const esc = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * 点开那一层的时候，把底排那颗橙色的键收起来。
 *
 * 那一层底下自己站着一颗《返回》圆盘（centerPicker 的 `back`），站的正是底排
 * 那一行。网页版靠一条 CSS 让位：`body:has(.center-pick--back) .home-nav`。可
 * **Chrome 61 不认得 :has()**，整条选择器会被丢掉（这一版跑的就是它，见
 * xhs/check-oldcss.mjs），于是圆盘和那颗键叠在一起。
 *
 * 所以照这个仓库对付老内核的老规矩：状态由 TS 写成 <body> 上的一个类，样式
 * 只认类（pages.css 里的 .xhs-modal）。关窗的路不止一条（圆盘、点外面、手机
 * 返回键、Esc），所以不在自己那一次 close 里摘这个类，而是盯着那一层还在不
 * 在——谁关的都算。
 */
function keepNavClear(): void {
  document.body.classList.add('xhs-modal');
  const ob = new MutationObserver(() => {
    if (document.querySelector('.center-pick')) return;
    document.body.classList.remove('xhs-modal');
    ob.disconnect();
  });
  ob.observe(document.body, { childList: true });
}

/**
 * 一条记录：左边玩法小图形 + 名字 + 模式 + 时间，右边分数。
 *
 * 它是一颗按钮，不是一行字——点开能看那一局的战绩图。网页版也是这样
 * （.records-row 本来就带着 cursor: pointer 和按下去缩一下的动效），这一版
 * 之前漏掉了监听，看着像能点、按下去没反应。
 */
function runRow(
  run: StoredRun,
  glyphOf: Map<string, string>,
  lang: Lang,
  onOpen: (run: StoredRun) => void,
): HTMLElement {
  const d = run.data;
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'records-row';
  const name = shapeName(lang, d.shapeId, d.shapeFallback);
  const mode = modeLabel(d.modeKey, lang);
  row.innerHTML =
    `<span class="records-row-glyph">${glyphOf.get(d.shapeId) ?? ''}</span>` +
    `<span class="records-row-name">${esc(name)}` +
    (mode ? `<span class="records-row-mode"> ${esc(mode)}</span>` : '') +
    `<span class="records-row-time">${formatRunTime(run.at)}</span></span>` +
    `<span class="records-row-score">${d.totalScore}</span>`;
  // 整块面板自己也能点（点开看全部），所以一行被点到的时候要把这一下拦下来
  // ——玩家点的是这一局，不是「展开」。网页版的 .records-row 也是这么做的。
  row.addEventListener('click', (e) => {
    e.stopPropagation();
    onOpen(run);
  });
  return row;
}

/**
 * 色盲友好开关。
 *
 * 网页版把它放在个人主页，是一个全站设置：按下去在 <html> 上盖一个
 * data-cvd="1"，样式表和每一块棋盘都跟着走（见 engine/palettePref.ts）。这
 * 一版没有个人主页，所以挪到成绩页、紧挨着累计得分。
 *
 * 只有开和关，不给配色选择——玩家定的：用最经典那一套（palettePref 里的
 * 'std'，Okabe–Ito 那八色），不提供选择。所以这里只调 setColorblind，从不
 * 碰 setCvdVariant，变体永远停在默认的 std。
 *
 * 按键、开关的样子全用网页版现成的类（.profile-pill--switch / .pill-switch），
 * 两边是同一个控件。
 */
/**
 * 《怎么玩》——和色盲开关并排。
 *
 * 这一页是「成绩 + 说明」，规则本来就该在这儿有个入口：这一屏不会自己跳出来，
 * 想看的人得有地方点。局中的那个入口在暂停面板里，现在由游戏外壳自带
 * （src/ui/gameShell.ts 的 #howBtn，开的是同一屏 ui/rulesModal.ts）。
 */
function howToPlayPill(onClick: () => void): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'profile-pill xhs-how';
  btn.textContent = '怎么玩';
  btn.addEventListener('click', onClick);
  return btn;
}

function cvdSwitch(lang: Lang): HTMLElement {
  const s = STRINGS[lang];
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'profile-pill profile-pill--switch xhs-cvd';
  btn.setAttribute('role', 'switch');
  btn.setAttribute('aria-checked', String(colorblindOn()));
  btn.innerHTML =
    `<span>${esc(s.colorblindBtn)}</span>` +
    `<span class="pill-switch" aria-hidden="true"><span class="pill-switch-knob"></span></span>`;
  btn.addEventListener('click', () => {
    const next = !colorblindOn();
    setColorblind(next);
    btn.setAttribute('aria-checked', String(next));
  });
  return btn;
}

export function renderProfilePage(
  root: HTMLElement,
  books: readonly Book[],
  lang: Lang,
  h: ProfileHandlers,
): void {
  const s = STRINGS[lang];
  let runs: StoredRun[] = [];
  try {
    runs = loadAllRuns(books.map((b) => b.card.bestKey + b.suffix));
  } catch {
    // localStorage 在小工具里可用但不保证永久（规范 device-capabilities.md
    // §1），读不到就当还没打过，不报错、不挡路。
    runs = [];
  }
  const total = totalScoreOf(runs);
  const glyphOf = new Map(books.map((b) => [b.card.id, b.card.glyph]));

  const page = document.createElement('div');
  page.className = 'app records-page xhs-profile';
  page.innerHTML = `
    <header class="home-head">
      <div class="home-head-glass">
        <h1 class="home-title">Slides</h1>
        <p class="home-sub tag-line">${esc(s.homeTagline)}</p>
      </div>
    </header>

    <div class="total-card xhs-total">
      <span class="total-card-title">${esc(s.totalScoreTitle)}</span>
      <span class="total-card-value">${total}</span>
    </div>

    <div class="xhs-setting-row" id="xhsSettings"></div>

    <button class="records-panel records-panel--records" id="xhsRuns" aria-label="${esc(s.navRecords)}"></button>

    <div class="records-panel xhs-about">
      <p class="xhs-about-line">这里是 Slides 的小红书版，开放五个单机玩法。</p>
      <p class="xhs-about-line">Slides 是一款原创的滑动补偿拼图游戏。滑动、得分、消除，一步步解开它。它上手极其简单，可是想要取得高分却不容易，考验玩家的高智商，需要在最少的行动、最短的时间里得到最多的分数。</p>
      <p class="xhs-about-line">完整版有多人小屋在线对战、Slides 天才特供玩法、全球排行榜、计时挑战、以及更多玩法和布局供你挑战！</p>
      <p class="xhs-about-line">后续可能推出 APP 版，敬请期待。</p>
    </div>

  `;

  const settings = page.querySelector<HTMLElement>('#xhsSettings')!;
  settings.appendChild(cvdSwitch(lang));
  settings.appendChild(howToPlayPill(h.onHowToPlay));

  /**
   * 把记录摆进一块面板里。`limit` 给 null 就是全摆（点开那一层用的）。
   *
   * 摆不满的时候补横线补到 PLACEHOLDER_ROWS 条，一块面板于是永远是同一个高
   * 度——打过两局和打过五局，这一页不会一高一矮。
   */
  function fillRuns(host: HTMLElement, limit: number | null, onOpen: (run: StoredRun) => void): void {
    host.innerHTML = '';
    const shown = limit === null ? runs : runs.slice(0, limit);
    if (!shown.length) {
      for (let i = 0; i < PLACEHOLDER_ROWS; i++) {
        const rule = document.createElement('div');
        rule.className = 'records-rule';
        host.appendChild(rule);
      }
      const note = document.createElement('p');
      note.className = 'records-locked';
      note.textContent = s.noRecordsYet;
      host.appendChild(note);
      return;
    }
    for (const run of shown) host.appendChild(runRow(run, glyphOf, lang, onOpen));
    for (let i = shown.length; i < PLACEHOLDER_ROWS; i++) {
      const rule = document.createElement('div');
      rule.className = 'records-rule';
      host.appendChild(rule);
    }
  }

  const list = page.querySelector<HTMLElement>('#xhsRuns')!;
  fillRuns(list, PLACEHOLDER_ROWS, h.onOpenRun);
  // 点这一块（行与行之间、面板本身）就把它整个放大到屏幕中间，里头是全部的
  // 记录，可以一直滑——和网页版《记录与排名》那一块是同一个动作、同一个窗
  // （ui/centerPicker.ts）。
  list.addEventListener('click', () => {
    const big = document.createElement('div');
    big.className = 'records-panel records-panel--records records-panel--big';
    let close = () => {};
    fillRuns(big, null, (run) => {
      // 那一层是挂在 <body> 上的，不跟着 #app 一起被换掉——不先关掉，战绩图
      // 就会被它整个盖住。
      close();
      h.onOpenRun(run);
    });
    keepNavClear();
    close = openCenterPicker({
      originEl: list,
      title: s.navRecords,
      panel: big,
      panelClass: 'records-panel--big',
      back: s.back,
    });
  });

  // 底下那颗橙色的键：和主菜单上的是同一颗，位置也是同一个（.home-nav 是
  // position:fixed，所以这一页怎么上下滑它都不动）。现在它是「亮着的」那一
  // 颗——再按一下就回主菜单。
  page.appendChild(xhsBottomNav(h.onBack, true));
  root.appendChild(page);
}

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
 * 都不用新写，两边看着是同一件东西。差别只在排行榜那半块换成了说明——网页
 * 版是琥珀 + 蓝紫两块并排，这一版是琥珀在上、蓝紫在下。
 *
 * 数据也走网页版那一份存档：loadAllRuns 读的是每个玩法的 bestKey，
 * totalScoreOf 把它们加起来。上一版这里自己抄了一份键名清单，抄错了两处
 * （小球的键是 sugarcube_circles_best 不是 circle_best；分数在
 * data.totalScore 不在 data.score），于是小球的记录一条都读不出来、读出来
 * 的分也全是 0。现在键名直接问玩法自己要（card.bestKey），错不了。
 */
import { loadAllRuns, totalScoreOf, type StoredRun } from '../../src/engine/persistence';
import { formatRunTime, modeLabel } from '../../src/engine/runRecord';
import { shapeName } from '../../src/ui/shapeLabels';
import { CTL_BACK } from '../../src/ui/ctlIcons';
import { STRINGS, type Lang } from '../../src/i18n';
import type { ShapeCardMeta } from '../../src/shapes/types';

/** 一个「玩法 + 模式」，也就是一本存档。 */
export interface Book {
  card: ShapeCardMeta;
  /** 接在 bestKey 后面的后缀：'' 基础、'_bomb' 炸弹、'_flip' 无限反转。 */
  suffix: string;
}

export interface ProfileHandlers {
  onBack: () => void;
}

/** 空着的时候画几条横线，和网页版一样——「等着记录」比一块空白好看。 */
const PLACEHOLDER_ROWS = 5;

/** 完整版在哪儿。小工具里不能开外链，所以它只是一行字，不是链接。 */
const SITE = 'play-slides.com';

const esc = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 一条记录：左边玩法小图形 + 名字 + 模式 + 时间，右边分数。 */
function runRow(run: StoredRun, glyphOf: Map<string, string>, lang: Lang): HTMLElement {
  const d = run.data;
  const row = document.createElement('div');
  row.className = 'records-row';
  const name = shapeName(lang, d.shapeId, d.shapeFallback);
  const mode = modeLabel(d.modeKey, lang);
  row.innerHTML =
    `<span class="records-row-glyph">${glyphOf.get(d.shapeId) ?? ''}</span>` +
    `<span class="records-row-name">${esc(name)}` +
    (mode ? `<span class="records-row-mode"> ${esc(mode)}</span>` : '') +
    `<span class="records-row-time">${formatRunTime(run.at)}</span></span>` +
    `<span class="records-row-score">${d.totalScore}</span>`;
  return row;
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

    <div class="records-panel records-panel--records" id="xhsRuns"></div>

    <div class="records-panel records-panel--ranks xhs-about">
      <p class="xhs-about-line">这里是 Slides 的小红书版，五个玩法，全部免费。</p>
      <p class="xhs-about-line">完整版有更多布局、计时挑战、多人小屋和全球排行榜：</p>
      <p class="xhs-about-site">${SITE}</p>
      <p class="xhs-about-line">后续可能推出 APP 版。</p>
    </div>

    <div class="page-back-row">
      <button class="icon-btn page-back" id="xhsProfileBack" aria-label="${esc(s.back)}">${CTL_BACK}</button>
    </div>
  `;

  const list = page.querySelector<HTMLElement>('#xhsRuns')!;
  if (runs.length) {
    for (const run of runs) list.appendChild(runRow(run, glyphOf, lang));
  } else {
    for (let i = 0; i < PLACEHOLDER_ROWS; i++) {
      const rule = document.createElement('div');
      rule.className = 'records-rule';
      list.appendChild(rule);
    }
    const note = document.createElement('p');
    note.className = 'records-locked';
    note.textContent = s.noRecordsYet;
    list.appendChild(note);
  }

  page.querySelector<HTMLButtonElement>('#xhsProfileBack')!.addEventListener('click', h.onBack);
  root.appendChild(page);
}

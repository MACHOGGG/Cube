import { STRINGS, type Lang } from '../i18n';
import { fetchBoard, type BoardPage, type BoardResult } from '../engine/cloudScores';
import { shapeName } from './shapeLabels';
import { gameIcon } from './homeIcons';

/**
 * 全球排行榜的那一块。
 *
 * 两张榜，玩家自己定的：一张累计总榜，八个玩法各一张单局最佳榜。上榜不要钱
 * ——一个新玩家打出好成绩，那一行本来就该在榜上；看得见才是天才特权。所以
 * 「有没有权限」这件事永远由服务器说了算（api/scores.js），这里只负责把
 * 三种答复各自画成一屏：拿到了、没权限、还没登录。
 *
 * 没权限的那一屏不是一句「敬请期待」。它照样把这张榜长什么样子摆出来——只是
 * 名字和分数是虚的，中间压着一把锁和一句《成为 Slides 天才》。和《解锁更多
 * 配色》同一个道理：看得见才知道值不值得。
 */

const esc = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 锁住时垫在底下的那几行假名次。长短不一，才像一张真的榜。 */
const GHOST_ROWS = 8;

export interface BoardTab {
  /** 空字符串是总榜。 */
  mode: string;
  label: string;
}

/** 总榜 + 每个玩法一张。玩法的顺序就是主菜单的顺序。 */
export function boardTabs(lang: Lang, shapeIds: readonly string[]): BoardTab[] {
  const s = STRINGS[lang];
  return [
    { mode: '', label: s.rankTotalBoard },
    ...shapeIds.map((id) => ({ mode: id, label: shapeName(lang, id, id) })),
  ];
}

/** 一张榜画成的行。自己那一行会被标出来。 */
function rowsHtml(page: BoardPage, lang: Lang): string {
  const s = STRINGS[lang];
  if (!page.rows.length) return `<p class="rank-empty">${s.rankEmpty}</p>`;
  // 总榜不分玩法，每一行是那个人最高的那一局——行首画一个小图形，说明那一局
  // 是哪个玩法（玩家的原话：「在前面有小图形标识」）。单局榜整张都是同一个
  // 玩法，不用画。
  return page.rows
    .map(
      (r) => `<div class="rank-row${r.me ? ' rank-row--me' : ''}">
        <span class="rank-place">${r.rank}</span>
        ${r.mode ? `<span class="rank-glyph" aria-label="${esc(shapeName(lang, r.mode, r.mode))}">${gameIcon(r.mode)}</span>` : ''}
        <span class="rank-name">${esc(r.name)}</span>
        <span class="rank-score">${r.score}</span>
      </div>`,
    )
    .join('');
}

/**
 * 锁着的那一屏。
 *
 * 假名次是灰条不是数字：写上具体的名字和分数就是在骗人，而空着又什么都没
 * 说明。灰条正好说清「这里是一张榜」，不多说一个字。
 */
function lockedHtml(lang: Lang): string {
  const s = STRINGS[lang];
  const ghosts = Array.from(
    { length: GHOST_ROWS },
    (_, i) => `<div class="rank-row rank-row--ghost">
      <span class="rank-place">${i + 1}</span>
      <span class="rank-ghost-bar" style="width:${40 + ((i * 37) % 45)}%"></span>
    </div>`,
  ).join('');
  return `<div class="rank-locked-wrap">
    ${ghosts}
    <div class="rank-lock">
      <p class="rank-lock-line">${s.rankLocked}</p>
      <button class="genius-cta" id="rankGeniusCta">${s.rankLockedCta}</button>
    </div>
  </div>`;
}

/**
 * 登录旧了的那一屏。
 *
 * 和锁着那一屏长得像，说的却是另一件事，所以话和按钮都得换：这个人已经付过
 * 钱了，缺的只是在这台设备上重新登录一次。上线之后榜一直空着就是栽在这儿
 * ——服务器一路回 401，界面一句话都没说。
 */
function expiredHtml(lang: Lang): string {
  const s = STRINGS[lang];
  const ghosts = Array.from(
    { length: GHOST_ROWS },
    (_, i) => `<div class="rank-row rank-row--ghost">
      <span class="rank-place">${i + 1}</span>
      <span class="rank-ghost-bar" style="width:${40 + ((i * 37) % 45)}%"></span>
    </div>`,
  ).join('');
  return `<div class="rank-locked-wrap">
    ${ghosts}
    <div class="rank-lock">
      <p class="rank-lock-line">${s.rankExpired}</p>
      <button class="genius-cta" id="rankReLoginCta">${s.rankReLogin}</button>
    </div>
  </div>`;
}

export interface BoardViewOpts {
  lang: Lang;
  shapeIds: readonly string[];
  /** 点《成为 Slides 天才》时去哪儿。 */
  onWantGenius: () => void;
  /**
   * 点《重新登录》时去哪儿——个人主页上那颗《恢复购买》。
   *
   * 令牌过期的人和没订阅的人看到的是两屏不同的东西，因为他们要做的事不同：
   * 一个已经付过钱了，只是这台设备的登录旧了；另一个是真的还没订阅。给错
   * 出路比不给还糟。
   */
  onReLogin: () => void;
}

/**
 * 把一整块排行榜挂进 host：上面一排玩法切页，下面是榜。
 *
 * 每换一张榜都重新去问服务器——一张榜是活的，缓存下来只会让人看到别人半分钟
 * 前的名次。请求本身很小（前五十行）。
 */
export function mountBoardView(host: HTMLElement, opts: BoardViewOpts): void {
  const s = STRINGS[opts.lang];
  const tabs = boardTabs(opts.lang, opts.shapeIds);
  host.classList.add('rank-view');
  host.innerHTML = `
    <div class="rank-tabs" role="tablist">
      ${tabs
        .map(
          (t, i) =>
            `<button class="rank-tab${i === 0 ? ' rank-tab--on' : ''}" role="tab" data-mode="${esc(t.mode)}">${esc(t.label)}</button>`,
        )
        .join('')}
    </div>
    <div class="rank-body" id="rankBody"><p class="rank-empty">${s.rankLoading}</p></div>
  `;

  const body = host.querySelector<HTMLElement>('#rankBody')!;
  /** 换得比回包快的时候，别让旧的那一份盖住新的。 */
  let generation = 0;

  const paint = (result: BoardResult) => {
    if (result.ok) {
      body.innerHTML = rowsHtml(result.page, opts.lang);
      return;
    }
    if (result.reason === 'geniusOnly') {
      body.innerHTML = lockedHtml(opts.lang);
      body
        .querySelector<HTMLButtonElement>('#rankGeniusCta')
        ?.addEventListener('click', opts.onWantGenius);
      return;
    }
    if (result.reason === 'expired') {
      body.innerHTML = expiredHtml(opts.lang);
      body
        .querySelector<HTMLButtonElement>('#rankReLoginCta')
        ?.addEventListener('click', opts.onReLogin);
      return;
    }
    body.innerHTML = `<p class="rank-empty">${
      result.reason === 'signedOut' ? s.rankSignedOut : s.rankEmpty
    }</p>`;
  };

  const load = async (mode: string) => {
    const mine = ++generation;
    body.innerHTML = `<p class="rank-empty">${s.rankLoading}</p>`;
    const result = await fetchBoard(mode || undefined);
    if (mine !== generation) return;
    paint(result);
  };

  for (const tab of host.querySelectorAll<HTMLButtonElement>('.rank-tab')) {
    tab.addEventListener('click', () => {
      for (const other of host.querySelectorAll('.rank-tab')) other.classList.remove('rank-tab--on');
      tab.classList.add('rank-tab--on');
      void load(tab.dataset.mode ?? '');
    });
  }

  void load('');
}

/**
 * 记录页里那一半的缩略图：只有总榜的前三名，外加「我排第几」。
 *
 * 缩略图不放切页——那半块屏幕装不下九个标签，而缩略图要回答的只有一个问题：
 * 现在榜上是什么光景，我在哪儿。点开才是完整的那一屏。
 */
export function mountBoardThumb(host: HTMLElement, lang: Lang): void {
  const s = STRINGS[lang];
  host.innerHTML = `<p class="rank-empty">${s.rankLoading}</p>`;
  void fetchBoard().then((result) => {
    if (!result.ok) {
      if (result.reason === 'geniusOnly') {
        host.innerHTML =
          Array.from(
            { length: 3 },
            (_, i) => `<div class="rank-row rank-row--ghost">
              <span class="rank-place">${i + 1}</span>
              <span class="rank-ghost-bar" style="width:${45 + i * 15}%"></span>
            </div>`,
          ).join('') + `<p class="rank-foot">${s.rankLocked}</p>`;
        return;
      }
      // 缩略图上没地方放按钮，但话还是要说到——不然点开全页之前，这半块
      // 屏幕看上去和「这张榜还没有人」一模一样。
      host.innerHTML = `<p class="rank-empty">${
        result.reason === 'signedOut'
          ? s.rankSignedOut
          : result.reason === 'expired'
            ? s.rankExpired
            : s.rankEmpty
      }</p>`;
      return;
    }
    const top = { ...result.page, rows: result.page.rows.slice(0, 3) };
    host.innerHTML = rowsHtml(top, lang);
  });
}

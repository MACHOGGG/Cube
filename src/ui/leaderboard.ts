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
  /** 空字符串是总榜；`g:` 开头是母榜（旗下几张合起来）；别的是一张单独的榜。 */
  mode: string;
  label: string;
}

/** 一个母标签，和它旗下那几张榜。 */
export interface BoardGroup extends BoardTab {
  children: BoardTab[];
}

const BASE_THREE = ['square', 'circle', 'triangle'] as const;
const LAYOUTS = ['squareDiamond', 'circleHex', 'circleSeven', 'triangleBig', 'triangleAdvanced'] as const;

/**
 * 排行榜的六个母标签，和它们旗下的榜。
 *
 * 玩家定的顺序：总榜、基础、计时、炸弹、特殊布局、老虎机、无限反转。点母标签
 * 看的是它旗下几张合起来的样子，点子标签才是单独那一张（服务器那头同一套，见
 * api/scores.js 的 GROUPS）。
 *
 * 特殊布局旗下按棋盘分，不再按玩法分：一张 V 形三角的榜就是「V 形三角打得最好
 * 的人」，那几块棋盘玩的人本来就少，再切一遍只会切出五张空榜。
 */
export function boardGroups(lang: Lang): BoardGroup[] {
  const s = STRINGS[lang];
  const named = (ids: readonly string[], kind: string): BoardTab[] =>
    ids.map((id) => ({ mode: kind ? `${id}:${kind}` : id, label: shapeName(lang, id, id) }));
  return [
    { mode: 'g:base', label: s.rankTabBase, children: named(BASE_THREE, 'base') },
    { mode: 'g:timed', label: s.rankTabTimed, children: named(BASE_THREE, 'timed') },
    { mode: 'g:bomb', label: s.rankTabBomb, children: named(BASE_THREE, 'bomb') },
    { mode: 'g:layout', label: s.rankTabLayout, children: named(LAYOUTS, '') },
    { mode: 'g:slot', label: s.rankTabSlot, children: named(BASE_THREE, 'slot') },
    { mode: 'g:flip', label: s.rankTabFlip, children: named(['square', 'circle'], 'flip') },
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
  const groups = boardGroups(opts.lang);
  const total: BoardTab = { mode: '', label: s.rankTotalBoard };
  /** 哪个母标签被点开了（null 就是最外面那一排）。 */
  let open: BoardGroup | null = null;
  /** 现在看的是哪一张榜。 */
  let current = '';

  host.classList.add('rank-view');
  host.innerHTML = `
    <div class="rank-tabs" role="tablist" id="rankTabs"></div>
    <div class="rank-tabs rank-tabs--sub" role="tablist" id="rankSubTabs" hidden></div>
    <div class="rank-body" id="rankBody"><p class="rank-empty">${s.rankLoading}</p></div>
  `;
  const tabsEl = host.querySelector<HTMLElement>('#rankTabs')!;
  const subEl = host.querySelector<HTMLElement>('#rankSubTabs')!;
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
    current = mode;
    const mine = ++generation;
    body.innerHTML = `<p class="rank-empty">${s.rankLoading}</p>`;
    const result = await fetchBoard(mode || undefined);
    if (mine !== generation) return;
    paint(result);
  };

  /** 现在看的这张榜归哪个母标签——退回外面那一排时，高亮的是它。 */
  const ownerOf = (mode: string): BoardGroup | null =>
    groups.find((g) => g.mode === mode || g.children.some((c) => c.mode === mode)) ?? null;

  const tabHtml = (t: BoardTab, on: boolean) =>
    `<button class="rank-tab${on ? ' rank-tab--on' : ''}" role="tab" data-mode="${esc(t.mode)}">${esc(t.label)}</button>`;

  /**
   * 标签分两行。
   *
   * 上一行是母标签：总榜，加六个玩法大类。**这一行从头到尾都在**——点中其中
   * 一个，它高亮起来，旗下那几张榜落到下一行；别的母标签一个都不撤（玩家的
   * 原话：「点击了母 tag 后，其他母 tag 不要在第一行消失，仍然保留，只是下
   * 面出现了子 tag」）。
   *
   * 因为上一行一直在，换一类直接点上一行的另一个就是了，所以从前那颗《＜》
   * 退回键没有存在的理由了——玩家点名删掉。要收起下一行，点最左边那颗《总
   * 榜》：它本来就不是一个大类，没有子标签可展开。
   *
   * 下一行不点也行：点母标签的那一下已经把它那张合起来的榜摆出来了，那就是
   * 这一类的「总榜」。子标签是想单看某一副棋盘时才点的。
   */
  function paintTabs(): void {
    const owner = ownerOf(current);
    // 上一行：总榜 + 六个大类，永远是这七个。高亮的是「正在看的那张榜」，
    // 或者「正在看的那张榜属于哪一类」——看子标签的时候，它的母标签也亮着，
    // 这样一眼知道自己在哪一类里。
    tabsEl.innerHTML = [total, ...groups]
      .map((t) => tabHtml(t, t.mode === current || t.mode === owner?.mode || t.mode === open?.mode))
      .join('');
    subEl.innerHTML = open ? open.children.map((t) => tabHtml(t, t.mode === current)).join('') : '';
    subEl.hidden = !open;

    const clickable = [
      ...tabsEl.querySelectorAll<HTMLButtonElement>('.rank-tab'),
      ...subEl.querySelectorAll<HTMLButtonElement>('.rank-tab'),
    ];
    for (const tab of clickable) {
      tab.addEventListener('click', () => {
        const mode = tab.dataset.mode ?? '';
        // 上一行点一个大类：展开它的子标签，同时把它那张合起来的榜摆出来。
        // 点的是另一个大类就换过去——不像从前那样「已经开着就不再换」，因为
        // 现在七个大类一直都在，随时可以横着跳。
        const group = groups.find((g) => g.mode === mode);
        if (group) open = group;
        // 《总榜》不是大类，没有子标签：点它就把下一行收起来。
        if (mode === '') open = null;
        void load(mode);
        paintTabs();
      });
    }
  }

  paintTabs();
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

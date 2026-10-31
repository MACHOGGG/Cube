import { STRINGS, countPhrase, type Lang } from '../i18n';
import { cachedBoard, fetchBoard, waitForPush, type BoardPage, type BoardQuery, type BoardResult } from '../engine/cloudScores';
import { shapeName } from './shapeLabels';
import { rollOdometer } from '../engine/odometer';
import { gameIcon, ICON_BOMB_BADGE, ICON_FLIP_MODE, ICON_PUZZLE_MODE, ICON_SLOT_MACHINE, ICON_TIMED_COMBINED } from './homeIcons';
import { compactScore } from '../engine/compactScore';
import {
  DEFAULT_SELECTION,
  LB_FAMILIES,
  LB_MODES,
  LB_TIERS,
  expand,
  greyed,
  partialNote,
  tap,
  type LbMode,
  type LbNote,
  type LbRow,
  type LbSelection,
} from '../engine/lbCells';

/**
 * 全球排行榜的那一块。
 *
 * 上榜不要钱——一个新玩家打出好成绩，那一行本来就该在榜上。「有没有权限」这件事永远由服务器说了算
 * （api/scores.js），这里只负责把几种答复各自画成一屏：拿到了、没登录、登录过期、取不到。
 *
 * ero2 起（10-31 方案推14 Z-B15，lb-filter §9，按 §10 改）：原先那两层页签（总榜 + 七个母标签、母标签底下按棋盘的子标签）
 * 换成「全球榜 / 今日挑战」两个页签，全球榜底下三行药丸——族（方块 / 小球 / 三角）、普通 / Pro、玩法——每行都能自选几颗，
 * 规则全在 engine/lbCells.ts（哪颗灰、点了变成什么、要说哪句话）。默认「全部 · 全部 · 全部」就是新的总榜：每人最好的一局，
 * 含 Pro 和无限反转（站长知悉，§10②）。人数一律不印（§10.3）。
 */

const esc = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 锁住时垫在底下的那几行假名次。长短不一，才像一张真的榜。 */
const GHOST_ROWS = 8;

/**
 * 缩略牌上摆前几名。
 *
 * **六**，跟左边《记录》那一块一样多（recordsPage 的 PLACEHOLDER_ROWS）——两块并排站
 * 着，行数不一样的话矮的那块底下空一截，看着像少了点什么。三 → 五（玩家 2026-09：「在
 * 缩小图里只显示 3 个，应该显示 top5」）→ 六（第 17 推）。
 * 再多就不摆了：完整的那张榜点一下就有。
 *
 * **不管哪一种状态都是六格**（第 17 推：「空状态和锁住状态也画 6 个占位行」）：加载中、
 * 没登录、登录过期、榜上还没人、锁着、名次不满六个——缺几格就补几格空格子，那句话写在
 * 格子底下。见 thumbHtml。
 */
const THUMB_ROWS = 6;

/** 三行药丸的字（族、普通/Pro、玩法）。 */
function chipLabel(lang: Lang, row: LbRow, v: string): string {
  const s = STRINGS[lang];
  if (row === 'families') return v === 'square' ? s.rankFamilySquare : v === 'circle' ? s.rankFamilyBall : s.rankFamilyTri;
  if (row === 'tiers') return v === 'pro' ? s.rankTierPro : s.rankTierNormal;
  return modeLabel(lang, v as LbMode);
}
function modeLabel(lang: Lang, m: LbMode): string {
  const s = STRINGS[lang];
  return { base: s.rankTabBase, timed: s.rankTabTimed, bomb: s.rankTabBomb, slot: s.rankTabSlot, flip: s.rankTabFlip, puzzle: s.rankTabPuzzle }[m];
}
/** 几个名字连成一串：中文用顿号，英法用逗号。 */
const joinNames = (lang: Lang, names: string[]): string => names.join(lang === 'zhHans' || lang === 'zhHant' ? '、' : ', ');

/** 一行的玩法图（结果里不止一种玩法时画）。基础局没有自己的图（行首那张棋盘图就是它），垫一个空的对齐。 */
function modeGlyph(kind: LbMode): string {
  return { base: '', timed: ICON_TIMED_COMBINED, bomb: ICON_BOMB_BADGE, slot: ICON_SLOT_MACHINE, flip: ICON_FLIP_MODE, puzzle: ICON_PUZZLE_MODE }[kind];
}

/** 点了灰的药丸 / 唯一会变空的那一步：三行下面那一句。 */
function noteText(lang: Lang, note: LbNote): string {
  const s = STRINGS[lang];
  if (note.key === 'rankResetNote') return s.rankResetNote;
  if (note.key === 'rankGreyFamily') return s.rankGreyFamily.split('{family}').join(chipLabel(lang, 'families', note.family));
  const fams = note.families.length ? note.families : [...LB_FAMILIES];
  return s.rankGreyMode
    .split('{family}').join(joinNames(lang, fams.map((f) => chipLabel(lang, 'families', f))))
    .split('{mode}').join(modeLabel(lang, note.mode));
}

/** 表头那一句（或两句）：默认页说「每人最好的一局」；有没贡献的族说 rankPartialNote；选了炸弹再说 rankBombNote。 */
function headText(lang: Lang, sel: LbSelection): string {
  const s = STRINGS[lang];
  const parts: string[] = [];
  if (!sel.families.length && !sel.tiers.length && !sel.modes.length) parts.push(s.rankDefaultNote);
  const p = partialNote(sel);
  if (p) {
    parts.push(
      s.rankPartialNote
        .split('{family}').join(joinNames(lang, p.idle.map((f) => chipLabel(lang, 'families', f))))
        .split('{mode}').join(joinNames(lang, p.modes.map((m) => modeLabel(lang, m))))
        .split('{others}').join(joinNames(lang, p.others.map((f) => chipLabel(lang, 'families', f)))),
    );
  }
  if (sel.modes.includes('bomb')) {
    parts.push(s.rankBombNote.split('{bomb}').join(s.rankTabBomb).split('{timed}').join(s.bombTimedTitle).split('{advanced}').join(s.bombAdvancedTitle));
  }
  return parts.join(' · ');
}

/**
 * 一行一行画出来。
 *
 * **名字可以是空的**，而且空是常态：玩家没起过昵称就没有名字，服务端还会把「长得像凭据」的旧名字过滤成空
 * （api/scores.js 的 `shownName`，#2 那次泄露）。空的那一行印「匿名玩家」。
 *
 * ⚠️ **不许拿「玩家 + 随机编号」之类的东西填**（玩家 2026-10-02 点名）：那种名字看起来像一个人，其实只是一个占位，
 * 而同一个人每次刷新可能换一个号——榜上于是多出一堆不存在的人。一句「匿名玩家」说的就是实情。
 */
function rowsHtml(page: BoardPage, lang: Lang, look: RowLook, compact = false): string {
  const s = STRINGS[lang];
  if (!page.rows.length) return `<p class="rank-empty">${s.rankEmpty}</p>`;
  return rowList(page, lang, compact, look).join('') + (compact ? '' : mineFootHtml(page, lang, look));
}

/** 行首画几样：结果里不止一副棋盘 → 棋盘图；不止一种玩法 → 再画玩法图。 */
interface RowLook {
  board: boolean;
  mode: boolean;
}
const lookOf = (q: BoardQuery): RowLook => {
  if (q === 'daily') return { board: false, mode: false };
  const cells = expand(q);
  return { board: new Set(cells.map((c) => c.board)).size > 1, mode: new Set(cells.map((c) => c.mode)).size > 1 };
};

/**
 * 「我排第几」（10-11 方案 B-13.9，玩家定的 Q7：显示）：放大的那张榜底下固定一行「名次 · 我 · 分数」。
 *
 * 在前 200 名里是精确名次（同分同名次）；在 200 名以外名次格印「200+」、读屏念 rankOutside200（推14 Z-B15）；这张榜上没有
 * 自己（page.me 是 null）就不摆。自己已经在列出来的行里就不重复。缩略牌太窄，不加。
 */
function mineFootHtml(page: BoardPage, lang: Lang, look: RowLook): string {
  if (!page.me || page.rows.some((r) => r.me)) return '';
  const s = STRINGS[lang];
  const pad = (on: boolean) => (on ? '<span class="rank-glyph" aria-hidden="true"></span>' : '');
  const place = page.me.rank === null
    ? `<span class="rank-place" aria-label="${esc(s.rankOutside200)}">200+</span>`
    : `<span class="rank-place">${page.me.rank}</span>`;
  return `<div class="rank-row rank-row--me rank-row--pin">
        ${place}
        ${pad(look.board)}${pad(look.mode)}
        <span class="rank-name">${esc(s.rankMe)}</span>
        <span class="rank-score">${page.me.score}</span>
      </div>`;
}

/** 一行名次一个字符串——缩略牌要按格子数补齐，所以不能先拼成一整段。 */
function rowList(page: BoardPage, lang: Lang, compact: boolean, look: RowLook): string[] {
  const s = STRINGS[lang];
  return page.rows.map((r) => {
    const boardGlyph = look.board && r.board
      ? `<span class="rank-glyph" aria-label="${esc(shapeName(lang, r.board, r.board))}">${gameIcon(r.board)}</span>`
      : look.board ? '<span class="rank-glyph" aria-hidden="true"></span>' : '';
    const modeG = look.mode && r.kind
      ? `<span class="rank-glyph rank-glyph--mode" aria-label="${esc(modeLabel(lang, r.kind))}">${modeGlyph(r.kind)}</span>`
      : look.mode ? '<span class="rank-glyph rank-glyph--mode" aria-hidden="true"></span>' : '';
    return `<div class="rank-row${r.me ? ' rank-row--me' : ''}">
        <span class="rank-place">${r.rank}</span>
        ${boardGlyph}${modeG}
        <span class="rank-name">${esc(r.name || s.rankAnon)}</span>
        ${
          // 凡来自 Pro 榜的行都挂「Pro」小标（§10.4：只选 Pro 时也挂；字用现成的 proBtn）。缩略牌上不挂——那半块屏幕连名字
          // 都要省略号。
          r.pro && !compact ? `<span class="records-row-pro">${esc(s.proBtn)}</span>` : ''
        }
        ${
          // 步步为营清盘的那一局：「剩 N 步」（第 14 推）。同分时就是靠它排的先后，不印出来的话两行一样的分数一前一后，
          // 看着像排错了。缩略牌上不印。
          r.left && !compact ? `<span class="rank-left">${countPhrase(s.puzzleLeftSteps, r.left, lang)}</span>` : ''
        }
        <span class="rank-score">${compact ? compactScore(r.score, lang) : r.score}</span>
      </div>`;
  });
}

/**
 * 缩略牌：永远是 THUMB_ROWS 格，缺的用空格子补，那句话（加载中 / 没登录 / 还没人……）写在
 * 格子底下。空格子不给读屏念——它什么都没说。
 */
function thumbHtml(rows: string[], note = ''): string {
  const slots = rows.slice(0, THUMB_ROWS);
  while (slots.length < THUMB_ROWS) {
    slots.push('<div class="rank-row rank-row--empty" aria-hidden="true"></div>');
  }
  return slots.join('') + (note ? `<p class="rank-foot">${note}</p>` : '');
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

/** 看着这一屏的时候，隔多久自己去拉一次。 */
const POLL_MS = 30_000;

/**
 * 把一整块排行榜挂进 host：上面「全球榜 / 今日挑战」两个页签，全球榜底下三行药丸，再下面是榜。
 *
 * ── 三件和「新不新」有关的事（2026-10-02）────────────────────
 *
 * ① **换选择不闪。** 手上有一份十秒内的就先画出来，再在后台拉新的盖上去（缓存在 engine/cloudScores.ts 的 `cachedBoard`，
 *    键是规范化之后的选择）。连点几颗药丸时只认最后一次（`generation`），而且**最后一次点击之后 300 ms 才去拉**（推14
 *    Z-B15）——来回点三四颗不该打三四次服务器。
 *
 * ② **看着它的时候每三十秒自己拉一次**，切到后台就停。
 *
 * ③ 这一屏一关就停。靠的是 `host.isConnected`——这块 DOM 被整个移掉的那一刻它就是 false。
 *
 * 默认与记忆：每次打开都是「全球榜 · 全部 · 全部 · 全部」；不记上次的选择；切到「今日挑战」三行收起，切回来恢复切走前的
 * 样子（只在这一次打开面板之内）。
 *
 * 无障碍（§9.3⑪）：每一行 role="group" ＋ aria-labelledby 指向行标题（屏上也看得见）；每颗药丸是 <button aria-pressed>
 * （「全部」也是），Tab 逐颗走；灰的那颗 aria-disabled="true"、仍可聚焦、aria-describedby 指向那句说明；页签用
 * role="tablist"；表头那句和变灰提示放在同一个 aria-live="polite" 区。
 */
export function mountBoardView(host: HTMLElement, opts: BoardViewOpts): void {
  const s = STRINGS[opts.lang];
  let scope: 'global' | 'daily' = 'global';
  let sel: LbSelection = DEFAULT_SELECTION;
  /** 现在看的是哪一张（全球榜那一路是一份选择，今日榜是 'daily'）。 */
  let current: BoardQuery = sel;

  const ROWS: [LbRow, string, readonly string[]][] = [
    ['families', s.rankRowFamily, LB_FAMILIES],
    ['tiers', s.rankRowTier, LB_TIERS],
    ['modes', s.rankRowMode, LB_MODES],
  ];

  host.classList.add('rank-view');
  host.innerHTML = `
    <div class="rank-side">
      <div class="rank-scope" role="tablist" id="rankScope">
        <button type="button" class="rank-scope-tab" role="tab" data-scope="global" id="rankScopeGlobal">${esc(s.rankScopeGlobal)}</button>
        <button type="button" class="rank-scope-tab" role="tab" data-scope="daily" id="rankScopeDaily">${esc(s.rankScopeDaily)}</button>
      </div>
      <div class="rank-filters" id="rankFilters">
        ${ROWS.map(([row, title]) => `<div class="rank-filter" role="group" aria-labelledby="rankRowT-${row}">
          <span class="rank-filter-title" id="rankRowT-${row}">${esc(title)}</span>
          <div class="rank-chips" data-row="${row}"></div>
        </div>`).join('')}
      </div>
    </div>
    <div class="rank-main">
      <div class="rank-notes" aria-live="polite">
        <p class="rank-say" id="rankSay"></p>
        <p class="rank-head" id="rankHead"></p>
      </div>
      <div class="rank-body" id="rankBody"><p class="rank-empty">${s.rankLoading}</p></div>
    </div>
  `;
  const scopeEl = host.querySelector<HTMLElement>('#rankScope')!;
  const filtersEl = host.querySelector<HTMLElement>('#rankFilters')!;
  const sayEl = host.querySelector<HTMLElement>('#rankSay')!;
  const headEl = host.querySelector<HTMLElement>('#rankHead')!;
  const body = host.querySelector<HTMLElement>('#rankBody')!;
  /** 换得比回包快的时候，别让旧的那一份盖住新的。 */
  let generation = 0;
  let sayTimer = 0;
  let loadTimer = 0;

  /**
   * 自己那一行的分数滚过了没有。「进来那一次」滚，不是每次画榜都滚：来回点的时候每次都从 0 滚到自己的分，那就从「一处
   * 安静的确认」变成了满页在动。别人的行不滚。
   */
  let rolledMine = false;

  const say = (text: string) => {
    window.clearTimeout(sayTimer);
    sayEl.textContent = text;
    // 4 秒后消失，或者被下一次点击换掉。
    if (text) sayTimer = window.setTimeout(() => { sayEl.textContent = ''; }, 4000);
  };

  function paintScope(): void {
    for (const b of scopeEl.querySelectorAll<HTMLButtonElement>('.rank-scope-tab')) {
      const on = b.dataset.scope === scope;
      b.classList.toggle('rank-scope-tab--on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    filtersEl.hidden = scope === 'daily';
  }

  function paintChips(): void {
    const g = greyed(sel);
    for (const [row, , all] of ROWS) {
      const box = filtersEl.querySelector<HTMLElement>(`.rank-chips[data-row="${row}"]`)!;
      const cur = sel[row] as readonly string[];
      const chip = (v: string, label: string, pressed: boolean, grey: boolean) =>
        `<button type="button" class="rank-chip${grey ? ' rank-chip--grey' : ''}" data-row="${row}" data-chip="${v}" aria-pressed="${pressed}"` +
        (grey ? ' aria-disabled="true" aria-describedby="rankSay"' : '') +
        `>${esc(label)}</button>`;
      box.innerHTML =
        chip('all', s.rankAll, cur.length === 0, false) +
        all.map((v) => chip(v, chipLabel(opts.lang, row, v), cur.includes(v), Boolean((g[row] as Record<string, boolean>)[v]))).join('');
    }
  }

  function paintHead(): void {
    headEl.textContent = scope === 'daily' ? '' : headText(opts.lang, sel);
  }

  /**
   * `roll` 为假：这一画是「手上那份缓存先摆出来」，紧跟着这一次真拉回来的那一份就会把整张榜重画一遍——在缓存那一画上滚，滚筒
   * 几毫秒之后就被冲掉，玩家看到的是一个不动的数（check-leaderboard 量出来的）。所以只在真拉回来的那一画上滚。
   */
  const paint = (result: BoardResult, roll = true) => {
    if (result.ok) {
      body.innerHTML = rowsHtml(result.page, opts.lang, lookOf(current));
      if (roll && !rolledMine) {
        const mineScore = body.querySelector<HTMLElement>('.rank-row--me .rank-score');
        if (mineScore) {
          rolledMine = true;
          rollOdometer(mineScore, Number(mineScore.textContent));
        }
      }
      return;
    }
    if (result.reason === 'geniusOnly') {
      body.innerHTML = lockedHtml(opts.lang);
      body.querySelector<HTMLButtonElement>('#rankGeniusCta')?.addEventListener('click', opts.onWantGenius);
      return;
    }
    if (result.reason === 'expired') {
      body.innerHTML = expiredHtml(opts.lang);
      body.querySelector<HTMLButtonElement>('#rankReLoginCta')?.addEventListener('click', opts.onReLogin);
      return;
    }
    // 剩下的只有「没登录」和「没拉下来」两种。后者从前落在 rankEmpty（「这张榜上还没有人」）上：网断了一下，玩家看到的是
    // 一张空榜（2026-10-08 方案 2-8）。服务器那头 5xx 说「服务器忙」；看得太勤被限速（429）单说一句（10-15 补充 L-9）。
    body.innerHTML = `<p class="rank-empty">${
      result.reason === 'signedOut'
        ? s.rankSignedOut
        : result.reason === 'tooMany'
          ? s.rankTooMany
          : result.reason === 'unavailable'
            ? s.serverBusy
            : s.rankNetwork
    }</p>`;
  };

  /** 换了选择 / 页签：手上有新鲜的先画（①），最后一次点击之后 300 ms 才去拉。 */
  const load = (q: BoardQuery, wait: number) => {
    current = q;
    const mine = ++generation;
    const had = cachedBoard(q);
    if (had) paint({ ok: true, page: had }, false);
    else body.innerHTML = `<p class="rank-empty">${s.rankLoading}</p>`;
    window.clearTimeout(loadTimer);
    const go = async () => {
      const result = await fetchBoard(q);
      if (mine !== generation) return;
      // 后台这一拉失败了、而屏幕上已经有一张真的榜：**留着它**。
      if (!result.ok && had) return;
      paint(result);
    };
    if (wait > 0) loadTimer = window.setTimeout(() => void go(), wait);
    else void go();
  };

  /** 定时那一拉（②）：不许动屏幕上已经有的东西，除非真拿到了新的一份。 */
  const poll = async () => {
    if (!host.isConnected) return;
    if (document.visibilityState !== 'visible') return;
    const q = current;
    const mine = generation;
    const result = await fetchBoard(q);
    if (!host.isConnected || mine !== generation || q !== current) return;
    if (result.ok) paint(result);
  };

  const timer = window.setInterval(() => {
    if (!host.isConnected) {
      window.clearInterval(timer);
      window.clearTimeout(loadTimer);
      window.clearTimeout(sayTimer);
      document.removeEventListener('visibilitychange', onShow);
      return;
    }
    void poll();
  }, POLL_MS);
  /** 从后台切回来：别等满三十秒，当场拉一次。 */
  function onShow(): void {
    if (document.visibilityState === 'visible') void poll();
  }
  document.addEventListener('visibilitychange', onShow);

  scopeEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.rank-scope-tab');
    if (!b) return;
    const next = b.dataset.scope === 'daily' ? 'daily' : 'global';
    if (next === scope) return;
    scope = next;
    say('');
    paintScope();
    paintHead();
    // 切到「今日挑战」三行收起；切回来恢复切走前的样子（sel 一直留着）。
    load(scope === 'daily' ? 'daily' : sel, 0);
  });
  filtersEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.rank-chip');
    if (!b) return;
    const row = b.dataset.row as LbRow;
    const res = tap(sel, row, b.dataset.chip ?? '');
    say(res.note ? noteText(opts.lang, res.note) : '');
    if (res.sel === sel) return;
    sel = res.sel;
    paintChips();
    paintHead();
    // 焦点留在刚点的那一颗（重画之后按 data-chip 找回来），键盘用户不用从头再 Tab。
    filtersEl.querySelector<HTMLButtonElement>(`.rank-chip[data-row="${row}"][data-chip="${b.dataset.chip}"]`)?.focus();
    load(sel, 300);
  });

  paintScope();
  paintChips();
  paintHead();
  /**
   * 开头那一拉**先等刚打完那一局上报落地**，最多两秒（engine/cloudScores.ts 的 `waitForPush`）：不等的话玩家刚刷新了自己的
   * 最高分，点开排行榜，上面还是旧名次。
   */
  void waitForPush().then(() => load(sel, 0));
}

/**
 * 记录页里那一半的缩略图：默认选择（全部 · 全部 · 全部）的前 6 名（推14 Z-B15 ⑤：跟着变成全站混排）。
 *
 * 缩略图不放药丸——那半块屏幕装不下，而缩略图要回答的只有一个问题：现在榜上是什么光景。点开才是完整的那一屏。
 */
export function mountBoardThumb(host: HTMLElement, lang: Lang): void {
  const s = STRINGS[lang];
  /** 缩略牌太窄：只画棋盘那一枚图，不画玩法图。 */
  const look: RowLook = { board: true, mode: false };
  /** 手上有一份还新鲜的就先画出来，别让这半块牌空着闪一下。 */
  const had = cachedBoard(DEFAULT_SELECTION);
  const shown = (page: BoardPage) =>
    page.rows.length ? thumbHtml(rowList(page, lang, true, look)) : thumbHtml([], s.rankEmpty);
  host.innerHTML = had ? shown(had) : thumbHtml([], s.rankLoading);
  // 和整屏那一块同一个道理：先等刚打完那一局上报落地（最多两秒），再拉。
  void waitForPush().then(() => fetchBoard(DEFAULT_SELECTION)).then((result) => {
    if (!result.ok) {
      // 拉不到、而牌上已经有一张真的（缓存那一份）：留着它，别换成一句错误。
      if (had) return;
      if (result.reason === 'geniusOnly') {
        host.innerHTML = thumbHtml(
          Array.from(
            { length: THUMB_ROWS },
            (_, i) => `<div class="rank-row rank-row--ghost">
              <span class="rank-place">${i + 1}</span>
              <span class="rank-ghost-bar" style="width:${45 + ((i * 15) % 45)}%"></span>
            </div>`,
          ),
          s.rankLocked,
        );
        return;
      }
      host.innerHTML = thumbHtml(
        [],
        result.reason === 'signedOut'
          ? s.rankSignedOut
          : result.reason === 'expired'
            ? s.rankExpired
            : result.reason === 'tooMany'
              ? s.rankTooMany
              : result.reason === 'unavailable'
                ? s.serverBusy
                : s.rankNetwork,
      );
      return;
    }
    host.innerHTML = shown(result.page);
  });
}

/**
 * 棋盘底下那块教学条。
 *
 * **10-11 方案 D-1（玩家规格 ＋ 10-11 答复）把五条什么时候出来、摆多久整个重定了：**
 *
 *   A「色块拼出得分图案就翻面，变成星星。」     开局就讲；配一段动画（本局三种颜色的 1×N 依次慢翻过去再翻回来，
 *                                                 循环），**手机上也显示**；不亮呼吸灯。10 秒，或第一次得分，就换
 *   B「星星可以与色块一同再次拼出得分图案。」   呼吸灯（engine/coachHint.ts 的 group）。图案**第一次真的降级**的那一
 *                                                 步结算完就换
 *   C「得分图案会随着游戏解锁而变化。」         按新图案亮一组（groupOnce：只算一次，之后跟着那几枚走，被翻掉、离场
 *                                                 就熄），HUD 那块《得分图案》一起亮。默认 10 秒；盘上出现「某色星星数
 *                                                 ≥ 当前最短外边的枚数」，就从那一刻起 5 秒后换，总长不超过 10 秒
 *   D「同色星星在整体的外边会得分并消除。」     呼吸灯（edge：那一色在场的所有星星）。**从这一条出现起**，成功消掉
 *                                                 **两次**整条外边就换
 *   E「尝试全部消除吧～」                       不亮，留到这一局结束
 *
 * 所有计时（A 的 10 秒、C 的 10 秒 / 5 秒）**随暂停冻结**：控制器在 doPause / doResume 里喊 pause() / resume()。
 * 一局里只用「这一局真的在打的时间」——接个电话回来，条子不该已经悄悄翻过去两条。
 *
 * 换条只在两种时刻：计时到了（A、C），和一步结算完（observe：得分、降级、消边这几件事在连锁里发生时只记下，等这
 * 一步的动画演完再换，别抢在消除动画前面）。
 *
 * **第二副基础棋盘（plan: 'second'）只讲 D**：场上第一次出现「某色星星数 ≥ 最短外边」时开口，之后一直摆着。他刚
 * 打完一局别的，前几条跟着走过一遍了；只有「外边怎么消」是这一族自己的事。
 *
 * ── 从前那一版为什么换掉（10-11 方案 D-0）──────────────────────────────────────
 *
 * 第 3 条在「剩 ≤ 4 段」就出现，那时图案还是旧的；第 1 条要 12 秒、得分了也不往前走，还会亮灯；第 4 条消一次就走；
 * 条子的计时暂停时不停；手机上第 1 条的配图整个藏掉；第 3 条不点亮图案块。另外每一条至少摆 6 秒（MIN_READ_MS）
 * 那一条拿掉了：B 在小球上中位只持续两步，规格照做（方案 D-1 的观察）。
 *
 * 文字和配图跟着这一局的图形走（见 i18n 的 tutorialRules、ruleArt 的 buildRuleArt）。
 */
import { STRINGS, tutorialRules, type Lang } from '../i18n';
import type { CoachHint } from '../engine/coachHint';
import { buildRuleArt, flipRowsArt } from './ruleArt';

export type { CoachHint };

/**
 * 连锁里发生过的事。gameController 在那一拍里报进来；条子**只记下**，等这一步结算完（observe）再看。
 *
 *   score    这一局第一次得分——A 等它
 *   erosion  图案降了一级——B 等它（第一次真的降级）
 *   line     真的消掉了几条外边（`count` 条）——D 数它，从 D 出现起数满两次就换
 */
export type CoachSignal = 'score' | 'erosion' | 'line';
/** 这一局玩的是哪种图形。三角没有自己那套配图，用通稿那份。 */
export type CoachShape = 'square' | 'circle' | 'triangle';
/** 哪一种排法，见文件开头。 */
export type CoachPlan = 'first' | 'second';

/** 每一步结算（连锁跑完）之后，盘面此刻的样子。gameController 问齐了交进来。 */
export interface CoachView {
  /**
   * 某一种颜色的星星枚数 ≥ 当前最短外边的枚数（方块：此刻行长和列长里小的那个；别的：此刻削得动的最短那条外边）。
   * 由棋盘自己数（`coachStarsReachEdge`）。C 的「5 秒」从它第一次成立起算；第二副棋盘的 D 等它开口。
   */
  starsReachEdge: boolean;
}

/** A 摆多久（玩家规格：10 秒，或者第一次得分）。 */
export const A_MS = 10000;
/** C 最长摆多久（默认 10 秒）。 */
export const C_MS = 10000;
/** C：「某色星星数 ≥ 当前最短外边」成立之后再摆多久（总长仍不超过 C_MS）。 */
export const C_AFTER_REACH_MS = 5000;
/** D：从它出现起，消掉几次整条外边就换到 E。 */
export const D_LINES = 2;

/**
 * 第 i 条（tutorialRules 的下标）此刻要灯做什么（engine/coachHint.ts 的 CoachHint）：A、E 不亮。
 */
export const HINT_OF: readonly (CoachHint | null)[] = [null, 'group', 'groupOnce', 'edge', null];

/** 两种排法各讲哪几条、按什么顺序（tutorialRules 的下标）。 */
const PLAN_STEPS: Record<CoachPlan, readonly number[]> = {
  first: [0, 1, 2, 3, 4],
  second: [3],
};

/** 回头看上一条，最多停这么久，然后自己回到现在（见 peek）。 */
const PEEK_MS = 12000;

export interface CoachBar {
  /** 一步结算完了（连锁跑完）：看一眼盘面，该换哪一条就换。 */
  observe(view: CoachView): void;
  /** 连锁里发生了一件事（见 CoachSignal）。只记下，不当场换条。line 带上这一拍消了几条。 */
  signal(sig: CoachSignal, count?: number): void;
  /** 此刻这一条要灯做什么；不亮（A、E、条子还没开口）回 null。 */
  hint(): CoachHint | null;
  /** 暂停 / 继续：计时一起停、一起走。 */
  pause(): void;
  resume(): void;
  /** 重开一局：回到起点，见过的也一并忘掉。 */
  reset(): void;
  destroy(): void;
}

export interface CoachOpts {
  lang: Lang;
  shape: CoachShape;
  plan?: CoachPlan;
  /** 五幅配图。不给就按 shape 现算——网页版三种图形都在，小红书版另给一份。 */
  art?: readonly string[];
  /**
   * 这一局的三种颜色（正面的颜色，CSS 写法）——A 那段动画用（「本局三种颜色的 1×N」）。不给就用配图那套颜色。
   */
  colors?: readonly string[];
  /**
   * 换了一条（含开口、重开）。呼吸灯亮哪一种跟着条走，所以控制器要在这时候重算一次。
   *
   * 由外面传进来，而不是条子自己去摸棋盘：条子不认识棋子，棋盘不认识条子，两样都在 gameController 手上。
   */
  onChange?: () => void;
  /** 钟（门里换成假的）。 */
  now?: () => number;
}

/** 按形状算出来的那份配图只算一次：一局里要用好几回，每回重画一遍是白费。 */
const ART_CACHE = new Map<CoachShape, string[]>();
function artFor(shape: CoachShape): string[] {
  let a = ART_CACHE.get(shape);
  if (!a) {
    // buildRuleArt 只画得出方块和小球两套；三角走通稿那一份（那份第 1 幅本来
    // 就三种图形并排，三角在里面）。
    a = buildRuleArt(shape === 'triangle' ? {} : { shape });
    ART_CACHE.set(shape, a);
  }
  return a;
}

/**
 * 条子的骨架：顶上几段进度，底下一行「一幅图 + 一句话」，右边一颗《<》。
 *
 * 那颗《<》是玩家要的：「给第一次打开基础玩法的玩家，加入一个『<』查看上一
 * 条」。条子是自己往下走的，走过去就没了——可他很可能正低头滑棋子，一抬头上
 * 一条已经换掉了。
 *
 * 它翻的是「看」，不是「进度」：按下去只是把上一条的图文摆回来，这一步在等
 * 的事一件没变、计时一秒没停（见 peek）。所以它不会让人卡在过去，也不会因
 * 为回头看一眼就漏掉正在讲的这一条。
 *
 * 只有一行：第 15 推之前头一局有一步摆两条（第 1+2 条并在一起，`coach-bar--pair`），
 * 2026-10 第二轮拆成了一步一条，第 15 推又定了「一次只显示一条」，那一档就整个拆了。
 */
function frame(host: HTMLElement, segs: number): void {
  host.hidden = false;
  host.innerHTML =
    `<div class="coach-head">` +
    (segs > 0
      ? `<div class="coach-prog" aria-hidden="true">${'<span class="coach-seg"></span>'.repeat(segs)}</div>`
      : '<span class="coach-prog"></span>') +
    `<button class="coach-peek" type="button" hidden></button></div>` +
    `<div class="coach-row"><span class="coach-art tut-rule-art"></span><p class="coach-text"></p></div>`;
  // 换条子是自己换的，不是玩家点出来的——读屏软件要主动念出来，不然对看不见
  // 屏幕的人这块条子等于不存在。polite：等他手上这句话读完再插进去。
  host.setAttribute('aria-live', 'polite');
}

/** 一次性的淡入：先摘掉再挂上，中间读一次 offsetWidth 逼浏览器把「没有这个
 *  类」当成一帧算掉，否则连着两次换条子第二次不会重播。 */
function fadeIn(host: HTMLElement): void {
  host.classList.remove('coach-in');
  void host.offsetWidth;
  host.classList.add('coach-in');
}

/**
 * 手机端那一档：字号比平时大（第 15 推起是两倍，10-09 补充方案下调一档到 28 / 15 倍），最多两行（第 15 推，玩家原话「字号放大到现在的 2 倍以
 * 上，最多两行，不能压住棋盘」）。
 *
 * 放大是 CSS 给的（style.css 里 `.coach-bar--rules .coach-text` 那一档，同时给一个
 * `--coach-lines: 2`；10-09 补充方案起比两倍小一档，是平时的 28 / 15 倍）。这儿只管一件 CSS
 * 做不到的事：**放大之后摆不进两行的那几句往回收**，一次收 1px，收到平时那一档为止——再小
 * 就比改之前还小了。
 *
 * ⚠️ 量过（390×844 / 360×640 / 375×667 / 430×932）：中文五条里只有小球那一局的第 4 条
 * （46 个字，i18n 的 TUTORIAL_RULE4）两倍摆不进两行，收到约 1.1 倍；英、法两种语言的句子本
 * 来就长，多数条收在 1.1–1.9 倍之间，小球第 4 条的法文收到平时那一档还要三行多。这是方
 * 案里「两倍」和「最多两行」两条在长句上的冲突，已经报给玩家拍板；在拍板之前，两行优先
 * （不压棋盘是硬的），字号能大多少大多少。
 *
 * （上面这几个数量的是 10-08 方案 3-E-4 **之前**的句子。那一次小球的第 4 条改短了——中文 46 个
 * 字变成 22 个，法文也短了一半——它多半不用再往回收；这个函数不认是哪一句，照旧量了才收。）
 *
 * 只认 `--coach-lines`：电脑端三栏那一档不给，这儿就什么都不做。
 */
export function fitCoachText(el: HTMLElement): void {
  el.style.fontSize = '';
  if (typeof getComputedStyle !== 'function') return;
  const cs = getComputedStyle(el);
  const lines = parseFloat(cs.getPropertyValue('--coach-lines'));
  if (!(lines > 0)) return;
  const big = parseFloat(cs.fontSize);
  if (!(big > 0)) return;
  // 收到平时那一档为止。10-09 补充方案起手机端这一档是平时的 28 / 15 倍（不再是两倍，见
  // style.css 那一条），所以按这个比例倒推回去；还写 big / 2 的话会比平时那一档还小一号。
  const floor = big * (15 / 28);
  let size = big;
  for (let guard = 0; guard < 40; guard++) {
    const n = lineCount(el);
    // 0 行 = 条子这会儿是藏着的（第二副棋盘还没开口）。开口的时候 paint 会再量一次。
    if (n === 0 || n <= lines || size <= floor) return;
    size = Math.max(floor, size - 1);
    el.style.fontSize = size + 'px';
  }
}

/**
 * 这一段字此刻折成了几行。
 *
 * **数的是字，不是盒子**：手机端那一档给这一格垫了两行的最小高度（style.css，为了换条时
 * 条子不变高），拿盒子的高度除以行高，一行的字也会量成两行，两行的字收小一号之后还是量成
 * 「两行多」——第一版就是这么一路收到底的。所以用 Range 拿每一行的那一段字的框，按纵坐标
 * 数有几排（中英混排时同一行会拆成好几段，纵坐标挨得近的算一排）。
 */
function lineCount(el: HTMLElement): number {
  if (typeof document === 'undefined' || !document.createRange) return 0;
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = range.getClientRects();
  const tops: number[] = [];
  for (let i = 0; i < rects.length; i++) if (rects[i].width > 0) tops.push(rects[i].top);
  tops.sort((a, b) => a - b);
  const half = (parseFloat(getComputedStyle(el).fontSize) || 16) / 2;
  let n = 0;
  let last = -Infinity;
  for (const t of tops) {
    if (t - last > half) n++;
    last = t;
  }
  return n;
}

/**
 * @param host 外壳里那块 `.coach-bar`（gameShell 只有 meta.coach 时才画它）。
 */
export function mountCoachBar(host: HTMLElement, opts: CoachOpts): CoachBar {
  const plan: CoachPlan = opts.plan ?? 'first';
  // 单调钟（10-15 补充 S8）：A、C 那几个 10 秒 / 5 秒不跟着墙上的钟被拨（门里自己注入 now 的照旧）。
  const now = opts.now ?? (() => performance.now());
  const texts = tutorialRules(opts.lang, opts.shape);
  const base = opts.art ?? artFor(opts.shape);
  // A 那一幅换成那段动画（本局三种颜色的 1×N 依次慢翻过去再翻回来，10-11 方案 D-1）。三角那一族没有自己的一套，
  // 照方块画。
  const art = [flipRowsArt(opts.shape === 'circle' ? 'circle' : 'square', opts.colors), ...base.slice(1)];
  const steps = PLAN_STEPS[plan];
  const lastStep = steps.length - 1;
  /**
   * 进度条按「步」算：**走一格，屏幕上换一屏**。只有从第 1 条讲起的那一路才画——第二副棋盘只讲一条，画一条走到
   * 头的进度条只会让人以为自己漏了前面几条。
   */
  const segs = steps[0] === 0 ? steps.length : 0;

  frame(host, segs);
  // 这一块摆的是五条规则（不是那几个玩法头一回进来的一句提示）：手机端两倍字号只认它，见 style.css 的
  // `.coach-bar--rules`。
  host.classList.add('coach-bar--rules');

  const progEl = host.querySelector<HTMLElement>('.coach-prog');
  const artEl = host.querySelector<HTMLElement>('.coach-art')!;
  const textEl = host.querySelector<HTMLElement>('.coach-text')!;
  const peekEl = host.querySelector<HTMLButtonElement>('.coach-peek');

  /** 正在摆第几步（steps 的下标）；-1 = 还没开口（第二副棋盘那一路）。 */
  let at = -1;
  /** 正在回头看上一条（见 peek）。 */
  let peeking = false;
  let peekTimer = 0;
  let dead = false;

  // ---- 这一局里发生过的事（signal 记下，observe 再看）----
  /** A：得过分了。 */
  let scored = false;
  /** B：图案真的降过一级了。 */
  let degraded = false;
  /** D：从 D 出现起消掉了几条外边。 */
  let linesInD = 0;
  /** 上一次结算完看到的盘面（C 一出来就要问「星星够不够一条外边」）。 */
  let lastView: CoachView = { starsReachEdge: false };

  // ---- 只数「真的在打」的时间（暂停冻结，见文件头）----
  /** 这一条已经摆了多久（不算暂停）：累计的 + 这一段（没暂停时）从 since 起的。 */
  let spent = 0;
  let since = now();
  let paused = false;
  /** 这一条摆到多久就换（不算暂停）；Infinity = 不按时间换。 */
  let deadline = Infinity;
  let timer = 0;
  const elapsed = () => spent + (paused ? 0 : now() - since);
  const clearTimer = () => {
    if (timer) window.clearTimeout(timer);
    timer = 0;
  };
  /** 按此刻的 deadline 重新挂钟（暂停时不挂）。 */
  const armTimer = () => {
    clearTimer();
    if (paused || dead || !Number.isFinite(deadline)) return;
    timer = window.setTimeout(() => {
      timer = 0;
      if (elapsed() >= deadline - 1) advance();
      else armTimer();
    }, Math.max(0, deadline - elapsed()));
  };

  /** 把第 i 步的图文摆上去。只管画，不动进度、不动计时。 */
  function paintStep(i: number) {
    const rule = steps[i];
    host.hidden = false;
    artEl.innerHTML = art[rule] ?? '';
    textEl.textContent = texts[rule] ?? '';
    // A 那一幅是动画，手机上也摆出来（别的几条手机上只留字，见 style.css 的 coach-bar--anim）。
    host.classList.toggle('coach-bar--anim', rule === 0);
    fadeIn(host);
    fitCoachText(textEl);
  }

  function show(i: number) {
    if (dead) return;
    at = i;
    // 正在回头看的时候这一步走掉了：把他拉回现在。
    peeking = false;
    if (peekTimer) window.clearTimeout(peekTimer);
    peekTimer = 0;
    paintStep(i);
    const cells = progEl?.children ?? [];
    for (let k = 0; k < cells.length; k++) cells[k].classList.toggle('on', k <= i);
    paintPeek();
    // 这一条的钟从零数起。
    spent = 0;
    since = now();
    const rule = steps[i];
    deadline = i === lastStep ? Infinity : rule === 0 ? A_MS : rule === 2 ? C_MS : Infinity;
    if (rule === 2 && lastView.starsReachEdge) deadline = Math.min(deadline, C_AFTER_REACH_MS);
    if (rule === 3) linesInD = 0;
    armTimer();
    opts.onChange?.();
  }

  /** 换到下一条（最后一条不走）。 */
  function advance() {
    if (dead || at < 0 || at >= lastStep) return;
    show(at + 1);
  }

  /** 这一条等的事做到了没有（结算完问）。时间到了的那一种由钟负责，不在这儿。 */
  function done(rule: number): boolean {
    if (rule === 0) return scored;
    if (rule === 1) return degraded;
    if (rule === 3) return linesInD >= D_LINES;
    return false;
  }

  /**
   * 《<》：把上一条摆回来看一眼。翻的只是「看」——这一步在等的那件事一件没变，计时一秒没停。这一步一走完，
   * show() 把他拉回现在；他自己按《>》也能立刻回来；什么都不按，PEEK_MS 之后自动回。
   */
  function peek(on: boolean) {
    if (dead) return;
    peeking = on && at > 0;
    paintStep(peeking ? at - 1 : at);
    paintPeek();
    if (peekTimer) window.clearTimeout(peekTimer);
    peekTimer = peeking ? window.setTimeout(() => peek(false), PEEK_MS) : 0;
  }

  /** 那颗键此刻是《<》、《>》，还是根本不该有。 */
  function paintPeek() {
    if (!peekEl) return;
    // 「正在回头看」这件事盖在条子本身上，让 CSS 换底色时按类去认——不用 :has()：小红书那台要兼容的内核
    // （Chrome 61）不认识它。
    host.classList.toggle('coach-bar--peek', peeking);
    const usable = steps.length > 1 && (at > 0 || peeking);
    peekEl.hidden = !usable;
    if (!usable) return;
    peekEl.textContent = peeking ? '›' : '‹';
    peekEl.setAttribute('aria-label', peeking ? STRINGS[opts.lang].next : STRINGS[opts.lang].coachPrev);
    peekEl.classList.toggle('coach-peek--fwd', peeking);
  }

  function start() {
    clearTimer();
    at = -1;
    scored = false;
    degraded = false;
    linesInD = 0;
    lastView = { starsReachEdge: false };
    if (plan === 'first') return show(0);
    // 第二副棋盘：条件到之前不出声（observe 里接上第 0 步）。
    host.hidden = true;
    opts.onChange?.();
  }

  /**
   * 窗口一变（转屏、拖窗口），手机端那一档的字号跟着变（它按 vh 算），两行摆不摆得下要重量一次。字体晚到也一样。
   */
  const refit = () => {
    if (!dead && !host.hidden) fitCoachText(textEl);
  };
  window.addEventListener?.('resize', refit);
  if (typeof document !== 'undefined') void document.fonts?.ready.then(refit);

  peekEl?.addEventListener('click', () => peek(!peeking));

  start();

  return {
    observe(view) {
      if (dead) return;
      lastView = view;
      if (at < 0) {
        // 第二副棋盘：D 等「某色星星够一条外边」开口。
        if (plan === 'second' && view.starsReachEdge) show(0);
        return;
      }
      // C：「某色星星数 ≥ 当前最短外边」第一次成立——从这一刻起再摆 5 秒（总长不超过 10 秒）。
      if (steps[at] === 2 && view.starsReachEdge) {
        const cap = elapsed() + C_AFTER_REACH_MS;
        if (cap < deadline) {
          deadline = cap;
          armTimer();
        }
      }
      // 等的事做到了就换；换过去的那一条要是等的事也早就做到了（同一步里又得分又降级），接着换。
      while (at < lastStep && done(steps[at])) show(at + 1);
    },
    signal(sig, count = 1) {
      if (dead) return;
      if (sig === 'score') scored = true;
      if (sig === 'erosion') degraded = true;
      if (sig === 'line' && at >= 0 && steps[at] === 3) linesInD += count;
    },
    hint() {
      if (dead || at < 0) return null;
      return HINT_OF[steps[at]] ?? null;
    },
    pause() {
      if (dead || paused) return;
      spent += now() - since;
      paused = true;
      clearTimer();
    },
    resume() {
      if (dead || !paused) return;
      paused = false;
      since = now();
      armTimer();
    },
    reset() {
      if (dead) return;
      peeking = false;
      if (peekTimer) window.clearTimeout(peekTimer);
      peekTimer = 0;
      paused = false;
      start();
    },
    destroy() {
      dead = true;
      clearTimer();
      if (peekTimer) window.clearTimeout(peekTimer);
      peekTimer = 0;
      window.removeEventListener?.('resize', refit);
      host.classList.remove('coach-bar--rules', 'coach-bar--anim');
      host.hidden = true;
      host.innerHTML = '';
    },
  };
}

/**
 * 炸弹 / 无限反转 / 老虎机头一回进来时的那一句提示。
 *
 * 和上面那块是同一条子、同一个盒子，但没有进度、不跟着玩家走——就一句话加一幅图。这几个
 * 玩法是在基础规则上加一层，加的是哪一层一句话说得完。
 *
 * 摆一整局，不定时走掉（玩家定的）。原先是 15 秒自己消失，问题是这一句正是
 * 他这一局要用的那条规矩——炸弹为什么炸、反面为什么又翻回来——读完还得能回
 * 头再看一眼。而且它只在头一回进这个玩法时出现，之后想看去《暂停》和信息栏
 * 的《教学》里找（见 ui/tutorialPicker.ts）。
 *
 * 手机端那一档两倍字号**不管这一句**（它没有 `coach-bar--rules`）：第 15 推说的是那五条，
 * 而这几句本来就是三四个短句连着，两倍之下没有一句摆得进两行。
 */
export function mountCoachTip(host: HTMLElement, text: string, art: string): { destroy(): void } {
  frame(host, 0);
  const artEl = host.querySelector('.coach-art') as HTMLElement;
  // 有几句是没有配图的（计时、特殊布局）：空着的那个格子会留下一道说不清的
  // 缝，索性收掉，让那一句自己占满这块条子。
  artEl.innerHTML = art;
  artEl.hidden = !art;
  (host.querySelector('.coach-text') as HTMLElement).textContent = text;
  fadeIn(host);

  return {
    destroy() {
      host.hidden = true;
      host.innerHTML = '';
    },
  };
}

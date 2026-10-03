/**
 * 棋盘底下那块教学条。
 *
 * **第 15 推（玩家 2026-10-03）把「什么时候讲哪一条」整个换了个方向。**
 *
 * 从前每一条都等玩家**做到**那件事才往下走：得一次分、凑一组带星星的、削掉一条边。听着
 * 很对，落到一局里却处处别扭——第 3 条「得分图案会随着游戏解锁而变化」要等阶梯真的降一
 * 级，头几分钟根本见不到，只好让《得分图案》那一块当场演一遍「四枚变三枚」（E24）；第 4
 * 条常常在他早就消过边之后才姗姗来迟。现在反过来：**每一条等它说的那件事在盘面上真的出
 * 现**，出现了才讲：
 *
 *   第 1 条「色块拼出得分图案会得分翻面，变成其他颜色的星星」  开局就讲，12 秒后换下一条
 *   第 2 条「星星可以与色块一同再次拼出得分图案」              紧跟第 1 条
 *   第 3 条「得分图案会随着游戏解锁而变化」                    当前一级剩下的段数 ≤ 4 时
 *   第 4 条「同色星星在整体的外边会得分并消除」                场上第一次出现「某一种颜色的星星
 *                                                              枚数 ≥ 最短外边的长度」时
 *   第 5 条「尝试全部消除吧～」                                第一次真的消掉一条外边之后，一直
 *                                                              留到这一局结束
 *
 * 一次只摆一条，按顺序；轮到某一条时如果它的条件早就满足了，立刻摆。进度条五格。
 *
 * 「立刻」有一个下限：**上一条要读得完**（MIN_READ_MS）。第 3 条的条件完全可能在第 1 条还
 * 摆着的时候就满足了，那时候第 2 条一露面就被换掉，等于没讲。
 *
 * **第二副基础棋盘（plan: 'second'）只讲第 4 条，触发条件同上。** 他刚打完一局别的，前几条
 * 跟着走过一遍了；只有「外边怎么消」是这一族自己的事（小球是最外面的一条线，方块是任意整
 * 行整列，见 i18n 的 TUTORIAL_RULE4）。条件没到之前这块条子不出声。
 *
 * ── 呼吸灯 ────────────────────────────────────────────────────────────
 *
 * 条子还说了算「此刻该亮哪一种组」（`hint()`，表在 HINT_OF）：只在**再走一步就能完成这一
 * 条**的时候亮，只亮会参与的那几枚。认组、挑组、画灯不在这儿——挑组在
 * engine/coachHint.ts，认组是棋盘自己的判定，画灯是棋盘的 render（`coach-glow`）。条子只
 * 在换了一条时喊一声（`onChange`），让控制器重算。
 *
 * 从前那盏灯（E23）打在「这一条句子里那样东西」上：HUD 那块《得分图案》、托盘上那条外边带
 * 子。它指得出**名词**，指不出**下一步**——玩家看着一块发光的牌子，仍然不知道该滑哪一枚。
 * 那两处第 15 推起不再参与教学亮灯（玩家原话：「得分图案块和外边指引带不再参与教学亮
 * 灯」）。
 *
 * ── 第 15 推一起拆掉的几样 ────────────────────────────────────────────
 *
 *   · E24 的演示（`onDemo` → patternBlock 的 demo，变红、四枚↔三枚来回）：第 3 条现在等
 *     图案**真的**快变了才讲，用不着演。
 *   · 「做到过才算讲过」那格存档（erosionTaught / setCoachStoreKey / MAKEUP_EROSION）：第
 *     二副棋盘只讲第 4 条，不再补讲第 3 条。
 *   · 第 1 步 22 秒后换一句更具体的（coachNudge）、每一步 40 秒的保底（STUCK_MS）、第二副
 *     棋盘「得三次分才开口」：每一条什么时候出来，现在由它自己的条件说了算。
 *
 * 文字和配图跟着这一局的图形走（见 i18n 的 tutorialRules、ruleArt 的 buildRuleArt）：小球
 * 那一局讲小球、画小球，方块那一局讲方块、画方块。
 */
import { STRINGS, tutorialRules, type Lang } from '../i18n';
import type { CoachHint } from '../engine/coachHint';
import { buildRuleArt } from './ruleArt';

export type { CoachHint };

/**
 * 连锁里发生过的两件事。gameController 在那一拍里报进来；条子**只记下**，等这一步结算完
 * （observe）再看——话要等那一下的动画演完再换，别抢在消除动画前面。
 *
 *   line     真的消掉了一条外边（方块：一整行 / 一整列）——第 5 条等它
 *   erosion  阶梯降了一级——第 3 条的「剩下的段数 ≤ 4」可能在一步之内整个被跨过去（一步
 *            翻了八枚，从 6 段直接降级、新的一级满格），结算之后再看段数就看不出来了
 */
export type CoachSignal = 'line' | 'erosion';
/** 这一局玩的是哪种图形。三角没有自己那套配图，用通稿那份。 */
export type CoachShape = 'square' | 'circle' | 'triangle';
/** 哪一种排法，见文件开头。 */
export type CoachPlan = 'first' | 'second';

/** 每一步结算（连锁跑完）之后，盘面此刻的样子。gameController 问齐了交进来。 */
export interface CoachView {
  /** 当前这一级还剩几段（engine/erosion.ts；段数＝翻面枚数）。 */
  segLeft: number;
  /**
   * 某一种颜色的星星枚数 ≥ 最短外边的长度（方块用较短那条边）。
   *
   * 由棋盘自己数（`coachStarsReachEdge`）：「最短外边」只有棋盘自己知道——小球那副是此刻
   * 削得动的最短那条外边，方块是此刻较短的那条边，消掉整行整列之后都会变。
   */
  starsReachEdge: boolean;
}

/** 第 3 条：当前一级剩下的段数 ≤ 这个数时讲（再翻最多 4 枚，图案就少一枚）。 */
const NEAR_SEGS = 4;

/** 盘面上出现过什么——「场上第一次出现」，所以记下来就不再忘（一局之内）。 */
interface Seen {
  /** 第 3 条：段数到过 ≤ NEAR_SEGS，或者已经降过一级。 */
  near: boolean;
  /** 第 4 条：某色星星到过 ≥ 最短外边。 */
  reach: boolean;
  /** 第 5 条：真的消掉过一条外边。 */
  line: boolean;
}

/** 第 i 条（tutorialRules 的下标）什么时候能出来。 */
const READY: readonly ((s: Seen) => boolean)[] = [
  () => true, // 第 1 条：开局就讲
  () => true, // 第 2 条：紧跟第 1 条
  (s) => s.near,
  (s) => s.reach,
  (s) => s.line,
];

/**
 * 第 i 条该亮哪一种组（engine/coachHint.ts 的 CoachHint）。玩家的原话一一对应：
 *
 *   第 1、3 条  一步就能拼出当前级 1×N 的那几枚**色块**（不亮星星）
 *   第 2 条     一步就能拼出的、同时含星星和色块的那一组
 *   第 4 条     一步就能填满一条可消除外边的那几颗同色星星
 *   第 5 条     不亮
 */
export const HINT_OF: readonly (CoachHint | null)[] = ['front', 'mixed', 'front', 'edge', null];

/** 两种排法各讲哪几条、按什么顺序（tutorialRules 的下标）。 */
const PLAN_STEPS: Record<CoachPlan, readonly number[]> = {
  first: [0, 1, 2, 3, 4],
  second: [3],
};

/** 第 1 条摆多久（玩家定的：「开局显示，12 秒后自动换下一条」）。 */
const RULE1_MS = 12000;

/**
 * 别的每一条至少摆这么久，下一条才能接上——哪怕下一条的条件早就满足了。
 *
 * 一句话加一幅图，读一遍要五六秒。从前那条「提前做过的只亮 2.6 秒」量出来就是读不完：第
 * 4 条经常一闪而过，玩家等于没看见（后来改成 6 秒，见 git 历史里的 ALREADY_READ_MS）。
 */
const MIN_READ_MS = 6000;

/** 回头看上一条，最多停这么久，然后自己回到现在（见 peek）。 */
const PEEK_MS = 12000;

export interface CoachBar {
  /** 一步结算完了（连锁跑完）：看一眼盘面，该换哪一条就换。 */
  observe(view: CoachView): void;
  /** 连锁里发生了一件事（见 CoachSignal）。只记下，不当场换条。 */
  signal(sig: CoachSignal): void;
  /** 此刻这一条该亮哪一种组；不该亮（第 5 条、条子还没开口）回 null。 */
  hint(): CoachHint | null;
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
   * 换了一条（含开口、重开）。呼吸灯亮哪一种组跟着条走，所以控制器要在这时候重算一次。
   *
   * 由外面传进来，而不是条子自己去摸棋盘：条子不认识棋子，棋盘不认识条子，两样都在
   * gameController 手上。
   */
  onChange?: () => void;
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
 * 手机端那一档：字号是平时的两倍，最多两行（第 15 推，玩家原话「字号放大到现在的 2 倍以
 * 上，最多两行，不能压住棋盘」）。
 *
 * 两倍是 CSS 给的（style.css 里 `.coach-bar--rules .coach-text` 那一档，同时给一个
 * `--coach-lines: 2`）。这儿只管一件 CSS 做不到的事：**两倍摆不进两行的那几句往回收**，一
 * 次收 1px，收到平时那一档（两倍的一半）为止——再小就比改之前还小了。
 *
 * ⚠️ 量过（390×844 / 360×640 / 375×667 / 430×932）：中文五条里只有小球那一局的第 4 条
 * （46 个字，i18n 的 TUTORIAL_RULE4）两倍摆不进两行，收到约 1.1 倍；英、法两种语言的句子本
 * 来就长，多数条收在 1.1–1.9 倍之间，小球第 4 条的法文收到平时那一档还要三行多。这是方
 * 案里「两倍」和「最多两行」两条在长句上的冲突，已经报给玩家拍板；在拍板之前，两行优先
 * （不压棋盘是硬的），字号能大多少大多少。
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
  const floor = big / 2;
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
  const texts = tutorialRules(opts.lang, opts.shape);
  const art = opts.art ?? artFor(opts.shape);
  const steps = PLAN_STEPS[plan];
  const lastStep = steps.length - 1;
  /**
   * 进度条按「步」算：**走一格，屏幕上换一屏**。只有从第 1 条讲起的那一路才画——第二副
   * 棋盘只讲一条，画一条走到头的进度条只会让人以为自己漏了前面几条。
   */
  const segs = steps[0] === 0 ? steps.length : 0;

  frame(host, segs);
  // 这一块摆的是五条规则（不是那几个玩法头一回进来的一句提示）：手机端两倍字号只认它，
  // 见 style.css 的 `.coach-bar--rules`。
  host.classList.add('coach-bar--rules');

  const progEl = host.querySelector<HTMLElement>('.coach-prog');
  const artEl = host.querySelector<HTMLElement>('.coach-art')!;
  const textEl = host.querySelector<HTMLElement>('.coach-text')!;
  const peekEl = host.querySelector<HTMLButtonElement>('.coach-peek');

  /** 正在摆第几步（steps 的下标）；-1 = 还没开口（第二副棋盘那一路）。 */
  let at = -1;
  /** 这一步读够了没有：够了，下一条的条件一满足就接上。 */
  let readDone = true;
  let seen: Seen = { near: false, reach: false, line: false };
  /** 正在回头看上一条（见 peek）。 */
  let peeking = false;
  let peekTimer = 0;
  let timer = 0;
  let dead = false;

  const clear = () => {
    if (timer) window.clearTimeout(timer);
    timer = 0;
  };

  /** 把第 i 步的图文摆上去。只管画，不动进度、不动计时。 */
  function paintStep(i: number) {
    const rule = steps[i];
    host.hidden = false;
    artEl.innerHTML = art[rule] ?? '';
    textEl.textContent = texts[rule] ?? '';
    fadeIn(host);
    fitCoachText(textEl);
  }

  function show(i: number) {
    if (dead) return;
    at = i;
    // 正在回头看的时候这一步走掉了：把他拉回现在。走掉的那一条他刚刚还在读，而现在这一
    // 条才是他手上要做的事——留在过去等于漏掉一条。
    peeking = false;
    if (peekTimer) window.clearTimeout(peekTimer);
    peekTimer = 0;
    paintStep(i);
    const cells = progEl?.children ?? [];
    for (let k = 0; k < cells.length; k++) cells[k].classList.toggle('on', k <= i);
    paintPeek();
    clear();
    // 最后一步不走（「一直保留到这一局结束」）。
    if (i < lastStep) {
      readDone = false;
      timer = window.setTimeout(() => {
        timer = 0;
        readDone = true;
        tryAdvance();
      }, plan === 'first' && i === 0 ? RULE1_MS : MIN_READ_MS);
    }
    opts.onChange?.();
  }

  /** 下一条能不能接上：这一条读够了，而且下一条的条件满足了。 */
  function tryAdvance() {
    if (dead) return;
    const next = at + 1;
    if (next > lastStep || !readDone) return;
    if (!READY[steps[next]](seen)) return;
    show(next);
  }

  /**
   * 《<》：把上一条摆回来看一眼。
   *
   * 翻的只是「看」——这一步在等的那件事一件没变，计时一秒没停（show 里那个定时器跟 peek
   * 完全无关）。所以回头看不会让他卡在过去：这一步一走完，show() 把他拉回现在；他自己按
   * 《>》也能立刻回来；什么都不按，PEEK_MS 之后自动回。
   *
   * 三道保险都留着，是因为这一颗键的风险正是「看着看着忘了回来」——那就成了「意料之外的
   * 疏漏操作」。
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
    // 「正在回头看」这件事盖在条子本身上，让 CSS 换底色时按类去认——不用 :has()：小红书
    // 那台要兼容的内核（Chrome 61）不认识它，整条规则会连同它一起作废，不白屏、不报错，
    // 就是底色不变（同 style.css 里 body:has(.app--game) 那一段栽过的坑）。
    host.classList.toggle('coach-bar--peek', peeking);
    // 第一步没有「上一条」；第二副棋盘那一路只讲一条，也不必有。
    const usable = steps.length > 1 && (at > 0 || peeking);
    peekEl.hidden = !usable;
    if (!usable) return;
    peekEl.textContent = peeking ? '›' : '‹';
    peekEl.setAttribute('aria-label', peeking ? STRINGS[opts.lang].next : STRINGS[opts.lang].back);
    peekEl.classList.toggle('coach-peek--fwd', peeking);
  }

  function start() {
    clear();
    at = -1;
    readDone = true;
    if (plan === 'first') return show(0);
    // 第二副棋盘：条件到之前不出声（observe 里 tryAdvance 接上第 0 步）。
    host.hidden = true;
    opts.onChange?.();
  }

  /**
   * 窗口一变（转屏、拖窗口），手机端那一档的字号跟着变（它按 vh 算），两行摆不摆得下要重
   * 量一次。字体晚到也一样：量的时候用的是兜底字体，换上正式字体之后宽度会变。
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
      if (view.segLeft <= NEAR_SEGS) seen.near = true;
      if (view.starsReachEdge) seen.reach = true;
      tryAdvance();
    },
    signal(sig) {
      if (dead) return;
      if (sig === 'line') seen.line = true;
      if (sig === 'erosion') seen.near = true;
    },
    hint() {
      if (dead || at < 0) return null;
      return HINT_OF[steps[at]] ?? null;
    },
    reset() {
      if (dead) return;
      seen = { near: false, reach: false, line: false };
      peeking = false;
      if (peekTimer) window.clearTimeout(peekTimer);
      peekTimer = 0;
      start();
    },
    destroy() {
      dead = true;
      clear();
      if (peekTimer) window.clearTimeout(peekTimer);
      peekTimer = 0;
      window.removeEventListener?.('resize', refit);
      host.classList.remove('coach-bar--rules');
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

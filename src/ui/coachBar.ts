/**
 * 棋盘底下那块教学条。
 *
 * 六条规矩不摊开给他读，跟着他的手走：讲完一件事，等他真的做到，再讲下一
 * 件。两种排法，都是这一块条子。
 *
 * **一、头一局小球（plan: 'first'）**——玩家头一回打开就被直接按进的那一局
 * （main.ts 的 isFirstRun）。分镜动画不放了，六条全靠这块条子讲，走四步：
 *
 *   第 1+2 条 正反两面 / 同色凑成图案就得分 → 得两次分才走（或者第一次得分
 *                                              之后 8 秒还没有第二次，也走）
 *   第 3 条   反面也能一起凑                → 他真的用反面凑出一组
 *   第 4 条   反面同色连成一行就消          → 他真的消掉一行 / 一列
 *   第 5+6 条 怎么结束 / 综合得分怎么算     → 最后一步，一直留到这一局结束
 *
 * 第 1、2 条并成一步（玩家定的）：第 1 条讲「图形有两面」，本身没有可做的
 * 事，单独占一屏只能干等；和第 2 条摆在一起，他一边读一边就能去凑那一组。
 * 最后两条同理——都是「这一局怎么算完」，一起摆完事。并了之后条子高一截，所
 * 以这两步整体压扁一点（.coach-bar--pair），别把棋盘挤小。
 *
 * 这一路还会让棋盘上方那排得分目标一起慢慢发光（.coach-aim，样式在
 * style.css 的 glow-pulse）：第 2 条说的「同色凑成得分图案」是哪几个图案，
 * 答案本来就挂在他头顶上，只是没人指过。
 *
 * **二、头一回玩方块（plan: 'square'）**——他刚打完那一局小球，六条已经听过
 * 一遍了，所以这块条子先不出声，等他自己打出三次得分再开口，讲三步：
 *
 *   第 4 条   反面同色连成一行/列就消除，方块消掉不再出现 → 他真的消掉一行
 *   第 5 条   全部翻到反面这一局就结束                    → 摆 8 秒
 *   第 5+6 条 加上综合得分怎么算                          → 到这一局结束
 *
 * 玩家的原话：「只有到了出现了三次得分后出现，关于反面同色连起来消除的教
 * 学，然后消除后引发下一条教学内容……然后播放 8s 之后就是……最后那两条教学一
 * 起直到游戏结束」。
 *
 * 两路共通的三条规矩，把它和一个「读不完就卡住」的东西分开：
 *
 *   · **提前做到的记下来。** 玩家可能第一步就消掉一行——那时候条子还停在第 1
 *     条。不能跳过（跳过等于没讲），也不能装作没发生，所以记在 hit 里；轮到那
 *     一条时只停 ALREADY_MS，亮一下就走。
 *   · **谁也不许卡死。** 第 3 条要「反面和正面凑一组」，一局里未必凑得出来。
 *     每一步都压着 STUCK_MS 的保底，到点自己往下走——一块永远不动的提示比讲
 *     错还糟。方块那一路「等三次得分」也压着同一道保底。
 *   · **最后一步不走。** 玩家自己定的：「最后一条一直显示到游戏结束」。
 *
 * 文字和配图跟着这一局的图形走（见 i18n 的 tutorialRules、ruleArt 的
 * buildRuleArt）：小球那一局讲小球、画小球，方块那一局讲方块、画方块——他
 * 眼前只有一种图形，讲另一种是在他手上这一局里插一段用不上的话。
 */
import { tutorialRules, type Lang } from '../i18n';
import { buildRuleArt } from './ruleArt';

/** 玩家做了什么。gameController 在它已经知道的那几个点上报进来。 */
export type CoachSignal = 'move' | 'match' | 'mixed' | 'line';
/** 这一局玩的是哪种图形。 */
export type CoachShape = 'square' | 'circle';
/** 哪一种排法，见文件开头。 */
export type CoachPlan = 'first' | 'square';

/** 一步：摆哪几条，靠什么走到下一步。 */
interface Step {
  /** 摆出来的那几条（tutorialRules 的下标）。 */
  readonly rules: readonly number[];
  /** 要玩家做到的那个动作。留空 = 没有可做的事，摆够 ms 就走。 */
  readonly by?: CoachSignal;
  /** 要做到几次，默认一次。 */
  readonly times?: number;
  /**
   * by 留空时：摆够这么久就走。
   * by 有值而 times > 1 时：做到第一次之后再等这么久，没凑够次数也走——他已
   * 经会了，别为了凑一个数把他扣在这一条上。
   */
  readonly ms?: number;
}

/** 头一局小球：四步。 */
const PLAN_FIRST: readonly Step[] = [
  { rules: [0, 1], by: 'match', times: 2, ms: 8000 },
  { rules: [2], by: 'mixed' },
  { rules: [3], by: 'line' },
  { rules: [4, 5] },
];

/** 头一回玩方块：三步。开口之前还有一道门槛，见 SQUARE_OPEN。 */
const PLAN_SQUARE: readonly Step[] = [
  { rules: [3], by: 'line' },
  { rules: [4], ms: 8000 },
  { rules: [4, 5] },
];

/**
 * 方块那一路：打出这么多次得分之后，条子才开口。
 *
 * 他刚打完一局小球，规矩听过一遍了。先让他自己打，打顺了（三次得分）再补
 * 那一条他还没见过的——反面同色连成一行会消除。
 */
const SQUARE_OPEN: { by: CoachSignal; times: number } = { by: 'match', times: 3 };

/** 做到之后隔多久换下一条：让那一下的动画先演完，别抢在得分动画前面。 */
const AFTER_MS = 1100;

/** 没有动作可做的那几步，默认摆多久。 */
const READ_MS = 8000;

/** 这一条要做的事，他在轮到它之前就已经做过了：亮一下算个招呼就走。 */
const ALREADY_MS = 2600;

/**
 * 保底。一分钟还没做到，就当这一局凑不出来，自己往下走。
 *
 * 一块永远不动的提示比讲错还糟——玩家会以为它坏了，或者以为自己漏了什么。
 */
const STUCK_MS = 60000;

export interface CoachBar {
  /** 玩家做了一件事。不认识的、已经走过的，静静吞掉。 */
  signal(sig: CoachSignal): void;
  /** 重开一局：回到起点，做到过的也一并忘掉。 */
  reset(): void;
  destroy(): void;
}

export interface CoachOpts {
  lang: Lang;
  shape: CoachShape;
  plan?: CoachPlan;
  /** 六幅配图。不给就按 shape 现算——网页版三种图形都在，小红书版另给一份。 */
  art?: readonly string[];
}

/** 按形状算出来的那份配图只算一次：一局里要用六回，每回重画一遍是白费。 */
const ART_CACHE = new Map<CoachShape, string[]>();
function artFor(shape: CoachShape): string[] {
  let a = ART_CACHE.get(shape);
  if (!a) {
    a = buildRuleArt({ shape });
    ART_CACHE.set(shape, a);
  }
  return a;
}

/** 条子的骨架：顶上几段进度，底下摆几行「一幅图 + 一句话」。 */
function frame(host: HTMLElement, segs: number, rows: number): void {
  host.hidden = false;
  host.innerHTML =
    (segs > 0
      ? `<div class="coach-prog" aria-hidden="true">${'<span class="coach-seg"></span>'.repeat(segs)}</div>`
      : '') +
    `<div class="coach-row"><span class="coach-art tut-rule-art"></span><p class="coach-text"></p></div>`.repeat(
      rows,
    );
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
 * @param host 外壳里那块 `.coach-bar`（gameShell 只有 meta.coach 时才画它）。
 */
export function mountCoachBar(host: HTMLElement, opts: CoachOpts): CoachBar {
  const plan: CoachPlan = opts.plan ?? 'first';
  const texts = tutorialRules(opts.lang, opts.shape);
  const art = opts.art ?? artFor(opts.shape);
  const steps = plan === 'square' ? PLAN_SQUARE : PLAN_FIRST;
  const lastStep = steps.length - 1;
  /** 一步里最多摆几行——骨架按这个数一次画够，换步时只改内容不重建。 */
  const rows = Math.max(...steps.map((st) => st.rules.length));
  /** 进度条按「条」算：玩家看到的是六条规矩，摆在几步里是我们的事。 */
  const segs = texts.length;

  frame(host, segs, rows);

  /**
   * 讲到第 2、3 条的时候，棋盘上方那排得分目标跟着微微发光。
   *
   * 这两条说的都是「同色凑成得分图案」——是哪几个图案，答案本来就挂在他头顶
   * 上，只是从来没人指过。讲完这两条就把光撤了：再亮下去就成了噪音（玩家
   * 定的：「在播放到第二条和第三条教学的时候，上方的得分目标图案微微闪烁」）。
   */
  const stage = host.closest('.app--game');
  /** 这一步里有没有第 2 条或第 3 条（下标 1、2）。 */
  const aims = (step: Step) => step.rules.some((r) => r === 1 || r === 2);

  const progEl = host.querySelector('.coach-prog') as HTMLElement;
  const rowEls = Array.from(host.querySelectorAll<HTMLElement>('.coach-row'));

  let at = -1;
  /** 整局里他做到过哪些事——用来认「这一条我提前就做过了」。 */
  let hit = new Set<CoachSignal>();
  /** 当前这一步里，要等的那个动作做到了几次。 */
  let done = 0;
  /** 条子开口了没有。方块那一路要等够 SQUARE_OPEN 才开口。 */
  let open = plan !== 'square';
  /** 方块那一路：开口之前数他得了几次分。 */
  let opening = 0;
  let timer = 0;
  let dead = false;

  const clear = () => {
    if (timer) window.clearTimeout(timer);
    timer = 0;
  };
  const later = (ms: number, run: () => void) => {
    clear();
    timer = window.setTimeout(run, ms);
  };

  function show(i: number) {
    if (dead) return;
    at = i;
    done = 0;
    const step = steps[i];
    host.hidden = false;
    // 用满的那几行填内容，多出来的收起来——行是一次画够的，来回增删会把
    // 淡入动画打断，也会让读屏软件把整块条子当成新的再念一遍。
    rowEls.forEach((row, k) => {
      const rule = step.rules[k];
      row.hidden = rule === undefined;
      if (rule === undefined) return;
      (row.querySelector('.coach-art') as HTMLElement).innerHTML = art[rule] ?? '';
      (row.querySelector('.coach-text') as HTMLElement).textContent = texts[rule] ?? '';
    });
    // 这一步摆两条的时候整体压扁一点，别把棋盘挤小。
    host.classList.toggle('coach-bar--pair', step.rules.length > 1);
    stage?.classList.toggle('coach-aim', aims(step));
    const upto = step.rules[step.rules.length - 1];
    const cells = progEl.children;
    for (let k = 0; k < cells.length; k++) cells[k].classList.toggle('on', k <= upto);
    fadeIn(host);
    arm(i);
  }

  /** 摆好这一步之后，安排它怎么走到下一步。 */
  function arm(i: number) {
    if (i >= lastStep) return clear(); // 最后一步不走
    const step = steps[i];
    // 没有可做的事：摆够读一遍的时间。
    if (!step.by) return later(step.ms ?? READ_MS, () => show(i + 1));
    // 这一条要做的事他早就做过了：亮一下算个招呼。次数要求不止一次的那一步
    // 不走这条捷径——「得两次分」本来就是让他多做一次，提前做过不算数。
    if ((step.times ?? 1) === 1 && hit.has(step.by)) {
      return later(ALREADY_MS, () => show(i + 1));
    }
    later(STUCK_MS, () => show(i + 1));
  }

  function start() {
    at = -1;
    done = 0;
    opening = 0;
    open = plan !== 'square';
    if (open) return show(0);
    // 方块那一路：先不出声，等他自己打出三次得分。一分钟还没打出来也开口，
    // 免得这块条子一整局都不见人。
    host.hidden = true;
    later(STUCK_MS, () => {
      open = true;
      show(0);
    });
  }

  start();

  return {
    signal(sig) {
      if (dead) return;
      hit.add(sig);
      // 还没开口：数够那几次得分就开讲。
      if (!open) {
        if (sig !== SQUARE_OPEN.by) return;
        if (++opening < SQUARE_OPEN.times) return;
        open = true;
        return later(AFTER_MS, () => show(0));
      }
      if (at < 0 || at >= lastStep) return;
      const step = steps[at];
      if (step.by !== sig) return;
      const need = step.times ?? 1;
      if (++done >= need) return later(AFTER_MS, () => show(at + 1));
      // 还差几次，但这一步给了个宽限：第一次做到之后再等这么久，没凑够也走。
      if (done === 1 && step.ms) later(step.ms, () => show(at + 1));
    },
    reset() {
      if (dead) return;
      hit = new Set();
      clear();
      start();
    },
    destroy() {
      dead = true;
      clear();
      stage?.classList.remove('coach-aim');
      host.hidden = true;
      host.innerHTML = '';
    },
  };
}

/**
 * 炸弹 / 无限反转 / 老虎机头一回进来时的那一句提示。
 *
 * 和上面那块是同一条子、同一个盒子，但没有六段进度、不跟着玩家走——就一句
 * 话加一幅图。这三个玩法是在基础规则上加一层，加的是哪一层一句话说得完。
 *
 * 摆一整局，不定时走掉（玩家定的）。原先是 15 秒自己消失，问题是这一句正是
 * 他这一局要用的那条规矩——炸弹为什么炸、反面为什么又翻回来——读完还得能回
 * 头再看一眼。而且它只在头一回进这个玩法时出现，之后想看去《暂停》和信息栏
 * 的《教学》里找（见 ui/tutorialPicker.ts）。
 */
export function mountCoachTip(host: HTMLElement, text: string, art: string): { destroy(): void } {
  frame(host, 0, 1);
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

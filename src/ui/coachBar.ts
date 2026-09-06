/**
 * 棋盘底下那块教学条。
 *
 * 两种排法，都是这一块条子：
 *
 * **一、头一局小球（plan: 'first'）**——玩家头一回打开就被直接按进的那一局
 * （main.ts 的 isFirstRun）。分镜动画不放了，六条规矩全靠这块条子讲：
 *
 *   第 1 条 每个图形都有正反两面   → 没有动作可做，摆够 10 秒读一遍
 *   第 2 条 同色凑成图案就得分      → 得一次分
 *   第 3 条 反面也能一起凑          → 得分的那一组里有反面
 *   第 4 条 反面同色连成一行就消    → 消掉一行 / 一列
 *   第 5 条 全部翻到反面这一局结束  → 没有动作可做，摆够读一遍的时间
 *   第 6 条 时间短、步数少、分高    → 最后一条，一直留到这一局结束
 *
 * **二、头一回玩方块（plan: 'square'）**——他刚打完那一局小球，六条已经听过
 * 一遍了。所以这块条子先不出声：
 *
 *   · 10 秒之内自己得了分 → 那就不用教了，把第 2 条亮一下算个招呼，剩下的
 *     一条接一条自己播完；
 *   · 10 秒了还没得过分   → 摆出第 2 条（「同色凑成图案就得分」，卡住的人缺
 *     的正是这一句），等他得分之后再往下播。
 *
 * 玩家的原话：「第一次玩矩形的时候如果 10s 没有触发任何得分，那么跳出第二
 * 条教学内容，在玩家完成得分后自动播放后续内容」。
 *
 * 'first' 那一路有三条规矩把它和一个「读不完就卡住」的东西分开：
 *
 *   · **提前做到的记下来。** 玩家可能第一步就消掉一行——那时候条子还停在第 1
 *     条。不能跳过（跳过等于没讲），也不能装作没发生，所以记在 hit 里；轮到那
 *     一条时只停 ALREADY_MS，亮一下就走。
 *   · **谁也不许卡死。** 第 3 条要「反面和正面凑一组」，一局里未必凑得出来。
 *     每一条都压着 STUCK_MS 的保底，到点自己往下走——一块永远不动的提示比讲
 *     错还糟。
 *   · **最后一条不走。** 玩家自己定的：「最后一条一直显示到游戏结束」。
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

/**
 * 第 n 条靠哪个动作算「做到了」。null = 没有动作可做，摆够 READ_MS[n] 就走。
 *
 * 第 1 条讲的是「每个图形都有正反两面」——那是一句要看明白的话，不是一件要
 * 做的事（棋盘上本来就一枚反面都没有，无从「做」起）。玩家定的：这一条摆
 * 10 秒就换，不等他动手。后面几条不变，还是做到了才走。
 */
const DONE_BY: readonly (CoachSignal | null)[] = [null, 'match', 'mixed', 'line', null, null];

/** 做到了之后再停一下：让加分、翻面那一下演完，别在半空中换文字。 */
const AFTER_MS = 1100;
/** 没有动作可做的那几条各摆多久。缺的按最后一个数算。 */
const READ_MS: readonly number[] = [10000, 8000, 8000, 8000, 8000, 8000];
/** 轮到它时早就做过了：亮一下就走。 */
const ALREADY_MS = 2600;
/** 保底：一条停够这么久还没做到，自己往下走。 */
const STUCK_MS = 60000;
/** 头一回玩方块：先不出声，等这么久还没得过分才摆出第 2 条。 */
const QUIET_MS = 10000;
/** 方块那一局得过分之后，剩下几条自己一条接一条播完。 */
const AUTO_MS = 8000;
/** 炸弹 / 无限反转 / 老虎机那句首玩提示摆多久。玩家定的：15 秒。 */
export const TIP_MS = 15000;

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

/** 条子的骨架：顶上六段进度，底下一幅图 + 一句话。 */
function frame(host: HTMLElement, segs: number): void {
  host.hidden = false;
  host.innerHTML =
    (segs > 0
      ? `<div class="coach-prog" aria-hidden="true">${'<span class="coach-seg"></span>'.repeat(segs)}</div>`
      : '') +
    `<div class="coach-row">` +
    `<span class="coach-art tut-rule-art"></span>` +
    `<p class="coach-text"></p>` +
    `</div>`;
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
  const last = Math.min(texts.length, DONE_BY.length) - 1;

  frame(host, last + 1);
  // 方块那一路先不出声：等 10 秒，或者等他自己得一次分。
  if (plan === 'square') host.hidden = true;

  const progEl = host.querySelector('.coach-prog') as HTMLElement;
  const artEl = host.querySelector('.coach-art') as HTMLElement;
  const textEl = host.querySelector('.coach-text') as HTMLElement;

  let at = -1;
  let hit = new Set<CoachSignal>();
  /** 方块那一路：得过分了没有。得过之后剩下几条自己往下走。 */
  let rolling = false;
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
    host.hidden = false;
    artEl.innerHTML = art[i] ?? '';
    textEl.textContent = texts[i] ?? '';
    const segs = progEl.children;
    for (let k = 0; k < segs.length; k++) segs[k].classList.toggle('on', k <= i);
    fadeIn(host);

    if (i >= last) return clear(); // 最后一条不走
    if (plan === 'square') {
      // 还没得过分：停在第 2 条等他，压一道 STUCK_MS 的保底免得永远不动。
      if (!rolling) {
        return later(STUCK_MS, () => {
          rolling = true;
          show(i + 1);
        });
      }
      return later(AUTO_MS, () => show(i + 1));
    }
    const need = DONE_BY[i];
    if (need === null) later(READ_MS[i] ?? READ_MS[READ_MS.length - 1], () => show(i + 1));
    else if (hit.has(need)) later(ALREADY_MS, () => show(i + 1));
    else later(STUCK_MS, () => show(i + 1));
  }

  function start() {
    if (plan === 'square') {
      host.hidden = true;
      at = -1;
      rolling = false;
      // 10 秒还没得过分，就把第 2 条摆出来。
      later(QUIET_MS, () => show(1));
    } else {
      show(0);
    }
  }

  start();

  return {
    signal(sig) {
      if (dead) return;
      hit.add(sig);
      if (plan === 'square') {
        if (rolling) return; // 已经在自己往下播了
        if (sig !== 'match') return; // 只认「得了一次分」
        rolling = true;
        // 还没出过声（10 秒内就得分了）：先把第 2 条亮一下算个招呼，再往下播。
        later(AFTER_MS, () => show(at < 0 ? 1 : at + 1));
        return;
      }
      if (at >= last) return;
      if (DONE_BY[at] !== sig) return;
      later(AFTER_MS, () => show(at + 1));
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
      host.hidden = true;
      host.innerHTML = '';
    },
  };
}

/**
 * 炸弹 / 无限反转 / 老虎机头一回进来时的那一句提示。
 *
 * 和上面那块是同一条子、同一个盒子，但没有六段进度、不跟着玩家走——就一句
 * 话加一幅图，摆 15 秒自己走掉（玩家定的）。这三个玩法是在基础规则上加一层，
 * 加的是哪一层一句话说得完，说完就该把屏幕还给他。
 */
export function mountCoachTip(
  host: HTMLElement,
  text: string,
  art: string,
  ms: number = TIP_MS,
): { destroy(): void } {
  frame(host, 0);
  (host.querySelector('.coach-art') as HTMLElement).innerHTML = art;
  (host.querySelector('.coach-text') as HTMLElement).textContent = text;
  fadeIn(host);

  let dead = false;
  const timer = window.setTimeout(() => {
    if (dead) return;
    host.hidden = true;
    host.innerHTML = '';
  }, ms);

  return {
    destroy() {
      dead = true;
      window.clearTimeout(timer);
      host.hidden = true;
      host.innerHTML = '';
    },
  };
}

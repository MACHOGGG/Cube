/**
 * 那台老虎机：三个滚筒在玩家画的那张图里真的转起来。
 *
 * 图是玩家给的 slot-machine.svg，一个像素都没改——转的东西是叠在它上面的三
 * 个窗口，位置按图自己的 viewBox 量出来（见 WINDOWS）。所以以后换一张图，
 * 只要显示区还在同一个地方，这里一行都不用动；真挪了，也只用改那几个数。
 *
 * 两个滚筒从左到右先后停住，不是一起定住——玩家的原话：「从左到右先停一个
 * 再停第二个」。停的是这一局的两个得分目标；最右边那个窗口不转，空着。
 */
import { custom } from './customIcons';
import { renderPatternHintIcons } from '../engine/patternIcon';
import { targetPatternDefs } from '../engine/targetIcon';
import { targetsOf, type Family, type TargetPattern } from '../engine/targets';

/** 玩家画的那台机器。没有这个文件就退回一块素面板，转的东西照样在。 */
const ART = custom('slot-machine') ?? '';

/**
 * 三个滚筒窗口在那张图上的位置，按它的 viewBox（897×521）折成百分比。
 *
 * 每个窗口正好罩住那张图自己画在那一格里的符号（蓝三角 x=135…242、橙圆
 * x=336…479、红方块 x=568…692，上下都在 y=239…381 之间），再往外留一点：
 * 两道黑色分隔弧（x≈268…302 和 514…548）和显示区上下那两道白弧都得露在外
 * 面——转起来时窗口是铺白底的，铺过去就把机器自己的样子盖掉了。
 */
const WINDOWS: readonly { left: number; width: number }[] = [
  { left: 14.3, width: 14.9 },
  { left: 34.3, width: 22.3 },
  { left: 61.8, width: 16.3 },
];
const WIN_TOP = 44.5;
const WIN_HEIGHT = 30.0;

export interface ReelPlan {
  /** 转的时候一张张过去的图；停下来的那一张也在里面。 */
  faces: string[];
  /** 停在 faces 的第几张。 */
  land: number;
  /** 从开转算起，第几毫秒停住。 */
  stopAt: number;
}

/** 减速滑停用多久。停之前的那一段是匀速的，慢下来的只有最后这一下。 */
const EASE_MS = 620;
/** 匀速那一段的速度，单位是「每秒过几张」。 */
const SPEED = 13;

const reduceMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 一台机器：图，加上叠在显示区上的三个空窗口。 */
export function slotMachineHtml(): string {
  const reels = WINDOWS.map(
    (w, i) =>
      `<div class="slot-reel" data-reel="${i}" aria-hidden="true" style="left:${w.left}%;width:${w.width}%;top:${WIN_TOP}%;height:${WIN_HEIGHT}%">` +
      `<div class="slot-strip"></div></div>`,
  ).join('');
  return (
    `<div class="slot-machine${ART ? '' : ' slot-machine--bare'}">` +
    (ART ? `<span class="slot-machine-art">${ART}</span>` : '') +
    reels +
    `</div>`
  );
}

/**
 * 转。
 *
 * 结果一开始就定了（plans 里的 land），滚动的那几秒纯粹是给人看的。落点的
 * 算法是「先往前滚够，再对齐」：减速开始时看当前滚到哪儿，往后找第一个既比
 * 它远至少两张半、又正好是那一张的整数位置。这样轮子永远只往前走，不会为了
 * 对齐而倒回去——倒一下就露馅了。
 *
 * 返回「别转了」：中途退出这一页时叫一声，免得一个 rAF 循环挂在已经不存在
 * 的 DOM 上。
 */
export function spinSlot(
  root: HTMLElement,
  plans: readonly ReelPlan[],
  /** 最后一个轮子停稳的那一刻。开局倒数从这儿起——转完了才数。 */
  onSettled?: () => void,
): () => void {
  const reels = Array.from(root.querySelectorAll<HTMLElement>('.slot-reel'));
  // 只转给了计划的那几个窗口；多出来的窗口铺白盖住图里画的符号，空着——
  // 玩家的原话：「删除最右侧的那个滚轴和内容，只显示随机出来的得分图案」。
  for (const el of reels.slice(plans.length)) el.classList.add('slot-reel--live');
  const lanes = reels.slice(0, plans.length).map((el, i) => {
    const plan = plans[i];
    const strip = el.querySelector<HTMLElement>('.slot-strip')!;
    // 两遍：窗口停在任何一张上时，底下都还接着一整张，接缝看不出来。
    strip.innerHTML = [...plan.faces, ...plan.faces]
      .map((f) => `<span class="slot-sym">${f}</span>`)
      .join('');
    // 铺上白底，盖住那张图自己画在显示区里的三个符号——新旧两套叠在一起谁
    // 也看不清。只在真要转的时候铺，挑图形那一页的机器仍是玩家画的原样。
    el.classList.add('slot-reel--live');
    return { el, strip, plan, p: 0, ease: null as null | { from: number; to: number; t0: number } };
  });

  // 一格有多高得量——窗口的高是按那张图的比例算出来的，只有布局定了才知道
  // 是多少像素。量出来写给 CSS（--cell），滚动也按这个数走：用百分比不行，
  // transform 的百分比是按整条带子算的，不是按一格。
  let cell = 0;
  const measure = () => {
    cell = lanes[0]?.el.clientHeight ?? 0;
    for (const lane of lanes) lane.strip.style.setProperty('--cell', `${cell}px`);
  };
  measure();
  const box = root.querySelector<HTMLElement>('.slot-machine');
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
  if (box) ro?.observe(box);

  if (reduceMotion()) {
    for (const lane of lanes) {
      lane.strip.style.transform = `translateY(${-lane.plan.land * cell}px)`;
      lane.el.classList.add('slot-reel--set');
    }
    ro?.disconnect();
    onSettled?.();
    return () => {};
  }

  let raf = 0;
  let last = 0;
  const t0 = performance.now();

  const frame = (now: number) => {
    if (!root.isConnected) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    const elapsed = now - t0;
    let running = false;
    for (const lane of lanes) {
      const n = lane.plan.faces.length;
      const before = lane.p;
      const stopStart = lane.plan.stopAt - EASE_MS;
      if (elapsed < stopStart) {
        lane.p += SPEED * dt;
        running = true;
      } else {
        if (!lane.ease) {
          // 往前找第一个「正好停在那一张」的整数位置，至少还要再滚两张半。
          let to = Math.ceil(lane.p + 2.5);
          while (((to % n) + n) % n !== lane.plan.land) to++;
          lane.ease = { from: lane.p, to, t0: elapsed };
        }
        const k = Math.min(1, (elapsed - lane.ease.t0) / EASE_MS);
        lane.p = lane.ease.from + (lane.ease.to - lane.ease.from) * backOut(k);
        if (k < 1) running = true;
        else if (!lane.el.classList.contains('slot-reel--set')) {
          lane.p = lane.ease.to;
          lane.el.classList.add('slot-reel--set');
        }
      }
      const n2 = lane.plan.faces.length;
      const wrapped = ((lane.p % n2) + n2) % n2;
      lane.strip.style.transform = `translateY(${(-wrapped * cell).toFixed(2)}px)`;
      // 转得快就糊一点：这是唯一让「在转」和「一张张换」看起来不一样的东西。
      const blur = Math.min(3.2, Math.abs(lane.p - before) * 4.5);
      lane.strip.style.filter = blur > 0.25 ? `blur(${blur.toFixed(2)}px)` : '';
    }
    if (running) raf = requestAnimationFrame(frame);
    else onSettled?.();
  };
  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    ro?.disconnect();
  };
}

/** 冲过头一点点再退回来——轮子卡进齿里的那一下。 */
function backOut(t: number): number {
  const c = 1.34;
  const u = t - 1;
  return 1 + (c + 1) * u ** 3 + c * u ** 2;
}

/**
 * 一族的图案各画成一张小图示（和棋盘上那一排是同一套画法）。
 *
 * 一枚一枚画，各按各自的外框铺满窗口——不是给整族一个统一的方框。统一方框
 * 在棋盘那一排上是对的（那儿要让人看出「这个图案摊得更开」），可轮子的窗口
 * 只有六十来个像素高，统一之后连四枚的方阵都缩成一撮小点。这儿要的是「每
 * 一张都尽可能大」，认得出是什么比互相之间的比例更重要。
 */
const facesOf = (pool: readonly TargetPattern[]): string[] =>
  pool.map((p) => `<span class="slot-face">${renderPatternHintIcons(targetPatternDefs([p]), 'zhHans')[0]}</span>`);

/**
 * 两个滚筒各转什么、各停在哪一张、第几毫秒停。
 *
 * 只转左边两个——就是这一局的两个得分图案；最右边那个窗口空着。倒数不和转
 * 动叠在一起：第二个轮子停稳了（2.6 秒）才开始 5-4-3-2-1。
 */
export function planFor(family: Family, pair: readonly TargetPattern[]): ReelPlan[] {
  const pool = targetsOf(family);
  const faces = facesOf(pool);
  const at = (p: TargetPattern) => Math.max(0, pool.findIndex((q) => q.id === p.id));
  return [
    { faces, land: at(pair[0]), stopAt: 1500 },
    { faces, land: at(pair[1] ?? pair[0]), stopAt: 2600 },
  ];
}

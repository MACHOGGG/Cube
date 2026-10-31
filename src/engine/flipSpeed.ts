/**
 * 图形翻面的快慢，玩家自己定。ero2 起收尾节拍、图案拍也跟它（站长 D22、D29，10-31 方案推14 Z-B09 / Z-B10）——拉杆
 * 名字随之改成「速度」。定格 1.4 秒、判死 1.4 秒不跟它。
 *
 * 天才特供里的一根拉杆：十档，从设计速度的一半到两倍，正中那一档标《推荐》。
 * 想看清楚每一次翻面的人可以放慢，打熟了嫌拖沓的人可以加快——这件事没有一
 * 个对所有人都对的值，所以交给玩家。
 *
 * 存的是「档位」不是毫秒。毫秒是从档位算出来的，设计时长以后要是改了
 * （FLIP_MS 现在是 350），玩家选的那一档仍然是「一半」或者「两倍」，不会因
 * 为基准变了就跟着漂。
 */
const KEY = 'slides_flip_speed';

/** 十档。倍率是「动画放多快」：2 就是快一倍（时长减半）。 */
export const FLIP_STEPS = 10;
/** 正中那一档——《推荐》，也是没设置过时的默认。 */
export const FLIP_DEFAULT_STEP = 4;

/**
 * 第 i 档的倍率：0 档 0.5 倍（慢一半），推荐档 1 倍，最后一档 2 倍。
 *
 * 中间按几何级数走，不是等差。等差的话「1 倍到 1.11 倍」和「1.8 倍到 2 倍」
 * 在手上是两种完全不同的差别——快的那头几乎分不出来。几何级数每一档的相对
 * 变化一样，拉起来才是均匀的。
 */
export function rateOfStep(step: number): number {
  const i = Math.min(FLIP_STEPS - 1, Math.max(0, Math.round(step)));
  // 0 → 0.5，FLIP_DEFAULT_STEP → 1，FLIP_STEPS-1 → 2
  const t = i <= FLIP_DEFAULT_STEP
    ? (i - FLIP_DEFAULT_STEP) / FLIP_DEFAULT_STEP
    : (i - FLIP_DEFAULT_STEP) / (FLIP_STEPS - 1 - FLIP_DEFAULT_STEP);
  return 2 ** t;
}

let step = read();

function read(): number {
  try {
    // 「没设置过」要先接住，不能直接丢给 Number()——Number(null) 是 0，而 0
    // 正好是最慢的那一档，于是所有人一进来就是半速，而且看不出是哪儿来的。
    const raw = localStorage.getItem(KEY);
    if (raw === null || raw === '') return FLIP_DEFAULT_STEP;
    const n = Number(raw);
    if (!Number.isFinite(n)) return FLIP_DEFAULT_STEP;
    return Math.min(FLIP_STEPS - 1, Math.max(0, Math.round(n)));
  } catch {
    // 私密模式：用推荐档，别让一个设置项把游戏拦住。
    return FLIP_DEFAULT_STEP;
  }
}

export const flipStep = (): number => step;
/** 现在的倍率。翻面动画拿它去除时长。 */
export const flipRate = (): number => rateOfStep(step);
export const isRecommendedStep = (i: number): boolean => i === FLIP_DEFAULT_STEP;

export function setFlipStep(next: number): void {
  const clamped = Math.min(FLIP_STEPS - 1, Math.max(0, Math.round(next)));
  if (clamped === step) return;
  step = clamped;
  try {
    localStorage.setItem(KEY, String(step));
  } catch {
    /* 存不下就只在这一次会话里生效，不值得为它报错。 */
  }
}

/**
 * 这一拍的动画倍数（10-31 方案推14 Z-B09 第 8 条）：控制器每一拍开始时设（拉杆倍率的倒数 × 自动消线拍的 0.4），放大
 * （ui/boardZoom.ts 的 ZOOM_BACK_MS / ZOOM_HOLD_MS）、淡出（五副的 REMOVE_FADE_MS）、方块收拢（COLLAPSE_FADE_MS /
 * COLLAPSE_SLIDE_MS）都乘它——于是「淡出 700 + 停 480 ≤ 这一拍的间隔 1250」对每一档、每一拍都成立。模块级一个数，
 * 默认 1（开局页、主菜单等不在连锁里的地方都是 1）。
 */
let beatK = 1;
export const beatScale = (): number => beatK;
export function setBeatScale(k: number): void {
  beatK = Number.isFinite(k) && k > 0 ? k : 1;
}

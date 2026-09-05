/**
 * 头一局那块教学条。
 *
 * 玩家头一回打开就被直接按进一局基础小球（main.ts 的 isFirstRun）。分镜动画
 * 只演「怎么滑」，剩下的规矩——什么算得分、反面能干什么、一行怎么消、什么时
 * 候算完——从前都藏在六条规则那一屏里，得他自己去点。这块条子把那六条搬到棋
 * 盘底下，一条一条摆出来：
 *
 *   第 1 条 每个图形都有正反两面   → 没有动作可做，摆够 10 秒读一遍
 *   第 2 条 同色凑成图案就得分      → 得一次分
 *   第 3 条 反面也能一起凑          → 得分的那一组里有反面
 *   第 4 条 反面同色连成一行就消    → 消掉一行 / 一列
 *   第 5 条 全部翻到反面这一局结束  → 没有动作可做，摆够读一遍的时间
 *   第 6 条 时间短、步数少、分高    → 最后一条，一直留到这一局结束
 *
 * 三条规矩把它和一个「读不完就卡住」的东西分开：
 *
 *   · **提前做到的记下来。** 玩家可能第一步就消掉一行——那时候条子还停在第 1
 *     条。不能跳过（跳过等于没讲），也不能装作没发生，所以记在 hit 里；轮到那
 *     一条时只停 ALREADY_MS，亮一下就走。
 *   · **谁也不许卡死。** 第 3 条要「反面和正面凑一组」，一局里未必凑得出来。
 *     每一条都压着 STUCK_MS 的保底，到点自己往下走——一块永远不动的提示比讲
 *     错还糟。
 *   · **最后一条不走。** 玩家自己定的：「最后一条一直显示到游戏结束」。
 *
 * 文字和配图都是六条规则那一份原件（i18n 的 TUTORIAL_RULES、ruleArt 的
 * RULE_ART），一个字都不另写——同一句话在教学挑选页、暂停面板、这儿看到的
 * 必须一模一样。小红书那一版没有三角，配图另给一份（见 coachArt）。
 */
import { TUTORIAL_RULES, type Lang } from '../i18n';
import { RULE_ART } from './ruleArt';

/** 玩家做了什么。gameController 在它已经知道的那几个点上报进来。 */
export type CoachSignal = 'move' | 'match' | 'mixed' | 'line';

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

export interface CoachBar {
  /** 玩家做了一件事。不认识的、已经走过的，静静吞掉。 */
  signal(sig: CoachSignal): void;
  /** 重开一局：回到第 1 条，做到过的也一并忘掉。 */
  reset(): void;
  destroy(): void;
}

/**
 * @param host 外壳里那块 `.coach-bar`（gameShell 只有 meta.coach 时才画它）。
 * @param art  六幅配图。默认网页版那一份；小红书版传摘掉三角的那一份。
 */
export function mountCoachBar(host: HTMLElement, lang: Lang, art: readonly string[] = RULE_ART): CoachBar {
  const texts = TUTORIAL_RULES[lang] ?? TUTORIAL_RULES.zhHans;
  const last = Math.min(texts.length, DONE_BY.length) - 1;

  host.hidden = false;
  host.innerHTML =
    `<div class="coach-prog" aria-hidden="true">${texts
      .slice(0, last + 1)
      .map(() => '<span class="coach-seg"></span>')
      .join('')}</div>` +
    `<div class="coach-row">` +
    `<span class="coach-art tut-rule-art"></span>` +
    `<p class="coach-text"></p>` +
    `</div>`;
  // 换条子是自己换的，不是玩家点出来的——读屏软件要主动念出来，不然对看不见
  // 屏幕的人这块条子等于不存在。polite：等他手上这句话读完再插进去。
  host.setAttribute('aria-live', 'polite');

  const progEl = host.querySelector('.coach-prog') as HTMLElement;
  const artEl = host.querySelector('.coach-art') as HTMLElement;
  const textEl = host.querySelector('.coach-text') as HTMLElement;

  let at = -1;
  let hit = new Set<CoachSignal>();
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
    artEl.innerHTML = art[i] ?? '';
    textEl.textContent = texts[i] ?? '';
    const segs = progEl.children;
    for (let k = 0; k < segs.length; k++) segs[k].classList.toggle('on', k <= i);
    // 一次性的淡入：先摘掉再挂上，中间读一次 offsetWidth 逼浏览器把「没有这个
    // 类」当成一帧算掉，否则连着两次换条子第二次不会重播。
    host.classList.remove('coach-in');
    void host.offsetWidth;
    host.classList.add('coach-in');

    if (i >= last) return clear(); // 最后一条不走
    const need = DONE_BY[i];
    if (need === null) later(READ_MS[i] ?? READ_MS[READ_MS.length - 1], () => show(i + 1));
    else if (hit.has(need)) later(ALREADY_MS, () => show(i + 1));
    else later(STUCK_MS, () => show(i + 1));
  }

  show(0);

  return {
    signal(sig) {
      if (dead) return;
      hit.add(sig);
      if (at >= last) return;
      if (DONE_BY[at] !== sig) return;
      later(AFTER_MS, () => show(at + 1));
    },
    reset() {
      if (dead) return;
      hit = new Set();
      show(0);
    },
    destroy() {
      dead = true;
      clear();
      host.hidden = true;
      host.innerHTML = '';
    },
  };
}

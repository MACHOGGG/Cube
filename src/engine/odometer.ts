/**
 * 数字一位一位滚到位，只在两处用：结算页那个总分、排行榜上自己那一行。
 *
 * **零件是共用的，不是第二套。** 竖排 0–9 的滚筒、一格多高、那条 .5s 的收尾曲线，
 * 全是 HUD 分数轮（engine/scoreReel.ts + style.css 的 .digit-box/.digit-strip）已
 * 经有的东西——这儿只是把同一批 DOM 摆到另外两个地方，再加一件 scoreReel 不需要
 * 的事：**错峰**（个位先落、往高位递延）。局中的分数是连着跳的，错峰会让它看起来
 * 一直在晃；结算页那一下只滚一次，错峰才读得出「一位一位落定」。
 *
 * 局内那一套仍然只属于局内：两套数数系统不并存（见 kinetics 方案 §2 的明确排除）。
 */
import { reducedMotion } from './reducedMotion';

/** 一格多高。和 style.css 的 --reel-step、scoreReel 的 REEL_STEP 是同一个数。 */
const REEL_STEP = 1.1;
/** 相邻两位之间差多久落定。个位 0ms，十位 40ms，以此类推。 */
const STAGGER_MS = 40;
/** 一位滚完要多久。和 style.css 里 .digit-strip 那句 transition 必须一致。 */
const ROLL_MS = 500;

/** 从按下去到最后一位落定，一共多久——§4 那枚勾要接在它后面。 */
export function rollDuration(value: number): number {
  const digits = String(Math.max(0, Math.round(value))).length;
  return ROLL_MS + (digits - 1) * STAGGER_MS;
}

/**
 * 把 host 里的内容换成滚筒，并滚到 value。
 *
 * 每次调用都重建：位数可能和上一局不一样（9 → 10），而在原地改容器宽度是要逐帧
 * 改 width 的，那是这一套里唯一会掉帧的做法。重建一次反而什么都不用过渡。
 */
export function rollOdometer(host: HTMLElement, value: number): void {
  const safe = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  const text = String(safe);
  // 滚筒是一堆 transform，文字内容什么都不说明：读屏软件、以及任何想读这个数的
  // 代码，都读这两样。
  host.dataset.score = text;
  host.setAttribute('aria-label', text);

  if (reducedMotion()) {
    // 直接是终值。这是一个数，不是一个特效——少了动画它照样得看得见。
    host.classList.remove('odometer');
    host.textContent = text;
    return;
  }

  host.classList.add('odometer');
  host.textContent = '';
  const strips: HTMLElement[] = [];
  for (let k = 0; k < text.length; k++) {
    const box = document.createElement('div');
    box.className = 'digit-box';
    const strip = document.createElement('div');
    strip.className = 'digit-strip';
    for (let d = 0; d < 10; d++) {
      const cell = document.createElement('span');
      cell.textContent = String(d);
      strip.appendChild(cell);
    }
    box.appendChild(strip);
    host.appendChild(box);
    strips.push(strip);
  }

  // 先让这一批以 0 的样子进排版一帧，再给目标值——不读一次 offsetWidth 的话浏览
  // 器会把「建出来」和「设定终值」并成同一次样式计算，transition 没有起点可算，
  // 于是数字直接就在终值上，一格也不滚。
  void host.offsetWidth;

  const last = strips.length - 1;
  strips.forEach((strip, i) => {
    const d = Number(text[i]);
    // i 是从高位数的，错峰要从个位数：最右那一位延迟 0。
    strip.style.transitionDelay = (last - i) * STAGGER_MS + 'ms';
    strip.style.transform = `translateY(-${d * REEL_STEP}em)`;
  });
}

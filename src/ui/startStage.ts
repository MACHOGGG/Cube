/**
 * 开局页：一张脸，一段倒数，两个按钮。
 *
 * 每一局开始之前都是同一幕——上半屏是这个玩法在主菜单上的那张图，下半屏一个
 * 圆角小窗里 3、2、1 依次荡过去，一秒一个；底下并排两颗图标，随时可以退出去
 * 或者按住不打。没有标题、没有说明文字：玩法是什么，那张图已经说完了。
 *
 * 这一幕由两个地方摆出来——单人是游戏外壳（gameShell），多人是房间页
 * （multiplayer）——所以画面和倒数都放在这里，两边共用同一套 DOM 和同一套
 * CSS，不会各画各的走样。区别只在倒数由谁驱动：单人是本地三秒，多人是服务器
 * 的开赛时刻。
 */
import { gameIcon, layoutIconIsWide, ICON_BOMB_BADGE, ICON_MULTIPLAYER } from './homeIcons';

export interface StartStageOpts {
  /** 玩法 id，决定摆哪张图。 */
  shapeId: string;
  /** 炸弹局：图旁边挂一颗炸弹标志。 */
  bomb?: boolean;
  /** 多人局：图旁边挂那扇小门。 */
  room?: boolean;
  /** 倒数窗口的 id，交给驱动它的人去拿。 */
  countId: string;
  /** 底下那一排按钮的 HTML；不给就不摆。 */
  actions?: string;
  /** 需要额外塞在倒数下面的东西（横屏提示）。 */
  extra?: string;
}

/**
 * 这一局是哪一种局，画成标志挂在玩法图旁边。
 *
 * 同一副棋盘可以是普通局、炸弹局、或者一场多人竞赛，三者的规则差得很远。
 * 光看棋盘看不出来，一行字又容易被跳过——一个图形能。
 */
export function modeBadges(bomb?: boolean, room?: boolean): string {
  const marks: string[] = [];
  if (bomb) marks.push(`<span class="mode-badge mode-badge--bomb">${ICON_BOMB_BADGE}</span>`);
  if (room) marks.push(`<span class="mode-badge mode-badge--room">${ICON_MULTIPLAYER}</span>`);
  return marks.length ? `<div class="mode-badges">${marks.join('')}</div>` : '';
}

export function startStageHtml(o: StartStageOpts): string {
  const wide = layoutIconIsWide(o.shapeId) ? ' start-mark--wide' : '';
  return `
    <div class="start-stage">
      <div class="start-emblem">
        <div class="start-mark${wide}">
          <span class="start-mark-art">${gameIcon(o.shapeId)}</span>
          ${modeBadges(o.bomb, o.room)}
        </div>
      </div>
      <div class="start-count">
        <div class="cd-window" id="${o.countId}" aria-hidden="true"></div>
      </div>
      ${o.extra ?? ''}
      ${o.actions ? `<div class="start-actions">${o.actions}</div>` : ''}
    </div>`;
}

/** 一个数字停留多久。三个数字，正好三秒。 */
export const COUNT_STEP_MS = 1000;
const DIGITS = [3, 2, 1];

/** 把一个数字放进窗口里荡一趟。动画本身写在 CSS 的 cd-swing 里。 */
export function pushDigit(win: HTMLElement, n: number | string): void {
  const d = document.createElement('span');
  d.className = 'cd-digit';
  d.textContent = String(n);
  win.appendChild(d);
  window.setTimeout(() => d.remove(), COUNT_STEP_MS + 120);
}

/**
 * 本地的三秒倒数：3、2、1，然后 done()。
 *
 * 返回的函数是「不数了」——按暂停、或者人已经离开这一页时调用，正在荡的那个
 * 数字一并清掉，免得回来的时候屏幕上还挂着上一次数到一半的痕迹。
 */
export function playCountdown(win: HTMLElement, done: () => void): () => void {
  let i = 0;
  let timer = 0;
  let stopped = false;
  const step = () => {
    if (stopped) return;
    if (i >= DIGITS.length) return done();
    pushDigit(win, DIGITS[i]);
    i += 1;
    timer = window.setTimeout(step, COUNT_STEP_MS) as unknown as number;
  };
  win.textContent = '';
  step();
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    win.textContent = '';
  };
}

/**
 * 《Pro》——给看得更细的人多给一层信息，全站一个设置。
 *
 * 和色盲友好模式同一个形状（见 engine/palettePref.ts）：不是每一局各自的开关，而是
 * 「这个人要不要」这件事本身，所以它住在个人主页、也能在暂停面板里随手拨，记在本机，
 * 并且把 `data-pro` 挂到 <html> 上，样式表跟着它走。
 *
 * 眼下它只管一件事（玩家 2026-09：「在游戏中目前有一处不同」）：**棋盘上每一枚棋子
 * 的外侧，描一圈它得分之后会变成的那颗星星的颜色**。那是一层次要信息——一条很细的
 * 线，颜色之外不占任何地方（见 engine/proHint.ts 和三份 shapes/*.css）。
 *
 * 之所以现在就单开一个模块、而不是塞进 palettePref：这两件事会分开长。色盲那一支动
 * 的是**调色板本身**（换一整套颜色），Pro 动的是**多画什么**；以后 Pro 下面还要加别
 * 的（玩家说的「目前有一处」），而那些和调色板没有关系。
 */
const KEY = 'slides_pro';
type Listener = () => void;

const listeners = new Set<Listener>();
let on = read();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** 挂到 <html> 上，样式表才跟得上（方块和小球那两圈描边纯靠 CSS 画）。 */
function paint(): void {
  if (typeof document === 'undefined') return;
  if (on) document.documentElement.setAttribute('data-pro', '1');
  else document.documentElement.removeAttribute('data-pro');
}
paint();

export function proOn(): boolean {
  return on;
}

export function setPro(next: boolean): void {
  if (next === on) return;
  on = next;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* 无痕模式：这个设置活到关窗为止 */
  }
  paint();
  for (const fn of Array.from(listeners)) fn();
}

/** 订阅；返回的函数用来退订。三副三角棋盘要它——它们那一圈是真画进 DOM 的。 */
export function onProChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

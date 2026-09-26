/**
 * 主菜单那行副标题，一个字一个字打出来。
 *
 * 为什么只有这一行、而且只打一次：
 *
 * · **只有这一行。** 同一句 `homeTagline` 在别处也露面（个人主页那几页复用同
 *   一个抬头壳），那些地方直接显示。打字是「刚进门」这件事的一部分，不是这句
 *   话的属性——每换一页都打一遍就成了噪音。
 * · **只打一次。** 模块级的布尔守着：从一局游戏返回主菜单时菜单会重绘，但那
 *   不是「刚进门」。进一局出一局打十遍，第三遍开始就只剩烦。
 *
 * 不出声（见 kinetics 方案的声音纪律：打字机无声）。reduced-motion 下直接把
 * 整句摆上去——它是文字，不是特效，少了它这一行就没内容了。
 */
import { reducedMotion } from '../engine/reducedMotion';

/** 每个字之间隔多久。四种语言共用一个数，所以法语（最长）打得久一些。 */
const CHAR_MS = 45;
/** 首帧之后等这么久才开打：让菜单先整块落定，别和入场动画抢。 */
const LEAD_MS = 300;

/** 这次页面加载里打过了没有。刷新才重置——正是想要的。 */
let played = false;

export function typeTagline(el: HTMLElement, text: string): void {
  if (played || reducedMotion()) {
    el.textContent = text;
    return;
  }
  played = true;

  // 字和光标分两个节点：光标是 span，字是它前面的文本节点。这样每打一个字只动
  // 文本节点，不必重建光标（重建会让闪烁的 keyframes 从头开始，看着像卡）。
  el.textContent = '';
  const body = document.createTextNode('');
  const caret = document.createElement('span');
  caret.className = 'home-sub-caret';
  caret.setAttribute('aria-hidden', 'true');
  el.appendChild(body);
  el.appendChild(caret);
  // 读屏软件不跟着一个字一个字念——那是六遍同一句话。整句先挂上去，屏幕上的
  // 打字只是给看得见的人的。
  el.setAttribute('aria-label', text);

  // Array.from 而不是 text.length：法语的重音字符、以后可能出现的 emoji 都是
  // 多个 UTF-16 码元，按 length 切会把一个字劈成两半（劈出来的半个字画不出来）。
  const chars = Array.from(text);
  let i = 0;

  const step = () => {
    // 他没等打完就点进了一局，菜单整块被换掉了：这一行已经不在文档里，接着打
    // 是在往一个没人看的节点上写字。自己停下，链就断在这儿。
    if (!el.isConnected) return;
    body.nodeValue = chars.slice(0, ++i).join('');
    if (i < chars.length) {
      window.setTimeout(step, CHAR_MS);
      return;
    }
    // 打完了：光标淡出再摘掉。
    caret.classList.add('home-sub-caret--out');
    window.setTimeout(() => caret.remove(), 340);
  };

  window.setTimeout(step, LEAD_MS);
}

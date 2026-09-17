/**
 * 挨过一下、还没拆掉的炸弹身上那道裂纹——六副炸弹棋盘共用的同一幅画。
 *
 * 炸弹 2026-09 改成两层：得分图案旁边的炸弹要被打中两次才拆（玩家定的数，也
 * 是三档里最均衡的一档——方块上不谨慎的玩家炸死率从 66% 降到 16%，谨慎的仍然
 * 零死亡，炸弹存在率保持八成，分数 126 最接近基础方块的 139）。第一次打中不
 * 拆，只裂，这道裂纹就是那一次的回执：玩家得看得出「这枚已经挨过一下，再来一
 * 下就没了」，不然两层规则在屏幕上根本不存在，只会觉得「怎么打了不掉」。
 *
 * 为什么是这么画的：
 *
 * · **一条主缝 + 两根分叉**，不是一个「破碎」图案。这套美术是平涂 + 圆角 + 白
 *   描边，一整块碎玻璃网格会立刻变成另一种风格；一条带分叉的缝是「同一块红色
 *   被划开了」，加进去不突兀。
 * · **深一笔在下、浅一笔在上、错开一点点**，就是凿痕的做法：深的那笔是缝里的
 *   影，浅的那笔是缝口被翻起来的高光。这一层错位是「有质感」的全部来源，成本
 *   只有一条重复的路径。
 * · **不用新颜色**，两笔都是黑与白的半透明，压在这枚棋子自己的红上。换配色
 *   （色盲友好那一套）、换成任何一档红，它都跟着走，不会有第三种颜色冒出来。
 * · **绕开正中**：正中那格是「！」，两者叠在一起谁也看不清。主缝走左偏下，副
 *   缝在右上角，正中留给那个记号。
 *
 * 坐标系 100×100，和棋子多大无关——调用方给一个 size，整幅画等比缩过去。
 */

/** 主缝：从左上角进来，两折之后斜着出右下角。 */
const MAIN: readonly [number, number][] = [
  [11, 17], [37, 39], [27, 56], [53, 71], [74, 90],
];
/** 两根分叉，都从主缝的折点上分出去。 */
const BRANCHES: readonly (readonly [number, number][])[] = [
  [[37, 39], [59, 32]],
  [[27, 56], [9, 65]],
];
/** 右上角那道副缝，让整枚棋子不只有一边受伤。 */
const SPUR: readonly [number, number][] = [[69, 13], [83, 29], [75, 43]];

const pts = (p: readonly [number, number][]) => p.map(([x, y]) => `${x},${y}`).join(' ');
const ALL = [MAIN, ...BRANCHES, SPUR];

/**
 * 裂纹，画成一段 SVG。
 *
 * @param size 这幅画占多少像素见方。方块给格子的 0.88，小球给 0.72（要留在
 *             圆里），三角给短边的 0.5 并往质心挪（见各个 shapes 文件）。
 */
export function crackSvg(size: number): string {
  const s = Math.round(size);
  // 影在下、光在上，光那一层整体挪 (0.9, −1.2)：缝口朝左上翻起来，和棋子本身
  // 的受光方向一致（这套棋子的内阴影也是从上面压下来的）。
  const shadow = ALL.map(
    (p) => `<polyline points="${pts(p)}" fill="none" stroke="rgba(0,0,0,0.42)" stroke-width="6"/>`,
  ).join('');
  const light = ALL.map(
    (p) => `<polyline points="${pts(p)}" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="2.4"/>`,
  ).join('');
  return (
    `<svg viewBox="0 0 100 100" width="${s}" height="${s}" aria-hidden="true">` +
    `<g stroke-linecap="round" stroke-linejoin="round">${shadow}` +
    `<g transform="translate(0.9 -1.2)">${light}</g></g></svg>`
  );
}

/**
 * 裂纹那一层 DOM。铺满整枚棋子、自己居中（和「！」同一个做法，见
 * style.css 的 .hazard-mark），所以棋子那层 flex 有几个孩子都不影响它。
 *
 * @param size 见 crackSvg。
 * @param padTop 三角用：整幅画往下挪一点，落到三角的质心上。
 */
export function crackLayer(size: number, padTop = 0): HTMLElement {
  const el = document.createElement('div');
  el.className = 'bomb-crack';
  if (padTop) el.style.paddingTop = Math.round(padTop) + 'px';
  el.innerHTML = crackSvg(size);
  return el;
}

/**
 * 「星星消除」那一条提示挑哪一色、亮哪几枚（10-08 方案 3-E-3：starClearHintFor）。
 *
 *   npx esbuild src/engine/coachHint.ts --bundle --format=esm --outfile=/tmp/coachhint.mjs
 *   node scripts/check-star-clear.mjs /tmp/coachhint.mjs
 *
 * 方案原话：「写纯函数 starClearHintFor(board): { color, stars[] } | null——第一步筛『该色在场星星
 * 数 ≥ 当前最外边长度』的颜色；第二步选『已在最外边上的星星最多（还需挪动最少）』的色；平局选星星
 * 总数少的；返回该色全部相关星星+参与格子作为点亮组。……门禁：新 check 构造三个局面断言返回色正确。」
 *
 * 三个局面各钉一步，每一个都摆成「换掉这一步、答案就变」：
 *   ① 第二步：星星多的那一色反而输给「已经在外边上的多」的那一色；
 *   ② 平局：两色差得一样多，星星少的那一色赢——而且它在盘面上排在后面（按先碰到的挑会挑错）；
 *   ③ 第一步：外边上已经摆满四颗的那一色只有四颗、填不满五格的外边，被筛掉。
 * 盘面是 5×5，「外边」交进去的是最外面那一圈的四条边（各 5 格）——函数本身不认几何，哪几条算外
 * 边由棋盘给（小球给 outerEdges，方块给每一整行整列），这儿手摆。
 */
const bundle = process.argv[2];
if (!bundle) {
  console.error('用法: node scripts/check-star-clear.mjs <打包好的 coachHint.mjs>');
  process.exit(2);
}
const { starClearHintFor, createCoachGlow } = await import(bundle);

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const N = 5;
/** 一副全是色块的 5×5；`stars` 是 { 颜色: [[r, c], …] }。 */
function board(stars) {
  const grid = Array.from({ length: N }, () => Array.from({ length: N }, () => ({ face: 'flavor', dotColor: 9 })));
  for (const [color, cells] of Object.entries(stars)) for (const [r, c] of cells) grid[r][c] = { face: 'dot', dotColor: Number(color) };
  return grid;
}
const RING = [
  Array.from({ length: N }, (_, c) => [0, c]), // 上
  Array.from({ length: N }, (_, c) => [N - 1, c]), // 下
  Array.from({ length: N }, (_, r) => [r, 0]), // 左
  Array.from({ length: N }, (_, r) => [r, N - 1]), // 右
];
const hintOf = (grid, edges = RING) =>
  starClearHintFor({ grid, edges, isStar: (t) => t.face === 'dot', colorOf: (t) => t.dotColor });
/** 一组格子的指纹：去重、排序（期望那一份是「星星 ＋ 那条边」直接拼的，重叠的格子会出现两次）。 */
const key = (cells) => [...new Set(cells.map(([r, c]) => `${r},${c}`))].sort().join(' ');

// ── ① 第二步：已经在外边上的多（差得少）的那一色赢，哪怕它星星少 ──────────────
{
  const A = [[0, 1], [0, 2], [0, 3], [2, 2], [3, 2]]; // 5 颗，上边已有 3 颗：还差 2
  const B = [[4, 2], [1, 1], [1, 2], [1, 3], [2, 1], [2, 3], [3, 1]]; // 7 颗，下边只有 1 颗：还差 4
  const h = hintOf(board({ 1: A, 2: B }));
  check('① 挑的是外边上已经有 3 颗的那一色（1），不是星星更多的那一色（2）', h?.color === 1, JSON.stringify(h?.color));
  // 点亮组：那一色在场的全部星星 ＋ 它差得最少的那条边（上边）的格子；同一格只算一次。
  const want = key([...A, ...RING[0]]);
  check('① 点亮组：这一色的 5 颗星星 ＋ 上边那 5 格（重的 3 格只算一次，共 7 格）',
    !!h && key(h.stars) === want && h.stars.length === 7, h ? `${h.stars.length} 格：${key(h.stars)}` : 'null');
  check('① 另一色的星星一颗都不亮', !!h && !h.stars.some(([r, c]) => B.some(([br, bc]) => br === r && bc === c)));
  check('① 星星排在前面（先亮要挪的，再是要填的那条边）', !!h && key(h.stars.slice(0, A.length)) === key(A));
}

// ── ② 平局：差得一样多，星星总数少的那一色赢 ───────────────────────────────
{
  const A = [[0, 1], [0, 2], [1, 1], [1, 2], [1, 3], [2, 1]]; // 6 颗，上边 2 颗：还差 3
  const B = [[4, 1], [4, 2], [2, 2], [2, 3], [3, 1]]; // 5 颗，下边 2 颗：还差 3
  const h = hintOf(board({ 1: A, 2: B }));
  check('② 两色都还差 3 颗：挑星星少的那一色（2，5 颗 < 6 颗）', h?.color === 2, JSON.stringify(h?.color));
  // 尺子：赢的那一色在盘面上排在后面——要是「平局按先碰到的挑」，这里会挑成 1。
  check('② （尺子）那一色在扫描次序里排在后面（不是碰巧先碰到）', A[0][0] * N + A[0][1] < Math.min(...B.map(([r, c]) => r * N + c)));
  check('② 点亮组：这一色的 5 颗 ＋ 下边那 5 格', !!h && key(h.stars) === key([...B, ...RING[1]]), h ? key(h.stars) : 'null');
}

// ── ③ 第一步：星星数不够填满最短那条外边的颜色，先筛掉 ────────────────────────
{
  const A = [[0, 0], [0, 1], [0, 2], [0, 3]]; // 4 颗、全在上边：只差 1 颗，可它一共只有 4 颗，填不满 5 格
  const B = [[1, 1], [1, 2], [1, 3], [2, 1], [2, 2]]; // 5 颗、一颗都不在外边上：还差 5，但够得着
  const h = hintOf(board({ 1: A, 2: B }));
  check('③ 外边上已经摆了 4 颗的那一色只有 4 颗、填不满 5 格的外边：筛掉，挑另一色', h?.color === 2, JSON.stringify(h?.color));
  check('③ 那一色挑的边是它差得最少的那一条（四条都差 5，取先给的上边）', !!h && key(h.stars) === key([...B, ...RING[0]]), h ? key(h.stars) : 'null');
  check('③ 一色都够不着：回 null（这一条不讲）', hintOf(board({ 1: A, 2: B.slice(0, 4) })) === null);
}

// ── 边角 ─────────────────────────────────────────────────────────────────
{
  check('一条外边都没有（削不动）：回 null', hintOf(board({ 1: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [1, 1]] }), []) === null);
  // 外边长短不一：「最短的那条」才是门槛。给一条 3 格的边，3 颗就够得着。
  const short = [[[2, 1], [2, 2], [2, 3]]];
  const h = hintOf(board({ 1: [[2, 1], [3, 3], [1, 1]] }), [...RING, ...short]);
  check('外边长短不一：够得着最短的那条（3 格）就算，挑的就是那条边', h?.color === 1 && key(h.stars) === key([[2, 1], [3, 3], [1, 1], [2, 2], [2, 3]]),
    h ? key(h.stars) : 'null');
  const twice = [hintOf(board({ 1: [[0, 1], [0, 2], [1, 1], [1, 2], [1, 3]], 2: [[4, 1], [4, 2], [2, 2], [2, 3], [3, 1]] })),
    hintOf(board({ 1: [[0, 1], [0, 2], [1, 1], [1, 2], [1, 3]], 2: [[4, 1], [4, 2], [2, 2], [2, 3], [3, 1]] }))];
  check('全平（差得一样、星星一样多）：同一副盘面两次挑同一色（按盘面上先碰到的那一色）',
    twice[0]?.color === twice[1]?.color && twice[0]?.color === 1, `${twice[0]?.color} / ${twice[1]?.color}`);
}

// ── 呼吸灯：第 4 条那一盏走 starClear，不走一层穷举 ──────────────────────────
//
// 棋盘把 starClear 交给呼吸灯（square.ts / circle.ts 的 coachStarClear）。讲第 4 条（edge）时亮的必须
// 正好是它挑的那一组；它回 null 时一枚都不亮。这里一种滑法都不给（moves 是空的）——灯要是还走一层
// 穷举，什么都亮不出来，第一条就红。
{
  let id = 1;
  const grid = board({
    1: [[0, 1], [0, 2], [0, 3], [2, 2], [3, 2]],
    2: [[4, 2], [1, 1], [1, 2], [1, 3], [2, 1], [2, 3], [3, 1]],
  }).map((row) => row.map((t) => ({ ...t, id: id++ })));
  let hint = hintOf(grid);
  const glow = createCoachGlow({
    grid: () => grid,
    moves: () => ({ cells: [], moves: [] }),
    groupsFor: () => () => [],
    starClear: () => hint,
    centerOf: ([r, c]) => [c, r],
    boardCenter: () => [2, 2],
  }, () => 0);
  glow.update('edge');
  const lit = grid.flat().filter((t) => glow.lit(t.id)).map((t) => t.id);
  const want = hint.stars.map(([r, c]) => grid[r][c].id);
  check('灯：讲第 4 条时亮的正好是 starClearHintFor 挑的那一组（不是一层穷举那一把认出来的）',
    lit.length === want.length && want.every((x) => lit.includes(x)), `亮 ${lit.length} / 该 ${want.length}`);
  hint = null;
  glow.update('edge');
  check('灯：starClear 回 null 时一枚都不亮', grid.flat().every((t) => !glow.lit(t.id)));
}

console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

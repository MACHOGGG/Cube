/**
 * 「此刻的最外边」那一份共用实现（`scoring.ts` 的 `outerEdges`）。
 *
 *   npx esbuild src/engine/scoring.ts --bundle --format=esm --outfile=/tmp/scoring.mjs
 *   node scripts/check-outer-edges.mjs /tmp/scoring.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么
 *
 * 《外边消除》把「星星连成一整条就消除」改成「只在**此刻最外面**那条边上才消
 * 除，而且消掉的格子消失、棋盘一圈一圈变小」。于是「哪几条线算外边」每走一步都
 * 在变，而它靠三条判定决定：族内最外、最小边长、端头条件。
 *
 * 三条里最不直观的是**端头条件**，而它恰恰是「棋盘永远实心、每条线永远连续」的
 * 唯一保证。少了它，V 形那种带缺口的棋盘会从臂的中间消掉一条，剩下的线断成两
 * 截——之后每一次滑动都错位，而且不报错。
 *
 * 所以这道门把 `outerEdges` 当**纯函数**喂：自己搭几副线集，答案是手推的。这比
 * 起浏览器点棋盘稳，也比在八副真棋盘上各验一遍早——几何错了，八副一起错。
 *
 * 规格书 §6.2 的「起始外边表」是这里的权威答案：
 *   方块 4 条 6 格；小球 3 条 7 格（顶点单格挡端）；菱形横向族永远不成边。
 */
import { pathToFileURL } from 'node:url';

const mod = process.argv[2];
if (!mod) {
  console.error('用法：node scripts/check-outer-edges.mjs <打包好的 scoring.mjs>');
  process.exit(2);
}
const { outerEdges } = await import(pathToFileURL(mod).href);

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const key = (r, c) => r + ',' + c;
/** 活格集合 → isLive。 */
const liveFrom = (cells) => {
  const set = new Set(cells.map(([r, c]) => key(r, c)));
  return (r, c) => set.has(key(r, c));
};
/** 边的样子：每条边写成「族:长度」，排序后拼成一句，方便整体断言。 */
const shape = (edges) =>
  edges
    .map((e) => `${e.fam}:${e.cells.length}`)
    .sort()
    .join(' ');
const lens = (edges) => edges.map((e) => e.cells.length).sort((a, b) => a - b);

// ---------------------------------------------------------------------------
// ① 方块 6×6：起始 4 条 6 格（上下两行 + 左右两列）
// ---------------------------------------------------------------------------
function squareLines(D) {
  const lines = [];
  for (let r = 0; r < D; r++) {
    lines.push({ fam: 'R', pos: r, cells: Array.from({ length: D }, (_, c) => [r, c]) });
  }
  for (let c = 0; c < D; c++) {
    lines.push({ fam: 'C', pos: c, cells: Array.from({ length: D }, (_, r) => [r, c]) });
  }
  return lines;
}
const allCells = (D) => {
  const out = [];
  for (let r = 0; r < D; r++) for (let c = 0; c < D; c++) out.push([r, c]);
  return out;
};
{
  const L = squareLines(6);
  const e = outerEdges(L, liveFrom(allCells(6)), 3);
  check('① 方块 6×6 起始：4 条边', e.length === 4, shape(e));
  check('① 方块 6×6 起始：每条 6 格', lens(e).join(',') === '6,6,6,6', lens(e).join(','));
  check('① 方块 6×6 起始：两族各两条', shape(e) === 'C:0 C:0 R:0 R:0'.replace(/0/g, '6'), shape(e));
}

// ---------------------------------------------------------------------------
// ② 消掉第 0 行之后：新的最外行是第 1 行，两列各剩 5 格
// ---------------------------------------------------------------------------
{
  const L = squareLines(6);
  const live = allCells(6).filter(([r]) => r !== 0);
  const e = outerEdges(L, liveFrom(live), 3);
  check('② 消掉第 0 行：还是 4 条', e.length === 4, shape(e));
  check('② 消掉第 0 行：两行 6 格、两列 5 格', lens(e).join(',') === '5,5,6,6', lens(e).join(','));
  const rows = e.filter((x) => x.fam === 'R').map((x) => x.cells[0][0]).sort();
  check('② 消掉第 0 行：最外行变成第 1 行和第 5 行', rows.join(',') === '1,5', rows.join(','));
}

// ---------------------------------------------------------------------------
// ③ 挡端：最外那一行只剩 2 格（不足 3）→ 它不是边，而且第二行也不是
// ---------------------------------------------------------------------------
//
// 这一条是「棋盘不会从中间被掏空」的那条规矩。没有它，角上剩一两格的时候，第二
// 圈就会先被消掉，棋盘变成一个带边框的空壳。
{
  const L = squareLines(6);
  const live = allCells(6).filter(([r, c]) => r !== 0 || c < 2);
  const e = outerEdges(L, liveFrom(live), 3);
  const rows = e.filter((x) => x.fam === 'R').map((x) => x.cells[0][0]);
  check('③ 最外行只剩 2 格：它自己不是边', !rows.includes(0), '行 ' + rows.join(','));
  check('③ 最外行只剩 2 格：第二行也还不是边（被挡着）', !rows.includes(1), '行 ' + rows.join(','));
  check('③ 最外行只剩 2 格：另一头第 5 行照旧是边', rows.includes(5), '行 ' + rows.join(','));
}

// ---------------------------------------------------------------------------
// ④ 小球（7 行直角三角，三个方向）：起始 3 条 7 格，顶点单格挡端
// ---------------------------------------------------------------------------
//
// 和 src/shapes/circle.ts 的三族一致：R 行（r 固定，c=0…r）、A（d = r−c）、
// B（e = c）。三族各有一条 7 格的长边，各有一个单格的顶点——顶点挡端，所以
// 「第二行那两格」永远轮不到当边。
function circleLines(ROWS) {
  const lines = [];
  for (let r = 0; r < ROWS; r++) {
    lines.push({ fam: 'R', pos: r, cells: Array.from({ length: r + 1 }, (_, c) => [r, c]) });
  }
  for (let d = 0; d < ROWS; d++) {
    const cells = [];
    for (let r = d; r < ROWS; r++) cells.push([r, r - d]);
    lines.push({ fam: 'A', pos: d, cells });
  }
  for (let e = 0; e < ROWS; e++) {
    const cells = [];
    for (let r = e; r < ROWS; r++) cells.push([r, e]);
    lines.push({ fam: 'B', pos: e, cells });
  }
  return lines;
}
const circleCells = (ROWS) => {
  const out = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c <= r; c++) out.push([r, c]);
  return out;
};
{
  const L = circleLines(7);
  const e = outerEdges(L, liveFrom(circleCells(7)), 3);
  check('④ 小球 28 枚起始：3 条边', e.length === 3, shape(e));
  check('④ 小球 28 枚起始：每条 7 格', lens(e).join(',') === '7,7,7', lens(e).join(','));
  check('④ 小球 28 枚起始：三族各一条', shape(e) === 'A:7 B:7 R:7', shape(e));
  // 顶点是每族 pos 的另一端，只有 1 格：它不是边，但占着那一端。
  const secondRow = e.some((x) => x.fam === 'R' && x.cells.length === 2);
  check('④ 第二行那两格不是边（顶点挡着）', !secondRow);
}

// ---------------------------------------------------------------------------
// ⑤ 菱形方块：横向族两端都是 1 格 → 这一族永远不成边
// ---------------------------------------------------------------------------
//
// 菱形是把 6×6 转 45°：两条斜向族各 6 条等长线，而屏幕横向那一族的线长是
// 1,2,3,4,5,6,5,4,3,2,1——两端永远是 1 格，永远挡着。规格书里这一句写成「菱形 /
// 七色只消两条斜向的边（横向两端只有 1–2 格，永远挡着）」。
{
  const D = 6;
  const lines = [];
  for (let r = 0; r < D; r++) {
    lines.push({ fam: 'A', pos: r, cells: Array.from({ length: D }, (_, c) => [r, c]) });
  }
  for (let c = 0; c < D; c++) {
    lines.push({ fam: 'B', pos: c, cells: Array.from({ length: D }, (_, r) => [r, c]) });
  }
  // 横向族：r + c 固定（屏幕上的水平线），长度 1…6…1
  for (let s = 0; s <= 2 * (D - 1); s++) {
    const cells = [];
    for (let r = 0; r < D; r++) {
      const c = s - r;
      if (c >= 0 && c < D) cells.push([r, c]);
    }
    lines.push({ fam: 'H', pos: s, cells });
  }
  const e = outerEdges(lines, liveFrom(allCells(D)), 3);
  check('⑤ 菱形起始：横向族一条边都没有', !e.some((x) => x.fam === 'H'), shape(e));
  check('⑤ 菱形起始：两条斜向族各两条 6 格', shape(e) === 'A:6 A:6 B:6 B:6', shape(e));
}

// ---------------------------------------------------------------------------
// ⑥ 端头条件本身：带缺口的棋盘不许从中间消
// ---------------------------------------------------------------------------
//
// V 形是两条臂加一条底：横向的线在缺口处断开。拿一副极简的 L 形来量这一条——
// 一条横线穿过缺口两侧时，它的格子在竖线上既不顶头也不顶尾，端头条件就该挡下。
//
// 布局（× = 有格子）：
//     c: 0 1 2 3
//  r0  ×       ×
//  r1  ×       ×
//  r2  × × × ×
//
// 第 0 行的活格是 (0,0) 和 (0,3)：它在列 0 和列 3 上都顶着头，可它只有 2 格，
// 不足 3——先被最小边长挡下。把它加长到 3 格（补 (0,1)）之后，(0,1) 所在的列 1
// 只有它和 (2,1) 两格，它顶着头，仍然合法。真正要挡的是「中间那一行」：
{
  const cells = [
    [0, 0], [0, 3],
    [1, 0], [1, 3],
    [2, 0], [2, 1], [2, 2], [2, 3],
  ];
  const lines = [];
  for (let r = 0; r <= 2; r++) {
    const row = cells.filter(([rr]) => rr === r);
    if (row.length) lines.push({ fam: 'R', pos: r, cells: row });
  }
  for (let c = 0; c <= 3; c++) {
    const col = cells.filter(([, cc]) => cc === c);
    if (col.length) lines.push({ fam: 'C', pos: c, cells: col });
  }
  const e = outerEdges(lines, liveFrom(cells), 3);
  // 第 2 行（底边 4 格）是 R 族 pos 最大的一条，四个格子在各自的列上都顶着尾 → 合法。
  check('⑥ L 形：底边 4 格是边', e.some((x) => x.fam === 'R' && x.cells.length === 4), shape(e));
  // 第 0 行只有 2 格，不足 3 → 不是边，并且挡住第 1 行。
  const rows = e.filter((x) => x.fam === 'R').map((x) => x.cells[0][0]);
  check('⑥ L 形：顶上那两格不是边，也挡住了第 1 行', !rows.includes(0) && !rows.includes(1), '行 ' + rows.join(','));
  // 列 0 和列 3 各 3 格，是 C 族的两端 → 都是边（它们的格子在各行上都顶着头/尾）。
  check('⑥ L 形：左右两列各 3 格都是边', e.filter((x) => x.fam === 'C').length === 2, shape(e));
  // 列 1 / 列 2 不是最外，不该出现。
  check('⑥ L 形：中间两列不是边', !e.some((x) => x.fam === 'C' && x.cells.length === 1));
}

// ---------------------------------------------------------------------------
// ⑦ 端头条件真的会挡人：一条穿过棋盘中腰的线不许当边
// ---------------------------------------------------------------------------
//
// 造一副「中间一行比上下都宽」的棋盘（十字形的腰）：那一行是横向族 pos 的中间，
// 本来就不是最外；把它做成最外（上下两行都消掉）之后，它的格子在竖线上就落在
// 中间——端头条件必须把它挡下，否则消掉它会把两条竖线各断成两截。
{
  //     c: 0 1 2 3 4
  //  r0      ×       ← 只有中间一列
  //  r1  × × × × ×   ← 腰
  //  r2      ×
  const cells = [[0, 2], [1, 0], [1, 1], [1, 2], [1, 3], [1, 4], [2, 2]];
  const lines = [];
  for (let r = 0; r <= 2; r++) {
    const row = cells.filter(([rr]) => rr === r);
    if (row.length) lines.push({ fam: 'R', pos: r, cells: row });
  }
  for (let c = 0; c <= 4; c++) {
    const col = cells.filter(([, cc]) => cc === c);
    if (col.length) lines.push({ fam: 'C', pos: c, cells: col });
  }
  const e = outerEdges(lines, liveFrom(cells), 3);
  // 腰（第 1 行，5 格）在 R 族里 pos 居中，不是最外 → 不该是边。
  check('⑦ 十字：腰不是最外，不是边', !e.some((x) => x.fam === 'R' && x.cells.length === 5), shape(e));
  // 中间那一列 3 格，是 C 族 pos 居中的一条 → 也不是最外。
  check('⑦ 十字：中间那一列不是最外，不是边', !e.some((x) => x.fam === 'C' && x.cells.length === 3), shape(e));
  // 第 0 行和第 2 行各 1 格 → 不足 3，不是边，但各挡一端。整副棋盘此刻无边可消。
  check('⑦ 十字：此刻一条边都消不了', e.length === 0, shape(e));
}

// ---------------------------------------------------------------------------
// ⑧ minLen 是参数，不是写死的 3
// ---------------------------------------------------------------------------
{
  const L = squareLines(4);
  const e3 = outerEdges(L, liveFrom(allCells(4)), 3);
  const e5 = outerEdges(L, liveFrom(allCells(4)), 5);
  check('⑧ 4×4 在 minLen=3 下有 4 条边', e3.length === 4, shape(e3));
  check('⑧ 同一副盘在 minLen=5 下一条都没有', e5.length === 0, shape(e5));
}

// ---------------------------------------------------------------------------
// ⑨ 空盘不炸
// ---------------------------------------------------------------------------
{
  const e = outerEdges(squareLines(6), () => false, 3);
  check('⑨ 整盘消光：没有边，也不抛错', Array.isArray(e) && e.length === 0);
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

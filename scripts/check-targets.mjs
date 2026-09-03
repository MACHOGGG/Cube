/**
 * 随机得分目标：图案表和判定的单元测试。
 *
 *   npx esbuild src/engine/targets.ts --bundle --format=esm --outfile=/tmp/t.mjs
 *   npx esbuild src/engine/targetMatch.ts --bundle --format=esm --outfile=/tmp/m.mjs
 *   node scripts/check-targets.mjs /tmp/t.mjs /tmp/m.mjs
 *
 * 不碰 DOM，也不碰八个玩法：只喂一副手搭的棋盘，看该找到的找不找得到、不该
 * 算的算不算。这一层错了，玩法层看起来会「偶尔不给分」，最难查。
 */
const T = await import(process.argv[2]);
const M = await import(process.argv[3]);

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const tile = (color, face = 'flavor') => ({ id: 0, color, face, dotColor: color });

/** 方块那样的矩形棋盘：grid[r][c] 是颜色号，null 表示没有这一格。 */
function squareView(grid, flipped = new Set()) {
  return {
    has: (r, c) => grid[r]?.[c] != null,
    tileAt: (r, c) => {
      const v = grid[r]?.[c];
      return v == null ? null : tile(v, flipped.has(`${r},${c}`) ? 'dot' : 'flavor');
    },
    cells: () => grid.flatMap((row, r) => row.map((_, c) => [r, c])),
  };
}

// ---- 方块：36 一条四连 --------------------------------------------------
{
  const g = [
    [0, 0, 0, 0, 1, 1],
    [1, 2, 3, 4, 5, 0],
    [2, 3, 4, 5, 0, 1],
  ];
  const hits = M.findTargets(squareView(g), T.targetById('36'));
  check('方块 36（四连）：顶上那一条找得到', hits.length === 1, JSON.stringify(hits[0]));
  check('而且正好是那四格',
    JSON.stringify(hits[0]) === JSON.stringify([[0, 0], [0, 1], [0, 2], [0, 3]]));
}
// ---- 方块：32 是 36 的一部分，同一条上能找到两处 -----------------------
{
  const g = [[0, 0, 0, 0, 1, 1]];
  const hits = M.findTargets(squareView(g), T.targetById('32'));
  check('方块 32（三连）：四连里含两处三连', hits.length === 2, `${hits.length} 处`);
}
// ---- 方块：颜色不齐就不算 ----------------------------------------------
{
  const g = [[0, 0, 1, 0]];
  check('颜色断了就不算', M.findTargets(squareView(g), T.targetById('32')).length === 0);
}
// ---- 方块：全翻过来了就不算（老规矩：一次得分总要翻掉点什么）-----------
{
  const g = [[0, 0, 0, 0]];
  const allFlipped = new Set(['0,0', '0,1', '0,2', '0,3']);
  check('整条都已经翻过面了就不再计分',
    M.findTargets(squareView(g, allFlipped), T.targetById('36')).length === 0);
  const oneFront = new Set(['0,0', '0,1', '0,2']);
  check('只要还剩一枚正面就算数',
    M.findTargets(squareView(g, oneFront), T.targetById('36')).length === 1);
}
// ---- 方块：37 是 2×2 ----------------------------------------------------
{
  const g = [
    [0, 0, 1],
    [0, 0, 1],
  ];
  check('方块 37（2×2）找得到', M.findTargets(squareView(g), T.targetById('37')).length === 1);
}
// ---- 小球：棋盘是 28 颗的三角，第 r 行 r+1 颗 --------------------------
function circleView(colors) {
  return {
    has: (r, c) => r >= 0 && r < 7 && c >= 0 && c <= r,
    tileAt: (r, c) => (r >= 0 && r < 7 && c >= 0 && c <= r ? tile(colors(r, c)) : null),
    cells: () => {
      const out = [];
      for (let r = 0; r < 7; r++) for (let c = 0; c <= r; c++) out.push([r, c]);
      return out;
    },
  };
}
{
  // 23 = 上面一颗、下面两颗。整副同色时，每一个「上面一颗」都成立。
  const hits = M.findTargets(circleView(() => 0), T.targetById('23'));
  // 行 r 的第 c 颗，下面两颗是 (r+1,c) 和 (r+1,c+1)——r 从 0 到 5，共 21 处；
  // 倒过来的（上二下一）也算，r 从 1 到 6 每行少一处，共 15 处。图案怎么摆
  // 都算，和各玩法自己那套一个规矩。
  check('小球 23（上一下二）：整副同色时正反各算，21 + 15 = 36 处', hits.length === 36, `${hits.length} 处`);
  // 只有最上面三颗同色，别的每一颗都给一个自己的颜色——不然下面那一大片
  // 同色的球自己也能凑出一堆 23 来（第一版就是这么写错的）。
  const one = M.findTargets(circleView((r, c) => (r <= 1 ? 0 : 100 + r * 10 + c)), T.targetById('23'));
  check('只有最上面三颗同色时，正好一处', one.length === 1, JSON.stringify(one[0]));
  check('那一处就是 (0,0)(1,0)(1,1)',
    JSON.stringify(one[0]?.map((x) => x.join(','))) === JSON.stringify(['0,0', '1,0', '1,1']));
}
// ---- 三角：朝向由 p 的奇偶定 -------------------------------------------
function triView(colors, rows = 6) {
  const has = (r, c) => r >= 0 && r < rows && c >= 0 && c < 2 * r + 1;
  return {
    has,
    tileAt: (r, c) => (has(r, c) ? tile(colors(r, c)) : null),
    cells: () => {
      const out = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < 2 * r + 1; c++) out.push([r, c]);
      return out;
    },
  };
}
{
  const hits = M.findTargets(triView(() => 0), T.targetById('14'));
  check('三角 14（一排三个）：整副同色时找得到', hits.length > 0, `${hits.length} 处`);
  const big = M.findTargets(triView(() => 0), T.targetById('15'));
  check('三角 15（大三角）：整副同色时找得到', big.length > 0, `${big.length} 处`);
  // 12（两块的菱形）三个方向都算：竖的 25 处（r 从 0 到 4，每行 2r+1 格，
  // 1+3+5+7+9），斜的两个方向各 10 处（每一对共一条斜边的相邻三角）——共 45。
  // 15（大三角）朝上 25 处，朝下的在六行的棋盘上摆不下（要三行、上宽下窄），
  // 所以还是 25 减去被边卡掉的：实测 21。
  const rhombus = M.findTargets(triView(() => 0), T.targetById('12')).length;
  const run4 = M.findTargets(triView(() => 0), T.targetById('13')).length;
  check('12（菱形）三个方向都算，45 处', rhombus === 45, `${rhombus} 处`);
  check('15（大三角）朝上朝下都算', big.length >= 21, `${big.length} 处`);
  check('13（一排四个）三个方向都算，比只横着多', run4 > 25, `${run4} 处`);
}
// ---- 怎么摆都算：玩家报的那个 bug 就是从这儿来的 -------------------------
{
  // 方块 38 是横着五枚。竖着摆一列同色，也该给分——原来只认横的。
  const col = [[0], [0], [0], [0], [0]];
  check('方块 38（一排五枚）竖着也算', M.findTargets(squareView(col), T.targetById('38')).length === 1);
  // 35 是个 L：转四次、照镜子，八种样子，每一种都得认。
  const Ls = [
    [[0, 9], [0, 9], [0, 0]],           // 原样
    [[0, 0, 0], [0, 9, 9]],             // 转 90°
    [[0, 0], [9, 0], [9, 0]],           // 转 180°
    [[9, 9, 0], [0, 0, 0]],             // 转 270°
    [[9, 0], [9, 0], [0, 0]],           // 照镜子
  ];
  for (const [i, g] of Ls.entries()) {
    check(`方块 35（L 形）第 ${i + 1} 种摆法也算`, M.findTargets(squareView(g), T.targetById('35')).length === 1);
  }
  // 小球 27 是一排四颗：六角格子上一排有三个方向。整副同色的 28 颗三角里，
  // 每个方向能摆几处是一样的（三角是对称的），所以总数得是 3 的倍数、而且
  // 比只横着多。
  const runs = M.findTargets(circleView(() => 0), T.targetById('27')).length;
  check('小球 27（一排四颗）三个方向都算', runs % 3 === 0 && runs > 10, `${runs} 处`);
}
// ---- 三角：转 60° 之后朝向跟着变，但两枚只在尖上碰一下的不算 --------------
{
  // 12 = 上面一枚朝上、下面一枚朝下，共一条边。原来的判定从任何一格起手，
  // 起手在朝下的那一格时，「下一行」那一枚就成了朝上的——两枚只在一个尖上
  // 碰一下，却给了分。现在起手那一格的朝向必须对上。
  //
  // 棋盘：只把 (0,0)（朝上）和 (1,1)（朝下）涂成同色——它们共一条边，是真
  // 的菱形；再把 (1,2)（朝上）和 (2,3)（朝下）涂成另一色——(1,2) 是朝上的，
  // 它「下一行同 p+1」的 (2,3) 是朝下的，共边，也是真菱形；而 (1,1)（朝下）
  // 和 (2,2)（朝上）只在尖上碰：给它们第三种颜色，不该被找到。
  const paint = new Map([['0,0', 0], ['1,1', 0], ['1,2', 1], ['2,3', 1], ['2,2', 2]]);
  const view = triView((r, c) => paint.get(`${r},${c}`) ?? 100 + r * 10 + c, 4);
  const hits = M.findTargets(view, T.targetById('12')).map((h) => h.map((x) => x.join(',')).sort().join('|'));
  check('三角 12：共一条边的两枚算', hits.includes('0,0|1,1') && hits.includes('1,2|2,3'), hits.join(' ; '));
  check('三角 12：只在尖上碰一下的两枚不算', !hits.some((h) => h.includes('2,2')), hits.join(' ; '));
  // 每一种摆法的朝向标记都得和 p 的奇偶对得上——不然图示会画错、判定会错位。
  for (const t of T.TARGETS.filter((x) => x.family === 'triangle')) {
    const ok = M.orientationsOf(t).every((v) => {
      const [r0, c0, f0] = v.cells[0];
      const p0 = f0 === 'D' ? 1 : 0;
      return v.cells.every(([r, c, f]) => ((p0 + (c - c0) + (r - r0)) % 2 === 0 ? 'U' : 'D') === f);
    });
    check(`三角 ${t.id} 每一种摆法的朝向都对得上`, ok);
  }
  // 摆法的数目：转一转、翻一翻，去掉重复的。这张表是回归用的——它变了，
  // 说明对称算法变了。
  const counts = Object.fromEntries(T.TARGETS.map((t) => [t.id, M.orientationsOf(t).length]));
  const want = { 11: 6, 12: 3, 13: 6, 14: 6, 15: 2, 21: 3, 22: 3, 23: 2, 24: 3, 25: 6, 26: 1, 27: 3,
    31: 4, 32: 2, 33: 8, 34: 4, 35: 8, 36: 2, 37: 1, 38: 2 };
  check('二十个图案各有几种摆法（回归表）', JSON.stringify(counts) === JSON.stringify(want),
    JSON.stringify(counts));
}
// ---- 分值 --------------------------------------------------------------
check('3 枚 5 分', T.scoreOf(T.targetById('14')) === 5);
check('4 枚 8 分', T.scoreOf(T.targetById('13')) === 8);
check('5 枚 13 分', T.scoreOf(T.targetById('11')) === 13);
check('6 枚 18 分', T.scoreOf(T.targetById('26')) === 18);
// ---- 互斥 --------------------------------------------------------------
check('32 和 38 不能同时转出来（三连装得进五连）', !T.compatible('32', '38'));
check('15 和 14 不能同时转出来（几何算出来的）', !T.compatible('15', '14'));
check('31 和 32 可以同时转出来', T.compatible('31', '32'));
for (const fam of ['triangle', 'circle', 'square']) {
  const pair = T.drawPair(fam, () => 0.5);
  check(`${fam} 抽得出一对，而且两个不冲突`,
    pair !== null && T.compatible(pair[0].id, pair[1].id),
    pair ? pair.map((p) => p.id).join('+') : 'null');
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);

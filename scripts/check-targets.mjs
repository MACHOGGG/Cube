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
check('1 枚 1 分', T.scoreForSize(1) === 1);
check('2 枚 2 分', T.scoreForSize(2) === 2);
check('3 枚 5 分', T.scoreOf(T.targetById('14')) === 5);
check('4 枚 8 分', T.scoreOf(T.targetById('13')) === 8);
check('5 枚 13 分', T.scoreOf(T.targetById('11')) === 13);
check('6 枚 18 分', T.scoreOf(T.targetById('26')) === 18);
check('分按拼成的那几枚算，不按目标原来有几枚',
  T.scoreForSize(2) === 2 && T.scoreOf(T.targetById('26')) === 18,
  '六枚的目标侵蚀到两枚时是 2 分，不是 18');

// ---- 侵蚀：目标降一级少一枚（PR-8）-------------------------------------
for (const t of T.TARGETS) {
  const n = t.cells.length;
  check(`${t.id}：第 4 级就是它本身（${n} 枚）`, T.sizeAtLevel(t, 4) === n, String(T.sizeAtLevel(t, 4)));
  check(`${t.id}：每降一级少一枚、下限 1`,
    T.sizeAtLevel(t, 3) === Math.max(1, n - 1) &&
      T.sizeAtLevel(t, 2) === Math.max(1, n - 2) &&
      T.sizeAtLevel(t, 1) === Math.max(1, n - 3),
    [4, 3, 2, 1].map((L) => T.sizeAtLevel(t, L)).join(' → '));
}
check('两枚的图案降到第 2 级就见底了，再降还是 1 枚',
  T.sizeAtLevel(T.targetById('12'), 2) === 1 && T.sizeAtLevel(T.targetById('12'), 1) === 1);

// ---- 侵蚀：认哪些子形 --------------------------------------------------
//
// 这一段是 PR-8 的核心，所以**不信** targetMatch 自己那套邻居规则：这里另算一遍
// 相邻——把每一枚摆到真实几何上（和 engine/targetIcon.ts 画图用的是同一套换算），
// 方块和小球按中心距、三角按「共两个顶点」判。三角那一条尤其要紧：被测那一头是在
// 行内序号 p 的奇偶上做代数（(i, p±1) 与朝向决定的第三个），这里走的是顶点，两条
// 路互不相干，对不上就说明有一条错了。
const TRI_H = Math.sqrt(3) / 2;
const key = (x, y) => `${Math.round(x * 4)},${Math.round(y * 4)}`;

/** 一枚的「算相邻用的东西」：方块小球给中心，三角给三个顶点。 */
function geom(pattern, cell) {
  const [br, bg, bf] = pattern.cells[0];
  const [r, c] = cell;
  if (pattern.family === 'square') return { center: [c - bg, r - br] };
  if (pattern.family === 'circle') return { center: [c - bg, (r - br) * Math.sqrt(3)] };
  // 三角：p 的奇偶就是朝向（这一条上面那一段已经逐个图案验过），顶点按 p 算。
  const p0 = bf === 'D' ? 1 : 0;
  const i = r - br;
  const p = p0 + (c - bg) + (r - br);
  const up = ((p % 2) + 2) % 2 === 0;
  const j = up ? p / 2 : (p - 1) / 2;
  const x = -i / 2 + j;
  const pts = up
    ? [[x, i * TRI_H], [x - 0.5, (i + 1) * TRI_H], [x + 0.5, (i + 1) * TRI_H]]
    : [[x + 0.5, (i + 1) * TRI_H], [x, i * TRI_H], [x + 1, i * TRI_H]];
  return { verts: pts.map(([px, py]) => key(px, py)) };
}

function geomAdjacent(pattern, a, b) {
  const ga = geom(pattern, a);
  const gb = geom(pattern, b);
  if (ga.verts) return ga.verts.filter((v) => gb.verts.includes(v)).length === 2;
  const dx = ga.center[0] - gb.center[0];
  const dy = ga.center[1] - gb.center[1];
  const d = Math.sqrt(dx * dx + dy * dy);
  // 方块：挨着＝共边（格距 1）**或**碰角（√2）。碰角这一路是图案 31 要的——那四
  // 枚两两之间一条边都不共（见 targetMatch.ts 里那段）。
  if (pattern.family === 'square') return Math.abs(d - 1) < 1e-6 || Math.abs(d - Math.SQRT2) < 1e-6;
  // 小球：六角密堆里真的碰在一起的那六颗，中心距正好是一个直径（2 个半径）。
  return Math.abs(d - 2) < 1e-6;
}

function geomConnected(pattern, cells) {
  if (cells.length <= 1) return true;
  const seen = new Set([0]);
  const stack = [0];
  while (stack.length) {
    const i = stack.pop();
    for (let j = 0; j < cells.length; j++) {
      if (seen.has(j) || !geomAdjacent(pattern, cells[i], cells[j])) continue;
      seen.add(j);
      stack.push(j);
    }
  }
  return seen.size === cells.length;
}

/** 这个图案全部 k 格子集里，几何上连成一片的那些（原样，不去重）。 */
function rawConnectedSubsets(pattern, k) {
  const n = pattern.cells.length;
  const out = [];
  for (let bits = 0; bits < 1 << n; bits++) {
    const idx = [];
    for (let i = 0; i < n; i++) if (bits & (1 << i)) idx.push(i);
    if (idx.length !== k) continue;
    const cells = idx.map((i) => pattern.cells[i]);
    if (geomConnected(pattern, cells)) out.push(cells);
  }
  return out;
}

/** 两个图案是不是同一个形状（转一转、翻一翻能重合）。 */
const sameShape = (a, b) => {
  const fp = (p) =>
    M.orientationsOf(p)
      .map((v) => v.cells.map(([r, c, f]) => `${r},${c},${f ?? ''}`).join('|'))
      .sort()[0];
  return fp(a) === fp(b);
};

{
  // 先把这一层自己的尺子立起来：相邻这件事在每一族上都要真的判出「连」和「不
  // 连」两种答案来，不然下面每一条都是空的。
  const sq = T.targetById('36'); // 方块一条四连
  check('尺子：四连里第 1、2 枚相邻，第 1、3 枚不相邻',
    geomAdjacent(sq, sq.cells[0], sq.cells[1]) && !geomAdjacent(sq, sq.cells[0], sq.cells[2]));
  const di = T.targetById('31'); // 方块 31：斜着走的四枚，一条边都不共
  check('尺子：方块 31 靠斜角相碰（共边一条都没有）',
    geomAdjacent(di, di.cells[0], di.cells[2]) && !geomAdjacent(di, di.cells[0], di.cells[1]),
    JSON.stringify(di.cells));
  const ci = T.targetById('23'); // 小球：上一颗、下两颗
  check('尺子：小球 23 三枚两两相邻',
    geomAdjacent(ci, ci.cells[0], ci.cells[1]) &&
      geomAdjacent(ci, ci.cells[1], ci.cells[2]) &&
      geomAdjacent(ci, ci.cells[0], ci.cells[2]));
  const sp = T.targetById('27'); // 小球：一排四颗，间隔 2
  check('尺子：小球 27 第 1、3 颗不相邻', !geomAdjacent(sp, sp.cells[0], sp.cells[2]));
  const tr = T.targetById('12'); // 三角：上一枚、下一枚（菱形）
  check('尺子：三角 12 那两枚共边', geomAdjacent(tr, tr.cells[0], tr.cells[1]));
  const t14 = T.targetById('14'); // 三角：一排三枚，正反交替
  check('尺子：三角 14 第 1、3 枚不共边', !geomAdjacent(t14, t14.cells[0], t14.cells[2]));
  check('尺子：二十个图案本身都是连成一片的',
    T.TARGETS.every((t) => geomConnected(t, t.cells)),
    T.TARGETS.filter((t) => !geomConnected(t, t.cells)).map((t) => t.id).join(',') || '（全都连着）');
}

{
  // 开局那一级就是目标本身，一个不多。
  check('k = 目标枚数时就是它本身',
    T.TARGETS.every((t) => {
      const out = M.erodedShapes(t, t.cells.length);
      return out.length === 1 && out[0].id === t.id;
    }));

  let bad = [];
  let classes = 0;
  for (const t of T.TARGETS) {
    for (let k = 1; k < t.cells.length; k++) {
      const got = M.erodedShapes(t, k);
      classes += got.length;
      // 一、每一个都是「目标的一个 k 子形，而且连着」。
      for (const g of got) {
        if (g.cells.length !== k) bad.push(`${t.id}/${k} 枚数 ${g.cells.length}`);
        if (!geomConnected(t, g.cells)) bad.push(`${t.id}/${k} 不连`);
        const inside = g.cells.every(([r, c, f]) =>
          t.cells.some(([R, C, F]) => R === r && C === c && (F ?? '') === (f ?? '')));
        if (!inside) bad.push(`${t.id}/${k} 不是它的子集`);
      }
      // 二、两两不同形（同一个形状不许返回两遍）。
      for (let a = 0; a < got.length; a++)
        for (let b = a + 1; b < got.length; b++)
          if (sameShape(got[a], got[b])) bad.push(`${t.id}/${k} 返回了两个同形的`);
      // 三、一个不漏：几何上连着的每一个 k 子集，都恰好落进返回的某一个形状里。
      // probe 的 id 必须一个子集一个：M.orientationsOf 按 `family:id` 缓存摆法表，
      // 同一个 id 喂两组不同的格子，第二组拿到的是第一组的摆法——这一条于是会静悄
      // 悄地变成空检查。
      for (const [pi, cells] of rawConnectedSubsets(t, k).entries()) {
        const probe = { id: `probe-${t.id}-${k}-${pi}`, family: t.family, cells };
        const hits = got.filter((g) => sameShape(g, probe));
        if (hits.length !== 1) bad.push(`${t.id}/${k} 有个连着的子集落进了 ${hits.length} 个形状`);
      }
    }
  }
  check('侵蚀子形：全是目标的 k 子形、都连着、两两不同形、一个不漏', bad.length === 0,
    bad.slice(0, 4).join(' · ') || `共 ${classes} 个形状`);
  check('侵蚀子形：真的数出了东西（不是空过）', classes >= 40, `共 ${classes} 个`);
  // **每个目标、每一级都要认得出至少一个形状。** 一个都没有意味着这一局从那一级
  // 起永远不得分，而屏幕上毫无异常——HUD 照样画着图案，玩家照样在拼。方块 31
  // （斜着走的四枚）就是这一条抓出来的：那时「相连」只认共边。
  const empty = [];
  for (const t of T.TARGETS)
    for (let k = 1; k <= t.cells.length; k++)
      if (M.erodedShapes(t, k).length === 0) empty.push(`${t.id}/${k}`);
  check('侵蚀子形：没有哪个目标的哪一级是「一个形状都认不出」', empty.length === 0,
    empty.join(' ') || '（每一级都至少一个）');

  // 反面：不连的子集绝不出现。方块一条四连拆成三枚，连着的只有「连续三枚」一种
  // （四个三格子集里有一个是断的），所以只该返回一个形状。断的那个要是也算，
  // 这儿会变成两个。
  const three = M.erodedShapes(T.targetById('36'), 3);
  check('方块四连拆成三枚：只有「连续三枚」一种，断开的那个不算',
    three.length === 1 && three[0].cells.length === 3, `${three.length} 种`);
  const five = M.erodedShapes(T.targetById('38'), 3);
  check('方块五连拆成三枚：同样只有一种', five.length === 1, `${five.length} 种`);
}

// ---- 侵蚀：拆出来的子形，判定那一头真的认得 ----------------------------
//
// 上面那一段只证明子形「是目标的一个连着的 k 子集」，那是**几何**。这一段问的是
// 另一件事：把它交给 findTargets，棋盘上凑出来了认不认。两者会分家——子形是从目
// 标的 cells 里挑出来的，第一枚换了人，而三角的朝向、小球的奇偶都跟着第一枚走
// （见 place() 和 triangleVariants）。挑错的话不报错、不崩，只是这一级**永远不给
// 分**：屏幕上照样画着图案，玩家照样在拼。
{
  const boards = {
    square: squareView([...Array(6)].map(() => [0, 0, 0, 0, 0, 0])),
    circle: circleView(() => 0),
    triangle: triView(() => 0, 7),
  };
  const dead = [];
  for (const t of T.TARGETS) {
    for (let k = 1; k <= t.cells.length; k++) {
      for (const sub of M.erodedShapes(t, k)) {
        if (M.findTargets(boards[t.family], sub).length === 0) dead.push(`${t.id}/${k} ${JSON.stringify(sub.cells)}`);
      }
      const face = M.erodedFace(t, k);
      if (M.findTargets(boards[t.family], face).length === 0) dead.push(`${t.id}/${k} HUD 画的那个`);
    }
  }
  check('每一个子形（含 HUD 上画的那个）在整副同色的棋盘上都凑得出来', dead.length === 0,
    dead.slice(0, 3).join(' · '));
  // 尺子：这一条不是「凑得出来」都回 true。把一枚挪到棋盘外面去，就该一处都找不到。
  const off = { id: 'probe-off', family: 'square', cells: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6]] };
  check('尺子：摆不下的图案确实一处都找不到', M.findTargets(boards.square, off).length === 0);
}

// ---- 侵蚀：HUD 上画哪一个 ----------------------------------------------
{
  let bad = [];
  for (const t of T.TARGETS) {
    for (let k = 1; k <= t.cells.length; k++) {
      const face = M.erodedFace(t, k);
      if (face.cells.length !== k) bad.push(`${t.id}/${k} 枚数 ${face.cells.length}`);
      if (!geomConnected(t, face.cells)) bad.push(`${t.id}/${k} 不连`);
      // 画的那一个必须真的是认得的形状之一——画一个不算分的形状比不画更糟。
      if (!M.erodedShapes(t, k).some((g) => sameShape(g, face))) bad.push(`${t.id}/${k} 画的形状不算分`);
      // 每次都画同一个（这一块每翻一枚就重画一次，跳来跳去就成了闪烁）。
      const again = M.erodedFace(t, k);
      if (JSON.stringify(again.cells) !== JSON.stringify(face.cells)) bad.push(`${t.id}/${k} 两次不一样`);
    }
  }
  check('HUD 那一块画的子形：枚数对、连着、算分、每次一样', bad.length === 0, bad.slice(0, 4).join(' · '));
}

// ---- 抽一个（PR-8：等概率、不查互斥、只从流里读一个数）------------------
for (const fam of ['triangle', 'circle', 'square']) {
  const pool = T.targetsOf(fam);
  check(`${fam} 抽得出一个`, T.drawOne(fam, () => 0.5) !== null);
  check(`${fam}：rand 给 0 抽到头一个、给差一点点的 1 抽到最后一个`,
    T.drawOne(fam, () => 0).id === pool[0].id &&
      T.drawOne(fam, () => 1 - 1e-9).id === pool[pool.length - 1].id);
  // 等概率：每一个都抽得到，而且只抽得到这一族的。
  const seen = new Set();
  for (let i = 0; i < pool.length; i++) seen.add(T.drawOne(fam, () => (i + 0.5) / pool.length).id);
  check(`${fam}：${pool.length} 个图案一个都不漏`, seen.size === pool.length,
    `${seen.size} / ${pool.length}`);
  check(`${fam}：抽出来的都是这一族的`,
    [...seen].every((id) => T.targetById(id).family === fam));
  // 从那条流里只读一个数。小屋「大家拼同一个图案」那一档靠它：多读一个数，
  // 后面发牌就和别人错开了（见 drawOne 上面那段）。
  let reads = 0;
  T.drawOne(fam, () => {
    reads++;
    return 0.5;
  });
  check(`${fam}：只从随机流里读一个数`, reads === 1, `读了 ${reads} 个`);
}
check('互斥那一套退役了（PR-8：drawOne 不查 exclusions）',
  T.drawPair === undefined && T.compatible === undefined && T.exclusions === undefined,
  Object.keys(T).filter((k) => /Pair|compatible|exclusions/.test(k)).join(',') || '（都没了）');

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);

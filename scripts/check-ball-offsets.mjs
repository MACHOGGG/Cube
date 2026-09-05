/**
 * 两副小球棋盘的三张偏移表，画到屏幕上还是不是菱形。
 *
 *   npx esbuild src/engine/ballLattice.ts --bundle --format=esm --outfile=/tmp/bl.mjs
 *   node scripts/check-ball-offsets.mjs /tmp/bl.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么要有这一道
 *
 * 「2+2」和「1-2-1」这两个得分图案是照屏幕上看着的样子定的：四颗球围成一个
 * 菱形。可代码里写的是格子编号的偏移，而六边小球和七色小球各有各的坐标系，
 * 同一串偏移换块棋盘画出来完全是另一个东西。
 *
 * 这里真出过事：这两副的偏移表最早照基础小球（circle.ts）那份原样抄了过来，
 * 重放出来是一条拐来拐去的四连，不是菱形。于是玩家照着提示图凑出来的 2+2
 * 不给分，倒是一个提示图里从来没有过的形状在给分——而且看代码看不出来，那
 * 几行数字本身没有一处「错」，错的是它们画出来的样子。
 *
 * 所以这道体检不读代码，它照真件把球摆到屏幕坐标上，量四条边、两条对角线：
 * 四条边一样长、两条对角线互相平分，才算菱形。表和算式都从
 * src/engine/ballLattice.ts 直接 import——玩法本体用的就是这一份，不是抄本。
 * ─────────────────────────────────────────────────────────────────────────
 */
const src = process.argv[2];
if (!src) {
  console.error('用法: node scripts/check-ball-offsets.mjs <打包好的 ballLattice.mjs>');
  process.exit(2);
}
const {
  hexBallXY,
  sevenBallXY,
  HEX_RHOMBUS_A_OFFSETS,
  HEX_RHOMBUS_B_OFFSETS,
  HEX_DIAMOND_121_OFFSETS,
  SEVEN_RHOMBI,
} = await import(src);

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// 半径取 1，行高就是正六边形/正菱形排布的 √3——两副棋盘的 layoutBoard 都是
// 这么算的（rowH = R * Math.sqrt(3)），比例一样，量形状用哪个数都一样。
const R = 1;
const ROW_H = Math.sqrt(3);
const near = (a, b) => Math.abs(a - b) < 1e-9;
const dist = ([ax, ay], [bx, by]) => Math.hypot(ax - bx, ay - by);
const fmt = (pts) => pts.map(([x, y]) => `(${x.toFixed(2)},${y.toFixed(2)})`).join(' ');

/**
 * 四个点围成的是不是一个菱形。
 *
 * 先挑出最长的那一对当一条对角线，剩下两个点是另一条。两条对角线中点重合
 * ——这是平行四边形；四条边再一样长——这才是菱形。一条拐来拐去的四连过不
 * 了这两关中的任何一关。
 */
function rhombusReport(pts) {
  if (pts.length !== 4) return `不是四个点（${pts.length} 个）`;
  for (let i = 0; i < 4; i++)
    for (let j = i + 1; j < 4; j++)
      if (near(dist(pts[i], pts[j]), 0)) return `有两颗球落在同一个位置：${fmt(pts)}`;

  let best = [0, 1];
  let bestD = -1;
  for (let i = 0; i < 4; i++)
    for (let j = i + 1; j < 4; j++) {
      const d = dist(pts[i], pts[j]);
      if (d > bestD) {
        bestD = d;
        best = [i, j];
      }
    }
  const [a, c] = best;
  const [b, d] = [0, 1, 2, 3].filter((k) => k !== a && k !== c);

  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const m1 = mid(pts[a], pts[c]);
  const m2 = mid(pts[b], pts[d]);
  if (!near(m1[0], m2[0]) || !near(m1[1], m2[1]))
    return `两条对角线不互相平分（不是平行四边形，是一条拐着走的四连）：${fmt(pts)}`;

  const sides = [dist(pts[a], pts[b]), dist(pts[b], pts[c]), dist(pts[c], pts[d]), dist(pts[d], pts[a])];
  if (!sides.every((s) => near(s, sides[0])))
    return `四条边不一样长（${sides.map((s) => s.toFixed(2)).join('/')}）：${fmt(pts)}`;
  return null;
}

const isRhombus = (label, pts) => {
  const bad = rhombusReport(pts);
  check(label, bad === null, bad ?? `边长 ${dist(pts[0], pts[1]).toFixed(2)}`);
};

// ---------------------------------------------------------------------------
// 六边小球：三张 (dz,dx) 偏移表
// ---------------------------------------------------------------------------
const hexPts = (offsets) => offsets.map(([dz, dx]) => hexBallXY(dx, dz, R, ROW_H));

isRhombus('六边小球：靠右歪的菱形（2+2 之一）', hexPts(HEX_RHOMBUS_B_OFFSETS));
isRhombus('六边小球：靠左歪的菱形（2+2 之二）', hexPts(HEX_RHOMBUS_A_OFFSETS));
isRhombus('六边小球：正立的菱形（1-2-1）', hexPts(HEX_DIAMOND_121_OFFSETS));

{
  // 1-2-1 提示图画的是「上一颗、中间两颗、下一颗」：中间那两颗要并排（一样
  // 高），上下两颗要在同一条竖线上、且正落在中间那两颗中间。只说它是菱形还
  // 不够——歪着的菱形也是菱形，可提示图画的不是那个。
  const pts = hexPts(HEX_DIAMOND_121_OFFSETS).slice().sort((p, q) => p[1] - q[1]);
  const [top, m1, m2, bottom] = pts;
  check('六边小球：1-2-1 的中间两颗并排（一样高）', near(m1[1], m2[1]), `${m1[1].toFixed(2)} / ${m2[1].toFixed(2)}`);
  check('六边小球：1-2-1 的上下两颗在同一条竖线上', near(top[0], bottom[0]), `${top[0].toFixed(2)} / ${bottom[0].toFixed(2)}`);
  check('六边小球：1-2-1 的那条竖线正在中间两颗当中', near(top[0], (m1[0] + m2[0]) / 2), `${top[0].toFixed(2)} / ${((m1[0] + m2[0]) / 2).toFixed(2)}`);
}

{
  // 当年真踩过的坑：把基础小球（circle.ts）那份 (r,c) 偏移原样搬过来。这一条
  // 是反着证——它必须过不了，否则上面那三条也就什么都没在量。
  const copiedFromCircleTs = [[0, 0], [1, 0], [1, 1], [2, 1]];
  check(
    '六边小球：照抄基础小球那份偏移，画出来确实不是菱形（反证这道体检有效）',
    rhombusReport(hexPts(copiedFromCircleTs)) !== null,
  );
}

// ---------------------------------------------------------------------------
// 七色小球：三个朝向的菱形，各由两个基向量张开
// ---------------------------------------------------------------------------
//
// 四个角按 growParallelogram 走的那个顺序取：(0,0) (1,0) (0,1) (1,1)。
const sevenPts = ([du, dv]) =>
  [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) =>
    sevenBallXY(u * du[0] + v * dv[0], u * du[1] + v * dv[1], R, ROW_H),
  );

check('七色小球：正好三个朝向', SEVEN_RHOMBI.length === 3, `${SEVEN_RHOMBI.length} 个`);
SEVEN_RHOMBI.forEach((basis, i) => {
  isRhombus(`七色小球：第 ${i + 1} 个朝向是菱形`, sevenPts(basis));
});

{
  // 三个朝向必须是同一个形状转过来的——边长一样。有一个大一圈，说明那两个基
  // 向量不是相邻的两个方向。
  const sides = SEVEN_RHOMBI.map((b) => {
    const p = sevenPts(b);
    return dist(p[0], p[1]);
  });
  check('七色小球：三个朝向一样大（同一个形状转过来的）', sides.every((s) => near(s, sides[0])), sides.map((s) => s.toFixed(2)).join(' / '));
}

{
  // 三个朝向必须互不相同：两个基向量选重了，就会有两个朝向长得一模一样，玩
  // 家能凑出来的其实只有两种。
  const keys = SEVEN_RHOMBI.map((b) =>
    sevenPts(b)
      .map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`)
      .sort()
      .join('|'),
  );
  check('七色小球：三个朝向互不相同', new Set(keys).size === 3, `${new Set(keys).size} 种`);
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

/**
 * 外边族消除：「只削此刻最外面的那一条线」到底有没有在按 §3 跑。
 *
 *   npx esbuild src/engine/outerEdge.ts --bundle --format=esm --outfile=/tmp/edge.mjs
 *   node scripts/check-line-clear.mjs /tmp/edge.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 查的是什么
 *
 * 《侵蚀阶梯》v1.2 §3：五副外边族棋盘（小球、菱形方块、六边三角 54、六边圆球、
 * 七色圆球）只削**此刻最外面的一条**线，格子离场，棋盘一圈圈往里缩。
 *
 * 这道门守两件真会出事的事：
 *
 *   ① **别从中间掏空。** 削掉一条中间的线会把穿过它的每条线截成两段，那副盘就
 *      再也滑不动了（滑动是在一条连续的活格上做循环移位）。所以每削一条都要
 *      复核「每条线的活格还连着」，而且要有反向断言：中间那条线，就算整条同色
 *      星星，也不许当外边。
 *   ② **三个尖角不许让棋盘缩不动。** 三角形每一族的另一端是一条只有 1 枚的极
 *      值线。「不够门槛就往里找」的话，算法会把第二层当外边、尖角永远留着，盘
 *      子缩到一半就停。§3 写的是「不足门槛的极值线不是边，**但挡住这一端**」，
 *      这道门钉的就是这一句。
 *
 * 再加一条尺子：一路削到底。常态门槛 3 削到 2 行三角就停得下来（这正是「收尾放
 * 开」存在的理由），放开到 1 之后能削光。要是哪天把门槛判错了，这两个数会一起变。
 * ─────────────────────────────────────────────────────────────────────────
 */
const src = process.argv[2];
if (!src) {
  console.error('用法: node scripts/check-line-clear.mjs <打包好的 outerEdge.mjs>');
  process.exit(2);
}
const { outerEdges, shortestEdge, endsAll, atSegmentEnd, liveOn, EDGE_MIN, EDGE_MIN_ENDGAME } =
  await import(src);

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const key = (r, c) => `${r},${c}`;

// ---------------------------------------------------------------------------
// 一副三角棋盘（小球那一副的形状：7 行 28 枚），线表照 shapes/circle.ts 抄
// ---------------------------------------------------------------------------
//
// A 族：固定 d = r − c（右边那一条斜边是 d=0）
// B 族：固定 e = c（左边那一条斜边是 e=0）
// R 族：固定 r（底下那一行是 r=6）
function triBoard(rows = 7) {
  const gone = new Set();
  const lines = [];
  for (let d = 0; d < rows; d++) {
    const cells = [];
    for (let r = d; r < rows; r++) cells.push([r, r - d]);
    lines.push({ fam: 'A', offset: d, cells });
  }
  for (let e = 0; e < rows; e++) {
    const cells = [];
    for (let r = e; r < rows; r++) cells.push([r, e]);
    lines.push({ fam: 'B', offset: e, cells });
  }
  for (let r = 0; r < rows; r++) {
    const cells = [];
    for (let c = 0; c <= r; c++) cells.push([r, c]);
    lines.push({ fam: 'R', offset: r, cells });
  }
  const board = {
    lines,
    isLive: (r, c) => r >= 0 && r < rows && c >= 0 && c <= r && !gone.has(key(r, c)),
  };
  board.gone = gone;
  board.count = () => {
    let n = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c <= r; c++) if (board.isLive(r, c)) n++;
    return n;
  };
  return board;
}

/** 每条线的活格都连着吗（活格之间不许夹着离场的格子）。 */
function allLinesContiguous(board) {
  for (const line of board.lines) {
    const flags = line.cells.map(([r, c]) => board.isLive(r, c));
    // 「一段连续」= 展开成字符串之后至多一段 1
    const runs = flags.join('').split('0').filter((s) => s.length).length;
    if (runs > 1) return line;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 1. 满盘三角：三条长边是外边，三个尖角不是
// ---------------------------------------------------------------------------
{
  const b = triBoard(7);
  const edges = outerEdges(b, EDGE_MIN);
  const sig = edges
    .map((e) => `${e.line.fam}${e.line.offset}:${e.live.length}`)
    .sort()
    .join(' ');
  check('满盘三角：正好三条外边（底行、左斜边、右斜边），各 7 枚',
    sig === 'A0:7 B0:7 R6:7', sig);
  check('满盘三角：最短外边 7 枚', shortestEdge(b, EDGE_MIN) === 7, String(shortestEdge(b, EDGE_MIN)));
  // 三个尖角（R0=(0,0)、A6=(6,0)、B6=(6,6)）各是一条 1 枚的极值线：不够门槛，
  // 所以不是边——而且不许因此改去看更内层的线（那会把第二层当外边）。
  check('满盘三角：三个尖角那三条 1 枚的极值线不算外边',
    !edges.some((e) => e.live.length === 1));
  check('满盘三角：没有一条第二层的线被当成外边（尖角挡住了那一端）',
    !edges.some((e) => e.line.offset === 1 || (e.line.fam === 'R' && e.line.offset === 5)),
    edges.map((e) => `${e.line.fam}${e.line.offset}`).join(' '));
}

// ---------------------------------------------------------------------------
// 2. 反向：中间那条线，整条都在，也不许当外边
// ---------------------------------------------------------------------------
{
  const b = triBoard(7);
  const mid = b.lines.find((l) => l.fam === 'R' && l.offset === 3);
  const edges = outerEdges(b, EDGE_MIN);
  check('中间那一行（R3，4 枚）不是外边', !edges.some((e) => e.line === mid));
  // 就算把门槛降到 1（收尾放开）也还是不许——它不是极值线，跟门槛没关系。
  check('收尾放开之后中间那一行还是不是外边',
    !outerEdges(b, EDGE_MIN_ENDGAME).some((e) => e.line === mid));
  // endsAll 也单独拦得住它：它上头那一行还在，所以它的格子不贴任何一端。
  check('endsAll 单独就拦得住中间那一行', endsAll(b, mid, liveOn(b, mid)) === false);
}

// ---------------------------------------------------------------------------
// 3. 一路削到底：常态停在 2 行三角，放开之后削光
// ---------------------------------------------------------------------------
{
  const b = triBoard(7);
  let peels = 0;
  let broke = null;
  // 每次削掉「最短的那一条」——挑哪一条不影响这道门要量的东西（削完还连着、
  // 门槛拦得住），挑最短的只是让每一步都确定。
  for (;;) {
    const edges = outerEdges(b, EDGE_MIN);
    if (!edges.length) break;
    edges.sort((x, y) => x.live.length - y.live.length || x.line.offset - y.line.offset);
    for (const [r, c] of edges[0].live) b.gone.add(key(r, c));
    peels++;
    broke = broke ?? allLinesContiguous(b);
    if (peels > 50) break;
  }
  check('一路削：每削一条之后每条线的活格都还连着',
    broke === null, broke ? `${broke.fam}${broke.offset} 断了` : '');
  // 常态门槛 3 一定会停在「盘上还剩东西」这一步：削到最后那几枚，每一条极值线都
  // 短过 3 了。这就是「收尾放开」存在的全部理由——不放开，每一局都以「盘上还剩几
  // 枚、怎么滑都没用」收场。
  //
  // 剩几枚不写死：挑哪一条边先削会改这个数（这道门挑的是最短那条），而要量的是
  // 「停得下来、而且没削光」，不是某个具体数字。
  check('常态门槛 3：削到削不动为止，盘上还剩东西（所以非放开不可）',
    b.count() > 0 && b.count() < 28, `还剩 ${b.count()} 枚`);
  check('停下来的时候一条可削外边都没有', shortestEdge(b, EDGE_MIN) === 0);
  check('这时候把门槛放开到 1，又有边可削了', shortestEdge(b, EDGE_MIN_ENDGAME) >= 1,
    `最短 ${shortestEdge(b, EDGE_MIN_ENDGAME)} 枚`);

  // 收尾放开：门槛 1，级联削到底。
  let more = 0;
  for (;;) {
    const edges = outerEdges(b, EDGE_MIN_ENDGAME);
    if (!edges.length) break;
    for (const [r, c] of edges[0].live) b.gone.add(key(r, c));
    more++;
    broke = broke ?? allLinesContiguous(b);
    if (more > 20) break;
  }
  check('收尾放开之后削得光（一枚不剩）', b.count() === 0, `${b.count()} 枚`);
  check('收尾那几下也没把任何一条线截断', broke === null);
}

// ---------------------------------------------------------------------------
// 4. 六边圆球：中心那个永久空位不算活格，也不挡 endsAll
// ---------------------------------------------------------------------------
//
// 边长 4 的正六边形（37 格），中心 [3,3] 永久空着 → 36 枚可用。线表按立方坐标的
// 三个轴分族，offset 取那一轴的定值。
{
  const N = 3; // 半径：cube 坐标 |x|,|y|,|z| ≤ 3
  const cells = [];
  for (let x = -N; x <= N; x++)
    for (let z = -N; z <= N; z++) {
      const y = -x - z;
      if (Math.abs(y) > N) continue;
      cells.push([x, z]);
    }
  const CENTER = '0,0';
  const gone = new Set();
  const isLive = (x, z) =>
    cells.some(([a, b]) => a === x && b === z) && key(x, z) !== CENTER && !gone.has(key(x, z));
  const lines = [];
  // 三个族：固定 z（行）、固定 x、固定 y=-x-z。
  for (let z = -N; z <= N; z++) {
    const row = cells.filter(([, b]) => b === z).sort((p, q) => p[0] - q[0]);
    lines.push({ fam: 'Z', offset: z, cells: row });
  }
  for (let x = -N; x <= N; x++) {
    const col = cells.filter(([a]) => a === x).sort((p, q) => p[1] - q[1]);
    lines.push({ fam: 'X', offset: x, cells: col });
  }
  for (let y = -N; y <= N; y++) {
    const dia = cells.filter(([a, b]) => -a - b === y).sort((p, q) => p[0] - q[0]);
    lines.push({ fam: 'Y', offset: y, cells: dia });
  }
  const board = { lines, isLive };
  const live = () => cells.filter(([x, z]) => isLive(x, z)).length;
  check('六边圆球：中心空着，可用 36 枚', live() === 36, `${live()} 枚`);

  const edges = outerEdges(board, EDGE_MIN);
  const sig = edges.map((e) => `${e.line.fam}${e.line.offset}:${e.live.length}`).sort().join(' ');
  check('六边圆球：六条边都是外边，各 4 枚',
    sig === 'X-3:4 X3:4 Y-3:4 Y3:4 Z-3:4 Z3:4', sig);

  // 穿过中心的那三条线各被空位截成两段（3 + 3）。它们不是极值线，所以本来就不该
  // 是外边；这里要钉的是**空位没有把六条真边判掉**——上面那一条已经量到了（六条
  // 全在），这一条从另一头量：那三条线的中段格子确实被判成「不贴端」。
  const midRow = lines.find((l) => l.fam === 'Z' && l.offset === 0);
  check('六边圆球：穿过中心的那一行被空位截成两段', liveOn(board, midRow).length === 6,
    `${liveOn(board, midRow).length} 枚`);
  /*
   * 空位挡不挡 endsAll，就看 atSegmentEnd 这一处——直接量它。
   *
   * Z=0 那一行的格子是 (-3,0) … (3,0)，中间 (0,0) 是永久空位。紧贴空位的 (-1,0)：
   * 按「自己那一段」算它贴着端（左边 (-2,0) 活、右边是空位），按「整条线的活格清
   * 单」算它的下标是 2（清单共 6 枚），会被判成在中间。两种读法在这一格上给出相
   * 反的答案，所以这一条断言正好把它们分开。
   *
   * 写错的代价不在屏幕上：只是穿过中心那三条线永远削不动，玩家只觉得「这盘运气
   * 差」。
   */
  check('六边圆球：紧贴中心空位的那一枚算「贴着自己那一段的端」（空位不挡 endsAll）',
    atSegmentEnd(board, midRow, [-1, 0]) === true);
  check('六边圆球：再往外一枚 (-2,0) 两边都是活格，不算贴端（反向对照）',
    atSegmentEnd(board, midRow, [-2, 0]) === false);
  check('六边圆球：那一行两头 (-3,0) 照旧算贴端',
    atSegmentEnd(board, midRow, [-3, 0]) === true);

  // 削掉一条边之后，剩下的还得是连着的（空位那三条线本来就是两段，不算断）。
  for (const [x, z] of edges[0].live) gone.add(key(x, z));
  let split = null;
  for (const line of lines) {
    const flags = line.cells.map(([x, z]) => isLive(x, z));
    const runs = flags.join('').split('0').filter((s) => s.length).length;
    // 穿过中心的三条允许两段（那是永久空位造成的，不是削出来的）。
    const allowed = line.cells.some(([x, z]) => key(x, z) === CENTER) ? 2 : 1;
    if (runs > allowed) { split = line; break; }
  }
  check('六边圆球：削掉一条边之后没有线被截断',
    split === null, split ? `${split.fam}${split.offset}` : '');
}

// ---------------------------------------------------------------------------
// 5. 门槛就是 3 和 1（写死在模块里，别让它悄悄变）
// ---------------------------------------------------------------------------
check('常态门槛 3', EDGE_MIN === 3, String(EDGE_MIN));
check('收尾放开门槛 1', EDGE_MIN_ENDGAME === 1, String(EDGE_MIN_ENDGAME));

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);

/**
 * 残局穷举的**接线层**（`src/engine/residueBoard.ts`）。
 *
 *   npx esbuild src/engine/residueBoard.ts --bundle --format=esm --outfile=/tmp/resboard.mjs
 *   node scripts/check-residue-board.mjs /tmp/resboard.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么这一层单独守
 *
 * 搜索件本身（residueSearch.ts）自己有一道门，那一道验的是「给定盘面，答得对不对」。这一
 * 道验的是**喂进去的那副盘面对不对**——六副棋盘把自己的线和格子交过来，编码错一点，搜索
 * 件就在算另一副棋盘，而它会**言之凿凿地**答 'dead'。
 *
 * 而 'dead' 这一侧是最不能错的：它会把一局还能打的棋盘 1.4 秒直接结算。所以这一道门的每
 * 一条都朝同一个方向问：**有没有哪种接法会让它少看见一些得分**。
 *
 * 三件真会接错的事，各有一条：
 *
 *   ① **空白和活炸弹要进盘面。** 各副棋盘的 `liveTiles()` 把它们排除在外（那一份是给计分
 *      和计数用的），可它们是**跟着线一起滑**的。漏掉就是在算另一副棋盘。
 *   ② **不在盘上的格子不许进线。** 留着它们等于插一堵看不见的墙，把本来连得上的一段截
 *      断——少看见得分，往「判死」那一侧偏。
 *   ③ **「可用 ≤16 枚」数的是非空白那几枚。** 按线上总格数数的话，这个兜底在五副外边族
 *      上**永远不会触发**（它们消掉的球原地变空白，晚盘大半是空白），而那正是最需要它的
 *      时候。
 *
 * 纯算术，不开浏览器，进得了 CI。
 */
const src = process.argv[2];
if (!src) {
  console.error('用法: node scripts/check-residue-board.mjs <打包好的 residueBoard.mjs>');
  console.error('  npx esbuild src/engine/residueBoard.ts --bundle --format=esm --outfile=/tmp/resboard.mjs');
  process.exit(2);
}
const { residueVerdict, edgeResidue, gridResidue, RESIDUE_MAX_TILES } = await import(src);

let fail = 0;
const check = (n, ok, extra = '') => {
  if (!ok) fail++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (extra ? '  ' + extra : ''));
};
const head = (t) => console.log('\n' + t);

/** 一张小棋盘：`map` 里 'A'/'B' 是色块，'a'/'b' 是同色星星，'.' 是空白，' ' 是不在盘上。 */
function boardFrom(rowsOfText) {
  const at = (r, c) => {
    const ch = rowsOfText[r]?.[c];
    if (ch === undefined || ch === ' ') return null;
    if (ch === '.') return 'blank';
    const color = ch.toLowerCase() === 'a' ? 1 : 2;
    return { color, dot: ch === ch.toLowerCase() };
  };
  return { at, rows: rowsOfText.length, cols: Math.max(...rowsOfText.map((r) => r.length)) };
}

head('【0】尺子：三个函数都在，上限是 §4 那个 16');
for (const [n, v] of Object.entries({ residueVerdict, edgeResidue, gridResidue })) {
  check(`导出了 ${n}`, typeof v === 'function');
}
check('可用枚数上限是 16（§4 字面值）', RESIDUE_MAX_TILES === 16, String(RESIDUE_MAX_TILES));

head('【1】gridResidue：方块那一副的线就是此刻的行和列');
{
  // 2×2，四枚同色色块。任何一条线只有 2 格，1×4 永远摆不出来。
  const b = boardFrom(['AA', 'AA']);
  check('2×2 四枚同色色块、要 4 枚 → dead',
    gridResidue(b.rows, b.cols, b.at, 4) === 'dead', gridResidue(b.rows, b.cols, b.at, 4));
  // 同一副盘，门槛降到 2 → 当场就成（尺子：这个函数真的在按 matchLen 判，不是恒 dead）。
  check('（尺子）同一副盘门槛降到 2 → scores',
    gridResidue(b.rows, b.cols, b.at, 2) === 'scores', gridResidue(b.rows, b.cols, b.at, 2));
}
{
  // 一行四格，滑一下就连成 1×4。
  const b = boardFrom(['AABA', 'BBAB']);
  check('滑一下连得上 → scores', gridResidue(b.rows, b.cols, b.at, 4) === 'scores');
}
{
  // 整行全是同色星星 → 整线消除那条路（方块的门槛是整行长度）。
  const b = boardFrom(['aaa', 'BAB', 'BAB']);
  check('整行同色星星 → scores（整线消除那条路）',
    gridResidue(b.rows, b.cols, b.at, 9) === 'scores');
}
{
  // 整行差一枚色块，整线消除永远凑不齐；图案门槛又高到摆不出来。
  const b = boardFrom(['aaA', 'BAB', 'BAB']);
  check('整行混一枚色块 → 整线消除走不通，门槛又够不着 → dead',
    gridResidue(b.rows, b.cols, b.at, 9) === 'dead');
}

head('【2】空白要进盘面（它跟着线一起滑）');
{
  // 一行：A A . A，要 3 枚同色。空白卡在中间，但它会跟着滑——转一下就能让三枚 A 连上。
  const b = boardFrom(['AA.A']);
  check('空白跟着滑，转一下三枚连上 → scores',
    gridResidue(b.rows, b.cols, b.at, 3) === 'scores', gridResidue(b.rows, b.cols, b.at, 3));
  // 反面：要 4 枚。四格里有一个空白，永远凑不出 4 枚同色——空白要是被**漏掉**（当成
  // 不存在、两边接上），这一行就成了三格，判定会走样。
  check('要 4 枚时 → dead（空白占着一格，接不上）',
    gridResidue(b.rows, b.cols, b.at, 4) === 'dead');
}

head('【3】不在盘上的格子不许占位置');
{
  // 中间那一格不在盘上（空格）。A A _ A：三枚 A 在**线上**是连续的，要 3 枚就该成。
  const b = boardFrom(['AA A']);
  check('不在盘上的格子不占位，三枚在线上连续 → scores',
    gridResidue(b.rows, 4, b.at, 3) === 'scores', gridResidue(b.rows, 4, b.at, 3));
}

head('【4】「可用 ≤16 枚」数的是非空白那几枚');
{
  // 一行 20 格：16 个空白 + 4 枚同色色块。按**总格数**卡的话这一副会被当成「太大，不
  // 算了」（unknown）——而这正是外边族晚盘的样子，兜底在那儿永远不会触发。
  const row = '....' + 'AAAA' + '............';
  const b = boardFrom([row]);
  const v = gridResidue(1, row.length, b.at, 4);
  check('20 格里只有 4 枚可用 → 真的算了（不是 unknown）', v !== 'unknown', v);
  check('而且算出来是 scores（四枚本来就连着）', v === 'scores', v);
}
{
  // 真的超过 16 枚可用：不算，答 unknown（**不是 dead**）。
  const row = 'AB'.repeat(10);           // 20 枚可用
  const b = boardFrom([row]);
  const v = gridResidue(1, row.length, b.at, 4);
  check('超过 16 枚可用 → unknown，绝不是 dead', v === 'unknown', v);
}

head('【5】edgeResidue：外边族那五副');
{
  // 一副三格的小盘：一条线，三枚同色星星，门槛 3 → 整线消除那条路走得通。
  const line = { fam: 'row', offset: 0, cells: [[0, 0], [0, 1], [0, 2]] };
  const board = { lines: [line], isLive: () => true };
  const at = () => ({ color: 1, dot: true });
  check('三枚同色星星填满唯一那条外边 → scores',
    edgeResidue(board, at, 9, 3) === 'scores', edgeResidue(board, at, 9, 3));
  // 门槛抬到 4：这条线只有 3 格，削不动了（outerEdges 不会把它算成可削外边）。
  check('门槛抬到 4，这条线削不动 → dead',
    edgeResidue(board, at, 9, 4) === 'dead', edgeResidue(board, at, 9, 4));
}
{
  // 线上混一枚色块：整条同色星星永远凑不齐。
  const line = { fam: 'row', offset: 0, cells: [[0, 0], [0, 1], [0, 2]] };
  const board = { lines: [line], isLive: () => true };
  const at = (r, c) => (c === 1 ? { color: 1, dot: false } : { color: 1, dot: true });
  check('线上混一枚色块 → 整线消除走不通 → dead', edgeResidue(board, at, 9, 3) === 'dead');
  // 尺子：同一副盘，图案门槛降到 3 就成（三枚同色、含一枚色块）——证明上面那条
  // dead 不是因为这个函数恒 dead。
  check('（尺子）同一副盘图案门槛降到 3 → scores', edgeResidue(board, at, 3, 3) === 'scores');
}

head('【6】六边三角 54 那套重排（只许偶数步）');
{
  // 一条 4 格的线：A B A A。普通循环位移滑 1 格就能让三枚 A 连上；只许偶数步的话
  // 滑 2 格 → A A A B，也连得上。所以两套都该答 scores——这一条只验「filler 那一路
  // 真的被走到了」，不是验它更严。
  const b = boardFrom(['ABAA']);
  const line = { fam: 'row', offset: 0, cells: [[0, 0], [0, 1], [0, 2], [0, 3]] };
  const board = { lines: [line], isLive: () => true };
  check('filler 那一路走得通', edgeResidue(board, b.at, 3, 9, true) === 'scores',
    edgeResidue(board, b.at, 3, 9, true));
  // 一条 2 格的线：偶数步里没有一步可走（唯一的 1 格是奇数），所以 filler 那一路
  // 一步都没有 → dead；普通那一路滑 1 格，也还是凑不出 2 枚同色。
  const two = { fam: 'row', offset: 0, cells: [[0, 0], [0, 1]] };
  const b2 = boardFrom(['AB']);
  check('2 格的线在 filler 那一路一步都走不了 → dead',
    edgeResidue({ lines: [two], isLive: () => true }, b2.at, 2, 9, true) === 'dead');
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);

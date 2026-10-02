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
 *   ① **跟着线一起滑的东西都要进盘面。** 两副棋盘这一条的内容**不一样**，而这正是
 *      2026-10-02 修的那个 bug：
 *
 *      · 方块（`gridResidue`）：空位和活炸弹都占着一格、都跟着整行整列滑，所以一格不少
 *        地进盘面，只是编成「配不上任何颜色」。
 *      · 五副外边族（`edgeResidue`）：**空白压根不在盘上**。滑动是在 `liveOnLine()` 那一
 *        串上做循环位移（见各副棋盘的 `applyDrag`），被削掉的格子已经不在那串里，剩下的
 *        球首尾相接、整条线变短。所以它们的 `residueAt` 对空白回 `null`。活炸弹照旧回
 *        `'blank'`——它真的占着一格。
 *
 *      从前五副外边族也回 `'blank'`，那是**星星消除那个年代**的事（消掉的球原地变一枚无
 *      色球，确实照样滑）。《侵蚀阶梯》PR-3 改成「削掉的格子离场」之后，那一句就在拿一副
 *      不存在的棋盘喂给穷举：线长不对，循环位移算出来的排列整个不对。
 *   ② **不在盘上的格子不许进线。** 留着它们等于插一堵看不见的墙，把本来连得上的一段截
 *      断——少看见得分，往「判死」那一侧偏。
 *   ③ **「可用 ≤16 枚」数的是非 `RESIDUE_BLANK` 那几枚。** 差的那几枚是活炸弹：占着格
 *      子、跟着线滑，可一个也配不上，不该算进「可用」。
 *
 * 纯算术，不开浏览器，进得了 CI。
 *
 *   npx esbuild src/engine/residueBoard.ts  --bundle --format=esm --outfile=/tmp/resboard.mjs
 *   npx esbuild src/engine/residueSearch.ts --bundle --format=esm --outfile=/tmp/ressearch.mjs
 *   node scripts/check-residue-board.mjs /tmp/resboard.mjs /tmp/ressearch.mjs
 *
 * 第二份是给【7】【8】用的：那两节要一个**不设预算**的精确搜索当对照，而判「这个盘面得不
 * 得分」用的是 `residueSearch.ts` 自己导出的 `scoresNow`——门拿它当尺子，不另抄一份判定。
 */
const [src, searchSrc] = process.argv.slice(2);
if (!src) {
  console.error('用法: node scripts/check-residue-board.mjs <residueBoard.mjs> [residueSearch.mjs]');
  console.error('  npx esbuild src/engine/residueBoard.ts  --bundle --format=esm --outfile=/tmp/resboard.mjs');
  console.error('  npx esbuild src/engine/residueSearch.ts --bundle --format=esm --outfile=/tmp/ressearch.mjs');
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
  //
  // ⚠️ 这一条只对**方块**成立：它的空位真的占着一格、真的跟着整行整列滑。五副外边族相
  // 反（空白不在盘上，根本不进线），所以它们的 `residueAt` 回 `null`，而不是 `'blank'`。
  // 见文件顶上 ① 那一段。两副棋盘这一点不一样，不是哪一边写错了。
  check('要 4 枚时 → dead（**方块**的空白占着一格，接不上）',
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

// ══════════════════════════════════════════════════════════════════════════
// 【7】【8】要用真的小球线，和一个不设预算的精确搜索当对照
// ══════════════════════════════════════════════════════════════════════════
//
// 上面那六节喂的都是手搭的小棋盘（一行三格、2×2），那是对的：它们验的是**编码**这一层，
// 小盘才看得清。可编码对了之后还剩一个问题：**在真的那副棋盘上，这个兜底到底够不够快**。
//
// 真的小球盘是 7 行 28 格、21 条线，而预算只有 20000 个状态 / 250ms（§4）。所以「判死」这
// 件事在真盘上可能压根来不及——答 'unknown' 一样是安全的（当活），只是那个兜底等于不存
// 在。而它存在的全部理由就是收掉「数量够、摆法永远到不了」那种残局。
//
// 线是**照 src/shapes/circle.ts 那三族重搭**的（fixed d = r−c / fixed c / fixed r，ROWS=7）。
// 抄一遍而不是 import：那三个函数住在 createCircleGame 的闭包里，外面拿不到。所以【7】第一
// 条先验「搭出来的和真的一样」——21 条线、各族长度对得上，搭错了当场红。
if (searchSrc) {
  const { scoresNow, cyclicShuffles, encodeTile, RESIDUE_BLANK, RESIDUE_MAX_STATES } =
    await import(searchSrc);

  // ── 真的小球线 ────────────────────────────────────────────────
  const ROWS = 7;
  const lineA = (d) => Array.from({ length: ROWS - d }, (_, i) => [d + i, i]);
  const lineB = (e) => Array.from({ length: ROWS - e }, (_, i) => [e + i, e]);
  const lineRow = (r) => Array.from({ length: r + 1 }, (_, c) => [r, c]);
  const LINES = [
    ...Array.from({ length: ROWS }, (_, d) => ({ fam: 'A', offset: d, cells: lineA(d) })),
    ...Array.from({ length: ROWS }, (_, e) => ({ fam: 'B', offset: e, cells: lineB(e) })),
    ...Array.from({ length: ROWS }, (_, r) => ({ fam: 'R', offset: r, cells: lineRow(r) })),
  ];

  head('【7】真的小球线：搭出来的那一份要和棋盘里那一份一样');
  check('21 条线（三族各 7 条）', LINES.length === 21, String(LINES.length));
  check('每族最长 7 格、最短 1 格',
    LINES.filter((l) => l.cells.length === ROWS).length === 3 &&
    LINES.filter((l) => l.cells.length === 1).length === 3);
  check('28 个格子一个不少、一个不多',
    new Set(LINES.flatMap((l) => l.cells.map(([r, c]) => r + ',' + c))).size === 28);
  check('每一格都在三条线上（A、B、R 各一条）',
    LINES.flatMap((l) => l.cells).length === 28 * 3);

  /**
   * 一副残局：`live` 是 `[r, c, 色号, 是不是星星]` 的清单，别的格子全是空白。
   *
   * 空白回 `null`（不在盘上），正是五副外边族现在的 `residueAt`。
   */
  const residueBoard = (live) => {
    const map = new Map(live.map(([r, c, color, dot]) => [r + ',' + c, { color, dot }]));
    const at = (r, c) => map.get(r + ',' + c) ?? null;
    const isLive = (r, c) => r >= 0 && r < ROWS && c >= 0 && c <= r && map.has(r + ',' + c);
    return { board: { lines: LINES, isLive }, at };
  };

  /**
   * 不设预算的精确搜索——这一节的对照。
   *
   * 和被测那一个只差一样：**没有 maxStates、没有 deadline**，闭包走到底。判「这个盘面得不
   * 得分」用的是 `residueSearch.ts` 自己导出的 `scoresNow`（它正是为此导出的），所以这一
   * 条对照验的是**搜索和预算**，不是又抄一份得分判定——抄一份的话两边会一起错。
   */
  function exact(start, moves, scanLines, matchLen, bonusLines) {
    if (scoresNow(start, scanLines, matchLen, bonusLines)) return 'scores';
    if (!moves.length) return 'dead';
    const keyOf = (st) => st.join(',');
    const seen = new Set([keyOf(start)]);
    let frontier = [start];
    while (frontier.length) {
      const next = [];
      for (const st of frontier) {
        for (const { cells, src: from } of moves) {
          const child = Uint16Array.from(st);
          for (let i = 0; i < cells.length; i++) child[cells[i]] = st[cells[from[i]]];
          const k = keyOf(child);
          if (seen.has(k)) continue;
          seen.add(k);
          if (scoresNow(child, scanLines, matchLen, bonusLines)) return 'scores';
          next.push(child);
        }
      }
      frontier = next;
    }
    return 'dead';
  }

  /**
   * 把一副残局编成搜索件认得的样子——和 `residueBoard.ts` 的 `build()` 同一套规则（空白不
   * 进线、少于 2 格的线丢掉），这样精确搜索和被测那一个看的是同一副盘。
   */
  function encodeResidue(live, threshold) {
    const map = new Map(live.map(([r, c, color, dot]) => [r + ',' + c, { color, dot }]));
    const index = new Map();
    const codes = [];
    const lines = [];
    for (const l of LINES) {
      const row = [];
      for (const [r, c] of l.cells) {
        const got = map.get(r + ',' + c);
        if (!got) continue;
        const k = r + ',' + c;
        let id = index.get(k);
        if (id === undefined) {
          id = codes.length;
          index.set(k, id);
          codes.push(encodeTile(got.color, got.dot));
        }
        row.push(id);
      }
      if (row.length >= 2) lines.push(row);
    }
    // 能削的外边：这儿用一个和 outerEdge.ts 等价的粗办法——一条线上**全是**活格、而且
    // 长度 ≥ threshold。残局上（大半格子空着）这两者是同一回事。
    const bonus = [];
    for (const l of LINES) {
      const ids = l.cells.map(([r, c]) => index.get(r + ',' + c)).filter((x) => x !== undefined);
      if (ids.length === l.cells.length && ids.length >= threshold) bonus.push({ cells: ids, need: threshold });
    }
    return { start: Uint16Array.from(codes), lines, bonus };
  }

  head('【7】真的小球线上，一副四枚的残局要判**死**，不是「算不完」');
  {
    /*
     * 两色各两枚，图案门槛 3：三枚同色永远凑不出来（每色只有两枚），整线消除要 3 枚同色
     * **星星**而这儿每色只有一枚星星。所以这一副是真死局——而要紧的是被测那一个**真的算
     * 完了**，没有因为盘大就答 unknown。
     *
     * ⚠️ 每色一枚色块一枚星星，不是四枚都星星。四枚都星星的话这一副在**任何**门槛下都是
     * 死的（§1.1：图案里至少要有一枚色块），下面那条「门槛降到 2 就成」的反面尺子于是量
     * 不出东西——第一版就是这样，而红的是尺子不是代码。
     */
    const live = [[6, 0, 1, false], [6, 2, 1, true], [4, 1, 2, false], [2, 2, 2, true]];
    const { board, at } = residueBoard(live);
    const got = edgeResidue(board, at, 3, 3);
    const enc = encodeResidue(live, 3);
    const want = exact(enc.start, cyclicShuffles(enc.lines), enc.lines, 3, enc.bonus);
    check('精确搜索：这一副是死局（尺子）', want === 'dead', want);
    check('被测那一个也答 dead（没答 unknown）', got === 'dead', got);
    // 反面尺子：同一副盘，图案门槛降到 2 → 同色两枚（一枚色块）凑得出来，必须答 scores。
    check('（尺子）门槛降到 2 → scores（不是恒 dead）', edgeResidue(board, at, 2, 3) === 'scores',
      edgeResidue(board, at, 2, 3));
  }
  {
    /*
     * 空白**不进线**这件事在真盘上的样子：三枚同色坐在第 6 行的三个**不相邻**的格子上。
     *
     * 那一行原本 7 格，中间隔着空白。空白不进线之后，线上只剩这三格——它们是**连续**的，
     * 滑不滑都已经成图案。从前把空白当成占位的无色球，这三枚中间隔着两格，门槛 3 永远凑
     * 不齐：同一副盘，两种接法答相反的话。
     */
    const live = [[6, 0, 1, false], [6, 3, 1, true], [6, 6, 1, true]];
    const { board, at } = residueBoard(live);
    check('三枚同色（含一枚色块）在同一行、中间隔着空白 → scores',
      edgeResidue(board, at, 3, 3) === 'scores', edgeResidue(board, at, 3, 3));

    /*
     * §1.1：**全是星星的线不算图案**。所以把那枚色块也换成星星，图案那条路就关了，只剩
     * 整线消除——而整线消除要那条线是一条「可削外边」。这儿用门槛把它关掉：
     *
     *   门槛 3 → 第 6 行上三个活格够数，它是可削外边 → 三枚同色星星填满它 → scores。
     *   门槛 4 → 不够数，一条边都削不动 → 两条路都关了 → dead。
     *
     * 两条一起量，才说得清「它不是恒 dead、也不是恒 scores」。
     */
    const allStars = [[6, 0, 1, true], [6, 3, 1, true], [6, 6, 1, true]];
    const b2 = residueBoard(allStars);
    check('（§1.1）三枚全是星星、门槛 3：图案那条路不算，整线那条路成 → scores',
      edgeResidue(b2.board, b2.at, 3, 3) === 'scores', edgeResidue(b2.board, b2.at, 3, 3));
    check('（§1.1）同一副盘门槛抬到 4：一条边都削不动 → dead',
      edgeResidue(b2.board, b2.at, 3, 4) === 'dead', edgeResidue(b2.board, b2.at, 3, 4));
  }

  head('【8】随机残局对照精确搜索：活局误判 0，死局检出 ≥ 80%');
  {
    /** 一个够用的确定性随机数（门要可复现：红了能照同一个种子再跑一遍）。 */
    let seed = 20261002;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const CELLS = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c <= r; c++) CELLS.push([r, c]);

    let aliveWronglyDead = 0;
    let deadTotal = 0;
    let deadCaught = 0;
    let unknowns = 0;
    const ROUNDS = 150;
    for (let i = 0; i < ROUNDS; i++) {
      // 4 到 8 枚，两色，星块各半——残局的样子。
      const n = 4 + Math.floor(rnd() * 5);
      const pool = [...CELLS];
      const live = [];
      for (let k = 0; k < n; k++) {
        const pick = Math.floor(rnd() * pool.length);
        const [r, c] = pool.splice(pick, 1)[0];
        live.push([r, c, 1 + Math.floor(rnd() * 2), rnd() < 0.5]);
      }
      const { board, at } = residueBoard(live);
      const got = edgeResidue(board, at, 3, 3);
      const enc = encodeResidue(live, 3);
      const want = exact(enc.start, cyclicShuffles(enc.lines), enc.lines, 3, enc.bonus);
      if (got === 'unknown') unknowns++;
      if (want === 'scores' && got === 'dead') aliveWronglyDead++;
      if (want === 'dead') {
        deadTotal++;
        if (got === 'dead') deadCaught++;
      }
    }
    check(`活局一个都没被判死（${ROUNDS} 副）`, aliveWronglyDead === 0, `误判 ${aliveWronglyDead} 副`);
    check('（尺子）这一批里真有死局（否则上一条是空绿）', deadTotal >= 10, `${deadTotal} 副死局`);
    const rate = deadTotal ? deadCaught / deadTotal : 0;
    check(`死局检出率 ≥ 80%`, rate >= 0.8, `${deadCaught}/${deadTotal} = ${(rate * 100).toFixed(0)}%`);
    check('（尺子）预算那个数还是 §4 写的 20000', RESIDUE_MAX_STATES === 20000, String(RESIDUE_MAX_STATES));
    console.log(`      （顺带：${unknowns} 副答了 unknown，那是安全的一侧——当活）`);
    check('（尺子）RESIDUE_BLANK 还是 0（编码没换）', RESIDUE_BLANK === 0, String(RESIDUE_BLANK));
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 【9】源码断言：五处 residueAt 和老虎机那两处 return
// ══════════════════════════════════════════════════════════════════════════
//
// 上面那几节量的是**接线层自己**。可接线层再对，棋盘那一头喂错了一样白搭，而「喂错」在屏
// 幕上只是「某些局不结束」或者「局突然结束」。所以这儿读源码，钉住两件事：
//
//   · 五副外边族的 `residueAt` 对空白回 `null`（不是 `'blank'`）。这一句写错了，穷举算的
//     就是另一副棋盘——线长不对，循环位移算出来的排列整个不对。
//   · 老虎机那两副（方块、小球）在有目标时**不走穷举**：穷举判的是「凑不凑得出 1×N」，而
//     老虎机要凑的是转出来的那个形状。拿 1×N 那把尺子去量，它会把一局明明还能打的棋判死。
{
  const { readFileSync } = await import('node:fs');
  const read = (f) => readFileSync(new URL('../src/shapes/' + f, import.meta.url), 'utf8');
  const strip = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  head('【9】五副外边族：空白回 null，活炸弹回 blank');
  const EDGE_FAMILY = ['circle.ts', 'circleHex.ts', 'circleSeven.ts', 'squareDiamond.ts', 'triangle.ts'];
  for (const f of EDGE_FAMILY) {
    const src = strip(read(f));
    const at = src.indexOf('const residueAt = (r: number, c: number) =>');
    check(`${f}：有 residueAt`, at > 0, String(at));
    const body = src.slice(at, src.indexOf('};', at));
    check(`${f}：空白回 null`, /if \(isBlank\(t\)\) return null;/.test(body), body.replace(/\s+/g, ' ').slice(0, 120));
    check(`${f}：不许再回 'blank'`, !/isBlank\(t\) \|\| liveBomb\(t\)/.test(body));
    if (f !== 'circleSeven.ts') {
      check(`${f}：活炸弹照旧回 'blank'`, /if \(liveBomb\(t\)\) return 'blank'/.test(body),
        body.replace(/\s+/g, ' ').slice(0, 140));
    }
  }
  // 方块是另一回事：它的空位真的跟着整行整列滑，所以照旧 'blank'。这一条反着钉，免得有人
  // 「统一一下」把它也改成 null。
  head('【9】方块那一副**不改**：空位照旧跟着滑');
  {
    const src = strip(read('square.ts'));
    const at = src.indexOf('const residueAt = (r: number, c: number) =>');
    const body = src.slice(at, src.indexOf('};', at));
    check('square.ts：空位和活炸弹都回 blank（它们真的占着一格）',
      /if \(isBlank\(t\) \|\| liveBomb\(t\)\) return 'blank'/.test(body),
      body.replace(/\s+/g, ' ').slice(0, 140));
  }

  head('【9】老虎机那一局不走穷举（方块、小球两处）');
  for (const f of ['circle.ts', 'square.ts']) {
    const src = strip(read(f));
    check(`${f}：有「有目标就不穷举」那一句`, /if \(target\) return \[\];/.test(src));
    // 位置也要对：在计数那一层**之后**（计数说死就该照说），在 residueAt / 穷举**之前**。
    const counted = src.indexOf('if (counted.length) return counted;');
    const guard = src.indexOf('if (target) return [];');
    const search = src.search(/edgeResidue\(|gridResidue\(/);
    check(`${f}：排在「计数说死」之后`, counted > 0 && guard > counted, `${counted} / ${guard}`);
    check(`${f}：排在穷举之前`, search > 0 && guard < search, `${guard} / ${search}`);
  }
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);

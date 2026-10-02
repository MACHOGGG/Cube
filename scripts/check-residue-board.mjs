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
  const { scoresNow, cyclicShuffles, encodeTile, colorOf, isFront, RESIDUE_BLANK, RESIDUE_MAX_STATES } =
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

  /** 一条线上「活格连成几段」。`outerEdge.ts` 的 runCount 同胞。 */
  const runCountOn = (cells, isLive) => {
    let runs = 0;
    let prev = false;
    for (const [r, c] of cells) {
      const now = isLive(r, c);
      if (now && !prev) runs++;
      prev = now;
    }
    return runs;
  };

  /**
   * 此刻能削的外边——**照 `outerEdge.ts` 那三条重写一遍**：
   *
   *   ① 同族里 offset 最小 / 最大的那几条（只算还有活格的线）；
   *   ② 活格数 ≥ threshold；
   *   ③ `endsAll`：削掉它不会把别的线从一段切成两段。
   *
   * ⚠️ 这儿原先是个粗办法——「一条线上**全是**活格、而且长度 ≥ threshold」，旁边还写着
   * 「残局上这两者是同一回事」。那句话是错的，而且错得要命：真盘上一条 7 格的线只剩 3 格
   * 活着也照样是可削外边（削掉的是**活格**，不是整条线）。于是这把对照尺子**少看见一整条
   * 得分的路**：120 副里 20 副被测说 scores、对照说 dead，而真相是被测对的。
   *
   * 上面【8】那一节用的也是它，所以那条「死局检出率」的分母一直虚高——一批本来就不死的盘
   * 面被算进了「该判死」。假绿就是这么来的：两边**一起**偏，那条断言看着是绿的。
   */
  const edgesOf = (live, threshold) => {
    const map = new Set(live.map(([r, c]) => r + ',' + c));
    const isLive = (r, c) => map.has(r + ',' + c);
    const byFam = new Map();
    for (const l of LINES) {
      const lv = l.cells.filter(([r, c]) => isLive(r, c));
      if (!lv.length) continue;
      const bucket = byFam.get(l.fam);
      if (bucket) bucket.push({ l, lv });
      else byFam.set(l.fam, [{ l, lv }]);
    }
    const out = [];
    for (const bucket of byFam.values()) {
      const lo = Math.min(...bucket.map((e) => e.l.offset));
      const hi = Math.max(...bucket.map((e) => e.l.offset));
      for (const e of bucket) {
        if (e.l.offset !== lo && e.l.offset !== hi) continue;
        if (e.lv.length < threshold) continue;
        const gone = new Set(e.lv.map(([r, c]) => r + ',' + c));
        const after = (r, c) => isLive(r, c) && !gone.has(r + ',' + c);
        let ok = true;
        for (const other of LINES) {
          if (other === e.l) continue;
          const before = runCountOn(other.cells, isLive);
          if (before === 0) continue;
          if (runCountOn(other.cells, after) > before) { ok = false; break; }
        }
        if (ok) out.push({ cells: e.lv });
      }
    }
    return out;
  };

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
    const bonus = edgesOf(live, threshold).map((e) => ({
      cells: e.cells.map(([r, c]) => index.get(r + ',' + c)),
      need: threshold,
    }));
    return { start: Uint16Array.from(codes), lines, bonus, index };
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

  // ── 老虎机那一局，在真的小球线上 ──────────────────────────────
  //
  // 形状 '23' 落到小球的行列上是 {(r,c), (r+1,c), (r+1,c+1)}——由 `place('circle', …)` 那
  // 条「dg + dr 必须是偶数、列号只挪一半」算出来的（见 targetMatch.ts 顶上那段）。
  const TRI = { id: '23', family: 'circle', cells: [[0, 1], [1, 0], [1, 2]] };
  /** 格号 → 行列（`encodeResidue` 交出来的 index 是反过来的那一张）。 */
  const cellsOf = (enc) => {
    const out = [];
    for (const [k, id] of enc.index) out[id] = k.split(',').map(Number);
    return out;
  };
  /**
   * 对照尺子：这个盘面上有没有那个小三角。
   *
   * **手写的、和 `targetMatch.ts` 那个通用匹配器两条路**——对照就是要独立。
   *
   * 写法上绕了一下：不去枚举「这个形状的几种摆法」，而是说出它**是什么**——三枚球**两两
   * 相邻**。小球盘上 (r, c) 的几何位置是 (r, 2c − r)（半径为单位，见 targetMatch.ts 顶上
   * 那段），相邻就是差 (0, ±2) 或 (±1, ±1)。形状 '23' 的三个点 (0,1) (1,0) (1,2) 正是两两
   * 相邻，而任何三枚两两相邻的球都和它全等——横的竖的、转过去的、照镜子的，一网打尽。
   *
   * ⚠️ 第一版只认 {(r,c), (r+1,c), (r+1,c+1)} 这**一种**摆法，于是 120 副里有 20 副被测那
   * 一个说 scores、尺子说 dead——`findTargets` 认的是**所有**摆法（「图案怎么摆都算」，见
   * 它上面那段注释）。红的是尺子，不是代码。按「是什么」写就不会漏，按「长什么样」写会。
   *
   * 另外两条照旧：三枚同色、至少一枚是色块（§1.1）。
   */
  const triOnBoard = (state, cellsById) => {
    const pts = [];
    for (let i = 0; i < cellsById.length; i++) {
      const code = state[i];
      if (code === RESIDUE_BLANK) continue;
      const [r, c] = cellsById[i];
      pts.push({ y: r, x: 2 * c - r, color: colorOf(code), front: isFront(code) });
    }
    const near = (a, b) => {
      const dy = Math.abs(a.y - b.y);
      const dx = Math.abs(a.x - b.x);
      return (dy === 0 && dx === 2) || (dy === 1 && dx === 1);
    };
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++)
        for (let k = j + 1; k < pts.length; k++) {
          const t = [pts[i], pts[j], pts[k]];
          if (t[0].color !== t[1].color || t[1].color !== t[2].color) continue;
          if (!t.some((q) => q.front)) continue;
          if (near(t[0], t[1]) && near(t[1], t[2]) && near(t[0], t[2])) return true;
        }
    return false;
  };

  head('【11】小球的小三角：1×3 拼不出，形状此刻就在盘上');
  {
    /*
     * 三枚同色（一枚色块两枚星星）正好摆成那个小三角：(3,1) (4,1) (4,2)。
     *
     *   · 1×3 那条路走不通：空白不进线，这三枚所在的三条线去掉空白之后**都只剩两格**
     *     （A2、B1、R4），门槛 3 永远够不着。
     *   · 整线消除那条路也走不通：门槛 3，而每一族两端那几条线的活格都不到 3 枚，
     *     `outerEdges` 一条都不给——所以这一副**只剩形状这一条路**。
     */
    const live = [[3, 1, 1, false], [4, 1, 1, true], [4, 2, 1, true]];
    const { board, at } = residueBoard(live);
    const noSlot = edgeResidue(board, at, 3, 3);
    check('不给形状（只量 1×3）→ dead', noSlot === 'dead', noSlot);
    const withSlot = edgeResidue(board, at, 3, 3, false, { target: TRI, need: 3 });
    check('给了那个形状 → scores', withSlot === 'scores', withSlot);
    // 手写尺子也要说「在」——两条路对上了，才说明上面那个 scores 不是别的原因给的。
    const enc = encodeResidue(live, 3);
    check('（尺子）手写那把尺子也说这三枚就是那个小三角',
      triOnBoard(enc.start, cellsOf(enc)) === true);
    check('（尺子）这一副一条可削外边都没有（所以只剩形状那条路）', enc.bonus.length === 0,
      `${enc.bonus.length} 条`);
  }

  head('【11】老虎机随机对照：活局误判 0');
  {
    /*
     * 和【8】同一个套路，只是判「得不得分」换成了**形状**那一套：
     *
     *   对照 = 不设预算的闭包 ＋ 「手写的小三角尺子 或 整线消除」。
     *   整线消除那一半直接用 `scoresNow(state, lines, 0, bonus)`——`matchLen` 给 0，那条
     *   1×N 扫描整个不走（老虎机那一局它本来就不该走），剩下的正好是 (b)。
     *
     * 要紧的只有一个方向：**活局不许被判死**。反过来漏掉一些死局只是「兜底没兜住」，
     * 而判错一个活局是把人家还能打的棋 1.4 秒掐掉。
     */
    let seed = 20261003;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const CELLS = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c <= r; c++) CELLS.push([r, c]);

    const exactSlot = (enc) => {
      const cells = cellsOf(enc);
      const hit = (st) => triOnBoard(st, cells) || scoresNow(st, enc.lines, 0, enc.bonus);
      const moves = cyclicShuffles(enc.lines);
      if (hit(enc.start)) return 'scores';
      if (!moves.length) return 'dead';
      const keyOf = (st) => st.join(',');
      const seen = new Set([keyOf(enc.start)]);
      let frontier = [enc.start];
      while (frontier.length) {
        const next = [];
        for (const st of frontier) {
          for (const { cells, src: from } of moves) {
            const child = Uint16Array.from(st);
            for (let i = 0; i < cells.length; i++) child[cells[i]] = st[cells[from[i]]];
            const k = keyOf(child);
            if (seen.has(k)) continue;
            seen.add(k);
            if (hit(child)) return 'scores';
            next.push(child);
          }
        }
        frontier = next;
      }
      return 'dead';
    };

    let aliveWronglyDead = 0;
    let deadTotal = 0;
    let deadCaught = 0;
    let aliveTotal = 0;
    let unknowns = 0;
    const contradictions = [];
    const ROUNDS = 120;
    for (let i = 0; i < ROUNDS; i++) {
      const n = 3 + Math.floor(rnd() * 5);
      const pool = [...CELLS];
      const live = [];
      for (let k = 0; k < n; k++) {
        const pick = Math.floor(rnd() * pool.length);
        const [r, c] = pool.splice(pick, 1)[0];
        // 颜色**偏向一个**（七成）：两色等概率的话 120 副里活局不到十副，那条「这一批里
        // 真有活局」的尺子就骑在边界上——而骑在边界上的断言就是偶发红。
        live.push([r, c, rnd() < 0.7 ? 1 : 2, rnd() < 0.5]);
      }
      const { board, at } = residueBoard(live);
      const got = edgeResidue(board, at, 3, 3, false, { target: TRI, need: 3 });
      const want = exactSlot(encodeResidue(live, 3));
      if (got === 'unknown') unknowns++;
      if (want === 'scores') {
        aliveTotal++;
        if (got === 'dead') aliveWronglyDead++;
      } else {
        deadTotal++;
        if (got === 'dead') deadCaught++;
        // 对照说「怎么滑都拼不出」，被测却说 scores——那不是「偏安全」，那是两边对形状的
        // 认法真的不一样，必须查。第一版红在这儿，而红的是尺子（只认一种摆法）。
        if (got === 'scores') contradictions.push(JSON.stringify(live));
      }
    }
    check(`活局一个都没被判死（${ROUNDS} 副，老虎机那一档）`, aliveWronglyDead === 0,
      `误判 ${aliveWronglyDead} 副`);
    check('对照说死、被测说活：一副都没有（两边对形状的认法一致）', contradictions.length === 0,
      contradictions.slice(0, 2).join(' | '));
    check('（尺子）这一批里真有活局，也真有死局', aliveTotal >= 10 && deadTotal >= 10,
      `活 ${aliveTotal} 副 / 死 ${deadTotal} 副`);
    const rate = deadTotal ? deadCaught / deadTotal : 0;
    check('死局检出率 ≥ 80%', rate >= 0.8, `${deadCaught}/${deadTotal} = ${(rate * 100).toFixed(0)}%`);
    console.log(`      （顺带：${unknowns} 副答了 unknown，那是安全的一侧——当活）`);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 【10】外边那条路：**所有**可削外边都要看，不是只看最短那一条（E33 的 (b)）
// ══════════════════════════════════════════════════════════════════════════
//
// 计数那一层（stalemate.ts）问的是 `shortestEdge`——**此刻最短的那条可削外边**。那是对的：
// 它只数「某色星星够不够填满一条边」，取最短的那条等于取最宽松的门槛，而计数层只许偏松。
//
// 可穷举这一层不一样：它要的是「有没有**某一条**边填得满」。只看最短那条的话，
// 「只有较长那条边填得满」的残局会被判**死**——而盘上明明还摆着一条填得满的边，玩家一眼
// 就看得见。E33 明文「看**所有**外边」。
head('【10】只有较长那条外边填得满的残局 → 判活');
{
  /*
   * 同一族两条线（所以两条都是极值、两条都是可削外边），外加一条**只碰长边**的跨线：
   *
   *   R0（3 格，族 row，offset 0）：三枚**色块** 色2，而且**谁也碰不到它**（没有跨线经过）
   *   R1（5 格，族 row，offset 1）：星星色1 ×4 ＋ 一枚星星色2（插在 [1,2]）
   *   C （2 格，族 col）：把 R1 的 [1,2] 和一枚在边外的星星色1（[2,0]）接起来
   *
   * 滑 C 一格（两格的线，一步就是对换）→ [1,2] 换成星星色1 → 五枚同色星星填满 R1 → 整线
   * 消除 → 活。
   *
   * 而 R0 **永远**填不满：它和外界不通，三格里的东西只会在它自己身上转圈，而那三枚是色块。
   * ⚠️ 第一版把那条跨线接在 R0 上，于是 R0 里的色块能被换出去、星星能换进来——R0 也填得满
   * 了，下面那条尺子当场红。两格的跨线是**双向**的，接上哪条边，那条边就不再封闭。
   */
  const R0 = { fam: 'row', offset: 0, cells: [[0, 0], [0, 1], [0, 2]] };
  const R1 = { fam: 'row', offset: 1, cells: [[1, 0], [1, 1], [1, 2], [1, 3], [1, 4]] };
  const C = { fam: 'col', offset: 0, cells: [[1, 2], [2, 0]] };
  const board = { lines: [R0, R1, C], isLive: () => true };
  const cells = new Map([
    ['0,0', { color: 2, dot: false }], ['0,1', { color: 2, dot: false }], ['0,2', { color: 2, dot: false }],
    ['1,0', { color: 1, dot: true }], ['1,1', { color: 1, dot: true }], ['1,2', { color: 2, dot: true }],
    ['1,3', { color: 1, dot: true }], ['1,4', { color: 1, dot: true }],
    ['2,0', { color: 1, dot: true }],
  ]);
  const at = (r, c) => cells.get(r + ',' + c) ?? null;
  // 图案那条路关掉（最长的线才 5 格），只留整线消除——这一节量的就是它。
  const got = edgeResidue(board, at, 9, 3);
  check('滑一下让五枚同色星星填满较长那条边 → scores', got === 'scores', got);
  /*
   * 这一条才是上面那条的意义所在：**只把最短那条边交下去**，同一副盘就答 dead。
   * 也就是说这个 fixture 真的区分得开两种接法——不是随便一副盘都 scores。
   */
  const onlyShort = residueVerdict({
    lines: [R0.cells, R1.cells, C.cells], at, matchLen: 9,
    bonusLines: [{ cells: R0.cells, need: 3 }],
  });
  check('（尺子）只交最短那条边 → dead（所以这一副真的只靠长边活）', onlyShort === 'dead', onlyShort);
  const bothEdges = residueVerdict({
    lines: [R0.cells, R1.cells, C.cells], at, matchLen: 9,
    bonusLines: [{ cells: R0.cells, need: 3 }, { cells: R1.cells, need: 3 }],
  });
  check('（尺子）两条都交 → scores', bothEdges === 'scores', bothEdges);
}

head('【10】星星够数、可一条外边都滑不进去 → 判死');
{
  /*
   * 三枚同色星星（色1），门槛 3——**计数那一层一定说活**（它只数「某色星星 ≥ 门槛」）。
   * 可几何上永远凑不到一条边上：两条线不相交（没有跨线），而
   *
   *   R0（3 格）：星星 色1、星星 色1、色块 色2   → 转一圈还是两星一块，填不满
   *   R1（5 格）：星星 色1、色块 色2 ×4          → 一枚星星，填不满
   *
   * 图案那条路也走不通：门槛 5，而 R1 上最长的同色连续段是四枚色2。
   */
  const R0 = { fam: 'row', offset: 0, cells: [[0, 0], [0, 1], [0, 2]] };
  const R1 = { fam: 'row', offset: 1, cells: [[1, 0], [1, 1], [1, 2], [1, 3], [1, 4]] };
  const board = { lines: [R0, R1], isLive: () => true };
  const cells = new Map([
    ['0,0', { color: 1, dot: true }], ['0,1', { color: 1, dot: true }], ['0,2', { color: 2, dot: false }],
    ['1,0', { color: 1, dot: true }], ['1,1', { color: 2, dot: false }], ['1,2', { color: 2, dot: false }],
    ['1,3', { color: 2, dot: false }], ['1,4', { color: 2, dot: false }],
  ]);
  const at = (r, c) => cells.get(r + ',' + c) ?? null;
  const got = edgeResidue(board, at, 5, 3);
  check('星星够三枚、却一条边都填不满 → dead', got === 'dead', got);
  /*
   * 两条反面尺子，证明这个 dead 不是「这个函数在这副盘上恒 dead」：
   *   · 把 R0 那枚色块也换成色1星星 → R0 三枚同色星星，满了 → scores。
   *   · 门槛（图案那条路）降到 4 → R1 上四枚色2连着，成图案 → scores。
   */
  const cells2 = new Map(cells);
  cells2.set('0,2', { color: 1, dot: true });
  const at2 = (r, c) => cells2.get(r + ',' + c) ?? null;
  check('（尺子）R0 那枚色块换成同色星星 → scores', edgeResidue(board, at2, 5, 3) === 'scores');
  check('（尺子）图案门槛降到 4 → scores（R1 上四枚色块连着）',
    edgeResidue(board, at, 4, 3) === 'scores', edgeResidue(board, at, 4, 3));
}

// ══════════════════════════════════════════════════════════════════════════
// 【11】老虎机那一局：认的是**转出来那个形状**，不是 1×N（E33 的 (a)）
// ══════════════════════════════════════════════════════════════════════════
//
// 上一推（2026-10-02）这两副棋盘在有目标时直接 `return []`——穷举那时只会量同色 1×N，拿它
// 去量一局老虎机会把明明还拼得出形状的棋判死。代价是老虎机那一局**根本没有几何兜底**。
//
// 现在形状跟着传下去（`ResidueSlot`），由 `patternHitFor` 拿 `findTargetAt`（屏幕上真的给
// 不给分那把尺子）逐个盘面问一遍。这一节的每一条都是一**对**：同一副盘，不给形状答 dead、
// 给了形状答 scores。一对才说明「形状真的被认出来了」，而不是这副盘本来就 scores。
//
// 两个形状的字面值和 src/engine/targets.ts 那张表一字不差（下面【9】有一条源码断言盯着
// 它：表改了而这儿没跟着改，量的就是一个已经不存在的形状）。
const SQ_2x2 = { id: '37', family: 'square', cells: [[0, 0], [0, 1], [1, 0], [1, 1]] };
const CIRCLE_TRI = { id: '23', family: 'circle', cells: [[0, 1], [1, 0], [1, 2]] };

head('【11】方块 2×2：1×4 拼不出，形状拼得出');
{
  /*
   * 2×2 的小盘，四枚同色（三枚色块、一枚星星）：
   *
   *   · 线最长 2 格 → 同色 1×4 **永远**拼不出，所以不给形状就是 dead。
   *   · 整行整列那条路也不通：整线消除要**整条都是同色星星**，而每行每列都带着色块。
   *   · 可 2×2 那个形状此刻就摆在盘上（四枚同色、至少一枚色块）→ 给了形状就是 scores。
   */
  const b = boardFrom(['AA', 'Aa']);
  const noSlot = gridResidue(2, 2, b.at, 4);
  check('不给形状（只量 1×4）→ dead', noSlot === 'dead', noSlot);
  const withSlot = gridResidue(2, 2, b.at, 4, { target: SQ_2x2, need: 4 });
  check('给了 2×2 那个形状 → scores', withSlot === 'scores', withSlot);
  /*
   * 再一对：把四枚改成**两色各两枚**，2×2 就拼不成了（形状要四枚同色），而 1×4 本来也不
   * 成——所以给不给形状都该是 dead。这一条防的是「给了 slot 就恒 scores」。
   */
  const mixed = boardFrom(['AB', 'Ba']);
  check('两色各两枚：给了形状还是 dead（不是恒 scores）',
    gridResidue(2, 2, mixed.at, 4, { target: SQ_2x2, need: 4 }) === 'dead',
    gridResidue(2, 2, mixed.at, 4, { target: SQ_2x2, need: 4 }));
  /*
   * 第三对：**一盘全是空位**。它们一个也配不上颜色（`RESIDUE_BLANK`），所以不许被当成
   * 「四枚同色拼成了 2×2」——circle.ts 那处 targetView 旁边写着同一句话：空位要当「没有这
   * 一枚」，不是「一枚灰色的」，不然一排空球会被当成同色拼图。
   *
   * 这一条是**行为上**守着它的：形状判定里少写那一句 `if (code === RESIDUE_BLANK) return
   * null;`，四个空位就都成了「颜色 −1 的色块」，四枚同色、至少一枚色块，当场 scores。
   */
  const allBlank = boardFrom(['..', '..']);
  check('一盘全是空位：不许算成四枚同色拼成了 2×2',
    gridResidue(2, 2, allBlank.at, 4, { target: SQ_2x2, need: 4 }) === 'dead',
    gridResidue(2, 2, allBlank.at, 4, { target: SQ_2x2, need: 4 }));
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

  /*
   * 老虎机那两副（方块、小球）：形状要真的传下去。
   *
   * 这一节 2026-10-02 之前钉的是**反过来那件事**——`if (target) return [];`，「老虎机那一局
   * 不走穷举」。那是上一推的临时办法（穷举那时只会量 1×N），E33 把它换掉了。所以这儿有一条
   * 「那句话不许再回来」：它一回来，老虎机那一局的几何兜底就又没了，而屏幕上什么都不报。
   */
  head('【9】老虎机那一局：形状传下去了（方块、小球两处）');
  for (const f of ['circle.ts', 'square.ts']) {
    const src = strip(read(f));
    check(`${f}：**不许**再有「有目标就不穷举」那一句`, !/if \(target\) return \[\];/.test(src));
    check(`${f}：形状和枚数一起交给穷举层`, /target \? \{ target, need \} : undefined/.test(src),
      (src.match(/target \? \{[^}]*\} : undefined/) || ['(没找到)'])[0]);
    // 两层的门槛必须是同一个 `need`：计数那一层收它，穷举这一层的形状枚数也收它。
    check(`${f}：计数那一层收的也是同一个 need`,
      /findStuckColorGroups\(live, need,/.test(src),
      (src.match(/findStuckColorGroups\([^)]*\)/) || ['(没找到)'])[0]);
  }

  /*
   * 判「拼成了没有」用的必须是**屏幕上真的给不给分那把尺子**（`findTargetAt`）。
   *
   * 另写一份的后果是这个仓库最熟的那一种：两份一起活着，改一处漏一处，而漏了的那一份只在
   * 「穷举说死、玩家明明还拼得出」的时候才看得见——1.4 秒直接结算。
   */
  head('【9】形状判定没有第二份实现');
  {
    const src = readFileSync(new URL('../src/engine/residueBoard.ts', import.meta.url), 'utf8');
    const body = strip(src);
    check('residueBoard 用的是 targetMatch 的 findTargetAt', /findTargetAt\(view, variant, anchor\)/.test(body));
    check('形状表在**开搜前**摊平（搜索中不变）',
      /for \(const p of erodedShapes\(slot\.target, slot\.need\)\) variants\.push\(\.\.\.orientationsOf\(p\)\);/.test(body));
    // 起手格就是「此刻还在盘上的那些」，而且**真的被用来起手**——第一版这一条只钉了
    // `cells: () => built.cells` 那一行，可那一行当时没人读（循环里直接写的 built.cells），
    // 于是把它改成 `() => []` 门一声不响。钉的要是**用它的那一句**。
    check('起手格只用此刻还在盘上的那些', /const anchors = view\.cells\(\);/.test(body));
    check('而且起手就是从那一份里起', /for \(const anchor of anchors\)/.test(body));
    /*
     * 配不上颜色的那一格（活炸弹 / 方块的空位）当「没有这一枚」，不是「一枚灰色的」。
     *
     * ⚠️ 这儿**有两道闸**，`has` 和 `tileAt` 各一道，而且任意一道单独就挡得住——所以上面
     * 【11】那副「一盘全是空位」的盘只拆一道是量不出来的（拆 tileAt 那一道，has 照样回
     * false，照旧 dead）。行为上的那一条留着（它守的是「两道都在」这个结果），而两道各自
     * 还在不在，由这两条源码断言分别钉住。
     */
    check('RESIDUE_BLANK 那一格：tileAt 回「没有这一枚」',
      /if \(code === RESIDUE_BLANK\) return null;/.test(body));
    check('RESIDUE_BLANK 那一格：has 也说「不在盘上」',
      /return id !== undefined && cur\[id\] !== RESIDUE_BLANK;/.test(body));
  }

  /*
   * 上面【11】那两个形状的字面值，是从 `targets.ts` 那张表抄下来的。表改了而这儿没跟着改，
   * 量的就是一个**已经不存在的形状**——门还是绿的，可它什么都没验。
   */
  head('【9】【11】用的那两个形状还在表上');
  {
    const src = readFileSync(new URL('../src/engine/targets.ts', import.meta.url), 'utf8');
    check("targets.ts 里 '37' 还是方块 2×2",
      /T\('37', 'square', \[\[0, 0\], \[0, 1\], \[1, 0\], \[1, 1\]\]\)/.test(src));
    check("targets.ts 里 '23' 还是小球那个小三角",
      /T\('23', 'circle', \[\[0, 1\], \[1, 0\], \[1, 2\]\]\)/.test(src));
  }
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);

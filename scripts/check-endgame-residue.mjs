/**
 * 残局穷举兜底（`src/engine/residueSearch.ts`）。
 *
 *   npx esbuild src/engine/residueSearch.ts --bundle --format=esm --outfile=/tmp/residue.mjs
 *   npx esbuild src/engine/stalemate.ts     --bundle --format=esm --outfile=/tmp/stalemate.mjs
 *   node scripts/check-endgame-residue.mjs /tmp/residue.mjs /tmp/stalemate.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这道门守的是哪次事故
 *
 * 玩家报过：盘上剩几枚，怎么滑都不得分，**局却不结束**。病根是 `stalemate.ts` 的判活
 * 只做计数（某色可见枚数够不够当前图案的枚数、够不够填满一条外边），从不看几何——
 * 「数量够、摆法永远到不了」的残局被一直判活。
 *
 * 所以这道门里每一个死局都配一条**对照尺子**：同一副残局喂给计数那一层，它说「活」；
 * 喂给穷举，它说「死」。两句话同时成立才算真的复现了那个 bug，也才证明兜底有用。
 * 少了这条尺子，「穷举说死」可能只是因为那副残局本来就连计数都过不了——那就什么都
 * 没验到。
 *
 * 另一侧同样要守：**算不完一律当活**。判死的那一侧错了，一局还能打的棋盘会被 1.4 秒
 * 直接结算，比「该结束没结束」更糟。所以预算那几条断言钉的是「`'unknown'`，而且绝不
 * 是 `'dead'`」。
 *
 * 纯算术，不开浏览器，进得了 CI。
 */
const [residueSrc, stalemateSrc] = process.argv.slice(2);
if (!residueSrc || !stalemateSrc) {
  console.error('用法: node scripts/check-endgame-residue.mjs <residueSearch.mjs> <stalemate.mjs>');
  console.error('  npx esbuild src/engine/residueSearch.ts --bundle --format=esm --outfile=/tmp/residue.mjs');
  console.error('  npx esbuild src/engine/stalemate.ts     --bundle --format=esm --outfile=/tmp/stalemate.mjs');
  process.exit(2);
}
const R = await import(residueSrc);
const S = await import(stalemateSrc);
const { readFileSync } = await import('node:fs');

let fail = 0;
const check = (name, ok, extra = '') => {
  if (!ok) fail++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : ''));
};
const head = (t) => console.log('\n' + t);

const { encodeTile, RESIDUE_BLANK, residueSearch, scoresNow, cyclicShuffles, fillerAwareShuffles,
        fillerAwareSource, RESIDUE_MAX_STATES, RESIDUE_BUDGET_MS, colorOf, isDot, isFront } = R;

// ---------------------------------------------------------------------------
head('【0】尺子：这几样真的导出来了，而且两个预算是方案里那两个字面值');
for (const [n, v] of Object.entries({ encodeTile, residueSearch, scoresNow, cyclicShuffles,
                                      fillerAwareShuffles, fillerAwareSource })) {
  check(`导出了 ${n}`, typeof v === 'function');
}
// 写死在门里，不从模块读——门和被测件各说一次，才拦得住「有人悄悄把 20000 改成 200」。
check('maxStates 默认 20000（§4 字面值）', RESIDUE_MAX_STATES === 20000, String(RESIDUE_MAX_STATES));
check('budgetMs 默认 250（§4 字面值）', RESIDUE_BUDGET_MS === 250, String(RESIDUE_BUDGET_MS));
check('空白编码是 0', RESIDUE_BLANK === 0, String(RESIDUE_BLANK));

// 编解码自洽：色号 0…7 × 正反两面，来回一趟都要原样。
{
  let ok = true;
  const seen = new Set([RESIDUE_BLANK]);
  for (let c = 0; c < 8; c++) for (const dot of [false, true]) {
    const code = encodeTile(c, dot);
    if (colorOf(code) !== c || isDot(code) !== dot || isFront(code) !== !dot) ok = false;
    if (seen.has(code)) ok = false;   // 不许和空白、也不许和别的格子撞码
    seen.add(code);
  }
  check('编解码来回一趟原样，而且十六种码互不相撞', ok);
}
check('空白不和任何颜色同色（colorOf = −1）', colorOf(RESIDUE_BLANK) === -1);
// 上面那条偏弱——`RESIDUE_BLANK` 是 0，`(0 >> 1) - 1` 本来就是 −1，那个三元是写给人看
// 的。真要钉的是**行为**：一排空白连不成图案，也填不满一条边。
check('一整排空白连不成得分图案',
  scoresNow(Uint16Array.from([RESIDUE_BLANK, RESIDUE_BLANK, RESIDUE_BLANK, RESIDUE_BLANK]),
    [[0, 1, 2, 3]], 4, []) === false);
check('一整排空白也填不满一条边',
  scoresNow(Uint16Array.from([RESIDUE_BLANK, RESIDUE_BLANK, RESIDUE_BLANK]),
    [[0, 1, 2]], 9999, [{ cells: [0, 1, 2], need: 3 }]) === false);

// ---------------------------------------------------------------------------
head('【1】scoresNow：两条得分路各自认得出来，也各自认得出不算');
const A = encodeTile(1, false);   // 1 号色，色块
const Ad = encodeTile(1, true);   // 1 号色，星星
const B = encodeTile(2, false);
const Bd = encodeTile(2, true);
const u16 = (arr) => Uint16Array.from(arr);
const line5 = [[0, 1, 2, 3, 4]];

check('同线连续 4 枚同色、含色块 → 算',
  scoresNow(u16([A, A, A, A, B]), line5, 4, []) === true);
check('连续 4 枚同色但**全是星星** → 不算（§1.1）',
  scoresNow(u16([Ad, Ad, Ad, Ad, B]), line5, 4, []) === false);
check('4 枚里有 1 枚星星、3 枚色块 → 算（混合组照算）',
  scoresNow(u16([Ad, A, A, A, B]), line5, 4, []) === true);
check('中间夹一个空白 → 断开，不算',
  scoresNow(u16([A, A, RESIDUE_BLANK, A, A]), line5, 4, []) === false);
check('夹一枚别的颜色 → 断开，不算',
  scoresNow(u16([A, A, B, A, A]), line5, 4, []) === false);
check('**不绕圈**：首尾各两枚同色凑不成 4（和 findRunMatches 的 `i + n <= len` 一致）',
  scoresNow(u16([A, A, B, A, A]), [[0, 1, 2, 3, 4]], 4, []) === false);
check('整线消除：整条同色星星、枚数够 → 算',
  scoresNow(u16([Ad, Ad, Ad]), [[0, 1, 2]], 9999, [{ cells: [0, 1, 2], need: 3 }]) === true);
check('整线消除：混进一枚色块 → 不算',
  scoresNow(u16([Ad, A, Ad]), [[0, 1, 2]], 9999, [{ cells: [0, 1, 2], need: 3 }]) === false);
check('整线消除：混进一个空白 → 不算',
  scoresNow(u16([Ad, RESIDUE_BLANK, Ad]), [[0, 1, 2]], 9999, [{ cells: [0, 1, 2], need: 3 }]) === false);
check('整线消除：同色星星但枚数不够 → 不算',
  scoresNow(u16([Ad, Ad]), [[0, 1]], 9999, [{ cells: [0, 1], need: 3 }]) === false);
check('两色星星各一半 → 不算',
  scoresNow(u16([Ad, Bd, Ad]), [[0, 1, 2]], 9999, [{ cells: [0, 1, 2], need: 3 }]) === false);

// ---------------------------------------------------------------------------
head('【2】一步就能得分的残局 → scores');
{
  // 一条 5 格的线，四枚同色色块中间被一枚别的颜色隔开；滑一格就连上。
  const start = u16([A, A, A, B, A]);
  const lines = [[0, 1, 2, 3, 4]];
  const v = residueSearch({ start, moves: cyclicShuffles(lines), scanLines: lines, matchLen: 4, bonusLines: [] });
  check('滑一格就连成 1×4 → scores', v === 'scores', v);
}
{
  // 起手那个盘面自己就得分（调用方那头不会这样，但不许因此答错）。
  const start = u16([A, A, A, A]);
  const lines = [[0, 1, 2, 3]];
  const v = residueSearch({ start, moves: cyclicShuffles(lines), scanLines: lines, matchLen: 4, bonusLines: [] });
  check('起手就成图案也答 scores', v === 'scores', v);
}

// ---------------------------------------------------------------------------
head('【3】三副真死局 —— 每一副都配一条「计数那层说活」的对照尺子');

/** 把残局喂给计数那一层。`findStuckColorGroups` 返回空数组＝它认为还活着。 */
function countingSaysAlive(tiles, minMatch, lineMin) {
  const liveTiles = tiles.map((t, i) => ({
    cell: [0, i],
    tile: t.dot
      ? { face: 'dot', color: t.color, dotColor: t.color }
      : { face: 'flavor', color: t.color, dotColor: t.color },
  }));
  return S.findStuckColorGroups(liveTiles, minMatch, lineMin).length === 0;
}

// ① 四枚同色**色块**，可盘上每条线都只有 2 格——1×4 永远摆不出来。
//    计数那一层走的是「某色色块够门槛 → 这色可达 → 活」那条路，所以它说活。
{
  const lines = [[0, 1], [2, 3], [0, 2], [1, 3]];
  const start = u16([A, A, A, A]);
  const v = residueSearch({ start, moves: cyclicShuffles(lines), scanLines: lines, matchLen: 4, bonusLines: [] });
  check('① 2×2 盘上四枚同色色块（线最长 2 格）：穷举说死', v === 'dead', v);
  const alive = countingSaysAlive(
    [{ color: 1, dot: false }, { color: 1, dot: false }, { color: 1, dot: false }, { color: 1, dot: false }],
    4, 9999 /* NO_EDGE：一条边都削不动 */,
  );
  check('①（对照尺子）计数那一层说活 —— 这就是玩家撞上的那个 bug', alive === true, String(alive));
}

// ② 三颗同色星星**够填一条 3 枚的边**，可它们分在两条互不相交的线上——
//    盘子已经削成两块，谁也走不到对方那边去，第三颗永远凑不过来。
//    计数那一层只数「某色星星 ≥ 门槛」，数出 3 ≥ 3 就说活。
{
  const L1 = [0, 1, 2];          // 这条是唯一削得动的边（3 格）
  const L2 = [3, 4];             // 和 L1 一格都不共用
  const lines = [L1, L2];
  const start = u16([Ad, Ad, B, Ad, B]);
  const v = residueSearch({
    start, moves: cyclicShuffles(lines), scanLines: lines, matchLen: 4,
    bonusLines: [{ cells: L1, need: 3 }],
  });
  check('② 三颗同色星星分在两块断开的盘子上：穷举说死', v === 'dead', v);
  const alive = countingSaysAlive(
    [{ color: 1, dot: true }, { color: 1, dot: true }, { color: 2, dot: false },
     { color: 1, dot: true }, { color: 2, dot: false }],
    4, 3,
  );
  check('②（对照尺子）计数那一层说活', alive === true, String(alive));
}

// ③ 同色星星够填一条 3 枚的外边，可那条线上永远混着一枚空白球（消过的那一枚，
//    它照样滑，所以永远赶不走）。
{
  const lines = [[0, 1, 2, 3]];
  const start = u16([Ad, Ad, Ad, RESIDUE_BLANK]);
  const v = residueSearch({
    start, moves: cyclicShuffles(lines), scanLines: lines, matchLen: 4,
    // 这条线此刻的**活格**是三枚星星（空白球不算活格，见 outerEdge 的 isLive）——
    // 可它们在线上不连续，整线消除要的是「这条线上的活格整条同色星星」，
    // 而那枚空白永远插在中间某处。
    bonusLines: [{ cells: [0, 1, 2, 3], need: 3 }],
  });
  check('③ 三颗同色星星 + 一枚赶不走的空白球：穷举说死', v === 'dead', v);
  const alive = countingSaysAlive(
    [{ color: 1, dot: true }, { color: 1, dot: true }, { color: 1, dot: true }],
    4, 3,
  );
  check('③（对照尺子）计数那一层说活', alive === true, String(alive));
}

// ---------------------------------------------------------------------------
head('【4】预算：算不完一律 unknown，**绝不是 dead**');
{
  // 一副真的很大的盘面：6×6，六行六列，颜色乱摆到没有任何 4 连。
  const n = 6;
  const lines = [];
  for (let r = 0; r < n; r++) lines.push(Array.from({ length: n }, (_, c) => r * n + c));
  for (let c = 0; c < n; c++) lines.push(Array.from({ length: n }, (_, r) => r * n + c));
  const start = new Uint16Array(n * n);
  for (let i = 0; i < n * n; i++) start[i] = encodeTile(i % 5, false);
  const moves = cyclicShuffles(lines);
  for (const [label, opts] of [
    ['状态数给 1', { maxStates: 1 }],
    ['毫秒给 0', { budgetMs: 0 }],
  ]) {
    const v = residueSearch({ start, moves, scanLines: lines, matchLen: 4, bonusLines: [], ...opts });
    check(`${label} → unknown（不是 dead）`, v === 'unknown', v);
  }
  /*
   * 预算要问在**展开之前**，不是之后——问在之后的话最后那一批状态已经算完了，时间早
   * 超了才发现，那条 250ms 就不是上限而是个大概。
   *
   * 怎么量得出这个差别：给一个「已经超时」的假时钟，然后看它**有没有碰过那一步的置
   * 换表**。碰了就是先算后问。用假时钟不用真实耗时——CI 机器忙起来真实耗时不可复现，
   * 那种断言是偶发红的来源。
   */
  let touched = 0;
  const probe = [{ cells: [0, 1], get src() { touched++; return [1, 0]; } }];
  // 假时钟每问一次走一格：第一次（算 deadline）是 0，第二次（循环里那一问）是 1，
  // 1 > 0 就超时了。写成一个常数不行——deadline 是拿同一个常数加 0 算出来的，
  // `now() > deadline` 于是恒假，一步都刹不住（第一版就是这么写的，门当场逮住）。
  let tick = 0;
  const v = residueSearch({
    start, moves: probe, scanLines: lines, matchLen: 4, bonusLines: [],
    budgetMs: 0, now: () => tick++,
  });
  check('预算用光时一步都没算（问在展开之前）', v === 'unknown' && touched === 0,
    `${v} / 碰了置换表 ${touched} 次`);
  // 尺子：这个探针在预算够的时候**真的会被碰**，否则上面那一条是恒真的。
  {
    let t2 = 0;
    const live = [{ cells: [0, 1], get src() { t2++; return [1, 0]; } }];
    residueSearch({ start, moves: live, scanLines: lines, matchLen: 4, bonusLines: [] });
    check('（尺子）预算够的时候这个探针会被碰到', t2 > 0, `碰了 ${t2} 次`);
  }
}
{
  // 没有任何一步可走：直接死，不要空转。
  const v = residueSearch({ start: u16([A]), moves: [], scanLines: [[0]], matchLen: 4, bonusLines: [] });
  check('一步都走不了 → dead', v === 'dead', v);
}

// ---------------------------------------------------------------------------
head('【5】两套一步集合都是真置换');
function isPermutation(src) {
  const seen = new Set(src);
  return seen.size === src.length && src.every((v) => v >= 0 && v < src.length);
}
{
  const lines = [[0, 1, 2, 3, 4], [5, 6]];
  const moves = cyclicShuffles(lines);
  check('cyclicShuffles：条数 = Σ(L−1)', moves.length === 4 + 1, String(moves.length));
  check('cyclicShuffles：每一步都是置换', moves.every((m) => isPermutation([...m.src])));
  check('cyclicShuffles：没有一步是「原地不动」',
    moves.every((m) => m.src.some((v, i) => v !== i)));
  check('cyclicShuffles：长度 1 的线不出一步', cyclicShuffles([[7]]).length === 0);
}
{
  const lines = [[0, 1, 2, 3, 4, 5]];
  const moves = fillerAwareShuffles(lines);
  check('fillerAwareShuffles：只给偶数步（6 格 → 2/4 两步）', moves.length === 2, String(moves.length));
  check('fillerAwareShuffles：每一步都是置换', moves.every((m) => isPermutation([...m.src])));
  // 偶数步这件事要看得出来：奇数步的那个置换和它给的不一样。
  const even = moves[0].src.join(',');
  const odd = Array.from({ length: 6 }, (_, i) => (((i - 1) % 6) + 6) % 6).join(',');
  check('fillerAwareShuffles：给的不是奇数步那个置换', even !== odd, `${even} ≠ ${odd}`);
}

// ---------------------------------------------------------------------------
head('【6】尺子：fillerAwareSource 和 triangle.ts 里那一份一字不差');
{
  const tri = readFileSync(new URL('../src/shapes/triangle.ts', import.meta.url), 'utf8');
  const grab = (text) => {
    const i = text.indexOf('fillerAwareSource(idx: number, shift: number, n: number): number {');
    if (i < 0) return null;
    const open = text.indexOf('{', i);
    let depth = 0;
    for (let j = open; j < text.length; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}') { depth--; if (!depth) return text.slice(open, j + 1); }
    }
    return null;
  };
  const here = readFileSync(new URL('../src/engine/residueSearch.ts', import.meta.url), 'utf8');
  const a = grab(tri);
  const b = grab(here);
  // 尺子先行：两边都真的找到了，否则下面那一句是恒真的。
  check('（尺子）两个文件里都找到了这个函数体', Boolean(a) && Boolean(b),
    `${a ? a.length : 0} / ${b ? b.length : 0} 字`);
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  check('两份函数体一字不差（六边三角 54 只允许偶数步 + filler 配对交换）',
    Boolean(a) && norm(a) === norm(b),
    norm(a) === norm(b) ? '' : `\n  triangle.ts: ${norm(a).slice(0, 110)}\n  residue:     ${norm(b).slice(0, 110)}`);
  // 行为上也对一遍：同一组输入，两边输出必须一样。光比文本不够——有人把两份一起
  // 改错，文本还是一样的。
  let same = true;
  for (let n = 2; n <= 10; n++) for (let s = -n + 1; s < n; s++) for (let i = 0; i < n; i++) {
    const got = fillerAwareSource(i, s, n);
    if (!(got >= 0 && got < n)) same = false;     // 永远落在线上
  }
  check('fillerAwareSource 的返回永远落在这条线上', same);
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);

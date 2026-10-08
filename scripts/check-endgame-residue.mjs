/**
 * 残局穷举兜底（`src/engine/residueSearch.ts`）。
 *
 *   npx esbuild src/engine/residueSearch.ts --bundle --format=esm --outfile=/tmp/residue.mjs
 *   npx esbuild src/engine/stalemate.ts     --bundle --format=esm --outfile=/tmp/stalemate.mjs
 *   npx esbuild src/engine/slideLine.ts     --bundle --format=esm --outfile=/tmp/slideline.mjs
 *   npx esbuild src/engine/residueBoard.ts  --bundle --format=esm --outfile=/tmp/residueboard.mjs
 *   node scripts/check-endgame-residue.mjs /tmp/residue.mjs /tmp/stalemate.mjs /tmp/slideline.mjs /tmp/residueboard.mjs
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
const [residueSrc, stalemateSrc, slideSrc, boardSrc] = process.argv.slice(2);
if (!residueSrc || !stalemateSrc || !slideSrc || !boardSrc) {
  console.error('用法: node scripts/check-endgame-residue.mjs <residueSearch.mjs> <stalemate.mjs> <slideLine.mjs> <residueBoard.mjs>');
  console.error('  npx esbuild src/engine/residueSearch.ts --bundle --format=esm --outfile=/tmp/residue.mjs');
  console.error('  npx esbuild src/engine/stalemate.ts     --bundle --format=esm --outfile=/tmp/stalemate.mjs');
  console.error('  npx esbuild src/engine/slideLine.ts     --bundle --format=esm --outfile=/tmp/slideline.mjs');
  console.error('  npx esbuild src/engine/residueBoard.ts  --bundle --format=esm --outfile=/tmp/residueboard.mjs');
  process.exit(2);
}
const R = await import(residueSrc);
const S = await import(stalemateSrc);
const L = await import(slideSrc);
const RB = await import(boardSrc);
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

// ③ 同色星星够填一条 3 枚的外边，可那条线上永远混着一枚 RESIDUE_BLANK——现实里那是一枚
//    **活炸弹**（它占着一格、跟着线滑，可配不上任何颜色，所以永远赶不走）。
//    ⚠️ 这儿从前写的是「一枚消过的空白球」。2026-10-02 起外边族的空白**压根不进线**（见
//    residueSearch.ts 顶上 RESIDUE_BLANK 那段），所以这副盘面现实里的来处换成了活炸弹。
//    被测的东西一个字没动：线上插着一枚配不上色的格子时，整线消除走不通。
{
  const lines = [[0, 1, 2, 3]];
  const start = u16([Ad, Ad, Ad, RESIDUE_BLANK]);
  const v = residueSearch({
    start, moves: cyclicShuffles(lines), scanLines: lines, matchLen: 4,
    // 这条线此刻的**活格**是三枚星星（配不上色的那一格不算活格，见 outerEdge 的 isLive）——
    // 可它们在线上不连续，整线消除要的是「这条线上的活格整条同色星星」，
    // 而那一枚永远插在中间某处。
    bonusLines: [{ cells: [0, 1, 2, 3], need: 3 }],
  });
  check('③ 三颗同色星星 + 一枚赶不走的活炸弹：穷举说死', v === 'dead', v);
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
head('【6】fillerAwareSource 只剩一份：engine/slideLine.ts（棋盘和穷举用的是同一个）');
{
  // 从前这儿钉的是「triangle.ts 闭包里那一份和 residueSearch.ts 抄的那一份一字不差」——原件
  // 在闭包里拿不到，只能抄。第 14 推原件搬进了 engine/slideLine.ts（大三角的 applyDrag 要把
  // 它交给 slideLine），两边都改成 import。所以现在钉的是：只有一份函数体，两边都从它来。
  const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
  const tri = read('../src/shapes/triangle.ts');
  const here = read('../src/engine/residueSearch.ts');
  const lib = read('../src/engine/slideLine.ts');
  const BODY = 'fillerAwareSource(idx: number, shift: number, n: number): number {';
  check('（尺子）engine/slideLine.ts 里有这个函数体', lib.includes(BODY));
  check('triangle.ts、residueSearch.ts 自己都不再留一份', !tri.includes(BODY) && !here.includes(BODY));
  check('两边都从 engine/slideLine 拿',
    /import \{[^}]*\bfillerAwareSource\b[^}]*\} from '\.\.\/engine\/slideLine'/.test(tri) &&
    /import \{[^}]*\bfillerAwareSource\b[^}]*\} from '\.\/slideLine'/.test(here));
  // 行为上也对一遍：穷举那一头转出去的，和 slideLine 那一个是同一个函数。
  let same = true;
  let onLine = true;
  for (let n = 2; n <= 11; n++) for (let s = -n + 1; s < n; s++) for (let i = 0; i < n; i++) {
    const got = fillerAwareSource(i, s, n);
    if (got !== L.fillerAwareSource(i, s, n)) same = false;
    if (!(got >= 0 && got < n)) onLine = false;     // 永远落在线上
  }
  check('穷举转出去的那一个，和 slideLine 的输出一模一样', same);
  check('fillerAwareSource 的返回永远落在这条线上', onLine);
}

// ---------------------------------------------------------------------------
head('【7】大三角长滑不复制、不丢棋子（第 14 推）：n = 1…11、步数 −40…40，每一下都是排列');
{
  // 照 triangle.ts 的 applyDrag 原样走一遍：拖出来的步数先取偶数，再夹在 ±(n − 1) 以内，
  // 然后按 fillerAwareSource 换。直接问来源函数，**不经过** slideLine 的排列校验——夹紧
  // 这一步本身就得够；排列校验是第二层，不能拿它来盖住第一层的错。
  const perm = (n, shift) => L.isPermutation(Array.from({ length: n }, (_, i) => L.fillerAwareSource(i, shift, n)), n);
  const raw = [];
  const bad = [];
  let moved = 0;
  let total = 0;
  for (let n = 1; n <= 11; n++) {
    for (let steps = -40; steps <= 40; steps++) {
      total++;
      const even = 2 * Math.round(steps / 2);
      if (!perm(n, even)) raw.push(`n=${n} 步数 ${even}`);
      const shift = L.clampOddShift(even, n);
      if (!perm(n, shift)) bad.push(`n=${n} 拖 ${steps} → ${shift}`);
      if (L.slideSources(n, shift, L.fillerAwareSource)) moved++;
    }
  }
  check('（尺子）不夹紧的话，同一批输入里真有复制 / 丢棋子的', raw.length > 0, `${raw.length} 处，例：${raw[0] ?? '（无）'}`);
  check('夹紧之后每一下都是排列', bad.length === 0, bad.slice(0, 3).join(' · '));
  check('（尺子）大多数真的滑动了（不是全被当成「不算一步」拦掉）', moved > total / 2, `${moved} / ${total}`);
  // 拿真的东西滑一遍：十一枚滑满 40 步，出来的还是那十一枚，一枚不多一枚不少。
  const line = 'ABCDEFGHIJK'.split('');
  const out = L.slideLine(line, L.clampOddShift(40, line.length), L.fillerAwareSource);
  check('十一枚拖出 40 步：出来的还是那十一枚', Boolean(out) && [...out].sort().join('') === line.join(''), out ? out.join('') : 'null');
}

// ---------------------------------------------------------------------------
head('【8】六边圆球的中心洞：扫描时把两边断开，滑动时不动（2026-10-08 方案 2-4）');
{
  // 真棋盘对那个永久空位的两种待遇不一样：滑的时候它不在那一串里（球隔着它首尾相接），扫
  // 「同线连续 N 枚」的时候它在（findRunMatches 按整条几何线扫，洞两边的两枚不算相邻）。从前
  // 适配层把它当「不在盘上」，两头一起压实——洞左右两枚同色球在穷举里成了连着的。
  //
  // 线照 src/shapes/circleHex.ts 的 allLines() 摆（半径 3 的六边形、37 格、立方坐标三族），
  // 洞在 [3, 3]。这儿量的是 engine/residueBoard.ts 那层转换（build），不是搜索件本身。
  const N = 3;
  const ROW_LENS = [4, 5, 6, 7, 6, 5, 4];
  const lower = (z) => Math.max(-N, -z - N);
  const toLocal = (x, z) => {
    const y = -x - z;
    if (Math.abs(x) > N || Math.abs(y) > N || Math.abs(z) > N) return null;
    const r = z + N;
    const c = x - lower(z);
    return c >= 0 && c < ROW_LENS[r] ? [r, c] : null;
  };
  const lines = [];
  for (let r = 0; r < ROW_LENS.length; r++) lines.push(Array.from({ length: ROW_LENS[r] }, (_, c) => [r, c]));
  for (let x = -N; x <= N; x++) {
    const cells = [];
    for (let z = -N; z <= N; z++) { const cell = toLocal(x, z); if (cell) cells.push(cell); }
    lines.push(cells);
  }
  for (let y = -N; y <= N; y++) {
    const cells = [];
    for (let z = -N; z <= N; z++) { const cell = toLocal(-y - z, z); if (cell) cells.push(cell); }
    lines.push(cells);
  }
  const cellCount = new Set(lines.flat().map(([r, c]) => r + ',' + c)).size;
  check('（尺子）摆出来的是 37 格、21 条线的六边形', cellCount === 37 && lines.length === 21, `${cellCount} 格 ${lines.length} 条`);
  const throughHole = lines.filter((l) => l.some(([r, c]) => r === 3 && c === 3));
  check('（尺子）穿过中心的正好三条线（每族一条），洞都在线的中间',
    throughHole.length === 3 && throughHole.every((l) => {
      const i = l.findIndex(([r, c]) => r === 3 && c === 3);
      return i > 0 && i < l.length - 1;
    }), throughHole.map((l) => l.length).join('/'));

  const A1 = { color: 1, dot: false };
  const B1 = { color: 2, dot: false };
  const C1 = { color: 3, dot: false };
  /** 这一格此刻是什么：给定的那几格是球，[3,3] 按 `hole` 回，其余全都削掉了（null）。 */
  const atOf = (live, hole) => (r, c) => {
    if (r === 3 && c === 3) return hole;
    return live[r + ',' + c] ?? null;
  };
  const verdict = (live, hole, matchLen) =>
    RB.residueVerdict({ lines, at: atOf(live, hole), matchLen, bonusLines: [] });

  // ① 残局：只剩中间那一行洞左右的两枚同色球，图案是 1×2。实盘上那一行能滑（两枚换个位置），
  //    可换完还是「A 洞 A」，两枚永远隔着洞；穿过它们的另两族线上都只剩它自己，滑不动。真死局。
  const twoAcross = { '3,2': A1, '3,4': A1 };
  const v1 = verdict(twoAcross, 'hole', 2);
  check('① 洞左右两枚同色、别处都削光了：穷举说死', v1 === 'dead', v1);
  const vOld = verdict(twoAcross, null, 2);
  check('①（对照尺子）洞照从前那样当「不在盘上」：穷举说还能得分——这就是那个 bug', vOld === 'scores', vOld);
  const alive = countingSaysAlive([{ color: 1, dot: false }, { color: 1, dot: false }], 2, 9999 /* NO_EDGE */);
  check('①（对照尺子）计数那一层也说活——两层一起说活，局就永远不结束', alive === true, String(alive));
  // 洞要是跟着线滑（编成活炸弹那样的 'blank'），「A 洞 A」滑一格就成了「A A 洞」——那是一副
  // 实盘到不了的盘面。所以洞不能编成 blank。
  const vBlank = verdict(twoAcross, 'blank', 2);
  check('①（对照尺子）洞要是编成跟着线滑的 blank：又说能得分（实盘到不了）', vBlank === 'scores', vBlank);

  // ② 反面：洞不许把真的得分路也挡死。同一行「A B C 洞 A」，滑一格，洞右边那枚 A 隔着洞绕到
  //    最左边，和原来那枚 A 挨上——实盘上就是这么走的（liveOnLine 压实了滑）。
  const jump = { '3,0': A1, '3,1': B1, '3,2': C1, '3,4': A1 };
  const v2 = verdict(jump, 'hole', 2);
  check('② 隔着洞绕过来就能连上：穷举说能得分（滑动那头照旧压实）', v2 === 'scores', v2);
  const v2still = verdict({ '3,0': A1, '3,1': B1, '3,4': C1 }, 'hole', 2);
  check('②（尺子）三枚各不同色：说死（不然 ② 在「什么时候都说能」时也绿）', v2still === 'dead', v2still);

  // ③ 洞不算「可用」的那几枚（§4 是「可用 ≤16 枚才穷举」）。摆 16 枚、起手就有一对挨着的同色
  //    （1×2 当场成立）：洞要是被数进去就是 17 枚，一上来就答 unknown；没数进去就答 scores。
  const firstCells = lines.slice(0, 4).flat().filter(([r, c]) => !(r === 3 && c === 3));
  const deal = (n) => {
    const live = {};
    firstCells.slice(0, n).forEach(([r, c], i) => { live[r + ',' + c] = { color: i % 6, dot: false }; });
    live['0,1'] = { color: 0, dot: false }; // 和 [0,0] 同色、同一行挨着
    return live;
  };
  const v3 = verdict(deal(16), 'hole', 2);
  check('③ 16 枚可用 + 洞：洞不算进「可用」，照样开搜（起手就成，答 scores）',
    RB.RESIDUE_MAX_TILES === 16 && v3 === 'scores', v3);
  const v3over = verdict(deal(17), 'hole', 2);
  check('③（尺子）17 枚可用：一上来就答 unknown（门槛真的是按可用枚数卡的）', v3over === 'unknown', v3over);
}
{
  // ④ 只有六边圆球交得出 'hole'：别的五副没有永久空位，一个字不动（方案原话「其余五副不动」）。
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const bodyOf = (src) => {
    const from = src.indexOf('const residueAt = ');
    return from < 0 ? '' : src.slice(from, src.indexOf('\n      };', from));
  };
  const hex = bodyOf(strip(readFileSync(new URL('../src/shapes/circleHex.ts', import.meta.url), 'utf8')));
  check('④ 六边圆球的 residueAt 对中心那一格回 hole',
    /CENTER_CELL\[0\][\s\S]{0,40}CENTER_CELL\[1\][\s\S]{0,30}'hole'/.test(hex), hex.slice(0, 120).replace(/\s+/g, ' '));
  for (const f of ['circle', 'circleSeven', 'squareDiamond', 'square', 'triangle']) {
    const body = bodyOf(strip(readFileSync(new URL(`../src/shapes/${f}.ts`, import.meta.url), 'utf8')));
    check(`④ ${f}.ts 的 residueAt 不回 hole（尺子：切出了那一段）`, body.length > 40 && !/'hole'/.test(body),
      `${body.length} 字`);
  }
}

// ── 「卡住」那几格的键集合（stalemate.ts 的 stuckKeysOf，10-08 方案第五批第 3 条从六副棋盘里抽出来）──
{
  const keys = S.stuckKeysOf([[0, 1], [2, 3], [0, 1]]);
  check('stuckKeysOf：给几格就是那几格的键（同一格只算一次）', keys instanceof Set && [...keys].sort().join(' ') === '0,1 2,3',
    keys ? [...keys].join(' ') : String(keys));
  check('stuckKeysOf：没有卡住的（null）就是 null——棋盘照这个把灰全撤掉', S.stuckKeysOf(null) === null);
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);

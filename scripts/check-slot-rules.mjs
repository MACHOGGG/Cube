/**
 * 老虎机那一局的四件事：完成奖励、侵蚀去除的顺序、报的枚数、卡死门槛。
 *
 *   npx esbuild src/engine/scoring.ts    --bundle --format=esm --outfile=/tmp/scoring.mjs
 *   npx esbuild src/engine/targets.ts    --bundle --format=esm --outfile=/tmp/targets.mjs
 *   npx esbuild src/engine/targetMatch.ts --bundle --format=esm --outfile=/tmp/match.mjs
 *   node scripts/check-slot-rules.mjs /tmp/scoring.mjs /tmp/targets.mjs /tmp/match.mjs
 *
 * 四件都不崩、不报错，错了只是分不对、图不对、话不对：
 *
 *   ① 完成奖励 `⌈枚数²/2⌉` 从前**一分都没生效过**——各组算好的 `points` 被计分那条
 *      路原样丢掉了，而规则书和结算页都在讲它。
 *   ② 侵蚀先拆哪一枚，从前取决于 `TARGETS` 里这个图案**按什么次序写下来**，和它长什
 *      么样无关。玩家定的是「先右先上」（E32）。
 *   ③ 降级时那句「得分图案变成 N 枚」报的是**侵蚀级数**，而图标和判定走的是
 *      `sizeAtLevel` 给的真实枚数——二十个目标里十个对不上。
 *   ④ 方块那一副把卡死门槛写死成 4（传 `undefined` 落到默认值），八副里只有它这样。
 */
const S = await import(process.argv[2]);
const T = await import(process.argv[3]);
const M = await import(process.argv[4]);
const { readFileSync } = await import('node:fs');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// ---- ① 完成奖励真的加上去了（行为，不是看源码）-------------------------
{
  const key = (r, c) => `${r},${c}`;
  const board = (faces) => {
    const tiles = new Map();
    for (const k of faces) tiles.set(k, { face: 'flavor', dotColor: 1 });
    return {
      tileAt: (r, c) => {
        const k = key(r, c);
        if (!tiles.has(k)) tiles.set(k, { face: 'dot', dotColor: 1 });
        return tiles.get(k);
      },
    };
  };
  // 四枚拼成一次：翻面 4 枚 ×2 = 8；完成奖励 ⌈4²/2⌉ = 8。
  const four = [[0, 0], [0, 1], [0, 2], [0, 3]];
  const mk = (bonusOnMatch) => {
    const b = board(four.map(([r, c]) => key(r, c)));
    return S.createCascadeStepper(
      {
        tileAt: b.tileAt,
        findLineBonuses: () => [],
        onLineBonus: () => {},
        resetMaskOnLineBonus: false,
        findMatches: () => [{ cells: four, points: T.scoreForSize(4), label: '目标' }],
        bonusOnMatch,
      },
      null,
      { pattern: '图案', line: '整线' },
    ).next();
  };
  check('（尺子）scoreForSize(4) = 8', T.scoreForSize(4) === 8, String(T.scoreForSize(4)));
  const off = mk(false);
  const on = mk(true);
  check('不开完成奖励：只有翻面那 8 分', off.points === 8, `${off.points} 分`);
  check('开了完成奖励：8 + 8 = 16 分', on.points === 16, `${on.points} 分`);
  // 反面尺子：基础玩法那条路（不开这个开关）**不许**跟着涨——它的 Match.points 是
  // groupPoints 算的，一直加会双算。
  check('开关关着时一分都不多（防双算）', off.points === 8 && on.points - off.points === 8,
    `${off.points} → ${on.points}`);
}

// ---- ② 侵蚀先拆哪一枚：先右先上 ----------------------------------------
{
  // 方块族，照未旋转的展示图：列降序、行升序。拆掉的那一枚应当是**当前最右那一列
  // 里最上面的那一枚**（拆了会断开的让给下一枚）。
  /**
   * 这道门**自己写一份**连通判定，不借 targetMatch 里那个。
   *
   * 两个理由：一是那两个辅助（`lattice` / `connected`）根本没导出——第一版就是这么写
   * 的，结果是「要查的那一支永远走不到」，一个反面对照才把它掀出来（TypeError 在绿
   * 的那一趟里碰不到，因为循环体根本没进去）。二是门本来就该有自己的尺子：拿被测模
   * 块的函数去验被测模块，验的是「它和自己一致」。
   *
   * 方块族是八邻（含斜角），和 targetMatch 里那一份同一条规矩（见那儿的注释：目标 31
   * 一对边邻都没有，只认四邻的话它永远拼不出来）。
   */
  const 连通 = (cells) => {
    if (cells.length <= 1) return true;
    const key = (c) => c.join(',');
    const 全 = new Set(cells.map(key));
    const 见过 = new Set([key(cells[0])]);
    const 待 = [cells[0]];
    while (待.length) {
      const [r, c] = 待.pop();
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const k = `${r + dr},${c + dc}`;
          if (全.has(k) && !见过.has(k)) { 见过.add(k); 待.push([r + dr, c + dc]); }
        }
    }
    return 见过.size === cells.length;
  };
  // 尺子：这份连通判定自己得是对的。一条连起来的要说连通，断开的要说不连通。
  check('（尺子）门自己那份连通判定靠谱',
    连通([[0, 0], [0, 1], [0, 2]]) && !连通([[0, 0], [0, 5]]));

  const bad = [];
  let 查过 = 0;
  for (const t of T.TARGETS) {
    if (t.family !== 'square' || t.cells.length < 3) continue;
    查过++;
    const 全 = M.erodedFace(t, t.cells.length).cells.map((c) => c.join(','));
    const 少一枚 = M.erodedFace(t, t.cells.length - 1).cells.map((c) => c.join(','));
    const 拆掉的 = 全.find((c) => !少一枚.includes(c));
    if (!拆掉的) { bad.push(`${t.id}：没拆掉任何一枚`); continue; }
    const [r, c] = 拆掉的.split(',').map(Number);
    // 比它更靠右、或同列更靠上，而且拆了之后仍然连通的，一枚都不该有
    const 更该先拆 = t.cells.filter(([rr, cc]) => (cc > c || (cc === c && rr < r)));
    for (const [rr, cc] of 更该先拆) {
      const rest = t.cells.filter(([a, b2]) => !(a === rr && b2 === cc));
      if (连通(rest)) {
        bad.push(`${t.id}：拆了 (${r},${c})，可 (${rr},${cc}) 更靠右上而且拆得动`);
        break;
      }
    }
  }
  check('（尺子）真的查了几个方块族目标', 查过 >= 5, `${查过} 个`);
  check('侵蚀先拆最右那一列里最上面那一枚（先右先上）', bad.length === 0, bad.slice(0, 3).join(' · '));
}

// ---- ③ 报的是真实枚数，不是侵蚀级数 ------------------------------------
{
  // 先把「这两个数真的会不一样」钉出来，不然下面那条是恒真的。
  const 六枚 = T.TARGETS.find((t) => t.cells.length === 6);
  check('（尺子）六枚的目标在第 3 级画的是 5 枚，不是 3 枚',
    Boolean(六枚) && T.sizeAtLevel(六枚, 3) === 5, 六枚 ? String(T.sizeAtLevel(六枚, 3)) : '（没有六枚的）');
  const src = read('src/ui/patternBlock.ts');
  check('patternBlock 里有 shownCount（尺子）', /const shownCount = \(level: number\)/.test(src));
  check('shownCount 走的是 faceFor，不是直接用级数',
    /shownCount[\s\S]{0,180}faceFor \? faceFor\(level\)\.cells\.length/.test(src));
  check('flash / aria-label / toast 报的都是 shownCount',
    /const n = shownCount\(level\);[\s\S]{0,200}toast\(n\)/.test(src) &&
    /patternNowLabel\.replace\('\{n\}', String\(shownCount\(view\.level\)\)\)/.test(src));
  check('再没有谁拿级数去填那句话',
    !/patternNowLabel\.replace\('\{n\}', String\(level\)\)/.test(src) &&
    !/patternNowLabel\.replace\('\{n\}', String\(view\.level\)\)/.test(src));
}

// ---- ④ 八副棋盘的卡死门槛，没有哪一副写死 --------------------------------
{
  const 写死的 = [];
  let 查过 = 0;
  for (const f of ['square', 'circle', 'circleHex', 'circleSeven', 'squareDiamond', 'triangle']) {
    const src = read(`src/shapes/${f}.ts`);
    const m = src.match(/findStuckColorGroups\([\s\S]{0,220}?\);/);
    if (!m) continue;
    查过++;
    // 门槛那一位必须问得出「这一级要几枚」：要么 controller.matchLen()，要么
    // targetNeed()（老虎机那一局）。传 undefined 会落到 stalemate 的默认值 4。
    if (/undefined/.test(m[0]) || !/matchLen\(\)|\bneed\b|targetNeed\(\)/.test(m[0])) 写死的.push(f);
  }
  check('（尺子）六副棋盘的卡死判定都读到了', 查过 === 6, `${查过} 副`);
  check('没有哪一副把门槛写死（传 undefined 会落到默认的 4 枚）', 写死的.length === 0, 写死的.join(' '));
}

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 条没过`);
process.exit(fail ? 1 : 0);

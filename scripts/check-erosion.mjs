/**
 * 侵蚀阶梯：段数、结转、基准。10-31 方案推14 Z-B02 起是 F5（站长 10-22 晚：4 → 3 → 2，到 2 为止）。
 *
 *   npx esbuild src/engine/erosion.ts --bundle --format=esm --outfile=/tmp/erosion.mjs
 *   npx esbuild src/engine/scoring.ts --bundle --format=esm --outfile=/tmp/scoring.mjs
 *   node scripts/check-erosion.mjs /tmp/erosion.mjs /tmp/scoring.mjs
 *
 * 量这几件，每一件都是「写错了不报错、只是这一局的手感全变了」那一类：
 *
 *   ① **表和方案原文一字不差**：基础局两段（4→3、3→2），**两级合计 ≤ 全盘 − 2**（满盘之前图案就停在 2 枚，盘上至少还
 *     留两枚给 2 枚的图案凑）；par = ceil(ceil(枚数 ÷ 4 × 颜色数) × 1.2)。ero1 那张三段表、「解锁 1×1 那一下场上剩下的
 *     色块全部翻掉」（10-09 补充方案 6-3）在基础局作废，**只留给老虎机**（SLOT_TABLE，照搬 ero1 那两行，floor 1）。
 *   ② **验收数**：一枚一枚翻，第几枚那一下降到 1×3 / 1×2，和方案那张表的「第几枚」逐个对上；差一枚的时候还在上一级
 *     （尺子）；**再翻到满盘仍是 2 枚、unlocked() 仍是 false**（基础局永远到不了 1 枚）。
 *   ③ **结转**：一步翻了好几枚、超出这一级剩下的段数时，多的扣到下一级去；到了最低级（基础局 2 枚）余数丢掉。
 *   ④ **拆除也算一枚**：控制器把「图案翻的 + 拆掉的炸弹」一起交给 spend，这儿只量 spend 对总数的反应。
 *   ⑤ **通式只给表外的棋盘兜底**：两段通式在 20–120 枚的盘上每一级至少 1 段、合计 ≤ N − 2；36、28 枚上恰好等于方块、小球
 *     那两行。老虎机的三段通式（ladder3For）另量。
 *   ⑥ **大时刻**（读 gameController 源码）：整线消除那一拍、老虎机降到底那一下走同一个 bigMoment——两下震动、重震、
 *     粒子撒在 refs.boardWrap 上；整线那一支响 cuelume 0.2.8 的 ready（playLineClear，推14 Z-B26），老虎机那一支照旧
 *     滴落声（playClear）。
 *   ⑦ **降级那一下重不重找**：拿真的连锁步进器（scoring.ts）和真的侵蚀（erosion.ts）在一副 6×6 的合成盘面上走一遍控制器
 *     那一圈（每一拍 commit → spend → 降级了就看要不要 rescanAll）。**基础局不重找**（Z-B02，站长 F5）：从 1×4 剩 1 段滑
 *     一步降到 1×3，盘上那组现成的 1×3 **还摆着没翻**；从 1×3 剩 1 段滑一步降到 2 枚，场上其余色块原样剩着。**老虎机照旧
 *     重找**（10-09 补充方案 6-3）：走 SLOT_TABLE、floor 1，从「再翻两枚就到 1 枚」滑一步，解锁 1×1 之后场上色块数 = 0。
 *     控制器真的这么接（rescanAll 只在 if (hooks.slot) 里、全文只这一处），读源码钉住。真棋盘上的端到端在
 *     check-erosion-live（dev 服务器，手跑）。
 */
import { readFileSync } from 'node:fs';
const src = process.argv[2];
const scoringSrc = process.argv[3];
if (!src || !scoringSrc) {
  console.error('用法: node scripts/check-erosion.mjs <打包好的 erosion.mjs> <打包好的 scoring.mjs>');
  process.exit(2);
}
const { EROSION_TABLE, SLOT_TABLE, ladderFor, ladder3For, parFor, tableFor, slotTableFor, createErosion } = await import(src);
const { createCascadeStepper, POINTS_PER_FLIP } = await import(scoringSrc);

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/**
 * 方案那张表（10-31 方案推14 Z-B02），照原文抄一遍（棋盘 → [枚数, 颜色数, 4→3, 3→2, par]），后面跟着验收数：降到 1×3 /
 * 1×2 各在第几枚。
 */
const SPEC = {
  square:        { n: [36, 6, 22, 12, 65], at: [22, 34] },
  circle:        { n: [28, 4, 17, 9, 34],  at: [17, 26] },
  squareDiamond: { n: [36, 6, 22, 12, 65], at: [22, 34] },
  triangleBig:   { n: [54, 6, 30, 20, 98], at: [30, 50] },   // 六边三角 54，代码在 shapes/triangle.ts，认 id 不认文件名
  circleHex:     { n: [36, 6, 22, 12, 65], at: [22, 34] },
  circleSeven:   { n: [49, 7, 27, 17, 104], at: [27, 44] },
};

check('六副棋盘都在表里', Object.keys(EROSION_TABLE).length === 6, Object.keys(EROSION_TABLE).join(' '));

// ---- ① 表、合计 ------------------------------------------------------------
for (const [id, { n: [tiles, colors, a, b, par] }] of Object.entries(SPEC)) {
  const t = EROSION_TABLE[id];
  if (!t) { check(`[${id}] 表里有这一副`, false); continue; }
  check(`[${id}] 段数和方案原文一致：两段 [${a}, ${b}]`, t.seg.length === 2 && t.seg[0] === a && t.seg[1] === b, JSON.stringify(t.seg));
  const sum = t.seg[0] + t.seg[1];
  check(`[${id}] 两级合计 ≤ 全盘 ${tiles} 枚 − 2（满盘之前就停在 2 枚）`, sum <= tiles - 2, `合计 ${sum}`);
  check(`[${id}] 基准 par = ceil(ceil(枚数 ÷ 4 × 颜色数) × 1.2) = ${par}`, t.par === par && parFor(tiles, colors) === par, String(t.par));
}

// ---- ② 验收数：第几枚那一下降级；满盘仍是 2 枚 --------------------------------
for (const [id, { n: [tiles], at }] of Object.entries(SPEC)) {
  const e = createErosion(EROSION_TABLE[id]);
  const reached = {};
  for (let k = 1; k <= tiles; k++) {
    e.spend(1);
    if (!(e.level() in reached)) reached[e.level()] = k;
  }
  check(`[${id}] 第 ${at[0]} / ${at[1]} 枚那一下依次到 1×3 / 1×2`, reached[3] === at[0] && reached[2] === at[1], `实际 ${reached[3]} / ${reached[2]}`);
  // 尺子：差一枚的时候还在上一级。
  const before = [4, 3].map((lvl, i) => {
    const e2 = createErosion(EROSION_TABLE[id]);
    e2.spend(at[i] - 1);
    return e2.level() === lvl;
  });
  check(`[${id}]（尺子）差一枚的时候都还在上一级`, before.every(Boolean), before.join(','));
  check(`[${id}] 翻到满盘 ${tiles} 枚：仍是 2 枚、unlocked() 仍是 false、刻度环整圈熄掉`,
    e.level() === 2 && !e.unlocked() && reached[1] === undefined && e.segTotal() === 0, `级 ${e.level()} / unlocked ${e.unlocked()}`);
}

// ---- 老虎机：SLOT_TABLE、floor 1，照旧一级一级降到 1 枚 ------------------------------
{
  const SLOT_SPEC = { square: { seg: [15, 11, 6], par: 54, at: [15, 26, 32], tiles: 36 }, circle: { seg: [12, 8, 5], par: 28, at: [12, 20, 25], tiles: 28 } };
  check('老虎机的表正好两副（方块、小球），照搬 ero1 那两行', Object.keys(SLOT_TABLE).sort().join() === 'circle,square', Object.keys(SLOT_TABLE).join(' '));
  for (const [id, sp] of Object.entries(SLOT_SPEC)) {
    const t = SLOT_TABLE[id];
    check(`[老虎机 ${id}] 三段 [${sp.seg.join(', ')}]、par ${sp.par}`, JSON.stringify(t?.seg) === JSON.stringify(sp.seg) && t?.par === sp.par, JSON.stringify(t));
    const e = createErosion(t, false, 1);
    const reached = {};
    for (let k = 1; k <= sp.tiles; k++) {
      e.spend(1);
      if (!(e.level() in reached)) reached[e.level()] = k;
    }
    check(`[老虎机 ${id}] 第 ${sp.at.join(' / ')} 枚那一下依次到 1×3 / 1×2 / 1×1，到了记「降到底」`,
      reached[3] === sp.at[0] && reached[2] === sp.at[1] && reached[1] === sp.at[2] && e.unlocked(), `实际 ${reached[3]} / ${reached[2]} / ${reached[1]}`);
  }
  check('老虎机表外的棋盘按三段通式兜底', JSON.stringify(slotTableFor('someNewBoard', 40, 5).seg) === JSON.stringify(ladder3For(40)), JSON.stringify(slotTableFor('someNewBoard', 40, 5)));
  check('三段表缺省 floor 就是 1（从表长推）', (() => { const e = createErosion(SLOT_TABLE.square); e.spend(99); return e.level() === 1; })());
  check('两段表缺省 floor 就是 2（从表长推）', (() => { const e = createErosion(EROSION_TABLE.square); e.spend(99); return e.level() === 2; })());
}

// ---- ③④ 扣段、降级、结转 ---------------------------------------------------
{
  const e = createErosion(EROSION_TABLE.circle);   // [17, 9]
  check('开局是 1×4，剩 17 段', e.level() === 4 && e.segLeft() === 17 && e.segTotal() === 17);
  e.spend(16);
  check('翻 16 枚之后还在 4 枚、剩 1 段', e.level() === 4 && e.segLeft() === 1, `${e.level()} / ${e.segLeft()}`);
  const s1 = e.spend(1);
  check('再翻一枚：降到 3 枚，新一级 9 段', s1.level === 3 && s1.dropped === 1 && e.segLeft() === 9 && e.segTotal() === 9, JSON.stringify(s1));
  // 结转：这一级剩 9 段，一步翻了 12 枚（含拆掉的炸弹，spend 只认总数）→ 扣完 9 段降到 2 枚，余数丢掉（基础局到 2 为止）。
  const s2 = e.spend(12);
  check('一步多翻：扣完这一级降到 2 枚，余数丢掉', s2.level === 2 && s2.dropped === 1, JSON.stringify(s2));
  check('到 2 枚之后刻度环整圈熄掉（segTotal 0、segLeft 0），不记「降到底」', e.segTotal() === 0 && e.segLeft() === 0 && !e.unlocked() && !s2.unlocked);
  const s3 = e.spend(9);
  check('到了 2 枚之后再翻也不会更小', s3.level === 2 && s3.dropped === 0, JSON.stringify(s3));
  const e2 = createErosion(EROSION_TABLE.circle);
  const s4 = e2.spend(30);
  check('从 4 枚一步翻 30 枚：连降两级（dropped 2）、停在 2', s4.level === 2 && s4.dropped === 2, JSON.stringify(s4));
  e.reset();
  check('新的一局：回到 4 枚、第一级满格', e.level() === 4 && e.segLeft() === 17 && !e.unlocked());
}

// ---- 无限反转：段照扣，图案不降级 ---------------------------------------
{
  const e = createErosion(EROSION_TABLE.circle, true);
  e.spend(999);
  check('无限反转不吃侵蚀：图案永远停在开局那一级', e.level() === 4 && !e.unlocked(), `级 ${e.level()}`);
}

// ---- ⑤ 表外的棋盘：通式兜底 ------------------------------------------------
{
  const t = tableFor('someNewBoard', 40, 5);
  check('表里没有的棋盘按通式兜底', t.seg.join(',') === ladderFor(40).join(',') && t.par === parFor(40, 5), JSON.stringify(t));
  const bad = [];
  for (let n = 20; n <= 120; n++) {
    const seg = ladderFor(n);
    if (seg.length !== 2 || !seg.every((x) => x >= 1) || seg[0] + seg[1] > n - 2) bad.push(`${n}: [${seg.join(',')}]`);
  }
  check('两段通式在 20–120 枚的盘上：每一级至少 1 段、合计 ≤ 全盘 − 2', bad.length === 0, bad.slice(0, 4).join(' · '));
  // 通式是新表的近似比例：方块、小球两行恰好算得一样（尺子：通式不是随手写的一个数）。
  check('（尺子）两段通式在 36 枚、28 枚上恰好等于方块、小球那两行',
    ladderFor(36).join(',') === '22,12' && ladderFor(28).join(',') === '17,9',
    `${ladderFor(36).join(',')} / ${ladderFor(28).join(',')}`);
  // 老虎机的三段通式照旧（原 ladderFor 改名 ladder3For）：36、28 枚恰好等于老虎机那两行。
  check('（尺子）三段通式（老虎机）在 36 枚、28 枚上恰好等于 SLOT_TABLE 那两行',
    ladder3For(36).join(',') === '15,11,6' && ladder3For(28).join(',') === '12,8,5', `${ladder3For(36).join(',')} / ${ladder3For(28).join(',')}`);
}

// ---- ⑥ 大时刻：整线消除、老虎机降到底走同一个 bigMoment（读 gameController 源码）-------------
{
  const gc = readFileSync(new URL('../src/engine/gameController.ts', import.meta.url), 'utf8');
  const at = gc.indexOf('function bigMoment(');
  const body = at < 0 ? '' : gc.slice(at, gc.indexOf('\n  }\n', at));
  check('（尺子）切得出 bigMoment', body.length > 0);
  // 粒子撒在 refs.boardWrap 上（推14 Z-B11：原先撒在别的层上、放大那一下被盖住），落点用 cellCenterIn 换算到这一层。
  check('bigMoment：两下震动、重震、二号强调色那一大把粒子撒在 refs.boardWrap 上',
    /vibrate\(\[25, 40, 25\]\)/.test(body) && /screenShake\(refs\.boardWrap, 'heavy'\)/.test(body)
      && /spawnParticles\(refs\.boardWrap, pos\[0\], pos\[1\], \{ color: accent2Color\(\), count: 16, spread: 64 \}\)/.test(body)
      && /cellCenterIn\(refs\.boardWrap, originCell\)/.test(body));
  // 声音分两支（推14 Z-B26）：整线那一支响 0.2.8 的 ready、老虎机那一支照旧滴落声。
  check("bigMoment：playLineClear() 只在 'line' 那一支、playClear() 只在 'celebrate' 那一支",
    /if \(kind === 'line'\) playLineClear\(\);\s*else playClear\(\);/.test(body));
  check('整线消除那一拍走 bigMoment（line）', /if \(isBonus\) bigMoment\([^;]*, 'line'\);/.test(gc));
  // 闸是 celebrate（engine/targets.ts 的 celebrationGate，10-11 方案 B-6）：老虎机局图案第一次变成 1 枚，一局只响一次
  // ——它在哪一级响、只响一次，check-slot-rules ⑤ 拿每一个目标量。基础局到不了 1 枚，这一支只在老虎机走得到。
  check('老虎机降到底（celebrate）走 bigMoment（celebrate）', /if \(celebrate\(step\.level\)\) bigMoment\([^;]*, 'celebrate'\);/.test(gc));
  check('没有第三处另起一套：playClear() 1 处、playLineClear() 1 处、bigMoment( 3 处（含定义）',
    (gc.match(/playClear\(\)/g) || []).length === 1 && (gc.match(/playLineClear\(\)/g) || []).length === 1 && (gc.match(/bigMoment\(/g) || []).length === 3,
    `playClear ${(gc.match(/playClear\(\)/g) || []).length} 处，playLineClear ${(gc.match(/playLineClear\(\)/g) || []).length} 处，bigMoment ${(gc.match(/bigMoment\(/g) || []).length} 处`);
}

// ---- ⑦ 降级那一下重不重找：基础局不重找、老虎机照旧重找 ---------------------------
//
// 一副 6×6 的合成盘面：颜色按 (2r + c) mod 6 排，横着挨的差 1、竖着挨的差 2，哪儿都没有两枚同色挨着。认组那一把是方块那一条
// 规矩：同一行或同一列里连着 ≥ N 枚同色（星星看露出来的颜色）、至少一枚色块、碰到遮罩（遮罩是 null 就是全盘）。星星翻出来
// 的颜色一律给盘外的号（10 起），所以翻过的那几枚和谁都连不上——这一节量的是重找，不让翻出来的星星掺和。
{
  const N = 6;
  const base = () => {
    const g = [];
    let id = 1;
    for (let r = 0; r < N; r++) {
      g.push([]);
      for (let c = 0; c < N; c++) g[r].push({ id: id++, color: (2 * r + c) % 6, face: 'flavor', dotColor: 10 + r * N + c });
    }
    return g;
  };
  const eff = (t) => (t.face === 'dot' ? t.dotColor : t.color);
  const LINES = [];
  for (let r = 0; r < N; r++) LINES.push(Array.from({ length: N }, (_, c) => [r, c]));
  for (let c = 0; c < N; c++) LINES.push(Array.from({ length: N }, (_, r) => [r, c]));
  const cfgFor = (g, len) => ({
    tileAt: (r, c) => g[r][c],
    findLineBonuses: () => [],
    onLineBonus() {},
    resetMaskOnLineBonus: true,
    findMatches(mask) {
      const n = len();
      const out = [];
      for (const line of LINES) {
        let i = 0;
        while (i < line.length) {
          let j = i + 1;
          while (j < line.length && eff(g[line[j][0]][line[j][1]]) === eff(g[line[i][0]][line[i][1]])) j++;
          const run = line.slice(i, j);
          i = j;
          if (run.length < n) continue;
          if (mask && !run.some(([r, c]) => mask.has(r + ',' + c))) continue;
          if (!run.some(([r, c]) => g[r][c].face === 'flavor')) continue;
          out.push({ cells: run, points: 0 });
        }
      }
      return out;
    },
  });
  /** 控制器那一圈（gameController 的 proceed）：每一拍 commit → spend → 降级了，`rescan` 为真（老虎机）才 rescanAll。 */
  const play = (g, erosion, mask, rescan) => {
    const stepper = createCascadeStepper(cfgFor(g, () => erosion.level()), mask, { pattern: 'p', line: 'l' });
    let points = 0;
    let beats = 0;
    for (let st = stepper.next(); st; st = stepper.next()) {
      beats++;
      points += st.points;
      const committed = st.commit();
      if (committed > 0 && erosion.spend(committed).dropped > 0 && rescan) stepper.rescanAll();
    }
    return { points, beats };
  };
  const fronts = (g) => g.flat().filter((t) => t.face === 'flavor').length;
  const row = (r) => new Set(Array.from({ length: N }, (_, c) => r + ',' + c));

  // 基础局甲：再翻一枚就到 1×3（方块 [22, 12]，先扣 21：在 1×4、剩 1 段）。滑过来的那一步在第 5 行凑出一组 1×4（颜色一律换成
  // 6 号——盘上没有的那一色），第 2 行左边早就摆着一组现成的 1×3（换成 7 号）。
  const setupA = () => {
    const g = base();
    for (let c = 0; c < 4; c++) g[5][c].color = 6;
    for (let c = 0; c < 3; c++) g[2][c].color = 7;
    const e = createErosion(EROSION_TABLE.square, false, 2);
    e.spend(21);
    return { g, e };
  };
  {
    const { g, e } = setupA();
    check('⑦（尺子）基础局甲：开始时在 1×4、剩 1 段', e.level() === 4 && e.segLeft() === 1, `${e.level()} / ${e.segLeft()}`);
    const r = play(g, e, row(5), false);
    const untouched = [0, 1, 2].every((c) => g[2][c].face === 'flavor');
    check('⑦ 基础局甲：1×4 一翻降到 1×3，盘上那组现成的 1×3 **还摆着没翻**（不重找）', e.level() === 3 && untouched,
      `第 2 行：${[0, 1, 2].map((c) => g[2][c].face).join(' ')}`);
    check(`⑦ 基础局甲：一拍，4 枚，${4 * POINTS_PER_FLIP} 分`, r.beats === 1 && r.points === 4 * POINTS_PER_FLIP, `${r.beats} 拍 / ${r.points} 分`);
  }
  {
    const { g, e } = setupA();
    play(g, e, row(5), true);
    check('⑦（反面尺子）基础局甲：要是重找，那组 1×3 会当场翻掉', [0, 1, 2].every((c) => g[2][c].face === 'dot'));
  }

  // 基础局乙：从 1×3 剩 1 段（先扣 22 + 11 = 33）滑一步凑出一组 1×3（第 0 行左边三枚换成 8 号）→ 降到 2 枚，场上其余色块原样
  // 剩着（不重找）；第 4 行早就摆着一组现成的 1×2（换成 9 号），也不翻。
  {
    const g = base();
    for (let c = 0; c < 3; c++) g[0][c].color = 8;
    g[4][0].color = 9;
    g[4][1].color = 9;
    const e = createErosion(EROSION_TABLE.square, false, 2);
    e.spend(33);
    check('⑦（尺子）基础局乙：开始时在 1×3、剩 1 段，盘上 36 枚全是色块', e.level() === 3 && e.segLeft() === 1 && fronts(g) === 36, `${e.level()} / ${e.segLeft()}`);
    play(g, e, row(0), false);
    check('⑦ 基础局乙：1×3 一翻降到 2 枚，场上其余 33 枚色块原样剩着（那组现成的 1×2 也没翻）',
      e.level() === 2 && fronts(g) === 33 && g[4][0].face === 'flavor' && g[4][1].face === 'flavor', `剩 ${fronts(g)} 枚色块`);
  }

  // 老虎机：再翻两枚就到 1 枚（SLOT_TABLE 方块 15 + 11 + 6 = 32，先扣 31：在 1×2、剩 1 段）。滑过来的那一步在第 0 行凑出一组 1×2
  // ——(0,1) 换成和 (0,0) 一样的颜色。降到 1×1 那一下全盘重找：场上剩下的色块当场全部翻掉（10-09 补充方案 6-3）。
  const setupS = () => {
    const g = base();
    g[0][1].color = g[0][0].color;
    const e = createErosion(SLOT_TABLE.square, false, 1);
    e.spend(31);
    return { g, e };
  };
  {
    const { g, e } = setupS();
    check('⑦（尺子）老虎机：开始时在 1×2、剩 1 段，盘上 36 枚全是色块', e.level() === 2 && e.segLeft() === 1 && fronts(g) === 36, `${e.level()} / ${e.segLeft()}`);
    const r = play(g, e, row(0), true);
    check('⑦ 老虎机：那一组 1×2 一翻就到 1 枚——场上剩下的色块当场全部翻掉，色块数 = 0', e.level() === 1 && fronts(g) === 0, `剩 ${fronts(g)} 枚色块`);
    check(`⑦ 老虎机：每一枚 +${POINTS_PER_FLIP}，一共 ${36 * POINTS_PER_FLIP} 分；两拍（那一组一拍、剩下的一拍）`, r.points === 36 * POINTS_PER_FLIP && r.beats === 2, `${r.points} 分 / ${r.beats} 拍`);
  }
  {
    const { g, e } = setupS();
    play(g, e, row(0), false);
    check('⑦（反面尺子）老虎机：不重找，那 34 枚色块照旧剩着', fronts(g) === 34, `剩 ${fronts(g)} 枚`);
  }

  // 控制器真的这么接：降级那一下（step.dropped > 0）只在老虎机局喊 rescanAll，喊在 onErosion 之前；全文只这一处。
  const gc = readFileSync(new URL('../src/engine/gameController.ts', import.meta.url), 'utf8');
  check('⑦ 控制器：降级那一下只在老虎机局喊 stepper.rescanAll()（if (hooks.slot)）',
    /if \(step\.dropped > 0\) \{[\s\S]{0,1600}?if \(hooks\.slot\) stepper\.rescanAll\(\);\s*hooks\.onErosion\?\.\(step\.level\);/.test(gc));
  check('⑦ 控制器：全文只喊这一处（别处不许顺手把遮罩清掉）', (gc.match(/rescanAll\(\)/g) || []).length === 1, `${(gc.match(/rescanAll\(\)/g) || []).length} 处`);
  check('⑦ 控制器：老虎机走 SLOT_TABLE、floor 1；基础局走 tableFor、EROSION_FLOOR（2）',
    /createErosion\(slotTableFor\(hooks\.shapeId, hooks\.boardTiles, hooks\.boardColors\), !!hooks\.flip, 1\)/.test(gc) &&
      /createErosion\(tableFor\(hooks\.shapeId, hooks\.boardTiles, hooks\.boardColors\), !!hooks\.flip, EROSION_FLOOR\)/.test(gc) &&
      /const EROSION_FLOOR = 2;/.test(gc));
}

console.log(fail ? `\n${fail} 条没过` : '\n全过');
process.exit(fail ? 1 : 0);

/**
 * 侵蚀阶梯：段数、结转、基准。2026-10 二版（10-08 方案 3-A，玩家拍板方案 B）。
 *
 *   npx esbuild src/engine/erosion.ts --bundle --format=esm --outfile=/tmp/erosion.mjs
 *   node scripts/check-erosion.mjs /tmp/erosion.mjs
 *
 * 量这几件，每一件都是「写错了不报错、只是这一局的手感全变了」那一类：
 *
 *   ① **表和方案原文一字不差**，而且**三级合计小于全盘枚数、1×1 那一段至少 3 枚**。
 *     一版这儿量的是「合计 = 全盘枚数」——擦完最后一段和全部翻成星星是同一件事，1×1 只是
 *     终点上的一枚徽章。二版把 1×1 做成真打的一段，那条不变量作废；新的这一条守的是「1×1
 *     那一段真的有东西可翻」：合计一旦又凑回 N（有人照一版的习惯把差额补回第一级），1×1
 *     就又塌回徽章，而屏幕上什么都不报。
 *   ② **验收数**：一枚一枚翻，第几枚那一下降到 1×3 / 1×2 / 1×1，和方案那张表的「解锁在第
 *     几枚」逐个对上；差一枚的时候还在上一级（尺子，不然「到了」等于没量）。
 *   ③ **结转**：一步翻了好几枚、超出这一级剩下的段数时，多的要扣到下一级去，一步之内可以
 *     连降两级；到了 1 枚之后再翻也不会更小。
 *   ④ **拆除也算一枚**：控制器把「图案翻的 + 拆掉的炸弹」一起交给 spend，所以这儿只量
 *     spend 对总数的反应（拆除那一枚从哪来由 check-flip-score 守着）。
 *   ⑤ **通式只给表外的棋盘兜底**：一版那条「通式复算 = 字面表」二版里不成立（六边三角、七色
 *     圆球两行是照手感单独定的），改成量兜底本身站得住——几十枚到上百枚的盘，三级都至少 1
 *     段、1×1 那一段至少 3 枚。
 *   ⑥ **1×1 解锁那一下有一声**（读 gameController 源码）：二版里到 1×1 不再意味着盘已翻完，
 *     那一下要主动说出来，而且走的是整线消除那一套（bigMoment），不另起一套动画——方案原话
 *     「复用现有星星结算庆祝通道，不新开动画所有权」。在控制器的闭包里，单独叫不出来，所以
 *     读源码钉接线；真的响不响，自检机器人那一局看得见。
 */
import { readFileSync } from 'node:fs';
const src = process.argv[2];
if (!src) {
  console.error('用法: node scripts/check-erosion.mjs <打包好的 erosion.mjs>');
  process.exit(2);
}
const { EROSION_TABLE, ladderFor, parFor, tableFor, createErosion } = await import(src);

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/**
 * 方案那张表，照原文抄一遍（棋盘 → [枚数, 颜色数, 4→3, 3→2, 2→1, par]），后面跟着验收数：
 * 解锁 1×3 / 1×2 / 1×1 各在第几枚、1×1 那一段可翻几枚。
 */
const SPEC = {
  square:        { n: [36, 6, 15, 11, 6, 54], at: [15, 26, 32], last: 4 },
  circle:        { n: [28, 4, 12, 8, 5, 28],  at: [12, 20, 25], last: 3 },
  squareDiamond: { n: [36, 6, 15, 11, 6, 54], at: [15, 26, 32], last: 4 },
  triangleBig:   { n: [54, 6, 20, 15, 11, 81], at: [20, 35, 46], last: 8 },   // 六边三角 54（天才限定），id 是 triangleBig
  circleHex:     { n: [36, 6, 15, 11, 6, 54], at: [15, 26, 32], last: 4 },
  circleSeven:   { n: [49, 7, 18, 14, 10, 86], at: [18, 32, 42], last: 7 },
};

check('六副棋盘都在表里', Object.keys(EROSION_TABLE).length === 6, Object.keys(EROSION_TABLE).join(' '));

// ---- ① 表、合计、1×1 那一段 ------------------------------------------------
for (const [id, { n: [tiles, colors, a, b, c, par], last }] of Object.entries(SPEC)) {
  const t = EROSION_TABLE[id];
  if (!t) { check(`[${id}] 表里有这一副`, false); continue; }
  check(`[${id}] 段数和方案原文一致`, t.seg[0] === a && t.seg[1] === b && t.seg[2] === c, JSON.stringify(t.seg));
  const sum = t.seg[0] + t.seg[1] + t.seg[2];
  check(`[${id}] 三级合计 < 全盘 ${tiles} 枚，1×1 那一段 ≥ 3 枚`, sum < tiles && tiles - sum >= 3, `合计 ${sum}，1×1 那一段 ${tiles - sum} 枚`);
  check(`[${id}] 1×1 那一段可翻 ${last} 枚（方案原文）`, tiles - sum === last, String(tiles - sum));
  check(`[${id}] 基准 par = ceil(枚数 ÷ 4 × 颜色数) = ${par}（二版没动）`, t.par === par && parFor(tiles, colors) === par, String(t.par));
}

// ---- ② 验收数：第几枚那一下降级 ------------------------------------------
for (const [id, { n: [tiles], at }] of Object.entries(SPEC)) {
  const e = createErosion(EROSION_TABLE[id]);
  const reached = {};
  for (let k = 1; k <= tiles; k++) {
    e.spend(1);
    if (!(e.level() in reached)) reached[e.level()] = k;
  }
  check(`[${id}] 第 ${at[0]} / ${at[1]} / ${at[2]} 枚那一下依次到 1×3 / 1×2 / 1×1`,
    reached[3] === at[0] && reached[2] === at[1] && reached[1] === at[2],
    `实际 ${reached[3]} / ${reached[2]} / ${reached[1]}`);
  // 尺子：差一枚的时候还在上一级。
  const before = [4, 3, 2].map((lvl, i) => {
    const e2 = createErosion(EROSION_TABLE[id]);
    e2.spend(at[i] - 1);
    return e2.level() === lvl;
  });
  check(`[${id}]（尺子）差一枚的时候都还在上一级`, before.every(Boolean), before.join(','));
  // 走到 1×1 之后盘上真的还有东西可翻：这一下之后再翻那几枚，级数不动、也不报错。
  const e3 = createErosion(EROSION_TABLE[id]);
  e3.spend(at[2]);
  const s = e3.spend(tiles - at[2]);
  check(`[${id}] 到 1×1 之后把剩下 ${tiles - at[2]} 枚翻完：停在 1 枚、不再降级`, s.level === 1 && s.dropped === 0 && e3.unlocked(), JSON.stringify(s));
}

// ---- ③④ 扣段、降级、结转 ---------------------------------------------------
{
  const e = createErosion(EROSION_TABLE.circle);   // [12, 8, 5]
  check('开局是 1×4，剩 12 段', e.level() === 4 && e.segLeft() === 12 && e.segTotal() === 12);
  e.spend(11);
  check('翻 11 枚之后还在 4 枚、剩 1 段', e.level() === 4 && e.segLeft() === 1, `${e.level()} / ${e.segLeft()}`);
  const s1 = e.spend(1);
  check('再翻一枚：降到 3 枚，新一级 8 段', s1.level === 3 && s1.dropped === 1 && e.segLeft() === 8 && e.segTotal() === 8, JSON.stringify(s1));
  // 结转：这一级剩 8 段，一步翻了 13 枚（含拆掉的炸弹，spend 只认总数）→ 扣完 8 段降到 2 枚
  // （5 段），再扣 5 段降到 1 枚，一步连降两级。
  const s2 = e.spend(13);
  check('一步多翻，超出的结转到下一级（可以连降两级）', s2.level === 1 && s2.dropped === 2, JSON.stringify(s2));
  check('到 1 枚就记下「解锁 1 枚」', e.unlocked() === true && s2.unlocked === true);
  check('到 1 枚之后刻度环整圈熄掉（segTotal 0）', e.segTotal() === 0 && e.segLeft() === 0);
  const s3 = e.spend(9);
  check('到了 1 枚之后再翻也不会更小', s3.level === 1 && s3.dropped === 0, JSON.stringify(s3));
  e.reset();
  check('新的一局：回到 4 枚、第一级满格、徽章清掉', e.level() === 4 && e.segLeft() === 12 && !e.unlocked());
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
    const [a, b, c] = ladderFor(n);
    if (!(a >= 1 && b >= 1 && c >= 1) || n - (a + b + c) < 3) bad.push(`${n}: [${a},${b},${c}]`);
  }
  check('通式在 20–120 枚的盘上：三级都至少 1 段、1×1 那一段至少 3 枚', bad.length === 0, bad.slice(0, 4).join(' · '));
  // 通式是新表的近似比例：方块、小球两行恰好算得一样（尺子：通式不是随手写的一个数）。
  check('（尺子）通式在 36 枚、28 枚上恰好等于方块、小球那两行',
    ladderFor(36).join(',') === '15,11,6' && ladderFor(28).join(',') === '12,8,5',
    `${ladderFor(36).join(',')} / ${ladderFor(28).join(',')}`);
}

// ---- ⑥ 1×1 解锁那一下：和整线消除同一套（读 gameController 源码）-------------
{
  const gc = readFileSync(new URL('../src/engine/gameController.ts', import.meta.url), 'utf8');
  const at = gc.indexOf('function bigMoment(');
  const body = at < 0 ? '' : gc.slice(at, gc.indexOf('\n  }\n', at));
  check('（尺子）切得出 bigMoment', body.length > 0);
  check('bigMoment 就是整线消除那一套：两下震动、滴落声、重震、二号强调色那一大把粒子',
    /vibrate\(\[25, 40, 25\]\)/.test(body) && /playClear\(\)/.test(body) && /screenShake\(refs\.boardWrap, 'heavy'\)/.test(body)
      && /color: accent2Color\(\), count: 16, spread: 64/.test(body));
  check('整线消除那一拍走 bigMoment', /if \(isBonus\) bigMoment\(/.test(gc));
  check('降到 1 枚、这一局头一回：走 bigMoment', /if \(step\.level === 1 && !unlockedOne\) bigMoment\(/.test(gc));
  check('没有第三处另起一套（滴落声只在 bigMoment 里响）',
    (gc.match(/playClear\(\)/g) || []).length === 1 && (gc.match(/bigMoment\(/g) || []).length === 3,
    `playClear ${(gc.match(/playClear\(\)/g) || []).length} 处，bigMoment ${(gc.match(/bigMoment\(/g) || []).length} 处（含定义）`);
}

console.log(fail ? `\n${fail} 条没过` : '\n全过');
process.exit(fail ? 1 : 0);

/**
 * 侵蚀阶梯（《侵蚀阶梯》v1.2 §2）：段数、结转、基准。
 *
 *   npx esbuild src/engine/erosion.ts --bundle --format=esm --outfile=/tmp/erosion.mjs
 *   node scripts/check-erosion.mjs /tmp/erosion.mjs
 *
 * 量四件，每一件都是「写错了不报错、只是这一局的手感全变了」那一类：
 *
 *   ① **每盘段数合计＝全盘枚数**。这一条是整套规则的地基：合计对得上，「擦完最后
 *     一段」和「全部棋子翻成星星」才是同一件事（§2.2）。少一段就会出现「图案已经
 *     到 1 枚了，盘上还剩几枚色块没翻」——那一局会多出一段谁也说不清的尾巴。
 *   ② **通式复算＝字面表**。表是玩家拍板的字面值，通式（r=round(N/12)，三级
 *     [N−r−max(1,r−1), r, max(1,r−1)]）只用来校验；两者不一致说明有人动了其中一边。
 *   ③ **结转**：一步翻了好几枚、超出这一级剩下的段数时，多的要扣到下一级去，
 *     一步之内可以连降两级。
 *   ④ **拆除也算一枚**：控制器把「图案翻的 + 拆掉的炸弹」一起交给 spend，所以这儿
 *     只量 spend 对总数的反应（拆除那一枚从哪来由 check-flip-score 守着）。
 */
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

/** §2 那张表，照方案原文抄一遍（棋盘 → [枚数, 颜色数, 4→3, 3→2, 2→1, par]）。 */
const SPEC = {
  square:        [36, 6, 31, 3, 2, 54],
  circle:        [28, 4, 25, 2, 1, 28],
  squareDiamond: [36, 6, 31, 3, 2, 54],
  triangleBig:   [54, 6, 45, 5, 4, 81],   // 六边三角 54（天才限定），id 是 triangleBig
  circleHex:     [36, 6, 31, 3, 2, 54],
  circleSeven:   [49, 7, 42, 4, 3, 86],
};

check('六副棋盘都在表里', Object.keys(EROSION_TABLE).length === 6, Object.keys(EROSION_TABLE).join(' '));

for (const [id, [tiles, colors, a, b, c, par]] of Object.entries(SPEC)) {
  const t = EROSION_TABLE[id];
  if (!t) { check(`[${id}] 表里有这一副`, false); continue; }
  check(`[${id}] 段数和方案原文一致`, t.seg[0] === a && t.seg[1] === b && t.seg[2] === c, JSON.stringify(t.seg));
  check(`[${id}] 段数合计 = 全盘枚数 ${tiles}`, t.seg[0] + t.seg[1] + t.seg[2] === tiles, String(t.seg.reduce((x, y) => x + y, 0)));
  const byFormula = ladderFor(tiles);
  check(`[${id}] 通式复算对得上字面表`, byFormula.join(',') === t.seg.join(','), `通式 ${byFormula.join(',')}`);
  check(`[${id}] 基准 par = ceil(枚数 ÷ 4 × 颜色数) = ${par}`, t.par === par && parFor(tiles, colors) === par, String(t.par));
}

// 表里没有的棋盘走通式兜底（眼下只有两副要删的三角）。
{
  const t = tableFor('someNewBoard', 40, 5);
  check('表里没有的棋盘按通式兜底', t.seg.join(',') === ladderFor(40).join(',') && t.par === parFor(40, 5), JSON.stringify(t));
}

// ---- ③ 扣段、降级、结转 -------------------------------------------------
{
  const e = createErosion(EROSION_TABLE.circle);   // [25, 2, 1]
  check('开局是 1×4，剩 25 段', e.level() === 4 && e.segLeft() === 25 && e.segTotal() === 25);
  e.spend(24);
  check('翻 24 枚之后还在 4 枚、剩 1 段', e.level() === 4 && e.segLeft() === 1, `${e.level()} / ${e.segLeft()}`);
  const s1 = e.spend(1);
  check('再翻一枚：降到 3 枚，新一级 2 段', s1.level === 3 && s1.dropped === 1 && e.segLeft() === 2, JSON.stringify(s1));
  // 结转：这一级只剩 2 段，一步翻了 5 枚 → 扣完 2 段降到 2 枚（1 段），再扣 1 段
  // 降到 1 枚，一步连降两级。
  const s2 = e.spend(5);
  check('一步多翻，超出的结转到下一级（可以连降两级）', s2.level === 1 && s2.dropped === 2, JSON.stringify(s2));
  check('到 1 枚就记下「解锁 1 枚」', e.unlocked() === true);
  const s3 = e.spend(9);
  check('到了 1 枚之后再翻也不会更小', s3.level === 1 && s3.dropped === 0, JSON.stringify(s3));
}

// ---- ④ 一步翻完整盘：正好走到 1 枚 --------------------------------------
for (const [id, [tiles]] of Object.entries(SPEC)) {
  const e = createErosion(EROSION_TABLE[id]);
  e.spend(tiles);
  check(`[${id}] 一口气翻完全盘 ${tiles} 枚，正好走到 1 枚`, e.level() === 1 && e.unlocked(), `级 ${e.level()}`);
  // 差一枚就不该到 1 枚——这一条是上面那条的尺子（不然「合计对不对」等于没量）。
  const e2 = createErosion(EROSION_TABLE[id]);
  e2.spend(tiles - 1);
  check(`[${id}] 差最后一枚时还没到 1 枚`, e2.level() > 1, `级 ${e2.level()}`);
}

// ---- 无限反转：段照扣，图案不降级 ---------------------------------------
{
  const e = createErosion(EROSION_TABLE.circle, true);
  e.spend(999);
  check('无限反转不吃侵蚀：图案永远停在开局那一级', e.level() === 4 && !e.unlocked(), `级 ${e.level()}`);
}

console.log(fail ? `\n${fail} 条没过` : '\n全过');
process.exit(fail ? 1 : 0);

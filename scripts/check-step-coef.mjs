/**
 * 步数系数与综合分——《侵蚀阶梯》v1.2 §5。
 *
 *   npx esbuild src/engine/stepCoef.ts --bundle --format=esm --outfile=/tmp/stepcoef.mjs
 *   node scripts/check-step-coef.mjs /tmp/stepcoef.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 查的是什么
 *
 *   效率比 x = (par × 已清格数 ÷ 全盘格数) ÷ 实际步数     （清盘时 x = par ÷ 步数）
 *   步数系数 = max(1, x)²          综合分 = round(拼出分 × 步数系数)
 *
 * 三件容易写错、而且错了不报错的事：
 *
 *   ① **下限 1，没有上限。** 少了下限，走得比基准多就开始扣分——那会教玩家「打到
 *      一半就退出」，而这一局的目标恰恰是把盘子清干净。
 *   ② **按清掉的比例折算基准。** 不折算的话，开局两步就退出的人效率比高得离谱，
 *      综合分反而比认真打完的人高。这一条配了一条对照：同样两步，清得多的那个
 *      系数必须更高。
 *   ③ **一步没走不能变成 Infinity。** moves 是 0 时除出来是 Infinity，
 *      round(分 × Infinity) 是 NaN，结算页上是一片空白——不崩、不报错、什么都没有。
 *
 * 外加一条「任意前缀 ≤ 打完」：录三条走子序列，每走一步算一次综合分，最后那一下
 * 必须是最高的。这一条钉的是整套规则的**方向**——不能出现「早点退出更划算」。
 * ─────────────────────────────────────────────────────────────────────────
 */
const src = process.argv[2];
if (!src) {
  console.error('用法: node scripts/check-step-coef.mjs <打包好的 stepCoef.mjs>');
  process.exit(2);
}
const { stepCoefFor } = await import(src);

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const near = (a, b) => Math.abs(a - b) < 1e-9;

// ---------------------------------------------------------------------------
// 1. 公式本身：清盘时就是 (par / 步数)²
// ---------------------------------------------------------------------------
{
  // 小球：28 枚，基准 28（engine/erosion.ts 的表）。
  const full = (moves) => stepCoefFor({ par: 28, cleared: 28, tiles: 28, moves, apply: true });
  check('清盘 + 步数正好等于基准：系数 1', near(full(28), 1), String(full(28)));
  check('清盘 + 只走了一半基准：系数 4（2² ）', near(full(14), 4), String(full(14)));
  check('清盘 + 走了四分之一基准：系数 16', near(full(7), 16), String(full(7)));
  // 上限：没有。走得越少越高，这是这一局要奖励的那件事。
  check('清盘 + 只走了 2 步：系数 196（14²）', near(full(2), 196), String(full(2)));
}

// ---------------------------------------------------------------------------
// 2. 下限就是 1：走得比基准多不扣分
// ---------------------------------------------------------------------------
{
  const full = (moves) => stepCoefFor({ par: 28, cleared: 28, tiles: 28, moves, apply: true });
  const over = [29, 40, 100, 1000].map(full);
  check('走得比基准多：系数一律 1，不扣分', over.every((c) => c === 1), over.join(' / '));
  // 反向对照：正好基准是 1，少一步就 > 1——上面那条绿不是因为「永远回 1」。
  check('少走一步就 > 1（反向对照）', full(27) > 1, String(full(27)));
}

// ---------------------------------------------------------------------------
// 3. 按清掉的比例折算基准
// ---------------------------------------------------------------------------
{
  // 同样两步：清了全盘 vs 只清了七分之一。
  const a = stepCoefFor({ par: 28, cleared: 28, tiles: 28, moves: 2, apply: true });
  const b = stepCoefFor({ par: 28, cleared: 4, tiles: 28, moves: 2, apply: true });
  check('同样两步，清得多的那个系数更高', a > b, `清光 ${a} / 清四枚 ${b}`);
  check('只清了 4/28，基准折成 4：(4/2)² = 4', near(b, 4), String(b));
  // 一枚都没清：效率比是 0，夹到下限 1——开局就退出的人拿不到任何加成。
  const none = stepCoefFor({ par: 28, cleared: 0, tiles: 28, moves: 2, apply: true });
  check('一枚都没清：系数 1（开局就退出拿不到加成）', none === 1, String(none));
}

// ---------------------------------------------------------------------------
// 4. 边界：一步没走、盘子是空的
// ---------------------------------------------------------------------------
{
  const zero = stepCoefFor({ par: 28, cleared: 28, tiles: 28, moves: 0, apply: true });
  check('一步没走：回 1，不是 Infinity', zero === 1 && Number.isFinite(zero), String(zero));
  check('一步没走：拿它去乘分数也算得出来', Number.isFinite(Math.round(500 * zero)), String(Math.round(500 * zero)));
  const noTiles = stepCoefFor({ par: 28, cleared: 0, tiles: 0, moves: 5, apply: true });
  check('全盘 0 枚（不该发生）：回 1，不是 NaN', noTiles === 1, String(noTiles));
}

// ---------------------------------------------------------------------------
// 5. 不乘的那三档（老虎机、步步为营、无限反转）
// ---------------------------------------------------------------------------
{
  const off = stepCoefFor({ par: 28, cleared: 28, tiles: 28, moves: 2, apply: false });
  check('不乘那几档：恒 1', off === 1, String(off));
  // 反向对照：同样的输入，乘的那档是 196——上面那条不是因为输入本身就是 1。
  const on = stepCoefFor({ par: 28, cleared: 28, tiles: 28, moves: 2, apply: true });
  check('同样的输入，乘的那档是 196（反向对照）', near(on, 196), String(on));
}

// ---------------------------------------------------------------------------
// 6. 任意前缀 ≤ 打完：不能出现「早点退出更划算」
// ---------------------------------------------------------------------------
//
// 录三条走子序列。每一条是一串 [这一步之后一共清了几枚, 这一步之后拼出分是多少]，
// 逐步算综合分，最后那一下必须是最高的。
//
// 这一条钉的是整套规则的方向。它能红的情形很具体：哪天有人把下限 1 去掉（走得多
// 就扣分），或者把「按清掉的比例折算」去掉（清得少反而系数高），这三条里至少有
// 一条的最高分会落在中间某一步上。
{
  const PAR = 28;
  const TILES = 28;
  const runs = [
    // 稳稳打完：每两步清四枚，分也稳稳涨。
    { name: '稳稳打完', steps: Array.from({ length: 14 }, (_, i) => [(i + 1) * 2, (i + 1) * 8]) },
    // 前松后紧：开头几步没清什么，后面连锁一路清光。
    { name: '前松后紧', steps: [[0, 6], [0, 12], [2, 20], [6, 34], [14, 60], [28, 96]] },
    // 一路磨：清得慢、分涨得慢，步数远超基准（系数一路夹在 1）。
    { name: '一路磨（步数超基准）', steps: Array.from({ length: 40 }, (_, i) => [Math.min(28, i + 1), (i + 1) * 3]) },
  ];
  for (const run of runs) {
    const totals = run.steps.map(([cleared, built], i) =>
      Math.round(built * stepCoefFor({ par: PAR, cleared, tiles: TILES, moves: i + 1, apply: true })),
    );
    const last = totals[totals.length - 1];
    const best = Math.max(...totals);
    check(`「${run.name}」：打完那一下就是最高分（任意前缀 ≤ 打完）`,
      last === best, `打完 ${last} / 最高 ${best}（第 ${totals.indexOf(best) + 1} 步）`);
  }
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);

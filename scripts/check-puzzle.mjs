/**
 * 《解密》的步数经济和综合得分。
 *
 *   npx esbuild src/engine/puzzleScore.ts --bundle --format=esm --outfile=/tmp/puzzle.mjs
 *   node scripts/check-puzzle.mjs /tmp/puzzle.mjs
 *
 * 这一局和别的都不一样，所以值得单独一道门：它没有钟，结算看的是终局盘面而
 * 不是一路攒下来的分。两件事要钉住——
 *
 *   · 步数这本账：起手 3，走一步扣 1，得分退 2。得分率正好一半时不进不退，
 *     低于一半必死、高于一半能一直玩下去，这条「一半」是整个玩法的支点，
 *     动了 PUZZLE_STEP_COST 或 PUZZLE_STEP_REWARD 就会挪，得有人喊一声。
 *   · 综合得分：(被消除 × 10 + 星星 × 5) × (1 + 有效得分率/100)。别的玩法那
 *     条四项连乘里的时间系数和未翻面惩罚在这儿是有意去掉的（理由写在
 *     puzzleScore.ts 里），这道门顺便把「没有偷偷混进来」也一起钉住。
 *
 * 不碰 DOM、不开浏览器，进得了 CI。
 */
const src = process.argv[2];
if (!src) {
  console.error('用法: node scripts/check-puzzle.mjs <打包好的 puzzleScore.mjs>');
  process.exit(2);
}
const {
  createStepBank,
  puzzleComposite,
  PUZZLE_START_STEPS,
  PUZZLE_STEP_COST,
  PUZZLE_STEP_REWARD,
  PUZZLE_CLEARED_POINTS,
  PUZZLE_STAR_POINTS,
} = await import(src);

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// ---------------------------------------------------------------------------
// 1. 几个数就是玩家定的那几个
// ---------------------------------------------------------------------------
check('起手 3 步', PUZZLE_START_STEPS === 3, String(PUZZLE_START_STEPS));
check('走一步扣 1', PUZZLE_STEP_COST === 1, String(PUZZLE_STEP_COST));
check('得分退 2', PUZZLE_STEP_REWARD === 2, String(PUZZLE_STEP_REWARD));
check('被消除的一枚 10 分', PUZZLE_CLEARED_POINTS === 10, String(PUZZLE_CLEARED_POINTS));
check('星星一枚 5 分', PUZZLE_STAR_POINTS === 5, String(PUZZLE_STAR_POINTS));

// ---------------------------------------------------------------------------
// 2. 步数这本账
// ---------------------------------------------------------------------------
{
  const bank = createStepBank();
  check('开局手里 3 步', bank.left() === 3, String(bank.left()));
  check('还没走，spent 是 0', bank.spent() === 0);

  check('空走一步：剩 2', bank.spend(false) === 2);
  check('再空走一步：剩 1', bank.spend(false) === 1);
  check('第三步空走：剩 0，到头了', bank.spend(false) === 0);
  check('走过三步', bank.spent() === 3, String(bank.spent()));
  // 到 0 之后不该变成负数——界面上那个读数是直接印出来的。
  check('已经 0 了再走也不会变负', bank.spend(false) === 0);
}
{
  const bank = createStepBank();
  check('得分的那一步：1 − 1 + 2，净赚一步（3 → 4）', bank.spend(true) === 4, String(bank.left()));
  check('连锁几拍也只退一次 2 步', bank.spend(true) === 5, String(bank.left()));
}
{
  // 手里只剩一步时得分：先扣后退，不该出现负数的中间态。
  const bank = createStepBank(1);
  check('只剩一步时得分：1 − 1 + 2 = 2', bank.spend(true) === 2, String(bank.left()));
}

// ---------------------------------------------------------------------------
// 3. 「一半」这个支点：得分率决定能不能一直玩下去
// ---------------------------------------------------------------------------
/** 按固定的得分率一路走下去，返回走了多少步才把步数用光（上限 500 步）。 */
function survive(hitEveryN) {
  const bank = createStepBank();
  let n = 0;
  while (bank.left() > 0 && n < 500) {
    n++;
    bank.spend(n % hitEveryN === 0);
  }
  return n;
}
check('每两步中一次（50%）：不进不退，走满 500 步还活着', survive(2) === 500, `${survive(2)} 步`);
check('每三步中一次（33%）：撑不住，几步就完', survive(3) < 20, `${survive(3)} 步`);
check('步步得分（100%）：一直活着', survive(1) === 500, `${survive(1)} 步`);
{
  // 一次不中：起手三步，走三步到头，不多不少。
  const bank = createStepBank();
  let n = 0;
  while (bank.left() > 0 && n < 50) { n++; bank.spend(false); }
  check('一次不中：正好走三步', n === 3, `${n} 步`);
}

// ---------------------------------------------------------------------------
// 4. 综合得分
// ---------------------------------------------------------------------------
check('一枚没动：0 分', puzzleComposite({ cleared: 0, stars: 0, ratePercent: 0 }) === 0);
check(
  '6 枚被消除、0 星星、得分率 0：6 × 10 = 60',
  puzzleComposite({ cleared: 6, stars: 0, ratePercent: 0 }) === 60,
  String(puzzleComposite({ cleared: 6, stars: 0, ratePercent: 0 })),
);
check(
  '0 消除、8 星星、得分率 0：8 × 5 = 40',
  puzzleComposite({ cleared: 0, stars: 8, ratePercent: 0 }) === 40,
);
check(
  '6 消除 + 8 星星，得分率 50%：(60 + 40) × 1.5 = 150',
  puzzleComposite({ cleared: 6, stars: 8, ratePercent: 50 }) === 150,
  String(puzzleComposite({ cleared: 6, stars: 8, ratePercent: 50 })),
);
check(
  '得分率 100% 正好翻一倍：(60 + 40) × 2 = 200',
  puzzleComposite({ cleared: 6, stars: 8, ratePercent: 100 }) === 200,
);
check('四舍五入取整，不带小数', Number.isInteger(puzzleComposite({ cleared: 1, stars: 1, ratePercent: 33 })));
check(
  '同样的枚数，消除比星星值钱一倍',
  puzzleComposite({ cleared: 4, stars: 0, ratePercent: 0 }) ===
    2 * puzzleComposite({ cleared: 0, stars: 4, ratePercent: 0 }),
);
// 没翻过的正面一枚都不算——不加分，也绝不倒扣。这是这一局和别的玩法最容易
// 混的一条：别处有 0.95^未翻面，这儿没有，也不许有。真喂一个 neverFlipped
// 进去，看它动不动分——写成 f(x) === f(x) 那种同义反复是永远绿的，白钉。
{
  const plain = puzzleComposite({ cleared: 2, stars: 3, ratePercent: 40 });
  const withPile = puzzleComposite({ cleared: 2, stars: 3, ratePercent: 40, neverFlipped: 29 });
  check('盘上剩 29 枚没翻的，一分不扣', plain === withPile && plain === 49, `${plain} vs ${withPile}`);
}
check('得分率是负的当 0 算，不会算出负分', puzzleComposite({ cleared: 1, stars: 0, ratePercent: -50 }) === 10);

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);

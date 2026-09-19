/**
 * 《真正解密 · 步步为营》的步数账本和综合得分。
 *
 *   npx esbuild src/engine/puzzleScore.ts --bundle --format=esm --outfile=/tmp/puzzle.mjs
 *   node scripts/check-puzzle.mjs /tmp/puzzle.mjs
 *
 * 这一局和别的都不一样，所以值得单独一道门：它没有钟，结算看的是终局盘面而
 * 不是一路攒下来的分。两件事要钉住——
 *
 *   · **步数这本账**：起手 8，走一步扣 1，得分退 1，上一步也得分再退 1，这一
 *     步消了边再退 1，不封顶。所以孤立的一次得分只够回本（净 0），手里的步数
 *     只能靠「连得上」和「消边」长出来。
 *   · **综合得分**：(被消除 × 10 + 星星 × 5) × (1 + 有效得分率/100)。别的玩法
 *     那条四项连乘里的时间系数和未翻面惩罚在这儿是有意去掉的（理由写在
 *     puzzleScore.ts 里），这道门顺便把「没有偷偷混进来」也一起钉住。
 *
 * ⚠️ 这道门在 2026-09 整段重写过。旧的那一版钉的是 3/1/2 那一套，里头有一条
 * 「得分率正好一半时不进不退」——**新规则下 50% 是会死的**（第 4 节量出来是 15
 * 步就耗尽）。谁把这句话从哪儿抄回来，就是把旧规则抄回来了。
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
  stepLedgerText,
  PUZZLE_START_STEPS,
  PUZZLE_STEP_COST,
  PUZZLE_STEP_REWARD,
  PUZZLE_STREAK_BONUS,
  PUZZLE_EDGE_BONUS,
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
check('起手 8 步', PUZZLE_START_STEPS === 8, String(PUZZLE_START_STEPS));
check('走一步扣 1', PUZZLE_STEP_COST === 1, String(PUZZLE_STEP_COST));
check('得分退 1', PUZZLE_STEP_REWARD === 1, String(PUZZLE_STEP_REWARD));
check('上一步也得分，再退 1', PUZZLE_STREAK_BONUS === 1, String(PUZZLE_STREAK_BONUS));
check('这一步消了边，再退 1', PUZZLE_EDGE_BONUS === 1, String(PUZZLE_EDGE_BONUS));
check('被消除的一枚 10 分', PUZZLE_CLEARED_POINTS === 10, String(PUZZLE_CLEARED_POINTS));
check('星星一枚 5 分', PUZZLE_STAR_POINTS === 5, String(PUZZLE_STAR_POINTS));
// 扣 1 退 1 就是「孤立得分只够回本」这条骨架。它一动，整个玩法的支点就挪了
// （见第 4 节），得有人喊一声。
check('扣 1 退 1：孤立的一次得分净变化是 0', PUZZLE_STEP_REWARD === PUZZLE_STEP_COST);

// ---------------------------------------------------------------------------
// 2. 步数账本：§1.2 那张净变化表，一格一格对
// ---------------------------------------------------------------------------
{
  const bank = createStepBank();
  check('开局手里 8 步', bank.left() === 8, String(bank.left()));
  check('还没走，spent 是 0', bank.spent() === 0);
  check('空走一步：8 → 7（净 −1）', bank.spend(false) === 7, String(bank.left()));
}
{
  // 这一串是连着走的同一局，所以「上一步有没有得分」才量得出来。
  const bank = createStepBank();
  check('孤立得分：8 → 8（1 − 1 + 1，净 0）', bank.spend(true) === 8, String(bank.left()));
  check('接着再得分（连上了）：8 → 9（净 +1）', bank.spend(true) === 9, String(bank.left()));
  check('接着得分且消边：9 → 11（净 +2）', bank.spend(true, { edge: true }) === 11, String(bank.left()));
  check('接着空走：11 → 10', bank.spend(false) === 10, String(bank.left()));
  check('再得分（上一步没得分，链断了）：10 → 10（净 0）', bank.spend(true) === 10, String(bank.left()));
  // 结算页那句「最多攒到 X 步」读的是这个，不是最后剩下的那个数。
  check('峰值记的是攒到过最多的那一下（11），不是收尾的 10', bank.peak() === 11, String(bank.peak()));
  check('走过五步，其中四步得分', bank.spent() === 5 && bank.scoredMoves() === 4,
    `${bank.spent()} 步 / ${bank.scoredMoves()} 步得分`);
}
{
  const bank = createStepBank();
  check('首步就得分且消边：8 → 9（首步没有「上一步」，只有消边那一下）',
    bank.spend(true, { edge: true }) === 9, String(bank.left()));
}
{
  // 手里只剩一步时得分：先扣后退，不该出现负数的中间态。
  const bank = createStepBank(1);
  check('剩 1 步时得分：1 → 1（用掉一步又赚回一步）', bank.spend(true) === 1, String(bank.left()));
}
{
  const bank = createStepBank(1);
  check('剩 1 步时空走：1 → 0，这一局到头了', bank.spend(false) === 0, String(bank.left()));
  // 到 0 之后不该变成负数——界面上那个读数是直接印出来的。
  check('已经 0 了再走也不会变负', bank.spend(false) === 0, String(bank.left()));
}
{
  // reset() 要把「上一步得分了」这件事也一起忘掉，不然下一局的第一步会白拿
  // 一份连续奖励（这一局是按局重开的，同一个 bank 会被用好几遍）。
  const bank = createStepBank();
  bank.spend(true);
  bank.spend(true);
  bank.reset();
  check('reset 之后回到开局：8 步、spent 0、峰值也回去', 
    bank.left() === 8 && bank.spent() === 0 && bank.peak() === 8,
    `${bank.left()} / ${bank.spent()} / ${bank.peak()}`);
  check('reset 之后第一步得分只是回本（连续奖励没被带过来）', bank.spend(true) === 8, String(bank.left()));
}

// ---------------------------------------------------------------------------
// 3. 「上一步有没有得分」由账本自己记
// ---------------------------------------------------------------------------
//
// 这是整套接线里最容易接错的一处：resolveMove 里到处都是这一拍那一拍的局部变
// 量，传错一个就成了「按拍算连续」。所以 prevScored 不让调用方传进来，记在账
// 本里——连着调三次 spend(true) 就能整段验出来：第一次只回本，第二、三次都必
// 须多退 1。
{
  const bank = createStepBank();
  const a = bank.spend(true);
  const b = bank.spend(true);
  const c = bank.spend(true);
  check('连调三次 spend(true)：8 → 8 → 9 → 10', a === 8 && b === 9 && c === 10, `${a} / ${b} / ${c}`);
  check('多退回来的两步记在连续账上', bank.streakRefunds() === 2, String(bank.streakRefunds()));
  check('一次都没消边，消边账是 0', bank.edgeRefunds() === 0, String(bank.edgeRefunds()));
}
{
  // 第二个参数是可选的：不传 ctx 和传 {} 必须一模一样（接线时漏传不该白拿一步）。
  const x = createStepBank();
  const y = createStepBank();
  check('spend 的第二个参数可以不传，和传 {} 等价',
    x.spend(true) === y.spend(true, {}) && x.edgeRefunds() === y.edgeRefunds());
  // 没得分的那一步就算「消了边」也什么都不退——没得分就没有消边这件事。
  const z = createStepBank();
  check('没得分的一步，带 edge 也不退（8 → 7）', z.spend(false, { edge: true }) === 7, String(z.left()));
  check('没得分的一步不记消边账', z.edgeRefunds() === 0, String(z.edgeRefunds()));
}

// ---------------------------------------------------------------------------
// 4. 支点：不再是「一半」
// ---------------------------------------------------------------------------
//
// 旧的 3/1/2 那一版，每两步中一次就能永生。新这一版孤立得分只够回本，所以
// 50% 是会死的——下面量出来是 15 步。手里的步数只能靠「连得上」和「消边」长
// 出来，这就是这个玩法和别的玩法的分界线。
//
// （随机走时不进不退的那个概率是 p + p² = 1，也就是 p ≈ 0.618。这道门不模拟
// 随机，只钉住三条确定的节律——固定节律下「每两步中一次」的连续得分恰好一次
// 也凑不出来，所以它比 0.618 那个说法更难看，这是对的。）
/** 按固定的节律一路走下去，返回走了多少步才把步数用光（上限 500 步）。 */
function survive(hitEveryN) {
  const bank = createStepBank();
  let n = 0;
  while (bank.left() > 0 && n < 500) {
    n++;
    bank.spend(n % hitEveryN === 0);
  }
  return n;
}
check('一次不中：正好走 8 步', survive(Infinity) === 8, `${survive(Infinity)} 步`);
check('每两步中一次（50%）：15 步耗尽——旧规则下这是永生，新规则下不是了',
  survive(2) === 15, `${survive(2)} 步`);
check('每三步中一次：11 步', survive(3) === 11, `${survive(3)} 步`);
check('步步得分：走满 500 步还活着', survive(1) === 500, `${survive(1)} 步`);
{
  // 没有封顶。玩家明确否掉了《封顶》这条规则，这一条就是哨兵：步步得分走满
  // 100 步，手里必须正好 107 步（= 8 + 99，头一步只回本，后 99 步各净 +1）。
  // 谁「为了安全」偷偷加一个上限，这里立刻红。
  const bank = createStepBank();
  for (let i = 0; i < 100; i++) bank.spend(true);
  check('步步得分 100 步之后手里 107 步（没有封顶）', bank.left() === 107, String(bank.left()));
  check('那 99 步的连续奖励都记上了', bank.streakRefunds() === 99, String(bank.streakRefunds()));
}

// ---------------------------------------------------------------------------
// 5. 综合得分
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
// 没有钟，所以也不许有时间系数。同上，真喂一个进去看它动不动分。
{
  const plain = puzzleComposite({ cleared: 2, stars: 3, ratePercent: 40 });
  const slow = puzzleComposite({ cleared: 2, stars: 3, ratePercent: 40, seconds: 900, timeFactor: 0.2 });
  check('磨了十五分钟也不打折（这一局没有钟）', plain === slow, `${plain} vs ${slow}`);
}
check('得分率是负的当 0 算，不会算出负分', puzzleComposite({ cleared: 1, stars: 0, ratePercent: -50 }) === 10);

// ---------------------------------------------------------------------------
// 第 6 节：《余步》那一格上冒的那行字
//
// 这一节钉的是一次真事故。原先那一格只认「净变化」，净 0 就什么都不冒：
//
//     function bumpSteps(delta) { if (!host || delta === 0) return; … }
//
// 而这套经济里孤立的一次得分正好回本（−1 +1，净 0）。于是最常见的那次得分
// ——第一次得分，或任何一次断了链子的得分——在余步那一格上一个字都没有，屏幕
// 上唯一动的东西是分数格冒出来的「+27」。玩家报回来的原话是「得分现在还是加
// 分不是加步数」。实测 8 局 67 步，三次得分，三次都是余步纹丝不动。
//
// 所以这一节的四条里，**第二条（净 0 也要出字）是主角**，别的三条是陪它的。
// ---------------------------------------------------------------------------
console.log('\n【6】余步那一格上的那行字');

// 退回来几步，是从账本自己算出来的，不是手写的常数——这样改了经济数字，这一
// 节会跟着一起红，而不是悄悄地和账本对不上。
const refundOf = (bank, scored, edge) => {
  const before = bank.left();
  const after = bank.spend(scored, { edge });
  return after - before + PUZZLE_STEP_COST;
};

{
  const b = createStepBank();
  check('没得分：只印成本', stepLedgerText(refundOf(b, false)) === '−1', stepLedgerText(0));
}
{
  // 主角这一条。上一步没得分，所以没有连续加成；净变化 0，但字必须在。
  const b = createStepBank();
  b.spend(false);
  const txt = stepLedgerText(refundOf(b, true));
  check('孤立得分：净 0 也要出字，而且要看得出「付了 1、退回 1」', txt === '−1 +1', txt);
}
{
  const b = createStepBank();
  b.spend(true); // 上一步得分，链子接上了
  const txt = stepLedgerText(refundOf(b, true));
  check('连续得分：退 2', txt === '−1 +2', txt);
}
{
  const b = createStepBank();
  b.spend(true);
  const txt = stepLedgerText(refundOf(b, true, true));
  check('连续得分又消了边：退 3', txt === '−1 +3', txt);
}
{
  const b = createStepBank();
  b.spend(false);
  const txt = stepLedgerText(refundOf(b, true, true));
  check('孤立得分但消了边：退 2', txt === '−1 +2', txt);
}
// 哨兵：这四种情况在屏幕上必须是四行不一样的字。少一种能分辨的，玩家就少一
// 条能学会的规律——而「连着得分才涨」正是这一局的全部意思。
{
  const all = [0, 1, 2, 3].map(stepLedgerText);
  check('四种情况四行字，没有两行撞脸', new Set(all).size === 4, all.join(' / '));
}
// 成本那一段用的是 U+2212 减号，不是连字符（U+002D）：它和「+」等宽，两种字
// 并排在那一格里才对得齐。抄成连字符肉眼看不出来，屏幕上会歪。
check('减号是 U+2212，不是连字符', stepLedgerText(0).charCodeAt(0) === 0x2212, `U+${stepLedgerText(0).charCodeAt(0).toString(16).toUpperCase()}`);

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);

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
 *   · **综合得分**：被消除 × 10 + 星星 × 5，**就这两项**。别的玩法那条四项连乘
 *     在这儿一项都不剩：时间系数（没有钟）、0.95^未翻面（步数耗尽是常态）早就
 *     去掉了，有效得分率那一乘 2026-10 也撤了（玩家拍的板，见 puzzleScore.ts）。
 *     这道门把「一项都没有偷偷混回来」钉住。
 *   · **《怎么玩》那一条**（第 7 节）：四种语言里讲的必须是同一个公式。这一条是
 *     补上来的——2026-10 撤掉那一乘时，代码改了、`src/rules.ts` 四语**一个字都没
 *     改**，于是线上那本规则书对着玩家念了一个已经不存在的公式，而没有任何门看着
 *     它。规则书是「对代码实际行为的陈述」（rules.ts 开头那段），说错就是假话。
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
const { readFileSync } = await import('node:fs');

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
// 底稿 §7 第 118 行那张表和 E14 写的一直是「消线 **+2**」，而代码从落地起给的是 1，
// 两边对不上了半年（2026-10-02 改回来）。这一条逐字钉死那个 2：它不报错、不白屏，只是
// 让「凑一整条线」这件最难的事回报少一半。
check('这一步消了边，再退 2（底稿 §7 / E14）', PUZZLE_EDGE_BONUS === 2, String(PUZZLE_EDGE_BONUS));
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
  // −1 成本 +1 得分 +1 连上 +2 消线 = 净 +3（消线那一笔 2026-10-02 从 1 改成 2）。
  check('接着得分且消边：9 → 12（净 +3）', bank.spend(true, { edge: true }) === 12, String(bank.left()));
  check('接着空走：12 → 11', bank.spend(false) === 11, String(bank.left()));
  check('再得分（上一步没得分，链断了）：11 → 11（净 0）', bank.spend(true) === 11, String(bank.left()));
  // 结算页那句「最多攒到 X 步」读的是这个，不是最后剩下的那个数。
  check('峰值记的是攒到过最多的那一下（12），不是收尾的 11', bank.peak() === 12, String(bank.peak()));
  check('走过五步，其中四步得分', bank.spent() === 5 && bank.scoredMoves() === 4,
    `${bank.spent()} 步 / ${bank.scoredMoves()} 步得分`);
}
{
  const bank = createStepBank();
  check('首步就得分且消边：8 → 10（首步没有「上一步」，只有消边那两步）',
    bank.spend(true, { edge: true }) === 10, String(bank.left()));
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
// 有效得分率那一乘**撤了**（玩家 2026-10）。这两条从前钉的是「仍然乘」：
//   6 消除 + 8 星星、得分率 50% → (60+40) × 1.5 = 150
//   得分率 100% 正好翻一倍 → 200
// 现在钉反面：**同一副盘面，得分率给什么值都算出同一个数**。
check(
  '6 消除 + 8 星星：60 + 40 = 100（不再乘得分率）',
  puzzleComposite({ cleared: 6, stars: 8, ratePercent: 50 }) === 100,
  String(puzzleComposite({ cleared: 6, stars: 8, ratePercent: 50 })),
);
check(
  '得分率给 0 / 50 / 100 都是同一个数',
  [0, 50, 100].every((r) => puzzleComposite({ cleared: 6, stars: 8, ratePercent: r }) === 100),
  [0, 50, 100].map((r) => puzzleComposite({ cleared: 6, stars: 8, ratePercent: r })).join(' '),
);
// 尺子：盘面本身还是算数的，不是把这个函数整个压成了常数。
check(
  '（尺子）盘面变了分就变',
  puzzleComposite({ cleared: 7, stars: 8, ratePercent: 0 }) === 110,
  String(puzzleComposite({ cleared: 7, stars: 8, ratePercent: 0 })),
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
  // 35 = 2×10 + 3×5。从前这儿写的是 49（35 × 1.4，得分率那一乘还在的时候）。
  check('盘上剩 29 枚没翻的，一分不扣', plain === withPile && plain === 35, `${plain} vs ${withPile}`);
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
  check('连续得分又消了边：退 4（1 得分 + 1 连上 + 2 消线）', txt === '−1 +4', txt);
}
{
  const b = createStepBank();
  b.spend(false);
  const txt = stepLedgerText(refundOf(b, true, true));
  check('孤立得分但消了边：退 3（1 得分 + 2 消线）', txt === '−1 +3', txt);
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

// ---------------------------------------------------------------------------
// 【7】《怎么玩》里那一条，四种语言都要和上面这些常数说同一件事
//
// 读 `src/rules.ts` 的源码文本，不打包：这本书就是四段字面量，而要查的正是「字面
// 上写了什么」。
//
// 为什么非要有这一节：2026-10 撤掉有效得分率那一乘的时候，`puzzleScore.ts` 改了、
// 这道门的前六节也跟着改了，**四种语言的规则书一个字都没动**——于是线上那本书对着
// 玩家念 `(被消除 × 10 + 星星 × 5) × (1 + 有效得分率)`，一个已经不存在的公式。前六
// 节全绿，因为它们只问引擎。
console.log('\n【7】《怎么玩》那一条（四语）');
const rulesSrc = readFileSync(new URL('../src/rules.ts', import.meta.url), 'utf8');
check('（尺子）rules.ts 读到了', rulesSrc.length > 2000, `${rulesSrc.length} 字`);

/** 四种语言里这一条的抬头。写出来而不是按下标取：下标会随着加玩法而挪。 */
const PUZZLE_TERMS = [
  ['zhHans', '真正解密 · 步步为营'],
  ['zhHant', '真正解密 · 步步為營'],
  ['en', 'Puzzle · Step by step'],
  ['fr', 'Énigme · Pas à pas'],
];
/**
 * 英语和法语把起手那个数**拼成单词**（eight moves / huit coups），中文写阿拉伯数字。
 * 所以这两语要认两种写法——第一版只认数字，当场把两条好文案判成红了。
 *
 * 表里查不到那个数就报红并说清要补什么，而不是静静放过：下一次有人把起手改成 6，
 * 这儿要么拦住他去改四段字，要么告诉他来补一个词，两种都比空绿好。
 */
const NUM_WORD = {
  en: { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten' },
  fr: { 1: 'un', 2: 'deux', 3: 'trois', 4: 'quatre', 5: 'cinq', 6: 'six', 7: 'sept', 8: 'huit', 9: 'neuf', 10: 'dix' },
};
/** 这一语的正文里有没有把 n 说出来（数字或者拼出来的词）。 */
function saysNumber(lang, body, n) {
  if (body.includes(String(n))) return { ok: true, how: `数字 ${n}` };
  const word = NUM_WORD[lang]?.[n];
  if (word && new RegExp(`\\b${word}\\b`, 'i').test(body)) return { ok: true, how: `拼成 ${word}` };
  return { ok: false, how: word ? `既没有 ${n} 也没有 ${word}` : `没有 ${n}，而 NUM_WORD.${lang} 里也没有 ${n} 这个词——先把它补上` };
}

for (const [lang, term] of PUZZLE_TERMS) {
  // `{ term: '<抬头>', body: '<正文>' }` —— 正文里不会出现没转义的单引号。
  const re = new RegExp("term: '" + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "', body: '([^']*)'");
  const m = rulesSrc.match(re);
  // 尺子先行：抬头改了名字、或者这一条整段没了，下面每一句都会变成恒真。
  check(`${lang}（尺子）找到了这一条，而且正文不短`, Boolean(m) && m[1].length > 80, m ? `${m[1].length} 字` : '没找到');
  if (!m) continue;
  const body = m[1];
  // ① 两个每枚分值和起手步数都要印在书上——玩家照它算分。
  {
    const r = saysNumber(lang, body, PUZZLE_START_STEPS);
    check(`${lang}：书上写着起手 ${PUZZLE_START_STEPS} 步`, r.ok, r.how);
  }
  check(`${lang}：书上写着被消除 × ${PUZZLE_CLEARED_POINTS}`, body.includes(String(PUZZLE_CLEARED_POINTS)));
  check(`${lang}：书上写着星星 × ${PUZZLE_STAR_POINTS}`, body.includes(String(PUZZLE_STAR_POINTS)));
  // ② **不许再出现 `× (1 + …)`**。这就是 2026-10 那次漏掉的那一句，四种语言的写法
  //    不同（半角括号、全角括号、法语那个窄空格），所以三种都拦。
  const mult = body.match(/×\s*[(（]\s*1\s*\+/);
  check(`${lang}：没有「× (1 + …)」那一乘了`, !mult, mult ? mult[0] : '');
  // ③ 消边退几步，书上那个数要和常数一致。
  //    这一条偏弱（只问「那个数字出现过没有」），可它正是 2026-10 真漏的那一类：
  //    常数从 1 改成 2 而四段字没动，这儿当场红。
  {
    const r = saysNumber(lang, body, PUZZLE_EDGE_BONUS);
    check(`${lang}：消边退 ${PUZZLE_EDGE_BONUS} 步，书上说得出这个数`, r.ok, r.how);
  }
}
// 反面尺子：这一节真的在拦东西——把那条正则喂一句旧文案，必须抓得到。
{
  const stale = '用它自己那套公式（被消除 × 10 + 星星 × 5）×（1 + 有效得分率），不乘步数系数。';
  check('（反面尺子）旧那句话喂进来会被抓住', /×\s*[(（]\s*1\s*\+/.test(stale));
}

// ── 6. 最后那一步也要记上（读 gameController 的源码，不打包）────────────────
//
// 一局的最后一步是**记在账上的**还是**漏掉的**，取决于 `finish()` 里三件事的先后：
//
//     bank.spend(…)            ← 走了一步，这是唯一的记录处
//     if (checkHazard) …       ← 炸掉了
//     if (isGameOver()) …      ← 盘面清空了
//     if (left <= 0) …         ← 步数见底
//
// 从前 `spend` 排在最后，于是**清盘那一局的最后一步整步漏掉**：把盘面打到一枚不剩的那
// 一下不计入「走了 N 步」，结算页和分享卡一起少一步。少的偏偏是最漂亮的那一局——打到清
// 盘的人才会遇上，而屏幕上什么都不报，数字看着也像那么回事。
//
// ⚠️ 这一条**读的是源码的次序**，不是跑一局量出来的。真正的端到端要手摆一副「一步就能
// 清空」的牌（devDeal 只在 dev 下存在，见 engine/devDeal.ts），而那副牌要连「门自己看得
// 出这一步真的走了」都成立——盘上只剩同色同面的几枚时，循环位移前后屏幕一模一样，门分
// 不出「走了一步」和「没走动」。所以这儿照 check-residue-wiring 的办法钉次序：这四行的
// 先后本身就是那条规则，而它们在同一个函数里，一眼看得完。
//
// 后三行的**先后一个字都不许动**：炸弹 > 盘面清空 > 步数见底。这是玩家定的——「盘面真
// 的走完了就该报『都消完了』，不该报『步数用完了』」，后者会让他以为自己输了，而他其实
// 是赢到了头。
{
  const gc = readFileSync(new URL('../src/engine/gameController.ts', import.meta.url), 'utf8');
  const m = gc.match(/const finish = \(\) => \{[\s\S]*?\n    \};/);
  check('（尺子）切出了 gameController 的 finish()', Boolean(m), m ? `${m[0].length} 字` : '没切到');
  const body = m ? m[0] : '';
  const at = (re) => body.search(re);
  const iSpend = at(/bank\.spend\(/);
  const iHazard = at(/hooks\.checkHazard\?\.\(\)/);
  const iOver = at(/hooks\.isGameOver\(\)/);
  const iAll = at(/endGame\(ALL_FLIPPED_REASON\)/);
  const iOut = at(/endGame\(PUZZLE_STEPS_OUT_REASON\)/);
  check('（尺子）四样都在这个函数里找得到',
    iSpend >= 0 && iHazard >= 0 && iOver >= 0 && iAll >= 0 && iOut >= 0,
    `spend@${iSpend} hazard@${iHazard} over@${iOver} all@${iAll} out@${iOut}`);
  check('记账排在「这一局到没到头」之前（最后一步不会漏）',
    iSpend >= 0 && iSpend < iHazard && iSpend < iOver,
    `spend@${iSpend} < hazard@${iHazard} / over@${iOver}`);
  check('结局的优先次序没动：炸弹 > 盘面清空 > 步数见底',
    iHazard < iOver && iAll < iOut,
    `hazard@${iHazard} < over@${iOver}，清空@${iAll} < 见底@${iOut}`);
  // 反面尺子：把旧那个次序（先判到没到头、再记账）喂进同一套判据，必须抓得到。
  {
    const stale = `const finish = () => {
      if (hooks.checkHazard?.()) { return; }
      if (hooks.isGameOver()) { endGame(ALL_FLIPPED_REASON); return; }
      if (bank) { const left = bank.spend(true, {}); if (left <= 0) { endGame(PUZZLE_STEPS_OUT_REASON); return; } }
    };`;
    const sSpend = stale.search(/bank\.spend\(/);
    const sOver = stale.search(/hooks\.isGameOver\(\)/);
    check('（反面尺子）旧那个次序喂进来会被抓住', !(sSpend < sOver), `spend@${sSpend} over@${sOver}`);
  }
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);

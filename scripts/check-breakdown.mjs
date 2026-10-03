/**
 * 结算页那几行明细的单元测试——**加起来要对得上**。
 *
 *   npx esbuild src/engine/runRecord.ts --bundle --format=esm --outfile=/tmp/runrecord.mjs
 *   node scripts/check-breakdown.mjs /tmp/runrecord.mjs
 *
 * ── 为什么要它 ────────────────────────────────────────────────
 *
 * 明细这几行讲的是「这分是怎么来的」，所以它们有一条谁都看得出来的性质：**非主数那几
 * 行加起来 = 拼出分**。可这条性质从来没有人验过，于是两档悄悄对不上了很久：
 *
 *   · **老虎机**——拼成一次除了翻面的 +2 还给 ⌈枚数²/2⌉ 的完成奖励（§7），而明细里
 *     压根没有这一行，那一截就凭空消失在「拼出分」里。规则书和挑图形页都在讲这个奖
 *     励，结算页上却找不到它去了哪儿。
 *   · **无限反转**——那一局不按「翻一枚 +2」算分（翻过去还能翻回来，那样就是来回翻刷
 *     分），它按图案给分再乘 1.5ⁿ。可它的 `flips` 字段照样有数，于是走进了侵蚀那一
 *     支，结算页上摆着一行「翻面 n 枚 ×2 → n×2」——**那个数和这一局的得分没有任何关
 *     系**。
 *
 * 两样都不报错、不白屏，只是数字不对——而「数字不对」正是这一页唯一的内容。
 *
 * 这个文件不碰 DOM、不开浏览器：`runBreakdown` 收的是一份 RunData，吐的是一串
 * [抬头, 值]。喂几份手捏的 RunData 就能把四种语言一起验完。
 */

const src = process.argv[2];
if (!src) {
  console.error('用法: node scripts/check-breakdown.mjs <打包好的 runRecord.mjs>');
  process.exit(2);
}
const { runBreakdown, isSumRow, buildShareInfo } = await import(src);

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const LANGS = ['zhHans', 'zhHant', 'en', 'fr'];

/** 一份能用的 RunData 底子；每一档只改自己要紧的那几项。 */
const base = (over = {}) => ({
  shapeId: 'square',
  shapeFallback: '方块',
  modeKey: '',
  totalScore: 0,
  score: 0,
  ratePercent: 50,
  bonusMult: 1.5,
  elapsedSec: 90,
  moves: 20,
  best: 100,
  reason: 'manual',
  neverFlipped: 0,
  unflippedScale: 1,
  timeMult: 1,
  patternPoints: 0,
  comboBonusPoints: 0,
  linePoints: 0,
  extraPenalty: 0,
  extraPenaltyReason: '',
  hazardEnd: false,
  at: 0,
  ...over,
});

/**
 * 从一行的**值**里把数读出来。
 *
 * 值的形状只有四种：`'120'`、`'+30'`、`'−12'`、`'×1.25'`，外加空的。乘号那一行不是加
 * 数（它是系数），空的也不是（那是步数那本账里的一句话，见 runRecord 的 puzzle 分支），
 * 两样都回 null，不进加法。
 */
const addend = (value) => {
  const v = String(value).trim();
  if (!v) return null;
  if (v.startsWith('×')) return null;
  const sign = v.startsWith('−') ? -1 : 1;
  const n = Number(v.replace(/^[+−]/, ''));
  return Number.isFinite(n) ? sign * n : null;
};

const dump = (rows) => rows.map(([l, v]) => `${l}=${v || '∅'}`).join(' | ');

// ── 1. 每一档：拼出分**之前**那几行加起来 = 拼出分；之后那几行把它变成综合分 ─────
//
// 明细是**两段**，不是一条加法：
//
//   翻面 / 削线 / 完成奖励 …   → 加起来 = 拼出分
//   拼出分 × 步数系数 − 惩罚   → 综合分
//
// 所以分界线就是「拼出分」那一行。一锅端着加的话，惩罚那一行（−10）会被算进拼出分里
// ——这个文件第一版就是那么写的，当场红在炸弹局上，而**红得对**：那一行确实不是拼出分
// 的加数。
//
// 两条分界线都靠 isSumRow 认（它按文案认，不按行号——行数随这一局有没有削线、有没有惩
// 罚而变）。所以这一节同时也在验 isSumRow：它要是认不出来，分界线就跑了，加数里混进拼
// 出分自己，和当场翻倍，一眼看得见。
const CASES = [
  {
    name: '基础 / 侵蚀局（翻面 + 削线）',
    d: base({ flips: 24, defused: 0, lines: 2, linePoints: 18, patternPoints: 48, score: 66, totalScore: 99, par: 30, stepCoef: 1.5, moves: 20 }),
    sum: 66,
  },
  {
    name: '炸弹局（含拆除、带惩罚）',
    d: base({ modeKey: 'bomb', flips: 18, defused: 3, lines: 0, linePoints: 0, patternPoints: 36, score: 36, totalScore: 26, extraPenalty: 10, extraPenaltyReason: '炸弹惩罚', par: 30, stepCoef: 1, hazardEnd: true }),
    sum: 36,
  },
  {
    name: '老虎机局（modeKey 还是 base，认的是 slot）',
    // 翻面 12 枚 ×2 = 24，完成奖励 ⌈4²/2⌉ ×3 次 = 24，削线 9 → 拼出分 57
    d: base({ slot: true, targetId: 'tri3', flips: 12, lines: 1, linePoints: 9, patternPoints: 48, score: 57, totalScore: 57 }),
    sum: 57,
  },
  {
    name: '无限反转局（图案分 + 连锁加成）',
    d: base({ modeKey: 'flip', flips: 30, lines: 0, linePoints: 0, patternPoints: 80, comboBonusPoints: 40, score: 120, totalScore: 120, flipRules: 2 }),
    sum: 120,
  },
];

for (const c of CASES) {
  for (const lang of LANGS) {
    const rows = runBreakdown(c.d, lang);
    const cut = rows.findIndex(([l]) => isSumRow(l, lang));
    const sums = rows.filter(([l]) => isSumRow(l, lang));
    const parts = rows.slice(0, cut).map(([, v]) => addend(v)).filter((n) => n !== null);
    const got = parts.reduce((a, b) => a + b, 0);
    check(
      `${c.name} · ${lang}：拼出分之前那几行加起来 = ${c.sum}`,
      cut > 0 && got === c.sum,
      cut > 0 && got === c.sum ? `${parts.join(' + ')}` : `加出来 ${got}（${dump(rows)}）`,
    );
    check(
      `${c.name} · ${lang}：拼出分那一行就是 ${c.sum}`,
      cut >= 0 && Number(rows[cut][1]) === c.sum,
      cut >= 0 ? `${rows[cut][0]}=${rows[cut][1]}` : '（没找到拼出分那一行）',
    );
    // 后半段：拼出分 × 系数 − 惩罚 = 综合分。系数那一行只在真的乘了它的那几档摆（不摆
    // 就当 1），惩罚同理。
    const mult = rows.slice(cut + 1).map(([, v]) => String(v)).find((v) => v.startsWith('×'));
    const pen = rows.slice(cut + 1).map(([, v]) => addend(v)).filter((n) => n !== null && n < 0);
    const want = Math.max(0, Math.round(c.sum * (mult ? Number(mult.slice(1)) : 1)) + pen.reduce((a, b) => a + b, 0));
    check(
      `${c.name} · ${lang}：拼出分 ${mult ? mult + ' ' : ''}${pen.length ? pen.join(' ') + ' ' : ''}= 综合分 ${c.d.totalScore}`,
      sums.length === 2 && Number(sums[1][1]) === c.d.totalScore && want === c.d.totalScore,
      `主数行 ${sums.length} 条：${sums.map(([l, v]) => `${l}=${v}`).join(' / ')}；算出来 ${want}`,
    );
  }
}

// ── 2. 步步为营：分数那两行加起来 = 综合分，步数那本账另算 ────────────────────
//
// 这一档没有「拼出分」那一行：它的综合分就是 被消除×10 + 星星×5（见 puzzleComposite），
// 不乘任何系数。底下那四行是**步数那本账**，不是加数——所以这儿分开数。
{
  const d = base({
    modeKey: 'puzzle',
    puzzleRules: 2,
    score: 0,
    totalScore: 7 * 10 + 4 * 5,
    puzzle: { cleared: 7, stars: 4, spent: 12, scoredMoves: 5, streakRefunds: 2, edgeRefunds: 4, left: 3, peak: 9 },
  });
  for (const lang of LANGS) {
    const rows = runBreakdown(d, lang);
    check(`步步为营 · ${lang}：正好六行（一行讲一件事）`, rows.length === 6, `${rows.length} 行：${dump(rows)}`);
    const score = addend(rows[0][1]) + addend(rows[1][1]);
    check(`步步为营 · ${lang}：分数那两行加起来 = 综合分 ${d.totalScore}`, score === d.totalScore, `加出来 ${score}`);
    check(
      `步步为营 · ${lang}：多退那两行报的是 +2 / +4`,
      addend(rows[3][1]) === 2 && addend(rows[4][1]) === 4,
      `${rows[3][1]} / ${rows[4][1]}`,
    );
    // 「走了几步」「剩几步」右边不摆数：它们报的是一段经过，不是加数。摆了的话上面那
    // 条加法会把它们算进去——而步数和分数不是一回事。
    check(
      `步步为营 · ${lang}：「走了几步」「剩几步」右边是空的`,
      rows[2][1] === '' && rows[5][1] === '',
      `${rows[2][1] || '∅'} / ${rows[5][1] || '∅'}`,
    );
  }
}

// ── 3. 右边那一栏永远只有一个数（或者空的）──────────────────────────────────
//
// 「拆成短行」那件事本身的尺子。从前步步为营最后一行的值是一整句（「连续多退 2 · 消边
// 多退 4 · 剩 3（最多攒到 9）」），法语里七十多个字符：结算页上要么压住左边的抬头、要
// 么被板子裁掉；分享卡按**最宽的一行**缩字号，一句话把整张卡的明细全带小一圈。
//
// 判据写成「不含分隔符、不超过 12 个字符」而不是「能转成数字」：×1.25 和空的也要放行。
{
  const all = [...CASES.map((c) => c.d), base({
    modeKey: 'puzzle',
    puzzle: { cleared: 7, stars: 4, spent: 12, scoredMoves: 5, streakRefunds: 2, edgeRefunds: 4, left: 3, peak: 9 },
    totalScore: 90,
  })];
  let worst = '';
  let bad = 0;
  let counted = 0;
  for (const d of all) {
    for (const lang of LANGS) {
      for (const [, v] of runBreakdown(d, lang)) {
        counted++;
        const t = String(v);
        if (t.length > worst.length) worst = t;
        if (t.includes('·') || t.includes(' ') || t.length > 12) bad++;
      }
    }
  }
  check('右边那一栏全是「一个数」或者空的（没有一整句）', bad === 0 && counted > 40, `量了 ${counted} 个值，最长的是「${worst}」（${worst.length} 字）`);
}

// ── 4. 四种语言的**数**完全一样 ──────────────────────────────────────────────
//
// 只有字该不一样。数不一样只有一个来源：某一种语言里的占位符写错了（`{n}` 写成 `{N}`、
// 抄漏一个 `.replace`），而那种错在屏幕上长得像一行正常的文案。
for (const c of [...CASES, { name: '步步为营', d: base({ modeKey: 'puzzle', totalScore: 90, puzzle: { cleared: 7, stars: 4, spent: 12, scoredMoves: 5, streakRefunds: 2, edgeRefunds: 4, left: 3, peak: 9 } }) }]) {
  const seen = LANGS.map((lang) => runBreakdown(c.d, lang).map(([, v]) => String(v)).join(','));
  check(`${c.name}：四种语言的数一模一样`, new Set(seen).size === 1, seen.join('  ≠  '));
}

// ── 5. 没有一行留着没替换掉的占位符 ─────────────────────────────────────────
//
// `{n}` `{c}` `{m}` `{l}` 这些漏一个，屏幕上就是一行「被消除 {c} 枚 × 10」——不报错、
// 不白屏，而且只在那一种语言里出现，自己试的时候多半碰不到。
{
  const all = [...CASES.map((c) => c.d), base({ modeKey: 'puzzle', totalScore: 90, puzzle: { cleared: 7, stars: 4, spent: 12, scoredMoves: 5, streakRefunds: 2, edgeRefunds: 4, left: 3, peak: 9 } })];
  const left = [];
  let counted = 0;
  for (const d of all) {
    for (const lang of LANGS) {
      for (const [l, v] of runBreakdown(d, lang)) {
        counted++;
        if (/\{\w+\}/.test(l) || /\{\w+\}/.test(String(v))) left.push(`${lang}: ${l} = ${v}`);
      }
    }
  }
  check('没有一行留着 {占位符}', left.length === 0 && counted > 40, left.length ? left.slice(0, 3).join(' / ') : `量了 ${counted} 行`);
}

// ── 6. 尺子：上面那几条真的量到了行 ─────────────────────────────────────────
//
// 「加起来等于拼出分」在**零行**的时候也成立（0 === 0）。所以最后数一遍每一档到底摆了
// 几行，顺带把它们打出来——出问题时一眼看得见是哪一档少了哪一行。
for (const c of CASES) {
  const rows = runBreakdown(c.d, 'zhHans');
  check(`尺子 · ${c.name}：摆了 ${rows.length} 行`, rows.length >= 3, dump(rows));
}

// ── 7. 分享卡和结算页读的是**同一份行** ────────────────────────────────────
//
// 玩家要的那一条是「步步为营清盘那一局，结算页和分享卡的步数相同」。眼下它们确实相同，
// 原因只有一个：两边都走 `runBreakdown`（分享卡那边隔着 `buildShareInfo`）。这一条把那
// 个「只有一个原因」钉住——哪天有人给分享卡另写一份行，这儿当场红，而屏幕上两个数会不
// 声不响地岔开，而且只在**打到清盘**的那种局上岔开。
{
  const all = [...CASES.map((c) => c.d), base({
    modeKey: 'puzzle',
    totalScore: 90,
    reason: '全部翻完',
    puzzle: { cleared: 7, stars: 4, spent: 12, scoredMoves: 5, streakRefunds: 2, edgeRefunds: 4, left: 3, peak: 9 },
  })];
  let same = 0;
  const diff = [];
  for (const d of all) {
    for (const lang of LANGS) {
      const mine = JSON.stringify(runBreakdown(d, lang));
      const card = JSON.stringify(buildShareInfo(d, d.shapeFallback, lang).scoreRows);
      if (mine === card) same++;
      else diff.push(`${d.modeKey || 'base'}/${lang}`);
    }
  }
  check('分享卡那一份行和结算页逐字一样', diff.length === 0 && same > 15, diff.length ? diff.join(' ') : `${same} 组对过`);
}

// ── 8. 清盘那一局：战绩图那一行写着剩几步（第 14 推）──────────────────────────
//
// 「全部消完了 · 剩 N 步」。结算页、分享卡、记录页上是同一张战绩图，那一行字都是
// `buildShareInfo(...).detail`（runRecord 的 runDetailLine），所以量这一处就是量三处。
// 排行榜上同分时就按这个数排，图上看不见的话两行一样的分一前一后像是排错了。
{
  const CLEAR = '全部方块已翻成点面'; // engine/kinetics.ts 的 ALL_FLIPPED_REASON
  const pz = (reason, left) => base({
    modeKey: 'puzzle', totalScore: 90, reason,
    puzzle: { cleared: 7, stars: 4, spent: 12, scoredMoves: 5, streakRefunds: 2, edgeRefunds: 4, left, peak: 9 },
  });
  const line = (d, lang) => buildShareInfo(d, d.shapeFallback, lang).detail;
  const zh = line(pz(CLEAR, 3), 'zhHans');
  check('清盘的局：「全部消完了」后面接「· 剩 3 步」', zh.startsWith('全部消完了 · 剩 3 步'), zh);
  check('英文：3 moves left', line(pz(CLEAR, 3), 'en').includes('· 3 moves left'), line(pz(CLEAR, 3), 'en'));
  check('英文单数：1 move left（不是 1 moves）', line(pz(CLEAR, 1), 'en').includes('· 1 move left'), line(pz(CLEAR, 1), 'en'));
  check('法文：3 coups restants', line(pz(CLEAR, 3), 'fr').includes('· 3 coups restants'), line(pz(CLEAR, 3), 'fr'));
  check('繁体：剩 3 步', line(pz(CLEAR, 3), 'zhHant').includes('· 剩 3 步'), line(pz(CLEAR, 3), 'zhHant'));
  const notClear = line(pz('步数用尽', 0), 'zhHans');
  check('没清盘的局不印剩几步（反向对照）', !notClear.includes('剩'), notClear);
  const notPuzzle = line(base({ reason: CLEAR }), 'zhHans');
  check('别的玩法清盘也不印（只有步步为营有步数这本账）', !notPuzzle.includes('剩'), notPuzzle);
}

console.log(fail ? `\n${fail} 条没过` : '\n全绿');
process.exit(fail ? 1 : 0);

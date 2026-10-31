/**
 * 《侵蚀阶梯》v1.2 §1 的计分：**每翻一枚 +2**。
 *
 *   npx esbuild src/engine/scoring.ts --bundle --format=esm --outfile=/tmp/scoring.mjs
 *   node scripts/check-flip-score.mjs /tmp/scoring.mjs
 *
 * 这一道接替 check-star-score.mjs（那一套《星星跟随色块消除》连同「纯星星组＝枚
 * 数²＋消除」整条路一起退役了，见 §1.1）。不碰 DOM、不碰棋盘：喂给
 * createCascadeStepper 一份假的 CascadeConfig，把这几件单独拿出来量：
 *
 *   ① 一组的分＝2 × **这一拍真的翻了几枚**，不是组里有几枚；
 *   ② 两组共用的那一枚**只算一次**（§1.2「同一步同一枚只算一次」）；
 *   ③ 混合组按翻面枚数算：3 色块 + 1 星星的 1×4 是 +6，不是 +8；
 *   ④ **全是星星的线无事发生**：不得分、不翻面、也不消除；
 *   ⑤ 拆掉的炸弹算一次翻面：commit() 回报的数要比图案自己那几枚多，控制器照这个
 *     差额补 +2/枚（§1.3）；
 *   ⑥ 整线消除那一拍返回 0（那条线上全是星星，一枚都没翻），分走 L²。
 */
const src = process.argv[2];
if (!src) {
  console.error('用法: node scripts/check-flip-score.mjs <打包好的 scoring.mjs>');
  process.exit(2);
}
const { createCascadeStepper, POINTS_PER_FLIP, flipStreakMult, flipStreakDelta, FLIP_STREAK_CAP, flipCoefFor } = await import(src);

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const key = (r, c) => `${r},${c}`;

/** 一块假棋盘：给哪几格就摆正面（色块），没给的都是星星。 */
function board(flavorKeys) {
  const tiles = new Map();
  let nextId = 1;
  const get = (r, c) => {
    const k = key(r, c);
    if (!tiles.has(k)) tiles.set(k, { id: nextId++, face: flavorKeys.has(k) ? 'flavor' : 'dot', dotColor: 1 });
    return tiles.get(k);
  };
  return { tileAt: get, faceOf: (r, c) => get(r, c).face };
}
const cfgOf = (b, findMatches, extra = {}) => ({
  tileAt: b.tileAt,
  findLineBonuses: () => [],
  onLineBonus: () => {},
  resetMaskOnLineBonus: false,
  findMatches,
  ...extra,
});

check('POINTS_PER_FLIP 是 2', POINTS_PER_FLIP === 2, String(POINTS_PER_FLIP));

// ---- ① 一组四枚色块：+8，翻四枚 ----------------------------------------
{
  const cells = [[0, 0], [0, 1], [0, 2], [0, 3]];
  const b = board(new Set(cells.map(([r, c]) => key(r, c))));
  const st = createCascadeStepper(cfgOf(b, () => [{ cells, points: 999, label: '1×4' }]), null, { pattern: 'p', line: 'l' });
  const s = st.next();
  check('四枚色块的 1×4 得 8 分（不是各组 points 之和）', s.points === 8, String(s?.points));
  check('这一拍报了 4 枚要翻', s.flips === 4, String(s?.flips));
  check('commit 回报 4 枚', s.commit() === 4);
  check('四枚都翻成了星星', cells.every(([r, c]) => b.faceOf(r, c) === 'dot'));
}

// ---- ② 两组共用一枚：那一枚只算一次 ------------------------------------
{
  const row = [[0, 0], [0, 1], [0, 2], [0, 3]];
  const col = [[0, 3], [1, 3], [2, 3], [3, 3]];   // 共用 (0,3)
  const all = [...row, ...col];
  const b = board(new Set(all.map(([r, c]) => key(r, c))));
  const st = createCascadeStepper(
    cfgOf(b, () => [{ cells: row, points: 4, label: 'h' }, { cells: col, points: 4, label: 'v' }]),
    null, { pattern: 'p', line: 'l' },
  );
  const s = st.next();
  // 7 枚不同的棋子（4+4−1），所以 14 分，不是 16。
  check('十字路口那一枚只算一次（7 枚 → 14 分）', s.points === 14, String(s?.points));
  check('这一拍报的是 7 枚', s.flips === 7, String(s?.flips));
}

// ---- ③ 混合组按翻面枚数算 ----------------------------------------------
{
  const cells = [[0, 0], [0, 1], [0, 2], [0, 3]];
  const b = board(new Set([key(0, 0), key(0, 1), key(0, 2)]));   // 第四枚是星星
  const st = createCascadeStepper(cfgOf(b, () => [{ cells, points: 4, label: '1×4' }]), null, { pattern: 'p', line: 'l' });
  const s = st.next();
  check('3 色块 + 1 星星的 1×4 得 6 分', s.points === 6, String(s?.points));
  s.commit();
  check('那一枚星星还在原地（没被翻、也没被消）', b.faceOf(0, 3) === 'dot');
}

// ---- ④ 全是星星的线：无事发生 ------------------------------------------
{
  const cells = [[0, 0], [0, 1], [0, 2], [0, 3]];
  const b = board(new Set());     // 一枚色块都没有
  let cleared = 0;
  const st = createCascadeStepper(
    cfgOf(b, () => [{ cells, points: 16, label: '纯星星' }], { clearStars: () => { cleared++; } }),
    null, { pattern: 'p', line: 'l' },
  );
  const s = st.next();
  check('全是星星的线一分不得（这一拍直接没有）', s === null, s ? `还给了 ${s.points} 分` : '');
  check('也没有任何消除', cleared === 0, String(cleared));
}

// ---- ⑤ 拆掉的炸弹算一次翻面 --------------------------------------------
{
  const cells = [[0, 0], [0, 1], [0, 2], [0, 3]];
  const bomb = [9, 9];
  const b = board(new Set([...cells.map(([r, c]) => key(r, c)), key(9, 9)]));
  const st = createCascadeStepper(
    cfgOf(b, () => [{ cells, points: 4, label: '1×4' }], {
      afterCommit: () => { b.tileAt(9, 9).face = 'dot'; return [bomb]; },
    }),
    null, { pattern: 'p', line: 'l' },
  );
  const s = st.next();
  check('报出去的分只算图案自己那四枚（+8）', s.points === 8, String(s?.points));
  const committed = s.commit();
  check('commit 回报 5 枚（4 枚图案 + 1 枚拆掉的炸弹）', committed === 5, String(committed));
  check('差额正是拆掉的那一枚（控制器照它补 +2）', committed - s.flips === 1, String(committed - s.flips));
}

// ---- ⑥ 整线消除：L² 分、零翻面 ------------------------------------------
{
  const line = [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]];
  const b = board(new Set());
  let once = false;
  const st = createCascadeStepper(
    {
      tileAt: b.tileAt,
      findLineBonuses: () => (once ? [] : ((once = true), [line])),
      onLineBonus: () => {},
      resetMaskOnLineBonus: false,
      findMatches: () => [],
    },
    null, { pattern: 'p', line: 'l' },
  );
  const s = st.next();
  check('五枚的整线得 25 分（星星数²）', s.points === 25, String(s?.points));
  check('整线那一拍一枚都没翻', s.flips === 0 && s.commit() === 0);
}

// ── 无限反转的加分气泡：印的倍率 × 分 = 真正加上去的分（第 14 推）──────────────
//
// 气泡上那个「×N」原先自己算 `1.5 ** 连击数`，没套 FLIP_STREAK_CAP：连击过了封顶那一次，加分
// 早就封顶了，气泡上的倍率还在往上翻。现在两处都从 flipStreakMult 拿；这儿把连击 0–20
// 挨个对一遍（方案点名的那个区间，封顶前后都有）。封顶 10-31 方案推14 Z-B06 起从 10 次改成 5 次（约 7.6 倍）。
{
  check('（尺子）封顶那一档是 5', FLIP_STREAK_CAP === 5, String(FLIP_STREAK_CAP));
  const bad = [];
  for (let chain = 0; chain <= 20; chain++) {
    for (const points of [1, 2, 4, 6, 9, 12, 16, 25]) {
      const shown = Math.round(points * flipStreakMult(chain));
      const added = flipStreakDelta(points, chain);
      if (shown !== added) bad.push(`连击 ${chain} · ${points} 分：气泡算 ${shown}，实际 ${added}`);
    }
  }
  check('连击 0–20：气泡倍率 × 分 = 实际加分', bad.length === 0, bad.slice(0, 3).join(' / ') || '168 组对上');
  check(`过了封顶，倍率不再往上翻（连击 20 和 ${FLIP_STREAK_CAP} 一样）`, flipStreakMult(20) === flipStreakMult(FLIP_STREAK_CAP),
    `${flipStreakMult(FLIP_STREAK_CAP)} / ${flipStreakMult(20)}`);
  check(`封顶之前照常往上翻（连击 ${FLIP_STREAK_CAP - 1} < 连击 ${FLIP_STREAK_CAP}）`, flipStreakMult(FLIP_STREAK_CAP - 1) < flipStreakMult(FLIP_STREAK_CAP));
  check('封顶那一档约 7.6 倍（1.5⁵）', flipStreakMult(FLIP_STREAK_CAP).toFixed(1) === '7.6', String(flipStreakMult(FLIP_STREAK_CAP)));

  // 气泡那一处真的在用 flipStreakMult（它在 gameController 的闭包里，单独叫不出来）。
  const { readFileSync } = await import('node:fs');
  const gc = readFileSync(new URL('../src/engine/gameController.ts', import.meta.url), 'utf8');
  check('加分气泡的倍率从 flipStreakMult 拿（不再自己算 1.5 的几次方）',
    /const shownMult = hooks\.flip \? flipStreakMult\(flipChain\)/.test(gc) && !/FLIP_STREAK_BASE \*\* /.test(gc));
}

// ── 反转系数（10-31 方案推14 Z-B06，V15）：结算时拼出得分 × 系数 = 综合得分 ─────────────────────────
//
// 方块 ×6、小球 ×2.5（认不出的给 1）；结算页摆「拼出得分 → 反转系数 → 综合得分」三行，乘起来对得上；简繁英 ×6.00、法文
// ×6,00（Z-B08）；老档（没有 flipCoef）不摆那一行。结算页那几行在 runRecord.ts，这儿当场打一份包来量。
{
  check('反转系数：方块 6、小球 2.5', flipCoefFor('square') === 6 && flipCoefFor('circle') === 2.5, `${flipCoefFor('square')} / ${flipCoefFor('circle')}`);
  check('反转系数：认不出的棋盘给 1（不会把分乘成 0 或 NaN）', flipCoefFor('triangleBig') === 1 && flipCoefFor('nope') === 1);
  const { build } = await import('esbuild');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL, fileURLToPath } = await import('node:url');
  const dir = mkdtempSync(join(tmpdir(), 'flip-score-'));
  const out = join(dir, 'rr.mjs');
  await build({ entryPoints: [fileURLToPath(new URL('../src/engine/runRecord.ts', import.meta.url))], bundle: true, format: 'esm', outfile: out, logLevel: 'silent' });
  const { runBreakdown } = await import(pathToFileURL(out).href);
  rmSync(dir, { recursive: true, force: true });
  const run = {
    shapeId: 'square', shapeFallback: '方块', modeKey: 'flip', flipRules: 2, score: 120, flipCoef: 6, totalScore: 720,
    patternPoints: 80, comboBonusPoints: 40, linePoints: 0, lines: 0, flips: 30, moves: 40, elapsedSec: 100,
    ratePercent: 50, bonusMult: 1, best: 0, reason: '时间到', neverFlipped: 0, unflippedScale: 1, timeMult: 1,
    extraPenalty: 0, extraPenaltyReason: '', hazardEnd: false, at: 0,
  };
  const LABEL = {
    zhHans: ['拼出得分', '反转系数', '综合得分'], zhHant: ['拼出得分', '反轉係數', '綜合得分'],
    en: ['Build score', 'Flip multiplier', 'Final score'], fr: ['Score de jeu', 'Coefficient de retournement', 'Score final'],
  };
  for (const [lang, [built, coef, total]] of Object.entries(LABEL)) {
    const rows = runBreakdown(run, lang);
    const at = (l) => rows.findIndex(([x]) => x === l);
    const want = lang === 'fr' ? '×6,00' : '×6.00';
    check(`${lang}：结算页摆「${built} → ${coef} → ${total}」，顺序对、${want}、乘起来 = 综合分`,
      at(built) >= 0 && at(coef) === at(built) + 1 && at(total) === at(coef) + 1 && rows[at(coef)][1] === want &&
        Number(rows[at(built)][1]) * Number(rows[at(coef)][1].slice(1).replace(',', '.')) === Number(rows[at(total)][1]),
      rows.map(([l, v]) => `${l}=${v}`).join(' | '));
  }
  const legacy = { ...run, totalScore: 120 };
  delete legacy.flipCoef;
  const old = runBreakdown(legacy, 'zhHans');
  check('老档（没有 flipCoef）不摆反转系数那一行', !old.some(([l]) => l === '反转系数'), old.map(([l, v]) => `${l}=${v}`).join(' | '));
}

console.log(fail ? `\n${fail} 条没过` : '\n全过');
process.exit(fail ? 1 : 0);

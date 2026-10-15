/**
 * 交卷这一路的几道闸：两处对得上、那份 data 不许过大、一小时 300 局、**对一遍账**（10-11 方案 A-3）。
 *
 *   node scripts/check-scores-guard.mjs
 *
 * 不起服务器、不开浏览器：直接叫 api/scores.js 的 handler，库用进程内那一份。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么
 *
 * 这个接口要认得出你是谁（账号 + 令牌）。它**核不了一个分数是不是真打出来的**（那要服务器拿种子
 * 加操作记录重放一遍，不在这一批），能便宜守住的是下面几件事：
 *
 * ① **一局一个数。** 榜上那一行是 `score` 写的，重建是照存档里的 `run.score` 重算的，
 *    而玩家自己那一页画的是 `data.totalScore`。两处对不上，库里就留下两份互相打脸的
 *    记录——「榜上写 999999，点开这一局的战绩图写 300」，而谁都说不出哪个是真的。真客
 *    户端本来就是从 `data` 算出那两个字段的，所以对不上的只有手搓的请求。
 *
 * ② **那份 data 不许大过 DATA_MAX_CHARS。** 它会被原样塞进存档，而存档是一份整体读写
 *    的 JSON：六十局摞在一起，`mine` 每次整份读出来，`rebuild` 要把**全站每个人**的那
 *    一份都读一遍。谁往里塞一兆字节，塞的是那个账号从此读不动的存档，而且一次重建就
 *    能把整站拖垮。
 *
 * ③ **一小时 300 局。** 人做不到（最短的那几档玩法本身就是 100 秒），所以它拦不住任何
 *    一个真玩家，只拦住「拿脚本一直往这个接口灌」——而这条路每一局要走一把锁、一次整
 *    份 stats、一次整份存档、二十几次榜上写入。
 *
 * ④ **对一遍账**（10-11 方案 A-3，api/_maxscore.js 的 vetRun）。线上真出过：一个免费账号交
 *    `999999999`、明细互相矛盾（翻了 3 枚、拼出分却是九位数），照样 200、上了总榜第一。现在服务器
 *    拿自己的表按玩法分档把明细重算一遍：对不上、或者超出这副棋盘在规则下打得出的最大值，回 400
 *    `implausible`，存档、累计、榜、今日榜一样都不进；客户端收到这一句不重报。缺字段的旧客户端照收
 *    进存档、不上榜（`legacy`）。⑤–⑪ 那几节量这件事，**正反两面都量**：该拒的每一条各拒在哪一条上
 *    （日志里那个 `why`），真打得出来的边角局（炸弹收场扣成 0 分、无限反转一组 4 枚、老虎机高分、
 *    机器人真打出来的每一局）一局都不许误拒。服务器那几张表是手抄的，⑩ 当场从源码推一遍对上。
 *
 * ⑤ **超过十亿只记日志**：对得上账的局到不了那么高（最宽的无限反转一局也就一千多万），所以这一句如
 *    今只剩缺字段的旧局会碰到。日志里**不许有邮箱**（它就是账号 id）。
 */
process.env.ALLOW_MEMORY_STORE = '1';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const { readFileSync } = await import('node:fs');
const { default: handler } = await import('../api/scores.js');
const accounts = await import('../api/_accounts.js');
const { fillRun } = await import('./lib/fakeRun.mjs');
const { deriveFacts } = await import('./lib/boardFacts.mjs');
const store = await import('../api/_store.js');
const { build } = await import('esbuild');
const { fileURLToPath } = await import('node:url');

/** 现行计分规则版本，从 src 现读（服务端手抄了一份，check-scores 在钉它们一致）。 */
const SCORING_V = (() => {
  const src = readFileSync(new URL('../src/engine/scoring.ts', import.meta.url), 'utf8');
  const m = /export const SCORING_RULES_VERSION = '([^']+)'/.exec(src);
  if (!m) throw new Error('读不到 SCORING_RULES_VERSION');
  return m[1];
})();
/** 两个上限，从 api/scores.js 现读——别在这儿抄第二遍。 */
const constOf = (name) => {
  const src = readFileSync(new URL('../api/scores.js', import.meta.url), 'utf8');
  const m = new RegExp(`const ${name} = ([0-9_]+);`).exec(src);
  if (!m) throw new Error(`读不到 ${name}`);
  return Number(m[1].replace(/_/g, ''));
};
const PUSHES_PER_HOUR = constOf('PUSHES_PER_HOUR');
const DATA_MAX_CHARS = constOf('DATA_MAX_CHARS');
// 分数上限 10-09 补充方案 7-6 起挪进了 api/_maxscore.js（排行榜和小屋共用一个数），scores.js 里只剩一句
// import——照旧去源码里找 `const MAX_SCORE =` 就读不到了。它本来就是一个模块，直接拿。
const { MAX_SCORE } = await import('../api/_maxscore.js');

async function call(body) {
  const res = {
    code: 200,
    payload: null,
    status(c) { res.code = c; return res; },
    setHeader() { return res; },
    end(text) {
      try { res.payload = JSON.parse(text); } catch { res.payload = text; }
      return res;
    },
  };
  await handler({ method: 'POST', body }, res);
  return { status: res.code, payload: res.payload };
}
async function makePlayer(email) {
  const account = accounts.newAccount('secret', 'code');
  account.until = Date.now() + 30 * 24 * 3600e3;
  await accounts.saveAccount(email, account);
  return { email, token: account.token };
}
/**
 * 一份像样的存档：真客户端报的就是这个形状（engine/runRecord.ts 的 RunData）。计分那几位（翻了几枚、拼
 * 出分怎么拆、步数系数……）由夹具拼一份对得上账的（scripts/lib/fakeRun.mjs），别的照真客户端的样子填。
 */
const runData = (mode, score, extra = {}) => ({
  ...fillRun(mode, score, {}),
  shapeFallback: '方块',
  ratePercent: 80,
  bonusMult: 1.8,
  best: score,
  reason: 'cleared',
  neverFlipped: 3,
  unflippedScale: 0.95,
  timeMult: 1.2,
  extraPenalty: 0,
  extraPenaltyReason: '',
  rules: SCORING_V,
  ...extra,
});
const push = (who, runId, mode, score, dataExtra = {}, over = {}) =>
  call({ action: 'push', ...who, runId, mode, score, data: runData(mode, score, dataExtra), ...over });

/**
 * ⑤ 起那几节用的：一局对得上账的明细（`given` 是玩法那几位：modeKey、slot、第几版规则），`over` 改坏
 * 其中几样。`totalScore` 照 `score` 参数，交的时候顶层的 score 也照它（两处一个数，免得撞上 ① 那道闸）。
 */
const vetData = (mode, score, given = {}, over = {}) => ({ ...runData(mode, score), ...fillRun(mode, score, given), rules: SCORING_V, ...over });
/** 步步为营（现行第 3 版）：消除几枚、几颗星照给的来，综合分照它们算。`rules` 给 2 就是还开着旧页面的人交的第 2 版局。 */
const pz2 = (mode, score, tally, rules = 3) => {
  const d = vetData(mode, score, { modeKey: 'puzzle', puzzleRules: rules });
  const flips = tally.cleared + tally.stars;
  return { ...d, flips, patternPoints: 2 * flips, score: 2 * flips, puzzle: { ...d.puzzle, ...tally } };
};
/** 跑一段，把这一段里 console.warn 写的每一行收下来（服务器拒一局时记的那一行带着 why）。 */
async function withWarn(fn) {
  const lines = [];
  const realWarn = console.warn;
  console.warn = (...a) => lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  try {
    return { out: await fn(), lines };
  } finally {
    console.warn = realWarn;
  }
}
/** 交一局，连同服务器拒它时日志里写的那个 why。 */
async function vetPush(who, runId, mode, data) {
  const { out, lines } = await withWarn(() => call({ action: 'push', ...who, runId, mode, score: data.totalScore, data }));
  const why = /"why":"([^"]+)"/.exec(lines.find((l) => l.includes('implausible')) || '')?.[1];
  return { ...out, why, lines };
}
const sortKeys = (o) => Object.fromEntries(Object.entries(o || {}).sort(([a], [b]) => (a < b ? -1 : 1)));

// ---- ① 两处对得上才收 ---------------------------------------------------
{
  const A = await makePlayer('guard-a@example.com');
  const ok = await push(A, 'a1', 'square', 500);
  check('① 量程：对得上的照收', ok.status === 200 && ok.payload?.ok === true && ok.payload.total === 500,
    JSON.stringify(ok.payload));

  // 榜上报 999999，存档里写 300：一局两个数。
  const liar = await call({
    action: 'push', ...A, runId: 'a2', mode: 'square', score: 999999, data: runData('square', 300),
  });
  check('① 分数对不上：400 mismatch', liar.status === 400 && liar.payload?.error === 'mismatch',
    `${liar.status} ${JSON.stringify(liar.payload)}`);

  const wrongBoard = await call({
    action: 'push', ...A, runId: 'a3', mode: 'circle', score: 500, data: runData('square', 500),
  });
  check('① 棋盘对不上：400 mismatch', wrongBoard.status === 400 && wrongBoard.payload?.error === 'mismatch',
    `${wrongBoard.status} ${JSON.stringify(wrongBoard.payload)}`);

  const mine = await call({ action: 'mine', ...A });
  check('① 被拒的那两局，一局都没进库', mine.payload?.runs === 1 && mine.payload.archive.length === 1,
    `runs=${mine.payload?.runs} 存档=${mine.payload?.archive?.length}`);
  check('① 也没写进榜（最高还是 500）', mine.payload?.best?.['square:base'] === 500,
    JSON.stringify(mine.payload?.best));
}

// ---- ② data 得长得像一份记录 -------------------------------------------
{
  const B = await makePlayer('guard-b@example.com');
  for (const [what, data] of [
    ['一串字', 'hello'],
    ['一个数', 42],
    ['一个数组', [1, 2, 3]],
  ]) {
    const r = await call({ action: 'push', ...B, runId: 'b-' + what, mode: 'square', score: 10, data });
    check(`② data 是${what}：400 data`, r.status === 400 && r.payload?.error === 'data',
      `${r.status} ${JSON.stringify(r.payload)}`);
  }
  // 压根没带 data 的走的是另一条路：那是在途的旧客户端，照旧温和地回 200 + stored:false
  // （给 4xx 只会让他看见一句「上传失败」，而那一局本来就不该入榜）。
  const none = await call({ action: 'push', ...B, runId: 'b-none', mode: 'square', score: 10 });
  check('② 压根没带 data：200 + stored:false（不是报错）',
    none.status === 200 && none.payload?.stored === false && none.payload?.reason === 'rules',
    `${none.status} ${JSON.stringify(none.payload)}`);
}

// ---- ③ 那份 data 不许过大 ----------------------------------------------
{
  const C = await makePlayer('guard-c@example.com');
  // 量程：一份**填满了的**真 RunData 离上限还很远。这一条是防「哪天 RunData 长到贴着
  // 上限了，门先红，而不是线上先炸」。
  const real = JSON.stringify(runData('triangleBig', 123456, {
    puzzle: { cleared: 40, stars: 12, spent: 300, scoredMoves: 120, streakRefunds: 30, edgeRefunds: 12, left: 8, peak: 55 },
    room: true, slot: true, targetId: 'squarePlus5', bombRules: 3, flipRules: 2, puzzleRules: 2,
    shapeFallback: '进阶三角（天才特供）', extraPenaltyReason: '炸弹爆了：这一局按爆炸收场，扣 10 分',
  }));
  check(`③ 量程：填满了的一份 RunData 是 ${real.length} 字，上限 ${DATA_MAX_CHARS}`,
    real.length * 3 < DATA_MAX_CHARS, `${real.length} / ${DATA_MAX_CHARS}`);

  const fat = await call({
    action: 'push', ...C, runId: 'c1', mode: 'square', score: 10,
    data: runData('square', 10, { 塞的: 'x'.repeat(DATA_MAX_CHARS) }),
  });
  check('③ 塞大了：400 tooBig', fat.status === 400 && fat.payload?.error === 'tooBig',
    `${fat.status} ${JSON.stringify(fat.payload)}`);
  const mine = await call({ action: 'mine', ...C });
  check('③ 那一局没进存档', mine.payload?.archive?.length === 0, String(mine.payload?.archive?.length));
  // 刚好压在线下的照收（上限是条线，不是「越小越好」）。
  const justUnder = await call({
    action: 'push', ...C, runId: 'c2', mode: 'square', score: 10,
    data: runData('square', 10, { 塞的: 'x'.repeat(DATA_MAX_CHARS - real.length - 40) }),
  });
  check('③ 刚好在线下的照收', justUnder.status === 200 && justUnder.payload?.ok === true,
    `${justUnder.status} ${JSON.stringify(justUnder.payload)}`);
}

// ---- ④ 一小时 300 局，第 301 局回 429 ----------------------------------
{
  const D = await makePlayer('guard-d@example.com');
  let firstBad = 0;
  for (let i = 1; i <= PUSHES_PER_HOUR; i++) {
    const r = await push(D, 'd' + i, 'square', 10);
    if (r.status !== 200 && !firstBad) firstBad = i;
  }
  check(`④ 头 ${PUSHES_PER_HOUR} 局一局都没被挡`, firstBad === 0, firstBad ? `第 ${firstBad} 局就被挡了` : '');
  const over = await push(D, 'd-over', 'square', 10);
  check('④ 再来一局：429 tooMany', over.status === 429 && over.payload?.error === 'tooMany',
    `${over.status} ${JSON.stringify(over.payload)}`);
  const mine = await call({ action: 'mine', ...D });
  check('④ 被挡那一局没进库', mine.payload?.runs === PUSHES_PER_HOUR, String(mine.payload?.runs));
  // 键是账号，不是 IP：别人的额度不受影响。（反过来也是这一条的意思——这个人换个
  // IP 也绕不过去，而那一点在这台门里本来就成立：它从头到尾没发过 IP 头。）
  const E = await makePlayer('guard-e@example.com');
  const other = await push(E, 'e1', 'square', 10);
  check('④ 另一个账号照交不误（额度按账号算）', other.status === 200 && other.payload?.ok === true,
    `${other.status} ${JSON.stringify(other.payload)}`);
}

// ---- ⑤ 超过十亿：只记日志，而且日志里没有邮箱 ----------------------------
//
// 对得上账的局到不了十亿（最宽的无限反转一局也就一千多万，见 ⑥ 和 api/_maxscore.js），所以这一句如今
// 只有缺字段的旧客户端碰得到：那一局不对账（明细都没有，什么都对不了），照收进存档、不上榜，报上来
// 的数照旧被削到十亿以内再存（累计不会溢出），日志记一行。
{
  const F = await makePlayer('guard-f@example.com');
  const { out: r, lines } = await withWarn(() => call({
    action: 'push', ...F, runId: 'f1', mode: 'square', score: MAX_SCORE * 2,
    data: { shapeId: 'square', modeKey: 'base', totalScore: MAX_SCORE * 2, rules: SCORING_V },
  }));
  check('⑤ 缺字段的旧局报二十亿：照收进存档、不上榜（200 stored:false legacy）',
    r.status === 200 && r.payload?.stored === false && r.payload?.reason === 'legacy', `${r.status} ${JSON.stringify(r.payload)}`);
  const mine = await call({ action: 'mine', ...F });
  check('⑤ 存下来的数被削到上限（累计十亿，不是二十亿），best 里没有它',
    mine.payload?.total === MAX_SCORE && Object.keys(mine.payload?.best || {}).length === 0,
    `total=${mine.payload?.total} best=${JSON.stringify(mine.payload?.best)}`);
  check('⑤ 记了一行日志', lines.length === 1, JSON.stringify(lines));
  check('⑤ 那一行里有 runId 和那个离谱的数', lines[0]?.includes('f1') && lines[0]?.includes(String(MAX_SCORE * 2)),
    String(lines[0]));
  check('⑤ 那一行里没有邮箱（账号 id 就是邮箱）',
    !lines[0]?.includes('guard-f@example.com') && !lines[0]?.includes('@'), String(lines[0]));

  // 量程：没超上限的时候一个字都不写（不然日志里全是噪音，真有人超了也看不见）。
  const quiet = await withWarn(() => push(F, 'f2', 'square', 1000));
  check('⑤ 量程：正常的一局不记日志', quiet.lines.length === 0, JSON.stringify(quiet.lines));
}

// ---- ⑥ 对一遍账：每一条改坏一样，看它拒在哪一条上（10-11 方案 A-3）---------------
//
// 只看「回了 400」不够：改坏 A 被 B 拦下来也是 400，B 哪天松了、A 那一道其实一直是虚的，这道门也看
// 不出来。所以每一条只改坏一样，量日志里那个 `why`（api/_maxscore.js 的 vetRun 回的那个短词）。
{
  const G = await makePlayer('guard-g@example.com');
  const sq = (over) => vetData('square', 300, {}, over); // 翻 36 枚（72）＋ 削 7 条线（228），系数 1
  const fl = (score, over) => vetData('square', score, { modeKey: 'flip', flipRules: 2 }, over);
  const sl = (score, over) => vetData('square', score, { slot: true }, over);
  const pz = (score, puzzle) => {
    const d = vetData('square', score, { modeKey: 'puzzle', puzzleRules: 3 });
    return { ...d, puzzle: { ...d.puzzle, ...puzzle } };
  };
  const CASES = [
    // 线上真出过的那一局：免费账号交九位数，明细里只翻了 3 枚。
    ['线上那一局：翻了 3 枚、拼出分却是九位数', vetData('square', 999999999, {}, { flips: 3, patternPoints: 6, linePoints: 228, lines: 7 }), 'split'],
    ['拼出分拆不开（图案 + 削线 + 连击 ≠ 拼出分）', sq({ patternPoints: 74 }), 'split'],
    ['某一项是负的', sq({ comboBonusPoints: -10, linePoints: 238 }), 'negative'],
    ['翻面数不是整数', sq({ flips: 35.5, patternPoints: 71, linePoints: 229 }), 'counts'],
    ['拆掉的炸弹比翻面还多（拆除本来就算在翻面里）', sq({ defused: 37 }), 'flips'],
    ['翻面比全盘还多（方块 36 枚，一枚只翻一次）', sq({ flips: 40, patternPoints: 80, linePoints: 220 }), 'flips'],
    ['报一个 999 枚的全盘', sq({ boardTiles: 999 }), 'tiles'],
    ['清掉的比全盘还多', sq({ cleared: 37 }), 'tiles'],
    ['削线分超过「条数 × 最长那条线的平方」', sq({ lines: 1 }), 'lines'],
    ['乘系数那几档带着连击分', sq({ comboBonusPoints: 10, linePoints: 218 }), 'pattern'],
    ['图案分不等于「每枚 2 分」', sq({ patternPoints: 70, linePoints: 230 }), 'pattern'],
    ['步数系数和服务器自己算的对不上', sq({ stepCoef: 2 }), 'coef'],
    ['综合分不等于「拼出分 × 系数」', sq({ cleared: 36, moves: 30, stepCoef: 3.24 }), 'total'],
    ['不是炸弹那几档，却按「炸弹相连」扣了 100', sq({ hazardEnd: true, totalScore: 200 }), 'total'],
    // 自洽的假分：步数 1、全清、每条线都削满，方块到顶是 (2N + d·N·Lmax)·par² = 1,469,664。多一条线的分就过界。
    ['超出方块的上界 1,469,664（自己对得上账的假分）',
      vetData('square', 505 * 2916, {}, { flips: 36, patternPoints: 72, linePoints: 433, lines: 13, score: 505, cleared: 36, moves: 1, stepCoef: 2916 }), 'cap'],
    ['无限反转带着削线分（这一档不消线）', fl(1000, { linePoints: 10, patternPoints: 390, lines: 1 }), 'flipSplit'],
    ['无限反转乘了步数系数', fl(1000, { stepCoef: 2 }), 'flipSplit'],
    ['无限反转用时超过 100 + 5 秒', fl(1000, { elapsedSec: 106 }), 'flipTime'],
    ['无限反转一秒走了四步多', fl(1000, { moves: 401 }), 'flipMoves'],
    ['无限反转一步的分超过上界（每一拍都按封顶倍率算也到不了）', fl(50000, { moves: 1, elapsedSec: 1 }), 'flipCap'],
    ['老虎机带着连击分', sl(5000, { comboBonusPoints: 10, patternPoints: 4990 }), 'slotSplit'],
    ['老虎机的图案分比「每枚 2 分」还少', sl(5000, { patternPoints: 60, linePoints: 4940, lines: 200 }), 'slotSplit'],
    ['老虎机超出方块的上界 29,304', sl(29305), 'slotCap'],
    ['步步为营：综合分不等于「消除 × 10 + 星星 × 5」', pz(240, { cleared: 23 }), 'puzzleTotal'],
    ['步步为营：消除加星星比全盘还多', pz(350, { cleared: 30, stars: 10 }), 'puzzleTally'],
    // 第 3 版步数只降不升（10-15 补充 S9）：方块起手 22，剩 23 只可能是手搓的。
    ['步步为营第 3 版：剩 23 步（方块起手才 22）', pz(240, { cleared: 20, stars: 8, left: 23 }), 'puzzleLeft'],
  ];
  let n = 0;
  for (const [name, data, why] of CASES) {
    const r = await vetPush(G, `g${++n}`, 'square', data);
    check(`⑥ ${name}：400 implausible，拒在「${why}」`,
      r.status === 400 && r.payload?.error === 'implausible' && r.why === why,
      `${r.status} ${JSON.stringify(r.payload)} why=${r.why}`);
  }
  const mine = await call({ action: 'mine', ...G });
  check(`⑥ 被拒的那 ${CASES.length} 局：存档、局数、累计、最高分一样都没进`,
    mine.payload?.runs === 0 && mine.payload?.archive?.length === 0 && mine.payload?.total === 0 &&
      Object.keys(mine.payload?.best || {}).length === 0,
    `runs=${mine.payload?.runs} 存档=${mine.payload?.archive?.length} total=${mine.payload?.total} best=${JSON.stringify(mine.payload?.best)}`);
  check('⑥ 榜上也没有他（总榜、方块基础榜）',
    (await store.zscore('lb:total', G.email)) === null && (await store.zscore('lb:square:base', G.email)) === null);

  // 尺子：上面那几道上界是「到顶」，不是「差一点」——正好压在线上的照收，不然真打满的那一局会被拒。
  const G2 = await makePlayer('guard-g2@example.com');
  const edge = [
    ['方块：正好 1,469,664（步数 1、全清、每条线都削满）',
      vetData('square', 504 * 2916, {}, { flips: 36, patternPoints: 72, linePoints: 432, lines: 12, score: 504, cleared: 36, moves: 1, stepCoef: 2916 })],
    ['老虎机（方块）：正好 29,304', sl(29304)],
    ['老虎机（小球）：正好 11,564', vetData('circle', 11564, { slot: true })],
    ['对得上账的一局（量程：不改坏就照收）', sq({})],
  ];
  for (const [name, data] of edge) {
    const r = await vetPush(G2, `edge-${name.length}-${data.totalScore}`, data.shapeId, data);
    check(`⑥（尺子）${name}：照收`, r.status === 200 && r.payload?.ok === true && r.payload?.stored !== false,
      `${r.status} ${JSON.stringify(r.payload)} why=${r.why}`);
  }
}

// ---- ⑦ 真打得出来的边角局：一局都不许误拒 --------------------------------
//
// 第一版的上界在这几种局上会误拒（方案 A-3 的更正）：炸弹收场扣 100 是 max(0, …) 兜着的，低分局扣完是
// 0；炸弹一枚枚拆掉也算翻面；无限反转按组给分、能翻回来；步步为营不乘系数。
{
  const H = await makePlayer('guard-h@example.com');
  const bomb = { modeKey: 'bomb', bombRules: 3 };
  const fine = [
    ['炸弹相连收场、拼出分不到 100：扣完是 0', 'square:bomb3',
      vetData('square', 0, bomb, { flips: 20, patternPoints: 40, linePoints: 0, lines: 0, score: 40, hazardEnd: true }), 0],
    ['炸弹相连收场、拼出分 150：扣完是 50', 'square:bomb3',
      vetData('square', 50, bomb, { flips: 36, patternPoints: 72, linePoints: 78, lines: 3, score: 150, hazardEnd: true }), 50],
    ['定时炸弹相连收场（小球）', 'circle:bomb3',
      vetData('circle', 20, { modeKey: 'bombTimed', bombRules: 3 }, { flips: 28, patternPoints: 56, linePoints: 64, lines: 2, score: 120, hazardEnd: true }), 20],
    ['六颗炸弹全拆掉的一局（拆除算在翻面里）', 'square:bomb3',
      vetData('square', 180, bomb, { flips: 36, defused: 6, patternPoints: 72, linePoints: 108, lines: 3, score: 180, cleared: 12, moves: 40 }), 180],
    ['进阶炸弹（菱形方块）', 'squareDiamond', vetData('squareDiamond', 400, bomb), 400],
    ['无限反转：一组 4 枚、一拍', 'square:flip2',
      vetData('square', 4, { modeKey: 'flip', flipRules: 2 }, { flips: 4, patternPoints: 4, comboBonusPoints: 0, score: 4, moves: 1, elapsedSec: 3 }), 4],
    ['无限反转（小球）：连击把分抬得很高', 'circle:flip2', vetData('circle', 120000, { modeKey: 'flip', flipRules: 2 }), 120000],
    ['步步为营：消除 20、星星 8', 'square:puzzle3', pz2('square', 240, { cleared: 20, stars: 8 }), 240],
    ['步步为营（小球）：一盘全消掉、起手 15 步一步没空走', 'circle:puzzle3', pz2('circle', 280, { cleared: 28, stars: 0, left: 15 }), 280],
    // 还开着旧页面的人交的第 2 版局：那一版有退步，剩多少都可能——照收，落归档榜 puzzle2（10-15 补充 S9）。
    ['步步为营第 2 版（旧页面）：剩 50 步照收、落归档榜', 'square:puzzle2', pz2('square', 240, { cleared: 20, stars: 8, left: 50 }, 2), 240],
    ['计时（步数系数抬到 4 倍）', 'square:timed',
      vetData('square', 300 * 4, { modeKey: 'timed' }, { flips: 36, patternPoints: 72, linePoints: 228, lines: 7, score: 300, cleared: 36, moves: 27, stepCoef: 4 }), 1200],
    ['三角 54：系数 1 的一局', 'triangleBig', vetData('triangleBig', 2000), 2000],
  ];
  let n = 0;
  for (const [name, boardId, data, onBoard] of fine) {
    const r = await vetPush(H, `h${++n}`, data.shapeId, data);
    check(`⑦ ${name}：照收`, r.status === 200 && r.payload?.ok === true && r.payload?.stored !== false,
      `${r.status} ${JSON.stringify(r.payload)} why=${r.why}`);
    const z = await store.zscore('lb:' + boardId, H.email);
    const shown = /:puzzle\d*$/.test(boardId) && z !== null ? Math.floor(z / 1000) : z;
    check(`⑦ ${name}：${onBoard > 0 ? `榜上是 ${onBoard}` : '0 分不上榜（存档里有）'}`,
      onBoard > 0 ? shown === onBoard : z === null, `${boardId} → ${z}`);
  }
}

// ---- ⑧ 缺字段的旧客户端：照收进存档、不上榜 ------------------------------
//
// 在途的旧客户端（规则版本是现行的，可明细不全）不是他的错，也不能拿它上榜——明细都没有，什么都对不
// 了。回 200 `stored:false`，和规则版本对不上那一支同一个样子；存档那一条带 `legacy: true`，重建时也不计入。
{
  const K = await makePlayer('guard-k@example.com');
  const r = await call({ action: 'push', ...K, runId: 'k1', mode: 'square', score: 300,
    data: { shapeId: 'square', modeKey: 'base', totalScore: 300, rules: SCORING_V } });
  check('⑧ 缺字段：200 stored:false reason legacy（不是 400）',
    r.status === 200 && r.payload?.stored === false && r.payload?.reason === 'legacy', `${r.status} ${JSON.stringify(r.payload)}`);
  const mine = await call({ action: 'mine', ...K });
  check('⑧ 进了存档、带着 legacy 记号，累计和局数照记',
    mine.payload?.archive?.[0]?.runId === 'k1' && mine.payload.archive[0].legacy === true && mine.payload.runs === 1 && mine.payload.total === 300,
    JSON.stringify(mine.payload?.archive?.[0]));
  check('⑧ 不上榜：best 里没有、方块基础榜和总榜上都没有',
    Object.keys(mine.payload?.best || {}).length === 0 &&
      (await store.zscore('lb:square:base', K.email)) === null && (await store.zscore('lb:total', K.email)) === null,
    JSON.stringify(mine.payload?.best));
}

// ---- ⑨ 被拒的那一局也不进今日榜 ----------------------------------------------
//
// 每日挑战那一局对账在今日榜之前：明细对不上的，今日榜一样不进（存档、累计、榜那一半 ⑥ 量过了）。
// 「今天」是哪个玩法按日子轮换，所以这一节照今天那一行的棋盘和玩法拼——150 分在每一种玩法下都打得出来
// （步步为营只能是 5 的倍数、不超过全盘 × 10）。
{
  const SC = await import('../api/_seedcode.js');
  const MODE_KEY = { base: 'base', timed: 'timed', bomb: 'bomb', bombTimed: 'bombTimed', bombAdv: 'bomb', slot: 'base', flip: 'flip', puzzle: 'puzzle' };
  const today = SC.dayIndexOf(Date.now());
  const v = SC.VARIANTS[SC.dailyVariant(today)];
  const given = {
    modeKey: MODE_KEY[v.mode],
    ...(v.mode === 'slot' ? { slot: true } : {}),
    ...(v.mode === 'puzzle' ? { puzzleRules: 3 } : {}),
    ...(v.mode === 'flip' ? { flipRules: 2 } : {}),
    ...(v.mode.startsWith('bomb') ? { bombRules: 3 } : {}),
  };
  const daily = (over = {}) => ({
    ...vetData(v.board, 150, given),
    seed: SC.dailySeed(today), seedSource: 'daily', daily: SC.dayKey(today), ...over,
  });
  const L = await makePlayer('guard-l@example.com');
  const good = daily();
  const bad = await vetPush(L, 'l1', v.board, { ...good, patternPoints: good.patternPoints + 2 });
  check(`⑨ 今天（${v.mode} / ${v.board}）那一局账对不上：400 implausible`,
    bad.status === 400 && bad.payload?.error === 'implausible' && bad.why === 'split', `${bad.status} ${JSON.stringify(bad.payload)} why=${bad.why}`);
  const board1 = await call({ action: 'board', ...L, mode: 'daily' });
  check('⑨ 今日榜上没有他', board1.status === 200 && !(board1.payload?.rows || []).some((row) => row.me), JSON.stringify(board1.payload?.rows));
  const ok = await vetPush(L, 'l2', v.board, good);
  check('⑨（尺子）同一局不改坏：收下、进今日榜', ok.status === 200 && ok.payload?.daily === 'stored',
    `${ok.status} ${JSON.stringify(ok.payload)} why=${ok.why}`);
}

// ---- ⑩ 服务器手抄的那几张表 = 源码当场推出来的 --------------------------------
//
// api/ 是纯 .js，import 不进 src 的 ts，所以 api/_maxscore.js 的表全是手抄的。手抄的东西没人对就会悄悄
// 走样：改了棋盘、阶梯、计分，服务器还拿旧尺子量，真玩家打出来的分就被当成「打不出来」拒掉。这一节从
// 棋盘源码、engine 那几个纯模块里推一遍（scripts/lib/boardFacts.mjs），逐项对。
{
  const MS = await import('../api/_maxscore.js');
  const facts = await deriveFacts();
  const ids = Object.keys(MS.BOARD_LIMITS).sort().join(',');
  check('⑩ 服务器的表和源码里的棋盘是同一组（一副不多、一副不少）', ids === Object.keys(facts.boards).sort().join(','),
    `服务器 ${ids} · 源码 ${Object.keys(facts.boards).sort().join(',')}`);
  for (const [id, lim] of Object.entries(MS.BOARD_LIMITS)) {
    const f = facts.boards[id];
    check(`⑩ ${id}：全盘 ${lim.N} 枚、${lim.d} 个线族、最长 ${lim.Lmax} 枚活格、基准 ${lim.par} 步——和源码推出来的一样`,
      Boolean(f) && f.N === lim.N && f.d === lim.d && f.Lmax === lim.Lmax && f.par === lim.par,
      f ? `源码：N ${f.N} · d ${f.d} · Lmax ${f.Lmax} · par ${f.par}（${f.file}）` : '源码里没有这一副');
  }
  check('⑩ 老虎机的 P（经过同一格的摆法数 × 一次拼成的分，取最大）和源码推出来的一样',
    JSON.stringify(sortKeys(MS.SLOT_P)) === JSON.stringify(sortKeys(facts.slotP)),
    `服务器 ${JSON.stringify(MS.SLOT_P)} · 源码 ${JSON.stringify(facts.slotP)}`);
  check('⑩ 无限反转一步的上界（原始分、拍数）和源码推出来的一样',
    JSON.stringify(sortKeys(MS.FLIP_STEP)) === JSON.stringify(sortKeys(facts.flipStep)),
    `服务器 ${JSON.stringify(MS.FLIP_STEP)} · 源码 ${JSON.stringify(facts.flipStep)}`);
  check('⑩ 无限反转的图案真的冻结在 4 枚（扣一千段也不降级——上面那个上界就是照 1×4 推的）', facts.consts.flipFrozenAt === 4,
    String(facts.consts.flipFrozenAt));
  const c = facts.consts;
  check('⑩ 几个常数和源码一样：一局几秒、连击封顶、每枚几分、炸弹扣几分、步步为营一枚 / 一颗星几分',
    MS.FLIP_SECONDS === c.MODE_SECONDS && MS.FLIP_MULT_CAP === c.FLIP_MULT_CAP && MS.POINTS_PER_FLIP === c.POINTS_PER_FLIP &&
      MS.BOMB_HAZARD_PENALTY === c.BOMB_HAZARD_PENALTY && MS.PUZZLE_CLEARED_POINTS === c.PUZZLE_CLEARED_POINTS &&
      MS.PUZZLE_STAR_POINTS === c.PUZZLE_STAR_POINTS,
    `服务器 ${JSON.stringify([MS.FLIP_SECONDS, MS.FLIP_MULT_CAP, MS.POINTS_PER_FLIP, MS.BOMB_HAZARD_PENALTY, MS.PUZZLE_CLEARED_POINTS, MS.PUZZLE_STAR_POINTS])} · 源码 ${JSON.stringify(c)}`);
  // 步步为营第 3 版的起手步数（10-15 补充 S9）：服务器拿它核「剩几步不许比起手还多」，手抄的。
  check('⑩ _maxscore.js 的 PUZZLE_START 和源码的 PUZZLE_START_STEPS 一样',
    JSON.stringify(sortKeys(MS.PUZZLE_START)) === JSON.stringify(sortKeys(c.PUZZLE_START_STEPS ?? {})),
    `服务器 ${JSON.stringify(MS.PUZZLE_START)} · 源码 ${JSON.stringify(c.PUZZLE_START_STEPS)}`);
  // scores.js 里给步步为营那道「枚数 × 10」上限用的那张表（第 14 推起就有）也是手抄的。
  const tilesSrc = /const PUZZLE_TILES = \{ square: (\d+), circle: (\d+) \};/.exec(readFileSync(new URL('../api/scores.js', import.meta.url), 'utf8'));
  check('⑩ scores.js 的 PUZZLE_TILES 和源码的全盘枚数一样',
    Boolean(tilesSrc) && Number(tilesSrc[1]) === facts.boards.square.N && Number(tilesSrc[2]) === facts.boards.circle.N,
    tilesSrc ? `${tilesSrc[1]} / ${tilesSrc[2]}` : '读不到 PUZZLE_TILES');
  // 步数系数：服务器那一份要和客户端逐位相同（同样的运算次序），综合分的四舍五入才对得上。
  let diff = null;
  for (const par of [28, 54, 81, 86]) {
    for (const tiles of [28, 36, 49, 54]) {
      for (let cleared = 0; cleared <= tiles && !diff; cleared++) {
        for (let moves = 0; moves <= 120 && !diff; moves++) {
          const a = MS.stepCoefOf(par, cleared, tiles, moves);
          const b = facts.stepCoefFor({ par, cleared, tiles, moves, apply: true });
          if (!Object.is(a, b)) diff = { par, tiles, cleared, moves, server: a, client: b };
        }
      }
    }
  }
  check('⑩ 步数系数：服务器和客户端逐位相同（四个 par × 四种全盘 × 清掉几枚 × 0–120 步）', diff === null, JSON.stringify(diff));
  // 方案 A-3 那张表的最后一列（T）、老虎机那一句（S）：公式哪天改了，这几个数先变。
  const T = { square: 1469664, circle: 504896, squareDiamond: 2099520, circleHex: 2099520, circleSeven: 8335292, triangleBig: 12400290 };
  check('⑩ 乘系数那几档的上界 T 和方案 A-3 那张表一样',
    Object.entries(T).every(([id, t]) => MS.stepCeiling(id) === t),
    Object.keys(T).map((id) => `${id} ${MS.stepCeiling(id)}`).join(' · '));
  check('⑩ 老虎机的上界 S：方块 29,304、小球 11,564', MS.slotCeiling('square') === 29304 && MS.slotCeiling('circle') === 11564,
    `${MS.slotCeiling('square')} / ${MS.slotCeiling('circle')}`);
}

// ---- ⑪ 总榜不收无限反转（10-11 方案 A-3，玩家 Q11 定案）-------------------------
//
// 无限反转的分和别的玩法不是一把尺子量的；放进「谁最高」那一张，总榜就成了无限反转一档的榜。它自己那
// 张单局榜照常。交卷、重建两条路都量（换邮箱那一条走的是同一个 bestOverall，check-scores 量搬家）。
{
  const M = await makePlayer('guard-m@example.com');
  const flipRun = await vetPush(M, 'm1', 'square', vetData('square', 5000, { modeKey: 'flip', flipRules: 2 }));
  check('⑪（尺子）无限反转 5000 收下了，它自己那张榜上有', flipRun.status === 200 && (await store.zscore('lb:square:flip2', M.email)) === 5000,
    `${flipRun.status} ${JSON.stringify(flipRun.payload)}`);
  check('⑪ 只打过无限反转：总榜上没有他', (await store.zscore('lb:total', M.email)) === null, String(await store.zscore('lb:total', M.email)));
  // 这一版之前无限反转也算进总榜：只打无限反转的人，总榜上还躺着那一行。他下一次交卷就撤掉。
  const M0 = await makePlayer('guard-m0@example.com');
  await store.zadd('lb:total', 8000, M0.email);
  await store.hset('lb:total:mode', M0.email, 'square:flip2');
  await vetPush(M0, 'm0', 'square', vetData('square', 6000, { modeKey: 'flip', flipRules: 2 }));
  check('⑪ 总榜上留着一行旧的无限反转分：他再交一局无限反转，那一行撤掉',
    (await store.zscore('lb:total', M0.email)) === null && (await store.hget('lb:total:mode', M0.email)) === null,
    `${await store.zscore('lb:total', M0.email)} / ${await store.hget('lb:total:mode', M0.email)}`);
  // 归档的老榜（没封顶那一版，不带 flipRules）也不算。
  await vetPush(M, 'm2', 'square', vetData('square', 9000, { modeKey: 'flip' }));
  await vetPush(M, 'm3', 'square', vetData('square', 300));
  check('⑪ 再打一局基础 300：总榜上是 300、记号是方块基础（5000、9000 两局无限反转都不算）',
    (await store.zscore('lb:total', M.email)) === 300 && (await store.hget('lb:total:mode', M.email)) === 'square:base',
    `${await store.zscore('lb:total', M.email)} / ${await store.hget('lb:total:mode', M.email)}`);
  process.env.ADMIN_TOKEN = 'r'.repeat(40);
  const rb = await call({ action: 'rebuild', token: process.env.ADMIN_TOKEN });
  delete process.env.ADMIN_TOKEN;
  check('⑪ 重建之后总榜上还是 300（重建也不收无限反转），无限反转那张榜上还是 5000',
    rb.status === 200 && (await store.zscore('lb:total', M.email)) === 300 && (await store.zscore('lb:square:flip2', M.email)) === 5000,
    `${rb.status} total=${await store.zscore('lb:total', M.email)} flip2=${await store.zscore('lb:square:flip2', M.email)}`);
}

// ---- ⑫ 机器人真打出来的每一局：一局都不许误拒 ----------------------------------
//
// 上面那些是照规则拼出来的局；这一节拿真局对：scripts/fixtures/bot-runs.json 是自检机器人（bot-selfcheck
// 那一套）照编号表把每一种玩法 × 棋盘真开局、真滑出来的 RunData，原样存下来的。服务器那几道上界是照
// 规则推的，推错了的话真局会先撞上——这一节就是拿来先撞的。去掉种子那几位（那几局是敲代号开的，
// 不上榜），交上去必须照收、上榜。
{
  let runs = [];
  try {
    runs = JSON.parse(readFileSync(new URL('./fixtures/bot-runs.json', import.meta.url), 'utf8')).runs || [];
  } catch (err) {
    check('⑫ 读得到 scripts/fixtures/bot-runs.json', false, err.message);
  }
  check('⑫（尺子）夹具里每一种玩法 × 棋盘都有真局', new Set(runs.map((r) => `${r.mode}/${r.board}`)).size === 20,
    `${new Set(runs.map((r) => `${r.mode}/${r.board}`)).size} 种、${runs.length} 局`);
  const N = await makePlayer('guard-n@example.com');
  const refused = [];
  let i = 0;
  for (const r of runs) {
    const { seed, seedSource, daily, room, ...data } = r.data;
    const got = await vetPush(N, `bot-${++i}`, data.shapeId, data);
    if (got.status !== 200 || got.payload?.stored === false) refused.push(`${r.mode}/${r.board} ${data.totalScore}：${got.status} ${JSON.stringify(got.payload)} why=${got.why}`);
  }
  check(`⑫ 机器人那 ${runs.length} 局全部照收（没有一局被拒、没有一局被当成缺字段）`, runs.length > 0 && refused.length === 0, refused.slice(0, 4).join(' | '));
  const slotTop = Math.max(0, ...runs.filter((r) => r.mode === 'slot').map((r) => r.data.totalScore));
  check(`⑫ 里头有老虎机的高分局（最高 ${slotTop}，大于 0 才量得出「高分不误拒」）`, slotTop > 0, String(slotTop));
}

// ---- ⑬ 客户端：服务器说 implausible，就不重报 ---------------------------------
//
// 重报一次答的还是同一句——白白多打一趟。网抖（5xx、断网）照旧两秒后重报一次（engine/cloudScores.ts
// 的 pushRun）。把客户端那一份当场打包，配一个假的 fetch：一种回 400 implausible，一种回 500。
{
  const out = await build({
    entryPoints: [fileURLToPath(new URL('../src/engine/cloudScores.ts', import.meta.url))],
    bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'error',
  });
  const mem = new Map();
  const saved = { fetch: globalThis.fetch, localStorage: globalThis.localStorage, window: globalThis.window, document: globalThis.document };
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => void mem.set(k, String(v)),
    removeItem: (k) => void mem.delete(k), clear: () => mem.clear(), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; },
  };
  globalThis.window = { localStorage: globalThis.localStorage };
  globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  // `slides_genius` 是 engine/subscription.ts 的键：没有一个登着的身份，pushRun 一趟都不打（那就是空绿）。
  mem.set('slides_genius', JSON.stringify({ active: true, channel: 'code', email: 'client@example.com', token: 'TOK' }));
  let answer = null;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(JSON.parse(init.body).action);
    const body = JSON.stringify(answer.body);
    return { ok: answer.status < 300, status: answer.status, headers: new Headers(), statusText: '', json: async () => answer.body, text: async () => body };
  };
  try {
    const api = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
    const run = { at: 1, shapeId: 'square', modeKey: 'base', totalScore: 300 };
    answer = { status: 400, body: { error: 'implausible' } };
    calls.length = 0;
    const r1 = await api.pushRun(run);
    await new Promise((r) => setTimeout(r, 2600));
    // 10-15 补充 S3：被拒的那一趟不再回 null（null 是「网不通、没交上去」），回 { refused: 'implausible' }——结算页
    // 拿它写「本局未上传」，而不是照旧写一句「已上传」。
    check('⑬ 回 400 implausible：只打了一趟，不重报，并且告诉调用方「被拒了」', calls.length === 1 && r1?.refused === 'implausible',
      `${calls.length} 趟 ${JSON.stringify(r1)}`);
    answer = { status: 500, body: { error: 'server' } };
    calls.length = 0;
    await api.pushRun({ ...run, at: 2 });
    check('⑬（尺子）回 500：两秒后照旧重报一次（一共两趟）', calls.length === 2, `${calls.length} 趟`);
  } finally {
    Object.assign(globalThis, saved);
  }
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

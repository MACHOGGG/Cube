/**
 * 交卷这一路的四道闸：两处对得上、那份 data 不许过大、一小时 300 局、上限只记日志。
 *
 *   node scripts/check-scores-guard.mjs
 *
 * 不起服务器、不开浏览器：直接叫 api/scores.js 的 handler，库用进程内那一份。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么
 *
 * 这个接口要认得出你是谁（账号 + 令牌），可**它不核实那个分数是不是真打出来的**
 * （api/scores.js 文件头「关于作弊」写明了，这台门也不多担保一句）。能便宜守住的是另
 * 外几件事：
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
 * ④ **分数上限先只记日志，不拦截。** `num()` 早就把存下来的数封在 MAX_SCORE 以内，所
 *    以榜的刻度不会被一个坏数字毁掉；至于「超了就拒」，先量再说——凭感觉加一条 4xx，
 *    第一个被拦住的很可能是个打得特别好的人。日志里**不许有邮箱**（它就是账号 id）。
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
const MAX_SCORE = constOf('MAX_SCORE');

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
/** 一份像样的存档：真客户端报的就是这个形状（engine/runRecord.ts 的 RunData）。 */
const runData = (mode, score, extra = {}) => ({
  shapeId: mode,
  shapeFallback: '方块',
  modeKey: 'base',
  totalScore: score,
  score,
  ratePercent: 80,
  bonusMult: 1.8,
  elapsedSec: 42,
  moves: 60,
  best: score,
  reason: 'cleared',
  neverFlipped: 3,
  unflippedScale: 0.95,
  timeMult: 1.2,
  patternPoints: score,
  comboBonusPoints: 0,
  linePoints: 0,
  extraPenalty: 0,
  extraPenaltyReason: '',
  hazardEnd: false,
  rules: SCORING_V,
  ...extra,
});
const push = (who, runId, mode, score, dataExtra = {}, over = {}) =>
  call({ action: 'push', ...who, runId, mode, score, data: runData(mode, score, dataExtra), ...over });

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

// ---- ⑤ 上限：只记日志，不拦截，而且日志里没有邮箱 ----------------------
{
  const F = await makePlayer('guard-f@example.com');
  const lines = [];
  const realWarn = console.warn;
  console.warn = (...a) => lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  let r;
  try {
    r = await push(F, 'f1', 'square', MAX_SCORE * 2);
  } finally {
    console.warn = realWarn;
  }
  check('⑤ 超上限不拦：照收', r.status === 200 && r.payload?.ok === true, `${r.status} ${JSON.stringify(r.payload)}`);
  const mine = await call({ action: 'mine', ...F });
  check('⑤ 存下来的数被削到上限（榜的刻度不毁）', mine.payload?.best?.['square:base'] === MAX_SCORE,
    JSON.stringify(mine.payload?.best));
  check('⑤ 记了一行日志', lines.length === 1, JSON.stringify(lines));
  check('⑤ 那一行里有 runId 和那个离谱的数', lines[0]?.includes('f1') && lines[0]?.includes(String(MAX_SCORE * 2)),
    String(lines[0]));
  check('⑤ 那一行里没有邮箱（账号 id 就是邮箱）',
    !lines[0]?.includes('guard-f@example.com') && !lines[0]?.includes('@'), String(lines[0]));

  // 量程：没超上限的时候一个字都不写（不然日志里全是噪音，真有人超了也看不见）。
  const quiet = [];
  console.warn = (...a) => quiet.push(a.join(' '));
  try {
    await push(F, 'f2', 'square', 1000);
  } finally {
    console.warn = realWarn;
  }
  check('⑤ 量程：正常的一局不记日志', quiet.length === 0, JSON.stringify(quiet));
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

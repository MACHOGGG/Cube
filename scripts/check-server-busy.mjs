/**
 * 服务器那头出错（5xx），屏幕上说「服务器忙」，不说「连不上网络」（10-09 补充方案 7-13 第 3 条）。
 *
 *   node scripts/check-server-busy.mjs
 *
 * 纯 node：把三个客户端模块（engine/account.ts、engine/nickname.ts、engine/cloudScores.ts）各自打成一包，
 * 在 node 里搭一个最小的浏览器（localStorage、window、fetch），让假 fetch 依次答「500 没有正文」「502 带
 * 一句 upstream」「网断了」「一句认得的 4xx」，看每一家把它说成什么。
 *
 * ── 那个病 ────────────────────────────────────────────────────
 *
 * 换邮箱、兑码（engine/account.ts 的 toResult）、改昵称（nickname.ts）、看排行榜（cloudScores.ts 的 fetchBoard，
 * 排行榜整页和缩略图两处）——四个地方把「读不出一个认得的词」一律当成 'network'：屏幕上写「连不上网络 / 检查一下
 * 网络」。可 5xx 是我们这头的事：函数摔了（api/redeem.js、api/email.js 里几处故意抛的错从前没人接，平台回一个连
 * 正文都没有的 500）、库抖了一下。他会去重连 Wi-Fi，那儿什么也修不好。creem.ts 早就是 ≥500 → 'unavailable'
 * （「服务器暂时出错，这不是您的网络问题」），这四处照它改。
 *
 * ── 量的是什么 ────────────────────────────────────────────────
 *
 *   ① account.ts（拿 requestEmailChange 走一遍）：500 无正文 → unavailable；502 upstream → unavailable；网断 → network；
 *      400 email → email（认得的词照旧认）。
 *   ② nickname.ts（setNickname）：500 → unavailable，网断 → network；nicknameErrorText('unavailable') 就是 serverBusy 那一句。
 *   ③ cloudScores.ts（fetchBoard）：500 → unavailable，网断 → network，403 → geniusOnly（照旧）。
 *   ④ 服务端：api/redeem.js、api/email.js 的 handler 摔了也答 502 JSON（读源码：外面那一层 try/catch 还在）。
 *   ⑤ 界面上那几处把 'unavailable' 翻成 serverBusy（读源码：subscribe.ts 的 accountFailText、leaderboard.ts 两处）。
 *   ⑥ /api/scores 摔了（7-13 第 8 条）：回 502 upstream，日志里记一行「[scores] 动作 错在哪一句」——没有令牌、
 *      没有邮箱；请求里乱填的动作名不原样进日志。库是真摔：让 api/_store.js 走「真 Redis」那条路，而假 fetch
 *      答 500。
 */
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const { build } = await import('esbuild');
const dir = mkdtempSync(join(tmpdir(), 'busy-'));
const bundle = async (entry, out) => {
  await build({
    entryPoints: [new URL('../' + entry, import.meta.url).pathname],
    bundle: true, format: 'esm', outfile: join(dir, out), logLevel: 'error',
  });
  return import(join(dir, out));
};

// 最小的浏览器：登着一个邮箱账号（auth() 要它）。
const store = new Map([['slides_genius', JSON.stringify({ active: true, channel: 'code', email: 'busy@example.com', token: 'TOKEN-1' })]]);
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.window = {
  location: { protocol: 'https:', hostname: 'play-slides.com', search: '', origin: 'https://play-slides.com', pathname: '/' },
  history: { replaceState() {} },
  addEventListener() {},
  dispatchEvent() {},
};
globalThis.document = { addEventListener() {}, querySelector: () => null, getElementById: () => null };

/** 下一次 fetch 怎么答：{ status, body } 或者 'offline'。body 是字符串（可以不是 JSON）。 */
let next = null;
globalThis.fetch = async () => {
  if (next === 'offline') throw new TypeError('Failed to fetch');
  const { status, body } = next;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(body),
    text: async () => body,
  };
};
const answer = (status, body = '') => (next = { status, body: typeof body === 'string' ? body : JSON.stringify(body) });

// ── ① account.ts ──────────────────────────────────────────────
{
  const acct = await bundle('src/engine/account.ts', 'account.mjs');
  const ask = () => acct.requestEmailChange('busy@example.com', 'TOKEN-1', 'next@example.com', 'zhHans');
  answer(500, '');
  check('① 500 没有正文（函数摔了）→ unavailable', (await ask()).reason === 'unavailable', JSON.stringify(await ask()));
  answer(502, { error: 'upstream' });
  check('① 502 upstream → unavailable', (await ask()).reason === 'unavailable');
  next = 'offline';
  check('① 网断了 → network（这一种才是他的网络）', (await ask()).reason === 'network');
  answer(400, { error: 'email' });
  check('①（尺子）认得的词照旧认：400 email → email', (await ask()).reason === 'email');
}

// ── ② nickname.ts ─────────────────────────────────────────────
{
  const nick = await bundle('src/engine/nickname.ts', 'nickname.mjs');
  const { STRINGS } = await bundle('src/i18n.ts', 'i18n.mjs');
  answer(500, '');
  const r1 = await nick.setNickname('忙忙');
  check('② 改昵称遇上 500 → unavailable', r1.ok === false && r1.reason === 'unavailable', JSON.stringify(r1));
  next = 'offline';
  const r2 = await nick.setNickname('忙忙');
  check('② 网断了 → network', r2.ok === false && r2.reason === 'network', JSON.stringify(r2));
  check('② unavailable 说的是「服务器暂时出错…不是您的网络问题」那一句（serverBusy）',
    nick.nicknameErrorText('unavailable', 'zhHans') === STRINGS.zhHans.serverBusy, nick.nicknameErrorText('unavailable', 'zhHans'));
}

// ── ③ cloudScores.ts ──────────────────────────────────────────
{
  const cloud = await bundle('src/engine/cloudScores.ts', 'cloud.mjs');
  answer(500, '');
  const b1 = await cloud.fetchBoard();
  check('③ 排行榜遇上 500 → unavailable', b1.ok === false && b1.reason === 'unavailable', JSON.stringify(b1));
  next = 'offline';
  const b2 = await cloud.fetchBoard();
  check('③ 网断了 → network', b2.ok === false && b2.reason === 'network', JSON.stringify(b2));
  answer(403, { error: 'genius' });
  const b3 = await cloud.fetchBoard();
  check('③（尺子）403 照旧是 geniusOnly', b3.ok === false && b3.reason === 'geniusOnly', JSON.stringify(b3));
}

// ── ④ 服务端：摔了也答 502 JSON ───────────────────────────────
for (const f of ['api/redeem.js', 'api/email.js']) {
  const src = read(f);
  check(`④ ${f}：handler 外面兜了一层，摔了回 502 upstream`,
    /export default async function handler\(req, res\) \{\s*try \{\s*return await handle\(req, res\);\s*\} catch \(err\) \{[\s\S]{0,200}?send\(res, 502, \{ error: 'upstream' \}\)/.test(src));
}

// ── ⑤ 界面上把 'unavailable' 翻成 serverBusy ─────────────────
{
  const sub = read('src/ui/subscribe.ts');
  check('⑤ subscribe.ts 的 accountFailText 认 unavailable → serverBusy', /case 'unavailable':\s*return s\.serverBusy;/.test(sub));
  const lb = read('src/ui/leaderboard.ts');
  const n = (lb.match(/reason === 'unavailable'[\s\S]{0,40}?s\.serverBusy/g) || []).length;
  check('⑤ leaderboard.ts 整页和缩略图两处都认 unavailable → serverBusy', n === 2, `${n} 处`);
}

// ── ⑥ /api/scores 摔了：回 502、记一行、行里没有身份 ─────────────
{
  process.env.ALLOW_MEMORY_STORE = '1';
  const accounts = await import('../api/_accounts.js');
  const { default: scores } = await import('../api/scores.js');
  const EMAIL = 'logme@example.com';
  const acct = accounts.newAccount('', 'code');
  acct.until = Date.now() + 9e8;
  await accounts.saveAccount(EMAIL, acct);
  const callScores = async (body) => {
    let status = 0;
    let text = '';
    const res = { status: (c) => ((status = c), res), setHeader: () => res, end: (t) => ((text = t), res) };
    await scores({ method: 'POST', headers: {}, body }, res);
    return { status, body: JSON.parse(text || '{}') };
  };
  const ok = await callScores({ action: 'mine', email: EMAIL, token: acct.token });
  check('⑥（尺子）库好好的时候这个账号读得到自己的战绩', ok.status === 200, String(ok.status));

  const logged = [];
  const realError = console.error;
  console.error = (...args) => logged.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
  // 让 _store.js 以为接着一个真 Redis（两个变量都在就走 fetch），而假 fetch 答 500。
  process.env.KV_REST_API_URL = 'https://kv.invalid';
  process.env.KV_REST_API_TOKEN = 'not-a-real-token';
  let down;
  let junk;
  try {
    answer(500, '');
    down = await callScores({ action: 'board', email: EMAIL, token: acct.token });
    junk = await callScores({ action: 'board\n[scores] 伪造的一行', email: EMAIL, token: acct.token });
  } finally {
    console.error = realError;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
  }
  check('⑥ 库摔了：/api/scores 回 502 upstream（不是连正文都没有的 500）', down.status === 502 && down.body.error === 'upstream',
    `${down.status} ${JSON.stringify(down.body)}`);
  check('⑥ 日志里记了一行：[scores] board 和错在哪一句', logged.some((l) => /^\[scores\] board store 500/.test(l)), JSON.stringify(logged));
  check('⑥ 那几行里没有令牌、没有邮箱', logged.length > 0 && logged.every((l) => !l.includes(acct.token) && !l.includes('logme')),
    JSON.stringify(logged));
  check('⑥ 请求里乱填的动作名不原样进日志（记成 ?）', junk.status === 502 && logged.some((l) => l.startsWith('[scores] ? ')) &&
    logged.every((l) => !l.includes('伪造')), JSON.stringify(logged));
}

console.log(fail ? `\n${fail} 条红` : '\n全部通过');
process.exit(fail ? 1 : 0);

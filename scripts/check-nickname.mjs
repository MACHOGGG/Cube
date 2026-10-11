/**
 * 一个帐号一个昵称（第 16 推）。
 *
 *   node scripts/check-nickname.mjs
 *
 * 纯 node，不起服务器、不开浏览器：服务端那一半直接 import `api/scores.js` 的 handler（帐号库
 * 和榜都用进程内那份，ALLOW_MEMORY_STORE=1）；客户端那一半当场用 esbuild 把
 * `src/engine/nickname.ts` 打成一个包，配一个假的 localStorage 和 fetch 跑。
 *
 * ── 守的是什么 ──────────────────────────────────────────────────────
 *
 * 从前名字随每一局报上来，谁报的算谁的。于是：在这台手机上改了名，换台平板打一局就又变回去；
 * 全站可以有任意多个「阿花」；小屋发的「B」、重名加的「 2」也曾上过榜。第 16 推把名字收成
 * 「一个帐号一个、全站唯一、只有改名接口写得进来」。这几件事坏起来**一个字都不报**——榜上
 * 只是多了个重名、少了个名字、名字自己变回去了——所以一条一条钉住（方案第 11 条那张单子）：
 *
 *   ① 改名立刻上榜
 *   ② 另一台设备上传不覆盖（以及：旧客户端随 push 报的名字写不进去）
 *   ③ 不能改成空
 *   ④ 两个帐号抢同一个名字（含大小写、全半角）只有一个成功
 *   ⑤ 旧名字释放之后别人取得到
 *   ⑥ 敏感词、保留名被拒（而正常的名字不被误伤）
 *   ⑦ 超过 12 个码点被拒、不截断
 *   ⑧ 换邮箱之后索引跟着走；删帐号放出名字
 *   ⑨ 迁移（建立昵称索引）规则对、回包里一个名字都没有、跑两遍和跑一遍一样
 *   ⑩ 一小时最多改 10 次；mine 带着昵称；凭据形状的名字被拒
 *   ⑪ 客户端：缓存、改名成功才写、清榜缓存、服务器那一份盖下来、自动上传只一次
 *   ⑫ 小红书产物里没有 /api/scores 调用
 *
 * 每一条都配了尺子（「这件事真的发生了」），免得在一张空榜、一个空库上全绿。
 */
process.env.ALLOW_MEMORY_STORE = '1';
process.env.ADMIN_TOKEN = 'n'.repeat(32);

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fillRun } from './lib/fakeRun.mjs';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const { default: scores, renameScoreOwner } = await import('../api/scores.js');
const { newAccount, saveAccount, deleteAccount, pairKey } = await import('../api/_accounts.js');
const store = await import('../api/_store.js');
const NAMES = 'lbnames';
const { nickKey } = await import('../api/_nickname.js');
const INDEX = 'nickidx';

let ipSeq = 0;
async function call(body) {
  // 明细由夹具拼齐（10-11 方案 A-3，scripts/lib/fakeRun.mjs）：服务器从那以后对每一局对一遍账，缺明细的
  // 一局不上榜，而这道门量的是榜上那一行的名字。门自己写的那几位盖在上面。
  if (body?.action === 'push') {
    body = { ...body, data: fillRun(body.mode, body.score, { rules: 'ero1', ...(body.data || {}) }) };
  }
  const out = { code: 0, payload: null };
  await scores(
    // 每次换一个来源：rebuild 的限速按来源数（一小时 20 次），这道门要敲好几次。
    { method: 'POST', body, headers: { 'x-vercel-forwarded-for': `10.9.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}` } },
    { status(c) { out.code = c; return this; }, setHeader() {}, end(t) { out.payload = JSON.parse(t); } },
  );
  return { status: out.code, body: out.payload };
}

/** 造一个天才帐号（看榜要天才）。 */
async function player(id) {
  const acc = newAccount('pw1234', 'code');
  acc.until = Date.UTC(2999, 0, 1);
  await saveAccount(id, acc);
  return { id, token: acc.token };
}
const rename = (who, name) => call({ action: 'name', email: who.id, token: who.token, name });
let runSeq = 0;
const push = (who, score, extra = {}) =>
  call({ action: 'push', email: who.id, token: who.token, runId: `nick-${runSeq++}`, mode: 'square', score, ...extra });
const boardRow = async (viewer, score) => {
  const got = await call({ action: 'board', email: viewer.id, token: viewer.token, mode: 'square:base' });
  return { got, row: got.body?.rows?.find((r) => r.score === score) };
};
const nameRow = async (id) => (await store.hgetall(NAMES))[id];
const owner = async (key) => (await store.hgetall(INDEX))[key];

// ── ① 改名立刻上榜 ──────────────────────────────────────────────────
const A = await player('nick-a@example.com');
{
  const p = await push(A, 4101);
  check('（尺子）① A 那一局入榜了', p.status === 200 && p.body?.stored !== false, JSON.stringify(p.body));
  const before = await boardRow(A, 4101);
  check('（尺子）① 还没取名字：那一行在榜上、名字是空的', before.row && before.row.name === '', JSON.stringify(before.row));
  const r = await rename(A, '阿花');
  check('① 改名接口答 200，回的是存下来的名字', r.status === 200 && r.body?.name === '阿花', `${r.status} ${JSON.stringify(r.body)}`);
  const after = await boardRow(A, 4101);
  check('① 不用再打一局，榜上那一行当场就是新名字', after.row?.name === '阿花', JSON.stringify(after.row));
  const row = await nameRow(A.id);
  check('① 库里那一条是 { name, v: 3 }', row?.name === '阿花' && row?.v === 3, JSON.stringify(row));
  check('① 索引里这个名字归 A', (await owner('阿花')) === A.id, String(await owner('阿花')));
}

// ── ② 另一台设备上传不覆盖；旧客户端随 push 报的名字写不进去 ─────────────
{
  const p1 = await push(A, 4102, { name: '旧名字', nameV: 2 });
  check('（尺子）② 另一台设备（第 3 推那一版，带着 name + nameV）那一局照收', p1.status === 200 && p1.body?.ok === true, JSON.stringify(p1.body));
  const p2 = await push(A, 4103, { name: 'Legacy' });
  check('（尺子）② 更老的客户端（只带 name）那一局也照收', p2.status === 200 && p2.body?.ok === true, JSON.stringify(p2.body));
  check('② A 的昵称没被那两局盖掉', (await nameRow(A.id))?.name === '阿花', JSON.stringify(await nameRow(A.id)));
  const { row } = await boardRow(A, 4103);
  check('② 榜上照旧是「阿花」', row?.name === '阿花', JSON.stringify(row));
  // 没取过昵称的帐号：旧客户端报的名字同样写不进去。
  const E = await player('nick-e@example.com');
  await push(E, 4104, { name: 'Ghost', nameV: 2 });
  check('② 没登记过昵称的帐号，push 里的名字一个字都没进库', !(await nameRow(E.id)), JSON.stringify(await nameRow(E.id)));
  check('② 索引里也没有它', !(await owner('ghost')));
}

// ── ③ 不能改成空 ────────────────────────────────────────────────────
for (const blank of ['', '   ', '\u200b\u200b', '\u202e', null]) {
  const r = await rename(A, blank);
  check(`③ 改成 ${JSON.stringify(blank)} → 400 required`, r.status === 400 && r.body?.error === 'required', `${r.status} ${JSON.stringify(r.body)}`);
}
check('③ 那几次之后 A 还是「阿花」', (await nameRow(A.id))?.name === '阿花');

// ── ④ 两个帐号抢同一个名字：只有一个成功 ──────────────────────────────
{
  const B = await player('nick-b@example.com');
  const C = await player('nick-c@example.com');
  // 同一瞬间：一个敲半角、一个敲全角大写。规范化之后是同一个名字。
  const [rb, rc] = await Promise.all([rename(B, 'Bobby'), rename(C, 'ＢＯＢＢＹ')]);
  const wins = [rb, rc].filter((r) => r.status === 200).length;
  const taken = [rb, rc].filter((r) => r.status === 409 && r.body?.error === 'taken').length;
  check('④ 同时抢「Bobby」和「ＢＯＢＢＹ」：恰好一个 200、一个 409 taken', wins === 1 && taken === 1,
    `${rb.status}/${rc.status}`);
  const winner = rb.status === 200 ? B : C;
  const loser = winner === B ? C : B;
  check('④ 索引里只有一格，归赢的那个', (await owner('bobby')) === winner.id, String(await owner('bobby')));
  check('④ 输的那个库里没有这个名字', (await nameRow(loser.id))?.name === undefined, JSON.stringify(await nameRow(loser.id)));
  // 事后再来：大小写、首尾空白不同也一样被拦。
  for (const variant of ['BOBBY', ' bobby ', 'Ｂｏｂｂｙ']) {
    const r = await rename(loser, variant);
    check(`④ 事后再取 ${JSON.stringify(variant)} → 409 taken`, r.status === 409 && r.body?.error === 'taken', `${r.status}`);
  }
  // 赢的那个改一下大小写：是他自己的名字，不算被占。
  const self = await rename(winner, 'BOBBY');
  check('④ 名字的主人只改大小写：200，索引还是他', self.status === 200 && (await owner('bobby')) === winner.id, `${self.status}`);
  check('④ 显示的是他新敲的那个样子', (await nameRow(winner.id))?.name === 'BOBBY', JSON.stringify(await nameRow(winner.id)));

  // ── ⑤ 旧名字释放之后别人取得到 ──────────────────────────────────────
  const moved = await rename(winner, '小明');
  check('（尺子）⑤ 赢的那个改名叫「小明」', moved.status === 200, `${moved.status}`);
  check('⑤ 「bobby」那一格索引删掉了', (await owner('bobby')) === undefined, String(await owner('bobby')));
  const freed = await rename(loser, 'Bobby');
  check('⑤ 刚才输的那个现在取得到「Bobby」', freed.status === 200 && (await owner('bobby')) === loser.id, `${freed.status}`);
}

// ── ⑥ 敏感词、保留名被拒；正常名字不误伤 ──────────────────────────────
{
  const D = await player('nick-d@example.com');
  // （「Anonymous player」「Joueur anonyme」也在保留名里，可它们都超过 12 个字，先撞上的是
  // 长度那一关——两条路都拦，回的是 bad。）
  const blocked = ['fuck you', 'Slides', 'slides 官方', '官方客服', '我是管理员', 'admin', 'Admin!', '匿名玩家',
    'B', 'z', '傻 逼', 'Putain'];
  for (const name of blocked) {
    const r = await rename(D, name);
    check(`⑥ ${JSON.stringify(name)} → 400 blocked（不说是哪个词）`,
      r.status === 400 && r.body?.error === 'blocked' && Object.keys(r.body).join() === 'error',
      `${r.status} ${JSON.stringify(r.body)}`);
  }
  for (const name of ['Scunthorpe', 'admin123', 'Bo', '他妈妈', '尼玛', '阿 花']) {
    const r = await rename(D, name);
    check(`⑥ 正常名字 ${JSON.stringify(name)} 不误伤 → 200`, r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  }

  // ── ⑦ 超过 12 个码点被拒、不截断 ──────────────────────────────────
  const before = (await nameRow(D.id))?.name;
  const long = await rename(D, 'abcdefghijklm');
  check('⑦ 13 个字母 → 400 bad', long.status === 400 && long.body?.error === 'bad', `${long.status} ${JSON.stringify(long.body)}`);
  check('⑦ 被拒之后名字没变（没有被截成前 12 个存进去）', (await nameRow(D.id))?.name === before, JSON.stringify(await nameRow(D.id)));
  const emoji12 = '\u{1F600}'.repeat(12);
  const ok12 = await rename(D, emoji12);
  check('⑦ 12 个 emoji（24 个 UTF-16 单元）→ 200：按码点数，不按 UTF-16', ok12.status === 200, `${ok12.status}`);
  const bad13 = await rename(D, '\u{1F600}'.repeat(13));
  check('⑦ 13 个 emoji → 400 bad', bad13.status === 400 && bad13.body?.error === 'bad', `${bad13.status}`);
  const family = '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}';
  const fam = await rename(D, family);
  check('⑦ emoji 里的 ZWJ 留着（一家三口不散）', fam.status === 200 && (await nameRow(D.id))?.name === family,
    JSON.stringify(await nameRow(D.id)));
  const zw = await rename(D, 'Ka\u200bte');
  check('⑦ 名字中间的零宽空格去掉了', zw.status === 200 && (await nameRow(D.id))?.name === 'Kate', JSON.stringify(await nameRow(D.id)));
}

// ── ⑬ 看不见的字符（10-11 方案 A-6）────────────────────────────────────
//
// 原先清洗是一张清单（ZWSP、BOM、双向控制字符……），清单外面的那些照样过：`Sli\u00ADdes`（软连字
// 符）、`管\u00AD理员`、`官\u3164方`（韩文填充符）绕过了保留名，整串只有一个填充符的名字也过了。现在
// 去掉全部格式字符和那几个同样看不见的字母 / 符号，唯一性、保留名、词表都比洗过的那一份。
{
  const G1 = await player('nick-inv1@example.com');
  for (const name of ['Sli\u00ADdes', '管\u00AD理员', '官\u3164方', 'ad\u200Dmin', 'Sl\u034Fides', '官\u2800方']) {
    const r = await rename(G1, name);
    check(`⑬ ${JSON.stringify(name)}（夹着看不见的字符）→ 400 blocked`, r.status === 400 && r.body?.error === 'blocked',
      `${r.status} ${JSON.stringify(r.body)}`);
  }
  const lone = ['\u3164', '\u115F', '\u1160', '\uFFA0', '\u2800', '\u00AD', '\u034F', '\u17B4', '\u{E0020}', '\u3164\u3164 \u2800'];
  for (const name of lone) {
    const r = await rename(G1, name);
    check(`⑬ 整串只有 ${JSON.stringify(name)} → 400 required`, r.status === 400 && r.body?.error === 'required',
      `${r.status} ${JSON.stringify(r.body)}`);
  }
  // 唯一性：看起来一样的名字是同一个名字。
  const H1 = await player('nick-inv2@example.com');
  const own = await rename(G1, 'Marisol');
  check('（尺子）⑬ 先有人取到「Marisol」', own.status === 200, `${own.status}`);
  for (const name of ['Mari\u00ADsol', 'Maris\u3164ol', 'M\uFE0Farisol', 'Mar\u{E0041}isol', 'MARI\u200Bsol']) {
    const r = await rename(H1, name);
    check(`⑬ ${JSON.stringify(name)} 和「Marisol」是同一个名字 → 409 taken`, r.status === 409 && r.body?.error === 'taken',
      `${r.status} ${JSON.stringify(r.body)}`);
  }
  // emoji 里正经的那几样留着：变体选择符跟在 emoji 后面、键帽、旗帜的 tag 序列、ZWJ。
  const I1 = await player('nick-emoji@example.com');
  const keep = ['\u2764\uFE0F', '1\uFE0F\u20E3', '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}', '\u{1F3F3}\uFE0F\u200D\u{1F308}'];
  for (const name of keep) {
    const r = await rename(I1, name);
    check(`⑬ emoji ${JSON.stringify(name)} 原样留着`, r.status === 200 && (await nameRow(I1.id))?.name === name,
      `${r.status} ${JSON.stringify(await nameRow(I1.id))}`);
  }
  const vs = await rename(I1, 'Bo\uFE0Fb');
  check('⑬ 跟在字母后面的变体选择符去掉了（存下来的是 Bob）', vs.status === 200 && (await nameRow(I1.id))?.name === 'Bob',
    `${vs.status} ${JSON.stringify(await nameRow(I1.id))}`);
  const tag = await rename(I1, 'Ann\u{E0067}a');
  check('⑬ 不成串的 tag 字符去掉了（存下来的是 Anna）', tag.status === 200 && (await nameRow(I1.id))?.name === 'Anna',
    `${tag.status} ${JSON.stringify(await nameRow(I1.id))}`);
}

// ── ⑭ 词表不误伤：先剔掉几个正常词再比（10-11 方案 A-7）─────────────────────
//
// 中文按子串比（没有词边界，「整词比」等于整名比，会放过「日你妈的」），于是「生日你好」里的「日你」、
// 「去死亡谷」里的「去死」都被拦过。现在比之前先剔掉生日、小草、死亡、蛋糕、情绪。
{
  const J1 = await player('nick-allow@example.com');
  for (const name of ['生日你好', '小草你好', '去死亡谷', '王八蛋糕', '滚蛋糕', '色情绪']) {
    const r = await rename(J1, name);
    check(`⑭ ${JSON.stringify(name)} 不误伤 → 200`, r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  }
  for (const name of ['日你妈的生日', '傻逼', '日你', '去死', '王八蛋', '滚蛋', '色情', '他妈的', '草泥马', '操你']) {
    const r = await rename(J1, name);
    check(`⑭ ${JSON.stringify(name)} 照样拦 → 400 blocked`, r.status === 400 && r.body?.error === 'blocked', `${r.status} ${JSON.stringify(r.body)}`);
  }
  const reserved = await rename(J1, '官方生日');
  check('⑭ 保留名不剔：「官方生日」照样拦', reserved.status === 400 && reserved.body?.error === 'blocked', `${reserved.status}`);
}

// ── ⑧ 换邮箱之后索引跟着走；删帐号放出名字 ────────────────────────────
{
  const F = await player('nick-f@example.com');
  await push(F, 4201);
  await rename(F, '搬家的人');
  check('（尺子）⑧ 搬家之前索引归旧地址', (await owner('搬家的人')) === F.id);
  const to = 'nick-f-new@example.com';
  const acc = newAccount('pw1234', 'code');
  acc.until = Date.UTC(2999, 0, 1);
  await saveAccount(to, acc);
  await renameScoreOwner(F.id, to);
  check('⑧ 换邮箱之后索引指向新地址', (await owner('搬家的人')) === to, String(await owner('搬家的人')));
  check('⑧ 新地址底下是那个昵称（v3）', (await nameRow(to))?.name === '搬家的人' && (await nameRow(to))?.v === 3,
    JSON.stringify(await nameRow(to)));
  check('⑧ 旧地址底下没有了', !(await nameRow(F.id)), JSON.stringify(await nameRow(F.id)));
  const G = await player('nick-g@example.com');
  const grab = await rename(G, '搬家的人');
  check('⑧ 搬完之后名字照旧有主，别人取不走', grab.status === 409, `${grab.status}`);
  await deleteAccount(to);
  check('⑧ 删帐号：lbnames 那一条删了', !(await nameRow(to)), JSON.stringify(await nameRow(to)));
  check('⑧ 删帐号：索引那一格也删了', (await owner('搬家的人')) === undefined, String(await owner('搬家的人')));
  const after = await rename(G, '搬家的人');
  check('⑧ 名字放出来了，别人取得到', after.status === 200, `${after.status}`);
}

// ── ⑩ 限速、mine、凭据形状 ─────────────────────────────────────────
{
  const H = await player('nick-h@example.com');
  const statuses = [];
  for (let i = 0; i < 11; i++) statuses.push((await rename(H, `限速${i}`)).status);
  check('⑩ 一小时前 10 次都成', statuses.slice(0, 10).every((x) => x === 200), statuses.join(' '));
  check('⑩ 第 11 次 → 429', statuses[10] === 429, statuses.join(' '));
  // 和现在一模一样的名字不扣次数（客户端「登录之后把本机的名字传上去」那一下多半就是这种）。
  const same = await rename(H, '限速9');
  check('⑩ 限速满了，改成和现在一样的名字照旧 200（不扣次数）', same.status === 200, `${same.status}`);

  const mine = await call({ action: 'mine', email: A.id, token: A.token });
  check('⑩ mine 回着昵称', mine.status === 200 && mine.body?.nickname === '阿花', JSON.stringify(mine.body?.nickname));
  const mineE = await call({ action: 'mine', email: 'nick-e@example.com', token: (await player('nick-e2@example.com')).token });
  check('（尺子）⑩ 认不出人的 mine 是 401', mineE.status === 401, `${mineE.status}`);
  const I = await player('panda.lover@example.com');
  for (const name of ['panda.lover', 'Panda.Lover']) {
    const r = await rename(I, name);
    check(`⑩ 邮箱 @ 前面那一段（${name}）→ blocked`, r.status === 400 && r.body?.error === 'blocked', `${r.status}`);
  }
  const J = await player(pairKey('Short1234'));
  const rj = await rename(J, 'Short1234');
  check('⑩ 免邮箱帐号拿整条第一串当名字 → blocked', rj.status === 400 && rj.body?.error === 'blocked', `${rj.status}`);
  const rj2 = await rename(J, 'Short12345');
  check('（尺子）⑩ 差一个字的名字照收（拦的是第一串本身，不是这个形状）', rj2.status === 200, `${rj2.status}`);
}

// ── ⑨ 迁移：建立昵称索引 ────────────────────────────────────────────
{
  // 迁移之前的库：几条老条目（v2 / 没有 v），外加一条已经从改名接口登记过的。
  const X = await player('mig-x@example.com');
  const Y = await player('mig-y@example.com');
  const Z = await player('mig-z@example.com');
  const W = await player('mig-w@example.com');
  const V = await player('mig-v@example.com');
  const U = await player('mig-u@example.com');
  const L = await player('mig-leak@example.com');
  await push(X, 500);
  await push(Y, 900);
  await push(W, 9000);
  await push(Z, 100);
  await store.hset(NAMES, X.id, { name: 'Dup', v: 2 });
  await store.hset(NAMES, Y.id, { name: 'ｄｕｐ', v: 2 });   // 全角：规范化之后和 X 是同一个
  await store.hset(NAMES, W.id, { name: 'reg', v: 2 });      // 分最高，可 Z 已经登记过
  await rename(Z, 'Reg');
  await store.hset(NAMES, V.id, { name: 'B', v: 2 });        // 小屋发的字母上了榜
  await store.hset(NAMES, U.id, { name: 'admin' });          // 保留名
  await store.hset(NAMES, L.id, { name: 'mig-leak' });       // 邮箱前半截（像凭据的老条目）
  // 兑了码、后来绑了邮箱的人：寄存处已经没了（bind 是 GETDEL），名字留在 code: 底下。
  await store.hset(NAMES, 'code:BOUND01', { name: '老码', v: 2 });
  // 兑了码还没绑邮箱的人：寄存处还在，是活帐号。
  const live = newAccount('', 'code');
  live.unbound = true;
  await saveAccount('code:LIVE01', live);
  await store.hset(NAMES, 'code:LIVE01', { name: '活码', v: 2 });
  // 过期的索引：指着一个已经不叫这个名字的帐号。
  await store.hset(INDEX, 'ghostname', X.id);
  // 10-11 方案 A-6 之前从改名接口登记进来的、夹着看不见字符的名字（那时的清洗放过了它们），索引键是那
  // 时的算法（NFKC + 小写，软连字符、填充符原样留在键里）。迁移要用今天这一道清洗重新认它们。
  const S = await player('mig-s@example.com');
  const T = await player('mig-t@example.com');
  const Q = await player('mig-q@example.com');
  const R = await player('mig-r@example.com');
  await rename(S, 'Aria');
  await store.hset(NAMES, T.id, { name: 'Ari\u00ADa', v: 3 });   // 洗完就是 S 的「Aria」
  await store.hset(INDEX, 'ari\u00ada', T.id);
  await store.hset(NAMES, Q.id, { name: 'Sli\u00ADdes', v: 3 });  // 洗完撞上保留名
  await store.hset(INDEX, 'sli\u00addes', Q.id);
  await store.hset(NAMES, R.id, { name: '\u3164', v: 3 });         // 洗完是空的（NFKC 之后的键是 U+1160）
  await store.hset(INDEX, '\u1160', R.id);

  const before = await store.hgetall(NAMES);
  const run = await call({ action: 'rebuild', token: process.env.ADMIN_TOKEN, nicknames: true });
  check('（尺子）⑨ 重建跑完了', run.status === 200 && run.body?.ok === true, `${run.status} ${JSON.stringify(run.body).slice(0, 120)}`);
  const n = run.body?.nicknames || {};
  const after = await store.hgetall(NAMES);
  const index = await store.hgetall(INDEX);

  check('⑨ 已绑定邮箱的 code: 行并掉了', !after['code:BOUND01'] && n.merged === 1, `merged=${n.merged}`);
  check('⑨ 还没绑邮箱的 code: 行是活帐号，留着、进了索引', after['code:LIVE01']?.name === '活码' && after['code:LIVE01']?.v === 3 &&
    index['活码'] === 'code:LIVE01', JSON.stringify(after['code:LIVE01']));
  check('⑨ 重名的两个：总榜分高的 Y 留下（v3、进索引）', after[Y.id]?.name === 'ｄｕｐ' && after[Y.id]?.v === 3 && index['dup'] === Y.id,
    `${JSON.stringify(after[Y.id])} → ${index['dup']}`);
  check('⑨ 重名的两个：分低的 X 清掉了', !after[X.id], JSON.stringify(after[X.id]));
  check('⑨ 已经登记过的 Z 保住了名字（比老条目分高更算数）', after[Z.id]?.name === 'Reg' && index['reg'] === Z.id,
    `${JSON.stringify(after[Z.id])} → ${index['reg']}`);
  check('⑨ 分最高、但只是老条目的 W 让出来了', !after[W.id], JSON.stringify(after[W.id]));
  check('⑨ 不能用的清掉：单个字母、保留名、像凭据的老条目，连同洗过之后撞保留名、洗完是空的那两个',
    !after[V.id] && !after[U.id] && !after[L.id] && !after[Q.id] && !after[R.id] && n.invalid === 5, `invalid=${n.invalid}`);
  check('⑨ 夹着软连字符的「Ari­a」洗过之后就是 S 的「Aria」：S 留下，它清掉',
    after[S.id]?.name === 'Aria' && index['aria'] === S.id && !after[T.id], `${JSON.stringify(after[T.id])} · aria → ${index['aria']}`);
  check('⑨ 那几个按旧算法算出来的索引格（带软连字符、填充符的键）都删掉了',
    index['ari\u00ada'] === undefined && index['sli\u00addes'] === undefined && index['\u1160'] === undefined,
    JSON.stringify(Object.keys(index).filter((k) => /[\u00ad\u1160]/.test(k))));
  check('⑨ 过期的索引格删掉了', index['ghostname'] === undefined && n.stale >= 1, `stale=${n.stale}`);
  check('⑨ 迁移之前登记好的那些一个没动（A 还是阿花）', after[A.id]?.name === '阿花' && index['阿花'] === A.id);
  // 每一条 v3 的名字都在索引里、而且指着自己；索引里每一格都指着一个真叫这个名字的人。
  // 比的是服务器自己那一把（nickKey），不在这儿再抄一份——10-11 方案 A-6 改过它一次。
  const nick = nickKey;
  const orphans = Object.entries(after).filter(([id, row]) => row?.v === 3 && index[nick(row.name)] !== id);
  check('⑨ 每一条 v3 都在索引里指着自己', orphans.length === 0, orphans.map(([id]) => id).join(' '));
  const dangling = Object.entries(index).filter(([key, id]) => nick(after[id]?.name ?? '') !== key);
  check('⑨ 索引里每一格都指着一个真叫这个名字的人', dangling.length === 0, dangling.map(([k]) => k).join(' '));
  check('⑨ 每一条留下来的都升成了 v3', Object.values(after).every((row) => row?.v === 3),
    Object.entries(after).filter(([, r]) => r?.v !== 3).map(([id]) => id).join(' '));

  // 回包里一个名字都不许有：把迁移之前库里出现过的每个名字、每个 id 都找一遍。
  const text = JSON.stringify(run.body);
  const leaked = [...new Set([...Object.values(before).map((r) => r?.name), ...Object.keys(before)])]
    .filter((w) => w && text.includes(w));
  check('⑨ 回包里没有任何名字、任何帐号 id', leaked.length === 0, leaked.join(' | '));
  check('（尺子）⑨ 回包里真有那几个数', ['merged', 'invalid', 'cleared', 'indexed', 'stale'].every((k) => typeof n[k] === 'number'),
    JSON.stringify(n));

  const again = await call({ action: 'rebuild', token: process.env.ADMIN_TOKEN, nicknames: true });
  const m = again.body?.nicknames || {};
  check('⑨ 再跑一遍什么都不动（并 0、清 0、过期 0）', m.merged === 0 && m.invalid === 0 && m.cleared === 0 && m.stale === 0,
    JSON.stringify(m));
  check('⑨ 再跑一遍，库和索引一模一样',
    JSON.stringify(await store.hgetall(NAMES)) === JSON.stringify(after) && JSON.stringify(await store.hgetall(INDEX)) === JSON.stringify(index));
  const plain = await call({ action: 'rebuild', token: process.env.ADMIN_TOKEN });
  check('⑨ 不勾这一项：回包里 nicknames 是 null', plain.status === 200 && plain.body?.nicknames === null, JSON.stringify(plain.body?.nicknames));
}

// ── ⑪ 客户端：engine/nickname.ts ─────────────────────────────────────
{
  const { build } = await import('esbuild');
  const dir = mkdtempSync(join(tmpdir(), 'nickname-'));
  const out = join(dir, 'nickname.mjs');
  // 把 cloudScores 的两个导出一起带出来：量「改名成功会清掉排行榜缓存」要摸得到同一份缓存。
  await build({
    stdin: {
      contents:
        "export * from './src/engine/nickname';\n" +
        "export { cachedBoard, fetchBoard } from './src/engine/cloudScores';\n",
      resolveDir: new URL('..', import.meta.url).pathname,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    outfile: out,
    logLevel: 'error',
  });

  const ls = new Map();
  globalThis.localStorage = {
    getItem: (k) => (ls.has(k) ? ls.get(k) : null),
    setItem: (k, v) => void ls.set(k, String(v)),
    removeItem: (k) => void ls.delete(k),
    clear: () => void ls.clear(),
    key: (i) => [...ls.keys()][i] ?? null,
    get length() { return ls.size; },
  };
  globalThis.window = { localStorage: globalThis.localStorage, addEventListener() {}, removeEventListener() {} };
  globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  const FIRST = 'SecretFirst99';
  ls.set('slides_genius', JSON.stringify({
    active: true, channel: 'code', email: 'client.me@example.com', token: 'TOK', handle: FIRST,
  }));
  let calls = [];
  let answer = () => ({ status: 200, body: { ok: true } });
  // 假回包和真的一样带 text()：engine/fetchTimeout.ts 在同一个钟里先把正文读完再交出去（10-11 方案 A-13）。
  const reply = (status, payload) =>
    ({ ok: status >= 200 && status < 300, status, json: async () => payload, text: async () => JSON.stringify(payload) });
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), body });
    if (body.action === 'board') {
      return reply(200, { mode: '', rows: [{ rank: 1, name: 'x', score: 1, me: false }], players: 1, me: null });
    }
    const a = answer(body);
    return reply(a.status, a.body);
  };
  const api = await import(out);
  const { getNickname, leaderboardName, setNickname, adoptServerNickname, confirmedNickname, onNicknameChange, cachedBoard, fetchBoard } = api;

  // 客户端那一份 nickKey 是 api/_nickname.js 的抄本（10-11 方案 A-6）：一串刁钻的名字，两份算出来的键一样。
  const tricky = ['Ｂｏｂｂｙ', ' alice ', 'Sli\u00ADdes', '官\u3164方', '\u3164', 'K\uFE0Fate', '\u2764\uFE0F', '1\uFE0F\u20E3',
    '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}', 'Ann\u{E0067}a', '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}',
    'a\u200db', '\uFFA0x', 'Se\u00ADcretFirst99', 'x\u{E0100}y', 'ŉ', 'ﬁne'];
  const serverKey = nickKey;
  const off1 = tricky.filter((n) => api.nickKey(n) !== serverKey(n));
  check('⑪ 客户端的 nickKey 和服务器那一把一字不差（一串刁钻的名字算出来的键都一样）', off1.length === 0,
    off1.map((n) => `${JSON.stringify(n)}: ${JSON.stringify(api.nickKey(n))} ≠ ${JSON.stringify(serverKey(n))}`).join(' | '));

  // 原来在 check-board-refresh 的 ⑦（第 16 推跟着函数搬过来）。
  check('⑪ 没取过名字 → 空串（不拿凭据顶上）', getNickname() === '' && leaderboardName() === '', JSON.stringify(getNickname()));
  check('（尺子）⑪ 这时候是登着的，手上也真有第一串', JSON.parse(ls.get('slides_genius')).handle === FIRST);
  ls.set('slides_mp_name', '  阿花  ');
  check('⑪ 取过就是那一个（前后空白剥掉）', getNickname() === '阿花' && leaderboardName() === '阿花', JSON.stringify(getNickname()));
  ls.set('slides_mp_name', 'x'.repeat(30));
  check('⑪ 最多十二个字', getNickname().length === 12, String(getNickname().length));
  ls.set('slides_mp_name', '\u{1F600}'.repeat(14));
  check('⑪ 按码点截，emoji 不被劈成半个', Array.from(getNickname()).length === 12 && !/[\ud800-\udbff]$/.test(getNickname()),
    String(Array.from(getNickname()).length));
  ls.delete('slides_mp_name');

  // 这一头就挡得住的三种，不发请求。
  calls = [];
  for (const [raw, want] of [['', 'required'], ['   ', 'required'], ['abcdefghijklm', 'bad'],
    [FIRST.slice(0, 12), 'blocked'], ['Client.Me', 'blocked'],
    // 邮箱 @ 前面那一段里夹一个软连字符：洗掉之后就是凭据的样子，这一头当场认得出来、不打网络。
    ['Client\u00AD.Me', 'blocked']]) {
    const r = await setNickname(raw);
    check(`⑪ setNickname(${JSON.stringify(raw)}) → ${want}，不打网络`, r.ok === false && r.reason === want, JSON.stringify(r));
  }
  check('⑪ 上面那几次一个请求都没发', calls.length === 0, String(calls.length));

  // 成功：服务器说了算，成功之后才写缓存、清榜缓存、通知头卡。
  await fetchBoard();
  check('（尺子）⑪ 榜有一份缓存', Boolean(cachedBoard()));
  let fired = 0;
  const off = onNicknameChange(() => fired++);
  answer = () => ({ status: 200, body: { ok: true, name: '小花' } });
  calls = [];
  const ok = await setNickname(' 小花 ');
  check('⑪ 改名成功', ok.ok === true && ok.name === '小花', JSON.stringify(ok));
  check('⑪ 发的是 action: name，带着身份', calls.length === 1 && calls[0].body.action === 'name' && calls[0].body.token === 'TOK' &&
    calls[0].body.name === '小花', JSON.stringify(calls[0]?.body));
  check('⑪ 成功之后才写进缓存', getNickname() === '小花' && confirmedNickname() === '小花');
  check('⑪ 排行榜缓存清掉了（点开榜看到的就是新名字）', cachedBoard() === null);
  check('⑪ 头卡收到了一声「变了」', fired === 1, String(fired));

  // 被占了：缓存不动。
  answer = () => ({ status: 409, body: { error: 'taken' } });
  const taken = await setNickname('大花');
  check('⑪ 409 → taken，缓存还是原来那个', taken.ok === false && taken.reason === 'taken' && getNickname() === '小花', JSON.stringify(taken));
  answer = () => ({ status: 400, body: { error: 'blocked' } });
  const blocked = await setNickname('坏名字');
  check('⑪ 400 blocked → blocked', blocked.ok === false && blocked.reason === 'blocked', JSON.stringify(blocked));

  // 服务器那一份盖下来。
  await adoptServerNickname('服务器的名字');
  check('⑪ 服务器有昵称 → 盖掉本机那一份', getNickname() === '服务器的名字' && confirmedNickname() === '服务器的名字');
  calls = [];
  await adoptServerNickname(undefined);
  check('⑪ 旧服务器不回这一位（undefined）→ 什么都不做', getNickname() === '服务器的名字' && calls.length === 0);

  // 本机有、服务器没有：自动上传一次；被占了就清掉本机那一份，头卡写「设置昵称」。
  ls.set('slides_mp_name', '本机的名字');
  answer = () => ({ status: 409, body: { error: 'taken' } });
  calls = [];
  await adoptServerNickname('');
  check('⑪ 本机有、服务器没有 → 自动上传了一次', calls.length === 1 && calls[0].body.action === 'name' && calls[0].body.name === '本机的名字',
    JSON.stringify(calls.map((c) => c.body)));
  check('⑪ 被占了 → 本机那一份清掉、头卡上写「设置昵称」（confirmedNickname 是空的）',
    getNickname() === '' && confirmedNickname() === '', JSON.stringify(getNickname()));
  ls.set('slides_mp_name', '再来一个');
  calls = [];
  await adoptServerNickname('');
  check('⑪ 「一次」就是一次：同一个身份不再自动上传', calls.length === 0, String(calls.length));
  check('⑪ 那一份还没登记，头卡照旧写「设置昵称」', confirmedNickname() === '', JSON.stringify(confirmedNickname()));
  off();
}

// ── ⑫ 小红书产物里没有 /api/scores 调用 ─────────────────────────────────
{
  const app = readFileSync(new URL('../public/xhs/app.js', import.meta.url), 'utf8');
  check('（尺子）⑫ 读到了小红书产物，而且不小', app.length > 100_000, `${app.length} 字节`);
  check('⑫ 小红书产物里没有 /api/scores', !app.includes('/api/scores'));
  check('⑫ 也没有 /api/room', !app.includes('/api/room'));
  const cfg = readFileSync(new URL('../xhs/vite.config.ts', import.meta.url), 'utf8');
  check('⑫ 小红书那一版把 nickname.ts 换成了替身', /'src\/engine\/nickname\.ts':\s*stub\('nickname\.ts'\)/.test(cfg));
}

console.log(fail ? `\n${fail} 条红` : '\n全绿');
process.exit(fail ? 1 : 0);

/**
 * 排行榜的每一行不许带身份。
 *
 *   node scripts/check-board-no-id.mjs
 *
 * 纯 node，不起服务器：直接 import `api/scores.js` 的 handler，账号库和榜都用进程内那份
 * （ALLOW_MEMORY_STORE=1），真写几条分数再真取一次榜。
 *
 * ── 为什么要一道门守着 ──────────────────────────────────────
 *
 * 榜里存的 member 是**账号 id**：邮箱账号就是那个邮箱，免邮箱凭据账号（E38）是
 * `hdl:<sha256>`。两种都不该出现在回包里：
 *
 *   · 邮箱是别人的私事。一张公开的榜把二十个人的邮箱一起发出来，是这个仓库最不该犯的
 *     那种错——而它不会报任何错，只是悄悄多一个字段。
 *   · `hdl:` 那一串虽然还原不出第一串，可它是**一把能直接用在别处的钥匙**（`identify`
 *     认的就是它）：知道它等于知道「这个账号在系统里叫什么」。
 *
 * 回包里本来就只有 rank / score / name / avatar / me / mode——`name` 是玩家自己填的昵称，
 * 和 id 是两件事。这道门把「只有这几样」钉住：以后谁在那个 map 里顺手多带一个
 * `member`（最省事的调试办法就是加它），这儿当场红。
 *
 * 两种回包都要量：母榜（`g:` 开头，几块棋盘混在一起）和单局榜 / 总榜。它们是**两段不同
 * 的代码**（scores.js 里两个 map），所以必须各量一次——只量一种等于只守一半。
 */
process.env.ALLOW_MEMORY_STORE = '1';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const { default: scores } = await import('../api/scores.js');
const { newAccount, saveAccount, pairKey } = await import('../api/_accounts.js');

async function call(body) {
  const out = { code: 0, payload: null };
  await scores(
    { method: 'POST', body, headers: { 'x-vercel-forwarded-for': '10.2.0.1' } },
    { status(c) { out.code = c; return this; }, setHeader() {}, end(t) { out.payload = JSON.parse(t); } },
  );
  return { status: out.code, body: out.payload };
}

/** 造一个能证明自己的账号，回它的 id 和令牌。 */
async function player(id, name) {
  const acc = newAccount('pw1234', 'code');
  acc.until = Date.UTC(2999, 0, 1);   // 天才，否则看榜那道门会拦（scores.js 的 isGenius）
  await saveAccount(id, acc);
  return { id, token: acc.token, name };
}

/** 一个邮箱账号 + 一个免邮箱账号：两种 id 都要出现在榜上。 */
const MAIL = await player('boardgate@example.com', '小明');
const HANDLE = await player(pairKey('BoardGate1'), '阿花');

const ALLOWED = ['rank', 'score', 'name', 'avatar', 'me', 'mode'];
const FORBIDDEN = ['member', 'id', 'email', 'handle', 'token'];

/**
 * 报一局分。
 *
 * ⚠️ 四个坑，第一版全踩了：动作叫 `push` 不叫 `report`（`scores.js` 的 switch）；要带
 * `runId`，否则 400 run；上报的 `mode` **只能是棋盘名、不许带冒号**（`MODE_RE`——那一局
 * 是哪个玩法由存档里的 `data` 说，不由客户端报的字符串说）；而且 `data.rules` 必须等于
 * 现行那一版的记号（`ero1`），不然服务端答 `200 { stored: false }`——分一个字都没入榜，
 * **而回包是 200**。
 *
 * 不盯住下面那条「榜上真有行」的尺子，这道门就会在一张空榜上全绿——第一版正是这样，
 * 五条断言里有三条是那条尺子替它红出来的。
 */
const post = (who, mode, score) =>
  call({
    action: 'push',
    email: who.id,
    token: who.token,
    runId: `run-${who.id}-${mode}-${score}`,
    mode,
    score,
    name: who.name,
    data: { rules: 'ero1' },
  });

for (const who of [MAIL, HANDLE]) {
  const r = await post(who, 'square', 1000 + Math.floor(Math.random() * 100));
  check(`（前提）${who.name} 报得上分，而且真入榜了`,
    r.status === 200 && r.body?.ok === true && r.body?.stored !== false,
    `${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);
}

/** 查一张榜，把每一行的字段名收上来。 */
async function board(mode) {
  const got = await call({ action: 'board', email: MAIL.id, token: MAIL.token, mode });
  return got;
}

for (const [label, mode] of [['单局榜', 'square:base'], ['总榜', ''], ['母榜', 'g:base']]) {
  const got = await board(mode);
  const rows = got.body?.rows;
  check(`（尺子）${label}：取回来了，而且真有行（不是空榜，空榜什么都量不出来）`,
    got.status === 200 && Array.isArray(rows) && rows.length > 0,
    `${got.status} rows=${Array.isArray(rows) ? rows.length : JSON.stringify(got.body).slice(0, 80)}`);
  if (!Array.isArray(rows) || !rows.length) continue;

  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const extra = keys.filter((k) => !ALLOWED.includes(k));
  check(`${label}：每一行只有那六样`, extra.length === 0, `多出来：${extra.join(' ')}（实有：${keys.join(' ')}）`);

  const hit = FORBIDDEN.filter((k) => keys.includes(k));
  check(`${label}：没有 member / id / email / handle / token`, hit.length === 0, hit.join(' '));

  // 更硬的一条：整份回包的文本里不许出现那两个 id 本身。字段名可以改，id 漏出去这件事
  // 不行——有人把 member 改名叫 who 也躲不过这一条。
  const text = JSON.stringify(got.body);
  check(`${label}：整份回包里找不到邮箱`, !text.includes(MAIL.id), MAIL.id);
  check(`${label}：整份回包里找不到 hdl: 那一串`, !text.includes(HANDLE.id), HANDLE.id.slice(0, 20));
  // 尺子：昵称是该出现的——少了这一条，上面两句在「回包是空的」时也会绿。
  check(`（尺子）${label}：昵称确实在回包里`, text.includes(MAIL.name) || text.includes(HANDLE.name));
}

// ── 反向对照：这道门自己量得出「多一个字段」吗 ────────────────
//
// 上面那几条全绿，可它们绿得太顺了——值得确认那套判定真的会红。拿一行真实的回包，手动
// 塞一个 member 进去再判一遍。
{
  const got = await board('square:base');
  const tampered = got.body.rows.map((r) => ({ ...r, member: MAIL.id }));
  const keys = [...new Set(tampered.flatMap((r) => Object.keys(r)))];
  const extra = keys.filter((k) => !ALLOWED.includes(k));
  check('（反向对照）往行里塞一个 member，判定会抓到', extra.join(' ') === 'member', extra.join(' '));
  check('（反向对照）而且整份文本那一条也会抓到',
    JSON.stringify({ rows: tampered }).includes(MAIL.id));
}

console.log(fail ? `\n${fail} 条红` : '\n全绿');
process.exit(fail ? 1 : 0);

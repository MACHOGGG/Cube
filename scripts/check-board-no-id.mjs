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
 *
 * ── 第二件事：**名字那一格里也不许躺着身份**（#2，2026-10-02）───
 *
 * 上面那几条守的是「回包里不许多一个字段」。可身份还有另一条路进来，而且它走的是一个
 * 本来就该有的字段：`engine/cloudScores.ts` 的 `leaderboardName()` 从前在玩家没取名字时
 * 拿他的登录凭据顶上——免邮箱账号印第一串的前 12 位，邮箱账号印 `邮箱.split('@')[0]` 的
 * 前 12 位。第一串那一种尤其糟：它**就是那把钥匙**（api/handle.js 顶上写着，知道第一串的
 * 人凭 `reset` 就能接管那个账号）。
 *
 * 客户端改了（只报玩家自己敲的名字），但**旧版本的包还在外面跑**，所以服务端也判一遍
 * （`leakShaped`）。下面 ⑴⑵⑶ 量的就是那一套，⑷ 是客户端那一头的静态断言。
 *
 * 五种改坏法都真的试过一遍，每一条都如期红：写的时候不判（⑴）、读的时候不过滤（⑶）、
 * `leakShaped` 少认一种形状（⑴ 或 ⑶）、`leaderboardName` 又去读第一串（⑷）。
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
  // 交卷那一路把 `data.totalScore` / `data.shapeId` 对齐到顶层那两个字段：真客户端报的
  // 就是这样（顶层那两个本来就是从 `data` 算出来的，见 engine/cloudScores.ts），而服务端
  // 2026-10-03 起要求两处说同一件事（对不上 400 mismatch，门是 check-scores-guard）。这
  // 台门的夹具只写了 `data: { rules: 'ero1' }`，不补的话每一条交卷都 400，而它要量的是榜
  // 上那一行印了什么——和两处对不对得上没有关系。
  if (body?.action === 'push') {
    body = {
      ...body,
      data: { shapeId: body.mode, totalScore: body.score, ...(body.data || {}) },
    };
  }
  const out = { code: 0, payload: null };
  await scores(
    { method: 'POST', body, headers: { 'x-vercel-forwarded-for': '10.2.0.1' } },
    { status(c) { out.code = c; return this; }, setHeader() {}, end(t) { out.payload = JSON.parse(t); } },
  );
  return { status: out.code, body: out.payload };
}

/**
 * 造一个能证明自己的账号，回它的 id 和令牌。
 *
 * `register` 为真就顺手从改名接口登记昵称（第 16 推起那是名字进库的唯一一条路——push 里带的
 * 名字服务器一个字都不读了）。下面 ⑴⑵ 那两个要量「push 带名字也存不进去」，不登记。
 */
async function player(id, name, { register = true } = {}) {
  const acc = newAccount('pw1234', 'code');
  acc.until = Date.UTC(2999, 0, 1);   // 天才，否则看榜那道门会拦（scores.js 的 isGenius）
  await saveAccount(id, acc);
  if (register) {
    const r = await call({ action: 'name', email: id, token: acc.token, name });
    if (r.status !== 200) throw new Error(`登记昵称失败：${id} ${r.status} ${JSON.stringify(r.body)}`);
  }
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

// ── ⑴⑵⑶ 名字那一格：长得像凭据的不许存、不许显示 ───────────────
//
// ⚠️ 下面这几条**要自带账号**，不能用上面那两个：它们的昵称（小明 / 阿花）是好名字，而这
// 一节要的是「名字恰好长得像凭据」。而且这一节会往 lbnames 里写，和上面那几条共用账号的话
// 两边会互相踩。
{
  const { hgetall, hset } = await import('../api/_store.js');
  const NAMES = 'lbnames';

  // ⑴ 旧客户端（不带 nameV）报一个「像第一串」的名字：不许存进去。
  //    （第 16 推起 push 里的名字一律不读，这一条照旧成立——它现在量的是「不读」本身。）
  const H = await player(pairKey('LeakGate1'), 'Abcdefghij', { register: false });   // 10 位字母，正是第一串的形状
  const r1 = await call({
    action: 'push', email: H.id, token: H.token,
    runId: 'leak-1', mode: 'square', score: 777, name: H.name, data: { rules: 'ero1' },
  });
  check('（尺子）⑴ 这一局报上去了', r1.status === 200 && r1.body?.stored !== false, JSON.stringify(r1.body));
  const after1 = await hgetall(NAMES);
  check('⑴ 旧客户端报的「像第一串」的名字没存进库里', !after1[H.id],
    JSON.stringify(after1[H.id] ?? null));

  // ⑵ 同一个人，第 3 推那一版的客户端（nameV: 2）报同一个名字：**第 16 推起也存不进去**。
  //    从前这一条量的是「要存」——那时名字随 push 报，nameV 是「玩家自己敲的」的记号。现在
  //    昵称只有改名接口写得进去（api/scores.js 的 rename），push 一个字的名字都不读：不然一
  //    台装着旧包的手机打完一局，就把他在别处刚改好的名字盖回去了。
  const r2 = await call({
    action: 'push', email: H.id, token: H.token,
    runId: 'leak-2', mode: 'square', score: 778, name: H.name, nameV: 2, data: { rules: 'ero1' },
  });
  check('（尺子）⑵ 这一局也报上去了', r2.status === 200 && r2.body?.stored !== false, JSON.stringify(r2.body));
  const after2 = await hgetall(NAMES);
  check('⑵ 带着 nameV 报上来的名字也没存进库里（名字只走改名接口）', !after2[H.id],
    JSON.stringify(after2[H.id] ?? null));

  // ⑶ 库里躺着一条旧的（手摆进去，模拟改版之前存下的）：**榜上显示成空**。
  //    这一条量的是**读**那一头——库里那些要等管理员跑一次 scrubNames 才清掉，在那之前
  //    每一张榜都在把它们印出来。
  const M = await player('leakmail@example.com', 'ignored', { register: false });
  await call({
    action: 'push', email: M.id, token: M.token,
    runId: 'leak-3', mode: 'square', score: 779, name: '', data: { rules: 'ero1' },
  });
  // 'leakmail' = 邮箱 @ 前面那一截，正是旧客户端会印上去的那个。
  await hset(NAMES, M.id, { name: 'leakmail', avatar: null });
  const got = await board('square:base');
  const row = got.body.rows.find((x) => x.score === 779);
  check('（尺子）⑶ 那一行在榜上', Boolean(row), JSON.stringify(got.body.rows).slice(0, 120));
  check('⑶ 库里那条旧的「像邮箱」的名字，榜上显示成空', row?.name === '', JSON.stringify(row));
  check('⑶ 整份回包里也找不到它', !JSON.stringify(got.body).includes('leakmail'));
  // 尺子：一个**好**名字照旧印得出来——⑶ 不是靠「所有名字都印成空」混过去的。（第 16 推之
  // 前这儿找的是 H 那一行，它的名字是 ⑵ 存进去的；现在 ⑵ 存不进去了，换成开头从改名接口登
  // 记过的那一个。）
  const good = got.body.rows.find((x) => x.name === MAIL.name);
  check('（尺子）⑶ 好名字照旧印得出来', Boolean(good), JSON.stringify(got.body.rows).slice(0, 160));
}

// ── ⑷ 客户端那一头：榜上那个名字的来路里不许再出现那两样 ───────────
//
// 静态断言，读源码。为什么非读源码不可：这几个函数要在浏览器里才跑得起来
// （localStorage、entitlement），而它们犯的那个错恰恰是「多看了一眼本来不该看的东西」——
// 那是源码里看得最清楚的一件事。
//
// 第 16 推起这条路是 engine/nickname.ts 的 `leaderboardName()` → `getNickname()`（从
// cloudScores.ts 搬过去的），两个函数体都量。
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/engine/nickname.ts', import.meta.url), 'utf8');
  const bodyOf = (sig) => {
    const at = src.indexOf(sig);
    return at < 0 ? '' : src.slice(at, src.indexOf('\n}', at));
  };
  const lb = bodyOf('export function leaderboardName()');
  const get = bodyOf('export function getNickname()');
  check('（尺子）⑷ 找到了 leaderboardName 和 getNickname', lb.length > 0 && get.length > 0,
    `${lb.length} / ${get.length}`);
  check('⑷ leaderboardName 只是 getNickname（不另找名字）', /return getNickname\(\);/.test(lb), lb.slice(0, 200));
  for (const [label, body] of [['leaderboardName', lb], ['getNickname', get]]) {
    check(`⑷ ${label} 的函数体里不许出现 handle（那是第一串，一把钥匙）`, !/\bhandle\b/.test(body), body.slice(0, 200));
    check(`⑷ ${label} 的函数体里不许出现 signedInEmail`, !/signedInEmail/.test(body), body.slice(0, 200));
  }
  // 尺子：它还认得那个昵称键——上面几条不是靠「整个函数被删了」绿的。
  check('（尺子）⑷ getNickname 照旧读那个昵称键', get.includes('PLAYER_NAME_KEY'));
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

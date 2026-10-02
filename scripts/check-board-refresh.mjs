/**
 * 排行榜「新不新」那三件事——纯 node，不开浏览器，几十毫秒。
 *
 *   npx esbuild src/engine/cloudScores.ts --bundle --format=esm --outfile=/tmp/cloudscores.mjs
 *   node scripts/check-board-refresh.mjs /tmp/cloudscores.mjs
 *
 * ── 为什么要一道门 ────────────────────────────────────────────
 *
 * 这三件事坏起来**一个字都不报**，只是玩家看到的东西不对：
 *
 *   · 缓存的期限写错 —— 写长了（比如 10 分钟），别人刚上榜他要等十分钟才看得到，而他只
 *     会以为「这个榜是假的」；写成 0 就回到从前那一屏「点一下闪一下」。
 *   · 缓存进了 localStorage —— 一张榜是**别人**的东西，留到下次打开网页就成了「他看到的
 *     是上周的名次」。
 *   · 打完一局不作废缓存 —— 玩家刚刷新了自己的最高分，点开排行榜还是旧名次。这一条最
 *     刺眼，因为那一刻他正等着看自己那一行。
 *   · `waitForPush` 不设上限 —— 真断网的时候那一屏永远停在「加载中」。
 *   · 上报失败不重试 —— 失败最常见的来处正是「刚打完这一局，网刚好抖了一下」。
 *
 * ── 怎么在 node 里跑得起来 ────────────────────────────────────
 *
 * `cloudScores.ts` 只碰两样浏览器的东西：`fetch` 和 `localStorage`。两样都用一个假的顶
 * 掉，于是整条路（auth → post → 缓存）都是真的在跑，只有网络那一下是假的。时间也不假：
 * 下面那些等待都是真的 `setTimeout`，所以这道门会花掉几秒——TTL 那一条用「把时间往前拨」
 * 的办法避开十秒的真等待（改不了 `Date.now`，所以改成**等一小段 + 量 TTL 常量**那种写法
 * 在这儿不成立；见 ③ 那一节怎么做的）。
 */
const [bundle] = process.argv.slice(2);
if (!bundle) {
  console.error('用法：node scripts/check-board-refresh.mjs <打包好的 cloudscores.mjs>');
  console.error('先 npx esbuild src/engine/cloudScores.ts --bundle --format=esm --outfile=/tmp/cloudscores.mjs');
  process.exit(2);
}

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// ── 假的浏览器：只有这两样 ──────────────────────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => void store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
globalThis.window = { localStorage: globalThis.localStorage };
globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };

/** 假网络：每一趟都记下来，而且可以让它失败。 */
let calls = [];
let netOk = true;
let serveRows = 1;
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  calls.push({ url: String(url), action: body.action, mode: body.mode ?? '', body });
  if (!netOk) return { ok: false, status: 500, json: async () => ({}) };
  return {
    ok: true,
    status: 200,
    json: async () => ({ mode: body.mode ?? '', rows: Array.from({ length: serveRows }, (_, i) => ({
      rank: i + 1, name: 'n' + i, score: 100 - i, me: false,
    })), players: serveRows, me: null }),
  };
};

/**
 * 一个「登着的」身份：`auth()` 要 token + email，不然所有调用原地返回 null，而这道门会在
 * 一片 `signedOut` 上全红——那也正是它第一次跑的样子（键名猜错了）。
 *
 * 键名是 `engine/subscription.ts` 的 `KEY`。写死在这儿是没办法：那个常数没导出，而这道门
 * 打包的是 `cloudScores.ts`，碰不到它。⓪ 那一节就是为此存在——键名哪天改了，它当场红，而
 * 不是让下面二十条断言在一张空榜上「全绿」。
 */
const ENTITLEMENT_KEY = 'slides_genius';
/**
 * ⚠️ `handle` 一定要摆进去（第一串的原文，只有这台设备有）。
 *
 * ⑦ 那一条量的正是「没取名字时**不许**拿它顶上」——而这份身份里要是压根没有 handle，那一
 * 条就成了空绿：函数返回空串不是因为它不去读，而是因为没东西可读。第一版就是这样，
 * 「把那一行加回去」这个反向对照一条都没红。
 */
const SECRET_FIRST = 'SecretFirst1';
store.set(ENTITLEMENT_KEY, JSON.stringify({
  active: true, channel: 'code', email: 'refresh@example.com', token: 'TOK', handle: SECRET_FIRST,
}));

const api = await import(bundle);
const { cachedBoard, fetchBoard, invalidateBoards, pushRun, waitForPush, leaderboardName, NAME_V } = api;

// ── ⓪ 前提：这套假浏览器真的让它跑起来了 ────────────────────────
{
  const r = await fetchBoard();
  check('⓪ 取得到榜（否则下面每一条都是空绿）', r.ok === true && r.page.rows.length === 1,
    JSON.stringify(r).slice(0, 120));
  check('⓪ 真的打了一次 /api/scores', calls.length === 1 && calls[0].action === 'board',
    JSON.stringify(calls));
}

// ── ① 缓存：同一张榜不再打第二次 ────────────────────────────────
{
  calls = [];
  const had = cachedBoard();
  check('① 刚取过那一张，缓存里有', Boolean(had) && had.rows.length === 1);
  check('① 读缓存不打网络', calls.length === 0, String(calls.length));

  // 另一张榜（另一个 mode）是另一格，不许串台。
  check('① 没取过的那张榜缓存里没有', cachedBoard('square:base') === null);
  await fetchBoard('square:base');
  check('① 取过之后它才有', Boolean(cachedBoard('square:base')));
  check('① 两格互不干扰（总榜那一格还在）', Boolean(cachedBoard()));
}

// ── ② 打完一局：整张表作废 ──────────────────────────────────────
//
// 这一条最刺眼：玩家刚刷新了自己的最高分，点开排行榜还是旧名次。
{
  calls = [];
  pushRun({ at: Date.now(), shapeId: 'square', modeKey: 'base', totalScore: 42 }, '我');
  check('② 上报真的发出去了', calls.some((c) => c.action === 'push'), JSON.stringify(calls.map((c) => c.action)));
  check('② 总榜那一格作废了', cachedBoard() === null);
  check('② 别的榜那一格也作废了（自己那一行可能在任何一张上）', cachedBoard('square:base') === null);
  // 顺带钉住那一位：服务端靠它分得出「这个名字是玩家自己敲的」。
  const push = calls.find((c) => c.action === 'push');
  check('② 上报带着 nameV，而且就是 NAME_V', push?.body?.nameV === NAME_V, String(push?.body?.nameV));
  await waitForPush();
}

// ── ③ 期限：十秒，而且只在内存里 ────────────────────────────────
//
// 真等十秒太贵，所以从两头夹：
//   · 用假的 Date.now 把时间往前拨 11 秒，缓存必须过期；
//   · 拨回来之后同一格不许「活过来」——那会说明它存的是别的东西（比如写死了一个很远的
//     过期时间）。
{
  await fetchBoard();
  check('（尺子）③ 刚取过，缓存里有', Boolean(cachedBoard()));
  const realNow = Date.now;
  Date.now = () => realNow() + 11_000;
  check('③ 过了十一秒就过期了', cachedBoard() === null);
  Date.now = realNow;
  check('③ 时间拨回来它也不复活（过期那一下是真删了）', cachedBoard() === null);

  // 只在内存里：整张表没有一个字进 localStorage。
  await fetchBoard();
  const keys = [...store.keys()];
  const leaked = keys.filter((k) => {
    const v = store.get(k) || '';
    return v.includes('"rank"') || v.includes('rows');
  });
  check('③ 榜没有一行进 localStorage（它是别人的东西，不留到下次打开）',
    leaked.length === 0, leaked.join(' '));
  check('（尺子）③ localStorage 本身是通的（上面那条不是因为它坏了）',
    keys.includes(ENTITLEMENT_KEY), keys.join(' '));
}

// ── ④ invalidateBoards 自己 ─────────────────────────────────────
{
  await fetchBoard();
  check('（尺子）④ 有缓存', Boolean(cachedBoard()));
  invalidateBoards();
  check('④ 清掉了', cachedBoard() === null);
}

// ── ⑤ 上报失败：隔一会儿再试一次 ────────────────────────────────
{
  calls = [];
  netOk = false;
  pushRun({ at: Date.now() + 1, shapeId: 'circle', modeKey: 'base', totalScore: 7 }, '我');
  // 第一趟当场发出去，第二趟要等约两秒。
  await new Promise((r) => setTimeout(r, 300));
  const firstOnly = calls.filter((c) => c.action === 'push').length;
  check('⑤ 先只发了一趟', firstOnly === 1, String(firstOnly));
  await waitForPush(4000);
  const total = calls.filter((c) => c.action === 'push').length;
  check('⑤ 失败之后又试了一趟（一共两趟，不是无限重试）', total === 2, String(total));
  netOk = true;
}

// ── ⑥ waitForPush 有上限：真断网也不许无限等 ────────────────────
{
  netOk = false;
  pushRun({ at: Date.now() + 2, shapeId: 'square', modeKey: 'timed', totalScore: 9 }, '我');
  const t0 = Date.now();
  await waitForPush(300);
  const spent = Date.now() - t0;
  check('⑥ 说了最多等 300ms 就只等那么久（上报还没落地）', spent < 1200, `${spent}ms`);
  netOk = true;
  await waitForPush(5000);
}

// ── ⑦ 名字：只回玩家自己敲的那一个 ──────────────────────────────
//
// 这一条和 check-board-no-id 的 ⑷ 是一对：那边读源码（不许出现 handle / signedInEmail），
// 这边量行为（没取过名字就是空串，取过就是那一个）。两样都要，因为源码那一条拦不住「换
// 个名字读同一样东西」，而行为这一条拦不住「读了但这一次恰好没值」。
{
  store.delete('slides_mp_name');
  check('⑦ 没取过名字 → 空串（不拿凭据顶上）', leaderboardName() === '', JSON.stringify(leaderboardName()));
  // 两条尺子，缺一条上面那句就是空绿：
  //   · 这时候是**登着的**（有 token 和邮箱）——不是「因为没登录所以没名字」；
  //   · 手上**确实有**第一串——它就在 entitlement 里，函数只是不去读。
  const who = JSON.parse(store.get(ENTITLEMENT_KEY));
  check('（尺子）⑦ 这时候是登着的', who.token === 'TOK' && who.email === 'refresh@example.com');
  check('（尺子）⑦ 而且手上真有第一串（不去读 ≠ 没东西可读）', who.handle === SECRET_FIRST);
  check('⑦ 第一串一个字都没出现在名字里', !leaderboardName().includes('Secret'));
  store.set('slides_mp_name', '  阿花  ');
  check('⑦ 取过就是那一个（前后空白剥掉）', leaderboardName() === '阿花', JSON.stringify(leaderboardName()));
  store.set('slides_mp_name', 'x'.repeat(30));
  check('⑦ 最多十二个字', leaderboardName().length === 12, String(leaderboardName().length));
}

console.log(fail ? `\n${fail} 条红` : '\n全绿');
process.exit(fail ? 1 : 0);

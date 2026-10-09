/**
 * 「谁算天才」这道题，问的人得先证明自己是谁。
 *
 *   node scripts/check-entitlement.mjs
 *
 * 盯的是一个真出过的漏洞：判断刷卡订阅那一支，原来只看请求里写的邮箱，不
 * 看打请求的人是不是这个邮箱的主人。于是任何人——不用注册、不用登录、不用
 * 花一分钱——只要报出一个正在付费的邮箱（收据上就印着，写过信的人都知道），
 * 就能开走一间本该收费的小屋、看到本该锁着的排行榜，而付钱那位毫不知情。
 *
 * 这里不起服务器、不连 Redis、也不真去问 Creem：账户库用进程内的那份
 * （ALLOW_MEMORY_STORE=1），Creem 的两次 HTTP 用一个假的 fetch 顶掉——顺便
 * 数一数它被叫了几次。「一次都没叫」本身就是结论：连问都不该问。
 *
 * 加 --old 会把上一版的 _entitlement.js 拉出来跑同一套，用来确认这些断言
 * 在修之前确实是红的（不是写了一堆永远会过的话）。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

process.env.ALLOW_MEMORY_STORE = '1';
process.env.CREEM_API_KEY = 'creem_test_stub';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// ---- 假的 Creem：谁来问都说「这个邮箱正在付费」 --------------------------
let asked = 0;
const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
globalThis.fetch = async (url) => {
  const u = String(url);
  if (!u.includes('creem.io')) throw new Error('unexpected fetch: ' + u);
  asked++;
  if (/\/v1\/customers\/[^/]+\/subscriptions/.test(u)) return json({ items: [{ status: 'active' }] });
  if (u.includes('/v1/customers')) return json({ id: 'cus_1', email: 'paying@example.com' });
  return json({});
};

const useOld = process.argv.includes('--old');
const OLD = 'api/_entitlement.old.mjs';
if (useOld) {
  writeFileSync(OLD, execFileSync('git', ['show', 'HEAD:api/_entitlement.js'], { encoding: 'utf-8' }));
}
const { isGenius } = await import('../' + (useOld ? OLD : 'api/_entitlement.js'));
const { saveAccount } = await import('../api/_accounts.js');

// 一个真的刷卡订阅户：我们自己的库里只有账号和令牌，权益在 Creem 那边，
// 所以 until 是 0——这正是那条「去问 Creem」的分支存在的理由。
await saveAccount('paying@example.com', { token: 'TOKEN-OF-THE-PAYER', until: 0 });
// 一个自己也有账号、但没付钱的人。他有一个完全合法的令牌。
await saveAccount('freeloader@example.com', { token: 'TOKEN-OF-THE-FREELOADER', until: 0 });

asked = 0;
check('光报一个别人的邮箱，不算天才',
  (await isGenius({ email: 'paying@example.com' })) === false);
check('连问都不该去问 Creem', asked === 0, `问了 ${asked} 次`);

asked = 0;
check('拿一个乱编的令牌也不算',
  (await isGenius({ email: 'paying@example.com', accountToken: 'GUESS' })) === false);
check('同样一次也不问', asked === 0, `问了 ${asked} 次`);

asked = 0;
check('自己有合法令牌，但报的是别人的邮箱，还是不算',
  (await isGenius({ email: 'paying@example.com', accountToken: 'TOKEN-OF-THE-FREELOADER' })) === false);
check('这一次也不问', asked === 0, `问了 ${asked} 次`);

asked = 0;
check('本人拿着自己的令牌来，才算',
  (await isGenius({ email: 'paying@example.com', accountToken: 'TOKEN-OF-THE-PAYER' })) === true);
check('这时候才去问 Creem', asked > 0, `问了 ${asked} 次`);

asked = 0;
check('光说一句「我是商店买的」，不算（商店版上线前接收据校验，见 _entitlement.js）',
  (await isGenius({ storeClaim: true })) === false);
check('说这句也不去问 Creem', asked === 0, `问了 ${asked} 次`);

// ---- 「终身」只许有一个数 ---------------------------------------------------
/*
 * 这一节守的是 2026-10 查出来的那件事：`api/_entitlement.js` 自己写了一个
 * `LIFETIME_UNTIL = Date.UTC(2099, 0, 1)`，而 `api/_accounts.js` 那一份是
 * `Date.UTC(2999, 0, 1)`。两个数不一样，后果是**窗口期送出去的那一份没人认得是终身**：
 * `ownGrantLive` 认（2099 还没到，他是天才），可 `isLifetime()` 和订阅窗口那一行问的
 * 是 `>= 2999`——屏幕上于是写「有效期至 2099/1/1」，不是「永久」。
 *
 * 客户端那一份（`src/ui/subscribe.ts`）也抄了一个常量，注释还写着「as the server
 * writes it (api/_accounts.js LIFETIME_UNTIL)」——所以三处必须是同一个数，而且后两处
 * 要能认出第一处写进去的那个值。
 */
console.log('');
{
  const accounts = await import('../api/_accounts.js');
  const ent = await import('../api/_entitlement.js');
  // 尺子先行：两处都真的导出了这个常量，否则下面每一句都是恒真的。
  check('（尺子）两个服务端模块都导出了 LIFETIME_UNTIL',
    Number.isFinite(accounts.LIFETIME_UNTIL) && Number.isFinite(ent.LIFETIME_UNTIL),
    `${accounts.LIFETIME_UNTIL} / ${ent.LIFETIME_UNTIL}`);
  check('服务端两处是同一个数',
    accounts.LIFETIME_UNTIL === ent.LIFETIME_UNTIL,
    `${accounts.LIFETIME_UNTIL} vs ${ent.LIFETIME_UNTIL}`);
  // 真正要紧的是**行为**：窗口期写进去的那个值，isLifetime 必须认得。
  check('窗口期写的那个 until，isLifetime() 认得是终身',
    accounts.isLifetime({ until: ent.LIFETIME_UNTIL }) === true);
  check('而且它确实还没到期（ownGrantLive 那一头也认）',
    ent.LIFETIME_UNTIL > Date.now());

  // 客户端那一份：读源码文本，不打包（它是 .ts，而这道门是纯 node 的）。
  //
  // **第 17 推起客户端没有这一份了**：它只在帐号窗的《有效期》那一行里用（「永久」还是
  // 一个日期），而方案把那一行撤了（注册即终身，那一行对每个人写的都是「永久」）。所以这
  // 儿不再要求「找得到」，改成：src/ 底下**哪儿都没有**另抄的一份；哪天谁又抄回来一份，
  // 它就必须和服务端是同一个数。只写一句「找不到就算了」的话，抄回来一个 2099 也是绿的。
  const { readFileSync, readdirSync } = await import('node:fs');
  const srcRoot = new URL('../src/', import.meta.url);
  const copies = [];
  for (const rel of readdirSync(srcRoot, { recursive: true })) {
    if (!/\.(ts|js|mjs)$/.test(rel)) continue;
    const text = readFileSync(new URL(rel, srcRoot), 'utf8');
    for (const m of text.matchAll(/LIFETIME_UNTIL\s*=\s*Date\.UTC\((\d+),\s*(\d+),\s*(\d+)\)/g)) {
      copies.push({ rel, val: Date.UTC(Number(m[1]), Number(m[2]), Number(m[3])) });
    }
  }
  // 尺子：这个扫法真的扫得到东西（src/ 底下的 .ts 一个都没读到的话，「没有另抄一份」恒真）。
  const scanned = readdirSync(srcRoot, { recursive: true }).filter((r) => /\.ts$/.test(r)).length;
  check('（尺子）src/ 底下扫过的 .ts 不少于 50 个', scanned >= 50, `${scanned} 个`);
  const drift = copies.filter((c) => c.val !== accounts.LIFETIME_UNTIL);
  check('客户端要是另抄了一份，它和服务端是同一个数', drift.length === 0,
    drift.map((c) => `${c.rel}: ${c.val}`).join('；') || `${copies.length} 份，全对得上`);
  // `_entitlement.js` 不许再自己定一个——转出去可以，自己写一个字面量不行。
  const entSrc = readFileSync(new URL('../api/_entitlement.js', import.meta.url), 'utf8');
  check('_entitlement.js 里没有自己写死的那个日期',
    !/const LIFETIME_UNTIL = Date\.UTC\(/.test(entSrc));
}

// ---- 窗口期授予：开关默认关着，关着的时候一步都不走 --------------------------
{
  const ent = await import('../api/_entitlement.js');
  const accounts = await import('../api/_accounts.js');
  const before = process.env.GENIUS_GRANT_WINDOW;

  delete process.env.GENIUS_GRANT_WINDOW;
  check('没填环境变量时窗口是关的', ent.grantWindowOpen() === false);
  {
    /*
     * 拿一个**库里真有的**账号来试。
     *
     * 头一版这儿喂的是一个凭空造的对象、而且那个邮箱库里根本没有——于是把那道
     * `if (!grantWindowOpen())` 整个删掉，`updateAccount` 也只是答 missing、什么都没
     * 写，断言照样绿。反面对照当场把这条空绿掀出来了。要验「关着就不写」，就得让它
     * 在开着的时候**真的写得进去**。
     */
    const addr = 'closed@example.com';
    await accounts.createAccount(addr, { until: 0 });
    const snap = await accounts.loadAccount(addr);
    await ent.grantLifetimeIfWindow(addr, snap);
    const after = await accounts.loadAccount(addr);
    check('窗口关着：库里那一份一个字都没动',
      !after.until && !after.grantedAt, JSON.stringify(after));
  }
  process.env.GENIUS_GRANT_WINDOW = '0';
  check('填 0 也是关的', ent.grantWindowOpen() === false);
  process.env.GENIUS_GRANT_WINDOW = '1';
  check('填 1 才是开的', ent.grantWindowOpen() === true);
  // 开着的时候写进去的那一份，必须是上面那个「大家都认得」的数。
  {
    const addr = 'grantme@example.com';
    // 最小的一份账号：这一节只关心 until / grantedAt 两位，别的字段不参与判定。
    await accounts.createAccount(addr, { until: 0 });
    const acct = await accounts.loadAccount(addr);
    const out = await ent.grantLifetimeIfWindow(addr, acct);
    check('窗口开着：写进去的是终身，而且 isLifetime 认得',
      accounts.isLifetime(out) === true, String(out && out.until));
    check('记了一笔什么时候送出去的（grantedAt）', Number.isFinite(out && out.grantedAt));
    /*
     * 幂等：再叫一次不许刷新那个时间戳（将来重开 creem 要按它对账）。
     *
     * **两道门，要分开验。** 外面那一道看的是手里这份快照（`account.until` 已经是终身
     * 就原地返回）；锁里那一道看的是**库里此刻那一份**。只验外面那道是不够的——头一版
     * 就只验了它，于是把锁里那一句删掉，断言照样绿。
     */
    const stamp = out.grantedAt;
    const again = await ent.grantLifetimeIfWindow(addr, out);
    check('再叫一次（快照是新的）：外面那道门拦住，grantedAt 没动', again.grantedAt === stamp);
    // 并发时真会发生的那一种：别处刚送过，手里这份快照还是旧的。外面那道门看不出来，
    // 拦住重写的只剩锁里那一道。
    const stale = { ...out, until: 0, grantedAt: undefined };
    await ent.grantLifetimeIfWindow(addr, stale);
    const re = await accounts.loadAccount(addr);
    check('拿旧快照再叫一次：锁里那道门拦住，grantedAt 还是原来那个',
      re.grantedAt === stamp, `${re.grantedAt} vs ${stamp}`);
  }
  if (before === undefined) delete process.env.GENIUS_GRANT_WINDOW;
  else process.env.GENIUS_GRANT_WINDOW = before;
}

// ---- 名额撤了：不许再出现任何计数 ----------------------------------------------
/*
 * 这儿原先有一整节（约 115 行）量「名额」：`GENIUS_GRANT_LIMIT` 的回落、`grantsUsed` /
 * `slotsLeft` 的加减、满了之后真的不再送、并发时正好只有一个人拿到。2026-10-02 名额整个
 * 撤了（E39，玩家：「不限人数」），那一节连同被它测的那几个导出一起没了。
 *
 * 留一条**反面尺子**在这儿：那几个名字不许回来。
 *
 * 为什么值得留：名额这件事「加回去」太容易了——一个 hincrby 加两行判断。而它一旦悄悄回
 * 来，界面上那句写死的「注册后免费立即解锁全部内容」就成了假话（名额满了之后注册得成、
 * 却不是天才），**而屏幕上什么都不报**。这条尺子读的是源码本身，所以它拦的是「有人写回
 * 去」，不是「某次调用的结果」。
 */
console.log('');
{
  const src = readFileSync(new URL('../api/_entitlement.js', import.meta.url), 'utf8');
  const GONE = ['GENIUS_GRANT_LIMIT', 'grantsUsed', 'slotsLeft', 'genius:grants', 'hincrby'];
  // 注释里会提到这些名字（说明「这儿原先有一套」），所以先把注释剥掉再找。
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
  const back = GONE.filter((n) => code.includes(n));
  check('名额那一套没回来（代码里一个都不许有）', back.length === 0, back.join(' '));
  // 尺子：剥注释这一步没把整份源码剥空，不然上面那条永远绿。
  check('（尺子）剥掉注释之后代码还在', code.includes('export async function grantLifetimeIfWindow'));
  // 而幂等那道短路必须留着——撤掉的是计数，不是「别重复写」。
  check('幂等短路留着（撤的是计数，不是别重复写）',
    /if \(\(account\.until \|\| 0\) >= LIFETIME_UNTIL\) return account;/.test(code));
  // 还有那段 E54 的注释：关掉开关会让界面上那句话变成假话，必须钉在源码里。
  check('E54 那段警告还钉在 grantWindowOpen 旁边',
    /关掉它会让界面上那句话变成假话/.test(src) && /GENIUS_GRANT_WINDOW/.test(src));
}

// ---- 客户端：退款 / 拒付之后，本机的权限要跟着撤（2026-10-08 方案 1-6）--------
//
// src/engine/creem.ts 的 webRefresh 从前把「服务器答 active: false」和「网络断了」一起折成 null，
// 调用方（subscription.ts 的 refreshEntitlement）于是「保持原样」：退了款的那一份照旧开着权限，
// 直到本机记的 until 自己过期。这一节把真的那两个文件打成一包，在 node 里搭一个最小的浏览器
// （window.location、localStorage、fetch），跑几遍开机那一下。
//
// ⚠️ **10-09 补充方案 7-9：这一节原先是假绿。** 它摆的本机那一份是手写的 `channel: 'web'`，而真登录
// 路径（signInWithCode / pairAuth）一律写死 `channel: 'code'`——开机那一下对「还在有效期的码」根本不
// 去问（codeStillLive），退款永远传不回来，这一节却照样全绿。现在每一遍都**走真的登录那一步**（验证
// 码登录，回包照服务端刷卡订阅那一支的样子：不带 kind），本机那一份由 signedInChannel 写出来。
// 另加两条：服务端说权益在我们自己库里（kind: 'code'）就记 'code'、开机不去问；原生 App 一律 'code'
// （记成 'web' 的话下次开机 read() 就当他登出了）。
{
  const { build } = await import('esbuild');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'ent-client-'));
  await build({
    entryPoints: [new URL('../src/engine/subscription.ts', import.meta.url).pathname],
    bundle: true, format: 'esm', outfile: join(dir, 'subscription.mjs'), logLevel: 'error',
  });
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  globalThis.window = {
    location: { protocol: 'https:', hostname: 'play-slides.com', search: '', origin: 'https://play-slides.com', pathname: '/' },
    history: { replaceState() {} },
  };
  const realFetch = globalThis.fetch;
  let answer = null; // 下一次 /api/subscription 答什么；'offline' 就是网断了
  let signinReply = null; // 下一次 /api/signin（验证码登录）答什么
  let askedRefresh = 0;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/api/signin')) return { ok: true, status: 200, json: async () => signinReply };
    if (!u.includes('/api/subscription')) throw new Error('unexpected fetch: ' + url);
    askedRefresh++;
    if (answer === 'offline') throw new TypeError('Failed to fetch');
    return { ok: true, status: 200, json: async () => answer };
  };
  const sub = await import(join(dir, 'subscription.mjs'));
  const EMAIL = 'refunded@example.com';
  const TOKEN = 'DEVICE-TOKEN-1';
  const YEAR = () => Date.now() + 300 * 86400e3;
  /**
   * 退款前的样子，**由真的登录那一步写出来**：验证码登录，服务端答「是天才、一年后到期」——刷卡订阅
   * 那一支（api/_entitlement.js 的 answer）不带 kind。`kind` 给了，就是「权益在我们自己库里」那一种。
   */
  const signedIn = async (kind) => {
    sub.clearEntitlement();
    signinReply = { ok: true, active: true, email: EMAIL, token: TOKEN, period: 'yearly', until: YEAR(), ...(kind ? { kind } : {}) };
    const r = await sub.signInWithCode(EMAIL, '123456', false, 'ticket-1');
    return r.ok === true;
  };
  try {
    check('⑪（尺子）真的登录那一步走通了', await signedIn());
    check('⑪ 刷卡订阅登录进来：本机记的柜台是 web（不是写死的 code）', sub.entitlement().channel === 'web', String(sub.entitlement().channel));
    check('⑪ 客户端量程：本机现在是天才', sub.isGenius() === true);
    answer = { active: false, email: EMAIL, token: TOKEN, kind: 'card' };
    await sub.refreshEntitlement();
    check('⑪ 服务器答 active: false（退款 / 拒付）：本机的权限撤了', sub.isGenius() === false,
      JSON.stringify(sub.entitlement()));
    check('⑪ 但人还登着：邮箱和令牌都还在（「登着」和「是天才」是两件事）',
      sub.signedInEmail() === EMAIL && sub.entitlement().token === TOKEN, JSON.stringify(sub.entitlement()));
    check('⑪ 撤了的那一份也写进了本机存档（刷新之后不会回来）',
      JSON.parse(store.get('slides_genius') || '{}').active === false, String(store.get('slides_genius')));

    await signedIn();
    answer = { active: false, email: EMAIL, kind: 'card' };
    await sub.refreshEntitlement();
    check('⑪ 回包里没带令牌：留着手上这一把', sub.entitlement().token === TOKEN && sub.isGenius() === false,
      JSON.stringify(sub.entitlement()));

    await signedIn();
    answer = 'offline';
    await sub.refreshEntitlement();
    check('⑪ 网断了（没答案）：本机那份照旧，不许当成「不是」', sub.isGenius() === true, JSON.stringify(sub.entitlement()));

    await signedIn();
    answer = { active: true, email: EMAIL, token: TOKEN, kind: 'card', period: 'yearly', until: YEAR() };
    await sub.refreshEntitlement();
    check('⑪ （尺子）还在付费：照旧是天才', sub.isGenius() === true);

    // 权益在我们自己库里（内部码、注册送的终身）：服务端回 kind: 'code'，本机记 'code'，开机不去问——码自
    // 带到期日，没人替它续。
    await signedIn('code');
    check('⑪ 服务端说 kind: code：本机记的柜台是 code', sub.entitlement().channel === 'code', String(sub.entitlement().channel));
    const before = askedRefresh;
    answer = { active: false, email: EMAIL, token: TOKEN };
    await sub.refreshEntitlement();
    check('⑪ 还在有效期的码：开机不去问（问的次数没涨）', askedRefresh === before && sub.isGenius() === true, `${before} → ${askedRefresh}`);
  } finally {
    sub.clearEntitlement();
  }

  // 原生 App：一律 'code'。另起一份模块（channel.ts 的 salesChannel 读一次就记住），开之前先摆上
  // Capacitor 那个全局。
  try {
    globalThis.window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' };
    const app = await import(join(dir, 'subscription.mjs') + '?native');
    signinReply = { ok: true, active: true, email: EMAIL, token: TOKEN, period: 'yearly', until: YEAR() };
    await app.signInWithCode(EMAIL, '123456', false, 'ticket-2');
    check('⑪ 原生 App 里登录：柜台照旧记 code（signedInChannel 在 App 里不返回 web）', app.entitlement().channel === 'code',
      String(app.entitlement().channel));
    // 下一次开机 read() 认不认这一份：再起一份模块，只从 localStorage 读。
    const reboot = await import(join(dir, 'subscription.mjs') + '?native-reboot');
    check('⑪ 原生 App 重开之后照旧登着（read() 没把它当成登出）', reboot.signedInEmail() === EMAIL, String(reboot.signedInEmail()));
    // 反面尺子：App 里要是记成 'web'，read() 就把它丢掉——这正是 signedInChannel 在 App 里必须回 'code' 的理由。
    store.set('slides_genius', JSON.stringify({ active: true, channel: 'web', email: EMAIL, token: TOKEN }));
    const reboot2 = await import(join(dir, 'subscription.mjs') + '?native-reboot-2');
    check('⑪（反面尺子）App 里记成 web 的那一份，重开之后 read() 当成登出', reboot2.signedInEmail() === undefined,
      String(reboot2.signedInEmail()));
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.window;
    delete globalThis.localStorage;
  }
}

// ---- ⑫ 年付赠码不再铸（10-09 补充方案 7-15）--------------------------------
//
// 送码那一块第 17 推就从界面上撤了，可刷卡年付的人每次登录，resolveEntitlement 还照旧补铸两张——看不见、
// 送不出去、却真能兑一个月。量两件事：年付的人登录一次，账号上不长出 gifts、回包里的 gifts 是空的；已经
// 铸过、记在账号上的那几张照旧回给客户端（一张还在库里 = 没兑过，一张不在了 = 已经被兑掉）。
console.log('');
{
  process.env.CREEM_PRODUCT_YEARLY = 'prod_yearly_stub';
  const { resolveEntitlement } = await import('../api/_entitlement.js');
  const accounts = await import('../api/_accounts.js');
  const store = await import('../api/_store.js');
  const before = globalThis.fetch;
  const periodEnd = new Date(Date.now() + 300 * 86400e3).toISOString();
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (/\/v1\/customers\/[^/]+\/subscriptions/.test(u)) {
      return json({ items: [{ status: 'active', product: 'prod_yearly_stub', current_period_end_date: periodEnd }] });
    }
    if (u.includes('/v1/customers')) return json({ id: 'cus_yearly', email: 'yearly@example.com' });
    throw new Error('unexpected fetch: ' + u);
  };
  try {
    const fresh = { ...accounts.newAccount('', 'card'), until: 0 };
    await accounts.saveAccount('yearly@example.com', fresh);
    const r = await resolveEntitlement('yearly@example.com', fresh, fresh.token);
    const after = await accounts.loadAccount('yearly@example.com');
    check('⑫（尺子）刷卡年付的人登录：权益照常（Creem 说他是年付）', r.status === 200 && r.body.active === true && r.body.period === 'yearly',
      JSON.stringify({ status: r.status, active: r.body.active, period: r.body.period }));
    check('⑫ 不再给他铸赠码：账号上没长出 gifts，回包里的 gifts 是空的',
      !('gifts' in after) && Array.isArray(r.body.gifts) && r.body.gifts.length === 0, JSON.stringify(r.body.gifts));

    const expiresAt = Date.now() + 20 * 86400e3;
    const old = { ...accounts.newAccount('', 'card'), until: 0, gifts: [{ code: 'GIFTOLD1', expiresAt }, { code: 'GIFTOLD2', expiresAt }] };
    await store.set('code:GIFTOLD1', { plan: 'month', expiresAt });
    await accounts.saveAccount('yearly-old@example.com', old);
    const r2 = await resolveEntitlement('yearly-old@example.com', old, old.token);
    check('⑫ 已经铸过的那两张不动：照旧回给客户端（还在库里的没兑过、不在了的已经被兑掉）',
      (r2.body.gifts || []).map((g) => `${g.code}:${g.spent}`).join() === 'GIFTOLD1:false,GIFTOLD2:true', JSON.stringify(r2.body.gifts));
  } finally {
    globalThis.fetch = before;
    delete process.env.CREEM_PRODUCT_YEARLY;
  }
  // 源码：api/ 里再没有哪一处铸 gift 那一种码，ensureGiftCodes 也不在了。
  const { readdirSync } = await import('node:fs');
  const apiDir = new URL('../api/', import.meta.url);
  const minting = readdirSync(apiDir).filter((f) => f.endsWith('.js'))
    .filter((f) => /source: 'gift'|ensureGiftCodes\(/.test(readFileSync(new URL(f, apiDir), 'utf8')));
  check('⑫ 源码：api/ 里没有一处还在铸赠码', minting.length === 0, minting.join(' '));
}

if (useOld) rmSync(OLD, { force: true });
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项没过`);
process.exit(fail ? 1 : 0);

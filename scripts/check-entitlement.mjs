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
import { writeFileSync, rmSync } from 'node:fs';

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
  const { readFileSync } = await import('node:fs');
  const ui = readFileSync(new URL('../src/ui/subscribe.ts', import.meta.url), 'utf8');
  const m = ui.match(/const LIFETIME_UNTIL = Date\.UTC\((\d+), (\d+), (\d+)\);/);
  check('（尺子）客户端那一份也找得到', Boolean(m), m ? m[0] : '没找到');
  if (m) {
    const uiVal = Date.UTC(Number(m[1]), Number(m[2]), Number(m[3]));
    check('客户端那一份和服务端是同一个数', uiVal === accounts.LIFETIME_UNTIL,
      `${uiVal} vs ${accounts.LIFETIME_UNTIL}`);
  }
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

// ---- 名额：屏幕上印「还剩 N 个」，那个数就得是实话 ------------------------------
/*
 * 玩家 2026-10：第一批开放 100 个名额，**「满了就不再送」**。所以这一节钉的不是「数字会
 * 减」，而是**满了之后真的拿不到终身**——数字停在 0 而照送不误，那一行字就是假话。
 */
console.log('');
{
  const ent = await import('../api/_entitlement.js');
  const accounts = await import('../api/_accounts.js');
  const keepWin = process.env.GENIUS_GRANT_WINDOW;
  const keepLim = process.env.GENIUS_GRANT_LIMIT;

  // 填得不像个数一律回落到 100，**不是回落到「不限」**——印着名额却无限送是假话。
  for (const bad of ['', '0', '-5', 'abc']) {
    process.env.GENIUS_GRANT_LIMIT = bad;
    check(`名额填「${bad}」→ 回落到 100（不是不限）`, ent.GENIUS_GRANT_LIMIT() === 100,
      String(ent.GENIUS_GRANT_LIMIT()));
  }
  delete process.env.GENIUS_GRANT_LIMIT;
  check('没填也是 100（玩家定的第一批）', ent.GENIUS_GRANT_LIMIT() === 100);
  process.env.GENIUS_GRANT_LIMIT = '2.9';
  check('小数往下取整', ent.GENIUS_GRANT_LIMIT() === 2, String(ent.GENIUS_GRANT_LIMIT()));

  process.env.GENIUS_GRANT_WINDOW = '1';
  process.env.GENIUS_GRANT_LIMIT = '2';
  const used0 = await ent.grantsUsed();
  check('（尺子）开局数得出已用了几个', Number.isFinite(used0), String(used0));
  const left0 = await ent.slotsLeft();
  check('开局还剩 = 总数 − 已用', left0 === 2 - used0, `${left0}`);

  const mk = async (addr) => {
    await accounts.createAccount(addr, { until: 0 });
    return accounts.loadAccount(addr);
  };
  // 第一个人：拿到终身，名额 −1。
  {
    const a = await mk('slot1@example.com');
    const out = await ent.grantLifetimeIfWindow('slot1@example.com', a);
    check('第 1 个人拿到终身', accounts.isLifetime(out) === true);
    check('名额跟着减一', (await ent.slotsLeft()) === left0 - 1, String(await ent.slotsLeft()));
  }
  // 同一个人再来：不重复占号（每次开机都会走到这儿）。
  {
    const again = await accounts.loadAccount('slot1@example.com');
    const before = await ent.slotsLeft();
    await ent.grantLifetimeIfWindow('slot1@example.com', again);
    check('同一个人再登录不再占名额', (await ent.slotsLeft()) === before, String(await ent.slotsLeft()));
  }
  // 拿旧快照再来：锁里那道门拦住，**号也要退回去**（不然名额被白白吃掉一个）。
  {
    const before = await ent.slotsLeft();
    const stale = { until: 0 };
    await ent.grantLifetimeIfWindow('slot1@example.com', stale);
    check('拿旧快照再来：没写成，号退回去了', (await ent.slotsLeft()) === before,
      String(await ent.slotsLeft()));
  }
  // 把剩下的名额用光。
  {
    let guard = 0;
    while ((await ent.slotsLeft()) > 0 && guard < 10) {
      const addr = `fill${guard}@example.com`;
      await ent.grantLifetimeIfWindow(addr, await mk(addr));
      guard++;
    }
    check('（尺子）真的把名额用光了', (await ent.slotsLeft()) === 0, String(await ent.slotsLeft()));
  }
  // 满了之后：**真的拿不到**。这一条是整节的要害。
  {
    const addr = 'toolate@example.com';
    const a = await mk(addr);
    const out = await ent.grantLifetimeIfWindow(addr, a);
    check('满了之后再来的人拿不到终身（不是只把数字停住）',
      accounts.isLifetime(out) === false, String(out && out.until));
    const fresh = await accounts.loadAccount(addr);
    check('库里那一份也没被写上', !accounts.isLifetime(fresh), String(fresh && fresh.until));
    check('名额不会变成负数', (await ent.slotsLeft()) === 0, String(await ent.slotsLeft()));
    // 退号那一步真的做了：满了之后再来几个人，「已用」不许继续往上爬。爬上去的话
    // 下次抬高总数（放第二批）时，那些白白吃掉的号会把新名额直接啃掉一截。
    const usedNow = await ent.grantsUsed();
    for (const who of ['late1@example.com', 'late2@example.com', 'late3@example.com']) {
      await ent.grantLifetimeIfWindow(who, await mk(who));
    }
    check('满了之后再来的人不会把「已用」顶上去（号退回去了）',
      (await ent.grantsUsed()) === usedNow, `${await ent.grantsUsed()} vs ${usedNow}`);
  }
  /*
   * **同时来一堆人。** 这一条验的是「先取号再写账」那个次序。
   *
   * 写成「先读再判再写」的话，同时进来的几个请求会读到同一个数、双双放行——第 N+1 个人
   * 也拿到了终身，而屏幕上写着 0。那种 bug 单线程一个一个试是试不出来的。
   */
  {
    process.env.GENIUS_GRANT_LIMIT = '3';
    // 换一个干净的计数：上面那一轮已经把号用掉了，这儿要从「还剩 3 个」起步。
    const room = await ent.slotsLeft();
    check('（尺子）这一轮确实还有名额可抢', room > 0, String(room));
    const who = [];
    for (let i = 0; i < room + 4; i++) {
      const addr = `race${i}@example.com`;
      who.push([addr, await mk(addr)]);
    }
    await Promise.all(who.map(([addr, acct]) => ent.grantLifetimeIfWindow(addr, acct)));
    let got = 0;
    for (const [addr] of who) if (accounts.isLifetime(await accounts.loadAccount(addr))) got++;
    check('同时来 ' + who.length + ' 个人，正好 ' + room + ' 个拿到（一个都不多）',
      got === room, `拿到 ${got} / 名额 ${room}`);
    check('之后名额归零', (await ent.slotsLeft()) === 0, String(await ent.slotsLeft()));
  }
  // 窗口关着的时候一个号都不许占。
  {
    delete process.env.GENIUS_GRANT_WINDOW;
    const before = await ent.grantsUsed();
    const addr = 'closedwin@example.com';
    await ent.grantLifetimeIfWindow(addr, await mk(addr));
    check('窗口关着：一个号都没占', (await ent.grantsUsed()) === before, String(await ent.grantsUsed()));
  }

  if (keepWin === undefined) delete process.env.GENIUS_GRANT_WINDOW;
  else process.env.GENIUS_GRANT_WINDOW = keepWin;
  if (keepLim === undefined) delete process.env.GENIUS_GRANT_LIMIT;
  else process.env.GENIUS_GRANT_LIMIT = keepLim;
}

if (useOld) rmSync(OLD, { force: true });
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项没过`);
process.exit(fail ? 1 : 0);

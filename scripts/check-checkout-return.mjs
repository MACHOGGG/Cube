/**
 * 从 Creem 结账页回来的那一趟——尤其是它没走成的时候。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8817 dist
 *   node scripts/check-checkout-return.mjs http://localhost:8817/
 *
 * 这条路上有一个会把真钱吃掉的顺序问题，修完得钉住。
 *
 * Creem 把订单号挂在返回网址上送人回来。原先那一段是：先把订单号从地址栏里
 * 抹掉，再拿它去问服务器付没付成，问出「付成了」才把它记下来。中间任何一下
 * 都能把这个号弄丢——网断一秒、标签页关早了、或者那张卡在走 3-D Secure，
 * Creem 当时只肯说 processing。号一丢就再也找不回来了（地址栏已经清了），而
 * 钱是真扣了：这个人拿着一份只活在这一个浏览器里、永远搬不走的订阅。
 *
 * 现在的顺序反过来：先记下来，再问。问不出就下次打开接着问。
 *
 * 另一半是那扇设密码的窗。它对刷卡的人是**关不掉的**（没有《以后再说》），
 * 所以不能只凭「地址栏里有个 checkout_id」就弹——那种地址谁都能编，编一个
 * 就能把人锁在一扇关不掉的窗后面，重开也还在。得等权益真的到手。
 *
 * 最后还有个不用浏览器的部分：GET /api/checkout。收单方说「订阅结不了账」
 * 的时候，从外面看不出是密钥没配、商品没配、还是 test 的 id 配了 live 的密
 * 钥，这个网址一打开就有答案，而且一个字的密钥都不会漏出去。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2];
if (!BASE) {
  console.error('用法: node scripts/check-checkout-return.mjs http://localhost:8817/');
  process.exit(2);
}

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// ---- 一、GET /api/checkout：四种配法，一个字都不漏 ---------------------------
{
  const SECRET = 'creem_test_SUPERSECRET';
  const ask = async (env) => {
    for (const k of ['CREEM_API_KEY', 'CREEM_PRODUCT_MONTHLY', 'CREEM_PRODUCT_YEARLY']) {
      delete process.env[k];
    }
    Object.assign(process.env, env);
    // 每次重新 import 一份：那几个读环境变量的函数是模块级的。
    const { default: handler } = await import('../api/checkout.js?v=' + Math.random());
    let raw = '';
    const res = {
      statusCode: 200,
      setHeader() {},
      end(s) { raw = s; },
      status(c) { this.statusCode = c; return this; },
    };
    await handler({ method: 'GET', headers: {} }, res);
    return { status: res.statusCode, raw, json: JSON.parse(raw) };
  };

  const none = await ask({});
  check('没配任何东西：sellable false', none.status === 200 && none.json.sellable === false, none.raw);
  check('没配任何东西：mode 是 null，不替它猜 live', none.json.mode === null);

  const keyOnly = await ask({ CREEM_API_KEY: SECRET });
  check('只有密钥：configured true 而 sellable 还是 false', keyOnly.json.configured && !keyOnly.json.sellable, keyOnly.raw);
  check('creem_test_ 前缀认成 test', keyOnly.json.mode === 'test');

  const half = await ask({ CREEM_API_KEY: SECRET, CREEM_PRODUCT_MONTHLY: 'prod_m' });
  check('只配了月付：monthly true / yearly false', half.json.monthly === true && half.json.yearly === false, half.raw);

  const full = await ask({
    CREEM_API_KEY: 'creem_LIVESECRET',
    CREEM_PRODUCT_MONTHLY: 'prod_m',
    CREEM_PRODUCT_YEARLY: 'prod_y',
  });
  check('全配齐：sellable true', full.json.sellable === true, full.raw);
  check('别的前缀认成 live', full.json.mode === 'live');

  const leaked = [none, keyOnly, half, full].some(
    (r) => r.raw.includes('SECRET') || r.raw.includes('prod_m') || r.raw.includes('prod_y'),
  );
  check('四种配法回的包里都没有密钥、没有商品 id', !leaked);
}

// ---- 二、浏览器里那一趟 ------------------------------------------------------
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

const PAID = {
  active: true,
  period: 'monthly',
  until: Date.now() + 30 * 24 * 3600 * 1000,
  email: 'paid@play-slides.com',
  needsPasscode: true,
  // 故意不给 token：刚付完钱的人还没设密码，服务器这时候也发不出 token。有
  // token 的话 pendingAccount() 会认为这件事办完了，那扇设密码的窗就不该弹。
};

/** 一台干净的浏览器，/api/subscription 的答案由 answer() 说了算。 */
async function open(answer) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => {
    for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle']) {
      localStorage.setItem(k, '1');
    }
    localStorage.setItem('slides_lang', 'zhHans');
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  [page error] ' + e.message));
  let asked = [];
  await page.route('**/api/subscription', async (route) => {
    asked.push(JSON.parse(route.request().postData() || '{}'));
    const reply = answer();
    if (reply === 'offline') return route.abort('connectionfailed');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) });
  });
  return { ctx, page, asked: () => asked, reset: () => (asked = []) };
}

const settle = async (page) => {
  await page.waitForSelector('#navProfile', { timeout: 20000 });
  // refreshEntitlement 跟着开屏一起跑，那扇窗要等两个都完事才弹。
  await page.waitForTimeout(1200);
};

const read = (page) =>
  page.evaluate(() => ({
    pending: localStorage.getItem('slides_pending_account'),
    genius: localStorage.getItem('slides_genius'),
    url: location.href,
    pwWindow: Boolean(document.querySelector('#pwGo')),
    pwLater: Boolean(document.querySelector('#pwLater')),
  }));

// ---- 2a. 回来的那一刻网就断了 ------------------------------------------------
{
  let mode = 'offline';
  const { ctx, page, asked, reset } = await open(() => mode);
  await page.goto(BASE + '?checkout_id=ck_c1_probe', { waitUntil: 'load' });
  await settle(page);
  const one = await read(page);

  check('问过服务器了', asked().some((b) => b.checkoutId === 'ck_c1_probe'), JSON.stringify(asked()));
  check('地址栏里的订单号已经清掉（刷新不会算成第二次结账）', !one.url.includes('checkout_id'), one.url);
  check(
    '问不出结果，但订单号已经记下来了 ← 这一条就是那笔钱',
    one.pending === JSON.stringify({ kind: 'checkout', id: 'ck_c1_probe' }),
    String(one.pending),
  );
  check('还没到手的权益不会先记上', !one.genius || !JSON.parse(one.genius).active, String(one.genius));
  check('没有弹那扇关不掉的窗', one.pwWindow === false);

  // ---- 2b. 下次打开（网好了），地址栏干干净净 --------------------------------
  mode = PAID;
  reset();
  await page.goto(BASE, { waitUntil: 'load' });
  await settle(page);
  const two = await read(page);

  check(
    '下次打开、地址栏里什么都没有，它自己把记下的号拿出来又问了一遍',
    asked().some((b) => b.checkoutId === 'ck_c1_probe'),
    JSON.stringify(asked()),
  );
  check('这回问出来了：权益到手', Boolean(two.genius) && JSON.parse(two.genius).active === true, String(two.genius));
  check('设密码那扇窗这时候才弹', two.pwWindow === true);
  check('刷卡这一扇没有《以后再说》——本来就该关不掉', two.pwLater === false);
  await ctx.close();
}

// 2b 的 answer() 在同一个闭包里换值，这里换成独立的一台，免得串味。
// ---- 2c. 地址栏里随手编一个订单号 --------------------------------------------
{
  const { ctx, page } = await open(() => ({ active: false }));
  await page.goto(BASE + '?checkout_id=ck_forged_by_hand', { waitUntil: 'load' });
  await settle(page);
  const forged = await read(page);

  check('编的号换不来权益', !forged.genius || JSON.parse(forged.genius).active !== true, String(forged.genius));
  check(
    '更要紧的：编的号弹不出那扇关不掉的窗',
    forged.pwWindow === false,
    '弹出来的话，这个网址就能把人锁死在窗后面',
  );
  check('首页照常能用', await page.isVisible('#navProfile'));
  await ctx.close();
}

await browser.close();
console.log(fail ? `\n${fail} 条没过` : '\n全过');
process.exit(fail ? 1 : 0);

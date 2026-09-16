/**
 * 付费入口不许是敞着的。
 *
 *   ALLOW_MEMORY_STORE=1 node scripts/check-checkout-limit.mjs
 *
 * 不起服务器、不连 Creem：库用进程内那一份，Creem 那一跳换成一个会数次数的
 * 假货，直接叫 api/checkout.js 的 handler。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么
 *
 * /api/checkout 是全站唯一一个「碰钱、却一次都没引过 tooMany」的接口。同样碰
 * 钱碰账号的 subscription / redeem / unlock / email / passcode / portal / mint
 * 全都限了速，只有它漏了。而它不需要登录、不需要任何验证，**每调一次就真的
 * 去敲一次 Creem 的下单接口**。
 *
 * 更说明问题的是：浏览器那头早就写好了「服务器说太多次了」的分支
 * （engine/creem.ts 第 104 行把 429 翻成 tooMany，ui/subscribe.ts 把它显示成
 * s.tooManyTries）。也就是说前后端当初说好了要限速，服务端这一步没写——不是
 * 「决定不限」，是漏了。
 *
 * 敞着的代价：一个跑坏的脚本或爬虫不停地敲，把 Creem 给商户的调用额度打满，
 * 这段时间里真正想订阅的玩家看到的是「服务器出了点问题」，钱付不出去。另外
 * 请求体里的邮箱不做归属校验，只要格式合法就转给 Creem 去开单——Creem 要是
 * 对未完成的订单发「完成购买」提醒，这个接口就成了往任意邮箱发信的跳板。
 *
 * 两条：
 *   ① 打满之后要拦下来（429），不是一路放行；
 *   ② 没配库的时候不能反过来把人全挡在外面——没有库就没有计数器，这一步
 *      「数不了就不数」，和 redeem.js / subscription.js 一个道理。
 */
process.env.ALLOW_MEMORY_STORE = '1';
process.env.CREEM_API_KEY = process.env.CREEM_API_KEY || 'creem_test_gatekey';
process.env.CREEM_PRODUCT_MONTHLY = process.env.CREEM_PRODUCT_MONTHLY || 'prod_month';
process.env.CREEM_PRODUCT_YEARLY = process.env.CREEM_PRODUCT_YEARLY || 'prod_year';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// Creem 那一跳换成假货：数一数真的被敲了几次，顺手回一个合法的结账地址。
let creemCalls = 0;
globalThis.fetch = async (url) => {
  if (String(url).includes('creem.io')) {
    creemCalls++;
    return { ok: true, status: 200, json: async () => ({ checkout_url: 'https://creem.test/c/abc' }) };
  }
  throw new Error('这一台不该往别处发请求：' + url);
};

const checkout = (await import('../api/checkout.js')).default;

/** 一次调用。每次换一个来路 IP 就是「另一个人」，同一个就是同一个人。 */
const call = async (ip) => {
  let status = 0;
  let text = '';
  const res = {
    status: (c) => ((status = c), res),
    setHeader: () => res,
    end: (t) => ((text = t), res),
  };
  await checkout(
    { method: 'POST', headers: { 'x-forwarded-for': ip }, body: { period: 'monthly' } },
    res,
  );
  return { status, body: JSON.parse(text || '{}') };
};

// ---- ① 同一个来路连打 200 次，必须在某一次被拦下来 ----------------------
{
  creemCalls = 0;
  let firstBlocked = 0;
  let ok200 = 0;
  for (let i = 1; i <= 200; i++) {
    const r = await call('9.9.9.9');
    if (r.status === 429) {
      if (!firstBlocked) firstBlocked = i;
    } else if (r.status === 200) {
      ok200++;
    }
  }
  check('① 连打 200 次，拦下来了', firstBlocked > 0, firstBlocked ? `第 ${firstBlocked} 次开始拦` : '一次都没拦');
  check('① 拦下来的那些没有再去敲 Creem', creemCalls === ok200, `Creem 被敲 ${creemCalls} 次 · 放行 ${ok200} 次`);
  // 上限定在「一个真人一小时点得完」的量级之上、脚本一眨眼就见底之下。
  check('① 上限是个人用得着、脚本用不动的数', firstBlocked > 1 && firstBlocked <= 51, `第 ${firstBlocked} 次`);
}

// ---- ② 换一个来路，不受前一个的牵连 ------------------------------------
//
// callerId 读的是平台边缘写的 x-forwarded-for，一整间办公室、一整个运营商都
// 可能共用一个。所以「按来路数」必须真的按来路分开数，不然一个人打满会把同
// 一个出口后面所有人一起挡在外面。
{
  const r = await call('8.8.8.8');
  check('② 换个来路照样开得了单', r.status === 200 && Boolean(r.body.url), `${r.status}`);
}

// ---- ③ 没有库的时候不许反过来挡人 --------------------------------------
//
// 没有库就没有计数器。这一步「数不了就不数」——和 redeem.js / subscription.js
// 同一个道理，也是 storeConfigured() 那半句存在的理由。付钱这条路不能因为
// Redis 没配就整条走不通。
{
  process.env.ALLOW_MEMORY_STORE = '0';
  let pass = true;
  for (let i = 0; i < 60; i++) {
    const r = await call('7.7.7.7');
    if (r.status !== 200) pass = false;
  }
  process.env.ALLOW_MEMORY_STORE = '1';
  check('③ 没配库时不限速，也不挡人', pass);
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

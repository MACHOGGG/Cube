/**
 * 「愿不愿意收 Slides 的邮件」这一句，问到了、也存下来了。
 *
 *   node scripts/check-news-optin.mjs                    （只验服务端）
 *   node scripts/check-news-optin.mjs http://localhost:8815/   （连界面一起验）
 *
 * 分两半，因为这件事会从两头坏掉，而且两头坏了都不出错：
 *   服务端 —— 勾了却没存下来，或者没勾却当成同意了。后者是真出事的那一种。
 *   界面 —— 那个框根本没画出来，或者画了但没跟着请求一起送上去。
 * 所以服务端这一半直接在本进程里调 api/ 的处理函数（内存 store，不碰网络），
 * 界面那一半开一个真浏览器，拦下发往 /api/passcode 的那一发，看里面写的是什么。
 */
process.env.ALLOW_MEMORY_STORE = '1';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const store = await import('../api/_store.js');
const { codeHolder, loadAccount } = await import('../api/_accounts.js');
const redeem = (await import('../api/redeem.js')).default;
const passcode = (await import('../api/passcode.js')).default;

/** 一个够 api/ 那边用的假 req/res 对，直接把处理函数当函数调。 */
async function call(handler, body) {
  let status = 0;
  let json = null;
  const req = { method: 'POST', headers: {}, socket: {}, body: JSON.stringify(body) };
  const res = {
    statusCode: 200,
    status(c) { status = c; this.statusCode = c; return this; },
    setHeader() {},
    end(text) { try { json = JSON.parse(text); } catch { json = text; } },
  };
  await handler(req, res);
  return { status: status || res.statusCode, json };
}

/** 花一张码、绑一个邮箱，返回落在 store 里的那个账号。 */
async function bindWith(code, email, body) {
  await store.set('code:' + code, { plan: 'month' });
  await call(redeem, { code });
  // 还没绑邮箱之前，码换来的东西寄放在一个以码为名的「账号」下面。
  const holder = await loadAccount(codeHolder(code));
  await call(passcode, { code, token: holder.token, email, password: '123456', ...body });
  return loadAccount(email);
}

// ---- 服务端 -------------------------------------------------------------
{
  const yes = await bindWith('NEWSYES', 'yes@example.com', { news: true });
  check('勾了就记成同意', yes?.news === true, JSON.stringify({ news: yes?.news }));
  check('同意的时刻也记下来了', typeof yes?.newsAt === 'number' && yes.newsAt > 0);

  const no = await bindWith('NEWSNO', 'no@example.com', { news: false });
  check('没勾就是不同意', no?.news === false);
  check('没勾的不留时间戳', no?.newsAt === 0, String(no?.newsAt));

  // 这一条是真正要守的：请求里压根没提这件事，绝不能当成同意。少一个字段就
  // 默认「他愿意」，是这类功能最常见、也最贵的一种写法。
  const silent = await bindWith('NEWSNONE', 'none@example.com', {});
  check('请求里没提，就不算同意', silent?.news === false, JSON.stringify({ news: silent?.news }));

  // 字符串 'true'、数字 1 这些也不算——同意只认那一个布尔值。
  const sneaky = await bindWith('NEWSFAKE', 'fake@example.com', { news: 'true' });
  check('只认真正的 true，不认像 true 的东西', sneaky?.news === false, JSON.stringify({ news: sneaky?.news }));
}

// ---- 界面 ---------------------------------------------------------------
const BASE = process.argv[2];
if (BASE) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => {
    for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
      localStorage.setItem(k, '1');
    localStorage.setItem('slides_lang', 'zhHans');
  });
  const page = await ctx.newPage();
  let sent = null;
  page.on('request', (r) => {
    if (r.url().endsWith('/api/passcode') && r.method() === 'POST') {
      try { sent = JSON.parse(r.postData() || '{}'); } catch { sent = null; }
    }
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#navProfile', { timeout: 20000 });
  await page.click('#navProfile');
  await page.waitForTimeout(500);
  await page.click('#insiderRow');
  await page.waitForTimeout(600);
  await page.fill('#redeemCode', 'TESTMONTH');
  await page.click('#redeemGo');
  // 兑换成功之后弹的就是「绑定邮箱 + 设密码」那一扇窗
  await page.waitForSelector('#pwNews', { timeout: 15000 });
  check('设密码那一扇窗里有那个勾选框', true);
  check('出厂不勾', (await page.$eval('#pwNews', (el) => el.checked)) === false);

  await page.check('#pwNews');
  await page.fill('#pwUser', 'ui@example.com');
  await page.fill('#pwNew', '123456');
  await page.click('#pwGo');
  await page.waitForFunction(() => true, { timeout: 1000 }).catch(() => {});
  await page.waitForTimeout(1500);
  check('勾了之后请求里带着 news: true', sent?.news === true, JSON.stringify(sent && { news: sent.news }));
  await browser.close();
} else {
  console.log('（没给网址，跳过界面那一半）');
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

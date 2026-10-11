/**
 * 「愿不愿意收 Slides 的邮件」这一句，问到了、也存下来了。
 *
 *   node scripts/check-news-optin.mjs
 *
 * 这件事会从两头坏掉，而且两头坏了都不出错：
 *   服务端 —— 勾了却没存下来，或者没勾却当成同意了。后者是真出事的那一种。
 *   界面 —— 那个框根本没画出来，或者画了但没跟着请求一起送上去。
 *
 * 服务端这一半直接在本进程里调 api/ 的处理函数（内存 store，不碰网络）。
 *
 * ⚠️ **10-11 改过一次**（方案 A-2）：原先这一半走的是「兑码 → `/api/passcode` 的 bind 绑邮箱」，
 * 那正是当年问这一句的地方。bind 从此回 410——它从来不验那个邮箱是谁的，**还会替那个人订上
 * 营销邮件**（`news:true`）。今天开邮箱账号、问这一句的只剩 signin（邮箱 + 寄到的验证码，地址
 * 上没账号就新建，`setNews(fresh, news === true)`），所以服务端这一半改走它，四条判定一条没变；
 * 另加一条：关掉的 bind 不许替任何人订上。
 *
 * **界面那一半随内部码界面撤除，不再适用**：它从个人主页的 `#insiderRow` 进《有兑换码》那扇窗，
 * 而那一行 E41 就撤了，这一半从那时起本来就跑不通。登录窗里那个框（`#authNews`：摆着、出厂不
 * 勾）由 check-signin-ui 的 ② 守着；勾了之后请求里带 `news: true` 那一段由 check-signin-otp 守着。
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
const signin = (await import('../api/signin.js')).default;

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

/**
 * 拿一个新邮箱走一遍 signin（要码 → 读出库里那张码 → 输码），返回落在 store 里的那个账号。
 * 没配 Resend：信寄不出去，但票照回、码照旧写进库里（signin.js 的 request），所以读得到。
 */
async function signUpWith(email, body) {
  const asked = await call(signin, { email });
  const pending = await store.get(`signin:${email}:${asked.json?.challenge}`);
  const done = await call(signin, { action: 'confirm', email, code: pending?.code, challenge: asked.json?.challenge, ...body });
  if (done.status !== 200) console.log(`  （signin 没走通：${done.status} ${JSON.stringify(done.json)}）`);
  return loadAccount(email);
}

// ---- 服务端 -------------------------------------------------------------
{
  const yes = await signUpWith('yes@example.com', { news: true });
  check('勾了就记成同意', yes?.news === true, JSON.stringify({ news: yes?.news }));
  check('同意的时刻也记下来了', typeof yes?.newsAt === 'number' && yes.newsAt > 0);

  const no = await signUpWith('no@example.com', { news: false });
  check('没勾就是不同意', no?.news === false);
  check('没勾的不留时间戳', no?.newsAt === 0, String(no?.newsAt));

  // 这一条是真正要守的：请求里压根没提这件事，绝不能当成同意。少一个字段就
  // 默认「他愿意」，是这类功能最常见、也最贵的一种写法。
  const silent = await signUpWith('none@example.com', {});
  check('请求里没提，就不算同意', silent?.news === false, JSON.stringify({ news: silent?.news }));

  // 字符串 'true'、数字 1 这些也不算——同意只认那一个布尔值。
  const sneaky = await signUpWith('fake@example.com', { news: 'true' });
  check('只认真正的 true，不认像 true 的东西', sneaky?.news === false, JSON.stringify({ news: sneaky?.news }));
}

// ---- 关掉的 bind 不许替任何人订上（10-11 方案 A-2）-----------------------
{
  await store.set('code:NEWSBIND', { plan: 'month' });
  await call(redeem, { code: 'NEWSBIND' });
  // 还没绑邮箱之前，码换来的东西寄放在一个以码为名的「账号」下面。
  const holder = await loadAccount(codeHolder('NEWSBIND'));
  const r = await call(passcode, {
    code: 'NEWSBIND', token: holder?.token, email: 'victim@example.com', password: '123456', news: true,
  });
  check('bind 回 410', r.status === 410 && r.json?.error === 'gone', `${r.status} ${JSON.stringify(r.json)}`);
  check('别人的地址上没开出账号，更没被订上邮件', !(await loadAccount('victim@example.com')));
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

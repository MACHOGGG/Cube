/**
 * 《注册 / 登录》那扇窗：三态同屏，一个密码框都没有（E37/E38）。
 *
 *   GENIUS_GRANT_WINDOW=1 node scripts/dev-server.mjs 8834 dist &
 *   node scripts/check-signin-ui.mjs http://localhost:8834/
 *
 * **真开浏览器**，因为这一扇窗要守的全是「点下去之后变成什么样」：三态切换、六格、那句
 * 警告在不在、mailDown 时停在哪一屏。读源码量不出这些。
 *
 * ⚠️ 这道门**故意不配 Resend**（服务器起来时不带 RESEND_API_KEY / MAIL_FROM），所以要码那
 * 一步必然答 `mailDown`——而那正是 E51 要守的那一支，顺便也让这道门不依赖任何外部服务。
 * 免邮箱那条路不发信，所以它能一路走到真注册出一个账号。
 *
 * ── 量的是什么 ────────────────────────────────────────────────
 *
 * ① 没有 tab、没有密码框、没有《忘记密码？》、没有《有兑换码》——四样 2026-10 全撤了；
 * ② 三态切换走得通，而且每一态只摆它自己那一张表；
 * ③ 验证码那一屏真是六格（mountPin 画的 .pin-cell），订阅邮件那个框**出厂不勾**；
 * ④ `mailDown` 时**停在①**并出那句提示（E51）——不是跳进②等一张永远不来的码；
 * ⑤ 免邮箱那两个框是**明文**（type=text），「第一串是你的钥匙」那句**必须在**；
 * ⑥ 真注册一对凭据：进得去，《账户》那一屏上
 *    · 身份那一行印的是**第一串**，不是 hdl: 那串 hex（E53）
 *    · **没有《更换邮箱》**（api/email.js 会 400，E53）
 * ⑦ 两档屏幕（360×640 / 390×844）底排键都在屏内，而且点得着。
 */
import { chromium } from 'playwright';

const base = process.argv[2];
if (!base) {
  console.error('用法: node scripts/check-signin-ui.mjs http://localhost:<端口>/');
  console.error('（服务器要带 GENIUS_GRANT_WINDOW=1，而且**不要**配 RESEND_API_KEY）');
  process.exit(2);
}

let fail = 0;
const check = (n, ok, extra = '') => {
  if (!ok) fail++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (extra ? '  ' + extra : ''));
};
const head = (t) => console.log('\n' + t);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/** 开一张干净的页面，一路点到《注册 / 登录》那扇窗。 */
async function openAuth(width = 390, height = 844) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  await page.goto(base);
  await page.evaluate(() => {
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_know_how', '1');
  });
  await page.reload();
  // 等元素，不盲等秒数：开场动画三秒多，CI 的机器冷启动更慢，盲等就是偶发红。
  await page.waitForSelector('.home-nav-btn', { timeout: 25000 });
  await page.click('#navProfile');
  await page.waitForSelector('#becomeGeniusBtn', { timeout: 15000 });
  await page.click('#becomeGeniusBtn');
  await page.waitForSelector('#geniusRestore', { timeout: 15000 });
  await page.click('#geniusRestore');
  await page.waitForSelector('#authGo', { timeout: 15000 });
  return { ctx, page };
}

/** 这一刻屏幕上是什么样。 */
const look = (page) =>
  page.evaluate(() => ({
    hint: document.querySelector('#authHint')?.textContent?.trim() ?? '',
    go: document.querySelector('#authGo')?.textContent?.trim() ?? '',
    alt: document.querySelector('#authAlt')?.textContent?.trim() ?? '',
    msg: document.querySelector('#authMsg')?.textContent?.trim() ?? '',
    mail: !document.querySelector('#authMailForm')?.hidden,
    code: !document.querySelector('#authCodeForm')?.hidden,
    pair: !document.querySelector('#authPairForm')?.hidden,
    tabs: document.querySelectorAll('.auth-tab').length,
    pwBoxes: document.querySelectorAll('.auth-modal input[type=password]').length,
    forgotPw: Boolean(document.querySelector('#authForgot')),
    redeem: Boolean(document.querySelector('#authRedeem')),
    pinCells: document.querySelectorAll('#authCodeForm .pin-cell').length,
    newsShown: Boolean(document.querySelector('#authNewsRow')) && !document.querySelector('#authNewsRow').hidden,
    newsChecked: document.querySelector('#authNews')?.checked ?? null,
    firstType: document.querySelector('#authFirst')?.type ?? '',
    secondType: document.querySelector('#authSecond')?.type ?? '',
    warn: document.querySelector('#authPairWarn')?.textContent?.trim() ?? '',
    /*
     * 那一句现在是**读屏专用**（`.sr-only`）。
     *
     * ⚠️ 别再用 `offsetParent` 判「看不看得见」：`.sr-only` 是 `position: absolute` ＋
     * 裁成 1×1，`offsetParent` 照样有值——第一版就是这么写的，于是这一条在那一句彻底看
     * 不见之后仍然绿着，量的是空气。改成量**画出来有多大**。
     */
    warnBox: (() => {
      const el = document.querySelector('#authPairWarn');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    })(),
    /** 屏幕上留下的那一行：一把钥匙 ＋「勿外传」。 */
    keyNote: document.querySelector('.auth-keynote')?.textContent?.trim() ?? '',
    keyNoteBox: (() => {
      const el = document.querySelector('.auth-keynote');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    })(),
    /** 整句话挂在第一串那个框上（读屏光标落进去就念得到）。 */
    describedBy: document.querySelector('#authFirst')?.getAttribute('aria-describedby') ?? '',
    goAria: document.querySelector('#authGo')?.getAttribute('aria-label') ?? '',
    closeAria: document.querySelector('#authClose')?.getAttribute('aria-label') ?? '',
    closeText: document.querySelector('#authClose')?.textContent?.trim() ?? '',
    pairForgot: Boolean(document.querySelector('#authPairForgot')) && !document.querySelector('#authPairForgot').hidden,
  }));

// ---------------------------------------------------------------------------
head('① 四样撤掉的东西，一样都没回来');
const { ctx, page } = await openAuth();
{
  const v = await look(page);
  check('（尺子）那扇窗真的开出来了', v.hint.length > 0 && v.go.length > 0, `${v.hint} / ${v.go}`);
  check('没有「注册 / 登录」两个 tab', v.tabs === 0, String(v.tabs));
  check('一个密码框都没有', v.pwBoxes === 0, String(v.pwBoxes));
  check('没有《忘记密码？》', v.forgotPw === false);
  check('没有《有兑换码》', v.redeem === false);
}

// ---------------------------------------------------------------------------
head('② 默认是邮箱态，三态各摆一张表');
{
  const v = await look(page);
  check('① 邮箱态：只有邮箱那张表', v.mail && !v.code && !v.pair, JSON.stringify([v.mail, v.code, v.pair]));
  check('① 那颗主键是一枚箭头（不写字）', v.go === '→', v.go);
  check('① 旁边那条路通向免邮箱', /免邮箱/.test(v.alt), v.alt);
}

// ---------------------------------------------------------------------------
head('④ 发不出信：停在①，出那句提示（E51）');
{
  await page.fill('#authEmail', 'probe-ui@example.com');
  await page.click('#authGo');
  // **等那句「处理中…」退场**，不是等「有字」。第一版等的是后者，于是它在请求还在飞的时
  // 候就读到了 workingLabel，两条断言红在一个还没发生的时刻上。
  await page.waitForFunction(
    () => {
      const t = (document.querySelector('#authMsg')?.textContent || '').trim();
      return t.length > 0 && !/处理中/.test(t);
    },
    null,
    { timeout: 20000 },
  );
  const v = await look(page);
  check('还在①，没跳进验证码那一屏', v.mail && !v.code, JSON.stringify([v.mail, v.code]));
  check('屏幕上写的是「邮件暂时寄不出」那一句', /寄不出/.test(v.msg), v.msg);
  check('而且指了另一条路', /免邮箱/.test(v.msg), v.msg);
}

// ---------------------------------------------------------------------------
head('⑤ 免邮箱那一屏：明文两串，那句警告必须在');
{
  await page.click('#authAlt');
  await page.waitForFunction(() => !document.querySelector('#authPairForm')?.hidden, null, { timeout: 10000 });
  const v = await look(page);
  check('③ 只摆免邮箱那张表', v.pair && !v.mail && !v.code, JSON.stringify([v.mail, v.code, v.pair]));
  check('两个框都是明文（type=text），不是密码框', v.firstType === 'text' && v.secondType === 'text',
    `${v.firstType} / ${v.secondType}`);
  /*
   * 那句警告 2026-10-03 **从屏幕搬到了读屏那一层**（E38 的告知一个字没少，少的是版面）：
   * 整句挂在第一串那个框的 `aria-describedby` 上，屏幕上留下一把钥匙 ＋「勿外传」。
   *
   * 所以这儿量三件事，缺一件都不成立：整句还在、它真的看不见了、而屏幕上那一行在。
   */
  check('「第一串是你的钥匙」那整句还在（读屏念得到）', /第一串是你的钥匙/.test(v.warn), v.warn);
  check('而且它真的不占版面（裁成 1×1，不是 display:none）',
    !!v.warnBox && v.warnBox.w <= 2 && v.warnBox.h <= 2, JSON.stringify(v.warnBox));
  check('整句挂在第一串那个框上（aria-describedby）', v.describedBy === 'authPairWarn', v.describedBy || '（没挂）');
  check('屏幕上留着「勿外传」那一行，而且看得见',
    /勿外传/.test(v.keyNote) && !!v.keyNoteBox && v.keyNoteBox.w > 10 && v.keyNoteBox.h > 6,
    `${v.keyNote} ${JSON.stringify(v.keyNoteBox)}`);
  check('《忘了第二串？》那条路摆着', v.pairForgot === true);
  // 三态共用一枚箭头（玩家定的「少文字」）；字留给读屏。
  check('主键是那枚箭头', v.go === '→', v.go);
  check('箭头给读屏念的是「继续」', v.goAria === '继续', v.goAria);
  check('关闭是一枚 ✕，字留给 aria-label', v.closeText === '✕' && v.closeAria === '关闭',
    `${v.closeText} / ${v.closeAria}`);
  // 能打字的框字号都不低于 16px（低了 iOS 一聚焦就放大整页）。勾选框不算。
  const fonts = await page.evaluate(() =>
    [...document.querySelectorAll('.auth-modal input')]
      .filter((i) => i.type !== 'checkbox')
      .map((i) => parseFloat(getComputedStyle(i).fontSize)));
  check('能打字的框字号都 ≥ 16px', fonts.every((f) => f >= 16), fonts.join(' '));
}

// ---------------------------------------------------------------------------
head('⑥ 真注册一对：进得去，而且《账户》那一屏说的是实话');
const FIRST = 'UiProbe' + Date.now().toString(36).slice(-5);
{
  await page.fill('#authFirst', FIRST);
  await page.fill('#authSecond', 'secondpass');
  await page.click('#authGo');
  // 成功之后那句「截个图」留一拍再关窗，所以等《账户》那一屏出来。
  await page.waitForSelector('#statusClose', { timeout: 20000 });
  const v = await page.evaluate(() => ({
    h2: document.querySelector('.overlay h2')?.textContent?.trim() ?? '',
    orderRows: [...document.querySelectorAll('.order-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
    rows: [...document.querySelectorAll('.acct-rows button')].map((b) => b.id),
    text: document.querySelector('.overlay')?.textContent ?? '',
  }));
  check('（尺子）《账户》那一屏开出来了', v.h2.length > 0 && v.orderRows.length > 0, `${v.h2} / ${v.orderRows.join(' | ')}`);
  check('⑥ 身份那一行印的是第一串', v.text.includes(FIRST), v.orderRows.join(' | '));
  check('⑥ 不许印 hdl: 那串 hex', !/hdl:[0-9a-f]{8}/.test(v.text));
  check('⑥ 没有《更换邮箱》那一行（点下去必是 400）', !v.rows.includes('statusChangeEmail'), v.rows.join(' '));
  check('⑥ 《退出登录》还在（这是他唯一该有的那一行）', v.rows.includes('statusSignOut'), v.rows.join(' '));
  check('⑥ 这一下就是天才（窗口开着）', !/没有权限/.test(v.text), v.text.slice(0, 80));
}
await ctx.close();

// ---------------------------------------------------------------------------
head('③ 验证码那一屏：六格，订阅邮件那个框出厂不勾');
{
  // 这一屏要走到，得让要码那一步成功。服务器没配 Resend，所以用路由拦截把那一问答成
  // `{ sent: true }`——**只骗这一个接口**，底下验码那一步照旧打真服务器（会答 expired，
  // 那不要紧，这一节量的是屏幕上的样子）。
  const two = await openAuth();
  await two.page.route('**/api/signin', async (route) => {
    const body = route.request().postDataJSON?.() ?? {};
    if (body.action === 'confirm') return route.continue();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sent: true }) });
  });
  await two.page.fill('#authEmail', 'probe-code@example.com');
  await two.page.click('#authGo');
  await two.page.waitForFunction(() => !document.querySelector('#authCodeForm')?.hidden, null, { timeout: 15000 });
  const v = await look(two.page);
  check('② 只摆验证码那张表', v.code && !v.mail && !v.pair, JSON.stringify([v.mail, v.code, v.pair]));
  check('② 抬头说清了码寄给谁', /probe-code@example\.com/.test(v.hint), v.hint);
  check('② 真是六格（mountPin 画的）', v.pinCells === 6, String(v.pinCells));
  check('② 订阅邮件那个框摆着', v.newsShown === true);
  check('② 而且出厂不勾（预先勾上的不算同意）', v.newsChecked === false, String(v.newsChecked));
  check('② 旁边那条路是《换邮箱》（带一枚回头的箭头）', /^←\s*换邮箱$/.test(v.alt), v.alt);
  // 回①：那一下不该把已经填的邮箱清掉（他可能只是打错一个字母）。
  await two.page.click('#authAlt');
  await two.page.waitForFunction(() => !document.querySelector('#authMailForm')?.hidden, null, { timeout: 10000 });
  const back = await two.page.evaluate(() => document.querySelector('#authEmail')?.value);
  check('《换个邮箱》回①，而且原来填的还在（方便改一个字母）', back === 'probe-code@example.com', String(back));
  await two.ctx.close();
}

// ---------------------------------------------------------------------------
head('⑦ 两档屏幕：底排键在屏内，而且点得着');
for (const [w, h] of [[360, 640], [390, 844]]) {
  const one = await openAuth(w, h);
  const r = await one.page.evaluate(() => {
    const btn = document.querySelector('#authGo');
    const b = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return { bottom: Math.round(b.bottom), vh: window.innerHeight, hitOk: btn === hit || btn.contains(hit) };
  });
  check(`注册窗 ${w}×${h}：底排键在屏内`, r.bottom <= r.vh, `${r.bottom} / ${r.vh}`);
  check(`注册窗 ${w}×${h}：那颗键真点得着（没被别的盖住）`, r.hitOk === true);
  await one.ctx.close();
}

await browser.close();
console.log(fail ? `\n${fail} FAILED` : '\n全部通过');
process.exit(fail ? 1 : 0);

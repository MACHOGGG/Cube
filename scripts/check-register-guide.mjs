/**
 * 停售期间那一屏：引导到注册，而且**服务端说得出才说**。
 *
 *   node scripts/dev-server.mjs 8985 dist &
 *   node scripts/check-register-guide.mjs http://localhost:8985/
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 守的是哪件事
 *
 * 玩家 2026-10 把 Creem 的两个订阅商品暂时关掉，那一屏改成「注册就解锁全部功能」，上面印
 * 一行「还剩 N 个名额」（第一批 100 个，满了真的不再送）。
 *
 * 这一屏最容易出的事不是排版，是**印出一句兑现不了的话**：
 *
 *   · 服务端的授予窗口还没打开（`GENIUS_GRANT_WINDOW` 没填），屏幕上却已经写着「注册就
 *     解锁」——那是在替服务端许一个它还不会兑现的承诺；
 *   · 名额满了，屏幕上还写着「还剩 N 个」；
 *   · 服务端半份答复（只回了 open，没回数字），前端自己凑一个数出来。
 *
 * 所以这道门把**各种答复**都喂一遍，钉的只有一句话：**服务端说得出才说，说不出就只留那
 * 句中性的「订阅目前不开放」。**
 *
 * 答复用路由拦截喂，不为每种状态各起一台服务器：那样既慢，又没法构造「半份答复」「500」
 * 这类真实服务器不会主动给的情形。真实那一路由第 ① 节守着（它走的是服务器自己的答复）。
 */
import { chromium } from 'playwright';

const base = process.argv[2];
if (!base) {
  console.error('用法: node scripts/check-register-guide.mjs http://localhost:<端口>/');
  process.exit(2);
}

let fail = 0;
const check = (n, ok, extra = '') => {
  if (!ok) fail++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (extra ? '  ' + extra : ''));
};
const head = (t) => console.log('\n' + t);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/** 开一张干净的页面，走到那一屏。`stub` 不给就用服务器自己的答复。 */
async function openGeniusWindow(stub) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 820 } });
  const page = await ctx.newPage();
  if (stub) {
    await page.route('**/api/slots*', (route) =>
      stub.status
        ? route.fulfill({ status: stub.status, body: 'boom' })
        : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stub.body) }),
    );
  }
  await page.goto(base);
  await page.evaluate(() => {
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_know_how', '1');
  });
  await page.reload();
  // **等元素，不盲等秒数。** 开场动画放完才有主菜单（量出来三秒多），而 CI 的机器冷启动
  // 更慢——盲等一个固定秒数在本地够、在 CI 上就是偶发红，而偶发红最后一定会被人加
  // continue-on-error。头一版就是盲等 2600ms，当场没点着。
  await page.waitForSelector('.home-nav-btn', { timeout: 20000 });
  await page.evaluate(() => {
    const els = [...document.querySelectorAll('.home-nav-btn')];
    const me = els.find((e) => /成绩|个人|我的/.test(e.getAttribute('aria-label') || e.textContent || ''));
    (me || els[0])?.click();
  });
  await page.waitForSelector('.genius-cta', { timeout: 20000 });
  await page.evaluate(() => {
    const t = document.querySelector('.genius-cta');
    t?.click();
  });
  await page.waitForSelector('.genius-modal', { timeout: 10000 });
  // 取数那一问是异步的，等它落地。
  await page.waitForTimeout(1200);
  const seen = await page.evaluate(() => ({
    opened: Boolean(document.querySelector('.genius-modal')),
    tag: document.querySelector('#geniusTag')?.textContent?.trim() || '',
    slotsHidden: document.querySelector('#geniusSlots')?.hidden !== false,
    slots: document.querySelector('#geniusSlots')?.textContent?.trim() || '',
    planRows: document.querySelectorAll('.plan-row').length,
    primary: document.querySelector('#geniusRestore')?.textContent?.trim() || '',
    creemHint: [...document.querySelectorAll('.auth-hint')].some((e) => /Creem/.test(e.textContent || '')),
  }));
  await ctx.close();
  return seen;
}

const PROMISE = /注册就解锁全部功能/;
const NEUTRAL = /订阅目前不开放/;

// ---------------------------------------------------------------------------
head('① 真服务器，授予窗口没开（今天线上就是这个状态）');
{
  const s = await openGeniusWindow(null);
  // 尺子先行：窗真的开出来了。少了它，下面每一句「没有 X」在窗根本没开时全是真的。
  check('（尺子）那一屏真的开出来了', s.opened && s.tag.length > 0, s.tag || '（一个字都没有）');
  check('只摆中性的那一句，不许出现「注册就解锁」', NEUTRAL.test(s.tag) && !PROMISE.test(s.tag), s.tag);
  check('名额那一行藏着（服务端说不出，就不印数）', s.slotsHidden, s.slots || '（藏着）');
  check('一个价钱都不摆', s.planRows === 0, String(s.planRows));
  check('收款方那句话也不在', s.creemHint === false);
  check('主键是《注册》，不是《登录》', s.primary === '注册', s.primary);
}

// ---------------------------------------------------------------------------
head('② 服务端说「还剩 42 个」');
{
  const s = await openGeniusWindow({ body: { open: true, left: 42, total: 100 } });
  check('换成那句承诺', PROMISE.test(s.tag), s.tag);
  check('名额那一行露出来，数字就是服务端给的那个', !s.slotsHidden && /42/.test(s.slots), s.slots);
  check('还是一个价钱都不摆（停售不因为开了名额就回来）', s.planRows === 0, String(s.planRows));
}

// ---------------------------------------------------------------------------
head('③ 服务端说不出的那几种，一律退回中性那一句');
for (const [name, stub] of [
  ['窗口没开 / 名额满了（open: false）', { body: { open: false } }],
  ['半份答复：只说 open，没给数字', { body: { open: true } }],
  ['数字不像话：left 是 0', { body: { open: true, left: 0, total: 100 } }],
  ['数字不像话：left 是字符串', { body: { open: true, left: 'many', total: 100 } }],
  ['服务器 500', { status: 500 }],
]) {
  const s = await openGeniusWindow(stub);
  check(`${name} → 不许出现那句承诺`, !PROMISE.test(s.tag) && NEUTRAL.test(s.tag), s.tag);
  check(`${name} → 名额那一行不许露出来`, s.slotsHidden, s.slots || '（藏着）');
}

await browser.close();
console.log(fail ? `\n${fail} FAILED` : '\n全部通过');
process.exit(fail ? 1 : 0);

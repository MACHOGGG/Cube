/**
 * 停售期间那一屏：引导到注册，而且**服务端说得出才说**。
 *
 *   node scripts/dev-server.mjs 8985 dist &
 *   node scripts/check-register-guide.mjs http://localhost:8985/
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 守的是哪件事
 *
 * 《Slides 天才》那一屏现在是**注册引导**（E40）：一句「注册后免费立即解锁全部内容」，
 * 一颗《注册》键，一个价钱都不摆。
 *
 * 这一屏最容易出的事不是排版，是**那句话和服务端对不上**。它从前是两步走的：先摆中性的
 * 「订阅目前不开放」，问到 `/api/slots` 的真实名额之后才换成那句承诺——因为那时名额有限
 * （第一批 100 个），而「还剩几个」只有服务端数得清。2026-10-02 名额整个撤了（E39，不限
 * 人数），`/api/slots` 和 `geniusSlots.ts` 都删了，那句话于是**写死在 i18n 里**。
 *
 * ⚠️ 所以现在要守的是另一件事：那句话和 `GENIUS_GRANT_WINDOW` 之间**已经没有任何自动的
 * 联系**。开关一关，玩家照着那句话去注册，注册得成、却不是天才，而屏幕上什么都不报
 * （E54）。代码里钉了两处注释（`api/_entitlement.js` 的 grantWindowOpen、`subscribe.ts`
 * 那段 HTML 注释），这道门钉的是屏幕上那一面：**话在、价钱不在、键是《注册》**。
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

/** 开一张干净的页面，走到那一屏。 */
async function openGeniusWindow() {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 820 } });
  const page = await ctx.newPage();
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
    slotsEl: Boolean(document.querySelector('#geniusSlots')),
    slots: document.querySelector('#geniusSlots')?.textContent?.trim() || '',
    planRows: document.querySelectorAll('.plan-row').length,
    primary: document.querySelector('#geniusRestore')?.textContent?.trim() || '',
    creemHint: [...document.querySelectorAll('.auth-hint')].some((e) => /Creem/.test(e.textContent || '')),
  }));
  await ctx.close();
  return seen;
}

const PROMISE = /注册后免费立即解锁全部内容/;
/** 撤掉的那些字样，一个都不许回来。 */
const GONE = [/订阅目前不开放/, /还剩\s*\d+\s*个名额/];

// ---------------------------------------------------------------------------
head('那一屏：话在、价钱不在、键是《注册》');
{
  const s = await openGeniusWindow(null);
  // 尺子先行：窗真的开出来了。少了它，下面每一句「没有 X」在窗根本没开时全是真的。
  check('（尺子）那一屏真的开出来了', s.opened && s.tag.length > 0, s.tag || '（一个字都没有）');
  check('那句承诺就在那儿，不再等服务端', PROMISE.test(s.tag), s.tag);
  for (const re of GONE) {
    check(`撤掉的字样没回来：${re.source}`, !re.test(s.tag + ' ' + s.slots), s.tag + ' | ' + s.slots);
  }
  check('名额那一行整个没了（元素都不在）', s.slotsEl === false, String(s.slotsEl));
  check('一个价钱都不摆', s.planRows === 0, String(s.planRows));
  check('收款方那句话也不在', s.creemHint === false);
  check('主键是《注册》，不是《登录》', s.primary === '注册', s.primary);
}

// ---------------------------------------------------------------------------
head('不再问 /api/slots —— 那个接口已经删了');
{
  // 页面上一次都不该去打它。它删了，所以每一次请求都会是 404，而「界面照旧去问一个 404」
  // 就是一处没清干净的残留：下一个人看日志会以为服务端坏了。
  const ctx = await browser.newContext({ viewport: { width: 420, height: 820 } });
  const page = await ctx.newPage();
  let asked = 0;
  page.on('request', (r) => { if (r.url().includes('/api/slots')) asked++; });
  await page.goto(base);
  await page.evaluate(() => {
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_know_how', '1');
  });
  await page.reload();
  await page.waitForSelector('.home-nav-btn', { timeout: 20000 });
  await page.evaluate(() => {
    const els = [...document.querySelectorAll('.home-nav-btn')];
    const me = els.find((e) => /成绩|个人|我的/.test(e.getAttribute('aria-label') || e.textContent || ''));
    (me || els[0])?.click();
  });
  await page.waitForSelector('.genius-cta', { timeout: 20000 });
  await page.evaluate(() => document.querySelector('.genius-cta')?.click());
  await page.waitForSelector('.genius-modal', { timeout: 10000 });
  await page.waitForTimeout(1200);
  check('开那一屏一次都没去问 /api/slots', asked === 0, `${asked} 次`);
  await ctx.close();
}

await browser.close();
console.log(fail ? `\n${fail} FAILED` : '\n全部通过');
process.exit(fail ? 1 : 0);

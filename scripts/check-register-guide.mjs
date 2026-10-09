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
import { readFileSync } from 'node:fs';

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

/**
 * 货单该有几条：照源码数，不写死。
 *
 * subscribe.ts 的 nowList 是「每一副天才布局一行」（从 GENIUS_LAYOUTS 现拼）再加几行固定的（开小屋、
 * 配色、翻面速度……）。这儿原先写死「十条」——那时表里两副布局；10-09 补充方案第一部分第 10 条又锁上
 * 菱形方块、六边形小球，货单跟着变成十二条，这道门当场红了三条。红的是门（数写死了），不是货单。
 * 现在两样都从源码读：表里再加一副，货单多一行，门不用跟着改；要守的那件事（E40：一条都不许收进
 * 「……」里）一个字没松。
 */
const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const LAYOUTS = ((src('../src/engine/geniusContent.ts').match(/GENIUS_LAYOUTS[^=]*=\s*\[([^\]]*)\]/) || [, ''])[1].match(/'[^']+'/g) || []).length;
const NOW_LIST = (src('../src/ui/subscribe.ts').match(/const nowList = \[\n([\s\S]*?)\n\s*\];/) || [, ''])[1]
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'));
const FIXED = NOW_LIST.filter((l) => !l.startsWith('...')).length;
const SPREADS = NOW_LIST.filter((l) => l.startsWith('...'));
if (LAYOUTS < 1 || FIXED < 1 || SPREADS.length !== 1 || !/GENIUS_LAYOUTS/.test(SPREADS[0])) {
  console.error(`读不出货单的组成（布局 ${LAYOUTS} 副、固定 ${FIXED} 行、展开 ${SPREADS.join(' ')}）——subscribe.ts 的 nowList 改了写法，先修这儿。`);
  process.exit(2);
}
const PERKS = LAYOUTS + FIXED;

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
  await page.waitForSelector('#becomeGeniusBtn', { timeout: 20000 });
  // 个人主页上那枚徽章（第 17 推起是 .genius-badge，原先是 .genius-cta）。
  await page.evaluate(() => {
    const t = document.querySelector('#becomeGeniusBtn');
    t?.click();
  });
  await page.waitForSelector('.invite-modal', { timeout: 10000 });
  // 取数那一问是异步的，等它落地。
  await page.waitForTimeout(1200);
  const seen = await page.evaluate(() => ({
    opened: Boolean(document.querySelector('.invite-modal')),
    tagEl: Boolean(document.querySelector('#geniusTag')),
    tag: document.querySelector('#geniusTag')?.textContent?.trim() || '',
    slotsEl: Boolean(document.querySelector('#geniusSlots')),
    slots: document.querySelector('#geniusSlots')?.textContent?.trim() || '',
    planRows: document.querySelectorAll('.plan-row').length,
    title: document.querySelector('.invite-modal h2')?.textContent?.trim() || '',
    legalLinks: document.querySelectorAll('.genius-legal a').length,
    redeem: Boolean(document.querySelector('#geniusRedeem')),
    perks: document.querySelectorAll('.genius-perk:not(.genius-perk--more)').length,
    more: document.querySelectorAll('.genius-perk--more').length,
    lastIsMore: Boolean(document.querySelector('.invite-perks > li:last-child.genius-perk--more')),
    primary: document.querySelector('#geniusRestore')?.getAttribute('aria-label')?.trim() || '',
    primaryText: document.querySelector('#geniusRestore')?.textContent?.trim() || '',
    creemHint: [...document.querySelectorAll('.auth-hint')].some((e) => /Creem/.test(e.textContent || '')),
  }));
  await ctx.close();
  return seen;
}

/** 在某一档屏幕上开那一屏，量底排键的位置、以及它是不是真的点得着。 */
async function fitAt(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  await page.goto(base);
  await page.evaluate(() => {
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_know_how', '1');
  });
  await page.reload();
  await page.waitForSelector('.home-nav-btn', { timeout: 25000 });
  await page.evaluate(() => {
    const els = [...document.querySelectorAll('.home-nav-btn')];
    const me = els.find((e) => /成绩|个人|我的/.test(e.getAttribute('aria-label') || e.textContent || ''));
    (me || els[0])?.click();
  });
  await page.waitForSelector('#becomeGeniusBtn', { timeout: 20000 });
  await page.evaluate(() => document.querySelector('#becomeGeniusBtn')?.click());
  await page.waitForSelector('.invite-modal', { timeout: 10000 });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const btn = document.querySelector('#geniusRestore');
    const b = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return {
      bottom: Math.round(b.bottom),
      vh: window.innerHeight,
      hitOk: btn === hit || btn.contains(hit),
      perks: document.querySelectorAll('.genius-perk:not(.genius-perk--more)').length,
    };
  });
  await ctx.close();
  return r;
}

/**
 * 那句承诺。第 17 推之前它在抬头底下那一行（#geniusTag，「注册后免费立即解锁全部内容」）；
 * 方案把那一行删了——和抬头说的是同一件事——所以现在承诺就是**抬头本身**。
 */
const PROMISE = /仅需注册即可免费/;
/** 撤掉的那些字样，一个都不许回来。 */
const GONE = [/订阅目前不开放/, /还剩\s*\d+\s*个名额/];

// ---------------------------------------------------------------------------
head('那一屏：话在、价钱不在、键是《注册》');
{
  const s = await openGeniusWindow(null);
  // 尺子先行：窗真的开出来了。少了它，下面每一句「没有 X」在窗根本没开时全是真的。
  check('（尺子）那一屏真的开出来了', s.opened && s.title.length > 0, s.title || '（一个字都没有）');
  check('那句承诺就在那儿（抬头），不再等服务端', PROMISE.test(s.title), s.title);
  check('抬头底下那句「注册后免费立即解锁全部内容」删了（第 17 推）', s.tagEl === false && s.tag === '', s.tag);
  for (const re of GONE) {
    check(`撤掉的字样没回来：${re.source}`, !re.test(s.title + ' ' + s.tag + ' ' + s.slots), s.title + ' | ' + s.slots);
  }
  check('名额那一行整个没了（元素都不在）', s.slotsEl === false, String(s.slotsEl));
  check('一个价钱都不摆', s.planRows === 0, String(s.planRows));
  check('收款方那句话也不在', s.creemHint === false);
  // 第 17 推起两颗键都只放图标，名字在 aria-label 上（读屏念的就是它）。
  check('主键是《注册》，不是《登录》（读屏念的名字）', s.primary === '注册', s.primary);
  check('键上不写字，只放图标', s.primaryText === '', s.primaryText);
  // E40 的另外三样
  check('抬头说的是「注册就免费」，不是「成为天才」', /仅需注册/.test(s.title), s.title);
  check('一条法务链接都不摆（那三份文档撤了，链过去是 404）', s.legalLinks === 0, String(s.legalLinks));
  check('没有《有兑换码》那一行（E41：内部码前端全撤）', s.redeem === false);
  /*
   * **货单全摆，一条都不许收进「……」里**（E40；那时是十条，10-09 起是十二条，数照源码现算，见文件头）。
   *
   * 这一条和下面那两档屏幕是一对：十条会把窗撑长，而这一屏的底排键从前就为这个掉出过屏
   * 幕（原注释记着：十条＋三条「敬请期待」＋价目＋收款方＋三条法务链接，整窗七百多像
   * 素，手机上最底下那排键落在屏外，内嵌浏览器里连滚都滚不到）。
   *
   * 所以两件事都要量：摆满十条，而且摆满之后键还在屏内。只量前者会在某天悄悄把键挤出
   * 去，只量后者会在某天悄悄把列表收回四条。
   *
   * 第 17 推又加了一行：货单**以「……」结尾**（方案原话）。它不是「剩下的收起来了」——十
   * 条照旧全摆——而是「还不止这些」，所以量的是「十条一条不少 ＋ 末尾正好一行省略号」。
   */
  check(`${PERKS} 条功能全摆（天才布局 ${LAYOUTS} 副各一行 + 固定 ${FIXED} 行）`, s.perks === PERKS, String(s.perks));
  check('货单以一行「……」结尾（第 17 推）', s.more === 1 && s.lastIsMore, `${s.more} 行，末尾${s.lastIsMore ? '是' : '不是'}`);
}

// ---------------------------------------------------------------------------
head(`货单摆满（${PERKS} 条）之后，底排键在两档屏幕上都还在屏内`);
for (const [w, h] of [[360, 640], [390, 844]]) {
  const r = await fitAt(w, h);
  check(`天才屏 ${w}×${h}：底排键在屏内`, r.bottom <= r.vh, `${r.bottom} / ${r.vh}`);
  check(`天才屏 ${w}×${h}：那颗键真点得着（没被别的盖住）`, r.hitOk === true);
  check(`天才屏 ${w}×${h}：${PERKS} 条都在`, r.perks === PERKS, String(r.perks));
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
  await page.waitForSelector('#becomeGeniusBtn', { timeout: 20000 });
  await page.evaluate(() => document.querySelector('#becomeGeniusBtn')?.click());
  await page.waitForSelector('.invite-modal', { timeout: 10000 });
  await page.waitForTimeout(1200);
  check('开那一屏一次都没去问 /api/slots', asked === 0, `${asked} 次`);
  await ctx.close();
}

await browser.close();
console.log(fail ? `\n${fail} FAILED` : '\n全部通过');
process.exit(fail ? 1 : 0);

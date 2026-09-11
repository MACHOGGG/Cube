/**
 * 收单方那份「开户审核清单」里，跟这个站有关的每一条。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8818 dist
 *   node scripts/check-creem-review.mjs http://localhost:8818/
 *
 * 起因是两封退回信。第一封说「订阅仍然写着还没开售，点了也结不了账」；第二
 * 封更具体：去照着清单自查，另外把后台登记的客服邮箱改成网站上写的那一个。
 *
 * 清单里能靠代码钉住的是这么几条，钉在这儿：
 *
 *   · 价格、条款、退款、隐私、联系方式——五份都得是**能直接打开的网址**，
 *     不是藏在弹窗里的一段字（那种填不进后台的表格）。
 *   · 客服邮箱要「在公开网站上看得见，在用户自己的账户里也看得见」。两处都
 *     得有，而且得是同一个地址——第二封信挑的正是「两处不一样」。
 *   · 付款之前就要知道钱是谁收的，以及去哪儿看价格和退款规矩。
 *
 * 这个门只查「摆出来了没有」。文案本身写得对不对在 src/legal.ts 里，那是另
 * 一回事。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.argv[2];
if (!BASE) {
  console.error('用法: node scripts/check-creem-review.mjs http://localhost:8818/');
  process.exit(2);
}

const SUPPORT = 'support@play-slides.com';
/**
 * 输入框里那两个灰字的例子——它们也长得像地址，但没人会写信到那儿去。
 *
 * 按整串放行，不按域名放行：example.com 是 RFC 2606 留着不给人注册的，
 * exemple.com 可不是（法语版那个），照域名放行等于给未来某个真地址开了一扇
 * 后门，而这道门要拦的就正是「包里混进了另一个真地址」。
 */
const PLACEHOLDERS = new Set(['you@example.com', 'vous@exemple.com']);
const LEGAL = ['/pricing', '/terms', '/refund', '/privacy', '/contact'];
/** 付款那一屏至少要摆出的三份。 */
const BEFORE_PAYING = ['/pricing', '/refund', '/terms'];

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const root = new URL(BASE).origin;
const resolves = async (href) => {
  const r = await fetch(new URL(href, root)).catch(() => null);
  return r?.ok ? await r.text() : null;
};

// ---- 一、五份文档，五个能打开的网址 ------------------------------------------
for (const path of LEGAL) {
  const body = await resolves(path);
  check(`${path} 打得开`, Boolean(body));
  if (body) check(`${path} 上有客服邮箱`, body.includes(SUPPORT));
}

// ---- 二、整个 dist 里只有一个客服地址 ----------------------------------------
{
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(html|js|css|txt|json|webmanifest)$/.test(name)) files.push(p);
    }
  };
  walk('dist');
  const strays = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) {
      const addr = m[0].toLowerCase();
      if (addr === SUPPORT || PLACEHOLDERS.has(addr)) continue;
      strays.push(`${f}: ${addr}`);
    }
  }
  check(
    '出的包里只登记一个客服地址 ← 第二封信挑的就是这个',
    strays.length === 0,
    [...new Set(strays)].slice(0, 5).join('；'),
  );
}

// ---- 三、浏览器里那三处 ------------------------------------------------------
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const seed = (extra = '') => `
  for (const k of ['slides_tutorial_seen','slides_tutorial_seen_circle','slides_tutorial_seen_triangle'])
    localStorage.setItem(k, '1');
  localStorage.setItem('slides_lang', 'en');
  ${extra}
`;

/** 一段字在屏幕上真的看得见（不是 display:none，也不是零高零宽）。 */
const visibleText = (page, selector) =>
  page.evaluate((sel) => {
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') {
        return el.textContent.trim();
      }
    }
    return null;
  }, selector);

async function fresh(extra) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  [page error] ' + e.message));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(seed(extra));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
  return { ctx, page };
}

const openProfile = async (page) => {
  await page.click('#navProfile');
  await page.waitForSelector('.profile-page', { timeout: 10000 });
};

// ---- 3a. 落地页底下那五行 ----------------------------------------------------
{
  const { ctx, page } = await fresh();
  const feet = await page.$$eval('.home-legal a', (as) =>
    as.map((a) => ({ href: a.getAttribute('href'), text: a.textContent.trim(), w: a.getBoundingClientRect().width })),
  );
  check('落地页底下摆着五份文档', feet.length === 5, feet.map((f) => f.href).join(' '));
  check('五个都是真链接、都看得见', feet.every((f) => f.href?.startsWith('/') && f.w > 0));
  for (const f of feet) check(`  ${f.href} 点得开`, Boolean(await resolves(f.href)), f.text);
  await ctx.close();
}

// ---- 3b. 付款那一屏：谁收钱、去哪儿看规矩 ------------------------------------
{
  const { ctx, page } = await fresh();
  await openProfile(page);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button, a')].find((e) =>
      /Slides\s*(天才|Genius|Génie)/i.test(e.textContent || ''));
    b?.click();
  });
  await page.waitForSelector('.genius-modal', { timeout: 10000 });

  const prices = await page.$$eval('.plan-row .plan-price', (els) => els.map((e) => e.textContent.trim()));
  check('付款屏上是真价钱，不是「敬请期待」', prices.length >= 2 && prices.every((p) => /\d/.test(p)), prices.join(' / '));

  const hints = await page.$$eval('.genius-modal .auth-hint', (els) => els.map((e) => e.textContent.trim()));
  check(
    '按下价钱之前就说清了钱是谁收的',
    hints.some((h) => h.includes('Creem')),
    hints.join(' | ') || '（一句都没有）',
  );

  const links = await page.$$eval('.genius-legal a', (as) =>
    as.map((a) => ({ href: a.getAttribute('href'), target: a.getAttribute('target'), w: a.getBoundingClientRect().width })),
  );
  check(
    '价格 / 退款 / 条款三份就摆在价钱底下',
    BEFORE_PAYING.every((p) => links.some((l) => l.href === p)),
    links.map((l) => l.href).join(' '),
  );
  check('三个都看得见、都点得开', links.length > 0 && links.every((l) => l.w > 0));
  for (const l of links) check(`  ${l.href} 点得开`, Boolean(await resolves(l.href)));
  check('新标签打开，这扇付款窗不会被顶掉', links.every((l) => l.target === '_blank'));

  const overflow = await page.$eval('.genius-modal', (m) => m.scrollWidth - m.clientWidth);
  check('付款窗不横向溢出', overflow <= 1, `${overflow}px`);
  await ctx.close();
}

// ---- 3c. 用户自己的账户里，也得有那个邮箱 ------------------------------------
{
  const { ctx, page } = await fresh(`
    localStorage.setItem('slides_genius', JSON.stringify({
      active: true, channel: 'web', period: 'monthly',
      until: Date.now() + 30 * 86400000,
      email: 'someone@example.com', token: 'tok-not-real',
    }));
  `);
  await openProfile(page);
  await page.click('#loginBtn');
  await page.waitForSelector('.genius-modal', { timeout: 10000 });

  const mailto = await page.$$eval('.genius-modal a[href^="mailto:"]', (as) =>
    as.map((a) => ({ href: a.getAttribute('href'), text: a.textContent.trim(), w: a.getBoundingClientRect().width })),
  );
  check(
    '账户窗里有客服邮箱 ← 清单要求「网站上有，用户账户里也要有」',
    mailto.some((m) => m.href === 'mailto:' + SUPPORT),
    mailto.map((m) => m.href).join(' ') || '（一个都没有）',
  );
  check('那个地址是写出来给人看的，不是只藏在 href 里', mailto.some((m) => m.text === SUPPORT && m.w > 0));

  const shown = await visibleText(page, '.genius-modal .auth-hint');
  check('那一行确实在屏幕上', Boolean(shown), String(shown).slice(0, 60));

  // 自助取消：卡付的人在窗里点得到 Creem 的客户门户。
  const canCancel = await page.$$eval('.genius-modal .profile-row', (rows) =>
    rows.some((r) => r.id === 'statusManage'),
  );
  check('卡付的人在这扇窗里就能去管理／取消订阅', canCancel);
  await ctx.close();
}

await browser.close();
console.log(fail ? `\n${fail} 条没过` : '\n全过');
process.exit(fail ? 1 : 0);

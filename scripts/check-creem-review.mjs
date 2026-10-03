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
/**
 * 站上还在的那几张法务静态页。
 *
 * **2026-10-02 只剩一张**（E42）。价格 / 条款 / 退款 / 联系四份是为「在卖东西」写的，而
 * 那一轮改制把付费整个撤了（注册即免费解锁）。`LEGAL_ORDER` 只留隐私，而
 * `scripts/build-legal.mjs` 按它出页，所以另外四个网址现在是 404——站外登记过它们的地方
 * （比如 Creem 商户后台）要一并更新。
 *
 * 《联系与特别感谢》不在这儿：它不是法务文档，不出静态页，只在个人主页上是一扇窗。
 */
const LEGAL = ['/privacy'];

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

// ---- 3a. 那五份文档：个人主页那五行 + 五个真网址 ----------------------------
//
// **这一节换过口径。** 从前量的是「落地页底下摆着五行」，而玩家 2026-09 把它们从
// 主菜单挪走了（原话：「主页省略下方的价格、法律等部分，只留在个人主页的部分」，
// 出处记在 ui/menu.ts 那段注释里，连同「收单方的审核从前是在落地页上找它们的」这
// 句权衡）。从那一轮起这道门就一直红在**已经被推翻的口径**上——而它是给收单方
// 审核用的门，红着没人敢当真，等于没有。
//
// 现在量玩家定下来的那两条路（那段注释里列的三条，第三条是五张静态页彼此的页脚，
// 由 build-legal.mjs 生成，跟着下面那五个网址一起验）：
//   · 个人主页最底下那五行（是按钮，点开是弹窗，不是 <a href>）；
//   · /pricing /terms /refund /privacy /contact 五个真网址——**填进收单方后台表格
//     的就是这五个**，所以它们必须一个不少、一个不坏。
{
  const { ctx, page } = await fresh();
  await openProfile(page);
  const rows = await page.$$eval('[data-legal]', (bs) =>
    bs.map((b) => ({ key: b.dataset.legal, w: b.getBoundingClientRect().width })),
  );
  // 2026-10-02：五行收成两行（E42）。`[data-legal]` 只认法务文档那一行（隐私），
  // 《联系与特别感谢》是另一行、另一个 id——下面单独量。
  check('个人主页最底下摆着那一份法务文档', rows.length === 1, rows.map((r) => r.key).join(' '));
  check('它看得见（不是摆在那儿高度为 0）', rows.length === 1 && rows.every((r) => r.w > 0),
    rows.map((r) => `${r.key}:${r.w.toFixed(0)}px`).join(' '));
  const thanks = await page.$eval('#contactThanksRow', (b) => ({
    text: b.textContent.replace(/\s+/g, ' ').trim(), w: b.getBoundingClientRect().width,
  })).catch(() => null);
  check('旁边那一行是《联系与特别感谢》，而且看得见', Boolean(thanks && thanks.w > 0),
    thanks ? `${thanks.text} / ${thanks.w.toFixed(0)}px` : '（这一行不在）');
  // 点开第一行，弹窗真的出得来——只量「按钮在」的话，绑事件那一步断掉也是绿的。
  await page.click('[data-legal]');
  const opened = await page.waitForSelector('.legal-intro', { timeout: 8000 }).then(() => true).catch(() => false);
  check('点一行，文档弹窗真的开出来', opened);
  // 还在的那个真网址。
  for (const href of LEGAL) check(`  ${href} 点得开`, Boolean(await resolves(href)));
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
  // 第 17 推：这扇窗的类名从 .genius-modal 换成了 .invite-modal（帐号窗另有一个 .acct-modal）。
  await page.waitForSelector('.invite-modal', { timeout: 10000 });

  /*
   * ⚠️ 这两条 2026-10 **翻了面**。
   *
   * 原先钉的是「付款屏上是真价钱，不是『敬请期待』」和「按下价钱之前就说清了钱是谁
   * 收的」——两条都是收单方审核清单上的要求，在**卖订阅**的时候一字不差地成立。玩家
   * 2026-10 在 Creem 后台把两个商品 archive 了、在续的订阅也一并取消（E11 / PR-12），
   * 于是这两条反过来成了「这一屏在说假话」的证据：摆着价钱却按不动，摆着「Creem 以
   * 记录商户身份收款」却没有在收的款。
   *
   * 所以现在钉的是停售之后的真相：网页端**一个价钱都不许有**、收款方那句话**不许
   * 在**，而且那句「订阅已经停止」要真的印在屏幕上。
   *
   * 商店渠道（App Store / Google Play）走的是另一条路，这一轮没动，也还没上线——
   * 这道门跑的是网页端，判的就是网页端。
   */
  const prices = await page.$$eval('.plan-row .plan-price', (els) => els.map((e) => e.textContent.trim()));
  check('网页端停售：一个价钱都不摆（不是摆一个按不动的）', prices.length === 0, prices.join(' / ') || '（没有）');
  const planRows = await page.$$eval('.plan-row', (els) => els.length);
  check('连那两行价钱的按钮本身也不在', planRows === 0, String(planRows));

  const hints = await page.$$eval('.invite-modal .auth-hint', (els) => els.map((e) => e.textContent.trim()));
  check(
    '收款方那句话也撤了（没有在收的款，就不许说谁在收）',
    !hints.some((h) => h.includes('Creem')),
    hints.join(' | ') || '（一句都没有）',
  );

  /*
   * 尺子：这一屏真的开出来了，而且开头那句话**说对了现在这件事**。少了它，上面三句
   * 「什么都没有」在窗根本没打开的时候也全是真的——那是这个仓库最常见的那种假绿。
   *
   * 这一条的内容换过两次：原先认的是「订阅已经停止 / closed / fermé」，那是停售那一轮的口
   * 径；改制定下来之后认的是抬头底下那句「注册后免费立即解锁全部内容」（E40）。第 17 推按方
   * 案把那一句删了（它和抬头说的是同一件事），所以现在认的是**抬头本身**——「仅需注册即可免
   * 费成为 Slides 天才」。「停止」这个词照旧不许出现：站上不是「暂时不卖」，是不卖了。
   */
  const tag = await page.$eval('.invite-modal h2', (e) => e.textContent.trim()).catch(() => '');
  check('（尺子）这一屏开着，而且抬头说的是「注册就免费」',
    /注册即可免费|Sign up|Inscrivez|註冊即可免費/i.test(tag), tag || '（一个字都没有）');
  check('不许再写「订阅停止 / closed」那一类旧口径',
    !/停止|closed|fermé/i.test(tag), tag);

  /*
   * **那三条法务链接撤了**（E42）。
   *
   * 这一条原先钉的是「价格 / 退款 / 条款三份照旧摆在这一屏上（停售不等于撤掉规矩）」。改
   * 制定下来之后那三份文档本身从 `LEGAL_ORDER` 里撤了，链过去就是 404——而一条通向 404
   * 的法务链接，比不链更糟。所以现在反过来钉：**这一屏上一条法务链接都不许有。**
   */
  const links = await page.$$eval('.genius-legal a', (as) => as.map((a) => a.getAttribute('href')));
  check('这一屏上一条法务链接都没有（那三份撤了，链过去是 404）', links.length === 0, links.join(' ') || '（没有）');
  for (const l of links) check(`  ${l.href} 点得开`, Boolean(await resolves(l.href)));
  check('新标签打开，这扇付款窗不会被顶掉', links.every((l) => l.target === '_blank'));

  const overflow = await page.$eval('.invite-modal', (m) => m.scrollWidth - m.clientWidth);
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
  await page.waitForSelector('.acct-modal', { timeout: 10000 });

  /*
   * ⚠️ 第 17 推把这一节**又翻了一次面**——方案原话：帐号窗「三个按钮竖排……只放图标：更换、
   * 登出、联络（新的邮件图标，mailto:）」「删掉有效期、礼物码、Creem 那几行」。
   *
   * 原先这儿钉的是收单方审核清单上的两条：客服邮箱「在用户自己的账户里也看得见」（地址要
   * **写出来**，不能只藏在 href 里），以及卡付的人在这扇窗里点得到 Creem 的管理订阅。那是
   * 在卖订阅时的要求。网页端停售之后（E11 / PR-12），玩家的新方案把这两样都拿掉了：联络变
   * 成一颗只放图标的键，Creem 那几行整个删除。
   *
   * 所以现在钉的是：联络那颗键在、通向的是**同一个**客服地址、读屏念得出它是什么；地址本身
   * 照旧**写出来给人看**——在个人主页的《联系与特别感谢》里（check-contact-thanks 逐字量
   * 那一扇）；管理订阅那一行**不许**在。哪天重开订阅、又要过收单方的审核，这两条要一起翻
   * 回去——那时候回来改这儿，别只改界面。
   */
  const mailto = await page.$$eval('.acct-modal a[href^="mailto:"]', (as) =>
    as.map((a) => ({ href: a.getAttribute('href'), label: a.getAttribute('aria-label') || '', w: a.getBoundingClientRect().width })),
  );
  check(
    '账户窗里有联络那颗键，通向客服邮箱',
    mailto.some((m) => m.href === 'mailto:' + SUPPORT),
    mailto.map((m) => m.href).join(' ') || '（一个都没有）',
  );
  check('那颗键看得见，而且读屏念得出它是什么（只放图标的键靠 aria-label）', mailto.some((m) => m.w > 0 && m.label.trim()));
  const canCancel = await page.$$eval('.acct-modal #statusManage', (rows) => rows.length);
  check('网页端停售：管理订阅（Creem 门户）那一行撤了', canCancel === 0, String(canCancel));
  await ctx.close();
}

await browser.close();
console.log(fail ? `\n${fail} 条没过` : '\n全过');
process.exit(fail ? 1 : 0);

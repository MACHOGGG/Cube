/**
 * 主菜单那张 Google Analytics 同意条（10-11 方案 A-14）。
 *
 *   npm run build                      # dist：没设 VITE_GA_ID 的那一份（CI 的 browser 那一条本来就有）
 *   node scripts/check-consent.mjs
 *
 * 不收服务器地址：这道门自己再出一份**带 GA 编号**的包（VITE_GA_ID=G-CONSENTGATE，vite 几秒钟），自己起两台
 * dev-server（8933 带 GA、8934 不带），跑完按 PID 关掉。
 *
 * ── 为什么要一个假域名 ────────────────────────────────────────────
 *
 * analytics.ts 的 isLiveSite 只认「不是 localhost」的 http(s) 域名——在 localhost 上统计整个不开，同意条也
 * 不出现，什么都量不出来（门里有一条正是量这一点）。所以浏览器把 www.consent.test 指到本机
 * （--host-resolver-rules），页面在那个域名上开。
 *
 * googletagmanager.com 的请求一律拦下，回一段假的 gtag：它只做真 gtag 会做的那件要紧事——写 `_ga` 和
 * `_ga_CONSENTGATE` 两个 Cookie。前一个故意写在上一级域名 consent.test 上（GA 默认 cookie_domain: 'auto'
 * 就是写在能写的最上一级），撤回时量它是不是真的连上一级一起删掉了。
 *
 * ── 量什么（方案 A-14「门」那一段，一条不少） ──────────────────────────
 *
 *   A 没答过：有条、googletagmanager 一个请求都没有、没有 _ga；不点它也能开局、打完一局（对局、倒数、结算
 *     时条都不在）；回到主菜单它再出现；不抢焦点；role=region 和四语 aria-label。
 *   B 点「接受」：GA 当场被请求、Cookie 写上、条消失、记成 granted；刷新照样加载；过了两年再问一次。
 *   C 撤回：隐私政策窗顶上那颗开关拨到关——两个 Cookie（连上一级域名那个）都删了、ga-disable 为真、之后的
 *     事件不再进 GA；再拨回开，又照常。
 *   D 点「拒绝」：不请求、条消失、往下让的那一截复原；刷新后 6 个月内不再问（假时钟：182 天还不问、184 天问）。
 *   E 四语 × 八种尺寸（方案那六种，加手机横过来两档）：不压任何一张玩法卡、招牌、底排；手机招牌下沿往下 12px、
 *     左右各 16px；电脑右上角 24/24、宽 360、离招牌 ≥12；两颗键宽高差 ≤1px、高 ≥44；字和底色对比度 ≥4.5；宽版
 *     （电脑、横屏）让开之后滚到底，最后一排卡在底排上面、够得着。
 *   F 不出现的地方：小屋页、屋主替整屋挑玩法（pickingForRoom）、弹窗开着（藏起来，关了回来）、没设 VITE_GA_ID
 *     的包、localhost、小红书预览。
 */
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensurePreview } from '../xhs/ensurePreview.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GA_ID = 'G-CONSENTGATE';
const HOST = 'www.consent.test';
const PORT_GA = 8933;
const PORT_PLAIN = 8934;
const GA_BASE = `http://${HOST}:${PORT_GA}/`;
const PLAIN_BASE = `http://${HOST}:${PORT_PLAIN}/`;
const DAY = 864e5;

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
  console.error('dist/ 里没有包：先 npm run build（没设 VITE_GA_ID 的那一份，F 那几条要它）');
  process.exit(2);
}

// ── 出一份带 GA 编号的包 ─────────────────────────────────────────────
const gaDist = mkdtempSync(join(tmpdir(), 'consent-dist-'));
{
  const r = spawnSync('npx', ['vite', 'build', '--outDir', gaDist, '--emptyOutDir', '--logLevel', 'error'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, VITE_GA_ID: GA_ID },
  });
  check('（尺子）带 GA 编号的包出好了', r.status === 0 && existsSync(join(gaDist, 'index.html')));
  if (r.status !== 0) process.exit(1);
}

// ── 两台服务器 ───────────────────────────────────────────────────────
const servers = [];
async function serve(port, dir) {
  const child = spawn(process.execPath, ['scripts/dev-server.mjs', String(port), dir], { cwd: ROOT, stdio: 'ignore' });
  servers.push(child);
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/`)).ok) return true;
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
function shutdown() {
  for (const s of servers) {
    try {
      s.kill();
    } catch {
      /* 已经退了 */
    }
  }
  rmSync(gaDist, { recursive: true, force: true });
}
process.on('exit', shutdown);
check('（尺子）带 GA 的服务器起来了', await serve(PORT_GA, gaDist));
check('（尺子）不带 GA 的服务器起来了', await serve(PORT_PLAIN, 'dist'));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`],
});

/** 假 gtag：写两个 Cookie（一个在上一级域名），记一下自己跑过几次。 */
const STUB = `(function(){var y=63072000;
document.cookie='_ga=GA1.1.42.42; path=/; domain=consent.test; max-age='+y;
document.cookie='_ga_CONSENTGATE=GS1.1.42; path=/; max-age='+y;
window.__gaStub=(window.__gaStub||0)+1;})();`;

/**
 * 开一个新的浏览器上下文。假时钟读 sessionStorage 里的 __shiftMs（刷新之后还在，换个数再刷新就是另一天）。
 * seed 只在这个标签页第一次打开时写进去（sessionStorage 记着写过没有），刷新不重写——答复要留得住。
 */
async function open({ w = 390, h = 844, lang = 'zhHans', seed = {}, base = GA_BASE } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const hits = [];
  await ctx.route('https://www.googletagmanager.com/**', (route) => {
    hits.push(route.request().url());
    route.fulfill({ status: 200, contentType: 'text/javascript', body: STUB });
  });
  await ctx.addInitScript(
    ({ lang, seed }) => {
      const off = Number(sessionStorage.getItem('__shiftMs') || 0);
      if (off) {
        const D = Date;
        class FakeDate extends D {
          constructor(...a) {
            if (a.length) super(...a);
            else super(D.now() + off);
          }
          static now() {
            return D.now() + off;
          }
        }
        globalThis.Date = FakeDate;
      }
      if (sessionStorage.getItem('__seeded') === '1') return;
      sessionStorage.setItem('__seeded', '1');
      localStorage.setItem('slides_lang', lang);
      for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
    },
    { lang, seed },
  );
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForSelector('.home-page .home-icon-btn', { timeout: 20000 });
  await page.waitForTimeout(900);
  return { ctx, page, hits, errs };
}

async function reload(page, shiftDays = 0) {
  await page.evaluate((ms) => sessionStorage.setItem('__shiftMs', String(ms)), shiftDays * DAY);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.home-page .home-icon-btn', { timeout: 20000 });
  await page.waitForTimeout(900);
}

/** 条此刻的样子：在不在、看不看得见、几何、紧凑没有、往下让了多少、本机记的答复。 */
const barState = (page) =>
  page.evaluate(() => {
    const el = document.getElementById('consentBar');
    const rect = (e) => {
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
    };
    let record = null;
    try {
      record = JSON.parse(localStorage.getItem('slides_consent_ga') || 'null');
    } catch {
      record = 'bad';
    }
    return {
      here: !!el,
      visible: !!el && getComputedStyle(el).visibility === 'visible' && el.getBoundingClientRect().height > 0,
      bar: rect(el),
      compact: !!el?.classList.contains('consent-bar--compact'),
      room: document.querySelector('.home-page')?.style.getPropertyValue('--consent-room') || '',
      record,
      cookie: document.cookie,
      gtag: typeof window.gtag,
      disabled: window['ga-disable-G-CONSENTGATE'],
      dl: Array.isArray(window.dataLayer) ? window.dataLayer.length : -1,
    };
  });

// ════════ A 没答过 ════════════════════════════════════════════════════
const A = await open();
{
  const { page, hits } = A;
  const s = await barState(page);
  const meta = await page.evaluate(() => {
    const el = document.getElementById('consentBar');
    return {
      host: location.hostname,
      role: el?.getAttribute('role'),
      label: el?.getAttribute('aria-label'),
      focus: document.activeElement === document.body || document.activeElement === null,
    };
  });
  check('A（尺子）页面开在 www.consent.test 上（isLiveSite 把它当线上）', meta.host === HOST, meta.host);
  check('A 没答过：主菜单上有同意条，看得见', s.here && s.visible);
  check('A role=region、aria-label「Cookie 设置」', meta.role === 'region' && meta.label === 'Cookie 设置', `${meta.role} / ${meta.label}`);
  check('A 不抢焦点（焦点还在 body 上）', meta.focus);
  check('A 没答过：googletagmanager 一个请求都没有、没有 gtag、没有 _ga', hits.length === 0 && s.gtag === 'undefined' && !/_ga/.test(s.cookie),
    `${hits.length} 次 · gtag ${s.gtag} · ${s.cookie}`);

  // 不点它，开一局方块、打完。
  const card = page.locator('.home-page .home-icon-btn').filter({ has: page.locator('.home-icon-art') }).first();
  await card.locator('.home-icon-art').click();
  await page.waitForSelector('.app--game', { timeout: 15000 });
  const inCount = await barState(page);
  check('A 点了玩法卡：开局那一刻（倒数 / 教学）条不在', !inCount.here);
  await page.waitForSelector('.app--game #boardWrap [data-r][data-c]', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const inGame = await barState(page);
  check('A 对局中条不在', !inGame.here);
  await page.$eval('#stopBtn', (e) => e.click()).catch(() => {});
  await page.waitForTimeout(400);
  await page.$eval('#pauseFinishBtn', (e) => e.click()).catch(() => {});
  const ended = await page.waitForSelector('#endOverlay.show', { timeout: 20000 }).then(() => true).catch(() => false);
  check('A 不点同意条也打完了一局（结算页出来了）', ended);
  const atEnd = await barState(page);
  check('A 结算页上条不在、GA 还是一个请求都没有', !atEnd.here && hits.length === 0, `${hits.length} 次`);
  await page.waitForTimeout(2500);
  await page.$eval('#endBackBtn', (e) => e.click()).catch(() => {});
  await page.waitForSelector('.home-page .home-icon-btn', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const back = await barState(page);
  check('A 不理它：回到主菜单条又出现了', back.here && back.visible);
  check('A 一路上没写答复', back.record === null, JSON.stringify(back.record));
}

// ════════ F（弹窗）：开着隐私政策那扇窗时条藏起来，关了回来 ═══════════════════
{
  const { page, hits } = A;
  await page.click('#consentBar .consent-link');
  await page.waitForSelector('.overlay.show', { timeout: 5000 });
  await page.waitForTimeout(300);
  const under = await barState(page);
  const sw = await page.$eval('#gaSwitch', (e) => e.getAttribute('aria-checked')).catch(() => null);
  check('F 点条上的链接开的是应用里的隐私政策窗，顶上有「Google Analytics 统计」开关（关着）', sw === 'false', String(sw));
  check('F 弹窗开着：条在、但藏起来了（visibility hidden）', under.here && !under.visible);
  await page.click('#legalClose');
  await page.waitForTimeout(400);
  const after = await barState(page);
  check('F 弹窗一关，条又看得见了（没拨开关就还没答）', after.here && after.visible && after.record === null);
  check('F 一路上 GA 还是一个请求都没有', hits.length === 0, `${hits.length} 次`);
}

// ════════ B 接受 ═════════════════════════════════════════════════════
{
  const { page, hits } = A;
  await page.click('#consentBar .consent-btn[data-v="granted"]');
  await page.waitForTimeout(800);
  const s = await barState(page);
  check('B 点「接受」：GA 当场被请求（带着 G-CONSENTGATE）', hits.length === 1 && hits[0].includes('id=G-CONSENTGATE'), hits.join(' '));
  const cfg = await page.evaluate(() =>
    (window.dataLayer || []).some((a) => a && a[0] === 'config' && a[1] === 'G-CONSENTGATE'),
  );
  check('B gtag 配上了这个编号（dataLayer 里有 config）', cfg);
  check('B 两个 Cookie 写上了（_ga、_ga_CONSENTGATE）', /(^|; )_ga=/.test(s.cookie) && /(^|; )_ga_CONSENTGATE=/.test(s.cookie), s.cookie);
  check('B 条当场消失、往下让的那一截清掉', !s.here && s.room === '');
  check('B 本机记成 granted，带着时刻', s.record?.v === 'granted' && Number.isFinite(s.record?.at), JSON.stringify(s.record));
  await reload(page);
  const r1 = await barState(page);
  check('B 刷新：不再问，GA 开机就加载', !r1.here && hits.length === 2, `${hits.length} 次`);
  await reload(page, 729);
  const r2 = await barState(page);
  check('B 过了 729 天：还是不问、照常加载', !r2.here && hits.length === 3, `${hits.length} 次`);
  await reload(page, 731);
  const r3 = await barState(page);
  check('B 过了两年（731 天）：答复过期，条又出现，这一次 GA 不加载', r3.here && r3.visible && hits.length === 3, `${hits.length} 次`);
}
await A.ctx.close();
check('A/B/F 页面零报错', A.errs.length === 0, A.errs.join(' | '));

// ════════ C 撤回（隐私政策窗顶上那颗开关） ════════════════════════════════
{
  const C = await open();
  const { page, hits } = C;
  await page.click('#consentBar .consent-btn[data-v="granted"]');
  await page.waitForTimeout(800);
  // 去个人主页，从底下那一行开隐私政策
  await page.$eval('#navProfile', (e) => e.click());
  await page.waitForSelector('[data-legal="privacy"]', { timeout: 10000 });
  await page.$eval('[data-legal="privacy"]', (e) => e.click());
  await page.waitForSelector('#gaSwitch', { timeout: 5000 });
  const on = await page.$eval('#gaSwitch', (e) => e.getAttribute('aria-checked'));
  check('C（尺子）接受过之后，开关是开着的', on === 'true', on);
  const before = (await C.ctx.cookies()).filter((c) => c.name.startsWith('_ga')).map((c) => `${c.name}@${c.domain}`);
  check('C（尺子）撤回之前两个 Cookie 都在（一个在上一级域名）', before.length === 2 && before.some((c) => c.endsWith('@.consent.test')), before.join(' '));
  await page.click('#gaSwitch');
  await page.waitForTimeout(300);
  const off = await page.$eval('#gaSwitch', (e) => e.getAttribute('aria-checked'));
  const after = (await C.ctx.cookies()).filter((c) => c.name.startsWith('_ga')).map((c) => `${c.name}@${c.domain}`);
  const s = await barState(page);
  check('C 拨到关：开关显示关', off === 'false');
  check('C 拨到关：两个 Cookie 都删掉了（连上一级域名那个）', after.length === 0, after.join(' '));
  check('C 拨到关：ga-disable-G-CONSENTGATE 为真、本机记成 denied', s.disabled === true && s.record?.v === 'denied', `${s.disabled} ${JSON.stringify(s.record)}`);
  // 之后的事件不再进 GA：关窗、换一屏（trackScreen），dataLayer 不长
  await page.click('#legalClose');
  const dl0 = (await barState(page)).dl;
  await page.$eval('#navRecords', (e) => e.click()).catch(() => {});
  await page.waitForTimeout(800);
  const dl1 = (await barState(page)).dl;
  check('C 撤回之后换一屏：GA 那边一个事件都没多', dl1 === dl0, `${dl0} → ${dl1}`);
  // 拨回开
  await page.$eval('#navProfile', (e) => e.click());
  await page.waitForSelector('[data-legal="privacy"]', { timeout: 10000 });
  await page.$eval('[data-legal="privacy"]', (e) => e.click());
  await page.waitForSelector('#gaSwitch', { timeout: 5000 });
  await page.click('#gaSwitch');
  await page.waitForTimeout(300);
  const back = await barState(page);
  check('C 再拨回开：ga-disable 为假、记成 granted、脚本不重复插（一页只插一次）', back.disabled === false && back.record?.v === 'granted' && hits.length === 1,
    `${back.disabled} ${JSON.stringify(back.record)} · ${hits.length} 次`);
  await page.click('#legalClose');
  const dl2 = (await barState(page)).dl;
  await page.$eval('#navRecords', (e) => e.click()).catch(() => {});
  await page.waitForTimeout(800);
  const dl3 = (await barState(page)).dl;
  check('C 拨回开之后换一屏：事件照常进 GA', dl3 > dl2, `${dl2} → ${dl3}`);
  check('C 页面零报错', C.errs.length === 0, C.errs.join(' | '));
  await C.ctx.close();
}

// ════════ D 拒绝 ═════════════════════════════════════════════════════
{
  const D = await open({ w: 320, h: 568, lang: 'fr' });
  const { page, hits } = D;
  const firstTop = () =>
    page.evaluate(() => {
      const tops = [...document.querySelectorAll('.home-page .home-icon-art')]
        .map((e) => e.getBoundingClientRect())
        .filter((r) => r.height > 0 && r.bottom > 0 && r.top < innerHeight)
        .map((r) => r.top);
      return Math.min(...tops);
    });
  const s0 = await barState(page);
  const top0 = await firstTop();
  check('D（尺子）法语 320×568：紧凑版，而且主菜单往下让了', s0.here && s0.compact && parseFloat(s0.room) > 0, `room ${s0.room}`);
  await page.click('#consentBar .consent-btn[data-v="denied"]');
  await page.waitForTimeout(500);
  const s1 = await barState(page);
  const top1 = await firstTop();
  check('D 点「拒绝」：不请求 GA、条消失、记成 denied', hits.length === 0 && !s1.here && s1.record?.v === 'denied', `${hits.length} 次 ${JSON.stringify(s1.record)}`);
  check('D 让出来的那一截复原（--consent-room 清掉，第一张卡回到原处）', s1.room === '' && Math.abs(top0 - parseFloat(s0.room) - top1) <= 2,
    `${Math.round(top0)} → ${Math.round(top1)}（让过 ${s0.room}）`);
  await reload(page);
  check('D 刷新：不再问', !(await barState(page)).here);
  await reload(page, 182);
  check('D 过了 182 天：还不问', !(await barState(page)).here);
  await reload(page, 184);
  const s4 = await barState(page);
  check('D 过了 184 天（六个月）：又问一次', s4.here && s4.visible);
  check('D 一路上 GA 一个请求都没有', hits.length === 0, `${hits.length} 次`);
  check('D 页面零报错', D.errs.length === 0, D.errs.join(' | '));
  await D.ctx.close();
}

// ════════ E 四语 × 八种尺寸：摆位、两颗键、对比度 ══════════════════════════
// 后两档是手机横过来（宽版、没有鱼眼轴）：方案那六种里没有横屏，而横屏上第一排两张卡的上沿正好比条的上沿高
// 一个像素——照竖屏「上沿在条之上的不算」那条规矩，条整块压在它们身上还收走点击（ui/consentBar.ts 的 obstacles）。
const SIZES = [
  [390, 844],
  [360, 740],
  [320, 568],
  [1440, 900],
  [1366, 768],
  [1000, 700],
  [844, 390],
  [667, 375],
];
const LABEL = { zhHans: 'Cookie 设置', zhHant: 'Cookie 設定', en: 'Cookie settings', fr: 'Paramètres des cookies' };
const table = [];
for (const lang of ['zhHans', 'zhHant', 'en', 'fr']) {
  for (const [w, h] of SIZES) {
    const E = await open({ w, h, lang });
    // 副标题是一个字一个字打出来的（ui/typeTagline.ts，打完把光标摘掉）：打完之前招牌窄一截，量出来的「离招牌
    // 多远」不作数——法语那一句打完，1000 宽上招牌的右沿从 591 长到 617，条的左沿在 616。从前这一节在 0.9 秒时
    // 就量了，正好赶在打完之前，于是一直是绿的。
    const typed = await E.page.waitForFunction(() => !document.querySelector('.home-page .home-sub-caret'), null, { timeout: 8000 }).then(() => true).catch(() => false);
    await E.page.waitForTimeout(400);
    const m = await E.page.evaluate(() => {
      const bar = document.getElementById('consentBar');
      const R = (r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height });
      const vis = (e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && getComputedStyle(e).visibility !== 'hidden';
      };
      const cards = [...document.querySelectorAll('.home-page .home-icon-art, .home-page .home-icon-tag')]
        .filter(vis)
        .map((e) => ({ ...R(e.getBoundingClientRect()), name: e.closest('.home-icon-btn')?.getAttribute('aria-label') || '?' }));
      const glass = document.querySelector('.home-page .home-head-glass');
      const nav = document.querySelector('.home-nav');
      const btns = [...document.querySelectorAll('#consentBar .consent-btn')].map((e) => R(e.getBoundingClientRect()));
      // 对比度：字色对页面底色（条是半透明的那块玻璃，铺在页面底色上，看到的就是底色）
      const rgb = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const lum = ([r, g, b]) => {
        const f = (v) => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const ratio = (a, b) => {
        const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
        return (x + 0.05) / (y + 0.05);
      };
      const text = bar?.querySelector('.consent-text');
      const btn = bar?.querySelector('.consent-btn');
      return {
        bar: bar ? R(bar.getBoundingClientRect()) : null,
        label: bar?.getAttribute('aria-label'),
        compact: !!bar?.classList.contains('consent-bar--compact'),
        room: document.querySelector('.home-page')?.style.getPropertyValue('--consent-room') || '',
        cards,
        glass: glass ? R(glass.getBoundingClientRect()) : null,
        nav: nav ? R(nav.getBoundingClientRect()) : null,
        btns,
        textContrast: text ? ratio(rgb(getComputedStyle(text).color), rgb(getComputedStyle(document.body).backgroundColor)) : 0,
        btnContrast: btn ? ratio(rgb(getComputedStyle(btn).color), rgb(getComputedStyle(btn).backgroundColor)) : 0,
        vw: document.documentElement.clientWidth,
      };
    });
    const tag = `E ${lang} ${w}×${h}`;
    check(`${tag}：（尺子）副标题打完了才量`, typed);
    if (!m.bar) {
      check(`${tag}：条在`, false);
      await E.ctx.close();
      continue;
    }
    const inter = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
    const hitCards = m.cards.filter((c) => inter(m.bar, c)).map((c) => c.name);
    check(`${tag}：不压任何一张玩法卡`, hitCards.length === 0, hitCards.join(' '));
    check(`${tag}：不压招牌、不压底排`, !inter(m.bar, m.glass) && !(m.nav && inter(m.bar, m.nav)));
    if (w >= 1000) {
      // 宽 360；右边那一截放不下「360 + 离招牌 12」时收窄（ui/consentBar.ts 的 place）——1000 宽的法语是这一种。
      const wantW = Math.min(360, Math.floor(m.vw - 24 - m.glass.r - 12));
      check(`${tag}：电脑右上角——离右边、上边各 24px，宽 ${wantW === 360 ? '360' : `${wantW}（放不下 360 + 离招牌 12，收窄）`}`,
        Math.abs(m.vw - m.bar.r - 24) <= 1 && Math.abs(m.bar.t - 24) <= 1 && Math.abs(m.bar.w - wantW) <= 1,
        `右 ${Math.round(m.vw - m.bar.r)} 上 ${Math.round(m.bar.t)} 宽 ${Math.round(m.bar.w)}`);
      check(`${tag}：离招牌至少 12px`, m.bar.l - m.glass.r >= 12 - 0.5 || m.bar.t - m.glass.b >= 12, `${Math.round((m.bar.l - m.glass.r) * 10) / 10}`);
    } else {
      check(`${tag}：手机——招牌下沿往下 12px、左右各 16px`, Math.abs(m.bar.t - m.glass.b - 12) <= 1 && Math.abs(m.bar.l - 16) <= 1 && Math.abs(m.vw - m.bar.r - 16) <= 1,
        `下 ${Math.round(m.bar.t - m.glass.b)} 左 ${Math.round(m.bar.l)} 右 ${Math.round(m.vw - m.bar.r)}`);
    }
    const [a, b] = m.btns;
    check(`${tag}：两颗键一样大（宽高差 ≤1px）、高 ≥44`, m.btns.length === 2 && Math.abs(a.w - b.w) <= 1 && Math.abs(a.h - b.h) <= 1 && a.h >= 44,
      m.btns.map((x) => `${Math.round(x.w)}×${Math.round(x.h)}`).join(' / '));
    check(`${tag}：字和底色对比度 ≥4.5、键上的字 ≥4.5`, m.textContrast >= 4.5 && m.btnContrast >= 4.5, `${m.textContrast.toFixed(2)} / ${m.btnContrast.toFixed(2)}`);
    check(`${tag}：aria-label 是这种语言的「Cookie 设置」`, m.label === LABEL[lang], m.label);
    // 宽版（电脑、横屏）往下让了之后，最后一排还得够得着：滚到底，最低那张卡的图整个在底排上面。
    const reach = await E.page.evaluate(async () => {
      if (!document.querySelector('.home-page--wide')) return null;
      window.scrollTo(0, 1e6);
      await new Promise((r) => setTimeout(r, 250));
      const arts = [...document.querySelectorAll('.home-page .home-icon-art')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
      const low = Math.max(...arts.map((r) => r.bottom));
      const nav = document.querySelector('.home-nav')?.getBoundingClientRect();
      const out = { low: Math.round(low), navTop: nav ? Math.round(nav.top) : innerHeight };
      window.scrollTo(0, 0);
      return out;
    });
    if (reach) check(`${tag}：滚到底，最后一排卡在底排上面（够得着）`, reach.low <= reach.navTop, `${reach.low} / ${reach.navTop}`);
    check(`${tag}：页面零报错`, E.errs.length === 0, E.errs.join(' | '));
    table.push(`${lang.padEnd(6)} ${String(w + '×' + h).padEnd(9)} ${m.compact ? '紧凑' : '完整'}  ${String(Math.round(m.bar.w)).padStart(3)}×${String(Math.round(m.bar.h)).padStart(3)}  让 ${m.room || '0'}`);
    await E.ctx.close();
  }
}

// ════════ F 不出现的地方 ═════════════════════════════════════════════
{
  // 小屋页、屋主替整屋挑玩法
  const R = await open();
  const { page } = R;
  const granted = await page.evaluate(async () => {
    const r = await fetch('/api/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'TESTMONTH' }) }).then((x) => x.json());
    if (!r.active) return false;
    localStorage.setItem('slides_genius', JSON.stringify({ active: true, period: r.period, until: r.until, channel: 'code', email: r.email, token: r.token, code: r.code }));
    return true;
  });
  check('F（尺子）TESTMONTH 兑到了开屋的权限', granted);
  await reload(page);
  await page.$eval('#navProfile', (e) => e.click());
  await page.waitForSelector('#multiRow', { timeout: 10000 });
  await page.$eval('#multiRow', (e) => e.click());
  await page.waitForSelector('#mpCreate', { timeout: 10000 });
  check('F 小屋页上条不在', !(await barState(page)).here);
  await page.fill('#mpName', '甲');
  await page.$eval('#mpCreate', (e) => e.click());
  await page.waitForSelector('.mp-code', { timeout: 10000 });
  check('F 开了屋、在小屋里：条不在', !(await barState(page)).here);
  await page.$eval('#mpPick', (e) => e.click());
  const picking = await page.waitForSelector('#roomPickBar', { timeout: 8000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(1200);
  const pk = await barState(page);
  const isMenu = await page.evaluate(() => !!document.querySelector('.home-page .home-head'));
  check('F（尺子）屋主替整屋挑玩法：这一屏就是主菜单（横幅挂着）', picking && isMenu);
  check('F 屋主替整屋挑玩法时条不在', !pk.here);
  await page.$eval('#roomPickBack', (e) => e.click()).catch(() => {});
  await page.waitForTimeout(800);
  check('F 小屋页零报错', R.errs.length === 0, R.errs.join(' | '));
  await R.ctx.close();
}
{
  const P = await open({ base: PLAIN_BASE });
  const s = await barState(P.page);
  check('F 没设 VITE_GA_ID 的包（线上域名上）：条不在、GA 不请求', !s.here && P.hits.length === 0);
  await P.ctx.close();
}
{
  const L = await open({ base: `http://localhost:${PORT_GA}/` });
  const s = await barState(L.page);
  check('F 带 GA 的包开在 localhost 上（isLiveSite 为假）：条不在、GA 不请求', !s.here && L.hits.length === 0);
  await L.ctx.close();
}
{
  ensurePreview();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const hits = [];
  await ctx.route('https://www.googletagmanager.com/**', (route) => {
    hits.push(route.request().url());
    route.abort();
  });
  // 跳过「头一回打开」那一屏，直接落在主菜单上——同意条要出现也只会出现在那儿（xhs/check-story 同一个铺法）。
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('slides.xhs.firstRun', '1');
      localStorage.setItem('slides.xhs.story.circle', '1');
    } catch {
      /* 存不进去：下面那把尺子会红 */
    }
  });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(join(ROOT, 'xhs', 'preview.html')).href, { waitUntil: 'load' });
  // 预览页把小工具画在 shadow root 里（document.body 的文字是空的、getElementById 也看不进去）：和
  // xhs/check-story 一样等 .home-icon-btn，数同意条也用 Playwright 的定位器——它穿得过 shadow。
  const menu = await page.waitForSelector('.home-icon-btn', { timeout: 40000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(800);
  const cards = await page.locator('.home-icon-btn').count();
  const bars = await page.locator('.consent-bar, #consentBar').count();
  check('F（尺子）小红书预览的主菜单出来了', menu && cards > 0, `${cards} 张卡`);
  check('F 小红书预览里没有同意条、不请求 GA', bars === 0 && hits.length === 0, `${bars} 张条 · ${hits.length} 次`);
  await ctx.close();
}

await browser.close();
console.log('\n── 各尺寸用的是哪一版、往下让了多少（报告，不挡合并）──');
for (const line of table) console.log('  ' + line);
console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

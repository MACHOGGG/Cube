/**
 * 断网的时候（10-11 方案 H 节「离线原则」）。要 dev-server + Chromium。
 *
 *   node scripts/dev-server.mjs 8955 dist
 *   node scripts/check-offline.mjs http://localhost:8955/
 *
 * 玩家 10-11：「为未来如果 app 化打下基础，就是可以完全断网运行。现在不需要做，但几个需要网络的部分这样处理：
 * 历史记录存在本机、多人房间不行、今日挑战只能在当日联网同步时可以玩」。方案定的原则：核心玩法不等任何网络
 * 请求；需要网络的功能断网时要明说「需要联网」，不能显示成「出错了」。
 *
 * 网页没有 Service Worker，断网之后刷新是打不开的，所以这道门量的都是「页面已经开着、然后断网」（Playwright
 * 的 context.setOffline——它同时把 navigator.onLine 拨成 false、连上时发 online 事件，门里先当尺子量一遍）。
 *
 * ① 多人（H-2）：原先断网时点《多人》照样进设置页，什么都不说，按了开屋、输了屋号才报「连不上网络」。现在：
 *    断网进《多人》，表单最上面一句「多人游玩需要联网。」；**表单照旧能按**（只提示、不收——navigator.onLine
 *    不可靠，MDN 建议只拿它给提示）；按《开小屋》得到「连不上网络」那一句；连上网那一句自己撤掉。320×568 上
 *    多出来的那一行不把屋号四格挤到页底那颗《退出》底下（10-11 方案 C-8 刚量过的那一对）。
 *    尺子：联网时进《多人》，那一句不在。
 *
 * 这一台服务器自己用（兑一次 TESTMONTH：开屋要天才身份，不然按《开小屋》弹的是订阅窗，走不到网络那一步）。
 */
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BASE = process.argv[2] || 'http://localhost:8955/';
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// 文案从 i18n.ts 现读（esbuild 是 package.json 里声明过的依赖）。
const I18N = join(tmpdir(), `check-offline-i18n-${process.pid}.mjs`);
await build({
  stdin: { contents: "export { STRINGS } from './src/i18n.ts';", resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' },
  bundle: true, format: 'esm', outfile: I18N, logLevel: 'error',
});
const s = (await import(pathToFileURL(I18N).href)).STRINGS.zhHans;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => {
  for (const [k, v] of Object.entries({
    slides_lang: 'zhHans', slides_intro_seen: '1', slides_played_square: '1',
    slides_tutorial_seen: '1', slides_tutorial_seen_circle: '1', slides_tutorial_seen_triangle: '1',
  })) localStorage.setItem(k, v);
});
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
// 开屋要服务器认得的天才身份：兑 dev-server 自己种的测试码（和 check-room-contest-ui 同一个做法）。
const granted = await page.evaluate(async () => {
  const r = await fetch('/api/redeem', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'TESTMONTH' }),
  }).then((x) => x.json());
  if (r.active) {
    localStorage.setItem('slides_genius', JSON.stringify({
      active: true, period: r.period, until: r.until, channel: 'code', email: r.email, token: r.token, code: r.code,
    }));
  }
  return Boolean(r.active);
});
check('（尺子）兑到了天才身份（开屋要它）', granted);
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 20000 });

/** 进《多人》设置页：从主菜单先进个人主页；已经在个人主页上（《退出》回到的就是这儿）就直接点那一行。 */
async function openMultiplayer() {
  if (!(await page.$('#multiRow'))) {
    await page.click('#navProfile');
    await page.waitForSelector('#multiRow', { timeout: 10000 });
  }
  await page.click('#multiRow');
  await page.waitForSelector('#mpCreate', { timeout: 10000 });
  await page.waitForTimeout(300);
}
/** 从《多人》设置页退回去（那颗《退出》）：从个人主页进来的，回到个人主页。 */
async function leaveMultiplayer() {
  await page.click('.mp-back');
  await page.waitForSelector('#multiRow', { timeout: 10000 });
}

// ---- ① 多人（H-2） -----------------------------------------------------------
{
  // 尺子：联网时进《多人》，那一句不在。
  await openMultiplayer();
  check('（尺子）联网时进《多人》：没有「需要联网」那一句', (await page.$('#mpOffline')) === null);
  await leaveMultiplayer();

  await ctx.setOffline(true);
  check('（尺子）断网了：navigator.onLine 是 false', (await page.evaluate(() => navigator.onLine)) === false);
  await openMultiplayer();
  const look = await page.evaluate(() => {
    const note = document.querySelector('#mpOffline');
    const top = (sel) => document.querySelector(sel)?.getBoundingClientRect().top ?? null;
    const usable = (sel) => {
      const e = document.querySelector(sel);
      return Boolean(e) && !e.disabled && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
    };
    return {
      text: note?.textContent.trim() ?? null,
      color: note ? getComputedStyle(note).color : '',
      noteTop: note ? note.getBoundingClientRect().top : null,
      formTop: top('.mp-me'),
      create: usable('#mpCreate'), name: usable('#mpName'), code: usable('#mpCode'),
    };
  });
  check('断网进《多人》：表单最上面那一句是《多人游玩需要联网。》', look.text === s.mpNeedsNetwork, String(look.text));
  check('那一句在表单上面', look.noteTop !== null && look.formTop !== null && look.noteTop < look.formTop,
    `那一句 ${look.noteTop} · 表单 ${look.formTop}`);
  check('只提示、不收表单：开屋、名字、屋号都还能按', look.create && look.name && look.code, JSON.stringify(look));

  // 320×568：多出来的那一行不把屋号四格挤到页底那颗《退出》底下（那一对 10-11 方案 C-8 刚量过：矮屏三档条子）。
  await page.setViewportSize({ width: 320, height: 568 });
  await page.waitForTimeout(300);
  const small = await page.evaluate(() => {
    const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const q = e.getBoundingClientRect(); return { top: q.top, bottom: q.bottom }; };
    return { exit: r('.mp-back') || r('.page-exit'), cells: r('.mp-code-field .pin-row'), note: Boolean(document.querySelector('#mpOffline')) };
  });
  check('320×568、断网：那一句在，屋号四格也没被挤到《退出》底下',
    small.note && small.exit && small.cells && (small.cells.bottom <= small.exit.top + 0.5 || small.cells.top >= small.exit.bottom - 0.5),
    small.exit && small.cells ? `四格 ${Math.round(small.cells.top)}–${Math.round(small.cells.bottom)} · 退出 ${Math.round(small.exit.top)}–${Math.round(small.exit.bottom)}` : '没找到');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);

  // 按《开小屋》：表单照旧能按，真连不上就是「连不上网络」那一句（engine/room.ts 把请求失败认成 network）。
  await page.click('#mpCreate');
  const msg = await page.waitForFunction((want) => document.querySelector('#mpMsg')?.textContent.trim() === want,
    s.purchaseNetwork, { timeout: 20000 }).then(() => true).catch(() => false);
  check('断网按《开小屋》：得到「连不上网络」那一句', msg,
    await page.evaluate(() => document.querySelector('#mpMsg')?.textContent.trim() ?? '（没有 #mpMsg）'));
  check('按完之后还在设置页（没被带去别处）', (await page.$('#mpCreate')) !== null);

  // 连上网：那一句自己撤掉（online 事件）。
  await ctx.setOffline(false);
  const gone = await page.waitForFunction(() => !document.querySelector('#mpOffline'), { timeout: 5000 })
    .then(() => true).catch(() => false);
  check('连上网：「需要联网」那一句自己撤掉', gone);
  check('（尺子）连上了：navigator.onLine 是 true', (await page.evaluate(() => navigator.onLine)) === true);
}

check('一路没有没接住的错', errs.length === 0, errs.slice(0, 3).join(' | '));
await browser.close();
console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

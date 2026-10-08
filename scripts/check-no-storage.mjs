/**
 * localStorage 用不了的时候，站还得打得开（2026-10-08 方案 2-5）。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8986 dist
 *   node scripts/check-no-storage.mjs http://localhost:8986/
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么
 *
 * 有一类浏览器环境里，**一碰 localStorage 就抛**：Chrome 里关掉「网站数据」、一些 App 内置的
 * 浏览器、隐私设置开得很严的 Safari。这个仓库大多数读写存储的地方都包了 try/catch（isFirstRun、
 * 座位、分析那几处），可开机那一路上有四个没包：i18n.ts 的 loadLang / saveLang /
 * hasSeenTutorial / markTutorialSeen。boot() 第一句 loadLang() 一抛，整个开机就停在那儿——
 * 玩家看到的是**一张白屏**，什么字都没有，也不报错给他看。
 *
 * 另一件同类的事在小屋里：engine/room.ts 的 watchRoom 每一拍先把房间状态交给页面
 * （onState / onError），**之后**才排下一拍。页面那一头只要抛一次（比如它去读存储），下一拍就
 * 再也排不上——小屋页停在那一刻，不报错、不重连，看着像「网断了」。
 *
 *   ① 纯 node：把 watchRoom 打成包单独跑。onError、onState 头一回都抛，看下一拍照样排上、照样
 *      再问服务器（尺子：两条分支都真的走到了）。
 *   ② 浏览器：localStorage 一碰就抛的环境里开站——主菜单出来、开得了一局、个人主页打得开，全程
 *      没有一句没接住的错。尺子：同一套动作在正常环境里也走一遍；那个「一碰就抛」真的生效了。
 */
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BASE = process.argv[2];
if (!BASE) {
  console.error('用法: node scripts/check-no-storage.mjs http://localhost:8986/');
  process.exit(2);
}
const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const head = (t) => console.log('\n' + t);

// ── ① watchRoom：页面那一头抛了，下一拍照样排上 ───────────────────────────
head('① watchRoom：onState / onError 抛了，轮询不断');
{
  // 页面上那几样全局量，room.ts 和它 import 的几个模块在加载时会碰到。localStorage 给一份能用
  // 的：这一节量的是轮询，不是存储。座位先摆好，onState 那条分支才走得到（没有座位时
  // fetchState 直接回 noRoom，走的是 onError）。
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.window = globalThis;
  globalThis.addEventListener = () => {};
  globalThis.document = { addEventListener() {}, visibilityState: 'visible' };
  if (!globalThis.navigator) globalThis.navigator = { sendBeacon: () => true, language: 'zh-CN' };

  const dir = mkdtempSync(join(tmpdir(), 'no-storage-'));
  const out = join(dir, 'room.mjs');
  await build({
    entryPoints: [join(repo, 'src/engine/room.ts')],
    bundle: true, format: 'esm', outfile: out, logLevel: 'error', platform: 'neutral',
  });

  // async 的那一拍里抛出来的错，在 node 里是一次「没接住的 rejection」——照默认会把整个进程带
  // 走。这儿记下来就行：要量的是下一拍排没排上，不是错有没有往上冒（页面上它会进控制台）。
  const escaped = [];
  process.on('unhandledRejection', (e) => escaped.push(String(e)));

  // ①a 没有座位：fetchState 回 noRoom，走 onError。头一回抛。
  {
    const room = await import(pathToFileURL(out).href + '?a');
    let calls = 0;
    const stop = room.watchRoom(
      () => {},
      () => {
        calls++;
        if (calls === 1) throw new Error('页面那一头抛了一次（onError）');
      },
      15,
    );
    await new Promise((r) => setTimeout(r, 200));
    stop();
    check('①a（尺子）走的是 onError 那条分支', calls >= 1, `${calls} 次`);
    check('①a onError 头一回抛了，下一拍照样排上（又问了好几次）', calls >= 3, `${calls} 次`);
  }

  // ①b 有座位：fetchState 去问服务器，回一份房间状态，走 onState。头一回抛。
  {
    localStorage.setItem('slides_mp_seat', JSON.stringify({ code: 'ABCD', playerId: 'p1', playerToken: 't1', at: Date.now() }));
    let asked = 0;
    globalThis.fetch = async () => {
      asked++;
      return {
        ok: true,
        status: 200,
        json: async () => ({ code: 'ABCD', host: 'p1', round: 0, players: [], serverNow: Date.now() }),
      };
    };
    const room = await import(pathToFileURL(out).href + '?b');
    check('①b（尺子）座位读进来了', Boolean(room.currentRoom()), JSON.stringify(room.currentRoom()));
    let states = 0;
    const stop = room.watchRoom(
      () => {
        states++;
        if (states === 1) throw new Error('页面那一头抛了一次（onState）');
      },
      () => {},
      15,
    );
    await new Promise((r) => setTimeout(r, 250));
    stop();
    check('①b（尺子）走的是 onState 那条分支', states >= 1, `${states} 次`);
    check('①b onState 头一回抛了，下一拍照样排上（服务器又被问了好几次）', states >= 3 && asked >= 3,
      `onState ${states} 次、问了 ${asked} 次`);
  }
  check('（尺子）抛出来的那两句真的往外冒了（没被悄悄吞掉）', escaped.length >= 2, escaped.slice(0, 2).join(' | '));
}

// ── ② 浏览器：localStorage 一碰就抛，站照样打得开 ─────────────────────────
head('② 浏览器：localStorage 一碰就抛的环境里开站');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/** 开站 → 主菜单 → 开一局方块 → 回主菜单 → 个人主页。回每一步走没走到，和一路上没接住的错。 */
async function walk(blocked) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
  if (blocked) {
    await ctx.addInitScript(() => {
      // 和 Chrome 关掉网站数据时一个样：连 `window.localStorage` 这一下读都抛 SecurityError。
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('The operation is insecure.', 'SecurityError');
        },
      });
    });
  }
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  await page.goto(BASE, { waitUntil: 'load' });
  const stubbed = await page.evaluate(() => {
    try {
      void window.localStorage;
      return false;
    } catch {
      return true;
    }
  });
  const menu = await page.waitForSelector('.home-icon-btn', { timeout: 20000 }).then(() => true).catch(() => false);
  const blank = await page.evaluate(() => (document.body.innerText || '').trim().length === 0);
  let board = false;
  if (menu) {
    // 跳过最上面那张《每日挑战》：按下标点的是玩法卡，下标从方块数起。用 el.click()，不用
    // page.click()——手机竖屏的主菜单是一条鱼眼轴，远处的卡在视口外面（CLAUDE.md）。
    await page.$$eval('.home-icon-btn:not(.home-icon-btn--daily)', (els) => els[0].click());
    await page.waitForTimeout(600);
    if (await page.$('#startBtn')) await page.$eval('#startBtn', (e) => e.click());
    board = await page
      .waitForFunction(() => document.querySelectorAll('#boardWrap [data-r][data-c]').length > 0, { timeout: 20000 })
      .then(() => true)
      .catch(() => false);
  }
  // 回主菜单：手机的返回键那一套（engine/backNav.ts）——和玩家按返回键一个样。
  await page.goBack().catch(() => {});
  await page.waitForTimeout(800);
  let profile = false;
  if (await page.$('#navProfile')) {
    await page.$eval('#navProfile', (e) => e.click());
    await page.waitForTimeout(900);
    profile = (await page.evaluate(() => (document.body.innerText || '').trim().length)) > 0;
  }
  await ctx.close();
  return { stubbed, menu, blank, board, profile, errs };
}

const normal = await walk(false);
check('（尺子）正常环境：主菜单出来了', normal.menu);
check('（尺子）正常环境：开得了一局', normal.board);
check('（尺子）正常环境：一路没有没接住的错', normal.errs.length === 0, normal.errs.slice(0, 2).join(' | '));

const blocked = await walk(true);
check('（尺子）localStorage 真的一碰就抛', blocked.stubbed === true);
check('② 主菜单出来了（不是白屏）', blocked.menu && !blocked.blank, JSON.stringify({ menu: blocked.menu, blank: blocked.blank }));
check('② 开得了一局（棋盘上有棋子）', blocked.board);
check('② 个人主页打得开', blocked.profile);
check('② 一路没有没接住的错', blocked.errs.length === 0, blocked.errs.slice(0, 3).join(' | '));

await browser.close();
console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

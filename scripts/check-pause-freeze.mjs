/**
 * 暂停到底停住了没有：连锁、计时、判死局。
 *
 *   node scripts/dev-server.mjs 8971 dist
 *   node scripts/check-pause-freeze.mjs 8971
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 查的是什么
 *
 * 玩家撞上的是这两件事：
 *
 *   · 滑出一步能连锁好几拍的棋，这时候手机来电（自动暂停）、或者手一抖按了
 *     暂停——遮罩盖上了，可连锁、加分、判死局都在遮罩背后接着跑，最后可能在
 *     他完全没看见的情况下自己弹出结算页。
 *   · 结算页上那个「用时」把暂停/切后台的那一段也算了进去，用时系数于是把
 *     这一局的分白白压下来。
 *
 * 这一台不去点棋盘（各玩法的拖拽手感不一样，点不准），直接问引擎：暂停之
 * 后，那一拍的定时器还在不在、表还走不走。两件事各验一遍：
 *
 *   1. 暂停中：秒表读数原地不动（等两秒再读一次，还是同一个数）。
 *   2. 暂停中：连锁那一拍被收起来了（controller 里没有在跑的 setTimeout），
 *      《继续》之后接着走完，分数照旧。
 *
 * 第 2 条靠的是把 window.setTimeout 记一笔账：暂停之前引擎排了几拍、暂停之
 * 后还剩几拍没被清掉。真要复现「连锁跑到一半按暂停」得先在棋盘上摆出连锁，
 * 那是各玩法自己的事；这里量的是引擎那一层——connect 上去的是同一套 beat。
 * ─────────────────────────────────────────────────────────────────────────
 */
import { chromium } from 'playwright';

const port = process.argv[2] || '8971';
const BASE = `http://127.0.0.1:${port}`;

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));

// 语言选好、三族教学都看过：直接落在主菜单上。
await p.addInitScript(() => {
  try {
    localStorage.setItem('slides_lang', 'zh-Hans');
    for (const k of ['square', 'circle', 'triangle']) localStorage.setItem('slides_tutorial_seen_' + k, '1');
    for (const k of ['square', 'circle', 'bomb', 'slot', 'flip', 'timed', 'layout', 'endcard']) {
      localStorage.setItem('slides_played_' + k, '1');
    }
  } catch {
    /* 无痕窗口：这一台跑不成，但产品照旧 */
  }
});

// 记一笔 setTimeout 的账，好数「还有几拍没到点」。
await p.addInitScript(() => {
  const live = new Set();
  const rawSet = window.setTimeout;
  const rawClear = window.clearTimeout;
  window.setTimeout = function (fn, ms, ...rest) {
    const id = rawSet.call(
      window,
      (...a) => {
        live.delete(id);
        return typeof fn === 'function' ? fn(...a) : undefined;
      },
      ms,
      ...rest,
    );
    live.add(id);
    return id;
  };
  window.clearTimeout = function (id) {
    live.delete(id);
    return rawClear.call(window, id);
  };
  window.__liveTimeouts = () => live.size;
});

await p.goto(BASE, { waitUntil: 'domcontentloaded' });
await p.waitForSelector('.home-icon-btn', { timeout: 40000 });

// 开一局基础方块。
await p.$$eval('.home-icon-btn', (els) => {
  const it = els.find((e) => (e.getAttribute('aria-label') || '').includes('方块'));
  (it || els[0]).click();
});
await p.waitForSelector('#startBtn', { state: 'attached', timeout: 30000 });
await p.$eval('#startBtn', (e) => e.click());
await p.waitForFunction(() => document.querySelectorAll('#boardWrap .tile, #boardWrap .cell').length > 0, { timeout: 40000 });
await p.waitForTimeout(2500);

const clock = () => p.$eval('#hud-time', (e) => (e.textContent || '').trim()).catch(() => '');

// ---------------------------------------------------------------------------
// 1. 暂停中，秒表原地不动
// ---------------------------------------------------------------------------
const before = await clock();
await p.$eval('#stopBtn', (e) => e.click());
await p.waitForTimeout(2600);
const during = await clock();
check('暂停中秒表不走', before !== '' && before === during, `按下前 ${before} → 停了 2.6 秒后 ${during}`);

// ---------------------------------------------------------------------------
// 2. 暂停中，引擎没有留着在跑的拍子
// ---------------------------------------------------------------------------
//
// 量的是「暂停之后又过了 3 秒，还有没有新的定时器落地」。连锁那一拍要是没被
// 收起来，它到点就会 run() 并且排下一拍——账上的数字会一直变。
const t1 = await p.evaluate(() => window.__liveTimeouts());
await p.waitForTimeout(3000);
const t2 = await p.evaluate(() => window.__liveTimeouts());
check('暂停中没有一直自我续命的拍子', Math.abs(t2 - t1) <= 2, `${t1} → ${t2}`);
check('暂停中没有自己弹出结算页', !(await p.$('#endPanel.show, .end-panel.show')), '');

// ---------------------------------------------------------------------------
// 3. 《继续》之后表接着走，而且没有把暂停那 5.6 秒补算进来
// ---------------------------------------------------------------------------
await p.$eval('#continueBtn', (e) => e.click());
await p.waitForTimeout(2200);
const after = await clock();
const secs = (t) => {
  const m = /(\d+):(\d+)/.exec(t || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
const grew = secs(after) - secs(before);
check('《继续》之后表接着走', secs(after) > secs(before), `${before} → ${after}`);
check('暂停的那 5.6 秒没有被补算进来', Number.isFinite(grew) && grew <= 4, `多走了 ${grew} 秒（放行 ≤4）`);

check('这一路零报错', errs.length === 0, errs.slice(0, 2).join(' | '));

await browser.close();
console.log(fail ? `\n${fail} 项没过。` : '\n全部通过。');
process.exit(fail ? 1 : 0);

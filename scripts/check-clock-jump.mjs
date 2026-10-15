/**
 * 墙上的钟被拨了，一局的计时不跟着跳（10-15 补充 S8，L-8 ①）。
 *
 *   node scripts/dev-server.mjs 8933 dist
 *   node scripts/check-clock-jump.mjs http://localhost:8933/
 *
 * 原先计时（engine/timer.ts）、连锁那一拍「还剩多久」（gameController 的 armBeat / holdBeat）、教学条的计时都拿
 * Date.now() 量。page.clock.setSystemTime 只挪 Date.now（单调钟 performance.now 不动），实测：
 *   · 计时局局中往前拨 60 秒：倒数从 1:38 跳到 0:37；往回拨 60 秒：倒数变成 2:37。
 *   · 无限反转往回拨 60 秒之后结束：用时 −57 秒，服务器（api/_maxscore.js 的 vetRun：用时 < 0 一律拒）整局拒收。
 * 现在都量单调钟。这道门量的是：
 *   ① 计时局：往前拨 60 秒、往回拨 60 秒，剩余时间都只随真实流逝变（各量一次，差不超过 3 秒）；
 *   ② 无限反转：往回拨 60 秒之后打几秒再结束，存档里那一局用时 ≥ 0，而且过得了 vetRun。
 * 撤掉改法（timer.ts 换回 Date.now），① ② 都红。
 */
import { chromium } from 'playwright';
import { vetRun } from '../api/_maxscore.js';

const BASE = (process.argv[2] || 'http://localhost:8933/').replace(/\/+$/, '');
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errs = [];
const seed = () => {
  localStorage.setItem('slides_lang', 'zhHans');
  localStorage.setItem('slides_intro_seen', '1');
  for (const k of ['square', 'circle', 'triangle']) localStorage.setItem('slides_tutorial_seen_' + k, '1');
  for (const k of ['square', 'circle', 'bomb', 'slot', 'flip', 'timed', 'layout', 'endcard', 'totaltip', 'finished', 'puzzle']) {
    localStorage.setItem('slides_played_' + k, '1');
  }
  // 无限反转是天才特供：本机记一份权益（只开本机的锁，这道门不交卷）。
  localStorage.setItem('slides_genius', JSON.stringify({ active: true, channel: 'code', until: Date.now() + 365 * 864e5 }));
};
const secs = (t) => {
  const m = /(\d+):(\d+)/.exec(t || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

// ── ① 计时局：拨钟，倒数不跳 ─────────────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(seed);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.clock.install();
  await p.clock.resume();
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.home-icon-btn', { timeout: 40000 });
  await p.$$eval('.home-icon-btn--timed', (els) => els[0]?.click());
  await p.waitForSelector('.timed-page #timedShapes', { timeout: 30000 });
  await p.$eval('#timedShapes .slot-pick-opt[data-family="square"]', (e) => e.click());
  await p.waitForSelector('#startBtn', { state: 'attached', timeout: 30000 });
  await p.$eval('#startBtn', (e) => e.click());
  await p.waitForFunction(() => document.querySelectorAll('#boardWrap .tile').length > 0, null, { timeout: 40000 });
  await p.waitForTimeout(2000);
  const pill = () => p.$eval('#timerPill', (e) => (e.textContent || '').trim()).catch(() => '');
  for (const [shift, tag] of [[60_000, '往前拨 60 秒'], [-60_000, '往回拨 60 秒']]) {
    const before = secs(await pill());
    const t0 = Date.now();
    const now = await p.evaluate(() => Date.now());
    await p.clock.setSystemTime(now + shift);
    await p.waitForTimeout(2000);
    const after = secs(await pill());
    const real = (Date.now() - t0) / 1000;
    const dropped = before - after;
    check(`① 计时局${tag}：剩余时间只随真实流逝变（真实过了 ${real.toFixed(1)} 秒）`,
      Number.isFinite(dropped) && Math.abs(dropped - real) <= 3, `${before} 秒 → ${after} 秒（掉了 ${dropped}）`);
  }
  await ctx.close();
}

// ── ② 无限反转：往回拨 60 秒之后结束，用时 ≥ 0、过得了 vetRun ─────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(seed);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.clock.install();
  await p.clock.resume();
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.home-icon-btn', { timeout: 40000 });
  await p.$eval('.home-icon-btn[aria-label="无限反转"]', (e) => e.click());
  await p.waitForSelector('.flip-page', { timeout: 15000 });
  await p.$eval('.slot-pick-opt[data-family="square"]', (e) => e.click());
  await p.waitForSelector('#startBtn', { state: 'attached', timeout: 30000 });
  await p.$eval('#startBtn', (e) => e.click());
  await p.waitForFunction(() => document.querySelectorAll('#boardWrap .tile').length > 0, null, { timeout: 40000 });
  await p.waitForTimeout(2000);
  const now = await p.evaluate(() => Date.now());
  await p.clock.setSystemTime(now - 60_000);
  await p.waitForTimeout(3000);
  await p.evaluate(() => document.getElementById('stopBtn').click());
  await p.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
  await p.evaluate(() => document.getElementById('pauseFinishBtn').click());
  const ended = await p.waitForSelector('#endOverlay.show', { timeout: 15000 }).then(() => true).catch(() => false);
  const run = await p.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !/_flip\d*_ero\d+::runs$/.test(k)) continue;
      const list = JSON.parse(localStorage.getItem(k) || '[]');
      if (list.length) return list[list.length - 1].data;
    }
    return null;
  });
  check('②（尺子）结算页出来了、存档里有这一局', ended && !!run, JSON.stringify({ ended, run: !!run }));
  check('② 往回拨 60 秒之后结束：用时 ≥ 0（大约是真打的那几秒）', !!run && run.elapsedSec >= 0 && run.elapsedSec <= 15, `用时 ${run?.elapsedSec}`);
  const vet = run ? vetRun(run.shapeId, run) : null;
  check('② 这一局过得了 vetRun（服务器不会因为用时整局拒收）', vet?.verdict === 'ok', JSON.stringify(vet));
  await ctx.close();
}

check('全程零报错', errs.length === 0, errs.slice(0, 2).join(' | '));
await browser.close();
console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

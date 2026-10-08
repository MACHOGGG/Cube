/**
 * 每日挑战那一局没进今日榜：结算页上说一句明话（2026-10-08 方案 2-11）。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8997 dist      （内存版；TESTMONTH、TESTYEAR、TESTHALF 各兑一次）
 *   node scripts/check-daily-note.mjs http://localhost:8997/
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么
 *
 * 每日挑战那一局交上去，服务器回一个词：stored / late / rejected（api/scores.js 的 pushDaily）。
 * 日子和种子都是按**本机的钟**算的——钟慢了几天，交上去的是「过去那一天」的挑战（late）；钟快了，
 * 是「还没到的那一天」（rejected）。从前客户端不读这个词：被拒了一个字都不说，玩家以为上榜了，去
 * 榜上一看没有。
 *
 * 网页端平时会先向服务器对一次钟（engine/dailyClock.ts：对首页发一个 HEAD、读回包头的 Date），
 * 本机钟歪了也会被纠正——对不上的时候（离线、被拦）才退回本机的钟，而那正是「钟错了的设备打的那
 * 一局进不了今日榜」的来路（那个文件头原话）。所以钟歪了的那两台把 HEAD 拦掉（和 check-daily 同
 * 一个做法）。
 *
 * 三台设备，各打一局每日挑战（开局就按《结束游戏》交卷）：
 *
 *   ①（尺子）钟是对的：进了今日榜，结算页上**不说**那一句。
 *   ② 钟快了三天：服务器回 rejected，结算页上说「这一局没进今日挑战榜。看看设备的日期和时间对不对。」
 *   ③ 钟慢了三天：服务器回 late，同一句。
 *
 * 用电脑的视口：每日挑战轮到七色圆球那一天，竖着拿手机会先说「请横屏」——这一台量的不是那个。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2];
if (!BASE) {
  console.error('用法: node scripts/check-daily-note.mjs http://localhost:8997/');
  process.exit(2);
}
const NOTE = '这一局没进今日挑战榜。看看设备的日期和时间对不对。';
const DAY = 86_400_000;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/**
 * 一台设备：钟拨到 `shiftDays` 天之后（负数是之前），兑一张码（每日榜要登录），打一局每日挑战、
 * 开局就交卷。回服务器那一句、结算页上那一句。
 */
async function playDaily(shiftDays, code) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => {
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_intro_seen', '1');
    for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle',
      'slides_played_square', 'slides_played_circle', 'slides_know_how']) localStorage.setItem(k, '1');
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  // 盯着交卷那一条的回包：服务器到底说了哪个词。
  let verdict = null;
  page.on('response', async (res) => {
    if (!res.url().endsWith('/api/scores') || res.request().method() !== 'POST') return;
    try {
      const body = JSON.parse(res.request().postData() || '{}');
      if (body.action !== 'push') return;
      verdict = (await res.json()).daily ?? null;
    } catch {}
  });
  // 钟歪了的那两台：对不上服务器的钟，只能信本机的（见文件头）。
  if (shiftDays) await page.route('**/*', (route) => (route.request().method() === 'HEAD' ? route.abort() : route.continue()));
  await page.clock.install({ time: Date.now() + shiftDays * DAY });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn--daily', { timeout: 20000 });
  const granted = await page.evaluate(async (c) => {
    const r = await fetch('/api/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: c }) }).then((x) => x.json());
    if (!r.active) return false;
    localStorage.setItem('slides_genius', JSON.stringify({ active: true, period: r.period, until: r.until, channel: 'code', email: r.email, token: r.token, code: r.code }));
    return true;
  }, code);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn--daily', { timeout: 20000 });
  await page.$eval('.home-icon-btn--daily', (e) => e.click());
  await page.waitForSelector('#dailyPlay', { timeout: 10000 });
  await page.click('#dailyPlay');
  const up = await page
    .waitForFunction(() => document.querySelectorAll('#boardWrap [data-r][data-c]').length > 0, { timeout: 30000 })
    .then(() => true).catch(() => false);
  await page.waitForTimeout(800);
  await page.$eval('#stopBtn', (e) => e.click()).catch(() => {});
  await page.waitForSelector('#pauseOverlay.show', { timeout: 8000 }).catch(() => {});
  await page.$eval('#pauseFinishBtn', (e) => e.click()).catch(() => {});
  const ended = await page.waitForSelector('#endOverlay.show', { timeout: 15000 }).then(() => true).catch(() => false);
  // 交卷那一条不 await（结算页先出来），回包要再等一会儿；没上线的那一下最多重试一次。
  for (let i = 0; i < 40 && verdict === null; i++) await page.waitForTimeout(250);
  await page.waitForTimeout(400);
  const note = await page.evaluate(() => {
    const el = document.getElementById('endDailyNote');
    return { shown: Boolean(el && !el.hidden), text: el?.textContent?.trim() ?? '' };
  });
  await ctx.close();
  return { granted, up, ended, verdict, note, errs };
}

const ok = await playDaily(0, 'TESTMONTH');
check('①（尺子）钟是对的：兑到了码、开得了局、交得了卷', ok.granted && ok.up && ok.ended, JSON.stringify(ok));
check('①（尺子）服务器说进了今日榜（stored）', ok.verdict === 'stored', String(ok.verdict));
check('① 结算页上不说那一句', !ok.note.shown, JSON.stringify(ok.note));

const ahead = await playDaily(3, 'TESTYEAR');
check('②（尺子）钟快了三天：服务器回 rejected', ahead.verdict === 'rejected', String(ahead.verdict));
check('② 结算页上说了那一句', ahead.note.shown && ahead.note.text === NOTE, JSON.stringify(ahead.note));

const behind = await playDaily(-3, 'TESTHALF');
check('③（尺子）钟慢了三天：服务器回 late', behind.verdict === 'late', String(behind.verdict));
check('③ 结算页上也说了那一句', behind.note.shown && behind.note.text === NOTE, JSON.stringify(behind.note));

const errs = [...ok.errs, ...ahead.errs, ...behind.errs];
check('全程零报错', errs.length === 0, errs.slice(0, 2).join(' | '));
await browser.close();
console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

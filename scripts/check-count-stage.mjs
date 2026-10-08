/**
 * 4-3-2-1 那一页：今日挑战的和基础玩法的长得一样（10-08 方案 3-F）。
 *
 *   node scripts/dev-server.mjs 8970 dist
 *   node scripts/check-count-stage.mjs http://localhost:8970/
 *
 * 方案 3-F-1 原话：「今日挑战倒数页改用 startStage 组件（countFrom 等已支持定制），删自建版——
 * 『界面统一』自动达成。」
 *
 * 从前今日挑战那一幕借的是挑图形那几页的骨架（.slot-page ＋ 页底那颗 .page-exit）：同一个 4-3-2-1，
 * 图小一圈（390 宽的屏上 155 对 260）、倒数窗高出 68px、《退出》是 62px 站在离底 116 的地方——从主
 * 菜单点一个玩法进去和从今日挑战进去，长得不一样。现在它套的就是游戏外壳开局那一层
 * （.overlay--start ＋ startStage），这一道量的是「一样」到底一样到哪儿：
 *
 *   · 上半屏那一格（.start-mark）：位置、大小和基础玩法开局页那张玩法图一致；
 *   · 倒数窗（.cd-window）：位置、大小一致；
 *   · 《退出》：是 startStage 底下那一排的键（.start-actions 里的 .start-act），尺寸、离底的距离和基础
 *     玩法那颗《退出》一致；这一页上没有 .page-exit；
 *   · 今日那一局（图）和输代号那一局（那串码）两条路都量；那串码在那一格里居中。
 *
 * 手机两档、电脑一档。
 */
import { chromium } from 'playwright';
import * as SC from '../api/_seedcode.js';

const BASE = process.argv[2];
if (!BASE) {
  console.error('用法: node scripts/check-count-stage.mjs http://localhost:8970/');
  process.exit(2);
}

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const SEED = `
  localStorage.setItem('slides_lang', 'zhHans');
  localStorage.setItem('slides_intro_seen', '1');
  localStorage.setItem('slides_played_square', '1');
  localStorage.setItem('slides_played_circle', '1');
  localStorage.setItem('slides_played_finished', '1');
  for (const k of ['bomb', 'slot', 'flip', 'puzzle', 'timed', 'layout']) localStorage.setItem('slides_played_' + k, '1');
`;
/** 输代号那一局用的码：基础圆球（编号表第 1 行）。 */
const CODE = SC.encodeSeed(SC.DEAL_VERSION, 1, 777);

/** 一张倒数页上量的那几样（都是屏幕坐标）。`mark` 是上半屏那一格，`back` 是《退出》。 */
const MEASURE = () => {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, bottomGap: innerHeight - r.bottom };
  };
  const back = document.querySelector('#startBackBtn, #dailyBack');
  const code = document.querySelector('.daily-seed-code');
  return {
    mark: box(document.querySelector('.start-mark')),
    cd: box(document.querySelector('.cd-window')),
    back: box(back),
    backIsStartAct: !!back && back.classList.contains('start-act') && !!back.closest('.start-actions'),
    pageExit: !!document.querySelector('.page-exit'),
    code: box(code),
    turn: !!document.querySelector('#dailyTurn') && !document.querySelector('#dailyTurn').hidden,
  };
};
const near = (a, b, keys, tol = 1) => !!a && !!b && keys.every((k) => Math.abs(a[k] - b[k]) <= tol);
const fmt = (b) => (b ? `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}×${Math.round(b.h)}（离底 ${Math.round(b.bottomGap)}）` : '没有');

for (const [w, h, label] of [[390, 844, '手机 390×844'], [360, 640, '手机 360×640'], [1280, 800, '电脑 1280×800']]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 800, hasTouch: w < 800 });
  await ctx.addInitScript(SEED);
  const errs = [];
  const open = async () => {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(BASE);
    await p.waitForSelector('.home-icon-btn', { timeout: 20000 });
    await p.waitForTimeout(400);
    return p;
  };

  // 基准：从主菜单点「方块」进去的那一页。
  let p = await open();
  await p.evaluate(() => [...document.querySelectorAll('.home-icon-btn')].find((b) => /^方块/.test(b.getAttribute('aria-label') || '')).click());
  await p.waitForSelector('#startCount', { timeout: 10000 });
  await p.waitForTimeout(300);
  const base = await p.evaluate(MEASURE);
  await p.close();
  check(`${label}：（尺子）基础玩法那一页量到了图、倒数窗、《退出》`, !!base.mark && !!base.cd && !!base.back && base.backIsStartAct,
    `${fmt(base.mark)} / ${fmt(base.cd)} / ${fmt(base.back)}`);

  // 今日挑战：今天那一局（今天那张图）。
  p = await open();
  await p.click('.home-icon-btn--daily');
  await p.waitForSelector('#dailyPlay', { timeout: 10000 });
  await p.click('#dailyPlay');
  await p.waitForSelector('.daily-page--count', { timeout: 5000 });
  await p.waitForTimeout(300);
  const daily = await p.evaluate(MEASURE);
  const art = await p.evaluate(() => !!document.querySelector('#dailyEmblem svg[data-daily-weekday]'));
  await p.close();
  // 七色圆球那一天竖着拿手机，数之前先请他转过来（那一句露着、图藏着）——那一天这几条量不到，跳过。
  // 认的是那一句露没露出来，不是「上半屏空着」：旧版那一页压根没有 .start-mark，按「空着」认就会把
  // 那一版当成转手机的那一天整段跳过去。
  if (daily.turn) {
    console.log(`SKIP  ${label}：今天轮到要横着打的那一副，倒数之前先请人转手机，上半屏是空的`);
  } else {
    check(`${label}：今日那一局，上半屏是今天那张图`, art);
    check(`${label}：今日那一局，那一格和基础玩法的玩法图一样大、在同一个地方`, near(base.mark, daily.mark, ['x', 'y', 'w', 'h']),
      `基础 ${fmt(base.mark)} ｜ 今日 ${fmt(daily.mark)}`);
    check(`${label}：今日那一局，倒数窗一样大、在同一个地方`, near(base.cd, daily.cd, ['x', 'y', 'w', 'h']),
      `基础 ${fmt(base.cd)} ｜ 今日 ${fmt(daily.cd)}`);
  }
  check(`${label}：今日那一局，《退出》是 startStage 那一排的键（不是页底那颗 .page-exit）`, daily.backIsStartAct && !daily.pageExit);
  check(`${label}：今日那一局，《退出》和基础玩法那颗一样大、离底一样远`, near(base.back, daily.back, ['w', 'h', 'y', 'bottomGap']),
    `基础 ${fmt(base.back)} ｜ 今日 ${fmt(daily.back)}`);

  // 今日挑战：输代号那一局（那串码）。
  p = await open();
  await p.click('.home-icon-btn--daily');
  await p.waitForSelector('#seedInput', { timeout: 10000 });
  await p.fill('#seedInput', CODE.slice(0, 4) + '-' + CODE.slice(4));
  await p.click('#seedGo');
  await p.waitForSelector('.daily-page--count', { timeout: 5000 });
  await p.waitForTimeout(300);
  const coded = await p.evaluate(MEASURE);
  await p.close();
  check(`${label}：输代号那一局，那一格和基础玩法的玩法图一样大、在同一个地方`, near(base.mark, coded.mark, ['x', 'y', 'w', 'h']),
    `基础 ${fmt(base.mark)} ｜ 代号 ${fmt(coded.mark)}`);
  check(`${label}：输代号那一局，那串码在那一格里居中（横竖都不偏过 2px）`,
    !!coded.code && !!coded.mark &&
      Math.abs(coded.code.x + coded.code.w / 2 - (coded.mark.x + coded.mark.w / 2)) <= 2 &&
      Math.abs(coded.code.y + coded.code.h / 2 - (coded.mark.y + coded.mark.h / 2)) <= 2,
    `码 ${fmt(coded.code)} ｜ 格 ${fmt(coded.mark)}`);
  check(`${label}：输代号那一局，倒数窗和《退出》也和基础玩法一致`,
    near(base.cd, coded.cd, ['x', 'y', 'w', 'h']) && near(base.back, coded.back, ['w', 'h', 'y', 'bottomGap']) && coded.backIsStartAct && !coded.pageExit,
    `倒数窗 ${fmt(coded.cd)} ｜ 《退出》 ${fmt(coded.back)}`);
  check(`${label}：全程零报错`, errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await browser.close();
console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

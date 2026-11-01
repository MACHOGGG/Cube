/**
 * 局中灯泡（10-31 方案推12 Z-J03，10-14 F-2 ①–③、C-11）。要 dev-server + Chromium。
 *
 *   node scripts/dev-server.mjs 8944 dist
 *   node scripts/check-hint-bulb.mjs http://localhost:8944/
 *
 * 每个玩法前两局，暂停那块琥珀牌分成「左暂停｜右灯泡」（横屏上下分）；第 3 局回到正中。这道门量：
 *
 *   1  方块：第 1、2 局有灯泡（#hintBtn 露面、#stopBtn 挂上分半的类）、第 3 局没有——《再来一局》也算一局；本机记到 2。
 *   2  方块教学局（新人头一局小球）也算第 1 局：有灯泡，slides_bulb_circle = 1。
 *   3  每日挑战单独数：打一局今日挑战，slides_bulb_daily = 1，方块那一格不动。
 *   4  小屋局没有灯泡：小屋那一局不给 bulbKey（读源码：startMultiplayerRun 挂载那一份 opts 里没有它；gameShell 只在给了
 *      bulbKey 的单人局造那颗键）。
 *   5  点灯泡：先停住（计时那一局的钟不走、暂停面板不翻出来），开的是这一局那一份规则（计时那一条在里面）；关了接着走。
 *   6  点 #stopBtn 的正中照旧是暂停（灯泡那 42% 盖不到它的中心）；#stopBtn 的盒子和没有灯泡的那一局一个像素不差。
 *   7  横屏（844×390）：上下分，两半都 ≥44 高；七色圆球（强制横屏）同样。
 *   8  一路零脚本报错。
 *   9–13（11-01 补充方案推15B）：暂停两根竖条在左（上）半正中、灯泡记号在灯泡那一半正中、按下不露直角、电脑上灯泡也
 *      不画圆盘、电脑头一局 has-coach 开打后灯泡叠得对——竖屏 390 / 320、横屏、电脑 1440×900 / 1000×700。
 *
 * 本门专门清掉 slides_bulb_*（scripts/lib/unlockAll.mjs 默认把它们记满）。
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { UNLOCK_ALL, BULB_KEYS, SIGNED_IN_CACHE } from './lib/unlockAll.mjs';

const BASE = (process.argv[2] || 'http://localhost:8944/').replace(/\/*$/, '/');
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const errs = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/** 什么都解锁了、但一颗灯泡都还没用过的老玩家（可选：登着，好开更多布局）。 */
const NO_BULBS = Object.fromEntries(Object.entries(UNLOCK_ALL).filter(([k]) => !BULB_KEYS.some((b) => k === `slides_bulb_${b}`)));

async function device(vp, preset, signed = false) {
  const ctx = await browser.newContext({ viewport: { width: vp[0], height: vp[1] }, isMobile: vp[1] > vp[0], hasTouch: vp[1] > vp[0] });
  await ctx.addInitScript((kv) => {
    if (sessionStorage.getItem('hb_primed') === '1') return;
    sessionStorage.setItem('hb_primed', '1');
    localStorage.clear();
    for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
  }, { slides_lang: 'zhHans', ...preset, ...(signed ? { slides_genius: SIGNED_IN_CACHE } : {}) });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE, { waitUntil: 'load' });
  await p.waitForSelector('.home-page', { timeout: 30000 });
  await p.waitForTimeout(400);
  return { ctx, p };
}
const tap = (p, card) => p.$eval(`#homeGrid [data-card="${card}"]`, (e) => e.click());
/** 等开打（倒数数完、棋盘有子），再等灯泡那一下排好。 */
async function started(p) {
  await p.waitForFunction(() => !document.querySelector('#startOverlay.show') && document.querySelectorAll('.tile, .ball, .tri').length > 0, null, { timeout: 40000 });
  await p.waitForTimeout(500);
}
/** 这一刻那块牌：灯泡在不在、#stopBtn 挂没挂分半的类、两颗键的盒子。 */
const chip = (p) => p.evaluate(() => {
  const r = (e) => {
    if (!e || e.hidden) return null;
    const b = e.getBoundingClientRect();
    return { left: b.left, top: b.top, width: b.width, height: b.height };
  };
  const stop = document.querySelector('#stopBtn');
  const hint = document.querySelector('#hintBtn');
  return {
    hint: !!hint && !hint.hidden,
    split: !!stop && (stop.classList.contains('stop-btn--split-h') || stop.classList.contains('stop-btn--split-v')),
    vertical: !!hint?.classList.contains('hint-btn--v'),
    stop: r(stop),
    hintBox: r(hint),
  };
});
async function finishAndReplay(p) {
  await p.$eval('#stopBtn', (e) => e.click());
  await p.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
  await p.$eval('#pauseFinishBtn', (e) => e.click());
  await p.waitForSelector('#endOverlay.show', { timeout: 15000 });
  await p.waitForTimeout(400);
  await p.$eval('#restartBtn', (e) => e.click());
  await started(p);
}

// ── 1 + 6：方块，三局 ─────────────────────────────────────────────────────────────
let plainStop = null;
{
  const { ctx, p } = await device([390, 844], NO_BULBS);
  await tap(p, 'square');
  await started(p);
  const g1 = await chip(p);
  check('1 方块第 1 局：有灯泡、暂停那块分两半', g1.hint && g1.split && !g1.vertical, JSON.stringify(g1));
  check('1 竖屏：灯泡在暂停那块的右边 42%（±2）', !!g1.hintBox && Math.abs(g1.hintBox.width - g1.stop.width * 0.42) <= 2 &&
    Math.abs(g1.hintBox.left + g1.hintBox.width - (g1.stop.left + g1.stop.width)) <= 1 && Math.abs(g1.hintBox.height - g1.stop.height) <= 1, JSON.stringify(g1));
  // 6. #stopBtn 的中心不在灯泡那一块里：在中心点上取元素，是暂停那颗。
  const atCenter = await p.evaluate(() => {
    const b = document.querySelector('#stopBtn').getBoundingClientRect();
    const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return el?.closest('#stopBtn') ? 'stop' : el?.closest('#hintBtn') ? 'hint' : el?.tagName;
  });
  check('6 #stopBtn 的正中是暂停那颗（灯泡盖不到）', atCenter === 'stop', String(atCenter));
  await finishAndReplay(p);
  const g2 = await chip(p);
  check('1 方块第 2 局（《再来一局》）：还有灯泡', g2.hint && g2.split, JSON.stringify(g2));
  await finishAndReplay(p);
  const g3 = await chip(p);
  plainStop = g3.stop;
  check('1 方块第 3 局：没有灯泡、暂停回到正中', !g3.hint && !g3.split, JSON.stringify(g3));
  check('6 有灯泡和没灯泡的两局，#stopBtn 的盒子一个像素不差', JSON.stringify(g1.stop) === JSON.stringify(g3.stop), `${JSON.stringify(g1.stop)} vs ${JSON.stringify(g3.stop)}`);
  check('1 本机记到 2（slides_bulb_square）', (await p.evaluate(() => localStorage.getItem('slides_bulb_square'))) === '2');
  await ctx.close();
}

// ── 2：新人头一局小球（教学局）也算第 1 局 ────────────────────────────────────────────────
{
  const { ctx, p } = await device([390, 844], {});
  await tap(p, 'circle');
  await started(p);
  const g = await chip(p);
  const coach = await p.evaluate(() => !!document.querySelector('.coach-bar:not([hidden])'));
  check('2 新人头一局小球（带教学条）：有灯泡', coach && g.hint, JSON.stringify({ coach, ...g }));
  check('2 记成第 1 局（slides_bulb_circle = 1）', (await p.evaluate(() => localStorage.getItem('slides_bulb_circle'))) === '1');
  await ctx.close();
}

// ── 3：每日挑战单独数 ───────────────────────────────────────────────────────────────
{
  const { ctx, p } = await device([390, 844], { ...NO_BULBS, slides_bulb_square: '2', slides_bulb_circle: '2' });
  await tap(p, 'daily');
  await p.waitForSelector('#dailyPlay', { timeout: 15000 });
  await p.$eval('#dailyPlay', (e) => e.click());
  await started(p);
  const g = await chip(p);
  const m = await p.evaluate(() => ({ daily: localStorage.getItem('slides_bulb_daily'), sq: localStorage.getItem('slides_bulb_square') }));
  check('3 每日挑战单独数：今日那一局有灯泡、记在 daily 那一格，方块那一格不动', g.hint && m.daily === '1' && m.sq === '2', JSON.stringify({ ...g, ...m }));
  await ctx.close();
}

// ── 4：小屋局没有灯泡（读源码）────────────────────────────────────────────────────────
{
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const body = main.slice(main.indexOf('function startMultiplayerRun'), main.indexOf('function startMultiplayerRun') + 6000);
  const mount = body.slice(body.indexOf('game.mount('), body.indexOf('game.mount(') + 2500);
  check('4 小屋那一局挂载时不给 bulbKey（没有灯泡）', mount.length > 0 && !/bulbKey/.test(mount));
  const shell = readFileSync(new URL('../src/ui/gameShell.ts', import.meta.url), 'utf8');
  check('4 gameShell 只在单人局（给了 bulbKey）造 #hintBtn', /meta\.bulbKey\s*\n?\s*\?\s*`<button class="icon-btn hint-btn" id="hintBtn"/.test(shell));
}

// ── 5：点灯泡——先停住、开这一局那一份规则、关了接着走 ──────────────────────────────────────
{
  const { ctx, p } = await device([390, 844], NO_BULBS);
  await tap(p, 'timed');
  await p.waitForSelector('.slot-pick-opt[data-family="square"]', { timeout: 15000 });
  await p.$eval('.slot-pick-opt[data-family="square"]', (e) => e.click());
  await started(p);
  await p.waitForTimeout(1300);
  await p.$eval('#hintBtn', (e) => e.click());
  await p.waitForSelector('.howto-ov', { timeout: 5000 });
  const t0 = await p.$eval('#timerPill', (e) => e.textContent);
  await p.waitForTimeout(2200);
  const t1 = await p.$eval('#timerPill', (e) => e.textContent);
  const m = await p.evaluate(() => ({
    pauseShown: !!document.querySelector('#pauseOverlay.show'),
    tips: [...document.querySelectorAll('.howto-ov .tut-rule--extra .tut-rule-num--word')].map((e) => e.textContent.trim()),
  }));
  check('5 点灯泡：钟停住', t0 === t1, `${t0} → ${t1}`);
  check('5 点灯泡：开的是规则窗，暂停面板不翻出来', !m.pauseShown, JSON.stringify(m));
  check('5 规则里有这一局那一层（计时）', m.tips.length === 1 && /计时/.test(m.tips[0]), m.tips.join(','));
  await p.$eval('#howtoOkBtn', (e) => e.click());
  await p.waitForTimeout(2300);
  const t2 = await p.$eval('#timerPill', (e) => e.textContent);
  check('5 关了接着走', t2 !== t1, `${t1} → ${t2}`);
  await ctx.close();
}

// ── 6（续）：没灯泡时点暂停 ─────────────────────────────────────────────────────────────
{
  const { ctx, p } = await device([390, 844], NO_BULBS);
  await tap(p, 'circle');
  await started(p);
  await p.click('#stopBtn');
  const shown = await p.waitForSelector('#pauseOverlay.show', { timeout: 5000 }).then(() => true).catch(() => false);
  check('6 有灯泡那一局，照常点 #stopBtn（Playwright 点正中）：是暂停', shown);
  await ctx.close();
}

// ── 7：横屏上下分，两半 ≥44 ────────────────────────────────────────────────────────────
for (const [card, name] of [['square', '方块'], ['circleSeven', '七色圆球']]) {
  const { ctx, p } = await device([844, 390], NO_BULBS, true);
  await tap(p, card);
  await started(p);
  const g = await chip(p);
  const top = g.stop ? g.stop.height * 0.58 : 0;
  check(`7 横屏 · ${name}：上下分（灯泡在下）`, g.hint && g.vertical && !!g.hintBox && Math.abs(g.hintBox.top + g.hintBox.height - (g.stop.top + g.stop.height)) <= 1, JSON.stringify(g));
  check(`7 横屏 · ${name}：两半都 ≥44 高`, top >= 44 && (g.hintBox?.height ?? 0) >= 44, `暂停 ${top.toFixed(0)} · 灯泡 ${g.hintBox?.height?.toFixed(0)}`);
  await ctx.close();
}

// ── 9–13：图形摆在自己那一半、按下不露直角、电脑上两半同样子（11-01 补充方案推15B）───────────────────────────
//
// 推12 只把暂停图形收窄到 58%，#stopBtn 是居中的弹性盒，图形仍在整颗正中，压在分缝上（390 竖屏偏 37px、320 偏 30px、
// 电脑偏 51.5px）。量：
//   ⑨ 暂停两根竖条的并框中心离「左（上）半正中」≤ 4（stop.left + 0.29·stop.width；横屏换 y），右（下）沿离灯泡那一半 > 2；
//   ⑩ 灯泡记号（圆盘以外那几笔）的并框中心离 #hintBtn 盒子中心 ≤ 3；
//   ⑪ #hintBtn 按下（chip--press）时外侧两角的圆角和 #stopBtn 一样；
//   ⑫ 电脑档：灯泡和暂停的 --ctl-disc 一样（都没有圆盘，站长 11-01）；
//   ⑬ 电脑档头一局（.has-coach）开打 200ms 后：hint.left = stop.left + stop.width − round(0.42·stop.width)（±1）。
const GEOM = () => {
  const stop = document.querySelector('#stopBtn');
  const hint = document.querySelector('#hintBtn');
  const union = (els) => {
    const rs = els.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    if (!rs.length) return null;
    const left = Math.min(...rs.map((r) => r.left)), right = Math.max(...rs.map((r) => r.right));
    const top = Math.min(...rs.map((r) => r.top)), bottom = Math.max(...rs.map((r) => r.bottom));
    return { left, right, top, bottom, cx: (left + right) / 2, cy: (top + bottom) / 2 };
  };
  const box = (e) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
  const radii = (e) => { const c = getComputedStyle(e); return { tl: c.borderTopLeftRadius, tr: c.borderTopRightRadius, br: c.borderBottomRightRadius, bl: c.borderBottomLeftRadius }; };
  hint.classList.add('chip--press');
  const pressed = radii(hint);
  hint.classList.remove('chip--press');
  return {
    shown: !hint.hidden,
    vertical: hint.classList.contains('hint-btn--v'),
    stop: box(stop), hint: box(hint),
    bars: union([...stop.querySelectorAll('svg.ctl-glyph rect')]),
    bulb: union([...hint.querySelectorAll('svg.ctl-glyph > :not(circle)')]),
    stopR: radii(stop), hintPressedR: pressed,
    stopDisc: getComputedStyle(stop).getPropertyValue('--ctl-disc').trim(),
    hintDisc: getComputedStyle(hint).getPropertyValue('--ctl-disc').trim(),
  };
};
for (const [vp, tag, desk] of [[[390, 844], '竖屏 390', false], [[320, 568], '竖屏 320', false], [[844, 390], '横屏 844×390', false],
  [[1440, 900], '电脑 1440×900', true], [[1000, 700], '电脑 1000×700', true]]) {
  const { ctx, p } = await device(vp, NO_BULBS, vp[0] > vp[1] && !desk);
  await tap(p, 'square');
  await started(p);
  const g = await p.evaluate(GEOM);
  if (!g.shown || !g.bars || !g.bulb) {
    check(`⑨ ${tag}：（尺子）灯泡露着、量得到两根竖条和灯泡记号`, false, JSON.stringify(g));
    await ctx.close();
    continue;
  }
  const S = g.stop, H = g.hint;
  if (!g.vertical) {
    const want = S.left + 0.29 * S.width;
    check(`⑨ ${tag}：暂停两根竖条在左半正中（|cx − (left + 0.29·w)| ≤ 4）`, Math.abs(g.bars.cx - want) <= 4, `cx ${g.bars.cx.toFixed(1)} · 要 ${want.toFixed(1)}`);
    check(`⑨ ${tag}：竖条右沿离灯泡那一半 > 2`, g.bars.right < H.left - 2, `右沿 ${g.bars.right.toFixed(1)} · 灯泡 ${H.left.toFixed(1)}`);
  } else {
    const want = S.top + 0.29 * S.height;
    check(`⑨ ${tag}：暂停两根竖条在上半正中（|cy − (top + 0.29·h)| ≤ 4）`, Math.abs(g.bars.cy - want) <= 4, `cy ${g.bars.cy.toFixed(1)} · 要 ${want.toFixed(1)}`);
    check(`⑨ ${tag}：竖条下沿离灯泡那一半 > 2`, g.bars.bottom < H.top - 2, `下沿 ${g.bars.bottom.toFixed(1)} · 灯泡 ${H.top.toFixed(1)}`);
  }
  const hc = { x: H.left + H.width / 2, y: H.top + H.height / 2 };
  check(`⑩ ${tag}：灯泡记号在灯泡那一半正中（≤ 3）`, Math.hypot(g.bulb.cx - hc.x, g.bulb.cy - hc.y) <= 3,
    `记号 ${g.bulb.cx.toFixed(1)},${g.bulb.cy.toFixed(1)} · 盒子 ${hc.x.toFixed(1)},${hc.y.toFixed(1)}`);
  const outer = g.vertical ? ['bl', 'br'] : ['tr', 'br'];
  check(`⑪ ${tag}：灯泡按下时外侧两角的圆角和暂停那颗一样`, outer.every((k) => g.hintPressedR[k] === g.stopR[k] && g.stopR[k] !== '0px'),
    `灯泡 ${outer.map((k) => g.hintPressedR[k]).join(' ')} · 暂停 ${outer.map((k) => g.stopR[k]).join(' ')}`);
  if (desk) check(`⑫ ${tag}：灯泡和暂停的 --ctl-disc 一样（都不画圆盘）`, g.hintDisc === g.stopDisc, `灯泡 ${g.hintDisc} · 暂停 ${g.stopDisc}`);
  await ctx.close();
}
for (const vp of [[1440, 900], [1000, 700]]) {
  const { ctx, p } = await device(vp, {});
  await tap(p, 'circle');
  await p.waitForFunction(() => !document.querySelector('#startOverlay.show') && document.querySelectorAll('.tile, .ball, .tri').length > 0, null, { timeout: 40000 });
  await p.waitForTimeout(200);
  const m = await p.evaluate(() => {
    const s = document.querySelector('#stopBtn').getBoundingClientRect();
    const h = document.querySelector('#hintBtn');
    const hr = h.getBoundingClientRect();
    return { coach: !!document.querySelector('.app--game.has-coach'), shown: !h.hidden, sl: s.left, sw: s.width, hl: hr.left };
  });
  const want = m.sl + m.sw - Math.round(0.42 * m.sw);
  check(`⑬ 电脑 ${vp[0]}×${vp[1]} 头一局（has-coach）开打 200ms：灯泡叠在暂停那块的右 42%（±1）`, m.coach && m.shown && Math.abs(m.hl - want) <= 1,
    `has-coach ${m.coach} · 灯泡 left ${m.hl.toFixed(1)} · 要 ${want.toFixed(1)}`);
  await ctx.close();
}

check('8 一路零脚本报错', errs.length === 0, errs.slice(0, 3).join(' | '));
await browser.close();
console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

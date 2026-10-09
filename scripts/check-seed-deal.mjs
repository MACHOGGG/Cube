/**
 * 同一串种子码，每副棋盘发出同一副牌（第 19 推）。
 *
 *   node scripts/dev-server.mjs 8973 dist &
 *   node scripts/check-seed-deal.mjs http://localhost:8973/
 *
 * 方案的门：「同一种子每副棋盘同一副牌」「倒数期间页面上没有玩法和棋盘标识」。顺带量两件只有
 * 真开一局才看得见的事：那一局的存档里记着这串码（分享卡照它印「代号 XXXX-XXXX」），以及七色
 * 圆球那一天竖着拿手机时先说「请横屏」。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 怎么量
 *
 * 走玩家那条路：主菜单那张《每日挑战》→ 种子输入框敲一串码 → 4-3-2-1 → 棋盘。编号表二十行，
 * 每一行造一串码（api/_seedcode.js 的 encodeSeed——服务器那一份，和客户端一行对一行，
 * check-seed-code 钉着），开两次，把盘面读出来比：
 *
 *   · 盘面＝每一枚棋子的「行,列 / 面 / 颜色 / 有没有炸弹」，按行列排好（bot-selfcheck 那一把尺
 *     子：颜色往里找一层，三角的颜色画在里面那一层）。老虎机那一局再加上 HUD 里那个得分图案。
 *   · **尺子**：同一行换一串码，盘面必须不一样——不然「两次一样」可能只是「怎么开都一样」（比如
 *     读到的是一块空棋盘，或者种子根本没用上）。
 *   · 开出来的棋盘就是那一行说的那副（data-shape），玩法也对（计时那几行头上有钟、步步为营头
 *     上是余步……这儿只量最便宜的那一样：棋盘 id）。
 *
 * 倒数那几秒：页面上除了那串码和数字，一个字都没有（innerText 去掉码、数字、空白之后是空的），
 * 也没有任何玩法图、棋盘（.start-mark / #boardWrap / .app--game 都不在）。
 *
 * 天才锁：门里种一份「兑过长期内部码」的权益（和 check-board-fit 同一个写法，见那儿的说明），
 * 二十行都开得了——锁本身另有门守着，这儿量的是发牌。
 */
import { chromium } from 'playwright';
import * as SC from '../api/_seedcode.js';

const BASE = process.argv[2] || 'http://localhost:8973/';
const ONLY = process.env.ONLY_VARIANTS ? process.env.ONLY_VARIANTS.split(',').map(Number) : null;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const errs = [];

/** 一个新的浏览器上下文：中文、教学看过、玩过一局（主菜单不锁）、有天才。 */
async function freshContext(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, ...opts });
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem('seed_gate') === '1') return;
    sessionStorage.setItem('seed_gate', '1');
    localStorage.clear();
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_intro_seen', '1');
    localStorage.setItem('slides_played_square', '1');
    localStorage.setItem('slides_played_circle', '1');
    // 打完过一局：10-08 方案 3-D-1 起《每日挑战》只给打完过一局的人摆。
    localStorage.setItem('slides_played_finished', '1');
    // 头一回进每个玩法时棋盘底下那句教学：先记成「进过了」，免得它占着盘面底下那一块。
    for (const k of ['bomb', 'slot', 'flip', 'puzzle', 'timed', 'layout']) localStorage.setItem(`slides_played_${k}`, '1');
    localStorage.setItem(
      'slides_genius',
      JSON.stringify({ active: true, channel: 'code', until: Date.now() + 365 * 24 * 60 * 60 * 1000 }),
    );
  });
  return ctx;
}

/** 盘面此刻的样子（bot-selfcheck 那一把尺子的精简版）。 */
const snapBoard = (page) =>
  page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.display = 'none';
    document.body.appendChild(probe);
    const canon = (raw) => {
      if (!raw) return '';
      probe.style.color = '';
      probe.style.color = raw;
      return getComputedStyle(probe).color || raw;
    };
    const CLEAR = (c) => !c || c === 'transparent' || /rgba\(0, 0, 0, 0\)/.test(c);
    const colorOf = (el) => {
      if (el.dataset.face === 'dot') {
        return canon(el.dataset.dotColor || el.querySelector('svg [stroke]')?.getAttribute('stroke') || el.querySelector('svg')?.getAttribute('stroke') || '');
      }
      const own = getComputedStyle(el).backgroundColor;
      if (!CLEAR(own)) return canon(own);
      for (const kid of el.querySelectorAll('*')) {
        const bg = getComputedStyle(kid).backgroundColor;
        if (!CLEAR(bg)) return canon(bg);
        const f = kid.getAttribute && kid.getAttribute('fill');
        if (f && f !== 'none' && !CLEAR(f)) return canon(f);
      }
      return '';
    };
    const pieces = [...document.querySelectorAll('#boardWrap [data-r][data-c]')].map((e) => ({
      at: `${e.dataset.r},${e.dataset.c}`,
      face: e.dataset.face || '',
      color: colorOf(e),
      bomb: Boolean(e.querySelector('.hazard-mark')),
    }));
    pieces.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    probe.remove();
    const pat = document.querySelector('.hud-block--pattern .pat-icon > svg');
    return {
      shape: document.querySelector('.app--game')?.getAttribute('data-shape') ?? '',
      pieces,
      key: pieces.map((p) => `${p.at}:${p.face}:${p.color}:${p.bomb ? 'B' : ''}`).join('|'),
      // 老虎机那一局：HUD 右边那个得分图案（换一个目标，这一串就不一样）。
      target: pat ? pat.outerHTML.replace(/\s(id|class)="[^"]*"/g, '').length + ':' + pat.querySelectorAll('*').length : '',
    };
  });

/**
 * 在每日挑战那一页敲一串码、数完、开局，把盘面读出来。
 * `watchCount`：数的那几秒里顺手量「页面上没有玩法和棋盘标识」。
 */
async function dealOf(code, watchCount = false) {
  const ctx = await freshContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn--daily', { timeout: 20000 });
  await page.waitForTimeout(300);
  await page.click('.home-icon-btn--daily');
  await page.waitForSelector('#seedInput', { timeout: 8000 });
  await page.fill('#seedInput', code.slice(0, 4) + '-' + code.slice(4));
  await page.click('#seedGo');
  let during = null;
  if (watchCount) {
    await page.waitForSelector('.daily-page--count', { timeout: 5000 });
    await page.waitForTimeout(1200);
    during = await page.evaluate((c) => {
      const formatted = c.slice(0, 4) + '-' + c.slice(4);
      const text = document.body.innerText.replace(formatted, '').replace(/[\d\s]/g, '');
      return {
        text,
        code: document.querySelector('.daily-seed-code')?.textContent?.trim() ?? '',
        // 玩法图：startStage 那一格里装的不是今日那一格（#dailyEmblem）的，就是玩法图。10-08 方案 3-F-1
        // 起今日挑战的倒数页套的是 startStage 那一整套，今天那张图 / 那串码也住在一个 .start-mark 里，
        // 所以不能再按「有没有 .start-mark」认。
        marks: [...document.querySelectorAll('.start-mark')].filter((m) => !m.querySelector('#dailyEmblem')).length,
        board: document.querySelectorAll('#boardWrap, .app--game').length,
        digit: !!document.querySelector('#dailyCount .cd-digit'),
      };
    }, code);
  }
  const ok = await page
    .waitForFunction(() => document.querySelectorAll('#boardWrap [data-r][data-c]').length > 0, { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  // 发牌的那段动画（一枚一枚落下来）走完再读。
  await page.waitForTimeout(1600);
  const snap = ok ? await snapBoard(page) : null;
  // 存档里记着这一串码吗？结束这一局：暂停 → 结束游戏，存档在结算那一刻写。
  let run = null;
  if (ok) {
    await page.evaluate(() => document.querySelector('#stopBtn, #pauseBtn, .ctl-pause')?.click());
    await page.waitForTimeout(400);
    await page.evaluate(() => document.querySelector('#pauseFinishBtn')?.click());
    await page.waitForTimeout(1500);
    run = await page.evaluate(() => {
      let latest = null;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !/::runs$/.test(k)) continue;
        try {
          for (const r of JSON.parse(localStorage.getItem(k) || '[]')) {
            if (!latest || r.at > latest.at) latest = r;
          }
        } catch {
          /* 不是这一类键 */
        }
      }
      return latest ? { seed: latest.data?.seed, source: latest.data?.seedSource, daily: latest.data?.daily, shape: latest.data?.shapeId } : null;
    });
  }
  await ctx.close();
  return { snap, during, run };
}

const variants = SC.VARIANTS.map((v, i) => ({ ...v, i })).filter((v) => !ONLY || ONLY.includes(v.i));
check('（尺子）编号表二十行都在', SC.VARIANTS.length === 20, String(SC.VARIANTS.length));

for (const v of variants) {
  const codeA = SC.encodeSeed(SC.DEAL_VERSION, v.i, 1000 + v.i * 7919);
  const codeB = SC.encodeSeed(SC.DEAL_VERSION, v.i, 5000000 + v.i * 104729);
  const first = await dealOf(codeA, v.i === 0 || v.i === 14);
  const again = await dealOf(codeA);
  const other = await dealOf(codeB);
  const label = `第 ${String(v.i).padStart(2)} 行 ${v.mode}/${v.board}`;
  check(`${label}：开得出来（${codeA}）`, !!first.snap && first.snap.pieces.length > 0, first.snap ? `${first.snap.pieces.length} 枚` : '没有棋盘');
  if (!first.snap) continue;
  check(`${label}：开出来的就是这副棋盘`, first.snap.shape === v.board, first.snap.shape);
  check(
    `${label}：同一串码开两次，同一副牌`,
    !!again.snap && first.snap.key === again.snap.key && first.snap.target === again.snap.target,
    again.snap ? `${first.snap.pieces.length} 枚` : '第二次没开出来',
  );
  check(
    `${label}：（尺子）换一串码，牌就不一样`,
    !!other.snap && (other.snap.key !== first.snap.key || other.snap.target !== first.snap.target),
    other.snap ? codeB : '换的那一串没开出来',
  );
  check(
    `${label}：那一局的存档记着这串码（source entered）`,
    !!first.run && first.run.seed === codeA && first.run.source === 'entered' && !first.run.daily,
    JSON.stringify(first.run),
  );
  if (first.during) {
    const d = first.during;
    check(`${label}：倒数那几秒，上半屏是那串码`, d.code === codeA.slice(0, 4) + '-' + codeA.slice(4), d.code);
    check(`${label}：倒数那几秒，页面上没有一个别的字（玩法名、棋盘名都没有）`, d.text === '', JSON.stringify(d.text));
    check(`${label}：倒数那几秒，没有玩法图、没有棋盘`, d.marks === 0 && d.board === 0 && d.digit, JSON.stringify(d));
  }
}

// ── 七色圆球那一天，竖着拿手机：先「请横屏」，转过来才数 ──────────────────
if (!ONLY || ONLY.includes(4)) {
  const code = SC.encodeSeed(SC.DEAL_VERSION, 4, 424242);
  const ctx = await freshContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn--daily', { timeout: 20000 });
  await page.waitForTimeout(600);
  await page.click('.home-icon-btn--daily');
  await page.waitForSelector('#seedInput', { timeout: 8000 });
  await page.fill('#seedInput', code);
  await page.click('#seedGo');
  await page.waitForTimeout(1500);
  const portrait = await page.evaluate(() => ({
    turn: (() => {
      const t = document.querySelector('#dailyTurn');
      return t && !t.hidden && t.getBoundingClientRect().height > 0 ? t.textContent.trim() : '';
    })(),
    count: !document.querySelector('#dailyCount')?.hidden,
    digits: document.querySelectorAll('#dailyCount .cd-digit').length,
    emblem: !document.querySelector('#dailyEmblem')?.hidden,
    board: document.querySelectorAll('#boardWrap, .app--game').length,
    text: document.body.innerText.replace(/\s/g, ''),
  }));
  check('七色圆球、竖着拿手机：只摆一句「请横屏」', portrait.turn === '请横屏' && portrait.text === '请横屏', JSON.stringify(portrait));
  check('七色圆球、竖着拿手机：不数、不摆别的（码也不摆）、不开局', !portrait.count && portrait.digits === 0 && !portrait.emblem && portrait.board === 0, JSON.stringify(portrait));
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(1300);
  const turned = await page.evaluate(() => ({
    turnGone: !!document.querySelector('#dailyTurn')?.hidden,
    digits: document.querySelectorAll('#dailyCount .cd-digit').length,
  }));
  check('转过来之后那一句撤掉、开始数', turned.turnGone && turned.digits > 0, JSON.stringify(turned));
  const opened = await page
    .waitForFunction(() => document.querySelector('.app--game')?.getAttribute('data-shape') === 'circleSeven', { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  check('数完开的是七色圆球', opened);
  await ctx.close();
}

// ── 输码那一格：叫「代号」，底下说一句「手动输入代号开的局不计入排行榜（今日挑战照常计入）」──────────
// （10-08 方案 3-B；那一句 10-09 补充方案 7-10 改长了：原先「代号局不计入排行榜」，读的人会以为今日挑战也不算）
// 服务器真的不让敲代号开的那一局上榜（api/scores.js 的 ranked，check-scores 量那一半），这一
// 句是事先说出来的那一半：不让人打完一局好的才发现没上榜。手机竖屏量：那一行得整个在屏幕里、
// 不和报错那一行叠。
{
  const ctx = await freshContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn--daily', { timeout: 20000 });
  await page.waitForTimeout(600);
  await page.click('.home-icon-btn--daily');
  await page.waitForSelector('#seedInput', { timeout: 8000 });
  const ui = await page.evaluate(() => {
    const note = document.getElementById('seedNote');
    const box = (el) => {
      const r = el?.getBoundingClientRect();
      return r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) } : null;
    };
    return {
      label: document.querySelector('.seed-label')?.textContent?.trim() ?? '',
      note: note?.textContent?.trim() ?? '',
      noteBox: box(note),
      msgBox: box(document.getElementById('seedMsg')),
      vw: innerWidth,
      vh: innerHeight,
    };
  });
  check('输码那一格叫「代号」（不再叫「种子」）', ui.label === '代号', ui.label);
  check('底下那一行说「手动输入代号开的局不计入排行榜（今日挑战照常计入）」',
    ui.note === '手动输入代号开的局不计入排行榜（今日挑战照常计入）', ui.note);
  const nb = ui.noteBox;
  check('那一行整个在屏幕里、在报错那一行底下（不叠）',
    !!nb && nb.top >= 0 && nb.bottom <= ui.vh && nb.left >= 0 && nb.right <= ui.vw && !!ui.msgBox && nb.top >= ui.msgBox.bottom,
    JSON.stringify({ note: nb, msg: ui.msgBox }));
  await ctx.close();
}

// ── 今日挑战那颗键：开的是今天那一串、存档记成 daily ───────────────────────
{
  const ctx = await freshContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  // 网页端「今天」用服务器的钟（engine/dailyClock.ts）：dev-server 的 Date 头就是本机的钟，所
  // 以门里照本机的钟算今天，两头一样。
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn--daily', { timeout: 20000 });
  const today = SC.dayIndexOf(Date.now());
  const want = SC.VARIANTS[SC.dailyVariant(today)];
  await page.click('.home-icon-btn--daily');
  await page.waitForSelector('#dailyPlay', { timeout: 8000 });
  await page.click('#dailyPlay');
  await page.waitForTimeout(1200);
  const during = await page.evaluate(() => ({
    art: !!document.querySelector('#dailyEmblem svg[data-daily-weekday]'),
    text: document.body.innerText.replace(/[\d\s]/g, ''),
    // 玩法图那一格：同上，装着今日那一格的那个 .start-mark 不算。
    board: document.querySelectorAll('#boardWrap, .app--game').length +
      [...document.querySelectorAll('.start-mark')].filter((m) => !m.querySelector('#dailyEmblem')).length,
  }));
  check('今日挑战倒数那几秒：上半屏是今天那张图，页面上没有别的字、没有玩法和棋盘', during.art && during.text === '' && during.board === 0, JSON.stringify(during));
  const shape = await page
    .waitForFunction(() => document.querySelector('.app--game')?.getAttribute('data-shape') || '', { timeout: 15000 })
    .then((h) => h.jsonValue())
    .catch(() => '');
  check(`今日挑战开的是今天那一副（${want.mode}/${want.board}）`, shape === want.board, String(shape));
  await page.waitForTimeout(1600);
  await page.evaluate(() => document.querySelector('#stopBtn, #pauseBtn, .ctl-pause')?.click());
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('#pauseFinishBtn')?.click());
  await page.waitForTimeout(1500);
  const run = await page.evaluate(() => {
    let latest = null;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !/::runs$/.test(k)) continue;
      try {
        for (const r of JSON.parse(localStorage.getItem(k) || '[]')) if (!latest || r.at > latest.at) latest = r;
      } catch {
        /* 不是这一类键 */
      }
    }
    return latest ? { seed: latest.data?.seed, source: latest.data?.seedSource, daily: latest.data?.daily } : null;
  });
  check(
    '今日挑战那一局的存档：今天那串码、source daily、daily 是今天的日期键',
    !!run && run.seed === SC.dailySeed(today) && run.source === 'daily' && run.daily === SC.dayKey(today),
    JSON.stringify(run),
  );
  await ctx.close();
}

check('全程零报错', errs.length === 0, errs.slice(0, 3).join(' | '));
await browser.close();
console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

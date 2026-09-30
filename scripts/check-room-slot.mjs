/**
 * 小屋里的随机得分目标：《相同》全屋同一个图案，《不同》各转各的，棋盘都一样。
 *
 *   node scripts/dev-server.mjs 8817 dist
 *   node scripts/check-room-slot.mjs http://localhost:8817/
 *
 * 两台浏览器进同一间小屋。屋主去挑玩法那一屏点《随机得分目标》——这时那一
 * 屏上多一个《相同 / 不同》开关。相同：两台设备认的那个图案要一模一样（它是
 * 从小屋那个种子里抽的）；不同：两台各抽各的，可棋盘仍然要一模一样（棋盘照
 * 旧从种子发，抽图案不碰那条流）。
 *
 * **量的是 HUD 右边那一块《得分图案》，不是棋盘上方那条图示带。**《侵蚀阶梯》v1.2
 * PR-7 把那条带子退役了，这道门原先读的那个选择器从那天起一直是空的，「两边认的
 * 是同两个图案」于是变成「空数组等于空数组」——一条**假绿**，PR-8 一起修。
 *
 * 另外两条也跟着 PR-8 变了：一局只认**一个**目标（不是一对），而「每台设备认的正
 * 是它自己那台机器上停下来的那一个」才是这条线真正的要害——'own' 那一档全靠它
 * （各转各的，转出来的那一个必须跟着走到自己的棋盘上去）。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8817/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

async function newPlayer(label) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.addInitScript(() => {
    for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
      localStorage.setItem(k, '1');
    localStorage.setItem('slides_lang', 'zhHans');
  });
  await ctx.addInitScript(installProbe);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  [${label} page error] ${e.message}`));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#navProfile', { timeout: 20000 });
  return { ctx, page };
}
/**
 * 页面里那把尺子：一张图案 svg 的形状指纹（和 check-random-target.mjs 是同一把）。
 *
 * 比的是形状，不是 aria-label 也不是尺寸——滚筒里那一张和 HUD 那一块里那一张是同
 * 一个图案的两份画法（外框 extent 不一样，见 engine/targetIcon.ts）。
 */
const installProbe = () => {
  const fp = (svg) => {
    if (!svg) return null;
    const marks = [...svg.children].filter((e) => e.tagName !== 'defs');
    if (!marks.length) return null;
    const boxes = marks.map((m) => m.getBoundingClientRect());
    const cx = boxes.map((b) => b.left + b.width / 2);
    const cy = boxes.map((b) => b.top + b.height / 2);
    const minX = Math.min(...cx);
    const minY = Math.min(...cy);
    const scale = Math.max(Math.max(...cx) - minX, Math.max(...cy) - minY) || 1;
    return {
      n: marks.length,
      pts: marks
        .map((_, i) => [
          Math.round(((cx[i] - minX) / scale) * 100),
          Math.round(((cy[i] - minY) / scale) * 100),
        ])
        .sort((a, b) => a[1] - b[1] || a[0] - b[0]),
    };
  };
  window.__probe = {
    hud() {
      const f = fp(document.querySelector('.hud-block--pattern .pat-icon > svg'));
      return f && { ...f, target: Boolean(document.querySelector('.hud-block--pattern.pat-block--target')) };
    },
    reel(i) {
      const r = document.querySelectorAll('.slot-reel')[i];
      if (!r) return null;
      const strip = r.querySelector('.slot-strip');
      const cell = r.getBoundingClientRect().height || 1;
      const y = Math.abs(parseFloat((strip.style.transform.match(/-?[\d.]+/) || [0])[0])) || 0;
      return fp(strip.children[Math.round(y / cell)]?.querySelector('svg'));
    },
  };
};
/** 两个指纹是不是同一个形状（每个图形的位置差在 ±3% 以内）。 */
const SAME = (a, b) =>
  Boolean(a && b) && a.n === b.n && a.pts.every((p, i) => Math.abs(p[0] - b.pts[i][0]) <= 3 && Math.abs(p[1] - b.pts[i][1]) <= 3);
const FMT = (f) => (f ? `${f.n} 枚 ${f.pts.map((p) => p.join(':')).join(' ')}` : '（空）');
const boardSignature = (page) =>
  page.$$eval('#boardWrap *', (els) =>
    els.map((e) => e.style.backgroundColor || e.getAttribute('fill') || '').filter(Boolean).join(','));

const A = await newPlayer('host');
const B = await newPlayer('guest');
const granted = await A.page.evaluate(async () => {
  const r = await fetch('/api/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'TESTMONTH' }) }).then((x) => x.json());
  if (!r.active) return r;
  localStorage.setItem('slides_genius', JSON.stringify({ active: true, period: r.period, until: r.until,
    channel: 'code', email: r.email, token: r.token, code: r.code }));
  return r;
});
check('屋主用内部码开通天才', granted.active === true);
await A.page.reload({ waitUntil: 'load' });
await A.page.waitForSelector('#navProfile');
await A.page.click('#navProfile'); await A.page.click('#multiRow');
await A.page.waitForSelector('#mpCreate', { timeout: 10000 });
await A.page.fill('#mpName', '甲'); await A.page.click('#mpCreate');
await A.page.waitForSelector('.mp-code', { timeout: 10000 });
const code = await A.page.$eval('.mp-code', (e) => e.textContent.trim());
await B.page.click('#navProfile'); await B.page.click('#multiRow');
await B.page.waitForSelector('#mpCode', { timeout: 10000 });
// 四位打满自动进屋，没有《加入》那颗键了（玩家 2026-09 的设计稿；见 ui/multiplayer.ts
// 的 joinNow）。所以上面那句 fill 本身就是「进屋」——这儿不再有一次点击。
await B.page.fill('#mpName', '乙'); await B.page.fill('#mpCode', code);
await B.page.waitForSelector('.mp-code', { timeout: 10000 });
await A.page.waitForFunction(() => document.querySelectorAll('.mp-player').length === 2, { timeout: 8000 });

/** 屋主走一趟：为大家挑 → 个人主页 → 随机得分目标 → 拨开关 → 点方块。 */
async function hostPicks(slot) {
  await A.page.click('#mpPick');
  await A.page.waitForSelector('#roomPickBar', { timeout: 8000 });
  await A.page.click('#navProfile');
  await A.page.waitForSelector('#randomRow', { timeout: 8000 });
  await A.page.click('#randomRow');
  await A.page.waitForSelector('.slot-intro-page', { timeout: 8000 });
  // 介绍页（三台机器）右下角那颗《开始 〉》才通向挑图形那一屏。
  await A.page.click('#slotGo');
  await A.page.waitForSelector('.slot-pick-row', { timeout: 8000 });
  const sw = await A.page.evaluate(() => ({
    seg: Boolean(document.querySelector('.slot-share')),
    on: document.querySelector('.slot-share-opt--on')?.dataset.slot,
    banner: Boolean(document.getElementById('roomPickBar')),
  }));
  check(`屋主替整屋挑时那一屏有《相同 / 不同》开关（默认相同）`, sw.seg && sw.on === 'same', JSON.stringify(sw));
  if (slot === 'own') await A.page.click('.slot-share-opt[data-slot="own"]');
  await A.page.click('.slot-pick-opt[data-family="square"]');
}
/**
 * 倒数那一屏上到底有没有那台机器，而且在转。
 *
 * 玩家报的：「老虎机模式在多人模式下，没有老虎机的动画直接就进来游戏了」。
 * 单人那边滚筒是在游戏自己的开局页上转的，而小屋这边根本不走那张页——倒数
 * 在小屋页上数，数完直接摆棋盘。所以要在倒数这几秒里抓一把。
 */
async function reelsShowing(P) {
  return P.page
    .waitForFunction(() => document.querySelectorAll('.slot-machine').length > 0, { timeout: 12000 })
    .then(() => true)
    .catch(() => false);
}
/** 倒数那一屏上，这台设备的轮子停在哪一张（停稳了才问）。 */
async function reelFace(P) {
  await P.page
    .waitForFunction(() => document.querySelectorAll('.slot-reel--set').length >= 1, { timeout: 12000 })
    .catch(() => {});
  return P.page.evaluate(() => window.__probe.reel(0));
}
async function bothBoards() {
  for (const P of [A, B]) {
    await P.page.waitForFunction(() => document.querySelectorAll('#boardWrap .tile').length > 0, { timeout: 40000 });
  }
  await A.page.waitForTimeout(800);
  return {
    la: await A.page.evaluate(() => window.__probe.hud()),
    lb: await B.page.evaluate(() => window.__probe.hud()),
    sa: await boardSignature(A.page), sb: await boardSignature(B.page),
  };
}
async function finishBoth() {
  for (const P of [A, B]) {
    await P.page.click('#finishBtn');
    const yes = await P.page.waitForSelector('#mpFinishYes', { timeout: 5000 }).catch(() => null);
    if (yes) await yes.click();
  }
  await A.page.waitForSelector('#mpPick', { timeout: 20000 });
}

// ---- 第一局：相同 ---------------------------------------------------------
await hostPicks('same');
const reelA = await reelsShowing(A);
const reelB = await reelsShowing(B);
check('倒数那一屏上摆着那台老虎机（屋主）', reelA);
check('倒数那一屏上摆着那台老虎机（客人）', reelB);
const spun1A = await reelFace(A);
const spun1B = await reelFace(B);
check('相同：两台机器停在同一张上', SAME(spun1A, spun1B), `甲 ${FMT(spun1A)} · 乙 ${FMT(spun1B)}`);
const r1 = await bothBoards();
// 尺子：这一块得真的画出了东西，而且挂着只有老虎机局才有的那个身份类——不然下面
// 「两边一样」只是「空等于空」（这道门从 PR-7 起就是这么绿着的）。
check('相同：两边 HUD 那一块都画着一个目标（尺子）',
  Boolean(r1.la?.target) && Boolean(r1.lb?.target) && r1.la.n >= 1,
  `甲 ${FMT(r1.la)}${r1.la?.target ? '' : '（没挂身份类）'} · 乙 ${FMT(r1.lb)}${r1.lb?.target ? '' : '（没挂身份类）'}`);
check('相同：两边认的是同一个图案', SAME(r1.la, r1.lb), `甲 ${FMT(r1.la)} · 乙 ${FMT(r1.lb)}`);
check('相同：认的正是自己那台机器上停下来的那一个',
  SAME(r1.la, spun1A) && SAME(r1.lb, spun1B), `甲 ${FMT(spun1A)} · 乙 ${FMT(spun1B)}`);
check('相同：两边棋盘一模一样', r1.sa.length > 0 && r1.sa === r1.sb);
await finishBoth();

// ---- 第二局：不同 ---------------------------------------------------------
await hostPicks('own');
const spun2A = await reelFace(A);
const spun2B = await reelFace(B);
const r2 = await bothBoards();
check('不同：两边 HUD 那一块都画着一个目标',
  Boolean(r2.la?.target) && Boolean(r2.lb?.target), `甲 ${FMT(r2.la)} · 乙 ${FMT(r2.lb)}`);
// 这一档的要害：各转各的，**转出来的那一个必须跟着走到自己的棋盘上去**。少了这一
// 步，棋盘那边会用本机的 Math.random 再抽一次——玩家眼睁睁看着轮子停在 A，进去要
// 凑的却是 B。
check('不同：每台设备认的正是它自己那台机器上停下来的那一个',
  SAME(r2.la, spun2A) && SAME(r2.lb, spun2B),
  `甲 HUD ${FMT(r2.la)} / 轮子 ${FMT(spun2A)} · 乙 HUD ${FMT(r2.lb)} / 轮子 ${FMT(spun2B)}`);
// 「两边抽到的不一样」这一条**不写死**：各自等概率从一族里抽（方块 8 个、小球 7
// 个），撞上同一个的概率是八分之一左右。写死一条「必须不同」，这道门就会看抽签结
// 果偶发红——而偶发红最后一定会被人加 continue-on-error。上面那条「各认自己那台
// 机器的」才是这一档真正要守的东西，它和抽签结果无关。
check(
  SAME(r2.la, r2.lb)
    ? '不同：这一回两边正好抽到了同一个（八分之一），「各不相同」这一条无从判断（不假装查过）'
    : '不同：两边抽到的确实不是同一个',
  true, `甲 ${FMT(r2.la)} · 乙 ${FMT(r2.lb)}`);
check('不同：棋盘仍然一模一样（抽图案不碰发牌的那条随机流）', r2.sa.length > 0 && r2.sa === r2.sb);
check('第二局的棋盘和第一局不是同一副', r2.sa !== r1.sa);

await browser.close();
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项没过`);
process.exit(fail ? 1 : 0);

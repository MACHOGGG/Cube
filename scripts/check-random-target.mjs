/**
 * 《随机得分目标》：挑图形 → 老虎机在开局页上转 → 5-4-3-2-1 → 开局，认的
 * 就是轮子上停下来的那一个。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8817 dist
 *   node scripts/check-random-target.mjs http://localhost:8817/
 *
 * 这条线最容易出的毛病是「转是转了，盘上还是老一套」——转盘那一幕看着完全
 * 正常，进了局才发现认的还是这个玩法自己那条 1×N。所以这里量两件事：轮子停
 * 下来的那一张，和开局之后 HUD 右边那一块《得分图案》里画的——它们必须是同
 * 一个；而且要和「直接从主菜单开同一个玩法」的那一块不一样，一样就是根本没
 * 接上。
 *
 * **量的是 HUD 那一块，不是棋盘上方那条图示带。**《侵蚀阶梯》v1.2 PR-7 把那条带
 * 子退役了（现在两块 HUD：左《拼出得分》、右《得分图案》），这道门那两条从那天
 * 起一直读着一个不存在的选择器、拿空数组去比空数组——两条**假绿**。PR-8 把它们
 * 改成读 HUD 那一块，并且立了一条尺子：那一块里必须真的画出了东西。
 *
 * 另外看住没开通的那一份：页面照样打得开、图形照样画出来，只是按下去开的是
 * 订阅那扇窗，不是一局游戏——这是玩家自己定的规矩（做好了的东西谁都点得进
 * 来看）。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8817/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const seed = (genius) => {
  for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
    localStorage.setItem(k, '1');
  localStorage.setItem('slides_lang', 'zhHans');
  if (genius) {
    localStorage.setItem('slides_genius', JSON.stringify({
      active: true, channel: 'code', until: Date.now() + 30 * 864e5, code: 'SLOTCHK',
    }));
  }
};

/**
 * 页面里那把尺子：一张图案 svg 的**形状指纹**——几个图形，以及它们彼此的相对位置。
 *
 * 不读 aria-label、不读 svg 的尺寸：滚筒里那一张和 HUD 那一块里那一张是同一个图案
 * 的两份画法（同一套 cellsOf 换算，只是外框 extent 不一样，见
 * engine/targetIcon.ts），所以能比的只有「形状」本身——把各个图形的中心按它们自己
 * 那一圈的包围盒归一化（长边为 1，两轴同一个尺度，不然比例会被拉歪）。
 *
 * 这把尺子于是既认得出「两边是同一个图案」，也认得出「这不是 1×N」——1×N 的 N 个
 * 图形全在一条水平线上，y 一律是 0。
 *
 * 装成 addInitScript：page.evaluate 传进去的函数是**序列化**过去的，引用不到这个文
 * 件里的任何东西，所以尺子本身必须活在页面里。
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
      tag: marks[0].tagName,
      pts: marks
        .map((_, i) => [
          Math.round(((cx[i] - minX) / scale) * 100),
          Math.round(((cy[i] - minY) / scale) * 100),
        ])
        .sort((p, q) => p[1] - q[1] || p[0] - q[0]),
    };
  };
  window.__probe = {
    /** HUD 右边那一块《得分图案》里此刻画的是什么。 */
    hud() {
      const f = fp(document.querySelector('.hud-block--pattern .pat-icon > svg'));
      // 老虎机那一局给这一块挂了身份类（patternBlock 的 pat-block--target）。
      return f && { ...f, target: Boolean(document.querySelector('.hud-block--pattern.pat-block--target')) };
    },
    /** 第 i 个滚筒此刻正对着窗口的那一张图案，取同一把指纹。 */
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

const FMT = (fp) => (fp ? `${fp.n} 个 ${fp.tag} ${fp.pts.map((p) => p.join(':')).join(' ')}` : '（空）');

/** 两个轮子当前正对着窗口的那一张（transform 走了几格就是第几张）。 */
const REELS = () =>
  [...document.querySelectorAll('.slot-reel')].map((r) => {
    const strip = r.querySelector('.slot-strip');
    const cell = r.getBoundingClientRect().height || 1;
    const y = Math.abs(parseFloat((strip.style.transform.match(/-?[\d.]+/) || [0])[0])) || 0;
    const k = Math.round(y / cell);
    const cellEl = strip.children[k];
    return {
      set: r.classList.contains('slot-reel--set'),
      label: cellEl?.querySelector('[aria-label]')?.getAttribute('aria-label') || '',
    };
  });

/** 个人主页 → 《老虎机模式》那一行 → 介绍页（一族一台，转着的机器）。 */
async function openIntro(page) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#navProfile', { timeout: 20000 });
  await page.click('#navProfile');
  await page.waitForSelector('#randomRow', { timeout: 10000 });
  await page.click('#randomRow');
  await page.waitForSelector('.slot-intro-page', { timeout: 8000 });
  await page.waitForTimeout(300);
}

// ---- 没开通：看得见，但开不了局 ------------------------------------------
//
// 介绍页：一族一台机器，上下排着、都在转，底下一颗红色 STOP；按下去从上到下一
// 台一台停稳，键变成绿色的《开始》，再按又转起来。没开通的人没有右下角那颗
// 《开始 〉》——看得见这一幕，开不了局。
//
// **台数不写死。** 这儿原先写的是「三台机器、六个轮子」，2026-09 删掉三角那副基础
// 棋盘之后（《侵蚀阶梯》v1.2 PR-6）就只剩两台，这道门从那天起一直红着，而红的不是
// 它守的那件事。现在按「页面上有几台」往下量，另加一条下限（至少两台）挡住「一台
// 都没渲染出来也算过」。每台几个轮子同理从页面上取。
//
// （这儿曾经留过一句「PR-8 要把两个滚筒收成一个」——猜错了。PR-8 把一局两个得分
// 图案收成一个，窗口还是两个：那张图的显示区本来就被一道黑弧分成两格，收成一个
// 就得铺白把弧盖掉；而「从左到右先停一个再停第二个」是玩家点名要的。两格停同一
// 张，见 src/ui/slotReels.ts 顶上那段。）
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(seed, false);
  await ctx.addInitScript(installProbe);
  const page = await ctx.newPage();
  await openIntro(page);
  const m = await page.evaluate(() => ({
    machines: document.querySelectorAll('.slot-intro-item .slot-machine').length,
    reels: document.querySelectorAll('.slot-intro-item .slot-reel').length,
    spinning: [...document.querySelectorAll('.slot-intro-item .slot-strip')].every((s) => s.children.length > 0),
    set: document.querySelectorAll('.slot-intro-item .slot-reel--set').length,
    btn: document.getElementById('slotDemoBtn')?.textContent.trim(),
    red: Boolean(document.getElementById('slotDemoBtn')?.classList.contains('slot-demo-btn--stop')),
    go: Boolean(document.getElementById('slotGo')),
    icons: document.querySelectorAll('.slot-pick-opt').length,
    nav: getComputedStyle(document.querySelector('.home-nav')).display,
    // 每台一样宽、上下等距、左右居中。
    boxes: [...document.querySelectorAll('.slot-intro-item')].map((e) => {
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), w: Math.round(r.width), t: Math.round(r.top), b: Math.round(r.bottom) };
    }),
    mid: Math.round(document.documentElement.clientWidth / 2),
  }));
  const N = m.machines;
  const PER = N ? m.reels / N : 0;
  check('没开通：至少两台机器，每台的轮子数一样', N >= 2 && Number.isInteger(PER) && PER >= 1,
    `${N} 台 · ${m.reels} 个轮子 · 每台 ${PER}`);
  check('没开通：进来就都在转', m.spinning && m.set === 0, `停稳 ${m.set} 个`);
  check('没开通：每台一样宽、左右居中',
    m.boxes.length === N && m.boxes.every((b) => b.w === m.boxes[0].w && Math.abs(b.x - m.mid) <= 1),
    JSON.stringify(m.boxes));
  // 上下等距：两台只有一个间隔，没什么可比的，这一条要三台起才有意义——说出来，
  // 不假装查过。
  const gaps = m.boxes.slice(1).map((b, i) => b.t - m.boxes[i].b);
  check(
    gaps.length >= 2 ? '没开通：上下等距' : '没开通：只有一个间隔，等距这一条跳过（不假装查过）',
    gaps.length < 2 || gaps.every((g) => Math.abs(g - gaps[0]) <= 1),
    gaps.join(' / ') || '（没有间隔）',
  );
  check('没开通：底下一颗红色 STOP', m.btn === 'STOP' && m.red, `${m.btn} · ${m.red ? '红' : '不红'}`);
  check('没开通：没有右下角那颗《开始 〉》', !m.go);
  check('这一屏上没有那几张图（那是下一屏的事）', m.icons === 0, `${m.icons} 张`);
  check('这一屏不留底排导航', m.nav === 'none', m.nav);

  // 按 STOP：从上到下一台一台停。记下每台「轮子全停稳」的先后。
  await page.evaluate(() => {
    const w = window;
    w.__order = [];
    const obs = new MutationObserver(() => {
      document.querySelectorAll('.slot-intro-item').forEach((it, k) => {
        const done = [...it.querySelectorAll('.slot-reel')].every((r) => r.classList.contains('slot-reel--set'));
        if (done && !w.__order.includes(k)) w.__order.push(k);
      });
    });
    obs.observe(document.getElementById('slotIntroStack'), { attributes: true, subtree: true, attributeFilter: ['class'] });
  });
  await page.click('#slotDemoBtn');
  await page.waitForTimeout(400);
  const mid = await page.evaluate(() => ({
    set: document.querySelectorAll('.slot-intro-item .slot-reel--set').length,
    red: Boolean(document.getElementById('slotDemoBtn')?.classList.contains('slot-demo-btn--stop')),
  }));
  check('按下 STOP 的头半秒：还没有一个停稳，键还是 STOP', mid.set === 0 && mid.red, `停稳 ${mid.set} 个`);
  await page.waitForFunction(
    (want) => document.querySelectorAll('.slot-intro-item .slot-reel--set').length === want,
    m.reels,
    { timeout: 9000 },
  );
  const after = await page.evaluate(() => ({
    order: window.__order,
    btn: document.getElementById('slotDemoBtn')?.textContent.trim(),
    green: Boolean(document.getElementById('slotDemoBtn')?.classList.contains('slot-demo-btn--start')),
  }));
  check('从上到下一台一台停', JSON.stringify(after.order) === JSON.stringify([...Array(N).keys()]),
    JSON.stringify(after.order));
  check('全停稳了，STOP 变成绿色的《开始》', after.btn === '开始' && after.green, `${after.btn} · ${after.green ? '绿' : '不绿'}`);
  await page.click('#slotDemoBtn');
  await page.waitForTimeout(400);
  const again = await page.evaluate(() => ({
    set: document.querySelectorAll('.slot-intro-item .slot-reel--set').length,
    red: Boolean(document.getElementById('slotDemoBtn')?.classList.contains('slot-demo-btn--stop')),
    spinning: [...document.querySelectorAll('.slot-intro-item .slot-strip')].every((s) => s.children.length > 0),
  }));
  check('按《开始》又转起来，键变回红色 STOP', again.set === 0 && again.red && again.spinning, `停稳 ${again.set} 个`);
  // 《退出》回个人主页，不是主菜单。
  await page.click('#slotBack');
  check('没开通：《退出》回到个人主页', await page.waitForSelector('.profile-page', { timeout: 8000 }).then(() => true).catch(() => false));
  await ctx.close();
}

// ---- 天才：两个族各走一遍 -------------------------------------------------
//
// **两族，不是三族。**《侵蚀阶梯》v1.2 PR-6 删掉了三角那副基础棋盘，挑图形那一屏
// 上从此只有方块和小球（ui/slotMachine.ts 的 FAMILIES）。这儿原先还写着三族，走
// 到三角那一轮 click 一个不存在的按钮、整道门超时崩掉。
const FAMILIES = [
  { key: 'square', name: '方块' },
  { key: 'circle', name: '圆球' },
];
for (const fam of FAMILIES) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(seed, true);
  await ctx.addInitScript(installProbe);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // 甲、直接从主菜单开这个玩法，记下它自己那一排图示——反面的标准答案。
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
  await page.$$eval('.home-icon-btn', (els, n) =>
    els.find((e) => e.getAttribute('aria-label') === n)?.click(), fam.name);
  await page.waitForFunction(
    () => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball, #boardWrap .tri').length > 0,
    { timeout: 25000 });
  await page.waitForTimeout(700);
  const plain = await page.evaluate(() => window.__probe.hud());
  check(`${fam.name}：基础局的《得分图案》块真的画了东西（尺子）`,
    Boolean(plain) && plain.n >= 2 && !plain.target,
    plain ? `${plain.n} 个 ${plain.tag} · ${plain.target ? '挂着目标类' : '没挂目标类'}` : '（那一块是空的）');

  // 乙、走一遍老虎机：介绍页右下角的《开始 〉》→ 挑图形 → 转。
  await openIntro(page);
  check(`${fam.name}：开通了：介绍页右下角有《开始 〉》`, Boolean(await page.$('#slotGo')));
  await page.click('#slotGo');
  await page.waitForSelector('.slot-pick-opt', { timeout: 8000 });
  await page.click(`.slot-pick-opt[data-family="${fam.key}"]`);
  await page.waitForSelector('#startOverlay .slot-machine', { timeout: 8000 });
  // 记下每个轮子停稳的时刻（用 MutationObserver 盯 class），不靠「恰好在两次
  // 停之间去看一眼」——那一眼总有一天会晚到。
  await page.evaluate(() => {
    const w = window;
    w.__stops = [];
    const reels = [...document.querySelectorAll('#startOverlay .slot-reel')];
    reels.forEach((r, i) => {
      if (r.classList.contains('slot-reel--set')) w.__stops.push([i, performance.now()]);
      new MutationObserver(() => {
        if (r.classList.contains('slot-reel--set') && !w.__stops.some((s) => s[0] === i)) w.__stops.push([i, performance.now()]);
      }).observe(r, { attributes: true, attributeFilter: ['class'] });
    });
  });
  const stage = await page.evaluate(() => ({
    art: Boolean(document.querySelector('#startOverlay .slot-machine-art svg')),
    // 两个窗口，两个都在转。
    spinning: [...document.querySelectorAll('#startOverlay .slot-reel')]
      .map((r) => r.querySelector('.slot-strip').children.length > 0),
    // 轮子还在转，倒数窗口还不该露面。
    countHidden: getComputedStyle(document.getElementById('startCount')).visibility === 'hidden',
    digits: document.querySelectorAll('#startCount .cd-digit').length,
    // 图案的描边：白窗口上要的是圆角黑边，不是白边。
    edge: getComputedStyle(document.querySelector('#startOverlay .slot-reel')).getPropertyValue('--mark-edge').trim(),
  }));
  check(`${fam.name}：那台老虎机就是给的那张图`, stage.art);
  check(`${fam.name}：两个窗口、两个滚筒都在转`,
    JSON.stringify(stage.spinning) === JSON.stringify([true, true]), stage.spinning.join(','));
  check(`${fam.name}：转的时候倒数还没露面`, stage.countHidden && stage.digits === 0,
    `visibility ${stage.countHidden ? 'hidden' : 'visible'} · ${stage.digits} 个数字`);
  check(`${fam.name}：图案描的是黑边`, /2E2430/i.test(stage.edge), stage.edge || '（空）');

  // 第二个轮子停稳了才开始数，而且从 5 起。
  await page.waitForFunction(() => document.querySelectorAll('.slot-reel--set').length >= 2, { timeout: 6000 });
  await page.waitForFunction(() => document.querySelector('#startCount .cd-digit'), { timeout: 4000 });
  const first = await page.evaluate(() => ({
    digit: document.querySelector('#startCount .cd-digit')?.textContent,
    shown: getComputedStyle(document.getElementById('startCount')).visibility !== 'hidden',
  }));
  check(`${fam.name}：停稳之后倒数才露面，从 5 起`, first.digit === '5' && first.shown, first.digit || '（没数）');

  await page.waitForFunction(() => document.querySelectorAll('.slot-reel--set').length === 2, { timeout: 6000 });
  // 从左到右先后停：左边那个停稳的时刻要早于右边那个，中间隔得开。
  const stops = await page.evaluate(() => window.__stops.slice().sort((a, b) => a[0] - b[0]));
  const gap = stops.length === 2 ? stops[1][1] - stops[0][1] : NaN;
  check(`${fam.name}：从左到右一个一个停`, stops.length === 2 && stops[0][0] === 0 && gap > 400,
    `左 → 右相隔 ${Math.round(gap)}ms`);
  const reels = await page.evaluate(REELS);
  const spun = [reels[0].label, reels[1].label];
  const spunFp = await page.evaluate(() => window.__probe.reel(0));
  // 一局只有一个得分目标（PR-8），两个窗口停的是**同一张**——那张图上的显示区被
  // 一道黑弧分成两格，收成一个窗口就得铺白盖掉它（见 src/ui/slotReels.ts）。
  check(`${fam.name}：两个窗口停在同一个图案上`,
    Boolean(spun[0]) && spun[0] === spun[1], spun.join(' / ') || '（空）');

  // 开局：倒数完自己会把局叫起来。
  await page.waitForFunction(
    () => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball, #boardWrap .tri').length > 0,
    { timeout: 30000 });
  await page.waitForTimeout(700);
  const drawn = await page.evaluate(() => window.__probe.hud());
  // 轮子停在编号 spun[0] 上；HUD 那一块该画的就是这个编号的图案。两边不比图形
  // 本身（一个是滚筒里的整族图示、一个是 HUD 里的单张），比的是「那一块画出来
  // 的形状，正好等于把这个编号单独画一遍」——所以在页面里按编号现画一张来比。
  check(`${fam.name}：HUD 那一块真的画出了东西，而且挂着「目标」那个身份类`,
    Boolean(drawn) && drawn.n >= 1 && drawn.target,
    drawn ? `${drawn.n} 个 ${drawn.tag} · ${drawn.target ? '挂着' : '没挂'}` : '（那一块是空的）');
  check(`${fam.name}：盘上认的就是轮子上停下来的那一个`,
    SAME(drawn, spunFp),
    `HUD ${FMT(drawn)} · 轮子 ${FMT(spunFp)}`);
  // 「和直接开这个玩法那一套不一样」——**只在能判断的时候判断。** 抽到的目标是随
  // 机的，而二十个图案里有几个本身就是一条直线（方块 36 就是 1×4、38 是 1×5，小球
  // 27 是一排四颗），抽到那几个的时候 HUD 上画的和基础局画的本来就同形，「换没换
  // 掉」这件事从形状上看不出来。写死一条「必须不一样」的话，这道门会看抽签结果偶
  // 发红——而偶发红最后一定会被人加 continue-on-error。
  // 换不换掉这件事另有两条钉住它：上面那条「HUD＝轮子」，和那个只有老虎机局才挂
  // 的身份类。
  if (SAME(drawn, plain)) {
    check(`${fam.name}：这一局抽到的图案本身就是一条直线，和基础那一条同形——这一条无从判断（不假装查过）`,
      true, `HUD ${FMT(drawn)}`);
  } else {
    check(`${fam.name}：不是这个玩法自己那一套 1×N`, true, `HUD ${FMT(drawn)} · 基础 ${FMT(plain)}`);
  }
  check(`${fam.name}：一路没报错`, errors.length === 0, errors[0] || '');
  await ctx.close();
}

await browser.close();
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项没过`);
process.exit(fail ? 1 : 0);

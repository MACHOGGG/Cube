/**
 * 棋子有没有戳出底下那块板子。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8815 dist
 *   node scripts/check-board-fit.mjs http://localhost:8815/
 *
 * 量的是两个框：底板（.board-wrap，游戏页里那块圆角面板）和棋子们的并集。
 * 后者不许越过前者——一枚方块压在板子边缘外面，看上去就是「这个游戏没做完」。
 *
 * 为什么要一个脚本而不是看一眼：八个玩法 × 两个方向 = 十六种，而每一种都要
 * 等 4-3-2-1 数完、等 ResizeObserver 把布局定下来才量得准。眼睛看得过来，
 * 但看不住——改一次圆角、动一下间距，十六种里总有一种会悄悄越界。
 *
 * 容差 0.5px：亚像素的取整不算越界，肉眼也看不见。
 *
 * ── 第二件事：手指按着的那几帧，圆角不许动 ──────────────────────────────
 *
 * 上面量的是**静止**的一帧。可这块底板的圆角出过三次事故，三次都只在**动的
 * 那几帧**里看得见（见 engine/boardResize.ts 的 floorBox 和 fitPanelRadius）：
 *
 *   · 拖动时重排，上一轮算好的圆角被清掉、重算排到下一帧——手指一按，四个角
 *     从 14px 弹成样式表里的 25px，松手才弹回来；
 *   · 补位的 `.ghost` 被当成实体算进去，那一侧的角被压成 0，当场变直角；
 *   · 把 ghost 排除之后又变成**涨**：拖第一行时上面两个角一枚棋子都管不着，
 *     圆角一路长回设计值。逐帧量出来是 14 → 25.32 → 14。
 *
 * 三次修下来收敛到同一条不变量：**圆角是排版的性质，不是某一帧的性质**。可是
 * 它今天靠两个约定撑着——补位块必须叫 `.ghost`，`offsetIn` 必须不认 transform
 * ——新玩法只要用 transform 做拖动预览、或者把补位块换个类名，就会静默绕过这
 * 两条，而静止那一帧照样是对的，上面那半道门一个字都不会红。
 *
 * 所以这里真的按下去拖一段，逐帧量四个角：全程必须和静止时是同一个数。约定
 * 换不换无所谓，这一条量的是玩家眼睛看得见的那件事。
 *
 * 只量「手指还按着」的那一段，不量松手之后：松手之后棋子落位、可能得分、可能
 * 消掉一整行，角上空出来圆角本来就该长回去（fitPanelRadius 最后那句就是为这
 * 个写的）。把松手后也一起断言，量的就不是这个 bug 了。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8815/';
const TOL = 0.5;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

let fail = 0;
/** 哪几副盘这一轮压根没量到（见下面那个 `stuck` 分支）。 */
const skipped = [];
/**
 * 余量薄到这个数以下的，单独报出来。
 *
 * `worst` 量的是「越界了多少」，负数才是余量，所以 `worst = 0` 的意思不是「卡在
 * 容差线上」——它没越界，容差一点没用上——而是**不多不少正好贴齐，一点余量都没
 * 有**。这两件事差别很大，上一轮的报告混过一次。
 *
 * 为什么余量 0 该被单独说一句：它现在是绿的，可下一次任何让棋子变大或底板变小
 * 的改动（间距、圆角、字号、边框，哪怕半个像素）第一个破的就是它。而实测最紧的
 * 那副是七色圆球（三档视口都是 0px），它是订阅专属棋盘——普通玩家和日常自测都
 * 不会点进去，破了最没人看得见。
 *
 * 这一栏**不算红**，只在结尾汇总。红留给真越界的；这是「绿着但危险」，和
 * skipped 那一栏的「绿着但没在看」是两件事。
 */
const TIGHT = 2;
const tight = [];
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/**
 * 一枚棋子有没有戳出地板。
 *
 * 比的不是两个方框——那是这个 bug 藏了这么久的原因。地板是个圆角矩形，棋盘
 * 却是照着整格算满的：角上那枚方块的方框在地板的方框之内（差 2px），它的角
 * 却落在圆角那道弧的外面。量方框永远量不出来，眼睛一看就是「这个游戏没做完」。
 *
 * 所以这里逐个角地算：半径 R 的圆角，圆心在 (R, R)；棋子离这个角最近的那个
 * 点是 (a, b)；它被切到，当且仅当 a < R 且 b < R 且 (R−a)² + (R−b)² > R²。
 * 棋子自己的圆角也算进去——它最外那个点沿对角线往里缩 r(1 − 1/√2)。
 */
const MEASURE = () => {
  const wrap = document.querySelector('.app--game .board-wrap');
  if (!wrap) return null;
  const w = wrap.getBoundingClientRect();
  const cs = getComputedStyle(wrap);
  const R = [
    parseFloat(cs.borderTopLeftRadius) || 0,
    parseFloat(cs.borderTopRightRadius) || 0,
    parseFloat(cs.borderBottomRightRadius) || 0,
    parseFloat(cs.borderBottomLeftRadius) || 0,
  ];
  const pieces = [...wrap.querySelectorAll('.tile, .ball, .tri')];
  if (!pieces.length) return null;
  const pull = (parseFloat(getComputedStyle(pieces[0]).borderTopLeftRadius) || 0) * (1 - Math.SQRT1_2);

  // 越界多少：正数是戳出去了，负数是还有余量。
  let worst = -Infinity;
  let where = '';
  const note = (over, tag) => {
    if (over > worst) { worst = over; where = tag; }
  };
  for (const p of pieces) {
    const q = p.getBoundingClientRect();
    if (q.width <= 0 || q.height <= 0) continue;
    // 先看方框：戳出地板的方框是最直白的一种越界。
    note(w.left - q.left, '左');
    note(w.top - q.top, '上');
    note(q.right - w.right, '右');
    note(q.bottom - w.bottom, '下');
    // 再看四个圆角。
    const near = [
      [q.left - w.left + pull, q.top - w.top + pull, R[0], '左上角'],
      [w.right - q.right + pull, q.top - w.top + pull, R[1], '右上角'],
      [w.right - q.right + pull, w.bottom - q.bottom + pull, R[2], '右下角'],
      [q.left - w.left + pull, w.bottom - q.bottom + pull, R[3], '左下角'],
    ];
    for (const [a, b, r, tag] of near) {
      if (!(r > 0) || a >= r || b >= r) continue;
      // 圆心到那个点的距离超过 R 就是戳出去了；差多少就是越界多少。
      const d = Math.hypot(r - a, r - b);
      note(d - r, tag);
    }
  }
  return {
    n: pieces.length,
    worst: Math.round(worst * 10) / 10,
    where,
    radius: R.map((r) => Math.round(r)).join('/'),
    floor: { w: Math.round(w.width), h: Math.round(w.height) },
  };
};

/**
 * 底板四个角的圆角，外加「这一帧棋盘认不认得自己正被拖着」。
 *
 * 后面这一格是防「这道门量了个寂寞」：要是这一下拖动压根没被棋盘接住（落点
 * 没抓到棋子、这个玩法这一刻不收拖动），四个角当然不会变，断言就永远绿。所以
 * 把 drag.ts 挂的那个记号一起读回来——一次都没挂上，这一条就是没量到，要红。
 */
const RADIUS = () => {
  const wrap = document.querySelector('.app--game .board-wrap');
  if (!wrap) return null;
  const cs = getComputedStyle(wrap);
  return {
    r: [
      cs.borderTopLeftRadius,
      cs.borderTopRightRadius,
      cs.borderBottomRightRadius,
      cs.borderBottomLeftRadius,
    ].map((v) => Math.round((parseFloat(v) || 0) * 10) / 10),
    dragging: wrap.classList.contains('board-dragging'),
  };
};

/** 主菜单上「点一下到不了棋盘」的那几张，按 aria-label 认（见下面的循环）。 */
const NOT_A_BOARD = ['多人游玩', '老虎机模式', '无限反转'];

const ALL_VIEWPORTS = [
  { key: 'portrait', name: '竖屏 390×844', width: 390, height: 844 },
  { key: 'landscape', name: '横屏 844×390', width: 844, height: 390 },
  { key: 'small', name: '小竖屏 360×640', width: 360, height: 640 },
];
// 第二个参数可以只挑一档跑（portrait / landscape / small）。十六种全跑一遍
// 要好几分钟，改一处样式想立刻看一眼的时候用得上。
const want = process.argv[3];
const VIEWPORTS = want ? ALL_VIEWPORTS.filter((v) => v.key === want) : ALL_VIEWPORTS;

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  await ctx.addInitScript(() => {
    for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
      localStorage.setItem(k, '1');
    localStorage.setItem('slides_lang', 'zhHans');
    // 种一份天才权益，不然天才特供那两副盘这道门一次都量不到。
    //
    // 漏掉的偏偏是最该量的两副：七色圆球 49 枚菱形、进阶三角 49 枚 V 形——格子
    // 最多（比方块的 36 枚多三成），包围盒最不规整。量得到的那几副反而是最规
    // 整的。一道门的覆盖面和它的风险面对不上，而且它跳过去的时候一声不吭，跑
    // 完满屏 PASS。
    //
    // 为什么种 localStorage 就够（逐条查过才敢这么写）：
    //   · engine/subscription.ts 的 isGenius() 是同步的，只读这一个键；主菜单
    //     那几张卡（menu.ts 的 geniusCard、geniusContent.ts 的 isLayoutLocked）
    //     点下去那一刻不问服务器。
    //   · channel 必须写 'code'。read() 会把「柜台对不上」的权益整份丢成
    //     NOBODY，只有内部码不归任何柜台管，web 和 app 两边都认。
    //   · 开机时 main.ts 会调一次 refreshEntitlement()。它第一句实质判断就是
    //     `if (codeStillLive()) return;`（内部码 + 没过期 = 原地掉头），所以
    //     一个请求都不发，种下的这份不会被网络那头冲掉——dev-server 那边什么
    //     都不用配。
    //
    // 换句话说这不是绕过付费墙，是照着「兑过一张长期内部码的玩家」原样摆一份。
    localStorage.setItem(
      'slides_genius',
      JSON.stringify({
        active: true,
        channel: 'code',
        until: Date.now() + 365 * 24 * 60 * 60 * 1000,
      }),
    );
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 20000 });

  const labels = await page.$$eval('.home-icon-btn', (els) =>
    els.map((e) => e.getAttribute('aria-label') || ''));

  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    // 这三张不是棋盘，是流程：点一下到不了棋盘，所以这道门不从这儿进。
    //   · 多人游玩 → 小屋那一页（check-multiplayer 管那一头）；
    //   · 老虎机模式 → 三选一 → 滚筒 → 5-4-3-2-1；
    //   · 无限反转 → 先挑形状。
    //
    // 更要紧的是它们**没有自己的棋盘**：两个都只是给基础方块/小球/三角加一个
    // 选项（gameController 的 targets / flip），几何形状和上面已经量过的那三副
    // 逐格相同。跳过它们不少量任何一种布局——文件头说的「八副棋盘 × 两个方向」
    // 本来也不含它们。
    //
    // 这一条是种了权益之后才看清的：从前这两张撞在订阅墙上被跳过，看着像「没
    // 权限所以量不到」，其实是「不该从这儿进」。权益一种上，它们真的点开了，
    // 然后卡在滚筒和挑形状那一屏上，红成「棋盘没出现」——那才是真相。
    if (!label || NOT_A_BOARD.some((n) => label === n || label.startsWith(n + ' · '))) continue;
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
    await page.$$eval('.home-icon-btn', (els, k) => els[k].click(), i);
    // 炸弹那几张点开是「选个形状」的窗口，不是直接开局——挑第一个。天才特供
    // 那两副盘（七色圆球、进阶三角）现在跟别的卡一样直接开局：权益在上面
    // 种过了，主菜单上它们不再是锁着的那一档。
    await page.waitForTimeout(500);
    // 有的卡片点开不是开局，是先让你挑一个形状。两种挑法都在这儿接住：
    //   · 弹一个居中的窗（进阶炸弹那几张）；
    //   · 原地摊开成三张小卡（定时炸弹）——摊开之后主菜单上多出
    //     「定时炸弹 · 方块」这样的按钮，认前缀就找得到。
    const chip = await page.$('.center-pick .bomb-chip, .center-pick .center-pick-opt:not(.center-pick-opt--locked)');
    if (chip) {
      await chip.click();
      await page.waitForTimeout(400);
    } else {
      const opened = await page.$$eval(
        '.home-icon-btn',
        (els, prefix) => {
          const hit = els.find((e) => (e.getAttribute('aria-label') || '').startsWith(prefix + ' · '));
          if (!hit) return false;
          hit.click();
          return true;
        },
        label,
      );
      if (opened) await page.waitForTimeout(400);
    }
    const started = await page
      .waitForFunction(
        () => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball, #boardWrap .tri').length > 0,
        { timeout: 25000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!started) {
      // 停在一个窗口上、没进到棋盘。从前这里是一句 SKIP 就过去了，理由是
      // 「天才特供那两张点开是订阅墙，没订阅进不去是对的」——可上面已经种了
      // 权益，它们现在该开得进去。所以还撞上窗口只剩两种可能：种子失效了
      // （权益的键名或字段变过），或者挑形状那一窗没点穿。两种都是「这一副
      // 没量到」。
      //
      // 一道门最危险的状态不是红，是绿着但没在看：十六种里少量四种，屏幕上
      // 照样一片 PASS，没人会发现。所以记下来，结尾统一报红。
      const stuck = await page.evaluate(() =>
        Boolean(document.querySelector('.overlay.show, .center-pick')) &&
        !document.querySelector('.app--game'));
      if (stuck) {
        skipped.push(`${vp.name} · ${label}`);
        console.log(`SKIP  ${vp.name} · ${label}：停在一个窗口上，没进到棋盘`);
        continue;
      }
      check(`${vp.name} · ${label}：开得起来`, false, '棋盘没出现');
      continue;
    }
    // 布局是 ResizeObserver 定下来的，可能要多等一两帧。
    await page.waitForTimeout(900);
    const m = await page.evaluate(MEASURE);
    if (!m) {
      check(`${vp.name} · ${label}：量得到`, false, '找不到底板或棋子');
      continue;
    }
    check(
      `${vp.name} · ${label}：棋子都在底板里`,
      m.worst <= TOL,
      m.worst > TOL
        ? `${m.where}越界 ${m.worst}px · 圆角 ${m.radius} · 底板 ${m.floor.w}×${m.floor.h} · ${m.n} 枚`
        : `余量 ${-m.worst}px（最紧的是${m.where}）· 圆角 ${m.radius}`,
    );
    // 过了，但余量薄。记一笔，结尾单独摆出来（见上面 TIGHT 那段）。
    if (m.worst <= TOL && m.worst > -TIGHT) {
      tight.push(`${vp.name} · ${label}：余量只剩 ${-m.worst}px（${m.where}）`);
    }

    // ── 手指按着的那几帧，圆角不许动（见文件头）──────────────────────
    const rest = await page.evaluate(RADIUS);
    const box = await page.$eval('.app--game .board-wrap', (e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    // 落点挑**第一行**，这是故意的：上面那两个角此刻一枚不动的棋子都管不着，
    // 正是三次事故里最后那一次的配置（圆角从贴着棋子的 14px 一路长回样式表
    // 里的 25px，手一松又掉回来）。拿别的行试过，28% 那一行上头还有棋子压着
    // 两个上角，把三层保护全拆掉这道门照样绿——那就成了一道量不到东西的门。
    //
    // 横着拖，一小步一小步地走：要量的是过程，不是终点。
    await page.mouse.move(box.x + box.w * 0.5, box.y + box.h * 0.08);
    await page.mouse.down();
    const frames = [];
    for (let k = 1; k <= 12; k++) {
      await page.mouse.move(box.x + box.w * 0.5 + k * 7, box.y + box.h * 0.08, { steps: 2 });
      await page.waitForTimeout(45);
      frames.push(await page.evaluate(RADIUS));
    }
    await page.mouse.up();
    await page.waitForTimeout(400);

    const grabbed = frames.some((f) => f && f.dragging);
    const same = (a, b) => a && b && a.r.every((v, i) => Math.abs(v - b.r[i]) <= TOL);
    const off = frames.filter((f) => !same(f, rest));
    check(
      `${vp.name} · ${label}：拖动的那几帧圆角没动过`,
      grabbed && off.length === 0,
      !grabbed
        ? '这一下拖动没被棋盘接住（board-dragging 一帧都没挂上），等于没量到'
        : off.length
          ? `静止是 ${rest.r.join('/')}，拖动中出现过 ${[...new Set(off.map((f) => f.r.join('/')))].join('  ')}`
          : `全程 ${rest.r.join('/')}（量了 ${frames.length} 帧）`,
    );
  }
  await ctx.close();
}

await browser.close();
// 没量到的也算红。跳过去而屏幕全绿，正是这道门最该避免的样子——它量的是十六
// 种，少一种就不是十六种了。
if (skipped.length) {
  console.log(`\n⚠ 这一轮有 ${skipped.length} 副盘没量到：${skipped.join('、')}`);
  fail += skipped.length;
}
// 不算红：它们此刻都在底板里。但下一次调间距、圆角、字号，第一个破的就是它们。
if (tight.length) {
  console.log(`\n⚠ 余量不足 ${TIGHT}px 的 ${tight.length} 处（过了，但下次一动就破）：`);
  for (const line of tight) console.log(`   ${line}`);
}
console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);

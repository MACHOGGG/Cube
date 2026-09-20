/**
 * 电脑端游戏页的三栏排版：棋盘居中、教学面板不被切、头一局和第二局一样大。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8815 dist
 *   node scripts/check-desktop-game.mjs http://localhost:8815/
 *
 * 要开浏览器，所以留在本地手跑，不进 CI（同 check-board-fit）。
 *
 * ── 为什么要有这道门 ────────────────────────────────────────────────────
 *
 * 2026-09 电脑端从「一条 460px 的窄列」改成三栏（左读数 / 中棋盘 / 右教学）。
 * 改的过程中量出来三件事，三件都是**屏幕上看得见、却没有任何一道门会红**的：
 *
 *   ① 1440×900 上棋盘的中心落在 726 而不是 720——歪 6px。原因是算棋盘宽度时
 *      拿的是 100vw，忘了减掉这一页左右各 14px 的留白，三条轨道的最小宽加起来
 *      比容器宽，栅格整体朝右溢出。
 *   ② 1920×1080 的七色圆球（宽一档的棋盘）头一回打开时带教学条，右栏被挤到
 *      1474 起、宽 460，右沿 1934——**教学面板被屏幕切掉 14px**。头一局正是最
 *      需要那块面板的一局。
 *   ③ 头一局的排版和以后每一局不一样：棋盘大一圈（那一版上 1000×700 是 468 对
 *      432），读数和教学面板还各往外挪十来像素、读数矮一档。文件末尾那档
 *      `.app--game.has-coach`（为手机腾高度，收窄各块间的缝和读数）排在三栏那
 *      一段后面、选择器又一样宽，于是把栏间缝盖成了 7.7px。同一副棋盘头一局和
 *      第二局不一样，正是「不要出现意料之外的界面」。
 *   ④ **地板压住了底下那排《暂停》**（玩家截图报的）。三栏第一版里，得分图示那
 *      一行是 auto、棋盘那一格自己写死 `height: 100dvh − 228px`，而 228 是按方
 *      块那条 82px 高的图示估的。菱形方块的斜向图案要占四行、图示高 133，整格
 *      于是比那一行高出五十来像素，align-items: center 让它朝上下一起溢出——
 *      1920 上压住按键 35px，1280×720 上 11px。所以这道门量的是**每一副棋盘**，
 *      不是挑一副。
 *   ⑤ 同一件配件在不同玩法之间大小位置不一样：得分图示 28px 和 21px 两档、暂停
 *      键跟着棋盘宽从 227 到 562、读数格被竖着的 flex 压成文字高（49px，而样式
 *      表里写着 50–78）。玩家：「统一得分标记、左侧三个信息栏、下方的暂停按钮
 *      的大小和位置，不要不停改变」。
 *
 * 所以这道门量的就是这三条，外加一条「三样东西互不重叠」。量的是成效（位置和
 * 尺寸），不是某一行 CSS 长什么样——这个仓库栽过好几次「门只认字面量」的跟头。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8815/';

/** 四档常见的电脑屏。1000×700 是这套排版的下限（媒体查询的门槛是 1000×561）。 */
const VPS = [
  { w: 1920, h: 1080 },
  { w: 1366, h: 768 },
  // 1280×720 和 1366×768 是④那次压住按键最明显的两档（压 11 / 16px）。
  { w: 1280, h: 720 },
  // 这一段媒体查询的门槛（1000×561）。中间那一行在这儿只剩 299px，是最容易
  // 挤出事的一档。
  { w: 1000, h: 561 },
];

/** 「这个玩法开过了」的全部钥匙（engine/firstPlay.ts 的 PlayKey）。 */
const ALL_KEYS = ['square', 'circle', 'triangle', 'timed', 'bomb', 'flip', 'slot', 'layout', 'puzzle'];

/**
 * 量两副：基础方块（最常见）、七色圆球（宽一档的棋盘，②就出在它身上）。
 * 每一副都量两遍——头一局（教学面板在右栏）和熟客（右栏空着）。
 *
 * `firstSeed` 是「头一局」那一遍要预先插上的钥匙。两副各有各的讲究，两处都是
 * 这道门写第一版时踩出来的：
 *
 *   · 方块用一份**干净**的 localStorage。头一回打开的玩家被主菜单封着，只能点
 *     基础方块和基础小球（lockedForFirstPlay），方块正是其中一张，点得开；而且
 *     三张基础卡一张都没打过，教学条才走 'first' 那一路——一进去就出声。插上
 *     circle / triangle 的话它会走 'second'，那一路**等玩家得分三次才开口**，
 *     面板于是一直是 hidden，量出来是个 0×0 的框。
 *   · 七色圆球反过来：它不在那两张里，干净的 localStorage 下那张卡是锁着的，
 *     点下去什么也不会发生（第一版四行红的「点开了但没进到棋盘」就是这个）。
 *     所以把别的钥匙都插上、只留 layout 那一把——`tipFor('layout')` 的提示是一
 *     进去就摆在那儿的。
 */
const BOARDS = [
  { name: '方块', firstSeed: [] },
  // 菱形方块：④ 就出在它身上——它的斜向图案要占四行，是全站最高的一条得分图示
  // （133px）。少了它，这道门在第一版的 bug 上是绿的。
  { name: '菱形方块', firstSeed: ALL_KEYS.filter((k) => k !== 'layout') },
  { name: '七色圆球', firstSeed: ALL_KEYS.filter((k) => k !== 'layout') },
];

/** 居中允许差这么多：亚像素取整 + 地板收成整格数会差一两个像素，肉眼看不出。 */
const CENTER_TOL = 3;
/**
 * 头一局和熟客的各配件位置允许差这么多（同上，整格取整）。
 *
 * 量的不只是棋盘：③ 那个 bug 在最后这一版的算式下**不改变棋盘大小**（横向上限
 * 里的 60px 是写死的，不是读实际栏间缝），只把读数和教学面板往外挪。只钉棋盘
 * 边长的话这道门对它是绿的——反例试过，四行全绿。所以这一条钉的是「除了右栏多
 * 一块教学面板，头一局和以后每一局一个像素都不动」：棋盘、读数、底下那排键，
 * 三个框的位置和大小都要对上。
 */
const SAME_TOL = 3;

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const MEASURE = () => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom };
  };
  return {
    hud: box('.app--game .hud'),
    cell: box('.app--game .hud-cell'),
    wrap: box('#boardWrap'),
    coach: box('.app--game .coach-bar'),
    ctl: box('.app--game .controls'),
    btn: box('#stopBtn'),
    hint: box('.app--game .pattern-hint--a'),
    // 图示「一样大」说的是一枚图标多大（字号），不是这一条多高——菱形方块的斜
    // 向图案本来就占四行，比方块的两行高，那是图案自己的事。真正要钉住的是
    // ①每枚图标一样大 ②这一条占的行高不变（所以棋盘的上沿不动）。
    hintFont: (() => {
      const el = document.querySelector('.app--game .pattern-hint--a');
      return el ? getComputedStyle(el).fontSize : '';
    })(),
    vw: window.innerWidth,
    vh: window.innerHeight,
    // 这一页本来就该是满屏不滚的。横着能滚 = 有东西顶出去了。
    scrollX: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
};

/** 两个框有没有叠在一起（容差 0：贴边不算叠）。 */
function overlap(a, b) {
  if (!a || !b) return false;
  return a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/**
 * 开一局。coach=true 时 localStorage 是干净的（头一局，教学面板在）；
 * false 时把「这个玩法开过了」的旗都插上，教学面板就不出了。
 *
 * 两种都种上权益：七色圆球是天才特供的棋盘，没有权益点开是订阅墙。
 */
async function open(vp, board, coach) {
  const name = board.name;
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
  const seed = coach ? board.firstSeed : ALL_KEYS;
  await ctx.addInitScript((keys) => {
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem(
      'slides_genius',
      JSON.stringify({ active: true, channel: 'code', until: Date.now() + 365 * 24 * 3600 * 1000 }),
    );
    for (const k of keys) localStorage.setItem('slides_played_' + k, '1');
  }, seed);
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
  const labels = await page.$$eval('.home-icon-btn', (els) =>
    els.map((e) => e.getAttribute('aria-label') || ''));
  const i = labels.findIndex((l) => l === name);
  if (i < 0) {
    await ctx.close();
    return { ctx: null, m: null, why: `主菜单上没有《${name}》` };
  }
  await page.$$eval('.home-icon-btn', (els, k) => els[k].click(), i);
  const started = await page
    .waitForFunction(
      () => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball, #boardWrap .tri').length > 0,
      { timeout: 25000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!started) {
    await ctx.close();
    return { ctx: null, m: null, why: '点开了但没进到棋盘' };
  }
  // 排版是 ResizeObserver 定下来的，等它把地板钉住。
  await page.waitForTimeout(1100);
  const m = await page.evaluate(MEASURE);
  return { ctx, m, why: '' };
}

for (const vp of VPS) {
  const tag = `${vp.w}×${vp.h}`;
  /** 这一档视口上各副棋盘的「熟客」那一遍，留着横向比（⑤）。 */
  const sameVp = [];
  for (const board of BOARDS) {
    const name = board.name;
    /** 同一副棋盘的两种局，边长要一样（③）。 */
    const sides = {};
    for (const coach of [true, false]) {
      const lead = `${tag} ${name}·${coach ? '头一局' : '熟客'}`;
      const { ctx, m, why } = await open(vp, board, coach);
      if (!m) {
        check(`${lead}：开得起来`, false, why);
        continue;
      }
      sides[coach ? 'first' : 'later'] = m;
      if (!coach) sameVp.push({ name, m });

      // ① 棋盘落在屏幕正中。左右两栏同宽，这一条才成立。
      const off = m.wrap.x + m.wrap.w / 2 - m.vw / 2;
      check(
        `${lead}：棋盘在屏幕正中`,
        Math.abs(off) <= CENTER_TOL,
        `偏 ${off.toFixed(1)}px（棋盘 ${Math.round(m.wrap.w)}×${Math.round(m.wrap.h)}）`,
      );

      // ② 教学面板整块在屏幕里。
      //
      // 「真的摆在那儿」要先查——否则这一条是假绿：面板的空壳子一开始是 hidden
      // 的（gameShell 摆壳子，coachBar.ts 填内容），一个 0×0 的框「当然」没被屏幕
      // 切到。第一版就出过这样一行绿的：`左 0 右沿 0 / 屏宽 1000`。
      if (coach) {
        const real = Boolean(m.coach) && m.coach.w > 120 && m.coach.h > 60;
        check(
          `${lead}：教学面板真的摆在右栏`,
          real,
          m.coach ? `${Math.round(m.coach.w)}×${Math.round(m.coach.h)}` : '连壳子都没有',
        );
        if (real) {
          check(
            `${lead}：教学面板没被屏幕切到`,
            m.coach.x >= -0.5 && m.coach.r <= m.vw + 0.5,
            `左 ${m.coach.x.toFixed(0)} 右沿 ${m.coach.r.toFixed(0)} / 屏宽 ${m.vw}`,
          );
        }
      }

      // 三样东西互不重叠：读数 / 棋盘 / 教学面板。
      const pairs = [
        ['读数和棋盘', m.hud, m.wrap],
        ['读数和教学面板', m.hud, m.coach],
        ['棋盘和教学面板', m.wrap, m.coach],
        ['棋盘和按键', m.wrap, m.ctl],
        ['棋盘和得分图示', m.wrap, m.hint],
      ];
      const bad = pairs.filter(([, a, b]) => overlap(a, b)).map(([n]) => n);
      check(`${lead}：各配件互不重叠`, bad.length === 0, bad.join('、') || '五对都分开的');

      check(`${lead}：没有横向滚动`, !m.scrollX);

      await ctx.close();
    }
    if (sides.first && sides.later) {
      const parts = [
        ['棋盘', 'wrap'],
        ['读数', 'hud'],
        ['按键', 'ctl'],
      ];
      const off = [];
      for (const [label, key] of parts) {
        const a = sides.first[key];
        const b = sides.later[key];
        if (!a || !b) { off.push(`${label}：有一局量不到`); continue; }
        for (const [what, va, vb] of [['左', a.x, b.x], ['上', a.y, b.y], ['宽', a.w, b.w], ['高', a.h, b.h]]) {
          if (Math.abs(va - vb) > SAME_TOL) {
            off.push(`${label}${what} ${va.toFixed(0)}→${vb.toFixed(0)}`);
          }
        }
      }
      check(
        `${tag} ${name}：头一局和以后每一局的排版一模一样（只多一块教学面板）`,
        off.length === 0,
        off.join('；') || `棋盘 ${Math.round(sides.first.wrap.w)}、读数、按键三个框都对上`,
      );
    }
  }

  // ⑤ 同一档屏幕上，换个玩法这三样不许动：得分图示那一条的高度、读数格、暂停
  //    键。量的是「玩家来回切玩法时眼睛看到的东西有没有跳」，所以比的是尺寸和
  //    纵向位置（横向位置本来就跟着棋盘宽走，棋盘宽是各副棋盘自己的事）。
  if (sameVp.length > 1) {
    const base = sameVp[0];
    const diff = [];
    const cmp = (label, pick, keys) => {
      for (const one of sameVp.slice(1)) {
        const a = pick(base.m);
        const b = pick(one.m);
        if (!a || !b) { diff.push(`${label}：${one.name} 量不到`); continue; }
        for (const k of keys) {
          if (Math.abs(a[k] - b[k]) > SAME_TOL) {
            diff.push(`${label}${k} ${base.name} ${a[k].toFixed(0)} / ${one.name} ${b[k].toFixed(0)}`);
          }
        }
      }
    };
    // 图示：每枚图标一样大。
    const fonts = [...new Set(sameVp.map((x) => x.m.hintFont))];
    if (fonts.length > 1) {
      diff.push(`图示字号 ${sameVp.map((x) => `${x.name} ${x.m.hintFont}`).join(' / ')}`);
    }
    // 图示那一条的**下沿**不动 = 那一行的高度钉住了，而且这一条离棋盘的距离不
    // 变（④ 那次就是这一行被撑高，棋盘跟着往下长，压住了底下那排键）。
    //
    // 比下沿，不比上沿也不比中线：图案几行是各副棋盘自己的事（方块两行 82px，
    // 菱形方块的斜向图案四行 133px），而这一条是**贴着行底**站的
    // （style.css 里 `.app--game > .pattern-hint--a { margin-top: auto }`），所以
    // 高的那条往上长、离棋盘的距离一分不差。玩家看的就是这段距离。
    //
    // 也不比棋盘的上沿：地板是贴着棋盘收的（boardResize 的 fitFloor），七色圆球
    // 的地板本来就比方块矮一截，在这一行里居中，上沿当然低一些。那是地板的形
    // 状，不是排版在跳。
    cmp('图示下沿', (m) => (m.hint ? { b: m.hint.y + m.hint.h } : null), ['b']);
    cmp('读数格', (m) => m.cell, ['w', 'h']);
    // 读数这一条只比**宽**，不比左沿。
    //
    // 从前两样都比。玩家 2026-09 第二轮改了口径：「左侧的三个信息栏现在没有剧
    // 中，没有左右等距」——贴左沿那一版量出来是 14px 对 66–318px，一眼就歪。改
    // 成居中在「屏幕沿到棋盘」这条空当里之后，这一条的左沿当然跟着棋盘宽走
    // （1920 上方块 166、七色圆球 96），正是上面那段注释说的「横向位置本来就跟
    // 着棋盘宽走」。宽（220）还是钉死的，换玩法不变。
    cmp('读数整条', (m) => m.hud, ['w']);
    // 换来的那件事要单独钉住：这三块读数左右两边一样宽。左边量到屏幕沿，右边
    // 量到棋盘——玩家眼里就是这两段。
    for (const one of sameVp) {
      const left = one.m.hud.x;
      const right = one.m.wrap.x - (one.m.hud.x + one.m.hud.w);
      if (Math.abs(left - right) > SAME_TOL) {
        diff.push(`${one.name} 读数左右不等距 ${left.toFixed(0)} / ${right.toFixed(0)}`);
      }
    }
    cmp('暂停键', (m) => m.btn, ['w', 'h', 'y']);
    check(
      `${tag}：换个玩法，得分图示 / 读数 / 暂停键三样一个像素不动`,
      diff.length === 0,
      diff.slice(0, 5).join('；') ||
        `读数格 ${Math.round(base.m.cell.w)}×${Math.round(base.m.cell.h)}、暂停键 ${Math.round(base.m.btn.w)}×${Math.round(base.m.btn.h)}（${sameVp.map((x) => x.name).join(' / ')}）`,
    );
  }
}

await browser.close();
console.log(fail ? `\n${fail} 项没过` : '\nALL PASS');
process.exit(fail ? 1 : 0);

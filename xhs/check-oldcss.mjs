/**
 * 样式降级层的对照台——每一屏量两遍，比给出来的排版一不一样。
 *
 *   node xhs/check-oldcss.mjs            # 全部屏
 *   node xhs/check-oldcss.mjs 主菜单     # 只跑一屏（名字见 SCREENS）
 *
 * CSS 这一层没法像 JS 那样「把接口删掉」来模拟老内核：删不掉浏览器认得 gap
 * 这件事。所以反过来——xhs/src/oldKernel.ts 留了个后门
 * （window.__SLIDES_OLD_KERNEL__），设成 true 就当所有能力都缺，整条降级路径
 * 在新浏览器上完整跑一遍。
 *
 * 于是可以这么比：
 *
 *   甲：正常渲染（浏览器自己认 gap / clamp / aspect-ratio）
 *   乙：强制走降级层（换算成 px、外边距、内边距百分比）
 *
 * 两边量同一批盒子，差得超过阈值就是降级层没给对。这不是「看着差不多」，
 * 是逐个盒子的坐标和尺寸。
 *
 * 每一屏还会顺手做两件事：
 *   · 扫一遍降级之后**还剩多少没算掉的** clamp / min / max。带百分比的算不
 *     出来（百分比要看容器多宽，那是排版排到一半才知道的事），而算不掉就等
 *     于在 Chrome 61 上被整条丢掉——这些必须一条条看过，不能让它们躲着。
 *   · 查有没有东西横着顶出屏幕。
 *
 * 量不到的：真机上的字体度量和性能。那两样只有真机说了算。
 *
 * 跑之前要先出一次包和预览页（这两个脚本读的是 xhs/preview.html，
 * 那是构建产物，不在仓库里）：
 *
 *   npm run check:xhs        ← 三步一起跑，平时用这个
 *
 * 只想单独跑这一个的话，先手动来两步：
 *
 *   npm run build:xhs && node xhs/preview.mjs
 *   node xhs/check-oldcss.mjs
 *
 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PAGE = pathToFileURL(join(here, 'preview.html')).href;

let fails = 0;
const say = (ok, text, extra = '') => {
  if (!ok) fails++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + text + (extra ? '  ' + extra : ''));
};

/** 量一批盒子：选择器 → [{x,y,w,h}, ...]，全部四舍五入到整像素。 */
const MEASURE = (sels) => {
  const out = {};
  for (const sel of sels) {
    out[sel] = [].slice.call(document.querySelectorAll(sel)).map((e) => {
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    });
  }
  return out;
};

/**
 * 会折行那种容器，它自己那个框在降级层里会宽出一整道缝——这是负外边距那套
 * 补法的必然结果（子项四周各加半道，容器四周各减半道，子项落回原位，容器的
 * 框比原来大一道）。这几个框都是透明的排版壳，没有底色也没有描边，看不见；
 * 真正要对上的是它们**里面**那些看得见的东西，那些照旧按 2px 卡。
 * 所以只放宽这几个壳自己的宽高，位置（x / y）仍然严格。
 */
const WRAP_HOSTS = [
  '.app--game .pattern-hint',
  '.app--game .controls',
  '.xhs-share-bar',
  '.slot-pick-row',
  '.shape-pick-row',
  '.btn-row',
  '.end-breakdown',
];
const isHost = (sel) => WRAP_HOSTS.some((h) => sel === h || sel.indexOf(h) >= 0);

/** 两批量测比一比。 */
function compare(label, a, b, tol) {
  let worst = 0;
  let where = '';
  let seen = 0;
  const all = [];
  for (const k of Object.keys(a)) {
    if (a[k].length !== b[k].length) {
      say(false, `${label} · ${k} 个数对不上`, `新 ${a[k].length} / 降级 ${b[k].length}`);
      continue;
    }
    seen += a[k].length;
    const host = isHost(k);
    for (let i = 0; i < a[k].length; i++) {
      for (const f of ['x', 'y', 'w', 'h']) {
        const limit = host && (f === 'w' || f === 'h') ? 70 : tol;
        const d = Math.abs(a[k][i][f] - b[k][i][f]);
        if (d <= limit) continue;
        all.push(`${k}[${i}].${f}  新 ${a[k][i][f]} / 降级 ${b[k][i][f]}  (差 ${d})`);
        if (d > worst) {
          worst = d;
          where = `${k}[${i}].${f} 新 ${a[k][i][f]} / 降级 ${b[k][i][f]}`;
        }
      }
    }
  }
  say(worst === 0, `${label}：两边排版一致（量了 ${seen} 个盒子）`, worst ? `最大差 ${worst}px @ ${where}` : '');
  if (worst) all.slice(0, 12).forEach((l) => console.log('           ' + l));
}

// ---- 各屏怎么走到 -----------------------------------------------------------

const board = () =>
  ({ sel: '#boardWrap .tile, #boardWrap .ball' });

async function toBoard(p, cardIndex, opts = {}) {
  await p.$$eval('.home-icon-btn', (e, i) => e[i].click(), cardIndex);
  await p.waitForTimeout(800);
  if (opts.pick) {
    const shape = await p.$('[data-family="square"]');
    if (shape) await shape.click();
    await p.waitForTimeout(700);
  }
  if (opts.slot) await p.waitForTimeout(9000);
  const start = await p.$('#startBtn');
  if (start) await p.$eval('#startBtn', (e) => e.click());
  await p.waitForFunction(
    () => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball').length > 0,
    { timeout: 25000 },
  );
  await p.waitForTimeout(1400);
}

/** 真拖十下再按《完成》——结算页和分享窗口只有这样才到得了。 */
async function playAndFinish(p) {
  const box = await p.$eval('.board', (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  for (let i = 0; i < 8; i++) {
    const row = 0.12 + (i % 6) * 0.15;
    await p.mouse.move(box.x + box.w * 0.5, box.y + box.h * row);
    await p.mouse.down();
    await p.mouse.move(box.x + box.w * 0.5 + (i % 2 ? 62 : -62), box.y + box.h * row, { steps: 6 });
    await p.mouse.up();
    await p.waitForTimeout(260);
  }
  await p.click('#finishBtn');
  await p.waitForTimeout(2600);
}

/**
 * 每一屏：怎么走到、量哪些盒子。
 * 选的都是**排版骨架**——版心、行、卡、按钮、图。刻意避开纯文字的盒子：
 * 两次跑的分数是随机的，字一多一少宽度就不一样，那不是降级层的错。
 */
const SCREENS = [
  {
    name: '主菜单',
    async go() {},
    sels: [
      '.home-page', '.home-grid', '.home-row', '.home-icon-btn',
      '.home-icon-art', '.home-icon-tag', '.home-head-glass', '.home-nav-dock',
    ],
  },
  {
    name: '形状选择（炸弹）',
    async go(p) {
      await p.$$eval('.home-icon-btn', (e) => e[2].click());
      await p.waitForTimeout(900);
    },
    sels: ['.app', '.start-stage', '.slot-pick-area', '.slot-pick-row', '.slot-pick-opt', '.slot-pick-opt > svg', '.start-actions', '.icon-btn.start-act'],
  },
  {
    name: '老虎机转前',
    async go(p) {
      await p.$$eval('.home-icon-btn', (e) => e[3].click());
      await p.waitForTimeout(900);
    },
    sels: ['.slot-page', '.slot-pick-row', '.slot-pick-opt', '.slot-pick-opt > svg', '.home-head-glass'],
  },
  {
    name: '无限反转开局页',
    async go(p) {
      await p.$$eval('.home-icon-btn', (e) => e[4].click());
      await p.waitForTimeout(900);
    },
    sels: ['.app', '.start-stage', '.slot-pick-area', '.slot-pick-row', '.slot-pick-opt', '.slot-pick-opt > svg', '.start-actions', '.icon-btn.start-act'],
  },
  {
    name: '开局倒数页',
    async go(p) {
      await p.$$eval('.home-icon-btn', (e) => e[0].click());
      await p.waitForTimeout(900);
    },
    sels: ['.start-stage', '.start-marks', '.start-mark', '.start-actions', '.icon-btn.start-act'],
  },
  {
    name: '游戏页',
    async go(p) {
      await toBoard(p, 0);
    },
    sels: [
      '.app--game', '.app--game .hud', '.app--game .hud-cell',
      '.app--game .controls', '.app--game .controls .icon-btn',
      '.app--game .pattern-hint', '.app--game .pattern-icon', '.board-wrap', '.board',
    ],
  },
  {
    name: '暂停面板',
    async go(p) {
      await toBoard(p, 0);
      await p.click('#stopBtn');
      await p.waitForTimeout(900);
    },
    sels: ['#pauseOverlay', '#pauseOverlay .modal', '#pauseOverlay .btn-row', '#pauseOverlay .modal button'],
  },
  {
    name: '结算页',
    async go(p) {
      await toBoard(p, 0);
      await playAndFinish(p);
    },
    sels: ['.overlay--end', '.overlay--end .modal', '.end-rule', '.end-breakdown', '.btn-row', '.btn-row button'],
  },
  {
    name: '分享窗口',
    async go(p) {
      await toBoard(p, 0);
      await playAndFinish(p);
      await p.click('#shareBtn');
      await p.waitForTimeout(2000);
    },
    sels: ['.overlay--wide', '.share-modal', '.share-modal img', '.xhs-share-host', '.xhs-share-bar', '.xhs-share-btn'],
  },
  {
    name: '成绩与说明页',
    async go(p) {
      await toBoard(p, 0);
      await playAndFinish(p);
      for (const btn of await p.$$('.endcard button, .modal button')) {
        const t = (await btn.textContent())?.trim() || '';
        if (/菜单|返回|主页/.test(t)) {
          await btn.click();
          break;
        }
      }
      await p.waitForTimeout(1400);
      if (await p.$('#xhsProfile')) await p.click('#xhsProfile');
      await p.waitForTimeout(1000);
    },
    sels: [
      '.xhs-profile', '.total-card', '.xhs-setting-row', '.xhs-cvd',
      '.records-panel--records', '.records-row', '.xhs-about', '.xhs-profile-nav',
    ],
  },
  {
    name: '怎么玩',
    async go(p) {
      if (await p.$('#xhsProfile')) await p.click('#xhsProfile');
      await p.waitForTimeout(900);
      await p.click('.xhs-how');
      await p.waitForTimeout(700);
    },
    sels: ['.xhs-tut-modal', '.xhs-tut-rules', '.xhs-tut .tut-rule', '.xhs-tut .tut-rule-art', '.xhs-tut .btn-row', '#xhsTutOk'],
  },
  {
    name: '战绩详情页',
    async go(p) {
      await toBoard(p, 0);
      await playAndFinish(p);
      for (const btn of await p.$$('.endcard button, .modal button')) {
        const t = (await btn.textContent())?.trim() || '';
        if (/菜单|返回|主页/.test(t)) {
          await btn.click();
          break;
        }
      }
      await p.waitForTimeout(1400);
      if (await p.$('#xhsProfile')) await p.click('#xhsProfile');
      await p.waitForTimeout(900);
      const rows = await p.$$('.records-row');
      if (rows.length) await rows[0].click();
      await p.waitForTimeout(1800);
    },
    sels: ['.xhs-run-sheet', '.xhs-run-body', '.xhs-run-img', '.xhs-share-bar', '.xhs-share-btn', '.page-back-row'],
  },
];

// ---- 跑 ---------------------------------------------------------------------

async function run(browser, view, screen, old) {
  const ctx = await browser.newContext({
    viewport: { width: view.w, height: view.h },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  if (old) await ctx.addInitScript('window.__SLIDES_OLD_KERNEL__ = true;');
  // 两台体检台都先把「教学看过了」这一格填上：第一次进游戏会自动弹那六条
  // 规则（xhs/src/tutorial.ts），弹出来就挡住棋盘，后面的拖动和量尺寸全做
  // 不了。这一屏本身单独测（check-oldcss 的「怎么玩」那一屏，和
  // 教学那支专门的脚本），不靠这里顺带。
  await ctx.addInitScript(`try { localStorage.setItem('slides.xhs.tutorialSeen', '1'); } catch (e) {}`);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(PAGE);
  await p.waitForSelector('.home-icon-btn', { timeout: 30000 });
  await p.waitForTimeout(700);
  await screen.go(p);

  const boxes = await p.evaluate(MEASURE, screen.sels);

  // 还剩多少没算掉的新写法（只在降级那一遍看）
  let left = [];
  if (old) {
    left = await p.evaluate(() => {
      const text = ['slides-styles', 'xhs-styles']
        .map((id) => (document.getElementById(id) || {}).textContent || '')
        .join('\n');
      const hits = text.match(/[^A-Za-z0-9_-](clamp|min|max)\([^;{}]*/g) || [];
      const uniq = {};
      for (const h of hits) uniq[h.trim().slice(0, 70)] = 1;
      return Object.keys(uniq);
    });
  }

  // 有没有东西横着顶出屏幕
  const spill = await p.evaluate(() => {
    const bad = [];
    const all = document.querySelectorAll('.app *, .modal *');
    for (let i = 0; i < all.length; i++) {
      const cs = getComputedStyle(all[i]);
      if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = all[i].getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.left < -1 || r.right > window.innerWidth + 1) {
        bad.push(
          (all[i].className.toString().split(' ')[0] || all[i].tagName) +
            ` [${Math.round(r.left)},${Math.round(r.right)}]`,
        );
      }
    }
    return bad.slice(0, 4);
  });

  await p.screenshot({
    path: join(here, '..', '.tmp-oldcss', `${view.w}-${screen.name}-${old ? 'old' : 'new'}.png`),
  }).catch(() => {});
  await ctx.close();
  return { boxes, errs, spill, left };
}

const only = process.argv[2];
const list = only ? SCREENS.filter((s) => s.name.indexOf(only) >= 0) : SCREENS;
if (!list.length) {
  console.log('没有这一屏：' + only);
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const leftovers = {};
for (const view of [
  { name: '竖屏 390×844', w: 390, h: 844 },
  { name: '横屏 844×390', w: 844, h: 390 },
]) {
  console.log('\n########  ' + view.name + '  ########');
  for (const screen of list) {
    console.log('\n---- ' + screen.name + ' ----');
    const fresh = await run(browser, view, screen, false);
    const old = await run(browser, view, screen, true);
    say(old.errs.length === 0, '降级层跑起来零报错', old.errs.slice(0, 2).join(' | '));
    compare(screen.name, fresh.boxes, old.boxes, 2);
    const newSpill = fresh.spill.join(' | ');
  say(
    old.spill.length === 0 || newSpill === old.spill.join(' | '),
    '没有东西横着顶出屏幕（降级层造成的）',
    old.spill.length ? `降级 ${old.spill.join(' | ')} ／ 正常 ${newSpill || '(无)'}` : '',
  );
    for (const l of old.left) leftovers[l] = (leftovers[l] || 0) + 1;
  }
}
await browser.close();

const leftList = Object.keys(leftovers);
console.log('\n########  降级之后还没算掉的式子  ########');
if (!leftList.length) console.log('  （没有）');
else {
  console.log('  这些带百分比或 var()，运行时算不出来，在 Chrome 61 上会被整条丢掉。');
  console.log('  用不到的屏可以不管；用得到的必须在 baseline.css 里手写一条等价的。\n');
  leftList.sort().forEach((l) => console.log('    ' + l));
}

console.log(fails ? `\n${fails} 项没过` : '\n全部通过');
process.exit(fails ? 1 : 0);

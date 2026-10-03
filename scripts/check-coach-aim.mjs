/**
 * 教学的呼吸灯，和手机端那条教学条（第 15 推重写）。
 *
 *   node scripts/dev-server.mjs 8xxx dist &
 *   node scripts/check-coach-aim.mjs http://localhost:8xxx/
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 第 15 推（玩家 2026-10-03）定的那几句，这一道逐条量：
 *
 *   · 同一时间只亮一种颜色。
 *   · 只在「再走一步就能完成这一条」时亮，只亮会参与的那几枚（包括要滑过去的那一枚）。
 *   · 走一步，那一组失效了就不再亮它（换成离手指最近的另一组，一组都没有就熄）。
 *   · 只动 filter，不加任何热区——真的拖一枚，拖动照常。
 *   · 得分图案块和外边指引带不再参与教学亮灯；小球的外边带子改成轻微闪烁（0.85–1）。
 *   · 手机端（≤999px）教学文字：字号 ≥ 原来的 2 倍，最多两行，不压住棋盘。
 *
 * ── 「亮的正好是一步能拼成的那组」怎么量 ────────────────────────────────
 *
 * 这一道自带一份**对照**：从屏幕上读出每一枚的位置、正反面、颜色（不读任何 data-id，也不
 * 问游戏自己的状态），自己把一步之内的每一种滑法走一遍，找出所有「同色连着 ≥ N 枚、碰到
 * 动过的那条线」的组，再按这一条要的那一种（全是色块 / 星星＋色块）筛一遍，映射回此刻的位
 * 置。亮着的那几枚必须**正好**是其中一组；对照一组都找不到的时候，必须一枚都不亮。
 *
 * 对照是这儿独立写的，不借游戏的 findMatches——借了就是拿被测的东西量它自己。它和游戏只
 * 共享规则本身（《侵蚀阶梯》§1.1：同色 1×N、至少一枚色块、碰到这一步动过的线）。
 *
 * 随机地真的滑几十步（小球、方块各一局），每一步结算完都对一次——开局那一副只是一种盘面，
 * 灯在翻过面、换过色的盘面上照样要对。
 *
 * ⚠️ 这一道**什么键都不许预设**（除了语言）。CLAUDE.md 里那五个坑的第四个说的就是它：预设
 * `slides_tutorial_seen` 会让 `firstTimeIn` 认成「玩过了」，教学条整个不出现——而这一道要
 * 验的正是它，屏幕上却什么都不报。
 */
import { chromium } from 'playwright';
import esbuild from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BASE = process.argv[2];
if (!BASE) {
  console.log('用法: node scripts/check-coach-aim.mjs <dev-server 地址>');
  process.exit(1);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let fails = 0;
const check = (name, ok, extra = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};
const head = (t) => console.log('\n── ' + t);
/**
 * 只跑其中几节：`COACH_AIM_ONLY=1,3 node scripts/check-coach-aim.mjs …`。整道要六七分钟，
 * 反向验证（故意改坏一处、看它红不红）一次只需要那一节。CI 不设，全跑。
 */
const ONLY = (process.env.COACH_AIM_ONLY || '').split(',').filter(Boolean);
const want = (n) => !ONLY.length || ONLY.includes(String(n));

// 五条的字从 i18n.ts 现读（和 build-legal.mjs 同一个法子）：门里抄一份的话，改了文案这儿
// 量的就是旧字。
const tmp = mkdtempSync(join(tmpdir(), 'slides-coach-aim-'));
esbuild.buildSync({
  entryPoints: [join(root, 'src', 'i18n.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: join(tmp, 'i18n.mjs'),
  logLevel: 'silent',
});
const { tutorialRules } = await import(pathToFileURL(join(tmp, 'i18n.mjs')).href);
rmSync(tmp, { recursive: true, force: true });
/** ui/coachBar.ts 的 HINT_OF：第几条亮哪一种组（第 4 条亮外边的星星，这一道不走到那儿）。 */
const HINT_OF = ['front', 'mixed', 'front', 'edge', null];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errs = [];

/** 头一回打开（什么键都不设，除了语言）→ 点轴上第 idx 张 → 开局。 */
async function openFirst({ idx, lang = 'zhHans', reduce = false, width = 390, height = 844 }) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    isMobile: width < 1000,
    hasTouch: width < 1000,
    reducedMotion: reduce ? 'reduce' : 'no-preference',
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript((l) => {
    try {
      localStorage.clear();
      localStorage.setItem('slides_lang', l);
    } catch (e) { /* 无痕模式 */ }
  }, lang);
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.mode-axis .home-icon-btn', { timeout: 30000 });
  await page.waitForTimeout(600);
  await page.evaluate((i) => document.querySelectorAll('.mode-axis > .home-icon-btn')[i].click(), idx);
  await page.waitForTimeout(900);
  if (await page.$('#startBtn')) await page.evaluate(() => document.querySelector('#startBtn').click());
  await page.waitForFunction(() => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball').length > 0, { timeout: 25000 });
  await page.waitForTimeout(500);
  return { ctx, page };
}

/**
 * 读屏（在页面里跑）：每一枚的位置、正反面、颜色、亮没亮，外加两种线、此刻几枚一组、条子
 * 上摆的是哪一句。算法在 node 这头（groupsOf）。
 */
const ORACLE = ({ shape }) => {
  const els = [...document.querySelectorAll('#boardWrap .ball[data-r][data-c], #boardWrap .tile[data-r][data-c]')];
  const probe = document.createElement('i');
  document.body.appendChild(probe);
  const norm = (c) => {
    probe.style.color = '';
    probe.style.color = c;
    return getComputedStyle(probe).color;
  };
  const at = new Map();
  for (const el of els) {
    const face = el.dataset.face;
    if (face === 'blank') continue;
    // 星星的颜色：方块挂在 data-dot-color 上，小球画在那三笔的 stroke 上。
    const color = face === 'dot'
      ? norm(el.dataset.dotColor || el.querySelector('g[stroke]')?.getAttribute('stroke') || '')
      : getComputedStyle(el).backgroundColor;
    const b = el.getBoundingClientRect();
    at.set(`${el.dataset.r},${el.dataset.c}`, {
      r: +el.dataset.r, c: +el.dataset.c, face, color,
      lit: el.classList.contains('coach-glow'),
      anim: getComputedStyle(el).animationName,
      filter: getComputedStyle(el).filter,
      x: b.left + b.width / 2, y: b.top + b.height / 2,
    });
  }
  probe.remove();
  // 线：几何上的整条（判「连着」用——中间离场了一格就断开），和此刻还在盘上的那一串（滑
  // 用——离场的格子不在线上，剩下的首尾相接）。
  const full = [];
  if (shape === 'circle') {
    const R = 7;
    for (let d = 0; d < R; d++) full.push(Array.from({ length: R - d }, (_, k) => `${d + k},${k}`));
    for (let e = 0; e < R; e++) full.push(Array.from({ length: R - e }, (_, k) => `${e + k},${e}`));
    for (let r = 0; r < R; r++) full.push(Array.from({ length: r + 1 }, (_, c) => `${r},${c}`));
  } else {
    const vals = [...at.values()];
    const rows = Math.max(...vals.map((v) => v.r)) + 1;
    const cols = Math.max(...vals.map((v) => v.c)) + 1;
    for (let r = 0; r < rows; r++) full.push(Array.from({ length: cols }, (_, c) => `${r},${c}`));
    for (let c = 0; c < cols; c++) full.push(Array.from({ length: rows }, (_, r) => `${r},${c}`));
  }
  const slide = full.map((l) => l.filter((k) => at.has(k))).filter((l) => l.length >= 2);
  const label = document.querySelector('.hud-block--pattern')?.getAttribute('aria-label') || '';
  const n = Number((label.match(/\d+/) || [4])[0]);
  const text = document.querySelector('.coach-bar .coach-text')?.textContent ?? '';
  return { at: [...at.entries()], full, slide, n, text };
};

/** 一层走完：这一种提示该亮的所有组（每组是**此刻**的格子，排好序）。 */
function groupsOf(o, kind) {
  const at = new Map(o.at);
  const groups = new Map();
  o.slide.forEach((line, li) => {
    const L = line.length;
    for (let shift = 1; shift < L; shift++) {
      // 走过这一步之后，位置 k 上的那一枚原来在哪一格。
      const src = new Map(line.map((k, i) => [k, line[(((i - shift) % L) + L) % L]]));
      const val = (k) => at.get(src.get(k) ?? k);
      const moved = new Set(line);
      for (const scan of o.full) {
        let i = 0;
        while (i < scan.length) {
          if (!at.has(scan[i])) { i++; continue; }
          const a = val(scan[i]);
          let j = i + 1;
          while (j < scan.length && at.has(scan[j]) && val(scan[j]).color === a.color) j++;
          const run = scan.slice(i, j);
          i = j;
          if (run.length < o.n || !run.some((k) => moved.has(k))) continue;
          const faces = run.map((k) => val(k).face);
          const front = faces.filter((f) => f === 'flavor').length;
          const dot = faces.length - front;
          const ok = kind === 'front' ? front > 0 && dot === 0 : kind === 'mixed' ? front > 0 && dot > 0 : false;
          if (!ok) continue;
          const cells = run.map((k) => src.get(k) ?? k).sort();
          const key = cells.join(' ');
          if (!groups.has(key)) groups.set(key, { cells, line: li, shift, color: a.color, after: run });
        }
      }
    }
  });
  return [...groups.values()];
}
const litOf = (o) => o.at.filter(([, v]) => v.lit).map(([k]) => k).sort();
const ruleOf = (o, shape) => tutorialRules('zhHans', shape).indexOf(o.text);

/**
 * 真的拖一下：从那条线上的一枚出发，沿着线的方向拖 shift 格（取近的那一头）。
 *
 * 起点挑得让终点还落在这条线上的另一枚棋子上——拖到盘外去，有的棋盘会把手指当成离开了。
 */
async function dragMove(page, o, line, shift) {
  const at = new Map(o.at);
  const cells = o.slide[line];
  const L = cells.length;
  const s = shift > L / 2 ? shift - L : shift;
  const i0 = s > 0 ? 0 : L - 1;
  const p0 = at.get(cells[i0]);
  const p1 = at.get(cells[i0 + Math.sign(s)]);
  const vx = p1.x - p0.x;
  const vy = p1.y - p0.y;
  const steps = Math.abs(s);
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  for (let k = 1; k <= 14; k++) await page.mouse.move(p0.x + (vx * steps * k) / 14, p0.y + (vy * steps * k) / 14);
  await page.mouse.up();
}
/**
 * 等这一步结算完：盘面（每一枚的面、颜色、亮不亮）连着 quietMs 一动不动。
 *
 * 正常动效下这个数要比连锁里最长的那一拍停顿还长：得分那一拍先亮 550ms 才翻（
 * HIGHLIGHT_LEAD_MS），消边之后停 1250ms（BONUS_GAP_MS）——安静 450ms 就收工的话，会在
 * 「已经滑过去、还没翻面」那一段把盘面读走，量到的是连锁中间（灯在结算期间是熄的）。第一版
 * 就是这么红的。减弱动态效果时这几段都是 0，450ms 够了。
 */
async function settle(page, shape, quietMs = 450) {
  let last = '';
  let since = Date.now();
  for (let k = 0; k < 120; k++) {
    await page.waitForTimeout(150);
    const o = await page.evaluate(ORACLE, { shape });
    const sig = JSON.stringify([o.at.map(([key, v]) => [key, v.face, v.color, v.lit]), o.text]);
    if (sig !== last) {
      last = sig;
      since = Date.now();
    } else if (Date.now() - since >= quietMs) {
      return o;
    }
  }
  return page.evaluate(ORACLE, { shape });
}
/** 正常动效那一局用的安静时长（见 settle）。 */
const QUIET_FULL_MS = 1700;

/** 一种盘面上量一次「亮的正好是一步能成的那一组」。回它属于哪一类，好数尺子。 */
function judge(o, shape, where) {
  const rule = ruleOf(o, shape);
  const kind = HINT_OF[rule] ?? null;
  const lit = litOf(o);
  const colors = new Set(o.at.filter(([, v]) => v.lit).map(([, v]) => v.color));
  if (!kind || kind === 'edge') {
    // 第 5 条不亮；第 4 条这一道不走到（要凑一整条外边的同色星星）。
    if (!kind) check(`${where}：这一条不亮灯`, lit.length === 0, lit.join(' '));
    return 'skip';
  }
  const groups = groupsOf(o, kind);
  if (!groups.length) {
    check(`${where}（第 ${rule + 1} 条，${kind}）：对照一组都找不到 → 一枚都不亮`, lit.length === 0, lit.join(' '));
    return lit.length === 0 ? 'none' : 'bad';
  }
  const match = groups.find((g) => g.cells.join(' ') === lit.join(' '));
  check(`${where}（第 ${rule + 1} 条，${kind}）：亮的正好是一步能成的其中一组`, !!match,
    `亮 [${lit.join(' ')}]，对照 ${groups.length} 组${match ? '' : '：' + groups.slice(0, 3).map((g) => '[' + g.cells.join(' ') + ']').join(' ')}`);
  check(`${where}：同一时间只亮一种颜色`, colors.size <= 1, [...colors].join(' / '));
  return match ? 'lit' : 'bad';
}

// ===========================================================================
// ① 头一局小球：灯、拖动、得分图案块和外边带子
// ===========================================================================
if (want(1)) {
  head('① 头一局小球（正常动效）：灯真的在亮、只动 filter、拖得动');
  // 开局那一副要有一组能亮——小球四色各七枚，几乎每一副都有；没有就重开一副（最多六次）。
  let page;
  let ctx;
  let o;
  let groups = [];
  for (let k = 0; k < 6; k++) {
    ({ ctx, page } = await openFirst({ idx: 1 }));
    o = await settle(page, 'circle', QUIET_FULL_MS);
    groups = groupsOf(o, 'front');
    if (groups.length) break;
    await ctx.close();
  }
  check('（尺子）开局那一副上，对照找得到一步能成的色块组', groups.length > 0, `${groups.length} 组`);
  const bar = await page.evaluate(() => {
    const b = document.querySelector('.coach-bar');
    return b ? { cls: b.className, hidden: b.hidden } : null;
  });
  check('头一回玩就有那块教学条，摆的是五条那一种（coach-bar--rules）', !!bar && !bar.hidden && /coach-bar--rules/.test(bar.cls), bar?.cls);
  check('开局摆的是第 1 条', ruleOf(o, 'circle') === 0, o.text);
  check('（尺子）得分图案此刻是 4 枚（对照按 1×4 认组）', o.n === 4, String(o.n));
  judge(o, 'circle', '开局');
  const lit = new Map(o.at.filter(([, v]) => v.lit));
  check('亮着的那几枚真的在动（glow-pulse-coach）', lit.size > 0 && [...lit.values()].every((v) => v.anim === 'glow-pulse-coach'),
    [...new Set([...lit.values()].map((v) => v.anim))].join(','));
  check('没亮的那几枚一枚都没在动', o.at.filter(([, v]) => !v.lit).every(([, v]) => v.anim === 'none'));

  // 得分图案块、外边带子：不再参与教学亮灯；带子改成轻微闪烁。
  const deco = await page.evaluate(() => {
    const cs = (sel) => {
      const el = document.querySelector(sel);
      return el ? { anim: getComputedStyle(el).animationName, filter: getComputedStyle(el).filter } : null;
    };
    // 那条闪烁的关键帧，从样式表里读出来：只认 opacity，两头 1、中间 0.85。
    let frames = null;
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch (e) { continue; }
      for (const r of rules) {
        if (r.type === CSSRule.KEYFRAMES_RULE && r.name === 'edge-band-breathe') {
          frames = [...r.cssRules].map((f) => ({ at: f.keyText, style: f.style.cssText }));
        }
      }
    }
    const stage = document.querySelector('.app--game');
    return { pattern: cs('.hud-block--pattern'), band: cs('.edge-band'), frames, aim: [...stage.classList].filter((c) => c.startsWith('coach-aim')) };
  });
  check('得分图案块不再参与教学亮灯（不动画、不加光）', !!deco.pattern && deco.pattern.anim === 'none' && deco.pattern.filter === 'none',
    JSON.stringify(deco.pattern));
  check('外边带子不再亮灯（没有 filter）', !!deco.band && deco.band.filter === 'none', JSON.stringify(deco.band));
  check('外边带子改成轻微闪烁（edge-band-breathe）', !!deco.band && deco.band.anim === 'edge-band-breathe', deco.band?.anim);
  const ops = (deco.frames || []).map((f) => Number((f.style.match(/opacity:\s*([\d.]+)/) || [])[1]));
  const onlyOpacity = (deco.frames || []).every((f) => /^opacity:\s*[\d.]+;?$/.test(f.style.trim()));
  check('闪烁只动透明度，只在 0.85 到 1 之间', !!deco.frames && onlyOpacity && Math.min(...ops) === 0.85 && Math.max(...ops) === 1,
    JSON.stringify(deco.frames));
  check('舞台上不再挂 coach-aim 那两个类', deco.aim.length === 0, deco.aim.join(' '));
  // 连着读十次，带子的透明度一直落在 0.85–1 里（真的在跑，而且没跑出范围）。
  const seen = [];
  for (let k = 0; k < 10; k++) {
    seen.push(await page.evaluate(() => Number(getComputedStyle(document.querySelector('.edge-band')).opacity)));
    await page.waitForTimeout(170);
  }
  check('带子的透明度读十次都在 0.85–1 之间，而且真的在变', seen.every((x) => x >= 0.849 && x <= 1.001) && Math.max(...seen) - Math.min(...seen) > 0.01,
    seen.map((x) => x.toFixed(3)).join(' '));

  // ── 那道光真的看得见：逐帧量亮度 ─────────────────────────────────────
  //
  // 「在动画」不等于「看得见」：玩家 2026-10 第二轮报过「呼吸灯看不清」，那一版动画照样在
  // 跑。所以量像素：把动画停在最暗（0%）和最亮（一半）两帧，各截一张亮着的那一枚外扩 26px
  // 的一圈，算平均每通道差。门槛的来历见 MEAN_MIN。
  const first = [...lit.keys()][0];
  if (first) {
    const clip = await page.evaluate((key) => {
      const [r, c] = key.split(',');
      const el = document.querySelector(`#boardWrap [data-r="${r}"][data-c="${c}"]`);
      const b = el.getBoundingClientRect();
      const M = 26;
      return { x: Math.max(0, Math.round(b.left - M)), y: Math.max(0, Math.round(b.top - M)), width: Math.round(b.width + M * 2), height: Math.round(b.height + M * 2) };
    }, first);
    const seek = (t) => page.evaluate(([ms]) => {
      let info = null;
      for (const el of document.querySelectorAll('#boardWrap .coach-glow')) {
        for (const a of el.getAnimations ? el.getAnimations() : []) {
          a.pause();
          a.currentTime = ms === null ? (a.effect.getTiming().duration || 2200) / 2 : ms;
          info = { name: a.animationName, dur: a.effect.getTiming().duration };
        }
      }
      return info;
    }, [t]);
    const px = async () => (await page.screenshot({ clip })).toString('base64');
    const info = await seek(0);
    check('（尺子）抓得到那条光的动画，停得住', !!info, info ? `${info.name} / ${info.dur}ms` : '（没抓到）');
    const dark = await px();
    await seek(null);
    const bright = await px();
    const delta = await page.evaluate(async ([a, b]) => {
      const load = (b64) => new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = 'data:image/png;base64,' + b64;
      });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const data = (img) => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        return c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      };
      const da = data(ia);
      const db = data(ib);
      if (da.length !== db.length) return null;
      let sum = 0;
      let n = 0;
      let worst = 0;
      for (let i = 0; i < da.length; i += 4) {
        for (let k = 0; k < 3; k++) {
          const d = Math.abs(da[i + k] - db[i + k]);
          sum += d;
          n++;
          if (d > worst) worst = d;
        }
      }
      return { mean: sum / n, worst };
    }, [dark, bright]);
    /*
     * 门槛 **15**（平均每通道差）。两头都量过（390×844，亮着的那一枚外扩 26px，换几副开局各
     * 量一次）：
     *
     *   · 现在这版（三层 7 / 13 / 22，奶油色）：24.7–37.0；
     *   · 从前「看不清」的那一版（单层 10px，--glow 那支微红）：5.4–8.5；
     *   · 三层但不换奶油色（浅色主题那支微红糊在暗托盘上）：1.3–2.0——几乎看不见，这正是
     *     style.css 里那一条要就地换 --glow 的原因。
     *
     * 门槛卡在两头中间、离坏值宽出一截。⚠️ 第 8 推那一道的教训照旧：门槛压在坏值底下就一
     * 条都拦不住。这个数跟着截图那一圈（外扩 26px）走，那一圈改了要重新两头量。
     */
    const MEAN_MIN = 15;
    check(`那道光真的看得见（最暗 ↔ 最亮，平均每通道差 ≥ ${MEAN_MIN}）`, !!delta && delta.mean >= MEAN_MIN,
      delta ? `平均 ${delta.mean.toFixed(2)} / 最大 ${delta.worst}（量了 ${clip.width}×${clip.height}）` : '（没量到）');
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('#boardWrap .coach-glow')) for (const a of el.getAnimations ? el.getAnimations() : []) a.play();
    });

    // ── 不加任何热区：手指落在亮着的那一枚上，碰到的就是那一枚 ─────────────
    const hit = await page.evaluate((key) => {
      const [r, c] = key.split(',');
      const el = document.querySelector(`#boardWrap [data-r="${r}"][data-c="${c}"]`);
      const b = el.getBoundingClientRect();
      const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return { same: !!top && (top === el || el.contains(top)), tag: top ? top.tagName + '.' + String(top.className.baseVal ?? top.className) : null };
    }, first);
    check('手指落在亮着的那一枚上，碰到的就是那一枚（灯没有盖一层）', hit.same, hit.tag);
    // 也不许**变大**：亮着的那几枚，紧贴着外沿（半径 + 3px）一圈八个点，一个都不许还按得到
    // 它。往外伸一圈的伪元素（::after）按中心是量不出来的——伪元素被按到时算的是它自己那一
    // 枚——可它会把手指在隔壁的按法抢过来。
    const ring = await page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll('#boardWrap .coach-glow')) {
        const b = el.getBoundingClientRect();
        const cx = b.left + b.width / 2;
        const cy = b.top + b.height / 2;
        const rr = b.width / 2 + 3;
        for (let k = 0; k < 8; k++) {
          const a = (k * Math.PI) / 4;
          const top = document.elementFromPoint(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
          if (top && (top === el || el.contains(top))) bad.push(`${el.dataset.r},${el.dataset.c}@${k * 45}°`);
        }
      }
      return bad;
    });
    check('亮着的那几枚可按的范围没有变大（外沿一圈按不到它）', ring.length === 0, ring.slice(0, 4).join(' '));
  }

  // ── 真的拖：滑那一步，正好把亮着的那一组凑成 ──────────────────────────
  const target = groupsOf(o, 'front').find((g) => g.cells.join(' ') === litOf(o).join(' '));
  check('（尺子）亮着的那一组在对照里找得到它那一步', !!target);
  if (target) {
    await dragMove(page, o, target.line, target.shift);
    const after = await settle(page, 'circle', QUIET_FULL_MS);
    const at = new Map(after.at);
    // 凑成的那一组此刻在 target.after 那几格上，而且翻成了星星——证明手势真的通过去了，滑
    // 的方向、格数也对。
    const flipped = target.after.filter((k) => at.get(k)?.face === 'dot');
    check('真的拖那一步：亮着的那一组凑成了、翻成了星星（拖动照常，灯不拦手）', flipped.length === target.after.length,
      `${flipped.length} / ${target.after.length} 枚翻了`);
    const litNow = litOf(after);
    check('那一组失效了：不再亮它', litNow.join(' ') !== target.after.slice().sort().join(' '), litNow.join(' '));
    judge(after, 'circle', '凑成之后');
  }
  await ctx.close();
}

// ===========================================================================
// ② 随机滑几十步，每一步结算完都对一次（小球、方块各一局；减弱动态效果，结算快）
// ===========================================================================
for (const [idx, shape, name] of want(2) ? [[1, 'circle', '小球'], [0, 'square', '方块']] : []) {
  head(`② ${name}：随机真滑，每一步结算完对一次`);
  const { ctx, page } = await openFirst({ idx, reduce: true });
  let o = await settle(page, shape);
  check(`（尺子）这一局真的是${name}`, await page.evaluate(() => document.querySelector('.app--game').getAttribute('data-shape')) === shape);
  const tally = { lit: 0, none: 0, bad: 0, skip: 0, moved: 0, stat: 0 };
  // 种子固定，同一副盘面每次走同一串（盘面本身是随机发的）。
  let seed = 20261003 + idx;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let step = 0; step < 26; step++) {
    const res = judge(o, shape, `${name}第 ${step} 步`);
    tally[res]++;
    // 减弱动态效果：亮着的那几枚是静止光晕（不跑动画，filter 上有 drop-shadow）。
    const litCells = o.at.filter(([, v]) => v.lit).map(([, v]) => v);
    if (litCells.length && !tally.stat) {
      tally.stat++;
      check(`${name}：减弱动态效果时是静止光晕（animation: none，filter 里有 drop-shadow）`,
        litCells.every((v) => v.anim === 'none' && /drop-shadow/.test(v.filter)), `${litCells[0].anim} / ${litCells[0].filter.slice(0, 60)}`);
    }
    // 下一步：灯亮着的时候一半的机会就滑那一步（灯指的那一步），否则随手滑一条线。
    const kind = HINT_OF[ruleOf(o, shape)];
    const groups = kind === 'front' || kind === 'mixed' ? groupsOf(o, kind) : [];
    const lit = litOf(o);
    const g = groups.find((x) => x.cells.join(' ') === lit.join(' '));
    let line;
    let shift;
    if (g && rnd() < 0.5) {
      ({ line, shift } = g);
    } else {
      line = Math.floor(rnd() * o.slide.length);
      shift = 1 + Math.floor(rnd() * Math.min(2, o.slide[line].length - 1));
      if (rnd() < 0.5) shift = o.slide[line].length - shift;
    }
    const before = JSON.stringify(o.at.map(([k, v]) => [k, v.face, v.color]));
    await dragMove(page, o, line, shift);
    o = await settle(page, shape);
    if (JSON.stringify(o.at.map(([k, v]) => [k, v.face, v.color])) !== before) tally.moved++;
    if (await page.evaluate(() => !!document.querySelector('.overlay--end.show'))) break;
  }
  check(`${name}：（尺子）真的滑动了（每一步之后盘面变了）`, tally.moved >= 15, `${tally.moved} 步动了`);
  check(`${name}：（尺子）「有组可亮」和「一组都没有」两种盘面都量到过`, tally.lit >= 2 && tally.none >= 1,
    `亮对 ${tally.lit} 次 / 该熄也熄了 ${tally.none} 次 / 不亮的那一条 ${tally.skip} 次`);
  check(`${name}：一次都没亮错`, tally.bad === 0, `${tally.bad} 次`);
  await ctx.close();
}

// ===========================================================================
// ③ 手机端：字号 ≥ 原来的 2 倍、最多两行、不压住棋盘
// ===========================================================================
//
// 「原来」是第 14 推那一版的字号，照它的两条规则算：竖屏 clamp(12.5px, 1.95vh, 15px)，横屏
// （矮于 560）clamp(11.5px, 2.9vh, 14px)。写死在这儿当尺子——哪天有人把那两条规则也改大
// 了，「两倍」就跟着水涨船高，而这一条量的是「比玩家看到的那一版大一倍」。
const baseOf = (w, h) => (w > h && h <= 560 ? Math.min(14, Math.max(11.5, 0.029 * h)) : Math.min(15, Math.max(12.5, 0.0195 * h)));
const MEASURE = async ([texts]) => {
  const bar = document.querySelector('.coach-bar');
  const txt = bar.querySelector('.coach-text');
  const art = bar.querySelector('.coach-art');
  const out = [];
  for (const t of texts) {
    txt.textContent = t;
    // 条子自己在 resize 时重量一次（ui/coachBar.ts 的 refit）——换了字之后借这一下。
    window.dispatchEvent(new Event('resize'));
    // 条子一变高，棋盘那一格就变矮，而棋盘的大小是 ResizeObserver 回头再量、再画的（不是同
    // 一拍）——当场量会把「棋盘还没缩回去」的那一帧当成压住了。等两帧再量。
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(res, 60))));
    const board = document.querySelector('#boardWrap').getBoundingClientRect();
    const cs = getComputedStyle(txt);
    const b = bar.getBoundingClientRect();
    // 几行：数字，不数盒子（手机端那一格垫了两行的最小高度，盒子永远至少两行高）。每一行
    // 那一段字一个框，纵坐标挨得近的算同一排。
    const count = () => {
      const range = document.createRange();
      range.selectNodeContents(txt);
      const tops = [...range.getClientRects()].filter((r) => r.width > 0).map((r) => r.top).sort((x, y) => x - y);
      let n = 0;
      let last = -Infinity;
      for (const t0 of tops) {
        if (t0 - last > parseFloat(getComputedStyle(txt).fontSize) / 2) n++;
        last = t0;
      }
      return n;
    };
    const lines = count();
    const font = parseFloat(cs.fontSize);
    // 收没收过头：字号是被收小了的（比样式表给的那一档小），那就再大 1px 量一次——必须
    // 摆不进两行了才对。不然就是收多了（第一版拿盒子高度数行，一路收到平时那一档）。
    let bigger = null;
    if (txt.style.fontSize) {
      const keep = txt.style.fontSize;
      txt.style.fontSize = font + 1 + 'px';
      bigger = count();
      txt.style.fontSize = keep;
    }
    out.push({
      font,
      lines,
      bigger,
      barH: Math.round(b.height),
      overlap: !(b.top >= board.bottom - 0.5 || b.bottom <= board.top + 0.5 || b.left >= board.right - 0.5 || b.right <= board.left + 0.5),
      inView: b.top >= 0 && b.bottom <= innerHeight + 0.5 && b.left >= -0.5 && b.right <= innerWidth + 0.5,
      rect: [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)],
      boardRect: [Math.round(board.left), Math.round(board.top), Math.round(board.right), Math.round(board.bottom)],
      art: getComputedStyle(art).display,
    });
  }
  return out;
};
if (want(3)) {
  head('③ 手机端（≤999px）：字号 ≥ 原来的 2 倍、最多两行、不压住棋盘');
  const zhCircle = tutorialRules('zhHans', 'circle');
  const zhSquare = tutorialRules('zhHans', 'square');
  // 中文这几句，两倍放得进两行，必须做到（小球第 4 条 46 个字，见下面）。
  const must = [
    ['第 1 条', zhCircle[0]], ['第 2 条', zhCircle[1]], ['第 3 条', zhCircle[2]], ['第 5 条', zhCircle[4]],
    ['第 4 条（方块）', zhSquare[3]],
  ];
  const { ctx, page } = await openFirst({ idx: 1 });
  for (const [w, h] of [[390, 844], [360, 640], [375, 667], [414, 896], [430, 932], [844, 390], [667, 375]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    const base = baseOf(w, h);
    const got = await page.evaluate(MEASURE, [must.map(([, t]) => t)]);
    const bad = got.map((g, i) => [must[i][0], g]).filter(([, g]) => !(g.font >= 2 * base - 0.05 && g.lines <= 2));
    check(`${w}×${h}：中文五句（小球第 4 条除外）字号 ≥ ${(2 * base).toFixed(1)}px（原来 ${base.toFixed(1)}px 的两倍），最多两行`,
      bad.length === 0,
      bad.length ? bad.map(([n, g]) => `${n} ${g.font}px ${g.lines} 行`).join('；') : got.map((g) => `${g.font}px/${g.lines}行`).join(' '));
    check(`${w}×${h}：条子不压住棋盘、整块在屏幕里`, got.every((g) => !g.overlap && g.inView),
      got.filter((g) => g.overlap || !g.inView).map((g) => `条子 ${g.rect} 棋盘 ${g.boardRect}`).join('；'));
    check(`${w}×${h}：这一档配图收起来（两倍的字和图摆不下）`, got.every((g) => g.art === 'none'), got[0].art);
    // 一行的、两行的，条子一样高：棋盘是开局量一次就钉住的，条子换条时往上长，就会长进棋盘
    // 里（横屏上量到过压住 10px）。
    const hs = got.map((g) => g.barH);
    check(`${w}×${h}：换哪一条，条子都一样高（换条时不往棋盘里长）`, Math.max(...hs) - Math.min(...hs) <= 1, hs.join(' / '));
    // 小球第 4 条：两倍摆不进两行。两行优先，字号能大多少大多少，至少不比原来小——这是方案
    // 里「两倍」和「最多两行」在长句上的冲突，等玩家拍板，这儿把实际做到的倍数印出来。
    const [long] = await page.evaluate(MEASURE, [[zhCircle[3]]]);
    check(`${w}×${h}：小球第 4 条（46 个字）两行之内、不比原来小、不压棋盘`, long.lines <= 2 && long.font >= base - 0.05 && !long.overlap && long.inView,
      `${long.font}px（原来的 ${(long.font / base).toFixed(2)} 倍）/ ${long.lines} 行 / 条子 ${long.rect} 棋盘 ${long.boardRect}`);
    // 收小了的话，必须是「两行放得下的最大那一号」：再大 1px 就三行（收到平时那一档的除外）。
    check(`${w}×${h}：小球第 4 条收到的是两行放得下的最大一号（没收过头）`,
      long.bigger === null || long.bigger > 2, `${long.font}px，再大 1px 是 ${long.bigger} 行`);
  }
  // 外语：只量「不压棋盘」；两倍与两行做到几成，印出来给玩家看（冲突清单，见决策记录）。
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  for (const lang of ['en', 'fr', 'zhHant']) {
    const texts = [...tutorialRules(lang, 'circle'), tutorialRules(lang, 'square')[3]];
    const got = await page.evaluate(MEASURE, [texts]);
    check(`390×844 ${lang}：每一句都不压住棋盘、整块在屏幕里`, got.every((g) => !g.overlap && g.inView));
    const over = got.filter((g) => g.bigger !== null && g.bigger <= 2);
    check(`390×844 ${lang}：收小了的那几句都是两行放得下的最大一号（没收过头）`, over.length === 0,
      over.map((g) => `${g.font}px 再大 1px 才 ${g.bigger} 行`).join('；'));
    console.log(`      ${lang}：` + got.map((g, i) => `${i === 5 ? '方块4' : i + 1}=${(g.font / baseOf(390, 844)).toFixed(2)}倍/${g.lines}行`).join(' '));
  }
  await ctx.close();
}
if (want(3)) {
  head('③′ 电脑端三栏不动：那一档不放大、配图还在');
  // 电脑端的主菜单不是那条轴，开局照手机那样点，再把窗口拉成电脑那么大。
  const { ctx, page } = await openFirst({ idx: 1 });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);
  const d = await page.evaluate(() => {
    const t = document.querySelector('.coach-bar .coach-text');
    return { font: parseFloat(getComputedStyle(t).fontSize), art: getComputedStyle(document.querySelector('.coach-bar .coach-art')).display };
  });
  // 电脑端那一条是 clamp(17px, 2.5vh, 23px)：900 高是 22.5px。
  check('1440×900：教学字号还是电脑端那一档（没被手机端的两倍盖掉）', Math.abs(d.font - 22.5) < 0.1, `${d.font}px`);
  check('1440×900：配图还在', d.art !== 'none', d.art);
  await ctx.close();
}

console.log(errs.length ? '\n页面报错：' + errs.slice(0, 3).join(' | ') : '\n全程零报错');
check('全程零报错', errs.length === 0);
await browser.close();
console.log(fails ? `\n${fails} 项没过` : '\n全部通过');
process.exit(fails ? 1 : 0);

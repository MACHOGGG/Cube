/**
 * 教学期间：呼吸灯指对了地方，而且**一下都不拦操作**（E23）。
 *
 *   node scripts/dev-server.mjs 8xxx dist &
 *   node scripts/check-coach-aim.mjs http://localhost:8xxx/
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么要有这一道，而且为什么它必须开浏览器
 *
 * 教学条本身那条线由 check-coach 管（纯 node、假时钟、自带小 DOM）。这一道管的是那块
 * 假 DOM 量不到的两件事：
 *
 *   ① **灯真的亮在那样东西上。** 类挂没挂得上，假 DOM 答得了；「挂上之后那个元素真的
 *      在动画」要问 `getComputedStyle(el).animationName`，而这需要真的 CSS。两处差一个
 *      选择器就会出现「类挂着、屏幕上什么都没亮」——代码看着对，玩家什么也没看见。
 *   ② **绝不拦操作。** 这是玩家 2026-09-30 点名的那一句（E23）。灯做成盖一层蒙版也能
 *      「亮」，而那一层会把手指吃掉：教学期间棋子拖不动，而且不报任何错。所以这一道
 *      **真的拖一枚棋子**，拖完看盘面变没变。
 *
 * ⚠️ 这一道**什么键都不许预设**（除了语言）。CLAUDE.md 里那五个坑的第四个说的就是
 * 它：预设 `slides_tutorial_seen` 会让 `firstTimeIn` 认成「玩过了」，教学条整个不出
 * 现——而这一道要验的正是它，屏幕上却什么都不报。
 *
 * ── 第 4 条那一步怎么验 ────────────────────────────────────────────
 *
 * 「讲到第 4 条就点亮外边指引带子」要走到那一步，得在浏览器里真的得两次分、再把侵蚀阶
 * 梯降一级——一局随机发牌里凑不出确定的路。所以这一道**不走那条路**，分工是：
 *
 *   · 哪一步挂哪个类  →  check-coach（纯 node、假时钟，逐步对一张表）
 *   · 类挂上之后真的亮不亮、亮了拦不拦手  →  这一道（手动把类挂上去量）
 *
 * 分开量而不是硬凑一局，是因为「硬凑」出来的那一局本身会变成最脆的一环：发牌一换它就
 * 红，而红的是运气不是代码。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2];
if (!BASE) {
  console.log('用法: node scripts/check-coach-aim.mjs <dev-server 地址>');
  process.exit(1);
}

let fails = 0;
const check = (name, ok, extra = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errs = [];
const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push(e.message));
// 语言钉成简体中文（文案那几条按中文量）。**除此之外一个键都不设**，见文件头。
await page.addInitScript(() => {
  try {
    localStorage.clear();
    localStorage.setItem('slides_lang', 'zhHans');
  } catch (e) { /* 无痕模式 */ }
});
await page.goto(BASE, { waitUntil: 'load' });

// ── ① 头一回打开 → 主菜单 → 点《经典小球》→ 开局，教学条在 ──────────
//
// 挑小球不挑方块：外边指引那条带子只有外边族那几副棋盘才画（方块 36 是任意整行整列都
// 能消，没有「最外边」这回事），而下面第 ④ 节要量的正是那条带子。
await page.waitForSelector('.mode-axis .home-icon-btn', { timeout: 30000 });
await page.waitForTimeout(800);
await page.evaluate(() => document.querySelectorAll('.mode-axis > .home-icon-btn')[1].click());
await page.waitForTimeout(1200);
const startBtn = await page.$('#startBtn');
check('（尺子）进到了开局页', !!startBtn);
if (startBtn) await page.evaluate(() => document.querySelector('#startBtn').click());
await page.waitForFunction(
  () => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball').length > 0,
  { timeout: 25000 },
);
await page.waitForTimeout(900);
const bar = await page.$('.coach-bar');
check('头一回玩就有那块教学条（什么键都没预设）', !!bar);
if (!bar) {
  console.log('\n条子都没出来，下面几条没有意义——先看 engine/firstPlay.ts 那一路。');
  await browser.close();
  process.exit(1);
}

const look = () => page.evaluate(() => {
  const stage = document.querySelector('.app--game');
  const texts = [...document.querySelectorAll('.coach-row')]
    .filter((r) => !r.hidden)
    .map((r) => r.querySelector('.coach-text').textContent.trim());
  const anim = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return '（没有这个元素）';
    const cs = getComputedStyle(el);
    // reduced-motion 下不跑动画，改成一发静态的 drop-shadow——两样都算「亮着」。
    return cs.animationName !== 'none' ? cs.animationName : (cs.filter !== 'none' ? 'filter:' + cs.filter : 'none');
  };
  return {
    cls: [...stage.classList].filter((c) => c.startsWith('coach-aim')),
    texts,
    pattern: anim('.hud-block--pattern'),
    band: anim('.edge-band'),
    hasBand: !!document.querySelector('.edge-band'),
  };
});

const first = await look();
check('（尺子）条子上真的摆着字', first.texts.length > 0, first.texts.join(' / ').slice(0, 60));
check('头一步点的是《得分图案》那一块', first.cls.includes('coach-aim') && !first.cls.includes('coach-aim--edge'),
  first.cls.join(' ') || '（一个都没挂）');
check('而且它**真的在亮**（算出来的样式里有动画或光晕）', first.pattern !== 'none', first.pattern);

// ── ①′ 那道光**真的看得见**：逐帧量亮度 ───────────────────────────
//
// 上面那一条只问「算出来的样式里有没有动画」——动画在跑，但光可能淡到看不见。玩家
// 2026-10 第二轮报的正是这件事：呼吸灯看不清。原因不是节奏也不是半径，是**对比**：
// `--glow` 在浅色主题下是 rgba(179, 57, 43, 0.55)，而那块牌是琥珀色、页底是米色，半透
// 明的砖红糊在暖色上，10px 一圈淡出去，离远一点只剩「那一块好像有点毛边」。
//
// 所以这一条量**像素**：把那条动画停在最暗的一帧（0%）和最亮的一帧（50%），各截一张，
// 算两张的平均差。差太小就是「在跑，但看不见」——那正是上一条拦不住的那种假绿。
//
// 截的是那一块外扩 26px 的一圈：光是 drop-shadow，画在元素**外面**，只截那一块本身量
// 到的几乎全是没变的牌面。
{
  const clip = await page.evaluate(() => {
    const el = document.querySelector('.hud-block--pattern');
    const r = el.getBoundingClientRect();
    const M = 26;
    return {
      x: Math.max(0, Math.round(r.left - M)),
      y: Math.max(0, Math.round(r.top - M)),
      width: Math.round(r.width + M * 2),
      height: Math.round(r.height + M * 2),
    };
  });
  /** 把那条光的动画停在 t 毫秒处（0 = 最暗，一半 = 最亮）。 */
  const seek = (t) => page.evaluate((ms) => {
    const el = document.querySelector('.hud-block--pattern');
    const anims = el.getAnimations ? el.getAnimations() : [];
    if (!anims.length) return null;
    const a = anims[0];
    a.pause();
    a.currentTime = ms === null ? (a.effect.getTiming().duration || 2200) / 2 : ms;
    return { name: a.animationName || '(unnamed)', dur: a.effect.getTiming().duration };
  }, t);
  const info = await seek(0);
  check('（尺子）抓得到那条光的动画，停得住', !!info, info ? `${info.name} / ${info.dur}ms` : '（没抓到）');
  const dark = (await page.screenshot({ clip })).toString('base64');
  await seek(null);
  const bright = (await page.screenshot({ clip })).toString('base64');
  /** 两张图的平均通道差（0–255）。在页面里用 canvas 解，不另装 PNG 解码器。 */
  const delta = await page.evaluate(async ([a, b, w, h]) => {
    const load = (b64) => new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = 'data:image/png;base64,' + b64;
    });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const px = (img) => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    };
    const da = px(ia), db = px(ib);
    if (da.length !== db.length) return -1;
    let sum = 0, n = 0, worst = 0;
    for (let i = 0; i < da.length; i += 4) {
      for (let k = 0; k < 3; k++) {
        const d = Math.abs(da[i + k] - db[i + k]);
        sum += d; n++;
        if (d > worst) worst = d;
      }
    }
    return { mean: sum / n, worst, w, h };
  }, [dark, bright, clip.width, clip.height]);
  /*
   * 门槛 **12**（平均每个通道差 12 级）。这个数是在这台 390×844 上**两头都量过**的：
   *
   *   · 现在这版（叠三层 7 / 13 / 22）：平均 20.9，最大 115；
   *   · 从前那版（单层 10px，玩家说「看不清」的那一版）：平均 5.6，最大 48。
   *
   * ⚠️ 第一版门槛写的是 3.0，而坏掉那一版量出来是 5.6——**门槛压在坏值底下，它一条都
   * 拦不住**：那正是这道门要补的那个洞，差点原样复刻一遍。门槛要卡在两者中间，而且离
   * 坏值宽出一截（check-mode-axis 里那条 6px 的说明写的是同一件事）。
   *
   * 这个数跟着截图的那一圈（外扩 26px）走：那一圈改大改小，平均值会跟着变，门槛也要重
   * 新两头量一遍，不要照着现在这个数挪。
   */
  const MEAN_MIN = 12;
  check(`那道光真的看得见（最暗 ↔ 最亮，平均每通道差 ≥ ${MEAN_MIN}）`,
    !!delta && delta.mean >= MEAN_MIN,
    delta && delta.mean !== undefined ? `平均 ${delta.mean.toFixed(2)} / 最大 ${delta.worst}（量了 ${delta.w}×${delta.h}）` : String(delta));
  // 量完把动画放回去，后面几条按正常的样子跑。
  await page.evaluate(() => {
    const el = document.querySelector('.hud-block--pattern');
    for (const a of (el.getAnimations ? el.getAnimations() : [])) a.play();
  });
}

// ── ② 绝不拦操作：条子亮着的时候，真的拖一枚棋子 ──────────────────
//
// 量的是**盘面变没变**，不是「拖动事件有没有发出去」。事件照常发得出去，而被一层蒙版
// 吃掉的时候，棋子一动不动——那才是玩家会遇到的样子。
/**
 * 盘面指纹：每一枚的**位置 ＋ 颜色**。
 *
 * 只记颜色不够——滑一下是把一条线上的颜色整体挪一格，DOM 里那几个节点很可能原地不动只
 * 换了样式，而有些棋盘干脆是整条线一起换位。位置和颜色一起记，挪了就一定看得出来。
 */
const fingerprint = () => page.evaluate(() =>
  [...document.querySelectorAll('#boardWrap .tile, #boardWrap .ball')]
    .map((e) => {
      const r = e.getBoundingClientRect();
      return `${Math.round(r.left)},${Math.round(r.top)}:${getComputedStyle(e).backgroundColor}:${e.className}`;
    })
    .join('|'));
/**
 * 从**一枚真的棋子**身上往右拖两格。
 *
 * 两处起手点的坑，都真的踩过：
 *
 *   · 不能从棋盘正中起手：小球那副盘的正中未必落在一枚球上（实测 elementFromPoint 打到
 *     的是 `.board` 本身），从空处起手拖不动任何东西。
 *   · 也不能认准某一枚：盘上第 0 枚是左上角那一枚，它那条线往右可能本来就推不动（这一
 *     局实测就是）。
 *
 * 两种情况量出来都是「盘面没变」，而那说的是起手点不对，不是教学条拦了手——同一个读数
 * 配两种天差地别的原因，正是这道门最容易骗到自己的地方。所以下面那个 `dragUntilMoved`
 * 换着棋子试几枚，有一枚动了就算证明了「手势通得过去」。一层蒙版拦着的话，**哪一枚都
 * 不会动**。
 */
const dragAPiece = async (nth) => {
  const at = await page.evaluate((n) => {
    const all = [...document.querySelectorAll('#boardWrap .tile, #boardWrap .ball')];
    const el = all[Math.min(n, all.length - 1)];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, step: r.width };
  }, nth);
  if (!at) return false;
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) await page.mouse.move(at.x + (k * at.step * 2) / 10, at.y);
  await page.mouse.up();
  await page.waitForTimeout(800);
  return true;
};
/** 换着棋子试，有一枚动了就算过。回传试了几枚、哪一枚动的。 */
const dragUntilMoved = async (tries = [5, 9, 2, 13, 0, 20]) => {
  const from = await fingerprint();
  for (const n of tries) {
    if (!(await dragAPiece(n))) continue;
    const now = await fingerprint();
    if (now !== from) return { moved: true, n };
  }
  return { moved: false, n: -1 };
};

const before = await fingerprint();
const box = await page.evaluate(() => {
  const b = document.querySelector('#boardWrap');
  const r = b.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
});
// 手指落在**一枚棋子**的正中：这一下碰到的必须是那一枚，不是盖在上面的什么东西。
const hit = await page.evaluate(() => {
  const el0 = document.querySelector('#boardWrap .tile, #boardWrap .ball');
  if (!el0) return null;
  const r = el0.getBoundingClientRect();
  const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return el
    ? { tag: el.tagName, cls: el.className.toString().slice(0, 60), isPiece: !!el.closest('.tile, .ball') }
    : null;
});
check('手指落在一枚棋子上，碰到的就是那一枚（不是盖在上面的一层）',
  !!hit && hit.isPiece, hit ? `${hit.tag}.${hit.cls}` : '（什么都没碰到）');

check('（尺子）盘面上真的有棋子', before.length > 0, `${before.split('|').length} 枚`);
const moved1 = await dragUntilMoved();
check('教学条亮着的时候，棋子照样拖得动（E23「绝不拦操作」）', moved1.moved,
  moved1.moved ? `第 ${moved1.n} 枚拖动了` : '挨个试过都没动');

// ── ③ 第 4 条那一支：类挂上去，带子真的亮，而且照旧不吃手势 ──────────
//
// 为什么手动挂类，见文件头。这一节量的是**接线**：选择器对不对得上、亮起来之后那条带子
// 会不会忽然开始吃手势。哪一步该挂它由 check-coach 管。
const edge = await page.evaluate(() => {
  const stage = document.querySelector('.app--game');
  stage.classList.remove('coach-aim');
  stage.classList.add('coach-aim--edge');
  const band = document.querySelector('.edge-band');
  if (!band) return { has: false };
  const cs = getComputedStyle(band);
  const pat = getComputedStyle(document.querySelector('.hud-block--pattern'));
  return {
    has: true,
    anim: cs.animationName !== 'none' ? cs.animationName : (cs.filter !== 'none' ? 'filter:' + cs.filter : 'none'),
    pe: cs.pointerEvents,
    glow: cs.getPropertyValue('--glow').trim(),
    patternOff: pat.animationName === 'none',
  };
});
check('（尺子）这一局真的画了外边指引那条带子', edge.has === true);
if (edge.has) {
  check('挂上 coach-aim--edge，带子真的亮了', edge.anim !== 'none', edge.anim);
  check('亮着的时候照旧不吃手势（pointer-events: none）', edge.pe === 'none', edge.pe);
  check('光色换成了《色卡》那支奶油（不借 --glow 那支偏红的）',
    /246|F6E2C0/i.test(edge.glow), edge.glow || '（没设）');
  check('这一支亮的时候，《得分图案》那一块灭着（两支灯互斥）', edge.patternOff === true);
}
// 带子亮着，棋子照样拖得动——「绝不拦操作」在两支灯底下都要成立。换一枚拖，免得
// 上一把刚好把这一枚推到了边上。
const moved2 = await dragUntilMoved();
check('带子亮着的时候，棋子也照样拖得动', moved2.moved,
  moved2.moved ? `第 ${moved2.n} 枚拖动了` : '挨个试过都没动');

// ── ③′ 方块那一局的第 4 条：点亮**一整行和一整列** ────────────────
//
// 第 4 条在方块那一局讲的是「任意一整行或一整列全是同色星星就消掉」（i18n 的
// TUTORIAL_RULE4 按图形换过一句）。而呼吸灯那张表里第 4 条指的是**托盘上那条外边指引带
// 子**——方块 36 没有那条带子（它没有「最外边」这回事），于是这一局**整条第 4 条一盏灯都
// 不点**：唯一一句指得到实物的话，偏偏在最需要指的那副棋盘上指了个空。
//
// 这一节另开一页、换方块那一局来量。两件事：那一行一列真的在亮；亮着照旧不吃手势。
{
  const sq = await ctx.newPage();
  sq.on('pageerror', (e) => errs.push('方块：' + e.message));
  await sq.goto(BASE, { waitUntil: 'load' });
  await sq.waitForSelector('.mode-axis .home-icon-btn', { timeout: 30000 });
  await sq.waitForTimeout(800);
  // 轴上第 0 张是方块（首玩期只有方块和小球按得开，见 check-first-play）。
  await sq.evaluate(() => document.querySelectorAll('.mode-axis > .home-icon-btn')[0].click());
  await sq.waitForTimeout(1200);
  if (await sq.$('#startBtn')) await sq.$eval('#startBtn', (el) => el.click());
  await sq.waitForFunction(() => document.querySelectorAll('#boardWrap .tile').length > 0, { timeout: 25000 });
  await sq.waitForTimeout(900);

  const lit = await sq.evaluate(() => {
    const stage = document.querySelector('.app--game');
    stage.classList.remove('coach-aim');
    stage.classList.add('coach-aim--edge');
    const anim = (el) => {
      const cs = getComputedStyle(el);
      return cs.animationName !== 'none' ? cs.animationName : (cs.filter !== 'none' ? 'filter:' + cs.filter : 'none');
    };
    const all = [...document.querySelectorAll('#boardWrap .tile')];
    const on = all.filter((e) => anim(e) !== 'none');
    const want = all.filter((e) => e.dataset.r === '2' || e.dataset.c === '2');
    return {
      shape: stage.getAttribute('data-shape'),
      hasBand: !!document.querySelector('.edge-band'),
      tiles: all.length,
      want: want.length,
      onCount: on.length,
      // 亮着的那几枚，正好就是第 3 行和第 3 列那几枚？
      exact: on.length === want.length && on.every((e) => want.includes(e)),
      name: on.length ? anim(on[0]) : 'none',
    };
  });
  check('（尺子）这一局真的是方块，而且盘上有棋子', lit.shape === 'square' && lit.tiles > 0, `${lit.shape} / ${lit.tiles} 枚`);
  check('（尺子）方块这一局没有外边指引带子（所以才要这一条）', lit.hasBand === false);
  check('（尺子）第 3 行第 3 列那几枚真的在盘上', lit.want > 0, `${lit.want} 枚`);
  check('方块的第 4 条点亮了一整行和一整列', lit.exact && lit.onCount > 0,
    `亮着 ${lit.onCount} 枚 / 该亮 ${lit.want} 枚（${lit.name}）`);

  // 亮着照旧不吃手势：E23 那一半在这一支上也要成立。换着棋子试，有一枚动了就算过。
  const fp = () => sq.evaluate(() =>
    [...document.querySelectorAll('#boardWrap .tile')]
      .map((e) => { const r = e.getBoundingClientRect(); return `${Math.round(r.left)},${Math.round(r.top)}:${getComputedStyle(e).backgroundColor}`; })
      .join('|'));
  const was = await fp();
  let moved = false;
  for (const n of [14, 8, 20, 2, 26]) {
    const at = await sq.evaluate((k) => {
      const all = [...document.querySelectorAll('#boardWrap .tile')];
      const el = all[Math.min(k, all.length - 1)];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, step: r.width };
    }, n);
    if (!at) continue;
    await sq.mouse.move(at.x, at.y);
    await sq.mouse.down();
    for (let k = 1; k <= 10; k++) await sq.mouse.move(at.x + (k * at.step * 2) / 10, at.y);
    await sq.mouse.up();
    await sq.waitForTimeout(700);
    if ((await fp()) !== was) { moved = true; break; }
  }
  check('那一行一列亮着的时候，棋子照样拖得动（E23「绝不拦操作」）', moved);
  await sq.close();
}

// ── ④ 两支灯互斥，而且条子底下那一块不在棋盘上 ────────────────────
const geom = await page.evaluate(() => {
  const b = document.querySelector('#boardWrap').getBoundingClientRect();
  const c = document.querySelector('.coach-bar').getBoundingClientRect();
  const pe = getComputedStyle(document.querySelector('.edge-band') || document.body).pointerEvents;
  return { overlap: !(c.top >= b.bottom - 1 || c.bottom <= b.top + 1), bandPE: pe };
});
check('教学条摆在棋盘外面（没压着盘）', !geom.overlap, geom.overlap ? '压上了' : '不压');
check('外边指引那条带子不吃手势（pointer-events: none）', geom.bandPE === 'none', geom.bandPE);

console.log(errs.length ? '\n页面报错：' + errs.slice(0, 3).join(' | ') : '\n全程零报错');
await browser.close();
console.log(fails ? `\n${fails} 项没过` : '\n全部通过');
process.exit(fails ? 1 : 0);

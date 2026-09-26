/**
 * 界面明暗：米白（默认）和深紫（Slides 天才才挑得动）。
 *
 *   node scripts/dev-server.mjs 8976 dist
 *   node scripts/check-theme.mjs http://localhost:8976/
 *
 * 玩家 2026-09 定的：「在个人主页中添加一个黑白系统选择，默认是白色米白的系统，
 * 如果是 slides 天才可以解锁选择暗色系统（深紫色）」。
 *
 * 这道门盯着四件真会出事的事：
 *
 *   · **手机开着深色模式，界面还得是米白的。** 样式表里深色那一块本来是跟系统走
 *     的（`@media (prefers-color-scheme: dark)`），改成权益之后必须由
 *     `data-theme="light"` 挡住它。这一条要在**开着深色模式**的浏览器里量，不然
 *     等于没量——这也是整道门为什么用 `colorScheme: 'dark'` 开上下文。
 *   · **没开通的人挑不动深紫。** 看得见（知道开通了有什么），按不动。
 *   · **权益没了就自己退回米白，但他挑的那一格要留着。** 订阅过期不该把人家的选
 *     择抹掉——重新开通当场回到深紫。
 *   · **它是一颗开关，不是一扇窗。** 玩家第二句：「简化一下，就和现在开关色盲友
 *     好模式一样，亮/暗的开关按钮」。所以量的是「按一下就换」，不是「点开→挑→
 *     关窗」；顺带量它确实用着色盲那颗开关的同一个零件。
 */
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://localhost:8976/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/** 整道门都在「系统开着深色模式」的浏览器里跑，见文件头。 */
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  colorScheme: 'dark',
});
const errs = [];
ctx.on('page', (p) => p.on('pageerror', (e) => errs.push(e.message)));

/** 一台打过一局的手机；`genius` 给了就顺便塞一张没过期的权益。 */
async function page({ genius = false, theme = null } = {}) {
  const p = await ctx.newPage();
  await p.addInitScript(
    ([g, t]) => {
      // 这段脚本**每次导航都会跑**（刷新也算）。不拦一下的话，下面那句
      // localStorage.clear() 会在刷新时把玩家刚挑的那一套一起抹掉——于是
      // 「刷新之后还记得」那一条量的其实是这道门自己，不是代码。
      if (sessionStorage.getItem('gate_primed') === '1') return;
      sessionStorage.setItem('gate_primed', '1');
      localStorage.clear();
      localStorage.setItem('slides_lang', 'zhHans');
      localStorage.setItem('slides_intro_seen', '1');
      localStorage.setItem('slides_played_square', '1');
      if (t) localStorage.setItem('slides_theme', t);
      if (g) {
        localStorage.setItem(
          'slides_genius',
          JSON.stringify({ active: true, period: 'year', until: Date.now() + 30 * 864e5, channel: 'code' }),
        );
      }
    },
    [genius, theme],
  );
  await p.goto(BASE, { waitUntil: 'load' });
  await p.waitForSelector('.home-page', { timeout: 20000 });
  await p.waitForTimeout(400);
  return p;
}

/** 现在画出来的是哪一套：属性、底色、以及棋盘那块底板。 */
const look = (p) =>
  p.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const v = (k) => cs.getPropertyValue(k).trim();
    return {
      attr: document.documentElement.getAttribute('data-theme'),
      bg: v('--bg'),
      ink: v('--ink'),
      panel: v('--play-panel'),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      stored: localStorage.getItem('slides_theme'),
    };
  });

/** 走到个人主页（底排左半边那颗）。 */
async function toProfile(p) {
  await p.evaluate(() => {
    document.querySelector('.home-nav-btn')?.click();
  });
  await p.waitForSelector('#themeRow', { timeout: 10000 });
  await p.waitForTimeout(250);
}

/** 那颗开关现在是什么样。 */
const sw = (p) =>
  p.evaluate(() => {
    const el = document.querySelector('#themeRow');
    const knob = el.querySelector('.pill-switch');
    return {
      label: el.querySelector('.profile-row-label')?.textContent?.trim() || '',
      role: el.getAttribute('role'),
      checked: el.getAttribute('aria-checked'),
      disabled: el.getAttribute('aria-disabled'),
      lock: !!el.querySelector('.profile-row-glyph--lock'),
      inGenius: !!el.closest('.genius-panel'),
      hasSwitch: !!knob,
      // 和色盲那颗是不是同一个零件：同样的类名、同样的轨道尺寸。
      track: knob ? `${Math.round(knob.getBoundingClientRect().width)}×${Math.round(knob.getBoundingClientRect().height)}` : '',
      cvdTrack: (() => {
        const k = document.querySelector('#cvdRow .pill-switch');
        return k ? `${Math.round(k.getBoundingClientRect().width)}×${Math.round(k.getBoundingClientRect().height)}` : '';
      })(),
      knobX: knob ? getComputedStyle(knob.querySelector('.pill-switch-knob')).translate : '',
    };
  });

// ── 1. 系统开着深色，界面还是米白 ───────────────────────────────────
{
  const p = await page();
  const l = await look(p);
  check('系统深色模式下，默认还是米白那一套', l.attr === 'light' && /F5EDDA/i.test(l.bg), `data-theme=${l.attr} --bg=${l.bg}`);
  check('底色真的画成了米白（不是只有属性对）', l.bodyBg === 'rgb(250, 246, 236)', l.bodyBg);
  // 这一条是「属性真的在挡系统偏好」的反证：属性一摘，深色那块媒体查询就该接管。
  const off = await p.evaluate(() => {
    document.documentElement.removeAttribute('data-theme');
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    document.documentElement.setAttribute('data-theme', 'light');
    return bg;
  });
  check('摘掉属性就会变深（说明刚才那一条不是白给的）', /1E1820/i.test(off), off);
  await p.close();
}

// ── 2. 个人主页上那颗开关 ──────────────────────────────────────────
{
  const p = await page();
  await toProfile(p);
  const w = await sw(p);
  check('个人主页上有《深色界面》', w.label === '深色界面', w.label);
  check('它是一颗开关（role=switch + 那个拨钮）', w.role === 'switch' && w.hasSwitch, `role=${w.role} 拨钮=${w.hasSwitch}`);
  check('和色盲那颗是同一个零件（一样大）', w.track === w.cvdTrack && w.track !== '', `${w.track} / ${w.cvdTrack}`);
  check('它排在天才特供那一块里', w.inGenius);
  check('没开通的时候行首挂着锁', w.lock);
  check('页面上没有挑选窗那一套了（点开→挑→关窗）', await p.evaluate(() => !document.querySelector('.pal-modal')));
  await p.close();
}

// ── 3. 没开通：拨不动，但按下去有去处 ─────────────────────────────
{
  const p = await page();
  await toProfile(p);
  const before = await sw(p);
  check('没开通时开关是关着的', before.checked === 'false', `aria-checked=${before.checked}`);
  check('没开通时标着拨不动', before.disabled === 'true', `aria-disabled=${before.disabled}`);
  await p.evaluate(() => document.querySelector('#themeRow').click());
  await p.waitForTimeout(400);
  const l = await look(p);
  const after = await sw(p);
  check('按一下也不会偷偷变深', l.attr === 'light' && l.stored !== 'dark', `data-theme=${l.attr} 存的=${l.stored}`);
  check('开关也没跟着拨过去', after.checked === 'false', `aria-checked=${after.checked}`);
  /**
   * 按下去不是「没反应」：和这一段里别的锁着的几行一样，带他去开通那一页。
   *
   * 认的是那扇窗里的**价目行**（`.plan-row`，订阅窗独有），不是「页面上有没有一
   * 层 overlay」——后者随便哪个弹窗都算数，等于没量。
   */
  const opened = await p.evaluate(() => ({
    rows: document.querySelectorAll('.overlay .plan-row').length,
    any: document.querySelectorAll('.overlay').length,
  }));
  check('按下去开的是《成为 Slides 天才》那扇窗', opened.rows >= 1, `价目行 ${opened.rows} 条 / 弹层 ${opened.any} 个`);
  await p.close();
}

// ── 4. 天才：按一下就换，再按一下换回来，刷新还记得 ────────────────
{
  const p = await page({ genius: true });
  await toProfile(p);
  check('天才这颗没有锁', (await sw(p)).lock === false);
  check('天才这颗拨得动', (await sw(p)).disabled === null);
  await p.evaluate(() => document.querySelector('#themeRow').click());
  await p.waitForTimeout(350);
  let l = await look(p);
  let w = await sw(p);
  check('拨一下当场变深紫', l.attr === 'dark' && /1E1820/i.test(l.bg), `data-theme=${l.attr} --bg=${l.bg}`);
  check('开关自己也拨过去了', w.checked === 'true', `aria-checked=${w.checked}`);
  check('拨钮真的挪到了右边', /19px/.test(w.knobX), w.knobX);
  // 再按一下要回得来——开关最要紧的一半是「拨得回去」。
  await p.evaluate(() => document.querySelector('#themeRow').click());
  await p.waitForTimeout(350);
  l = await look(p);
  check('再拨一下回到米白', l.attr === 'light' && /F5EDDA/i.test(l.bg), `data-theme=${l.attr} --bg=${l.bg}`);
  await p.evaluate(() => document.querySelector('#themeRow').click());
  await p.waitForTimeout(350);
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('.home-page', { timeout: 20000 });
  await p.waitForTimeout(400);
  l = await look(p);
  check('刷新之后还是深紫', l.attr === 'dark', `data-theme=${l.attr}`);
  await p.close();
}

// ── 5. 权益没了：退回米白，但他挑的那一格留着 ──────────────────────
{
  const p = await page({ genius: false, theme: 'dark' });
  const l = await look(p);
  check('订阅过期（或换了台没登录的设备）就退回米白', l.attr === 'light', `data-theme=${l.attr}`);
  check('他挑的那一格没被抹掉（重新开通就回来）', l.stored === 'dark', String(l.stored));
  await p.close();
  const p2 = await page({ genius: true, theme: 'dark' });
  const l2 = await look(p2);
  check('重新开通，深紫当场回来', l2.attr === 'dark', `data-theme=${l2.attr}`);
  await p2.close();
}

// ── 6. 开关映的是真的状态；棋盘那块底板两套都一样 ──────────────────
{
  const p = await page({ genius: true, theme: 'dark' });
  await toProfile(p);
  const w = await sw(p);
  // 进来时就该是「开着」的：开关最容易出的错是「状态只在拨的那一下对，重进一
  // 次又回到默认」——那样玩家看到的是界面深着、开关关着。
  check('深色开着的时候，重进个人主页开关也是开着的', w.checked === 'true', `aria-checked=${w.checked}`);
  const panel = await p.evaluate(() => {
    const root = document.documentElement;
    const keep = root.getAttribute('data-theme');
    const out = {};
    for (const t of ['light', 'dark']) {
      root.setAttribute('data-theme', t);
      out[t] = getComputedStyle(root).getPropertyValue('--play-panel').trim();
    }
    root.setAttribute('data-theme', keep);
    return out;
  });
  check(
    '棋盘那块底板两套都一样（换的只是界面）',
    panel.light === panel.dark && /3D3128/i.test(panel.light),
    `${panel.light} / ${panel.dark}`,
  );
  await p.close();
}

// ---- 第一帧就是对的那一套（不许再闪那一下） ----------------------------------
//
// index.html 上那句 `data-theme="light"` 管的是一半：**没挑过深紫的人不许闪一下深
// 紫**（深紫是要花钱才有的东西）。代价是反过来那一半——真正付了钱、自己挑了深紫的
// 人，从前每次刷新都先看到米白再跳深紫。实测过那一闪：正常网速 55ms（2 帧），CPU
// 降速 3 倍 140ms（3 帧），而那还是 JS 已经在本地、没有网络下载的情况。
//
// 现在 <head> 里那一小段脚本读 `slides_theme_paint`（engine/themePref.ts 上一次
// **真正画出来**那一套）把第一帧定下来。所以这一节两头都要量，缺一条就是修好一头
// 坏了另一头：
//   · 付了钱挑深紫 → 刷新之后**一帧米白都没有**；
//   · 没付钱挑过深紫 → 刷新之后**一帧深紫都没有**。
{
  /** 从第一帧起逐帧记 data-theme。刷新之后这一份要重新装（addInitScript 每次导航都跑）。 */
  const sample = () => {
    window.__themeFrames = [];
    const tick = () => {
      window.__themeFrames.push(document.documentElement.getAttribute('data-theme'));
      if (window.__themeFrames.length < 400) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  for (const [label, genius, wantFirst] of [['付了钱', true, 'dark'], ['没付钱', false, 'light']]) {
    const p = await ctx.newPage();
    await p.addInitScript(
      (g) => {
        if (sessionStorage.getItem('gate_primed') !== '1') {
          sessionStorage.setItem('gate_primed', '1');
          localStorage.clear();
          localStorage.setItem('slides_lang', 'zhHans');
          localStorage.setItem('slides_intro_seen', '1');
          localStorage.setItem('slides_played_square', '1');
          localStorage.setItem('slides_theme', 'dark'); // 两边都挑了深紫
          if (g) {
            localStorage.setItem(
              'slides_genius',
              JSON.stringify({ active: true, period: 'year', until: Date.now() + 30 * 864e5, channel: 'code' }),
            );
          }
        }
      },
      genius,
    );
    await p.addInitScript(sample);
    // 第一次打开：这一次本来就还没有那一格，允许闪。它的作用是把那一格写出来。
    await p.goto(BASE, { waitUntil: 'load' });
    await p.waitForSelector('.home-page', { timeout: 20000 });
    await p.waitForTimeout(500);
    const painted = await p.evaluate(() => localStorage.getItem('slides_theme_paint'));
    check(
      `${label}：那一格记下的是**实际画出来**的那一套`,
      painted === wantFirst,
      `slides_theme_paint = ${painted}（该是 ${wantFirst}）`,
    );
    // 刷新——这才是玩家天天遇到的那一次。
    await p.reload({ waitUntil: 'load' });
    await p.waitForSelector('.home-page', { timeout: 20000 });
    await p.waitForTimeout(500);
    const f = await p.evaluate(() => window.__themeFrames || []);
    // 先立住尺子：真的逐帧量到了。量不到几帧的话下面两条是真空的。
    check(`${label}：逐帧量到了（下面两条才有意义）`, f.length > 3, `${f.length} 帧`);
    check(`${label}：刷新之后第一帧就是 ${wantFirst}`, f[0] === wantFirst, `第一帧 ${f[0]}`);
    check(
      wantFirst === 'dark'
        ? '付了钱：全程一帧米白都没有（那一闪没了）'
        : '没付钱：全程一帧深紫都没有（花钱才有的东西不许先给他看）',
      wantFirst === 'dark' ? f.every((v) => v === 'dark') : f.every((v) => v !== 'dark'),
      `${[...new Set(f)].join(' / ')}`,
    );
    await p.close();
  }
}

console.log(errs.length ? '\n页面报错：' + errs.slice(0, 3).join(' | ') : '\n全程零报错');
await browser.close();
process.exit(fail ? 1 : 0);

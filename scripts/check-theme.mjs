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
 *   · **窗口里那两条色带和真的样式不能走散。** 色带是 themePref 里的一份常量，样
 *     式在 style.css 的两块 `:root` 里；两处写同一组颜色，迟早有人只改一边。所以
 *     这儿把属性真的盖上去，读 getComputedStyle 拿到的四支，和窗口里画出来的逐支
 *     比。
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

/** 打开个人主页 → 点开《界面明暗》那一行。 */
async function openPicker(p) {
  await p.evaluate(() => {
    document.querySelector('.home-nav-btn')?.click();
  });
  await p.waitForSelector('#themeRow', { timeout: 10000 });
  await p.evaluate(() => document.querySelector('#themeRow').click());
  await p.waitForSelector('.pal-modal .pal-opt', { timeout: 10000 });
  await p.waitForTimeout(250);
}

// ── 1. 系统开着深色，界面还是米白 ───────────────────────────────────
{
  const p = await page();
  const l = await look(p);
  check('系统深色模式下，默认还是米白那一套', l.attr === 'light' && /FAF6EC/i.test(l.bg), `data-theme=${l.attr} --bg=${l.bg}`);
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

// ── 2. 个人主页那一行 ───────────────────────────────────────────────
{
  const p = await page();
  await p.evaluate(() => document.querySelector('.home-nav-btn')?.click());
  await p.waitForSelector('#themeRow', { timeout: 10000 });
  const row = await p.evaluate(() => {
    const el = document.querySelector('#themeRow');
    return {
      label: el.querySelector('.profile-row-label')?.textContent?.trim() || '',
      lock: !!el.querySelector('.profile-row-glyph--lock'),
      inGenius: !!el.closest('.genius-panel'),
    };
  });
  check('个人主页上有《界面明暗》这一行', row.label === '界面明暗', row.label);
  check('它排在天才特供那一块里', row.inGenius);
  check('没开通的时候行首挂着锁', row.lock);
  await p.close();
}

// ── 3. 没开通：看得见，深紫按不动 ──────────────────────────────────
{
  const p = await page();
  await openPicker(p);
  const opts = await p.evaluate(() =>
    [...document.querySelectorAll('.pal-modal .pal-opt')].map((el) => ({
      v: el.dataset.themeOpt,
      name: el.querySelector('.pal-name')?.textContent?.trim() || '',
      disabled: el.disabled,
      on: el.classList.contains('pal-opt--on'),
      strip: [...el.querySelectorAll('.pal-strip span')].map((s) => getComputedStyle(s).backgroundColor),
    })),
  );
  check('窗口里就两条：米白和深紫', opts.length === 2 && opts[0].name === '米白' && opts[1].name === '深紫', opts.map((o) => o.name).join(' / '));
  check('米白那条按得动（他本来就用着它）', opts[0].disabled === false);
  check('深紫那条锁着', opts[1].disabled === true);
  check('打勾的是米白', opts[0].on === true && opts[1].on === false);
  check('窗口里有一颗《成为 Slides 天才》', await p.evaluate(() => !!document.querySelector('#themeGo')));
  // 按不动就是按不动：强行点一下，界面不能变。
  await p.evaluate(() => document.querySelector('.pal-opt[data-theme-opt="dark"]')?.click());
  await p.waitForTimeout(250);
  const l = await look(p);
  check('硬点深紫也不生效', l.attr === 'light' && l.stored !== 'dark', `data-theme=${l.attr} 存的=${l.stored}`);
  await p.close();
}

// ── 4. 天才：点了当场就变，刷新还记得 ──────────────────────────────
{
  const p = await page({ genius: true });
  await openPicker(p);
  const both = await p.evaluate(() =>
    [...document.querySelectorAll('.pal-modal .pal-opt')].map((el) => el.disabled),
  );
  check('天才两条都按得动', both.every((d) => d === false), both.join(' / '));
  await p.evaluate(() => document.querySelector('.pal-opt[data-theme-opt="dark"]').click());
  await p.waitForTimeout(300);
  let l = await look(p);
  check('点深紫当场变深紫', l.attr === 'dark' && /1E1820/i.test(l.bg), `data-theme=${l.attr} --bg=${l.bg}`);
  check('外面那一行跟着写上「深紫」', await p.evaluate(() => /深紫/.test(document.querySelector('#themeRow .profile-row-value')?.textContent || '')));
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

// ── 6. 色带和真的样式不许走散 ───────────────────────────────────────
{
  const p = await page({ genius: true });
  await openPicker(p);
  const cmp = await p.evaluate(() => {
    const root = document.documentElement;
    const keep = root.getAttribute('data-theme');
    const strips = {};
    for (const el of document.querySelectorAll('.pal-modal .pal-opt')) {
      strips[el.dataset.themeOpt] = [...el.querySelectorAll('.pal-strip span')].map(
        (s) => getComputedStyle(s).backgroundColor,
      );
    }
    const real = {};
    for (const t of ['light', 'dark']) {
      root.setAttribute('data-theme', t);
      const cs = getComputedStyle(root);
      // 拿一个临时的盒子把十六进制换算成 rgb()，好和色带那几个值直接比。
      const probe = document.createElement('span');
      document.body.appendChild(probe);
      real[t] = ['--bg', '--surface', '--ink', '--accent'].map((k) => {
        probe.style.backgroundColor = cs.getPropertyValue(k).trim();
        return getComputedStyle(probe).backgroundColor;
      });
      probe.remove();
    }
    const panel = {};
    for (const t of ['light', 'dark']) {
      root.setAttribute('data-theme', t);
      panel[t] = getComputedStyle(root).getPropertyValue('--play-panel').trim();
    }
    root.setAttribute('data-theme', keep);
    return { strips, real, panel };
  });
  for (const t of ['light', 'dark']) {
    check(
      `${t === 'light' ? '米白' : '深紫'}那条色带和样式表一致`,
      JSON.stringify(cmp.strips[t]) === JSON.stringify(cmp.real[t]),
      `窗口 ${cmp.strips[t].join(' ')} / 样式 ${cmp.real[t].join(' ')}`,
    );
  }
  // 窗口里那句话说「棋盘那块底板不跟着变」——它得是真的。
  check(
    '棋盘那块底板两套都一样（窗口里那句话是真的）',
    cmp.panel.light === cmp.panel.dark && /3D3128/i.test(cmp.panel.light),
    `${cmp.panel.light} / ${cmp.panel.dark}`,
  );
  await p.close();
}

console.log(errs.length ? '\n页面报错：' + errs.slice(0, 3).join(' | ') : '\n全程零报错');
await browser.close();
process.exit(fail ? 1 : 0);

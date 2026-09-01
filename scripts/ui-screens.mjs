/**
 * 把玩家看得到的每一屏抓下来，喂给界面模拟器。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8815 dist
 *   node scripts/ui-screens.mjs http://localhost:8815 design/screens.json
 *
 * 和 ui-snapshot.mjs 是同一套手法（真浏览器跑真页面，端走 DOM 和 CSS），
 * 区别在于产物：那个是给设计画布出 artboard，一屏一份、各自带一整套 CSS；
 * 这个出的是一份 JSON——CSS 只留一份，十几屏共用，因为它们本来就共用。
 *
 * 抓的时候有几件事绕不开，都写在各屏的 go 里了：游戏页要真的开一局才有棋盘，
 * 结算页要真的打完，分享图要等画布画完。这些状态没法凭空造，只能走一遍。
 */
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const base = (process.argv[2] || 'http://localhost:8815').replace(/\/$/, '');
const out = process.argv[3] || 'design/screens.json';

const FONTS = [
  ['Fraunces', '100 900', 'src/assets/fonts/fraunces-latin-var.woff2'],
  ['Karla', '200 800', 'src/assets/fonts/karla-latin-var.woff2'],
  ['JetBrains Mono', '100 800', 'src/assets/fonts/jetbrains-mono-latin-var.woff2'],
];

/** 开一局：从主菜单点第 n 个基础玩法，等棋盘出来。
 *  开局页现在是 3、2、1 数完自己开局的，那颗 #startBtn 藏在后面不给点——抓图
 *  不必陪着等三秒，直接替它按下去。 */
const play = (n) => async (page) => {
  await page.$$eval('.home-icon-btn', (els, i) => els[i].click(), n);
  await page.waitForSelector('#startBtn', { timeout: 15000, state: 'attached' });
  await page.$eval('#startBtn', (el) => el.click());
  await page.waitForFunction(
    () => document.querySelectorAll('#boardWrap .ball, #boardWrap .tile, #boardWrap .tri').length > 0,
    { timeout: 20000 },
  );
  await page.waitForTimeout(1200);
};

/** 个人主页里的一颗按钮。 */
const fromProfile = (id, wait = 700) => async (page) => {
  await page.click('#navProfile');
  await page.waitForTimeout(500);
  await page.click(id);
  await page.waitForTimeout(wait);
};

const SCREENS = [
  { id: 'menu', name: '主菜单', group: '进门', w: 390, h: 844 },
  { id: 'menuDesktop', name: '主菜单 · 电脑', group: '进门', w: 1440, h: 900 },
  { id: 'account', name: '个人主页', group: '进门', w: 390, h: 844, go: async (p) => {
    await p.click('#navProfile'); await p.waitForTimeout(700);
  } },
  { id: 'records', name: '记录与排名', group: '进门', w: 390, h: 844, go: async (p) => {
    await p.click('#navRecords'); await p.waitForTimeout(700);
  } },

  { id: 'gameSquare', name: '游戏中 · 方块', group: '玩', w: 390, h: 844, go: play(0) },
  { id: 'gameCircle', name: '游戏中 · 圆球', group: '玩', w: 390, h: 844, go: play(1) },
  { id: 'gameTriangle', name: '游戏中 · 三角', group: '玩', w: 390, h: 844, go: play(2) },
  { id: 'gameLandscape', name: '游戏中 · 横屏', group: '玩', w: 844, h: 390, go: play(0) },
  { id: 'gameStart', name: '开局页', group: '玩', w: 390, h: 844, go: async (p) => {
    await p.$$eval('.home-icon-btn', (els) => els[0].click());
    await p.waitForSelector('#startOverlay.show', { timeout: 15000 });
    await p.waitForTimeout(600);
  } },
  { id: 'gamePause', name: '暂停', group: '玩', w: 390, h: 844, go: async (p) => {
    await play(0)(p);
    await p.click('#stopBtn');
    await p.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
    await p.waitForTimeout(500);
  } },
  { id: 'gameEnd', name: '结算', group: '玩', w: 390, h: 844, go: async (p) => {
    await play(0)(p);
    await p.click('#finishBtn');
    await p.waitForSelector('#endOverlay.show', { timeout: 10000 });
    await p.waitForTimeout(1200);
  } },
  { id: 'gameShare', name: '分享战绩', group: '玩', w: 390, h: 844, go: async (p) => {
    await play(0)(p);
    await p.click('#finishBtn');
    await p.waitForSelector('#endOverlay.show', { timeout: 10000 });
    await p.click('#shareBtn');
    await p.waitForSelector('#shareOverlay.show', { timeout: 10000 });
    // 战绩图是画在 canvas 上再转成图片的，没画完抓下来是一张空图。
    await p.waitForFunction(() => document.getElementById('shareImage')?.naturalWidth > 0,
      { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(600);
  } },

  { id: 'genius', name: '成为 Slides 天才', group: '账号与订阅', w: 390, h: 844,
    go: fromProfile('#becomeGeniusBtn', 900) },
  { id: 'insider', name: 'Slides 天才内部码', group: '账号与订阅', w: 390, h: 844,
    go: fromProfile('#insiderRow', 900) },
  { id: 'rules', name: '游戏规则', group: '账号与订阅', w: 390, h: 844,
    go: fromProfile('#rulesRow', 900) },
  { id: 'iconPicker', name: '更换图标', group: '账号与订阅', w: 390, h: 844,
    go: fromProfile('#iconRow', 900) },
  { id: 'lang', name: '切换语言', group: '账号与订阅', w: 390, h: 844,
    go: fromProfile('#langRow', 900) },

  { id: 'multiplayer', name: '多人游玩', group: '多人', w: 390, h: 844,
    go: async (p) => {
      await fromProfile('#multiRow', 900)(p);
      const msg = await p.$('#mpMsg');
      if (msg) await p.evaluate(() => { document.querySelector('#mpMsg').textContent = ''; });
    } },

  { id: 'tutorial', name: '新手教学', group: '教学', w: 390, h: 844, go: async (p) => {
    await fromProfile('#howToRow', 800)(p);
    // 教学入口是个形状选择器；挑第一个，等第一帧画出来。
    const pick = await p.$('.center-pick button, .picker-card, .home-icon-btn');
    if (pick) { await pick.click(); await p.waitForTimeout(2500); }
  } },
];

async function fontFaces() {
  const out = [];
  for (const [family, weight, file] of FONTS) {
    const b64 = (await readFile(file)).toString('base64');
    out.push(
      `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};` +
        `font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2-variations');}`,
    );
  }
  return out.join('\n');
}

/** 页面上所有 CSS 规则，原样抄一份。全部屏共用这一份。 */
const collectCss = () =>
  Array.from(document.styleSheets)
    .map((s) => {
      try { return Array.from(s.cssRules).map((r) => r.cssText).join('\n'); } catch { return ''; }
    })
    .join('\n');

/** 按元素名写的规则，抄一份给「拆开的嵌套按钮」。见 ui-snapshot.mjs 的说明。 */
const mirrorButtonRules = () => {
  const out = [];
  const swap = (sel) => sel.replace(/\bbutton\b/g, ':where([data-was-button])');
  const walk = (rules) => {
    for (const r of rules) {
      if (r.selectorText) {
        if (/\bbutton\b/.test(r.selectorText)) out.push(r.cssText.replace(r.selectorText, swap(r.selectorText)));
      } else if (r.cssRules) {
        const prelude = r.cssText.slice(0, r.cssText.indexOf('{'));
        const inner = [];
        for (const c of r.cssRules) {
          if (c.selectorText && /\bbutton\b/.test(c.selectorText)) {
            inner.push(c.cssText.replace(c.selectorText, swap(c.selectorText)));
          }
        }
        if (inner.length) out.push(`${prelude}{\n${inner.join('\n')}\n}`);
      }
    }
  };
  for (const sheet of document.styleSheets) { try { walk(sheet.cssRules); } catch { /* 读不到就算了 */ } }
  return out.join('\n');
};

/** DOM 里的「按钮套按钮」序列化之后会被解析器拆散，先换成 div。 */
const unnestButtons = () => {
  const nested = Array.from(document.querySelectorAll('button button')).reverse();
  for (const btn of nested) {
    const div = document.createElement('div');
    for (const a of btn.attributes) div.setAttribute(a.name, a.value);
    div.setAttribute('role', 'button');
    div.setAttribute('data-was-button', '');
    div.innerHTML = btn.innerHTML;
    btn.replaceWith(div);
  }
  return nested.length;
};

const collectBody = () => {
  const clone = document.body.cloneNode(true);
  for (const el of clone.querySelectorAll('script, .splash, .loading-screen')) el.remove();
  return {
    html: clone.innerHTML,
    height: Math.ceil(Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)),
  };
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let css = '';
let mirrored = '';
const screens = [];

for (const screen of SCREENS) {
  const ctx = await browser.newContext({
    viewport: { width: screen.w, height: screen.h },
    deviceScaleFactor: 2,
  });
  await ctx.addInitScript(() => {
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_tutorial_seen', '1');
    localStorage.setItem('slides_tutorial_seen_circle', '1');
    localStorage.setItem('slides_tutorial_seen_triangle', '1');
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  [${screen.id} 报错] ${e.message}`));
  try {
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForSelector('.home-page', { timeout: 20000 });
    await page.waitForTimeout(1200);
    if (screen.go) await screen.go(page);
    await page.evaluate(unnestButtons);
    if (!css) {
      css = await page.evaluate(collectCss);
      mirrored = await page.evaluate(mirrorButtonRules);
    }
    const { html, height } = await page.evaluate(collectBody);
    screens.push({ ...screen, go: undefined, h: Math.max(screen.h, height), html });
    console.log(`${screen.id.padEnd(16)} ${screen.w}×${Math.max(screen.h, height)}  ${(html.length / 1024).toFixed(0)} KB`);
  } catch (err) {
    console.log(`${screen.id.padEnd(16)} 抓不到：${String(err).split('\n')[0].slice(0, 90)}`);
  }
  await ctx.close();
}
await browser.close();

await mkdir(path.dirname(out), { recursive: true });
await writeFile(
  out,
  JSON.stringify({ css: `${await fontFaces()}\n${css}\n${mirrored}`, screens }, null, 0),
  'utf-8',
);
const bytes = (await readFile(out)).length;
console.log(`\n${screens.length} 屏 -> ${out}  ${(bytes / 1024 / 1024).toFixed(1)} MB`);

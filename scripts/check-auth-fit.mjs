/**
 * 《注册 / 登录》那扇窗**装得下，而且说的是人话**。
 *
 *   GENIUS_GRANT_WINDOW=1 node scripts/dev-server.mjs 8835 dist &
 *   node scripts/check-auth-fit.mjs http://localhost:8835/
 *
 * ── 和 check-signin-ui 的分工 ──────────────────────────────────
 *
 * 那一道管的是**行为**：三态切换走不走得通、mailDown 停在哪一屏、真注册出不出一个账号。
 * 这一道管的是**排版和字**，而且四种语言、两档屏幕各走一遍——那正是上一道走不到的地方：
 * 它只跑简体中文、只跑一档屏，而这扇窗里最长的几句话都在法语里。
 *
 * ── 为什么要它 ────────────────────────────────────────────────
 *
 * 2026-10-03 这一轮把这扇窗整个精简了一遍，而动的每一处都是**不报错的那种坏法**：
 *
 *   · 标签从一整句（「第一串：8–64 位，字母 + 数字，区分大小写」）收成三个字，长的那一句
 *     搬进了占位提示——可标签是**绝对定位**的，长了会直接伸出框的右沿去，而且浮起来之后
 *     缩到 0.72 倍、位置更靠上，看着像一行飘在窗外的字。
 *   · 第一串那一行多了一把钥匙和「勿外传」。第一版它被上面那条浮标签的选择器一起匹配
 *     了，于是和真标签**原地叠在一起**——三种语言量出来左右沿一模一样（59..230），而屏幕
 *     上看着只是「有点挤」。
 *   · 验证码那一栏的标签改成只给读屏念。写成 `display: none` 的话读屏也听不到了，而屏幕
 *     上看不出区别。
 *   · 底下那行提示从前**整行恒是报错色**，「正在处理…」「已存好」也印成红的。
 *
 * 所以这一道量的全是「屏幕上实际画出来多大、什么颜色」，不是「DOM 里有没有这个元素」。
 */
import { chromium } from 'playwright';

const base = process.argv[2];
if (!base) {
  console.error('用法: node scripts/check-auth-fit.mjs http://localhost:<端口>/');
  console.error('（服务器要带 GENIUS_GRANT_WINDOW=1）');
  process.exit(2);
}

let fail = 0;
const check = (n, ok, extra = '') => {
  if (!ok) fail++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (extra ? '  ' + extra : ''));
};
const head = (t) => console.log('\n' + t);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/** 一路点到那扇窗，停在①邮箱态。 */
async function openAuth(ctx, lang) {
  const page = await ctx.newPage();
  await page.goto(base);
  await page.evaluate((lg) => {
    localStorage.setItem('slides_lang', lg);
    localStorage.setItem('slides_know_how', '1');
  }, lang);
  await page.reload();
  await page.waitForSelector('.home-nav-btn', { timeout: 25000 });
  await page.click('#navProfile');
  await page.waitForSelector('#becomeGeniusBtn', { timeout: 15000 });
  await page.click('#becomeGeniusBtn');
  await page.waitForSelector('#geniusRestore', { timeout: 15000 });
  await page.click('#geniusRestore');
  await page.waitForSelector('#authGo', { timeout: 15000 });
  await page.waitForTimeout(250);
  return page;
}

/**
 * 这一刻窗里每个框的标签「画出来」是什么样。
 *
 * 量三样，都量**画出来的那个矩形**：
 *   · 几行（按高度和行高算）——标签只许一行；
 *   · 左右沿有没有伸出框去；
 *   · 整句话有没有被截断（`scrollWidth > clientWidth` 就是省略号已经吃掉字了）。
 */
const fields = (page) => page.evaluate(() => {
  const out = [];
  for (const lab of document.querySelectorAll('.auth-modal .auth-field')) {
    if (lab.hidden || !lab.offsetParent) continue;
    const input = lab.querySelector('input');
    const span = lab.querySelector(':scope > input + span');
    if (!input || !span) continue;
    const ib = input.getBoundingClientRect();
    const sb = span.getBoundingClientRect();
    const cs = getComputedStyle(span);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
    out.push({
      id: input.id,
      text: span.textContent.trim(),
      srOnly: span.classList.contains('sr-only'),
      // 读屏专用那一份裁成 1×1，不参与「几行」「出不出界」的判断。
      lines: span.classList.contains('sr-only') ? 1 : Math.max(1, Math.round(sb.height / lh)),
      // **离框左沿 / 右沿还有多远**。负数 = 伸出去了。
      // （第一版两个减数写反了，于是三条全红在「左 −15 / 右 −83」上——而 15 正是标签的
      //   左内缩，页面一个像素都没错。门自己的算术也要验：下面那条断言印的就是这两个数。）
      outL: Math.round(sb.left - ib.left),
      outR: Math.round(ib.right - sb.right),
      clipped: span.scrollWidth > span.clientWidth + 1,
      placeholder: input.placeholder,
      // 占位提示整句在不在框里：拿同样的字体现量一次。
      phOver: (() => {
        if (!input.placeholder.trim()) return 0;
        const ics = getComputedStyle(input);
        const ps = getComputedStyle(input, '::placeholder');
        const c = document.createElement('canvas').getContext('2d');
        c.font = `${ics.fontStyle} ${ics.fontWeight} ${ps.fontSize} ${ics.fontFamily}`;
        const room = input.clientWidth - parseFloat(ics.paddingLeft) - parseFloat(ics.paddingRight);
        return Math.round(c.measureText(input.placeholder).width - room);
      })(),
    });
  }
  return out;
});

const VIEWPORTS = [[360, 740], [1280, 800]];
const LANGS = ['zhHans', 'zhHant', 'en', 'fr'];

for (const [w, h] of VIEWPORTS) {
  for (const lang of LANGS) {
    head(`${w}×${h} · ${lang}`);
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await openAuth(ctx, lang);

    // ── ① 邮箱态 ─────────────────────────────────────────────
    let f = await fields(page);
    check('（尺子）①量到了框', f.length > 0, f.map((x) => x.id).join(' '));
    for (const x of f) {
      check(`① ${x.id}：标签只占一行`, x.lines === 1, `${x.lines} 行「${x.text}」`);
      check(`① ${x.id}：标签在框里`, x.outL >= -1 && x.outR >= -1, `左 ${x.outL} / 右 ${x.outR}`);
      check(`① ${x.id}：标签没被截断`, !x.clipped, x.text);
    }

    // ── ② 验证码态：那一栏的标签只给读屏念，格子上一个字都没有 ──
    await page.route('**/api/signin', async (route) => {
      const body = route.request().postDataJSON?.() ?? {};
      if (body.action === 'confirm') return route.continue();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sent: true }) });
    });
    await page.fill('#authEmail', 'fit@example.com');
    await page.click('#authGo');
    await page.waitForFunction(() => !document.querySelector('#authCodeForm')?.hidden, null, { timeout: 15000 });
    await page.waitForTimeout(200);
    const code = await page.evaluate(() => {
      const span = document.querySelector('#authCodeForm .auth-field > input + span');
      const b = span?.getBoundingClientRect();
      return {
        has: !!span,
        srOnly: span?.classList.contains('sr-only') ?? false,
        text: span?.textContent?.trim() ?? '',
        box: b ? { w: Math.round(b.width), h: Math.round(b.height) } : null,
        display: span ? getComputedStyle(span).display : '',
        cells: document.querySelectorAll('#authCodeForm .pin-cell').length,
      };
    });
    check('② 验证码那一栏的标签还在（读屏念得到）', code.has && code.text.length > 0, code.text);
    check('② 但屏幕上一个字都没有（裁成 1×1）',
      code.srOnly && !!code.box && code.box.w <= 2 && code.box.h <= 2, JSON.stringify(code.box));
    check('② 不是 display:none（那样读屏也听不到）', code.display !== 'none', code.display);
    check('（尺子）② 真是六格', code.cells === 6, String(code.cells));

    // ── ③ 免邮箱态：两串、钥匙那一行、aria 两处 ──────────────
    await page.click('#authAlt');
    await page.waitForFunction(() => !document.querySelector('#authMailForm')?.hidden, null, { timeout: 10000 });
    await page.click('#authAlt');
    await page.waitForFunction(() => !document.querySelector('#authPairForm')?.hidden, null, { timeout: 10000 });
    await page.waitForTimeout(250);
    f = await fields(page);
    check('（尺子）③量到了两个框', f.length === 2, f.map((x) => x.id).join(' '));
    for (const x of f) {
      check(`③ ${x.id}：标签只占一行`, x.lines === 1, `${x.lines} 行「${x.text}」`);
      check(`③ ${x.id}：标签在框里`, x.outL >= -1 && x.outR >= -1, `左 ${x.outL} / 右 ${x.outR}`);
      check(`③ ${x.id}：标签没被截断`, !x.clipped, x.text);
      check(`③ ${x.id}：占位提示整句装得下`, x.phOver <= 0, `多出 ${x.phOver}px「${x.placeholder}」`);
    }
    const aria = await page.evaluate(() => {
      const note = document.querySelector('.auth-keynote');
      const nb = note?.getBoundingClientRect();
      const first = document.querySelector('#authFirst');
      const fb = first?.getBoundingClientRect();
      const lab = document.querySelector('.auth-field--note > input + span');
      const lb = lab?.getBoundingClientRect();
      return {
        describedBy: first?.getAttribute('aria-describedby') ?? '',
        warnText: document.querySelector('#authPairWarn')?.textContent?.trim() ?? '',
        goAria: document.querySelector('#authGo')?.getAttribute('aria-label') ?? '',
        closeAria: document.querySelector('#authClose')?.getAttribute('aria-label') ?? '',
        noteW: nb ? Math.round(nb.width) : 0,
        // 钥匙那一行和标签不许叠在一起，而且两头都要在框里
        gap: nb && lb ? Math.round(nb.left - lb.right) : -999,
        inBox: nb && fb ? Math.round(fb.right - nb.right) : -999,
      };
    });
    check('③ 整句警告挂在第一串那个框上（aria-describedby）', aria.describedBy === 'authPairWarn', aria.describedBy || '（没挂）');
    check('③ 那一句真的有内容', aria.warnText.length > 10, aria.warnText.slice(0, 40));
    check('③ 那颗箭头有 aria-label', aria.goAria.length > 0, aria.goAria);
    check('③ 那枚 ✕ 有 aria-label', aria.closeAria.length > 0, aria.closeAria);
    check('③ 钥匙那一行收缩到文字宽（不是被当成标签拉满）', aria.noteW > 10 && aria.noteW < 180, `${aria.noteW}px`);
    check('③ 钥匙那一行不和标签叠在一起', aria.gap >= 0, `相距 ${aria.gap}px`);
    check('③ 钥匙那一行在框里', aria.inBox >= 0, `离框右沿 ${aria.inBox}px`);

    // ── ④ 普通提示不是红的 ───────────────────────────────────
    const tone = await page.evaluate(() => {
      const msg = document.querySelector('#authMsg');
      msg.textContent = '测试';
      msg.classList.remove('auth-msg--bad');
      const normal = getComputedStyle(msg).color;
      msg.classList.add('auth-msg--bad');
      const bad = getComputedStyle(msg).color;
      msg.classList.remove('auth-msg--bad');
      msg.textContent = '';
      return { normal, bad };
    });
    check('④ 普通提示和报错**不是同一个颜色**', tone.normal !== tone.bad, `${tone.normal} vs ${tone.bad}`);

    // ── ⑤ 这扇窗里一个「／」都没有 ────────────────────────────
    const slash = await page.evaluate(() => {
      const root = document.querySelector('.auth-modal');
      const txt = root ? root.textContent : '';
      const ph = [...document.querySelectorAll('.auth-modal input')].map((i) => i.placeholder).join(' ');
      const hit = (txt + ' ' + ph).includes('／');
      return { hit, sample: (txt + ' ' + ph).replace(/\s+/g, ' ').slice(0, 90) };
    });
    check('⑤ 窗里（含占位提示）一个「／」都没有', !slash.hit, slash.sample);

    await ctx.close();
  }
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
await browser.close();
process.exit(fail ? 1 : 0);

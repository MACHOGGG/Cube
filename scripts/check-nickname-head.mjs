/**
 * 个人主页头卡上的昵称，和小屋名字栏那一头（第 16 推第 5、6 条）。
 *
 *   node scripts/dev-server.mjs 8962 dist
 *   node scripts/check-nickname-head.mjs http://localhost:8962/
 *
 * `/api/scores` 和 `/api/room` 在浏览器里拦下来（量的是这一页**发了什么**、拿到回包之后
 * **画了什么**），所以不吃 dev-server 里的帐号和名字，几种尺寸、四种语言一台服务器跑完。
 *
 * ── 量什么 ──────────────────────────────────────────────────────────
 *
 *   ① 登录了：头卡左边是昵称和 ✎（aria-label「修改昵称」），右边那一截还是原来那颗
 *      #loginBtn；没登记昵称就写「设置昵称」。没登录：照旧一整颗「登录」。
 *   ② 头卡和左栏别的药丸一样高、一样宽；三样东西都在卡里，没有一样顶出去（十二个字的名字
 *      也一样）。
 *   ③ ✎ 和另外两块点击区域之间隔着 ≥ 8px，而且那一圈空地**真的点不到**任何一块：
 *      elementFromPoint 落在那一圈里拿到的是空地本身。
 *   ④ 点 ✎：原地变成输入框 + ✓ + ✕（卡片不长高），Enter 存、Esc 和 ✕ 不存；存的时候发的是
 *      action: name；存成了卡上就是新名字；被占了在卡底下说「已经有人用了」、输入框留着他
 *      敲的字。
 *   ⑤ 头卡其他位置（昵称那几个字、右边那一截）照旧打开帐号窗。
 *   ⑥ 小屋名字栏预填的是昵称；登录了的人改了名字再按《开小屋》，先走改名接口——被占了就停
 *      在这一页说为什么，**一个开屋请求都不发**。
 */
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://localhost:8962/';
const dir = mkdtempSync(join(tmpdir(), 'nickhead-'));
await build({
  entryPoints: [new URL('../src/i18n.ts', import.meta.url).pathname],
  bundle: true, format: 'esm', outfile: join(dir, 'i18n.mjs'), logLevel: 'error',
});
const { STRINGS } = await import(join(dir, 'i18n.mjs'));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
let pass = 0;
const check = (n, ok, extra = '') => {
  if (ok) pass++;
  else {
    fail++;
    console.log(`FAIL  ${n}${extra ? '  ' + extra : ''}`);
  }
};

// NICKHEAD_QUICK=1：只跑 390 宽、简中和英文两种（反证改坏法时用，一轮从四分钟缩到一分钟）。
const QUICK = process.env.NICKHEAD_QUICK === '1';
const SIZES = [
  { n: '360×640', w: 360, h: 640 },
  { n: '390×844', w: 390, h: 844 },
  { n: '1280×800', w: 1280, h: 800 },
].filter((z) => !QUICK || z.w === 390);
const LANGS = QUICK ? ['zhHans', 'en'] : ['zhHans', 'zhHant', 'en', 'fr'];
const mailSeed = {
  active: true, channel: 'code', until: Date.UTC(2999, 0, 1),
  email: 'head-check@example.com', token: 'probe-token',
};
/** 每种语言里最宽的那种十二个字（正好 12 个码点：多一个就会被 getNickname 截掉，量的就不是它了）。 */
const LONG = { zhHans: '十二个字的名字到这里刚好', zhHant: '十二個字的名字到這裡剛好', en: 'WWWWWWWWWWWW', fr: 'MMMMMMMMMMMM' };

/**
 * 开一页、登着、本机缓存一个昵称。`api` 决定 /api/scores 的 name 那一下怎么答。
 * 返回发出去的请求（按 action 记）。
 */
async function open(size, lang, { seed = mailSeed, nick = '', serverNick, nameReply } = {}) {
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, reducedMotion: 'reduce' });
  const sent = [];
  await ctx.route('**/api/scores', async (route) => {
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch {}
    sent.push(body);
    if (body.action === 'name') {
      const r = nameReply ? nameReply(body) : { status: 200, body: { ok: true, name: String(body.name).trim() } };
      return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) });
    }
    if (body.action === 'mine') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ total: 0, runs: 0, best: {}, archive: [], ...(serverNick === undefined ? {} : { nickname: serverNick }) }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mode: '', rows: [], players: 0, me: null }) });
  });
  await ctx.route('**/api/room', async (route) => {
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch {}
    sent.push({ room: true, ...body });
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'notConfigured' }) });
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 25000 });
  await page.evaluate(([l, s, n]) => {
    localStorage.setItem('slides_lang', l);
    if (s) localStorage.setItem('slides_genius', JSON.stringify(s));
    else localStorage.removeItem('slides_genius');
    if (n) localStorage.setItem('slides_mp_name', n);
    else localStorage.removeItem('slides_mp_name');
  }, [lang, seed, nick]);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 25000 });
  await page.click('#navProfile');
  await page.waitForSelector('.profile-page', { timeout: 10000 });
  return { ctx, page, sent };
}

const rect = (page, sel) =>
  page.$eval(sel, (el) => {
    const r = el.getBoundingClientRect();
    return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height, shown: getComputedStyle(el).display !== 'none' };
  }).catch(() => null);

for (const size of SIZES) {
  for (const lang of LANGS) {
    const s = STRINGS[lang];
    const tag = `${size.n} ${lang}`;

    // ── ①②③⑤ 登录了、有昵称（最宽的十二个字）─────────────────────────
    {
      const name = LONG[lang];
      const { ctx, page, sent } = await open(size, lang, { nick: name, serverNick: name });
      await page.waitForTimeout(300);
      const head = await rect(page, '#profileHead');
      check(`${tag} ① 登录了：头卡是那张带昵称的卡`, Boolean(head), String(head));
      if (!head) { await ctx.close(); continue; }
      const text = await page.$eval('#nickText', (e) => e.textContent);
      check(`${tag} ① 左边是昵称`, text === name, JSON.stringify(text));
      const aria = await page.$eval('#nickEdit', (e) => e.getAttribute('aria-label'));
      check(`${tag} ① ✎ 的 aria-label 是「${s.nickEdit}」`, aria === s.nickEdit, String(aria));
      check(`${tag} ① 右边那一截还是原来那颗 #loginBtn`, await page.$eval('#loginBtn', (e) => e.closest('#profileHead') !== null));
      // ② 和左栏别的药丸一样高、一样宽。高拿《语言》那颗比：10-09 补充方案起药丸高度跟着字走（下限
      // 43），法文的「Palette adaptée aux daltoniens」在 360 宽上折成两行、那一颗长到 54，拿它比就
      // 是拿一颗折了行的去量一颗没折行的。《语言》四种语言都是一行。
      const cvd = await rect(page, '#cvdRow');
      const lang1 = await rect(page, '#langRow');
      check(`${tag} ② 头卡和别的药丸一样高`, Math.abs(head.h - lang1.h) <= 0.5, `${head.h} / ${lang1.h}`);
      check(`${tag} ② 头卡和别的药丸一样宽`, Math.abs(head.w - cvd.w) <= 0.5, `${head.w} / ${cvd.w}`);
      for (const sel of ['#nickText', '#nickEdit', '#loginBtn']) {
        const r = await rect(page, sel);
        check(`${tag} ② ${sel} 整个在卡里`, r && r.l >= head.l - 0.5 && r.r <= head.r + 0.5 && r.t >= head.t - 0.5 && r.b <= head.b + 0.5,
          JSON.stringify(r));
      }
      // 右边那一截不许被十二个字的名字挤没：它是「其他位置开帐号窗」那块地方，也是唯一写着
      // 《账户》那句字的地方。至少留四分之一张卡（量过：最挤的 360 宽上它有 100px 上下）。
      const open0 = await rect(page, '#loginBtn');
      check(`${tag} ② 右边那一截没被名字挤没（≥ 卡宽的 1/4）`, open0 && open0.w >= head.w / 4, `${open0?.w} / ${head.w}`);
      // ③ 两块点击区域之间 ≥ 8px，而且那一圈空地真的点不到任何一块
      const t = await rect(page, '#nickText');
      const e = await rect(page, '#nickEdit');
      const o = await rect(page, '#loginBtn');
      check(`${tag} ③ ✎ 左边离昵称 ≥ 8px`, e.l - t.r >= 8 - 0.5, (e.l - t.r).toFixed(1));
      check(`${tag} ③ ✎ 右边离帐号那一截 ≥ 8px`, o.l - e.r >= 8 - 0.5, (o.l - e.r).toFixed(1));
      const probes = await page.evaluate(([el, er, top, bottom]) => {
        const ys = [top + 4, (top + bottom) / 2, bottom - 4];
        const xs = [el - 7, el - 1, er + 1, er + 7];
        return xs.flatMap((x) => ys.map((y) => {
          const hit = document.elementFromPoint(x, y);
          return hit ? (hit.closest('#nickGuard') ? 'guard' : hit.closest('#loginBtn') ? 'open' : hit.closest('#nickText') ? 'text' : hit.closest('#nickEdit') ? 'edit' : hit.tagName) : 'none';
        }));
      }, [e.l, e.r, head.t, head.b]);
      check(`${tag} ③ ✎ 外面那一圈落点全是空地（点不到昵称、点不到帐号窗）`, probes.every((p) => p === 'guard'), probes.join(' '));

      // ⑤ 头卡其他位置照旧打开帐号窗
      for (const sel of ['#nickText', '#loginBtn']) {
        await page.click(sel);
        const opened = await page.waitForSelector('.acct-modal', { timeout: 4000 }).then(() => true).catch(() => false);
        check(`${tag} ⑤ 点 ${sel} 打开帐号窗`, opened);
        if (opened) {
          await page.keyboard.press('Escape');
          await page.waitForTimeout(150);
        }
      }
      // ③ 的反面：点那一圈空地什么都不发生
      await page.mouse.click(e.l - 4, (head.t + head.b) / 2);
      await page.waitForTimeout(250);
      check(`${tag} ③ 点那一圈空地：帐号窗不开、也不进编辑`,
        (await page.$('.acct-modal')) === null && (await page.$('#nickInput')) === null);

      // ④ 原地编辑
      await page.click('#nickEdit');
      await page.waitForSelector('#nickInput', { timeout: 3000 });
      const ed = await page.evaluate(() => ({
        inHead: Boolean(document.querySelector('#profileHead #nickInput')),
        value: document.querySelector('#nickInput').value,
        focused: document.activeElement?.id,
        save: document.querySelector('#nickSave')?.getAttribute('aria-label'),
        cancel: document.querySelector('#nickCancel')?.getAttribute('aria-label'),
        hidden: ['#nickText', '#nickGuard', '#loginBtn'].map((q) => getComputedStyle(document.querySelector(q)).display),
      }));
      check(`${tag} ④ 点 ✎：原地变成输入框，里面是现在的名字，光标在里面`,
        ed.inHead && ed.value === name && ed.focused === 'nickInput', JSON.stringify(ed));
      check(`${tag} ④ 配着 ✓（${s.nickSave}）和 ✕（${s.nickCancel}）`, ed.save === s.nickSave && ed.cancel === s.nickCancel,
        `${ed.save} / ${ed.cancel}`);
      check(`${tag} ④ 编辑时昵称、✎、右边那一截让出位置`, ed.hidden.every((d) => d === 'none'), ed.hidden.join(' '));
      const headEd = await rect(page, '#profileHead');
      check(`${tag} ④ 编辑时卡片不长高`, Math.abs(headEd.h - head.h) <= 0.5, `${headEd.h} / ${head.h}`);
      for (const sel of ['#nickInput', '#nickSave', '#nickCancel']) {
        const r = await rect(page, sel);
        // 上下也量：卡片高度有个下限（43，10-09 补充方案起不再定高 52），里面的东西都比它矮；哪天
        // 里面的东西长高了，卡片要么跟着长（上一条红），要么从卡里顶出去——只量卡片自己的高度，后
        // 一种坏法一条都不红（反证时第一版就是这样漏掉的）。
        check(`${tag} ④ ${sel} 整个在卡里`,
          r && r.l >= headEd.l - 0.5 && r.r <= headEd.r + 0.5 && r.t >= headEd.t - 0.5 && r.b <= headEd.b + 0.5,
          JSON.stringify(r));
      }
      // Esc 不存
      await page.fill('#nickInput', '不要存');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
      check(`${tag} ④ Esc：不存，回到原来的名字`,
        (await page.$('#nickInput')) === null && (await page.$eval('#nickText', (x) => x.textContent)) === name &&
          !sent.some((b) => b.action === 'name'));
      // ✕ 不存
      await page.click('#nickEdit');
      await page.fill('#nickInput', '也不要存');
      await page.click('#nickCancel');
      await page.waitForTimeout(150);
      check(`${tag} ④ ✕：不存`, (await page.$('#nickInput')) === null && !sent.some((b) => b.action === 'name'));
      // Enter 存
      await page.click('#nickEdit');
      await page.fill('#nickInput', '新名字');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => !document.querySelector('#nickInput'), null, { timeout: 4000 }).catch(() => {});
      const saved = sent.filter((b) => b.action === 'name');
      check(`${tag} ④ Enter：发了一次 action: name，名字是敲的那个`, saved.length === 1 && saved[0].name === '新名字',
        JSON.stringify(saved));
      check(`${tag} ④ 存成了：卡上就是新名字`, (await page.$eval('#nickText', (x) => x.textContent)) === '新名字');
      await ctx.close();
    }

    // ── ④ 被占了：说一句，输入框留着 ───────────────────────────────────
    if (size.w === 390) {
      const { ctx, page, sent } = await open(size, lang, {
        nick: '阿花', serverNick: '阿花', nameReply: () => ({ status: 409, body: { error: 'taken' } }),
      });
      await page.waitForTimeout(300);
      await page.click('#nickEdit');
      await page.fill('#nickInput', '别人的名字');
      await page.click('#nickSave');
      await page.waitForFunction(() => document.querySelector('#nickMsg')?.textContent, null, { timeout: 4000 }).catch(() => {});
      const st = await page.evaluate(() => ({
        msg: document.querySelector('#nickMsg')?.textContent,
        msgShown: getComputedStyle(document.querySelector('#nickMsg')).display !== 'none',
        value: document.querySelector('#nickInput')?.value,
      }));
      check(`${tag} ④ 被占了：卡底下说「${s.nickTaken}」`, st.msg === s.nickTaken && st.msgShown, JSON.stringify(st));
      check(`${tag} ④ 被占了：输入框还在，留着他敲的字`, st.value === '别人的名字', String(st.value));
      check(`${tag} ④ 被占了：本机缓存没被改`, (await page.evaluate(() => localStorage.getItem('slides_mp_name'))) === '阿花');
      check(`（尺子）${tag} ④ 那一下真的发出去了`, sent.some((b) => b.action === 'name'));
      await ctx.close();
    }

    // ── ① 没登记昵称：写「设置昵称」 ─────────────────────────────────────
    {
      const { ctx, page } = await open(size, lang, { nick: '', serverNick: '' });
      await page.waitForTimeout(300);
      const st = await page.evaluate(() => ({
        text: document.querySelector('#nickText')?.textContent,
        unset: document.querySelector('#nickText')?.classList.contains('profile-head-nick--unset'),
      }));
      check(`${tag} ① 没登记昵称：写「${s.nickSet}」`, st.text === s.nickSet && st.unset, JSON.stringify(st));
      await ctx.close();
    }

    // ── ① 没登录：照旧一整颗「登录」 ─────────────────────────────────────
    {
      const { ctx, page } = await open(size, lang, { seed: null, nick: '本机名字' });
      const st = await page.evaluate(() => ({
        head: Boolean(document.querySelector('#profileHead')),
        btn: document.querySelector('#loginBtn')?.className,
        text: document.querySelector('#loginBtn')?.textContent.trim(),
      }));
      check(`${tag} ① 没登录：没有昵称那张卡，一整颗「${s.loginGateway}」`,
        !st.head && /profile-pill--head/.test(st.btn || '') && st.text === s.loginGateway, JSON.stringify(st));
      await ctx.close();
    }
  }
}

// ── ⑥ 小屋名字栏 ────────────────────────────────────────────────────────
{
  const size = SIZES.find((z) => z.w === 390);
  const s = STRINGS.zhHans;
  const { ctx, page, sent } = await open(size, 'zhHans', {
    nick: '阿花', serverNick: '阿花', nameReply: () => ({ status: 409, body: { error: 'taken' } }),
  });
  await page.click('#multiRow');
  await page.waitForSelector('#mpName', { timeout: 10000 });
  check('⑥ 小屋名字栏预填的是昵称', (await page.$eval('#mpName', (e) => e.value)) === '阿花');
  await page.fill('#mpName', '别人的名字');
  await page.click('#mpCreate');
  await page.waitForFunction((t) => document.querySelector('#mpMsg')?.textContent === t, s.nickTaken, { timeout: 5000 }).catch(() => {});
  const msg = await page.$eval('#mpMsg', (e) => e.textContent);
  check('⑥ 登录了的人改了名字再开小屋：先走改名接口', sent.some((b) => b.action === 'name' && b.name === '别人的名字'),
    JSON.stringify(sent.filter((b) => b.action === 'name')));
  check(`⑥ 被占了：停在这一页说「${s.nickTaken}」`, msg === s.nickTaken, JSON.stringify(msg));
  check('⑥ 被占了：一个开屋请求都没发', !sent.some((b) => b.room), JSON.stringify(sent.filter((b) => b.room)));
  await ctx.close();
}

await browser.close();
console.log(fail ? `\n${pass} 条过，${fail} 条红` : `\n${pass} 条全过`);
process.exit(fail ? 1 : 0);

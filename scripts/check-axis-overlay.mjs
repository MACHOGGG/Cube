/**
 * 主菜单上开窗、关窗，轴的中线不漂（10-08 方案 3-D-3）。
 *
 *   node scripts/dev-server.mjs 8977 dist
 *   node scripts/check-axis-overlay.mjs http://localhost:8977/
 *
 * 方案原话：「登录弹窗关闭后偏移：复现（开登录→关→量中线），二选一修——body 滚动锁 padding 补偿没
 * 还原，或弹窗 close 回调里调轴 relayout/recenter。验收：开关 5 次中线不漂。」3-C-6 又补了一句：「从
 * 这颗新按钮（帐号窗底下那颗 ✅）关闭也不许偏移」。
 *
 * 复现出来的不是 padding——这个站压根没有「锁 body 滚动」那回事。轴是钉在**文档**顶上、正好一屏高
 * 的（modeAxis.ts 的 measure），所以三条来路都会让它整条错位：
 *
 *   ① 轴量完位置之后，它前面那块招牌又长高了：副标题是打字机打出来的，中文打出第一个字那一下招牌
 *      从 104 长到 105（无头 Chromium 上量的；真机上中文落到系统字体，差得可能更多），晚到的新版本提
 *      示挂进招牌也一样。轴一直错着，等下一次重画主菜单才「跳」回去——登录成功那一拍正好重画。
 *   ② 窗开着的时候页面被推了一下：手机上登录窗的输入框一拿到焦点，键盘弹起来，浏览器把底下那一页
 *      往上推。窗一关，键盘收了，页面停在推上去的地方。
 *   ③ main.ts 在主菜单上把 scrollY 记成「主菜单滚到哪儿了」，每次 showMenu 照着放回去、还追着放半
 *      秒——② 那一下被它记住了，登录成功那一拍（landed → onChanged → showMenu）原样放回去。
 *
 * 无头 Chromium 没有屏幕键盘，所以 ② 那一下是摆出来的：这一页本身正好一屏高、滚不动，键盘弹起来的
 * 时候 iOS 会多给出一段能滚的余地（等于键盘那么高），浏览器再把页面推上去露出输入框——这里先在 body
 * 底下垫一截 400px（那段余地），再 scrollTo(0, 120)（推的那一下），关窗之后才把垫的拿掉。①
 * 不等打字机碰运气，往招牌里塞一块 30px 的东西（新版本提示就是这么挂进去的）；打字机那一下由「进来
 * 的时候上沿贴着屏幕顶」那条量（等它打完才量）。
 *
 * 量的是玩家看得见的那个数：选中线（轴心往上 --axis-shift）上那一张卡的中心在屏幕上的 y。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2];
if (!BASE) {
  console.error('用法: node scripts/check-axis-overlay.mjs http://localhost:8977/');
  process.exit(2);
}

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/** 打完过一局的人（《每日挑战》摆着、没有首玩锁），没登录——锁着的卡点下去开的是邀请窗。 */
const SEED = `
  localStorage.setItem('slides_lang', 'zhHans');
  localStorage.setItem('slides_played_square', '1');
  localStorage.setItem('slides_played_finished', '1');
`;

/** 选中线上那一张卡、它的中心在屏幕上的 y，连同页面滚了多少、轴的上沿在哪儿。 */
const centre = (p) =>
  p.evaluate(() => {
    const host = document.querySelector('.mode-axis');
    if (!host) return null;
    const hr = host.getBoundingClientRect();
    const shift = parseFloat(getComputedStyle(host).getPropertyValue('--axis-shift')) || 0;
    const mid = hr.top + hr.height / 2 - shift;
    const near = [...host.children]
      .filter((e) => e.classList.contains('home-icon-btn'))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { name: (el.getAttribute('aria-label') || '').split(/[ ·，,]/)[0], cy: r.top + r.height / 2 };
      })
      .sort((a, b) => Math.abs(a.cy - mid) - Math.abs(b.cy - mid))[0];
    return { scrollY: window.scrollY, top: hr.top, mid, name: near?.name ?? '', cy: near?.cy ?? NaN };
  });
const fmt = (c) => (c ? `「${c.name}」中心 ${c.cy.toFixed(1)}，上沿 ${c.top.toFixed(1)}，scrollY ${c.scrollY}` : '没有轴');
/** 和开窗之前比：同一张卡、中心差不到半个像素、页面没滚。 */
const same = (a, b) => !!a && !!b && a.name === b.name && Math.abs(a.cy - b.cy) < 0.5 && b.scrollY === 0;

async function menu() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  await ctx.addInitScript(SEED);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(BASE);
  await p.waitForSelector('.mode-axis .home-icon-btn--locked', { timeout: 20000 });
  // 副标题打完（打字机一个字七十来毫秒，这一句十来个字）；字体到货那一下也早过去了。
  await p.waitForFunction(() => (document.querySelector('.home-sub')?.textContent || '').length >= 8, null, { timeout: 15000 });
  await p.waitForTimeout(1500);
  return { ctx, p, errs };
}
/** 点一张锁着的卡：没登录的人开的是邀请窗（main.ts 的 onLockedLayout）。 */
const openInvite = async (p) => {
  await p.evaluate(() => document.querySelector('.mode-axis .home-icon-btn--locked').click());
  await p.waitForSelector('#geniusClose', { timeout: 10000 });
  await p.waitForTimeout(250);
};
/**
 * 键盘那一下：先垫出键盘给的那段余地，再把窗底下那一页往上推（scrollTo 就是浏览器为了露出输入框做
 * 的那件事）。垫的那一截挂在 body 底下、#app 外面，主菜单重画也冲不掉，等量完再拿掉（keyboardDown）。
 */
const keyboardPush = (p) => p.evaluate(() => {
  // 绝对定位、从文档顶上量下去的一根细条：body 是横排的弹性盒，直接挂一块 400px 高的进去只会排在
  // #app 旁边，文档一点没长高。
  const room = document.createElement('div');
  room.id = 'kbRoom';
  room.style.cssText = `position:absolute;left:0;top:0;width:1px;height:${innerHeight + 400}px;pointer-events:none`;
  document.body.appendChild(room);
  window.scrollTo(0, 120);
  return window.scrollY;
});
const keyboardDown = (p) => p.evaluate(() => document.getElementById('kbRoom')?.remove());
const settle = (p) => p.waitForTimeout(700); // 比 keepScrollAt 追着放的那半秒长

// ── ① 招牌长高了，轴跟着重量 ────────────────────────────────────────────
{
  const { ctx, p, errs } = await menu();
  const before = await centre(p);
  check('① 进来的时候轴的上沿贴着屏幕顶（不到半个像素）', !!before && Math.abs(before.top) < 0.5, fmt(before));
  // 新版本提示就是这样晚一步挂进招牌的（newVersionPill.ts）。
  await p.evaluate(() => {
    const pad = document.createElement('div');
    pad.id = 'growHead';
    pad.style.height = '30px';
    document.querySelector('.home-page .home-head-glass').appendChild(pad);
  });
  await p.waitForTimeout(300);
  const grown = await centre(p);
  check('① 招牌长高 30px 之后，轴的上沿照旧贴着屏幕顶（重量过了）', !!grown && Math.abs(grown.top) < 0.5, fmt(grown));
  check('① 选中线上照旧是那一张、中心没动', same(before, grown), `${fmt(before)} → ${fmt(grown)}`);
  check('① 全程零报错', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

// ── ② 邀请窗开开关关五次 ────────────────────────────────────────────────
{
  const { ctx, p, errs } = await menu();
  const base = await centre(p);
  const after = [];
  for (let i = 0; i < 5; i++) {
    await openInvite(p);
    await p.click('#geniusClose');
    await settle(p);
    after.push(await centre(p));
  }
  check('② 邀请窗开、✕ 关，五次之后中线一点没漂', after.every((c) => same(base, c)),
    `开之前 ${fmt(base)} ｜ ${after.map((c) => c?.cy.toFixed(1)).join(' / ')}`);
  check('② 全程零报错', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

// ── ③ 登录窗开着时页面被推了一下（手机键盘），关窗回原位，五次 ─────────────────
{
  const { ctx, p, errs } = await menu();
  const base = await centre(p);
  const pushed = [];
  const after = [];
  for (let i = 0; i < 5; i++) {
    await openInvite(p);
    await p.click('#geniusRestore'); // 邀请窗右边那颗：开登录窗
    await p.waitForSelector('#authClose', { timeout: 10000 });
    await p.waitForTimeout(250);
    pushed.push(await keyboardPush(p));
    await p.click('#authClose');
    await settle(p);
    // 垫的那一截还在（页面照样滚得动）的时候量：量的是「关窗那一下把页面摆回去了」，不是「余地没了、
    // 浏览器自己把滚动夹回 0」。
    after.push(await centre(p));
    await keyboardDown(p);
  }
  // 尺子：页面真的被推动了（这一页能滚），不然下面那条在「本来就推不动」时也是绿的。
  check('③ 尺子：窗开着的时候页面真的被推上去了', pushed.every((y) => y > 50), pushed.join(' / '));
  check('③ 登录窗关掉之后页面回到顶上、中线回到原处（五次）', after.every((c) => same(base, c)),
    `开之前 ${fmt(base)} ｜ ${after.map((c) => `${c?.cy.toFixed(1)}@${c?.scrollY}`).join(' / ')}`);
  check('③ 全程零报错', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

// ── ④ 真注册一遍：帐号窗开着时底下不歪，用 ✅ 和 ✕ 各关一次 ───────────────────
for (const [closer, label] of [['#statusDone', '✅'], ['#statusClose', '✕']]) {
  const { ctx, p, errs } = await menu();
  const base = await centre(p);
  await openInvite(p);
  await p.click('#geniusRestore');
  await p.waitForSelector('#authAlt', { timeout: 10000 });
  await p.click('#authAlt'); // 「不用邮箱」那一档：两串自己定的字
  await p.waitForSelector('#authPairForm:not([hidden]) input', { timeout: 10000 });
  const inputs = await p.$$('#authPairForm input');
  // 两串都只许字母数字、八位起（PAIR_RE）。
  const tag = Math.random().toString(36).slice(2, 10).replace(/[^a-z0-9]/g, '');
  await inputs[0].fill(`first${tag}`);
  if (inputs[1]) await inputs[1].fill(`second${tag}`);
  const pushed = await keyboardPush(p);
  await p.click('#authGo');
  await p.waitForSelector(closer, { timeout: 15000 });
  await settle(p);
  // 登录成功那一拍主菜单在窗底下重画了一遍（landed → onChanged → showMenu）。
  const behind = await centre(p);
  check(`④${label} 尺子：注册之前页面真的被推上去了`, pushed > 50, String(pushed));
  check(`④${label} 帐号窗开着的时候，底下那一页没有停在被推歪的地方`, same(base, behind), `${fmt(base)} → ${fmt(behind)}`);
  await p.click(closer);
  await settle(p);
  const after = await centre(p);
  await keyboardDown(p);
  check(`④${label} 用帐号窗的 ${label} 关掉之后中线没漂`, same(base, after), `${fmt(base)} → ${fmt(after)}`);
  check(`④${label} 关掉的是帐号窗（窗没了，人还在主菜单）`,
    await p.evaluate(() => !document.querySelector('.acct-modal') && !!document.querySelector('.home-page')));
  check(`④${label} 全程零报错`, errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await browser.close();
console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

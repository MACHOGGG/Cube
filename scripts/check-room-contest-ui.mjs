/**
 * 竞赛小屋，在真界面上跑一遍（要 dev-server + Chromium）。
 *
 *   node scripts/dev-server.mjs 8923 dist
 *   node scripts/check-room-contest-ui.mjs http://localhost:8923/ [--viewports=390x844,375x667,360x640,320x568]
 *
 * --viewports：「小屏」那几条在哪几种尺寸上量（10-11 方案 C-8，默认就是玩家实测的那四种）。别的照旧在
 * 390×844 上量。
 *
 * 服务端那三条规矩由 scripts/check-room-contest.mjs 守着（纯 node，在 CI 里）。
 * 这一道守的是**摆到真 DOM 上之后**才会出错的那几件：
 *
 *   · **《开竞赛》那颗键在，而且底下那一行小字在。** 这一行是「必须有字」的地方
 *     ——不写的话玩家按下去会发现自己没有棋盘，那正是站点原则里的「意料之外的
 *     界面」。
 *   · **主持人这一局不拿到棋盘**，改坐在实时榜单上，榜上**没有他自己**（列进去
 *     就是一行恒定 0 分挂在最后一名），那颗键上的字是《解散小屋》。
 *   · **二十名选手的榜单摆得下。** api/room.js 开头那段注释早写着这件事要先办：
 *     「等名单和战绩图都摆得下二十个人之后，再把入口放出来——反过来先放入口，今
 *     晚就会有人开出一间二十人的屋子配着八人的排版」。实测过那个排版：榜单盒子
 *     长到 1322px 塞在 844px 的屏幕里，整块被挤出去（顶边 −138，滚都滚不回去），
 *     名单自己一格都不滚。修在 style.css 的 `.overlay--wait .mp-wait-stage`。
 *   · **普通八人屋一个字都没被碰。** 最后那一节是对照：屋主照旧拿得到棋盘。
 *   · **小屏上摆得下**（10-11 方案 C-8，玩家补充的四种尺寸实测）：设置页上页底那颗《退出》不压屋号四格；
 *     竞赛屋的小屋页上二十一个名字在名单自己里面滚，《去主菜单选玩法》不用滑就在屏幕上；屋主实时榜底下
 *     「按住不等了」的字是一行（原先一字一行竖排）；选手倒数页的总分榜不和倒数那张数字卡、玩法图叠在一起，
 *     最后一名滚得到（原先 320×568 上只看得到 16 名，后几名看不到也滚不到）。
 *   · **选手交卷之后那一屏的榜上也没有主持人**（10-11 方案 C-7）。
 *
 * 十九个选手是直接打接口进来的（同源 fetch），不是开十九个浏览器——要量的是
 * 屏幕上摆不摆得下，不是十九台设备的联机。
 */
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const BASE = process.argv[2] || 'http://localhost:8923/';
const VIEWPORTS = (process.argv.find((a) => a.startsWith('--viewports='))?.slice(12) || '390x844,375x667,360x640,320x568')
  .split(',').map((v) => v.split('x').map(Number)).filter(([w, h]) => w > 0 && h > 0);
/** 两个矩形相不相交（贴边不算）。 */
const crosses = (a, b) => Boolean(a && b) && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5 && a.left < b.right - 0.5 && b.left < a.right - 0.5;
/** 页面里一个元素的矩形（取成普通对象带出来）。 */
const RECT = (sel) => {
  const e = document.querySelector(sel);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
};
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const errs = [];

/**
 * 一台开通了天才的手机，停在多人设置页上。
 *
 * `code` 要**每台一张不同的**：兑换码在一个 dev-server 进程里只能用一次
 * （CLAUDE.md 里记着这个坑）。这道门要开两台屋主（竞赛屋一台、对照的普通屋一台），
 * 第二台再兑 TESTMONTH 会拿到 `{"error":"code"}`，然后崩在「兑码没成」上——
 * 头一版就是这么红的，看着像小屋的 bug，其实是同一张码用了两回。
 */
async function hostPage(code = 'TESTMONTH') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => {
    for (const [k, v] of Object.entries({
      slides_lang: 'zhHans', slides_intro_seen: '1', slides_played_square: '1',
      slides_tutorial_seen: '1', slides_tutorial_seen_circle: '1', slides_tutorial_seen_triangle: '1',
    })) localStorage.setItem(k, v);
  });
  await p.goto(BASE, { waitUntil: 'load' });
  await p.waitForSelector('.home-icon-btn', { timeout: 20000 });
  // 开屋要服务器认得的天才身份：兑一张 dev-server 自己种的测试码（和
  // check-multiplayer 同一个做法），再照 engine/account.ts 那样把权益写进本地。
  const granted = await p.evaluate(async (redeemCode) => {
    const r = await fetch('/api/redeem', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: redeemCode }),
    }).then((x) => x.json());
    if (!r.active) return r;
    localStorage.setItem('slides_genius', JSON.stringify({
      active: true, period: r.period, until: r.until, channel: 'code',
      email: r.email, token: r.token, code: r.code,
    }));
    return r;
  }, code);
  if (!granted.active) throw new Error(`兑码没成（${code}）：` + JSON.stringify(granted));
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('.home-icon-btn', { timeout: 20000 });
  await p.click('#navProfile');
  await p.click('#multiRow');
  await p.waitForSelector('#mpCreate', { timeout: 15000 });
  return { ctx, p };
}

/** 屋主挑一个玩法（#mpPick 把他送回主菜单，点一张卡就是全屋的玩法）。 */
async function pickSquare(p) {
  await p.click('#mpPick');
  await p.waitForSelector('#roomPickBar', { timeout: 12000 });
  await p.evaluate(() => {
    [...document.querySelectorAll('.mode-axis > .home-icon-btn')]
      .find((b) => (b.getAttribute('aria-label') || '').startsWith('经典方块'))
      ?.click();
  });
}

/**
 * 一台选手的手机：拿一个已经坐进屋里的座位（打接口进来的那二十个之一）回到小屋页。
 *
 * 座位存在 localStorage 的 slides_mp_seat 里（engine/room.ts 的 rememberSeat），小屋页一
 * 打开就照它回到屋里——和玩家刷新一下页面是同一条路。
 */
async function contestantPage(code, seat, [width, height] = [390, 844]) {
  const cctx = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true });
  const c = await cctx.newPage();
  c.on('pageerror', (e) => errs.push(e.message));
  await c.addInitScript(([code, seat]) => {
    for (const [k, v] of Object.entries({
      slides_lang: 'zhHans', slides_intro_seen: '1', slides_played_square: '1',
      slides_tutorial_seen: '1', slides_tutorial_seen_circle: '1', slides_tutorial_seen_triangle: '1',
    })) localStorage.setItem(k, v);
    localStorage.setItem('slides_mp_seat', JSON.stringify({ code, playerId: seat.playerId, playerToken: seat.playerToken, at: Date.now() }));
  }, [code, seat]);
  await c.goto(BASE, { waitUntil: 'load' });
  await c.waitForSelector('#navProfile', { timeout: 20000 });
  await c.click('#navProfile');
  await c.waitForSelector('#multiRow', { timeout: 10000 });
  await c.click('#multiRow');
  return { cctx, c };
}

// ---- 1. 设置页：《开竞赛》和它底下那一行 ---------------------------------
const { ctx, p } = await hostPage();
{
  const look = await p.evaluate(() => {
    const c = document.querySelector('#mpContest');
    const o = document.querySelector('#mpCreate');
    const row = document.querySelector('.mp-open-row');
    const box = (e) => {
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
               right: Math.round(r.right), bottom: Math.round(r.bottom) };
    };
    return {
      has: Boolean(c),
      isSwitch: c?.getAttribute('role') === 'switch',
      checked: c?.getAttribute('aria-checked'),
      knob: Boolean(c?.querySelector('.mp-contest-knob')),
      contest: c ? box(c) : null,
      create: o ? box(o) : null,
      row: row ? box(row) : null,
      label: c?.getAttribute('aria-label') ?? '',
      ctaLabel: document.querySelector('#mpCreateLabel')?.textContent?.trim() ?? '',
      hint: document.querySelector('.mp-contest-hint')?.textContent?.trim() ?? '',
      // 白点有没有待在条子里（关着的时候）。负数＝探出去了。
      knobIn: (() => {
        const k = c?.querySelector('.mp-contest-knob');
        if (!c || !k) return null;
        const a = c.getBoundingClientRect(), b = k.getBoundingClientRect();
        return { top: Math.round(b.top - a.top), bottom: Math.round(a.bottom - b.bottom) };
      })(),
      hintVisible: (() => {
        const h = document.querySelector('.mp-contest-hint');
        return !!h && getComputedStyle(h).visibility === 'visible';
      })(),
      hintBox: (() => { const h = document.querySelector('.mp-contest-hint'); return h ? box(h) : null; })(),
      pinBox: (() => { const r = document.querySelector('.mp-code-field .pin-row'); return r ? box(r) : null; })(),
      // 条子上不写字（站长 2026-10-14：去掉《Pro》，10-15 补充 K-2）：拨没拨都只有一颗白点。
      tagGone: !document.querySelector('.mp-contest-tag'),
      // 键上那三样的位置：句子头（连着那一格）、锁、招牌。换词的时候一个都不许挪。
      labelBox: (() => { const e = document.querySelector('#mpCreateLabel'); return e ? box(e) : null; })(),
      logoBox: (() => { const e = document.querySelector('#mpCreate .genius-logo--cta'); return e ? box(e) : null; })(),
      word: document.querySelector('#mpCreateWord')?.textContent?.trim() ?? '',
      // 换掉的那个词有没有和这一行字对齐：拿 Range 量《Open a》那段文字自己的行盒，
      // 和那个词的盒子比上下边。inline-block 的基线取自它最后一行，先前那个撑宽度用
      // 的影子排在后面，于是最后一行是影子的，那个词整个被顶高了一截。
      wordAlign: (() => {
        const label = document.querySelector('#mpCreateLabel');
        const word = document.querySelector('#mpCreateWord');
        if (!label || !word) return null;
        const head = [...label.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
        if (!head) return null;
        const r = document.createRange();
        r.selectNode(head);
        const a = r.getBoundingClientRect(), b = word.getBoundingClientRect();
        return {
          // 比的是**两个盒子的中线**，不是上下边：中文那一行的行盒比拉丁文高 4px
          // （23 vs 19），上下各多出 2px——那是字体的事，不是没对齐。挪位才是要抓的。
          center: +(((b.top + b.bottom) / 2) - ((a.top + a.bottom) / 2)).toFixed(2),
          top: +(b.top - a.top).toFixed(2), bottom: +(b.bottom - a.bottom).toFixed(2),
        };
      })(),
      // 昵称那一格屏幕上有几层字：占位一句，加上（从前那个）浮动标签。
      nameLayers: (() => {
        const f = document.querySelector('.mp-name-field');
        if (!f) return null;
        const input = f.querySelector('input');
        const ph = input?.getAttribute('placeholder') ?? '';
        const phShown = !!ph && getComputedStyle(input, '::placeholder').color !== 'rgba(0, 0, 0, 0)';
        const spans = [...f.querySelectorAll('span')]
          .filter((e) => (e.textContent || '').trim() && getComputedStyle(e).visibility !== 'hidden'
                         && getComputedStyle(e).display !== 'none');
        return { ph, phShown, spans: spans.map((e) => e.textContent.trim()) };
      })(),
      // 四根条子：稿上是长条（120 × 286，1 : 2.38），不是矮方块。
      cell: (() => { const e = document.querySelector('.mp-code-field .pin-cell'); return e ? box(e) : null; })(),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      // 设计稿上这一页只有一颗大键。
      creates: document.querySelectorAll('.mp-page--home .mp-create').length,
      // 底排不留（玩家：「下方也去除掉个人主页和排名与信息栏的板块」）。
      navShown: (() => {
        const nav = document.querySelector('.home-nav');
        return !!nav && getComputedStyle(nav).display !== 'none';
      })(),
    };
  });
  check('多人设置页上有《竞赛》那颗开关', look.has, look.label);
  // 玩家定的：它是一个开关，不是第二颗大键。设计稿把它画成贴着大键右边的一根竖条。
  check('它是一个开关，不是第二颗大键',
    look.isSwitch && look.knob && look.checked === 'false',
    `role=switch:${look.isSwitch} knob:${look.knob} checked:${look.checked}`);
  check('这一页只有一颗大键', look.creates === 1, `${look.creates} 颗`);
  // 「贴着大键右边」：同一行、在它右侧、而且比它窄得多（它是那颗键的一个档，不是第二件事）。
  check('开关贴在那颗大键右边，同一行',
    look.row && look.contest && look.create &&
      look.contest.x >= look.create.right - 1 &&
      Math.abs(look.contest.y - look.create.y) <= 6 &&
      look.contest.right <= look.row.right + 1,
    `键 ${JSON.stringify(look.create)} / 开关 ${JSON.stringify(look.contest)}`);
  check('开关比那颗大键窄得多（这一页有主次了）',
    look.contest.w < look.create.w * 0.4, `开关 ${look.contest.w}px / 键 ${look.create.w}px`);
  check('底下那一行说清了「20 人」和「你不下场」（必须有字的地方）',
    /20/.test(look.hint) && /不下场|不参|主持/.test(look.hint), look.hint);
  // 玩家 2026-09：「只有在打开了 Pro 的时候……出现《up to 20…》的字样，不开的时候没有」。
  check('没拨的时候那一行看不见', look.hintVisible === false, look.hintVisible ? '还在屏幕上' : '收起来了');
  // 站长 2026-10-14：「对于多人小屋中的开关直接去除那个字符就好，在开竞赛 / 开小屋之间切换和下方的小字提示就好」。
  check('没拨的时候开关上没有字', look.tagGone === true, look.tagGone ? '只剩一颗白点' : '条子上还有那个词');
  // 玩家 2026-09：「现在 contest/room 明显与这一行文字没有对齐。」上下边都量：只量一
  // 边的话，整块平移过去照样算「对齐」。
  // 修之前量到的是 −4px（英文）／−6px（中文），修之后三种语言都是 0，所以 1px 这道线
  // 两边都离得远：不会因为字体差一点就误报，也漏不掉那一跳。
  check('换掉的那个词和这一行字对齐',
    look.wordAlign && Math.abs(look.wordAlign.center) <= 1,
    JSON.stringify(look.wordAlign));
  // **上一版那个 bug**：白点拨过去之后整颗吊在条子外面（玩家拍到）。两个状态都量，
  // 而且量的是四条边的相对位置——「滑到底下」和「掉出条子」在纵坐标上只差这一点。
  check('关着的时候白点在条子里',
    look.knobIn && look.knobIn.top >= 0 && look.knobIn.bottom >= 0, JSON.stringify(look.knobIn));
  // 昵称那一格只准有一层字（占位那一句）。上一版标签和占位叠印在同一处——玩家那张
  // 截图上《你的名字》和《起个名字》糊成一团。
  check('昵称那一格只有一层字',
    look.nameLayers && look.nameLayers.phShown && look.nameLayers.spans.length === 0,
    JSON.stringify(look.nameLayers));
  // 四根条子的比例照设计稿（1 : 2.38）。上一版是 72×92 的矮方块，玩家一眼看出不是那张
  // 图。留一档宽松（2.0–2.8），矮屏幕那两档收过高度，但条子还是条子。
  check('屋号那四格是长条，比例和设计稿对得上',
    look.cell && look.cell.h / look.cell.w >= 2.0 && look.cell.h / look.cell.w <= 2.8,
    look.cell ? `${look.cell.w}×${look.cell.h} = 1 : ${(look.cell.h / look.cell.w).toFixed(2)}` : '没找到');
  check('那四格和上面那一块左右对齐（同一列）',
    look.cell && look.row && Math.abs(look.pinBox.x - look.row.x) <= 2,
    look.pinBox && look.row ? `条子 x=${look.pinBox.x} / 那一行 x=${look.row.x}` : '没找到');
  check('设置页没有被撑出横向滚动', look.overflowX === 0, `${look.overflowX}px`);
  check('这一页不摆底排（个人主页 / 记录与排名）', !look.navShown, look.navShown ? '还在' : '收起来了');

  // 拨一下：开关自己变，那颗键的字也跟着变成《开竞赛》。
  // 第二处是要紧的——按下去之后这一屋子的规矩不一样，而按键上写着什么是玩家按之前最后
  // 看的一样东西。
  const before = look.ctaLabel;
  await p.click('#mpContest');
  // 等那一下弹完再量白点。它走的是 .32s 的过冲曲线（style.css 的 .mp-contest-knob），
  // click() 一回来才刚起步——量到的会是静止位置，而那和「根本没动」一模一样。
  await p.waitForTimeout(450);
  const after = await p.evaluate(() => {
    const c = document.querySelector('#mpContest');
    const k = c?.querySelector('.mp-contest-knob');
    const box = (e) => { const r = e.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
    return {
      checked: c?.getAttribute('aria-checked'),
      ctaLabel: document.querySelector('#mpCreateLabel')?.textContent?.trim() ?? '',
      word: document.querySelector('#mpCreateWord')?.textContent?.trim() ?? '',
      knobY: c && k ? Math.round(k.getBoundingClientRect().top - c.getBoundingClientRect().top) : null,
      knobIn: (() => {
        if (!c || !k) return null;
        const a = c.getBoundingClientRect(), b = k.getBoundingClientRect();
        return { top: Math.round(b.top - a.top), bottom: Math.round(a.bottom - b.bottom) };
      })(),
      hintVisible: (() => {
        const h = document.querySelector('.mp-contest-hint');
        return !!h && getComputedStyle(h).visibility === 'visible';
      })(),
      hintBox: (() => { const h = document.querySelector('.mp-contest-hint'); return h ? box(h) : null; })(),
      pinBox: (() => { const r = document.querySelector('.mp-code-field .pin-row'); return r ? box(r) : null; })(),
      // 条子上不写字（站长 2026-10-14：去掉《Pro》，10-15 补充 K-2）：拨没拨都只有一颗白点。
      tagGone: !document.querySelector('.mp-contest-tag'),
      // 键上那三样的位置：句子头（连着那一格）、锁、招牌。换词的时候一个都不许挪。
      labelBox: (() => { const e = document.querySelector('#mpCreateLabel'); return e ? box(e) : null; })(),
      logoBox: (() => { const e = document.querySelector('#mpCreate .genius-logo--cta'); return e ? box(e) : null; })(),
      alt: document.querySelector('#mpCreateWord')?.getAttribute('data-alt') ?? '',
    };
  });
  check('拨过去：开关记住了', after.checked === 'true', String(after.checked));
  check('拨过去：那颗键的字换成了《开竞赛》',
    after.ctaLabel !== before && after.ctaLabel.length > 0, `${before} → ${after.ctaLabel}`);
  // 玩家 2026-09：「Open a room 中只有 room 一词动态被替换成了 contest」。所以键上除了
  // 那一个词，**其余一个字都不许动**——整句换掉也能让上面那条成立，这一条才咬得住。
  // （逐语种的那两条铁律由 check-room-word.mjs 在 CI 里盯着，这儿量的是真 DOM。）
  // 「只换了一段」怎么量：掐掉两头**一模一样**的部分，剩下中间那一截就是换掉的。
  // 不按空格切词——这道门跑的是中文（「开小屋」→「开竞赛」里一个空格都没有）。
  const head = (() => { let i = 0; while (i < before.length && before[i] === after.ctaLabel[i]) i++; return i; })();
  const tail = (() => {
    let i = 0;
    while (i < before.length - head && i < after.ctaLabel.length - head
           && before[before.length - 1 - i] === after.ctaLabel[after.ctaLabel.length - 1 - i]) i++;
    return i;
  })();
  const changedTo = after.ctaLabel.slice(head, after.ctaLabel.length - tail);
  check('拨过去：键上只换了那一个词，其余一个字没动',
    after.word.length > 0 && head + tail > 0 && changedTo === after.word,
    `「${before}」→「${after.ctaLabel}」：没动的有 ${head + tail} 个字，换掉的那一截是「${changedTo}」，` +
    `键上那个词是「${after.word}」`);
  // 白点真的滑到了下面。这一条钉的是它走 top（不是那个 Chrome 61 不认识的独立
  // translate 属性）——不走的话拨过去白点一动不动。
  check('拨过去：白点滑到了下面（不是原地不动）', after.knobY !== null && after.knobY >= 26,
    `白点离顶 ${after.knobY}px`);
  // **而且还在条子里**。上一版正是在这一步掉出去的：重排把它往下推了一整个词的高度，
  // 再加上那一下位移，整颗吊在条子外面 16px。
  check('拨过去：白点还在条子里（没掉出去）',
    after.knobIn && after.knobIn.top >= 0 && after.knobIn.bottom >= 0, JSON.stringify(after.knobIn));
  check('拨过去：那一行现身了', after.hintVisible === true, String(after.hintVisible));
  check('拨过去之后开关上仍然没有字', after.tagGone === true, after.tagGone ? '只有白点和换了的颜色' : '条子上冒出了那个词');
  // **换词的时候键上别的东西一个像素都不许挪**（玩家 2026-09：「前面 Open a 的部分和后
  // 面 logo 的部分固定位置，不要随着左右迁移」）。两个词宽度不一样，整行字会在那颗居中
  // 的键里重新居中一次——句子头和招牌于是各往外挪十几个像素。修法是那一格按两个词里较
  // 宽的那个预留宽度（style.css 里 .mp-swap 的 ::after），所以这儿量「宽度没变」和「位
  // 置没动」两样。
  const same = (u, v) => Boolean(u && v && u.x === v.x && u.w === v.w);
  check('拨过去：句子头那一段没挪，宽度也没变',
    same(look.labelBox, after.labelBox),
    `${JSON.stringify(look.labelBox)} → ${JSON.stringify(after.labelBox)}`);
  check('拨过去：右边那枚招牌没挪',
    same(look.logoBox, after.logoBox),
    `${JSON.stringify(look.logoBox)} → ${JSON.stringify(after.logoBox)}`);
  // 那把锁不量：它只长在**没开通**的设备上，而这道门这台是兑过码的（开屋要天才身份）。
  // 它和句子头在同一行、同一个居中的 flex 里，所以句子头那一条不动，它就不会动。
  // 预留的那个宽度靠 data-alt 上挂着**另一个**词。拨过去之后它必须换成刚换下来的那个
  // ——不换的话预留宽度变成当前这个词自己的宽度，格子会缩，照样是左右迁移。
  check('拨过去：data-alt 换成了刚换下来的那个词',
    after.alt.length > 0 && after.alt === look.word && after.alt !== after.word,
    `data-alt=「${after.alt}」，换下来的那个词是「${look.word}」，现在写着「${after.word}」`);
  // 「在现在的位置出现」——出现的时候位置不动，底下那四根条子也不许被顶下去。
  check('拨过去：那一行还在原处，四根条子一个像素没挪',
    look.hintBox && after.hintBox && look.pinBox && after.pinBox &&
      look.hintBox.y === after.hintBox.y && look.pinBox.y === after.pinBox.y,
    `那一行 ${look.hintBox?.y} → ${after.hintBox?.y} · 条子 ${look.pinBox?.y} → ${after.pinBox?.y}`);

  // 小屏（10-11 方案 C-8）：页底那颗《退出》钉在屏幕上（.page-exit），屋号四格在内容流里——屏幕一矮，两个就
  // 撞上。玩家实测 360×640 叠 2px、320×568 压住 73px；375×667 整页多出 51px。原因是矮屏那两档条子高度排在
  // 基础规则前面、从没生效过（style.css 里那段注释）。同一台手机换几种尺寸量，量完回到 390×844。
  for (const [w, h] of VIEWPORTS) {
    await p.setViewportSize({ width: w, height: h });
    await p.waitForTimeout(250);
    const m = await p.evaluate(`({ exit: (${RECT})('.mp-back') || (${RECT})('.page-exit'), cells: (${RECT})('.mp-code-field .pin-row'),
      over: document.documentElement.scrollHeight - innerHeight })`);
    check(`设置页 ${w}×${h}：页底的《退出》和屋号四格不相交`, m.exit && m.cells && !crosses(m.exit, m.cells),
      m.exit && m.cells ? `退出 ${Math.round(m.exit.top)}–${Math.round(m.exit.bottom)} · 四格 ${Math.round(m.cells.top)}–${Math.round(m.cells.bottom)}（整页多出 ${m.over}px）` : '没找到');
  }
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(250);
}

// ---- 2. 二十个人的竞赛屋：主持人没有棋盘，榜上没有他自己，而且摆得下 ------
{
  // 开关上面已经拨过去了，所以按那颗主键开出来的就是竞赛屋（一颗键两个档）。
  await p.click('#mpCreate');
  await p.waitForSelector('#mpPick', { timeout: 15000 });
  const code = await p.evaluate(() => document.body.textContent.match(/\b\d{4}\b/)?.[0]);
  check('竞赛屋开出来了，屋号在屏幕上', /^\d{4}$/.test(code || ''), String(code));
  const joined = await p.evaluate(async (code) => {
    const keys = [];
    for (let i = 1; i <= 20; i++) {
      const r = await fetch('/api/room', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'join', code, name: '选手' + String(i).padStart(2, '0'), seen: ['square', 'circle', 'triangle'] }),
      }).then((x) => x.json());
      if (r.playerToken) keys.push({ playerId: r.playerId, playerToken: r.playerToken });
    }
    window.__keys = keys;
    return keys.length;
  }, code);
  check('二十名选手都进来了（连主持人二十一个，坐满）', joined === 20, `进了 ${joined} 个`);
  await p.waitForTimeout(1800);
  const roster = await p.evaluate(() => ({
    rows: document.querySelectorAll('.mp-player').length,
    seats: (document.body.textContent.match(/\d+\s*\/\s*20/) || [])[0] ?? '（没找到 n/20）',
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  // 名单上是二十一行（连主持人），而屏幕上那个「几/几」数的是**选手**：满员写
  // 「20/20」，不是「21/21」——那行小字写的就是「最多 20 人」。
  check('小屋名单上二十一个人都在，而屏幕上写的是 20/20', roster.rows === 21 && /20\s*\/\s*20/.test(roster.seats),
    `${roster.rows} 行 · ${roster.seats}`);
  check('小屋页没有被撑出横向滚动', roster.overflowX === 0, `${roster.overflowX}px`);
  // 小屏（10-11 方案 C-8）：二十一个名字在名单自己里面滚，《去主菜单选玩法》不用滑就在屏幕上（玩家实测
  // 390×844 上它落在 1318px）。「在屏幕上」是整颗键在屏幕里、而且不压在底排那两颗图标底下；名单滚到底，
  // 最后一个人整行露得出来。
  for (const [w, h] of VIEWPORTS) {
    await p.setViewportSize({ width: w, height: h });
    await p.waitForTimeout(250);
    const m = await p.evaluate(`(() => {
      window.scrollTo(0, 0);
      const list = document.querySelector('#mpPlayers');
      const nav = document.querySelector('.home-nav');
      const navTop = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().top : innerHeight;
      const pick = (${RECT})('#mpPick');
      list.scrollTop = list.scrollHeight;
      const rows = list.querySelectorAll('.mp-player');
      const last = rows[rows.length - 1].getBoundingClientRect();
      const box = list.getBoundingClientRect();
      const out = { pick, navTop, vh: innerHeight, scrolls: list.scrollHeight - list.clientHeight,
        lastIn: last.top >= box.top - 1 && last.bottom <= box.bottom + 1, rows: rows.length };
      list.scrollTop = 0;
      return out;
    })()`);
    check(`小屋页 ${w}×${h}：《去主菜单选玩法》不用滑就在屏幕上（不压在底排底下）`,
      m.pick && m.pick.top >= 0 && m.pick.bottom <= Math.min(m.vh, m.navTop) + 0.5,
      m.pick ? `键 ${Math.round(m.pick.top)}–${Math.round(m.pick.bottom)} · 底排顶 ${Math.round(m.navTop)} · 屏高 ${m.vh}` : '没找到');
    check(`小屋页 ${w}×${h}：名单在自己里面滚，最后一个人滚得出来`, m.rows === 21 && m.scrolls > 0 && m.lastIn,
      `${m.rows} 行 · 可滚 ${m.scrolls}px · 最后一行${m.lastIn ? '整行可见' : '露不全'}`);
  }
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(250);

  // 主持人叫什么——下面几条量的就是「选手那边的屏幕上没有这个名字」。
  const hostName = await p.evaluate(async (code) => {
    const k = window.__keys[0];
    const st = await fetch('/api/room', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'state', code, ...k }),
    }).then((x) => x.json());
    return (st.players || []).find((pl) => pl.isHost)?.name ?? null;
  }, code);
  check('（尺子）主持人的名字拿得到', Boolean(hostName), String(hostName));

  await pickSquare(p);
  const onPanel = await p.waitForSelector('#mpWait', { timeout: 25000 }).then(() => true).catch(() => false);
  check('主持人被送上实时榜单（不是棋盘）', onPanel);
  // 等这一局真打起来再报分：倒数里报上去的分服务器记 0（10-11 方案 C-1——那会儿一步都还没走，报上来的分不
  // 可能是打出来的）。这道门原先就是在倒数里替大家报的。「按住不等了」只在这一局打起来之后露面，拿它当
  // 「打起来了」的记号。
  const forceUp = await p.waitForFunction(() => { const f = document.querySelector('#mpWaitForce'); return f && !f.hidden; },
    { timeout: 20000 }).then(() => true).catch(() => false);
  check('（尺子）这一局打起来了，「按住不等了」露面了', forceUp);
  // 二十个人各报一个分，榜单才有东西可排。最后一位（选手20，分最高）先不交卷：全交了这一局当场结束，主持人
  // 就被送回小屋页，下面这一屏量不到了。
  await p.evaluate(async (code) => {
    const keys = window.__keys || [];
    for (let i = 0; i < keys.length; i++) {
      const last = i === keys.length - 1;
      await fetch('/api/room', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'score', code, ...keys[i], score: (i + 1) * 37, finished: !last, seconds: 20 + i, round: 1 }),
      });
    }
  }, code);
  await p.waitForTimeout(2500);
  const panel = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('#mpWaitRows .mp-player')];
    const box = document.querySelector('#mpWaitRows');
    const stage = document.querySelector('.mp-wait-stage');
    const br = box.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const leave = document.querySelector('#mpWaitLeave').getBoundingClientRect();
    return {
      hasBoard: Boolean(document.querySelector('#boardWrap .tile')),
      rows: rows.length,
      top3: rows.slice(0, 3).map((e) => e.textContent.replace(/\s+/g, ' ').trim()),
      leaveLabel: document.querySelector('#mpWaitLeave').textContent.trim(),
      stage: { h: Math.round(sr.height), top: Math.round(sr.top), bottom: Math.round(sr.bottom) },
      boxH: Math.round(br.height),
      boxScrolls: box.scrollHeight - box.clientHeight,
      rowOverflowX: rows.reduce((m, e) => Math.max(m, e.scrollWidth - e.clientWidth), 0),
      leaveOnScreen: leave.top >= 0 && leave.bottom <= window.innerHeight,
      vh: window.innerHeight,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  check('主持人手上没有棋盘', panel.hasBoard === false);
  check('榜上是二十名选手，没有主持人自己', panel.rows === 20, `${panel.rows} 行`);
  check('榜按分数排（第一名是分最高的那个）', /选手20/.test(panel.top3[0] || ''), panel.top3.join(' | '));
  check('那颗键上写的是《解散小屋》（他按下去做的就是这件事）',
    panel.leaveLabel.includes('解散'), panel.leaveLabel);
  // 排版那三条。这一节就是 api/room.js 开头「先把排版摆好再放入口」那句话的门。
  check('整块榜单摆在屏幕里（不再被挤出去）',
    panel.stage.top >= 0 && panel.stage.bottom <= panel.vh + 1,
    `舞台 ${panel.stage.h}px：${panel.stage.top}→${panel.stage.bottom}，屏高 ${panel.vh}`);
  check('名单自己滚（十九行滚得到最后一名）', panel.boxScrolls > 100,
    `可滚 ${panel.boxScrolls}px（盒子 ${panel.boxH}px）`);
  check('《解散小屋》没被挤出屏幕', panel.leaveOnScreen);
  check('一行都没有横向溢出，整页也没有', panel.rowOverflowX === 0 && panel.overflowX === 0,
    `行 ${panel.rowOverflowX}px / 页 ${panel.overflowX}px`);

  // 小屏（10-11 方案 C-8）：「按住不等了」那颗键上的字是一行（原先一字一行竖排，390×844 上也是），键整颗在
  // 屏幕里。这台是简体；英、法那两句更长，就地把键上的字换成那两句再量一遍（量的是样式摆不摆得下，字从
  // i18n.ts 现读）。
  const i18nOut = join(tmpdir(), `check-room-contest-ui-i18n-${process.pid}.mjs`);
  await build({
    stdin: { contents: "export { STRINGS } from './src/i18n.ts';", resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' },
    bundle: true, format: 'esm', outfile: i18nOut, logLevel: 'error',
  });
  const { STRINGS } = await import(pathToFileURL(i18nOut).href);
  for (const [w, h] of VIEWPORTS) {
    await p.setViewportSize({ width: w, height: h });
    await p.waitForTimeout(250);
    for (const lang of ['zhHans', 'en', 'fr']) {
      const m = await p.evaluate(([label]) => {
        const f = document.querySelector('#mpWaitForce');
        const span = f?.querySelector('span') || f;
        if (!f || !span) return null;
        const before = span.textContent;
        span.textContent = label;
        const r = document.createRange();
        r.selectNodeContents(span);
        const lines = new Set([...r.getClientRects()].map((q) => Math.round(q.top))).size;
        const t = r.getBoundingClientRect();
        const b = f.getBoundingClientRect();
        const lv = document.querySelector('#mpWaitLeave').getBoundingClientRect();
        span.textContent = before;
        // 字整段在键里（原先这颗键被 `button { flex: 1 }` 分窄了，法语那句比键宽 70px，压到旁边那颗上），
        // 键整颗在屏幕里，也不和《解散小屋》相交。
        const overlap = b.left < lv.right - 0.5 && lv.left < b.right - 0.5 && b.top < lv.bottom - 0.5 && lv.top < b.bottom - 0.5;
        return { lines, left: b.left, right: b.right, w: Math.round(b.width), vw: innerWidth,
          textIn: t.left >= b.left - 0.5 && t.right <= b.right + 0.5, textW: Math.round(t.width),
          leaveIn: lv.left >= 0 && lv.right <= innerWidth, overlap };
      }, [STRINGS[lang].mpStopWaitingHold]);
      check(`实时榜 ${w}×${h}（${lang}）：「${STRINGS[lang].mpStopWaitingHold}」一行、整段在键里，键在屏幕里、不压《解散小屋》`,
        m && m.lines === 1 && m.textIn && m.left >= 0 && m.right <= m.vw && m.leaveIn && !m.overlap,
        m ? `${m.lines} 行 · 字宽 ${m.textW}px · 键宽 ${m.w}px（${Math.round(m.left)}–${Math.round(m.right)} / ${m.vw}）${m.overlap ? ' · 压着旁边那颗' : ''}` : '没找到那颗键');
    }
  }
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(250);

  // 选手20 交卷：第一局收掉，下面才开得了第二局。
  await p.evaluate(async (code) => {
    const keys = window.__keys || [];
    const k = keys[keys.length - 1];
    await fetch('/api/room', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'score', code, ...k, score: keys.length * 37, finished: true, seconds: 20 + keys.length, round: 1 }),
    });
  }, code);
  // 第二局的倒数那一屏：上一局的总分榜（ui/multiplayer.ts 的 standingsStrip）列的是**全部**
  // 选手，所以主持人在不在这张榜上一眼就看得见（第 14 推）。另一台选手的手机（选手06）回到
  // 屋里，主持人从接口开第二局。
  const D = await contestantPage(code, (await p.evaluate(() => window.__keys[5])));
  // 小屏那几台（10-11 方案 C-8）：每种尺寸一台选手的手机，各拿一把座位，和选手06 一起等第二局的倒数。
  const smalls = [];
  for (const [i, size] of VIEWPORTS.entries()) {
    smalls.push({ size, ...(await contestantPage(code, (await p.evaluate((n) => window.__keys[n], 6 + i)), size)) });
  }
  await D.c.waitForTimeout(1500);
  const started = await p.evaluate(async (code) => {
    const seat = JSON.parse(localStorage.getItem('slides_mp_seat') || '{}');
    const r = await fetch('/api/room', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'start', code, playerId: seat.playerId, playerToken: seat.playerToken, mode: 'square' }),
    });
    return r.status;
  }, code);
  check('（尺子）第二局开起来了', started === 200, String(started));
  const strip = await D.c.waitForSelector('.mp-cd-row', { timeout: 20000 }).then(() => true).catch(() => false);
  check('（尺子）选手那台的倒数页上摆出了上一局的总分榜', strip);
  const cd = await D.c.evaluate(() => [...document.querySelectorAll('.mp-cd-row .mp-cd-name')].map((e) => e.textContent.trim()));
  check('倒数那一屏的总分榜：二十名选手，没有主持人（第 14 推）', cd.length === 20 && !cd.includes(hostName),
    `${cd.length} 行 · ${cd.includes(hostName) ? '主持人在榜上' : '没有主持人'}`);
  // 小屏（10-11 方案 C-8）：二十行的总分榜不和倒数那张数字卡、上面那张玩法图叠在一起（原先 390×844 上就
  // 叠着），榜整块在屏幕里，滚到底最后一名整行露得出来（原先 320×568 上只看得到 16 名、滚不到）。倒数只有
  // 四秒半，几台是一起摆好、一起量的。
  const measured = await Promise.all(smalls.map(async ({ size, c }) => {
    const up = await c.waitForSelector('.mp-cd-row', { timeout: 20000 }).then(() => true).catch(() => false);
    if (!up) return { size, m: null };
    const m = await c.evaluate(`(() => {
      const board = document.querySelector('.mp-cd-board');
      const rows = board.querySelectorAll('.mp-cd-row');
      board.scrollTop = board.scrollHeight;
      const last = rows[rows.length - 1].getBoundingClientRect();
      const box = board.getBoundingClientRect();
      return { board: (${RECT})('.mp-cd-board'), win: (${RECT})('.cd-window'), marks: (${RECT})('.start-emblem .start-marks'),
        rows: rows.length, vh: innerHeight, lastIn: last.top >= box.top - 1 && last.bottom <= box.bottom + 1,
        over: document.documentElement.scrollHeight - innerHeight };
    })()`);
    return { size, m };
  }));
  for (const { size: [w, h], m } of measured) {
    check(`选手倒数页 ${w}×${h}：（尺子）总分榜摆出来了，二十行`, m && m.rows === 20, m ? `${m.rows} 行` : '没等到');
    if (!m) continue;
    check(`选手倒数页 ${w}×${h}：总分榜不和倒数那张数字卡、玩法图叠在一起`, !crosses(m.board, m.win) && !crosses(m.board, m.marks),
      `榜 ${Math.round(m.board.top)}–${Math.round(m.board.bottom)} · 数字卡 ${Math.round(m.win.top)}–${Math.round(m.win.bottom)} · 图 ${Math.round(m.marks.top)}–${Math.round(m.marks.bottom)}`);
    check(`选手倒数页 ${w}×${h}：榜整块在屏幕里，滚到底最后一名整行露得出来`,
      m.board.top >= 0 && m.board.bottom <= m.vh + 0.5 && m.lastIn,
      `榜底 ${Math.round(m.board.bottom)} / 屏高 ${m.vh} · 最后一行${m.lastIn ? '整行可见' : '露不全'}（整页多出 ${m.over}px）`);
  }
  for (const { cctx } of smalls) await cctx.close();
  await D.cctx.close();
}
await ctx.close();

// ---- 2a. 选手那台的局中计分板上没有主持人（第 14 推）----------------------------
//
// 另开一间小的竞赛屋（三名选手打接口进来，一名开着真页面），主持人从接口开第一局。开局时人
// 人都是 0 分，主持人坐的是 0 号椅子——没过滤的话，他就是那块板上的「第一名」（反证量过：
// 板上写的是「A / 选手01」）。
//
// 不放在上面那间二十人的屋里：一台真在打的选手页面会改变那一局收尾时主持人那边的走向（全
// 屋交完卷时他被送回小屋页），上面那几条量榜单的就量不到了。
{
  const { ctx: c3, p: p3 } = await hostPage('TESTHALF');
  await p3.click('#mpContest');
  await p3.click('#mpCreate');
  await p3.waitForSelector('#mpPick', { timeout: 15000 });
  const code3 = await p3.evaluate(() => document.body.textContent.match(/\b\d{4}\b/)?.[0]);
  const keys3 = await p3.evaluate(async (code) => {
    const keys = [];
    for (let i = 1; i <= 3; i++) {
      const r = await fetch('/api/room', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'join', code, name: '选手' + String(i).padStart(2, '0'), seen: ['square', 'circle', 'triangle'] }),
      }).then((x) => x.json());
      if (r.playerToken) keys.push({ playerId: r.playerId, playerToken: r.playerToken });
    }
    return keys;
  }, code3);
  check('（尺子）小竞赛屋：三名选手都进来了', keys3.length === 3, `${keys3.length} 个`);
  const host3 = await p3.evaluate(async ([code, k]) => {
    const st = await fetch('/api/room', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'state', code, ...k }),
    }).then((x) => x.json());
    return (st.players || []).find((pl) => pl.isHost)?.name ?? null;
  }, [code3, keys3[0]]);
  const C = await contestantPage(code3, keys3[0]);
  await C.c.waitForTimeout(1500);
  const started3 = await p3.evaluate(async (code) => {
    const seat = JSON.parse(localStorage.getItem('slides_mp_seat') || '{}');
    const r = await fetch('/api/room', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'start', code, playerId: seat.playerId, playerToken: seat.playerToken, mode: 'square' }),
    });
    return r.status;
  }, code3);
  check('（尺子）小竞赛屋：第一局开起来了', started3 === 200, String(started3));
  const board = await C.c.waitForSelector('.mp-board-row .mp-board-name', { timeout: 30000 }).then(() => true).catch(() => false);
  check('（尺子）选手那台进了棋盘，局中计分板画出来了', board);
  const boardNames = await C.c.evaluate(() => [...document.querySelectorAll('.mp-board-row .mp-board-name')].map((e) => e.textContent.trim()));
  check('选手局中那块计分板上没有主持人（第 14 推）', boardNames.length > 0 && !boardNames.includes(host3),
    `${boardNames.join(' / ')}（主持人：${host3}）`);
  // 选手交卷之后那一屏（ui/scoreboard.ts 开的等待页）：榜上也没有主持人（10-11 方案 C-7）。原先那一层靠调用方
  // 传 hideId 才不列他——主持人自己那一屏传了，这一屏没传，主持人就以一行 0 分挂在选手的等待页上。
  await C.c.click('#finishBtn');
  await C.c.waitForSelector('#finishConfirm', { timeout: 6000 }).catch(() => {});
  await C.c.click('#mpFinishYes').catch(() => {});
  const waitUp = await C.c.waitForSelector('#mpWait #mpWaitRows .mp-player', { timeout: 15000 }).then(() => true).catch(() => false);
  check('（尺子）选手交了卷，进了等待页', waitUp);
  const waitNames = await C.c.evaluate(() => [...document.querySelectorAll('#mpWaitRows .mp-player')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  check('选手交卷之后那一屏的榜上：三名选手，没有主持人（10-11 方案 C-7）',
    waitNames.length === 3 && !waitNames.some((t) => host3 && t.includes(host3)),
    `${waitNames.length} 行 · ${waitNames.join(' / ')}（主持人：${host3}）`);
  await C.cctx.close();
  await c3.close();
}

// ---- 2b. 终局面板（屋主散场、选手原地转单人之后结算页上那一块）也走同一道过滤 ----
//
// 那一块（ui/roomLeftover.ts）只在「屋主中途散场、这一局转成单人打完」时才出现，要在真界面
// 上走到那儿得把一整局打完。它和上面几处用的是同一个函数（roomCard.ts 的 contestants），
// 所以这儿读源码钉住「名单和全屋总分都从 contestants 来」。
{
  const { readFileSync } = await import('node:fs');
  const left = readFileSync(new URL('../src/ui/roomLeftover.ts', import.meta.url), 'utf8');
  check('终局面板的名单和全屋总分都只算选手（contestants）',
    /const players = contestants\(state\);/.test(left) && /rankRoom\(players\)/.test(left) &&
      /players\.reduce\(/.test(left) && !/state\.players\.reduce\(/.test(left) && !/rankRoom\(state\.players\)/.test(left));
  // 结算页上那张单局战绩图（engine/gameController.ts 的 roundStandings）也是同一道过滤（10-09 补充方案
  // 7-13 第 4 条）。它是画在 canvas 上的一张图，名字读不出来，所以也读源码：那个函数里只许有
  // contestants(state)，不许再直接碰 state.players（原先就是这一句，主持人以 0 分挂在图上最后一名）。
  const ctl = readFileSync(new URL('../src/engine/gameController.ts', import.meta.url), 'utf8');
  const from = ctl.indexOf('function roundStandings(');
  const fn = from < 0 ? '' : ctl.slice(from, ctl.indexOf('\n  }\n', from));
  check('单局战绩图的名次也只列选手（gameController.ts 的 roundStandings 走 contestants）',
    /contestants\(state\)/.test(fn) && !/state\.players/.test(fn), fn ? '' : '没找到 roundStandings');
}

// ---- 3. 对照：普通八人屋照旧，屋主拿得到棋盘 ------------------------------
//
// 少了这一节，把《开小屋》也接成竞赛屋都是全绿的。
{
  const { ctx: c2, p: p2 } = await hostPage('TESTYEAR');
  await p2.click('#mpCreate');
  await p2.waitForSelector('#mpPick', { timeout: 15000 });
  const code = await p2.evaluate(() => document.body.textContent.match(/\b\d{4}\b/)?.[0]);
  const seats = await p2.evaluate(() => (document.body.textContent.match(/\d+\s*\/\s*\d+/) || [])[0]);
  check('普通屋还是 /8', /\/\s*8/.test(seats || ''), String(seats));
  await p2.evaluate(async (code) => {
    await fetch('/api/room', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'join', code, name: '客人', seen: ['square', 'circle', 'triangle'] }),
    });
  }, code);
  await p2.waitForTimeout(1500);
  await pickSquare(p2);
  const got = await p2.waitForFunction(() => document.querySelectorAll('#boardWrap .tile').length > 0, { timeout: 25000 })
    .then(() => true).catch(() => false);
  check('普通屋照旧：屋主拿得到棋盘（这一改没碰八人屋）', got);
  await c2.close();
}

console.log(errs.length ? '\n页面报错：' + errs.slice(0, 3).join(' | ') : '\n全程零报错');
await browser.close();
process.exit(fail ? 1 : 0);

/**
 * 竞赛小屋，在真界面上跑一遍（要 dev-server + Chromium）。
 *
 *   node scripts/dev-server.mjs 8923 dist
 *   node scripts/check-room-contest-ui.mjs http://localhost:8923/
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
 *
 * 十九个选手是直接打接口进来的（同源 fetch），不是开十九个浏览器——要量的是
 * 屏幕上摆不摆得下，不是十九台设备的联机。
 */
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://localhost:8923/';
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
      .find((b) => (b.getAttribute('aria-label') || '').startsWith('方块'))
      ?.click();
  });
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
      // 条子上那个词只在拨开的时候出现（关着的时候这根条子上只有一颗白点）。
      tagVisible: (() => {
        const t = document.querySelector('.mp-contest-tag');
        return !!t && getComputedStyle(t).visibility === 'visible';
      })(),
      // 键上那三样的位置：句子头（连着那一格）、锁、招牌。换词的时候一个都不许挪。
      labelBox: (() => { const e = document.querySelector('#mpCreateLabel'); return e ? box(e) : null; })(),
      logoBox: (() => { const e = document.querySelector('#mpCreate .genius-logo--cta'); return e ? box(e) : null; })(),
      word: document.querySelector('#mpCreateWord')?.textContent?.trim() ?? '',
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
  // 玩家 2026-09：「Pro 的开关只在打开的时候显示《Pro》，关闭的时候什么都不显示。」
  check('没拨的时候条子上不显示《Pro》', look.tagVisible === false, look.tagVisible ? '还写着' : '只剩一颗白点');
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
      // 条子上那个词只在拨开的时候出现（关着的时候这根条子上只有一颗白点）。
      tagVisible: (() => {
        const t = document.querySelector('.mp-contest-tag');
        return !!t && getComputedStyle(t).visibility === 'visible';
      })(),
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
  check('拨过去：条子上这才写出《Pro》', after.tagVisible === true, String(after.tagVisible));
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

  await pickSquare(p);
  const onPanel = await p.waitForSelector('#mpWait', { timeout: 25000 }).then(() => true).catch(() => false);
  check('主持人被送上实时榜单（不是棋盘）', onPanel);
  // 十九个人各报一个分，榜单才有东西可排。
  await p.evaluate(async (code) => {
    const keys = window.__keys || [];
    for (let i = 0; i < keys.length; i++) {
      await fetch('/api/room', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'score', code, ...keys[i], score: (i + 1) * 37, finished: true, seconds: 20 + i, round: 1 }),
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
}
await ctx.close();

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

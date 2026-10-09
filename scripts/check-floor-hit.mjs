/**
 * 地板收窄之后，原来那一格的范围还按得动吗？那圈补回来的余量有没有压住按键？
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8815 dist
 *   node scripts/check-floor-hit.mjs http://localhost:8815/
 *
 * 要开浏览器，所以留在本地手跑，不进 CI（同 check-board-fit）。
 *
 * ── 为什么要有这道门 ────────────────────────────────────────────────────
 *
 * 2026-09 地板（.board-wrap）从「只收成正方形」改成「贴着棋盘收」
 * （engine/boardResize.ts 的 fitFloor），为的是去掉宽棋盘上下那条空地板——
 * 1920 上七色圆球空 76px，V 形三角空 234px。
 *
 * 可拖拽是听在地板这个元素上的（engine/drag.ts 的 attachDrag(refs.boardWrap)），
 * 而各副棋盘的 cellAt 拿到坐标之后找的是**最近**的那一格、从不说「没抓到」
 * ——所以地板比棋盘大出来的那一圈，一直在当「手指落偏了也算」的余量。地板一
 * 收，那圈余量就跟着没了：V 形三角在手机上只有 122px 高，一横排不到 20px，手指
 * 高出去二十像素就什么都不会发生。那正是「不要让玩家出现意料之外的疏漏操作」。
 *
 * 补回来的办法是一块透明的 `.board-wrap::before`（见 style.css），伪元素在命中
 * 测试上算它的宿主。这里量的就是它真的管用，两件事各钉一条：
 *
 *   ① 板子外一圈（原来那一格之内）按下去，落在地板上，而且真的能拖动棋子；
 *   ② 那一圈压不住别人——它是个 position: absolute 的东西，没有 z-index 的话会
 *      盖在没定位的兄弟（底下那颗《暂停》、顶上那两块 HUD）上面，按键当场按不动。
 *
 * 反例试过的结果，照实记：
 *   · 拿掉 `.app--game` 上的 isolation: isolate → ①当场红六行：那一圈跑到这一页
 *     的底色**底下**去了，elementFromPoint 在它上面返回 .app--game，手指按上去
 *     什么都不会发生。这是真出过的，第一版就是这样。
 *   · 把 ::before 的 z-index: -1 去掉 → ②**不红**。原因是今天这一圈伸出去的那点
 *     距离（最多 234px）还够不到底下那排键。所以 ② 这两行是防将来的哨兵，不是
 *     现在能复现的事故：哪天这一圈伸得更远、或者哪个配件挪近了，它立刻会红。留
 *     着它不要紧，但别把它当成「z-index 有人看着」的证据。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8815/';

const VPS = [
  { w: 390, h: 844, name: '竖屏 390×844' },
  { w: 1920, h: 1080, name: '电脑 1920×1080' },
];

/**
 * 三副：两副地板会收的（宽棋盘），加一副不会收的当对照。
 * 方块的地板本来就和棋盘一样大，收不掉——那一圈余量是 0，这一条量的是「没收的
 * 时候也不许出事」。
 */
/**
 * 探哪几副：一副**收得最狠**的、一副中等的、一副一点没收的（方块的地板本来就是正方
 * 形，收不掉，留着当对照——「不用探」那几行说明这道门认得出哪几边该探）。
 *
 * 原先第一位是《进阶三角》（V 形）：它是收得最狠的一副（1920 上上下各空 234px），
 * 可《侵蚀阶梯》v1.2 PR-6 把它删了，这一行从那天起一直红着两条「主菜单上没有《进阶
 * 三角》」——红的不是它守的那件事。收得最狠的现在是《大三角》（六边蜂窝 54，它是天才
 * 特供，上面已经种过权益）。
 */
const BOARDS = ['六边形三角', '菱形小球', '经典方块'];

/** 往板子外面探这么远。比这个再远就不是「落偏了」而是「按到别处去了」。 */
const REACH = 24;

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

for (const vp of VPS) {
  for (const name of BOARDS) {
    const lead = `${vp.name} ${name}`;
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, hasTouch: true });
    await ctx.addInitScript(() => {
      localStorage.setItem('slides_lang', 'zhHans');
      localStorage.setItem(
        'slides_genius',
        JSON.stringify({ active: true, channel: 'code', until: Date.now() + 365 * 24 * 3600 * 1000 }),
      );
      // 每个玩法都算开过：教学条和首玩封锁都不掺进来。
      for (const k of ['square', 'circle', 'triangle', 'timed', 'bomb', 'flip', 'slot', 'layout', 'puzzle'])
        localStorage.setItem('slides_played_' + k, '1');
    });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
    const labels = await page.$$eval('.home-icon-btn', (els) =>
      els.map((e) => e.getAttribute('aria-label') || ''));
    const i = labels.findIndex((l) => l === name);
    if (i < 0) {
      check(`${lead}：开得起来`, false, `主菜单上没有《${name}》`);
      await ctx.close();
      continue;
    }
    await page.$$eval('.home-icon-btn', (els, k) => els[k].click(), i);
    const started = await page
      .waitForFunction(
        () => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball, #boardWrap .tri').length > 0,
        { timeout: 25000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!started) {
      check(`${lead}：开得起来`, false, '点开了但没进到棋盘');
      await ctx.close();
      continue;
    }
    // 开局那一屏的 4-3-2-1 还在的话，这一拖是按在遮罩上——等它退场。
    await page.waitForFunction(() => !document.querySelector('.overlay--start.show'), { timeout: 30000 });
    await page.waitForTimeout(600);

    const m = await page.evaluate((reach) => {
      const wrap = document.querySelector('#boardWrap');
      const b = wrap.getBoundingClientRect();
      const hit = (x, y) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return 'null';
        if (el === wrap || wrap.contains(el)) return '地板';
        if (el.closest('#stopBtn')) return '暂停键';
        return el.id ? '#' + el.id : el.getAttribute('class') || el.tagName;
      };
      const btn = document.querySelector('#stopBtn')?.getBoundingClientRect();
      // **量的是 HUD 右边那一块《得分图案》，不是棋盘上方那条得分图示带。**
      // 那条带子《侵蚀阶梯》v1.2 PR-7 退役了，这儿原先找的 `.pattern-hint--a` 从那天
      // 起一直取不到——于是这一条走的是「这一局没有图示」那一支，**永远绿着**。
      // 而它守的那件事一点没变：地板补回来的那一圈是个 position: absolute 的东西，
      // 没有 z-index 就会盖在没定位的兄弟上面。棋盘上方现在坐着的正是那两块 HUD。
      const hintEl = document.querySelector('.hud-block--pattern');
      const hint = hintEl?.getBoundingClientRect();
      const trimY = parseFloat(getComputedStyle(wrap).getPropertyValue('--floor-trim-y')) || 0;
      const trimX = parseFloat(getComputedStyle(wrap).getPropertyValue('--floor-trim-x')) || 0;
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      return {
        floor: `${Math.round(b.width)}×${Math.round(b.height)}`,
        trim: `收掉 ${Math.round(trimX)}/${Math.round(trimY)}`,
        // 只探真的收掉了的那几边——没收的边外面本来就不该是地板。
        up: trimY > reach ? hit(cx, b.y - reach) : '不用探',
        down: trimY > reach ? hit(cx, b.bottom + reach) : '不用探',
        left: trimX > reach ? hit(b.x - reach, cy) : '不用探',
        right: trimX > reach ? hit(b.right + reach, cy) : '不用探',
        onBtn: btn ? hit(btn.x + btn.width / 2, btn.y + btn.height / 2) : '没这颗键',
        onHint: hint && hint.width > 0
          ? (() => {
              const el = document.elementFromPoint(hint.x + hint.width / 2, hint.y + hint.height / 2);
              return el && el.closest('.hud-block--pattern') ? '得分图案块' : hit(hint.x + hint.width / 2, hint.y + hint.height / 2);
            })()
          : '这一屏没有那一块',
        box: { x: b.x, y: b.y, w: b.width, h: b.height },
        trimYpx: trimY,
      };
    }, REACH);

    const outside = [m.up, m.down, m.left, m.right];
    const bad = outside.filter((v) => v !== '地板' && v !== '不用探');
    check(
      `${lead}：板子外 ${REACH}px 还按在地板上`,
      bad.length === 0,
      `${m.floor} ${m.trim} → ${outside.join(' / ')}`,
    );

    // 尺子：那两个都得真的量到。找不到《得分图案》那一块就说明选择器又过期了
    // ——这一条上一次就是这么空绿了一整个版本的。
    check(`${lead}：《暂停》和《得分图案》那一块都在屏幕上（尺子）`,
      m.onBtn !== '没这颗键' && m.onHint !== '这一屏没有那一块',
      `暂停 → ${m.onBtn}；图案块 → ${m.onHint}`);
    check(
      `${lead}：那一圈没挡住《暂停》和《得分图案》那一块`,
      m.onBtn === '暂停键' && m.onHint === '得分图案块',
      `暂停 → ${m.onBtn}；图案块 → ${m.onHint}`,
    );

    // 真按下去拖一把。只有确实收掉了一圈的棋盘才试得着——没收的（方块）板子外面
    // 本来就不是地板。
    if (m.trimYpx > REACH) {
      const boxes = () =>
        page.$$eval('#board > *', (els) =>
          els.map((e) => {
            const r = e.getBoundingClientRect();
            return Math.round(r.x) + ',' + Math.round(r.y);
          }).join('|'));
      const before = await boxes();
      const x = m.box.x + m.box.w / 2;
      const y = m.box.y - 20;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 70, y, { steps: 8 });
      const during = await boxes();
      await page.mouse.up();
      check(`${lead}：从板子上方 20px 按下去拖，棋子真的跟着动`, during !== before);
    }
    await ctx.close();
  }
}

await browser.close();
console.log(fail ? `\n${fail} 项没过` : '\nALL PASS');
process.exit(fail ? 1 : 0);

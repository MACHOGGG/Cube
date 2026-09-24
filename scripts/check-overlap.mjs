/**
 * 谁被挡住了。
 *
 *   node scripts/dev-server.mjs 8815 dist
 *   node scripts/check-overlap.mjs http://localhost:8815/
 *
 * 页面上有两件常驻家具：顶上那块 Slides 招牌（sticky）和底下那排图标
 * （fixed）。它们浮在内容之上，所以任何一页都可能有东西正好躲在它们底下。
 *
 * 这里查的不是「有没有重叠过」——一页内容从招牌底下滚过去是正常的，那正是
 * sticky 的意思。查的是「够不够得着」：
 *
 *   · 把页面滚到最底，还压在底下那排图标下面的按钮，是永远按不到的；
 *   · 把页面滚到最顶，还压在招牌下面的字，是永远看不全的。
 *
 * 四种语言各查一遍，因为德语一样的长词、中文一样的紧凑，会让同一页在一种
 * 语言里刚好、在另一种语言里差半行。竖屏横屏各查一遍，因为横过来之后可用
 * 的高度只剩一半。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2];
if (!BASE) {
  console.error('用法: node scripts/check-overlap.mjs http://localhost:8815/');
  process.exit(2);
}

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const LANGS = ['zhHans', 'zhHant', 'en', 'fr'];
// 手机两种拿法，加两台真实的电脑。电脑那两台不是凑数：主菜单的卡片有多大
// 是按「屏幕还剩多高」算出来的，只有把真实的高度放进来，算错才会露馅。
// 1366×768 是最挤的那类笔记本，1920×1080 是最常见的那块外接屏。
const SIZES = [
  { name: '竖屏', width: 390, height: 844 },
  { name: '横屏', width: 844, height: 390 },
  { name: '笔记本', width: 1366, height: 768 },
  { name: '大屏', width: 1920, height: 1080 },
  // 一台小屏安卓，而且是算掉地址栏、工具栏之后的可视高度——弹窗高不高得过
  // 屏幕，就差在这几十像素上。
  { name: '小手机', width: 360, height: 640 },
  // 横屏里最窄的那一档（老式小屏，同样是算掉浏览器那几条之后的可视尺寸）。
  //
  // 补这一条是因为它一直没人看过：上面那个「横屏」是 844×390，check-menu
  // 只量 390×844，于是宽版那套排布最窄的一端从来没进过任何一道门。而
  // 2026-09 主菜单第二排从五张改成六张（WIDE_PER_ROW），卡片宽度的算式跟着
  // 从 (100vw-88)/5 换成 (100vw-102)/6——568 这一档一张卡由 96px 掉到 78px，
  // 改的人和门都没在这块屏幕上量过一次。
  { name: '老横屏', width: 568, height: 320 },
];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/**
 * 一页上被家具压住、又够不着的东西。
 *
 * 先滚到底再问底下那排，先滚到顶再问顶上那块——每件家具都在它「最不该还挡
 * 着」的那一刻查。只算真的看得见的元素（有面积、没被 hidden），并且只算叶
 * 子节点：一个大容器和家具重叠是常事，被埋住的是里面那行字、那颗键。
 */
const blocked = (page) => page.evaluate(async () => {
  const wait = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const furniture = (el) => el && (el.closest('.home-nav') || el.closest('.home-head'));

  // 量之前先让这两件家具「挡得住指针」。
  //
  // 它们平时是 pointer-events: none 的——底排只有那两颗键收指针，那块圆角
  // 矩形本身不收。所以 elementFromPoint 会直接穿过去，问不出「这里被盖住
  // 了」。可玩家的眼睛可不会穿过去：那块底板是实心的，压在什么上面就是看不
  // 见什么。所以量的时候临时把它们变成实心的，量完再还原。
  const probeStyle = document.createElement('style');
  probeStyle.textContent = '.home-nav, .home-nav-dock, .home-head, .home-head-glass { pointer-events: auto !important; }';
  document.head.appendChild(probeStyle);
  const leaves = () =>
    [...document.querySelectorAll('button, input, a, p, h1, h2, span, div')].filter((el) => {
      if (furniture(el)) return false;
      /**
       * 鱼眼轴上的东西这道门一概不管。
       *
       * 这道门问的是「有没有东西永远够不着」。轴上的卡**本来就要从底排和招牌底
       * 下滑过去**（玩家 2026-09 第四轮点名的效果），所以随时会有一两张（连同它
       * 底下那行小字）正落在底排那一带——那不是事故，是那条轴的样子，而且它照样
       * 够得着：滑一下就到正中。
       *
       * 轴自己那一摊由 check-mode-axis 守着：底排那两颗点得着、底排画在卡片上
       * 面、选中的那张正对屏幕中线。这儿再管一遍只会逼着人把玩家要的效果改回去
       * （第五轮图标放大之后，四种语言各红一条，红的全是「经典三角的小字压在底
       * 排下面」）。
       */
      if (el.closest('.mode-axis')) return false;
      if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return false;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return false;
      return ![...el.children].some((c) => c.getBoundingClientRect().height > 8);
    });
  /**
   * 元素**真正画出来的**那块矩形：拿自己的矩形和一路上会裁剪的祖先求交。
   *
   * `getBoundingClientRect` 不认裁剪——一张被 `overflow: hidden` 切掉下半截的
   * 卡，它照样报完整位置。主菜单换成鱼眼轴（ui/modeAxis.ts）之后这一点立刻咬
   * 人：轴外那几张卡的矩形垂到底排底下，这道门就报「经典三角被底排压住」，而
   * 屏幕上那截根本没画出来。四种语言各红一条，全是假的。
   *
   * 交集为空就是整个被裁掉了，这种元素这道门一概不管。
   */
  const visibleRect = (el) => {
    let r = el.getBoundingClientRect();
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ov = getComputedStyle(p).overflow;
      if (ov === 'visible') continue;
      const pr = p.getBoundingClientRect();
      const left = Math.max(r.left, pr.left);
      const top = Math.max(r.top, pr.top);
      const right = Math.min(r.right, pr.right);
      const bottom = Math.min(r.bottom, pr.bottom);
      if (right <= left || bottom <= top) return null;
      r = { left, top, right, bottom, width: right - left, height: bottom - top };
    }
    return r;
  };

  const name = (el) => {
    const t = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
    return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} 「${t.slice(0, 18)}」`;
  };

  /**
   * 真的被盖住了没有——问浏览器，不要自己算矩形。
   *
   * 两块矩形相交不等于看不见：弹窗现在就是压在招牌和底排上面的，它跟家具
   * 重叠是应该的。唯一算数的问题是「往这个点戳一下，戳到的是谁」——戳到家
   * 具，才是真的被埋住了。沿着元素上下各取几个点，任何一点被埋都算。
   */
  const buriedUnder = (el) => {
    // 量的是画出来的那块，不是元素自称的那块（见 visibleRect）。
    const r = visibleRect(el);
    if (!r || r.width < 4 || r.height < 4) return null;
    const xs = [r.left + r.width * 0.2, r.left + r.width * 0.5, r.right - r.width * 0.2];
    const ys = [r.top + 2, r.top + r.height / 2, r.bottom - 2];
    let worst = null;
    for (const y of ys) for (const x of xs) {
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
      const hit = document.elementFromPoint(x, y);
      const f = furniture(hit);
      if (f) worst = f.closest('.home-nav') ? 'dock' : 'head';
    }
    return worst;
  };

  const out = { dock: [], head: [], scrollable: document.documentElement.scrollHeight > innerHeight + 2 };

  window.scrollTo(0, document.documentElement.scrollHeight);
  await wait();
  for (const el of leaves()) {
    if (buriedUnder(el) === 'dock') out.dock.push(name(el));
  }

  window.scrollTo(0, 0);
  await wait();
  for (const el of leaves()) {
    if (buriedUnder(el) === 'head') out.head.push(name(el));
  }
  probeStyle.remove();
  return out;
});

/** 一页：怎么走到它，以及走到之后等什么。 */
const PAGES = [
  {
    name: '主菜单',
    go: async () => {},
    ready: '.home-icon-btn',
    // 电脑上这一页必须站在一屏里。它是三排图标，一排也不能掉到屏幕外——
    // 掉出去的那一排正好落在底排图标底下，看得见、按不着。
    //
    // 只对够高的屏幕要求。手机竖着是两列八张，本来就要往下滑；手机横过来
    // 用的虽然也是电脑那套三排版式，可只剩三百多像素高，十一个图标除非压
    // 到点不中否则装不下——那种屏幕上「能滑到、按得着」才是标准，正是上面
    // 那两条查的东西。
    mustFit: (size) => size.width >= 720 && size.height >= 640,
  },
  {
    name: '个人主页',
    go: async (p) => p.click('#navProfile'),
    ready: '.profile-page',
  },
  {
    name: '记录与排名',
    go: async (p) => p.click('#navRecords'),
    ready: '.records-page',
  },
  {
    name: '多人游玩',
    go: async (p) => {
      await p.click('#navProfile');
      await p.waitForSelector('#multiRow', { timeout: 10000 });
      await p.click('#multiRow');
    },
    ready: '#mpCreate',
    // 竖屏时这一页不该要人滚：一进来就是「开房间 / 输房号 / 返回」三件事，
    // 都得看得见。横过来只剩三百多像素高，一张表单站不进去，那就让它滚——
    // 能滚到、按得着就行，上面那两条查的正是这个。
    //
    // 高度这道门槛（700px）是量出来的，不是为了让这条变绿：360×640 那种小屏
    // 手机上这一页高出约 110px，怎么排都装不下，除非把字和键都缩到不好按。
    // 那种屏幕上「滚得到、按得着」才是标准——上面那两条已经在查了。
    mustFit: (size) => size.height > size.width && size.height >= 700,
  },
  {
    name: '成为天才',
    go: async (p) => {
      await p.click('#navProfile');
      await p.waitForSelector('.profile-page', { timeout: 10000 });
      await p.evaluate(() => {
        const b = [...document.querySelectorAll('button, a')].find((e) =>
          /Slides\s*(天才|Genius|Génie)/i.test(e.textContent || ''));
        b?.click();
      });
    },
    ready: '.genius-modal',
    // 这一窗有七百来像素高，小屏手机上装不下。装不下没关系，滚得到就行——
    // 查的就是「滚到底之后，最后那颗键在不在屏幕里、戳不戳得到」。
    // 从前 .overlay 是弹性盒居中且不给滚：窗一旦比屏幕高，上下同时被切掉，
    // 而且切掉的部分怎么都够不着。
    reachLastButtonIn: '.genius-modal',
  },
];

for (const size of SIZES) {
  for (const lang of LANGS) {
    const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height } });
    await ctx.addInitScript((l) => {
      for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
        localStorage.setItem(k, '1');
      localStorage.setItem('slides_lang', l);
    }, lang);
    const page = await ctx.newPage();
    for (const spec of PAGES) {
      await page.goto(BASE, { waitUntil: 'load' });
      await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
      await spec.go(page);
      const there = await page.waitForSelector(spec.ready, { timeout: 12000 })
        .then(() => true).catch(() => false);
      if (!there) {
        check(`${size.name} · ${lang} · ${spec.name}：走得到`, false, '没到这一页');
        continue;
      }
      await page.waitForTimeout(400);
      const b = await blocked(page);
      check(`${size.name} · ${lang} · ${spec.name}：滚到底，没有东西压在底排图标下`,
        b.dock.length === 0, b.dock.slice(0, 3).join(' / '));
      check(`${size.name} · ${lang} · ${spec.name}：滚到顶，没有东西压在招牌下`,
        b.head.length === 0, b.head.slice(0, 3).join(' / '));
      if (spec.reachLastButtonIn) {
        const r = await page.evaluate(async (sel) => {
          const wait = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
          const m = document.querySelector(sel);
          if (!m) return { ok: false, why: '没找到这一窗' };
          for (const el of [m, m.parentElement, document.documentElement, document.body])
            if (el) el.scrollTop = el.scrollHeight;
          window.scrollTo(0, document.documentElement.scrollHeight);
          await wait();
          const btns = [...m.querySelectorAll('button')];
          if (!btns.length) return { ok: false, why: '这一窗里没有按钮' };
          const last = btns[btns.length - 1];
          const b = last.getBoundingClientRect();
          const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
          if (b.top < 0 || b.bottom > innerHeight + 1)
            return { ok: false, why: `《${(last.textContent || '').trim().slice(0, 6)}》滚到底还在屏幕外 y=${Math.round(b.top)}~${Math.round(b.bottom)}` };
          const hit = document.elementFromPoint(cx, cy);
          if (!hit || !(hit === last || last.contains(hit)))
            return { ok: false, why: `《${(last.textContent || '').trim().slice(0, 6)}》被挡住了` };
          return { ok: true, why: '' };
        }, spec.reachLastButtonIn);
        check(`${size.name} · ${lang} · ${spec.name}：滚到底，最后一颗键够得着`, r.ok, r.why);
      }
      if (spec.mustFit?.(size)) {
        const over = await page.evaluate(() =>
          document.documentElement.scrollHeight - innerHeight);
        check(`${size.name} · ${lang} · ${spec.name}：一屏装得下，不用滚`,
          over <= 2, over > 2 ? `高出 ${over}px` : '');
      }
    }
    await ctx.close();
  }
}

/**
 * 三页的 Slides 招牌站在同一条线上。
 *
 * 玩家 2026-09 第七轮：「在主菜单、个人主页、成绩与排名三个会出现 Slides 标记部
 * 分的页面，slides 标题板块的位置都不同，统一一下按照比主菜单的标题板块还要再往
 * 上轻微上移一点的位置，下方所有内容都整体上移」。
 *
 * 从前这三页各写各的上内边距（10 / 16 / 28，记录那一页干脆没写、吃的是 .app 的
 * 28），玻璃板上沿分别落在 16 / 22 / 34——在三页之间来回跳，招牌就跟着上下跳一
 * 下。现在三页都用 .app 的 --head-top。
 *
 * 量两件事：三页一样高，而且比主菜单原先那 16 更靠上。只量「一样」不够——三页一
 * 起往下挪到 40 也是「一样」的。
 */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_intro_seen', '1');
    localStorage.setItem('slides_played_square', '1');
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-page', { timeout: 20000 });
  await page.waitForTimeout(700);
  const glassTop = () => page.evaluate(() => {
    const g = document.querySelector('.home-head-glass');
    return g ? +g.getBoundingClientRect().top.toFixed(1) : null;
  });
  const tops = { 主菜单: await glassTop() };
  await page.click('#navProfile');
  await page.waitForSelector('.profile-page', { timeout: 10000 });
  await page.waitForTimeout(500);
  tops['个人主页'] = await glassTop();
  await page.click('#navRecords');
  await page.waitForSelector('.records-page', { timeout: 10000 });
  await page.waitForTimeout(500);
  tops['记录与排名'] = await glassTop();
  const vals = Object.values(tops);
  const desc = Object.entries(tops).map(([k, v]) => `${k} ${v}`).join(' / ');
  check('三页的招牌都找得到（下面两条才有意义）', vals.every((v) => v !== null), desc);
  check('三页的 Slides 招牌站在同一条线上（差 < 1px）', Math.max(...vals) - Math.min(...vals) < 1, desc);
  check('而且比主菜单原先那一版更靠上（≤ 12px，原先 16）', Math.max(...vals) <= 12, desc);

  /**
   * 招牌里的字是**清楚**的，而且那口气**换页也不断**。
   *
   * 玩家 2026-09 第九轮两句：「感觉现在 slides 上方有一点模糊效果……保持 slides
   * 标题板块内的清晰」「我希望 slides 标题板块的呼吸感是连续的，不是在主菜单、
   * 个人主页、成绩与排名的界面切换的时候直接重置了」。
   *
   *   · 「模糊」不是毛玻璃（那一层糊的是招牌背后滑过去的卡片），是呼吸那句
   *     text-shadow 里原先贴着笔画的 `0 0 2px`——2px 的光晕压在字边上，呼到顶就
   *     像失焦。所以量的是「这一层还在不在」：把关键帧里还亮着的那些层拆开，看
   *     有没有小半径的那一道。
   *   · 相位量的是**呼到第几成**（(currentTime − delay) / duration），不是
   *     currentTime——换页换的是元素，currentTime 当然从 0 起；负的
   *     animation-delay 正是用来把相位拨回去的（见 main.ts 的 wireHomeTitle）。
   */
  const shadow = await page.evaluate(() => {
    const t = document.querySelector('.home-title');
    const a = t.getAnimations()[0];
    if (!a) return { raw: '（没有动画）', radii: [] };
    /**
     * 读的是**关键帧本身**，不是某一帧算出来的样式。
     *
     * 试过拨 `a.currentTime` 到 50% 再读 computed style——拨完那一下样式还没重
     * 算，读到的是半路上的值（量出来 4.9px，看着像「那道 2px 还在」，其实是这把
     * 尺子在中途取的样）。关键帧是定义，什么时候读都一样。
     */
    const layers = a.effect
      .getKeyframes()
      .map((k) => k.textShadow || '')
      .join(', ')
      // 一句 text-shadow 里可以叠好几层，逗号分层；`rgba(…)` 里面的逗号不算
      .split(/,(?![^(]*\))/)
      .map((v) => v.trim())
      .filter(Boolean)
      /*
       * 「灭了的那一层」要扔掉，而且**两种写法都要认**。
       *
       * 关键帧里写的是 `transparent`，但 getKeyframes() 交回来的是 Chromium 序
       * 列化过的 `rgba(0, 0, 0, 0)`——原先只认 `transparent` 三个字母，于是
       * 0% 和 100% 两帧（呼到底、光全灭）整个漏了进来，量出三层，这道门红在了
       * 尺子上而不是代码上。
       */
      .filter((v) => !/transparent/.test(v) && !/rgba\([^)]*,\s*0\s*\)/.test(v));
    return {
      raw: layers.join(' | '),
      // 每一层里那个「模糊半径」（px 的第三个数）
      radii: layers.map((seg) => {
        const nums = seg.match(/-?[\d.]+px/g) || [];
        return nums[2] ? parseFloat(nums[2]) : 0;
      }),
    };
  });
  check(
    '招牌里的字是清楚的：呼吸只剩远处那一层光，没有贴着笔画的那道',
    shadow.radii.length === 1 && shadow.radii[0] >= 10,
    shadow.raw || '（没有动画）',
  );
  const phase = () => page.evaluate(() => {
    const t = document.querySelector('.home-title');
    const cs = getComputedStyle(t);
    const dur = parseFloat(cs.animationDuration) * 1000;
    const delay = parseFloat(cs.animationDelay) * 1000;
    const a = t.getAnimations()[0];
    return dur > 0 ? ((((Number(a?.currentTime ?? 0) - delay) % dur) + dur) % dur) / dur : -1;
  });
  const pRecords = await phase();
  await page.click('#navProfile');
  await page.waitForSelector('.profile-page', { timeout: 10000 });
  await page.waitForTimeout(150);
  const pProfile = await phase();
  let drift = Math.abs(pProfile - pRecords);
  if (drift > 0.5) drift = 1 - drift;
  check(
    '换一页，这口气接着呼（相位不从头来）',
    drift < 0.12,
    `记录 ${(pRecords * 100).toFixed(0)}% → 个人主页 ${(pProfile * 100).toFixed(0)}%，差 ${(drift * 100).toFixed(0)}%`,
  );
  await ctx.close();
}

await browser.close();
console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

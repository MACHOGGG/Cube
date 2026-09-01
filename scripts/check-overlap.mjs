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
      if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return false;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return false;
      return ![...el.children].some((c) => c.getBoundingClientRect().height > 8);
    });
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
    const r = el.getBoundingClientRect();
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
    // 掉出去的那一排正好落在底排图标底下，看得见、按不着。手机上是另一回
    // 事：竖着是两列八张，本来就要往下滑，所以只在宽版布局上要求。
    mustFit: (size) => size.width >= 720,
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
    mustFit: (size) => size.height > size.width,
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

await browser.close();
console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

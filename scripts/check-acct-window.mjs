/**
 * 登录之后那扇《账户》窗，和个人主页上那颗《语言》。
 *
 *   node scripts/dev-server.mjs 8816 dist
 *   node scripts/check-acct-window.mjs http://localhost:8816/
 *
 * 两件玩家当场撞见的事，都在个人主页这一屏上：
 *
 *   「现在在 web 端更换语言后会立刻跳回主页，不能这样，要在原本的切换语言的
 *     弹窗背景内容（整个网页）就应该跟着更换了」
 *   「这个界面文字遮挡了请确定移动端和电脑端的排版」
 *
 * 第一件是路走错了：换语言原先走的是开机那条路（afterLangChosen），那条路
 * 最后一句是 showMenu()。字换了，人也被换走了，刚才翻到哪儿也没了。
 *
 * 第二件是 .menu-section-label 那 -4px 的下边距——它是给主菜单那片卡准备
 * 的（小标题压在卡上一点点好看），可《账户设定》这个小标题底下是一列按钮，
 * -4px 就成了「第一颗键盖住小标题」。窗里另外两个小标题早就单列出来改过
 * 了，只有这一个漏在名单外面。
 *
 * 所以这里量的不是像素好不好看，是两条硬的：**没有一个小标题被它底下那块
 * 压住**，**没有一行的标签和值叠在一起**。四种语言里挑了繁中——中文最紧
 * 凑，标签短、值长，最容易看不出问题；再补一遍法语，因为法语标签最长。
 * 宽窄各一台：手机 390，电脑 1280。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2];
if (!BASE) {
  console.error('用法: node scripts/check-acct-window.mjs http://localhost:8816/');
  process.exit(2);
}

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const SIZES = [
  { name: '手机', width: 390, height: 844 },
  { name: '电脑', width: 1280, height: 900 },
];
// 繁中最紧凑，法语标签最长——同一扇窗在这两种语言里的宽窄差得最远。
const LANGS = ['zhHant', 'fr'];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/** 一个已经登录、订着年付、手上还有两张赠码的人。赠码那一段要有东西，
 *  《账户设定》才会被推到窗子中段——正是玩家截图里出问题的那个位置。 */
const seed = (lang) => `
  localStorage.setItem('slides_lang', ${JSON.stringify(lang)});
  localStorage.setItem('slides_genius', JSON.stringify({
    active: true, channel: 'web', period: 'yearly',
    until: Date.now() + 300 * 86400000,
    email: 'someone-with-a-long-address@example.com',
    gifts: [{ code: 'AB12CD', expiresAt: Date.now() + 30 * 86400000 }, { code: 'EF34GH', spent: true }],
  }));
`;

/** 窗里所有「上面一块字、下面一块内容」的地方，谁压住了谁。 */
const squashed = (page) =>
  page.evaluate(() => {
    const m = document.querySelector('.genius-modal');
    if (!m) return null;
    const out = { labels: [], rows: [], overflow: m.scrollWidth - m.clientWidth };
    for (const el of m.querySelectorAll('.menu-section-label')) {
      const next = el.nextElementSibling;
      if (!next) continue;
      const a = el.getBoundingClientRect();
      const b = next.getBoundingClientRect();
      if (!a.width || !b.width) continue;
      const over = +(a.bottom - b.top).toFixed(1);
      if (over > 0.5) out.labels.push(`「${el.textContent.trim()}」被压 ${over}px`);
    }
    // 订单那几行是「左边标签、右边值」，值可能长到顶上标签的脸。
    for (const row of m.querySelectorAll('.order-row, .gift-row')) {
      const [l, r] = row.children;
      if (!l || !r) continue;
      const lb = l.getBoundingClientRect();
      const rb = r.getBoundingClientRect();
      const over = +(lb.right - rb.left).toFixed(1);
      if (over > 0.5) out.rows.push(`「${l.textContent.trim()}」和值叠了 ${over}px`);
    }
    return out;
  });

for (const size of SIZES) {
  for (const lang of LANGS) {
    const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height } });
    const page = await ctx.newPage();
    const where = `${size.name} · ${lang}`;

    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(seed(lang));
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForSelector('.home-icon-btn', { timeout: 20000 });

    await page.click('#navProfile');
    await page.waitForSelector('.profile-page', { timeout: 10000 });

    // ---- ① 《账户》窗：没有互相压住的字 ----------------------------------
    await page.click('#loginBtn');
    const opened = await page
      .waitForSelector('.genius-modal', { timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    check(`${where}：登着的人点进去是《账户》窗`, opened);
    if (opened) {
      const s = await squashed(page);
      check(`${where}：没有小标题被底下那块压住`, s.labels.length === 0, s.labels.join('；'));
      check(`${where}：没有一行的标签和值叠在一起`, s.rows.length === 0, s.rows.join('；'));
      check(`${where}：窗里不横向溢出`, s.overflow <= 1, `${s.overflow}px`);
      await page.click('#statusClose');
      await page.waitForTimeout(300);
    }

    // ---- ② 换语言：原地换，不换页 ----------------------------------------
    //
    // 「还在个人主页」这一条不能只看有没有 .profile-page——换语言之后整页是
    // 重画的，看的得是「现在屏幕上这一页是个人主页，不是主菜单」。
    const before = await page.textContent('.profile-page');
    await page.click('#langRow');
    await page.waitForSelector('.lang-switch-modal', { timeout: 10000 });
    // 挑一个跟现在不一样的。繁中挑简中，法语挑英语——都是「换了，但还认得出」。
    const want = lang === 'zhHant' ? 'zhHans' : 'en';
    await page.evaluate((w) => {
      const names = { zhHans: '简体中文', en: 'English' };
      const btn = [...document.querySelectorAll('.lang-switch-item')].find(
        (b) => b.textContent.trim() === names[w],
      );
      btn?.click();
    }, want);
    await page.waitForTimeout(700);

    const still = await page.$('.profile-page');
    check(`${where}：换完语言还站在个人主页`, Boolean(still),
      still ? '' : '被扔回了' + ((await page.$('.home-page')) ? '主菜单' : '别处'));
    check(`${where}：存下来的就是新挑的那一种`,
      (await page.evaluate(() => localStorage.getItem('slides_lang'))) === want);
    const after = still ? await page.textContent('.profile-page') : '';
    check(`${where}：这一页的字真的换了`, Boolean(after) && after !== before);

    await ctx.close();
  }
}

await browser.close();
console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

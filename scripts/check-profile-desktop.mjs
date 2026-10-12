/**
 * 电脑端个人主页：十二格 3 × 4、吉祥物和徽章并排、整页不滑；手机上一个像素不动（10-08 补充方案 7-18）。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8989 dist
 *   node scripts/check-profile-desktop.mjs http://localhost:8989/
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么
 *
 * 第 17 推的电脑端个人主页是两栏等宽、天才面板里吉祥物 90 高摞在徽章上面、十二格 2 × 6——1000×700 上整页要往
 * 下滑一截。玩家定的 7-18：整页放宽到 1060、左栏 360（1000–1099 宽 300）、吉祥物 54 高和徽章并排一行、十二格
 * 3 × 4。方案上的验收原样搬进来：
 *
 *   ① 四种语言 × 1000×700、1280×720、1366×768、1440×900、1920×1080：
 *      · 整页不滑（scrollHeight − innerHeight ≤ 1）；
 *      · 十二格一格都不溢出（字没被裁、没顶出格子）；
 *      · 《返回》上沿到两栏内容底 ≥ 24，《返回》下沿到底部导航那颗键的上沿 ≥ 16；
 *      · 右栏三列、四行；吉祥物 54 高，和徽章同一行（两个的垂直中线差 ≤ 4）；
 *      · 左栏 360 宽（1000–1099 宽那一档 300），两栏并排、顶端对齐。
 *   ② 手机 390×844、360×740：十二格仍是两列、吉祥物仍是 90 高、徽章仍在吉祥物底下——这几样是「手机上一个
 *      像素不动」里最容易被电脑那一段带跑的（规则漏写进 min-width: 1000px 外面，手机就跟着变）。
 *
 * 没登录、浅色：这一台量的是排版，不是帐号那几种状态（四页改版那一道 check-redesign-fit 量着三种主题）。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2];
if (!BASE) {
  console.error('用法: node scripts/check-profile-desktop.mjs http://localhost:8989/');
  process.exit(2);
}
const LANGS = ['zhHans', 'zhHant', 'en', 'fr'];
const DESK = [[1000, 700], [1280, 720], [1366, 768], [1440, 900], [1920, 1080]];
const PHONE = [[390, 844], [360, 740]];

let fail = 0;
let pass = 0;
const check = (name, ok, extra = '') => {
  if (ok) pass++;
  else fail++;
  if (!ok || process.env.VERBOSE) console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? `  — ${extra}` : ''}`);
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

const MEASURE = () => {
  const box = (e) => { const r = e.getBoundingClientRect(); return { t: r.top, b: r.bottom, l: r.left, r: r.right, w: r.width, h: r.height }; };
  const cells = [...document.querySelectorAll('.genius-grid > .profile-row')];
  const overflow = cells
    .map((c, i) => ({ i, c }))
    .filter(({ c }) => c.scrollWidth > c.clientWidth + 1 || c.scrollHeight > c.clientHeight + 1 ||
      [...c.querySelectorAll('.profile-row-label, .profile-row-sub, .profile-row-value')].some((t) => {
        const a = t.getBoundingClientRect();
        const b = c.getBoundingClientRect();
        return a.left < b.left - 0.5 || a.right > b.right + 0.5 || a.top < b.top - 0.5 || a.bottom > b.bottom + 0.5;
      }))
    .map(({ i, c }) => `${i}:${c.textContent.trim().slice(0, 18)}`);
  const lefts = [...new Set(cells.map((c) => Math.round(c.getBoundingClientRect().left)))];
  const tops = [...new Set(cells.map((c) => Math.round(c.getBoundingClientRect().top)))];
  const main = box(document.querySelector('.profile-col--main'));
  const genius = box(document.querySelector('.profile-col--genius'));
  const back = box(document.getElementById('backBtn'));
  // 底部导航：和《返回》左右有交叠的那颗键；一颗都不交叠就拿整条底排。
  const navBtns = [...document.querySelectorAll('.home-nav .home-nav-btn')].map(box);
  const under = navBtns.filter((n) => n.r > back.l && n.l < back.r);
  const navTop = under.length ? Math.min(...under.map((n) => n.t)) : box(document.querySelector('.home-nav-dock') || document.querySelector('.home-nav')).t;
  return {
    scroll: document.documentElement.scrollHeight - innerHeight,
    cells: cells.length, overflow, cols: lefts.length, rows: tops.length,
    logo: box(document.querySelector('.genius-crest .genius-logo')),
    badge: box(document.querySelector('.genius-badge')),
    main, genius, back, navTop,
  };
};

async function open(w, h, lang) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  await ctx.addInitScript((l) => {
    if (sessionStorage.getItem('pd-seeded')) return;
    sessionStorage.setItem('pd-seeded', '1');
    localStorage.setItem('slides_lang', l);
    localStorage.setItem('slides_intro_seen', '1');
  }, lang);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 25000 });
  await page.click('#navProfile');
  await page.waitForSelector('.profile-page .genius-grid', { timeout: 10000 });
  await page.waitForTimeout(300);
  return { ctx, page, errors };
}

console.log('① 电脑：3 × 4、并排、不滑');
const table = [];
for (const [w, h] of DESK) {
  for (const lang of LANGS) {
    const tag = `${w}×${h} ${lang}`;
    const { ctx, page, errors } = await open(w, h, lang);
    const m = await page.evaluate(MEASURE);
    check(`${tag}：整页不滑`, m.scroll <= 1, `${m.scroll}px`);
    check(`${tag}：十二格`, m.cells === 12, String(m.cells));
    check(`${tag}：十二格一格都不溢出`, m.overflow.length === 0, m.overflow.join(' | '));
    check(`${tag}：右栏三列四行`, m.cols === 3 && m.rows === 4, `${m.cols} 列 ${m.rows} 行`);
    const contentBottom = Math.max(m.main.b, m.genius.b);
    check(`${tag}：《返回》上沿到两栏内容底 ≥ 24`, m.back.t - contentBottom >= 24 - 0.5, `${Math.round(m.back.t - contentBottom)}`);
    check(`${tag}：《返回》下沿到底部导航那颗键的上沿 ≥ 16`, m.navTop - m.back.b >= 16 - 0.5, `${Math.round(m.navTop - m.back.b)}`);
    check(`${tag}：吉祥物 54 高`, Math.abs(m.logo.h - 54) <= 0.5, `${m.logo.h.toFixed(1)}`);
    const dy = Math.abs((m.logo.t + m.logo.b) / 2 - (m.badge.t + m.badge.b) / 2);
    check(`${tag}：吉祥物和徽章同一行（垂直中线差 ≤ 4）`, dy <= 4 && m.badge.l >= m.logo.r, `差 ${dy.toFixed(1)}`);
    const leftW = w < 1100 ? 300 : 360;
    check(`${tag}：左栏 ${leftW} 宽`, Math.abs(m.main.w - leftW) <= 0.5, `${m.main.w.toFixed(1)}`);
    check(`${tag}：两栏并排、顶端对齐`, m.main.r <= m.genius.l && Math.abs(m.main.t - m.genius.t) <= 1, JSON.stringify({ main: m.main, genius: m.genius }));
    check(`${tag}：没有页面报错`, errors.length === 0, errors.join(' | '));
    table.push(`${tag.padEnd(18)} 页 ${m.scroll <= 0 ? '不滑' : `滑 ${m.scroll}`} · 返回上沿离内容底 ${Math.round(m.back.t - contentBottom)} · 下沿离底排 ${Math.round(m.navTop - m.back.b)}`);
    await ctx.close();
  }
}
console.log(table.map((r) => '   ' + r).join('\n'));

console.log('② 手机：两列、吉祥物 90 高、徽章在吉祥物底下');
for (const [w, h] of PHONE) {
  for (const lang of LANGS) {
    const tag = `${w}×${h} ${lang}`;
    const { ctx, page } = await open(w, h, lang);
    const m = await page.evaluate(MEASURE);
    check(`${tag}：十二格两列六行`, m.cols === 2 && m.rows === 6, `${m.cols} 列 ${m.rows} 行`);
    check(`${tag}：吉祥物 90 高`, Math.abs(m.logo.h - 90) <= 0.5, `${m.logo.h.toFixed(1)}`);
    check(`${tag}：徽章在吉祥物底下`, m.badge.t >= m.logo.b - 0.5, `${Math.round(m.badge.t)} / ${Math.round(m.logo.b)}`);
    check(`${tag}：十二格一格都不溢出`, m.overflow.length === 0, m.overflow.join(' | '));
    await ctx.close();
  }
}

await browser.close();
console.log(`\n${fail ? '✗' : '✓'} check-profile-desktop：${pass} 条过、${fail} 条红`);
process.exit(fail ? 1 : 0);

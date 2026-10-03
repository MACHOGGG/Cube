/**
 * 《联系与特别感谢》那扇窗（E42 / 3.2）。
 *
 *   node scripts/dev-server.mjs 8873 dist &
 *   node scripts/check-contact-thanks.mjs http://localhost:8873/
 *
 * 真开浏览器：这一屏要守的是「点得开、字在、邮箱可点、名单数对」，读源码量不出来。
 *
 * ── 为什么值得一道门 ────────────────────────────────────────
 *
 * 个人主页底部 2026-10-02 从五行法务收成两行（E42）：《隐私政策》＋这一扇。那三份（价格 /
 * 条款 / 退款）是为「在卖东西」写的，而改制把付费整个撤了。
 *
 * 这一扇窗里有三样容易悄悄坏掉的东西：
 *
 * ① **那一行邮箱**。它读 `src/legal.ts` 的 `CONTACT_EMAIL` 一个常量，而且必须是
 *    `mailto:`——写成纯文字就得让玩家自己抄，而他正是在「想找人」的那一刻。
 * ② **玩家自己写的那一段话**。那是他点名要的原文（「欢迎遇到任何问题附上截图联络我，也
 *    欢迎您在没有遇到问题的情况下联络我…」），不是我们代写的客服话术，所以不许被「润
 *    色」掉。
 * ③ **名单的条数**。它从 `src/thanks.ts` 来，而那个数组会被改（加人）。这道门按
 *    `THANKS.length` 数屏幕上有几个名字——少一个就是渲染那一步把谁吃掉了，而少一个名字
 *    在屏幕上看不出来。
 *
 * 顺序也量一条：那句话要排在**邮箱上方**（玩家定的）。反过来是一张名片，而这一段要说的
 * 是「有人在看」。
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const base = process.argv[2];
if (!base) {
  console.error('用法: node scripts/check-contact-thanks.mjs http://localhost:<端口>/');
  process.exit(2);
}

let fail = 0;
const check = (n, ok, extra = '') => {
  if (!ok) fail++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (extra ? '  ' + extra : ''));
};

/** 名单和联系邮箱都从源码读，不在门里抄一份——抄一份就会和代码走散。 */
const thanksSrc = readFileSync(new URL('../src/thanks.ts', import.meta.url), 'utf8');
const NAMES = [...thanksSrc.matchAll(/^\s+'([^']+)',$/gm)].map((m) => m[1]);
const legalSrc = readFileSync(new URL('../src/legal.ts', import.meta.url), 'utf8');
const MAIL = /export const CONTACT_EMAIL = '([^']+)';/.exec(legalSrc)?.[1] ?? '';

check('（尺子）从 thanks.ts 读到了名单', NAMES.length >= 3, `${NAMES.length} 个：${NAMES.join(' · ')}`);
check('（尺子）从 legal.ts 读到了联系邮箱', /@/.test(MAIL), MAIL);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.goto(base);
await page.evaluate(() => {
  localStorage.setItem('slides_lang', 'zhHans');
  localStorage.setItem('slides_know_how', '1');
});
await page.reload();
// 等元素，不盲等秒数（开场动画三秒多，CI 的机器更慢）。
await page.waitForSelector('.home-nav-btn', { timeout: 25000 });
await page.click('#navProfile');
await page.waitForSelector('#contactThanksRow', { timeout: 15000 });

// ── 底部那两行 ───────────────────────────────────────────────
{
  // 第 17 推起这两条是天才面板底下并排的一对白键（.legal-pair），原先是一列 .legal-rows。
  const rows = await page.$$eval('.legal-pair > .profile-row', (bs) =>
    bs.map((b) => ({
      text: b.textContent.replace(/\s+/g, ' ').trim(),
      h: Math.round(b.getBoundingClientRect().height),
      w: Math.round(b.getBoundingClientRect().width),
    })),
  );
  check('底部法务收成两行', rows.length === 2, rows.map((r) => r.text).join(' | '));
  check('两行都看得见（不是高度 0）', rows.every((r) => r.h > 0 && r.w > 0),
    rows.map((r) => `${r.w}×${r.h}`).join(' '));
  check('第二行是《联系与特别感谢》', /联系与特别感谢/.test(rows[1]?.text ?? ''), rows[1]?.text ?? '');
  // 尺寸收了一档（E42）：这一档的行高要比页面上别处那些 profile-row 矮。
  const other = await page.$$eval('.profile-row', (bs) =>
    bs.filter((b) => !b.closest('.legal-pair')).map((b) => Math.round(b.getBoundingClientRect().height)));
  const median = other.sort((a, b) => a - b)[Math.floor(other.length / 2)] ?? 0;
  check('这两行比别处那些行矮一档（尺寸收了）', rows[0].h < median,
    `法务行 ${rows[0].h}px / 别处中位 ${median}px`);
}

// ── 点开那扇窗 ───────────────────────────────────────────────
{
  await page.click('#contactThanksRow');
  const opened = await page.waitForSelector('.rules-modal', { timeout: 10000 }).then(() => true).catch(() => false);
  check('点一下，那扇窗真的开出来（不只是按钮在）', opened);

  const v = await page.evaluate(() => {
    const modal = document.querySelector('.rules-modal');
    const mailLink = modal?.querySelector('.contact-mail a');
    const invite = [...(modal?.querySelectorAll('.rule-item span') ?? [])].map((e) => e.textContent.trim());
    const mailBox = mailLink?.getBoundingClientRect();
    // 那一段话的位置：拿第一条 rule-item 的底边和邮箱的顶边比。
    const firstItem = modal?.querySelector('.rule-item')?.getBoundingClientRect();
    return {
      title: modal?.querySelector('h2')?.textContent?.trim() ?? '',
      text: modal?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      href: mailLink?.getAttribute('href') ?? '',
      mailText: mailLink?.textContent?.trim() ?? '',
      mailFont: mailLink ? parseFloat(getComputedStyle(mailLink).fontSize) : 0,
      bodyFont: parseFloat(getComputedStyle(modal?.querySelector('.rule-item span')).fontSize),
      inviteFirst: invite[0] ?? '',
      inviteAboveMail: Boolean(firstItem && mailBox && firstItem.bottom <= mailBox.top + 1),
    };
  });

  check('抬头是《联系与特别感谢》', /联系与特别感谢/.test(v.title), v.title);
  // ② 玩家自己写的那一段，逐字在
  check('玩家写的那一段原文在（「也欢迎您在没有遇到问题的情况下」）',
    /也欢迎您在没有遇到问题的情况下联络我/.test(v.text), v.inviteFirst.slice(0, 40));
  check('而且说了「我本人查看回复」', /本人查看回复/.test(v.text));
  // ① 邮箱：可点、是 mailto、和常量一致、比正文大一档
  check('邮箱那一行是 mailto:', v.href === `mailto:${MAIL}`, v.href);
  check('印出来的就是 legal.ts 那个常量', v.mailText === MAIL, `${v.mailText} vs ${MAIL}`);
  check('邮箱比正文大一档', v.mailFont > v.bodyFont, `${v.mailFont}px / 正文 ${v.bodyFont}px`);
  // 顺序：那句话在邮箱上方
  check('那句话排在邮箱上方（玩家定的顺序）', v.inviteAboveMail === true);
  // ③ 名单条数
  for (const name of NAMES) check(`  名单里有「${name}」`, v.text.includes(name));
  check(`名字数对得上 thanks.ts（${NAMES.length} 个）`,
    NAMES.every((n) => v.text.includes(n)) && NAMES.length > 0);
  check('名单后面那句「等诸多…的朋友」也在', /等诸多/.test(v.text));
}

await ctx.close();
await browser.close();
console.log(fail ? `\n${fail} FAILED` : '\n全部通过');
process.exit(fail ? 1 : 0);

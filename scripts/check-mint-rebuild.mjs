/**
 * 管理员页《重建榜单》那张卡：三个勾、一句确认（第 14 推）。
 *
 *   node scripts/dev-server.mjs 8983 dist
 *   node scripts/check-mint-rebuild.mjs http://localhost:8983/
 *
 * 不碰真的服务器：`/api/scores` 在浏览器里拦下来，量的是**这一页实际发出去了什么**、
 * 拿到回包之后**写了什么**。所以不需要 ADMIN_TOKEN，也不会真的重算任何一张榜。
 *
 *   ① 三个勾默认都不勾——从前「清空《无限反转》的旧榜」默认勾着，每一次例行重建都顺
 *      手把它清一遍，点的人未必知道自己清了什么。
 *   ② 勾了「全部清空」再按：先弹「确定清空所有排行榜吗？」，点取消就**一个请求都不
 *      发**；点确定才发，发的是 all: true。
 *   ③ 勾了「清理旧名字」：发 scrubNames: true，回包里那个数写到页上（零条也写）；不勾
 *      就不发、也不写。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8983/';
const PAGE = new URL('mint.html#token=check-mint-rebuild-not-a-real-token', BASE).href;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/** 开一页：/api/scores 拦下来，记下每一次发出去的 body，回一份假回包。 */
async function open(reply) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const page = await ctx.newPage();
  const sent = [];
  const dialogs = [];
  await page.route('**/api/scores', async (route) => {
    sent.push(JSON.parse(route.request().postData() || '{}'));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) });
  });
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForSelector('#rebuild', { timeout: 15000 });
  return { ctx, page, sent, dialogs };
}
const msg = (page) => page.$eval('#rebuildMsg', (e) => e.textContent.trim());
const settle = (page) => page.waitForFunction(() => !document.querySelector('#rebuild').disabled, { timeout: 8000 });

// ── ① 默认一个都不勾 ────────────────────────────────────────────────
{
  const { ctx, page, sent } = await open({ ok: true, players: 3, rows: 9, dropped: [], namesDropped: 0, skipped: 0 });
  const boxes = await page.evaluate(() =>
    ['dropFlip', 'scrubNames', 'wipeAll'].map((id) => {
      const el = document.getElementById(id);
      return { id, there: Boolean(el), checked: el ? el.checked : null };
    }));
  check('（尺子）三个勾都在页上', boxes.every((b) => b.there), JSON.stringify(boxes));
  check('三个勾默认都不勾（「清空无限反转」从前默认勾着）', boxes.every((b) => b.checked === false), JSON.stringify(boxes));
  // 什么都不勾直接按：发的是一次干净的重算。
  await page.click('#rebuild');
  await settle(page);
  check('什么都不勾：发了一次重算，不清任何一张、不清名字',
    sent.length === 1 && sent[0].action === 'rebuild' && sent[0].all === false && sent[0].scrubNames === false &&
      Array.isArray(sent[0].drop) && sent[0].drop.length === 0,
    JSON.stringify(sent[0]));
  check('没勾「清理旧名字」：回包里那个数也不写', !/旧名字/.test(await msg(page)), await msg(page));
  await ctx.close();
}

// ── ② 全部清空：先问一句 ───────────────────────────────────────────
{
  const { ctx, page, sent } = await open({ ok: true, players: 3, rows: 0, dropped: [], skipped: 0 });
  let asked = '';
  page.once('dialog', async (d) => {
    asked = d.message();
    await d.dismiss();
  });
  await page.check('#wipeAll');
  await page.click('#rebuild');
  await page.waitForTimeout(400);
  check('勾了「全部清空」再按：先弹那一句', asked === '确定清空所有排行榜吗？', JSON.stringify(asked));
  check('点《取消》：一个请求都没发', sent.length === 0, `${sent.length} 个`);
  check('点《取消》：按钮还能按（没卡在「正在重算」）', await page.$eval('#rebuild', (e) => !e.disabled));
  page.once('dialog', (d) => d.accept());
  await page.click('#rebuild');
  await settle(page);
  check('点《确定》：才发出去，发的是全部清空', sent.length === 1 && sent[0].all === true, JSON.stringify(sent[0]));
  await ctx.close();
}
{
  // 尺子：不勾全清就不问——上面那一句是全清才有的，不是每一次都弹。
  const { ctx, page, sent } = await open({ ok: true, players: 1, rows: 1, dropped: [], skipped: 0 });
  let asked = false;
  page.on('dialog', async (d) => {
    asked = true;
    await d.dismiss();
  });
  await page.check('#dropFlip');
  await page.click('#rebuild');
  await settle(page);
  check('（尺子）不勾全清：不问，直接发', !asked && sent.length === 1 && sent[0].drop.join() === 'flip', JSON.stringify(sent[0]));
  await ctx.close();
}

// ── ③ 清理旧名字 ────────────────────────────────────────────────────
for (const n of [3, 0]) {
  const { ctx, page, sent } = await open({ ok: true, players: 5, rows: 12, dropped: [], namesDropped: n, skipped: 0 });
  await page.check('#scrubNames');
  await page.click('#rebuild');
  await settle(page);
  check(`勾了「清理旧名字」：发的是 scrubNames: true（回包 ${n} 条）`, sent.length === 1 && sent[0].scrubNames === true && sent[0].all === false,
    JSON.stringify(sent[0]));
  const text = await msg(page);
  check(`回包那个数写到页上了（${n} 条${n === 0 ? '，零也写' : ''}）`, text.includes(`删掉了 ${n} 条旧名字`), text);
  await ctx.close();
}

await browser.close();
console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

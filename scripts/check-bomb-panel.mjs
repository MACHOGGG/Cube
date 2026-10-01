/**
 * 炸弹那一页：三行，一行两枚，一点就开（PR-20 / E17+E26）。
 *
 *   node scripts/dev-server.mjs 8876 dist &
 *   node scripts/check-bomb-panel.mjs http://localhost:8876/
 *
 * 真开浏览器：三档靠颜色和徽记分开，而「颜色」和「点一下有没有反应」都只在跑起来之后才
 * 量得到。
 *
 * ── 守的是什么 ────────────────────────────────────────────────
 *
 * ① **一点就开。** 中间那一档从前是一条宽的星爆徽记，点它只是把那条横杠换成两枚棋盘——
 *    也就是**两次点击**才开得了一局，而上下两行都是一次。同一页上三行长得像、行为不一
 *    样，正是玩家定的「不要让玩家出现意料之外的疏漏操作」。这一条量的是：三行六枚，**每
 *    一枚点下去都真的进了一局**。
 * ② **三档三个颜色，而且是这一页自己的三个值**：绿 #008703 / 橙 #F7821B / 砖红 #BE411A。
 *    从前借的是别处的（amber / green / purple），而 purple 是「更多布局」那一族的颜色，
 *    于是进阶炸弹和布局卡在屏幕上长得像一家。
 * ③ **徽记**：定时那两枚上写着时长、进阶那两枚上写着「+++」，基础那两枚上什么都没有。
 *    时长**必须和 `engine/modeClock.ts` 的 MODE_SECONDS 一致**——从前那枚徽记手写着 90s
 *    而那一档跑的是另一个手写的 90，改一头忘一头，屏幕上就写着一个数跑着另一个数。
 * ④ **一个字都不写**（玩家定的「少文字」）：那一页上除了徽记里的「100s」和「+++」，不许
 *    有别的文字节点。
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const base = process.argv[2];
if (!base) {
  console.error('用法: node scripts/check-bomb-panel.mjs http://localhost:<端口>/');
  process.exit(2);
}

let fail = 0;
const check = (n, ok, extra = '') => {
  if (!ok) fail++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (extra ? '  ' + extra : ''));
};

/** 三个颜色和那个秒数都从源码读，门里不抄一份——抄一份就会和代码走散。 */
const iconsSrc = readFileSync(new URL('../src/ui/homeIcons.ts', import.meta.url), 'utf8');
const COLOR = {};
for (const key of ['bombBasic', 'bombTimed', 'bombAdv']) {
  COLOR[key] = new RegExp(`${key}: '(#[0-9A-Fa-f]{6})'`).exec(iconsSrc)?.[1] ?? '';
}
const clockSrc = readFileSync(new URL('../src/engine/modeClock.ts', import.meta.url), 'utf8');
const SECONDS = /export const MODE_SECONDS = (\d+);/.exec(clockSrc)?.[1] ?? '';

check('（尺子）三个颜色都从源码读到了', Object.values(COLOR).every((c) => /^#[0-9A-Fa-f]{6}$/.test(c)),
  Object.entries(COLOR).map(([k, v]) => `${k}=${v}`).join(' '));
check('（尺子）秒数从 modeClock.ts 读到了', /^\d+$/.test(SECONDS), SECONDS);
check('三个颜色互不相同（不然三档在屏幕上分不开）', new Set(Object.values(COLOR)).size === 3);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/** 走到炸弹那一页（点开主菜单上那张炸弹卡，手机档是「缩图当按钮」）。 */
async function openPanel(width = 390, height = 844) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  await page.goto(base);
  await page.evaluate(() => {
    localStorage.setItem('slides_lang', 'zhHans');
    localStorage.setItem('slides_know_how', '1');
    // 玩过一局才摆得出炸弹那一档（和 check-mode-axis 同一个前提）。
    localStorage.setItem('slides_played_square', '1');
  });
  await page.reload();
  await page.waitForSelector('.home-icon-btn, .home-bomb-card, .home-bomb-mini', { timeout: 25000 });
  /*
   * 手机档：缩图自己是按钮，点它开出放大的那一张。宽屏档：板子本来就直接可点。
   *
   * ⚠️ **用 `el.click()` 而不是 Playwright 的 `.click()`**。主菜单在手机档是一条鱼眼滚
   * 轴（PR-21 那一族），炸弹那张卡在屏幕外——Playwright 会「滚进视口再点」，可那条轴不是
   * 普通滚动容器，滚不动，于是它重试到超时。第一版就是这样红的，而红的是门不是代码。
   *
   * 这儿要量的是「点下去开不开」，不是「这张卡在屏幕上第几个位置」（那是
   * check-mode-axis 的活）。所以直接派一次 click。
   */
  const opened = await page.evaluate(() => {
    const mini = document.querySelector('.home-bomb-mini');
    if (!mini) return false;
    mini.click();
    return true;
  });
  if (opened) await page.waitForSelector('.bomb-panel--big', { timeout: 10000 });
  await page.waitForTimeout(250);
  return { ctx, page };
}

// ── ②③④ 三档的颜色、徽记、文字 ────────────────────────────────
{
  const { ctx, page } = await openPanel();
  const panel = (await page.$('.bomb-panel--big')) ? '.bomb-panel--big' : '.bomb-panel';
  const v = await page.evaluate((sel) => {
    const p = document.querySelector(sel);
    const rows = [...p.querySelectorAll('.bomb-row')];
    return {
      rowCount: rows.length,
      perRow: rows.map((r) => r.querySelectorAll('.bomb-chip').length),
      // 每一行里那两枚各自的填色（取 svg 里第一个有 fill 的形状）。
      fills: rows.map((r) =>
        [...r.querySelectorAll('.bomb-chip svg')].map((g) => {
          const shape = g.querySelector('[fill]');
          return shape?.getAttribute('fill') ?? '';
        })),
      // 每一行里那两枚各自的徽记文字。
      marks: rows.map((r) =>
        [...r.querySelectorAll('.bomb-chip svg')].map((g) => (g.querySelector('text')?.textContent ?? '').trim())),
      // 整页上所有看得见的文字（徽记在 svg 里，这儿只收 svg 之外的）。
      words: [...p.querySelectorAll('*')]
        .filter((e) => !e.closest('svg'))
        .flatMap((e) => [...e.childNodes])
        .filter((n) => n.nodeType === 3 && n.textContent.trim())
        .map((n) => n.textContent.trim()),
    };
  }, panel);

  check('（尺子）那一页开出来了，三行', v.rowCount === 3, String(v.rowCount));
  check('① 三行各两枚', v.perRow.join(' ') === '2 2 2', v.perRow.join(' '));

  const want = [COLOR.bombBasic, COLOR.bombTimed, COLOR.bombAdv];
  const label = ['基础（绿）', '定时（橙）', '进阶（砖红）'];
  for (let i = 0; i < 3; i++) {
    check(`② 第 ${i + 1} 行是 ${label[i]} ${want[i]}`,
      v.fills[i]?.length === 2 && v.fills[i].every((f) => f.toLowerCase() === want[i].toLowerCase()),
      (v.fills[i] ?? []).join(' '));
  }

  check('③ 基础那两枚没有徽记', (v.marks[0] ?? []).every((m) => m === ''), (v.marks[0] ?? []).join('|'));
  check(`③ 定时那两枚写着「${SECONDS}s」`,
    (v.marks[1] ?? []).length === 2 && v.marks[1].every((m) => m === `${SECONDS}s`), (v.marks[1] ?? []).join('|'));
  check('③ 进阶那两枚写着「+++」',
    (v.marks[2] ?? []).length === 2 && v.marks[2].every((m) => m === '+++'), (v.marks[2] ?? []).join('|'));

  check('④ 除了徽记，那一页上一个字都没有', v.words.length === 0, v.words.join(' | ') || '（没有）');
  await ctx.close();
}

// ── ① 六枚每一枚点下去都真的进了一局 ──────────────────────────
//
// 这一条是整道门的重点，也是最容易写成空绿的一条：只量「有六枚」的话，中间那一层回到「点
// 一下才换成两枚」那个老写法照样绿——那一版屏幕上也是三行，只是中间那行点下去不开局。
// 所以逐枚点，每一枚都要真的离开主菜单、进到棋盘上。
for (let row = 0; row < 3; row++) {
  for (let col = 0; col < 2; col++) {
    const { ctx, page } = await openPanel();
    const panel = (await page.$('.bomb-panel--big')) ? '.bomb-panel--big' : '.bomb-panel';
    const found = await page.evaluate(
      ([sel, r, c]) => {
        const chips = document.querySelectorAll(`${sel} .bomb-row:nth-of-type(${r + 1}) .bomb-chip`);
        if (chips.length !== 2) return chips.length;
        chips[c].click();
        return 2;
      },
      [panel, row, col],
    );
    if (found !== 2) {
      check(`① 第 ${row + 1} 行第 ${col + 1} 枚：找得到`, false, `那一行有 ${found} 枚`);
      await ctx.close();
      continue;
    }
    // 进了一局：棋盘那一层出来了，而且主菜单不在了。
    const started = await page
      .waitForFunction(() => Boolean(document.querySelector('.board, #board, .game-page')) &&
        !document.querySelector('.mode-axis'), null, { timeout: 12000 })
      .then(() => true)
      .catch(() => false);
    check(`① 第 ${row + 1} 行第 ${col + 1} 枚：点一下就进了一局`, started);
    await ctx.close();
  }
}

await browser.close();
console.log(fail ? `\n${fail} FAILED` : '\n全部通过');
process.exit(fail ? 1 : 0);

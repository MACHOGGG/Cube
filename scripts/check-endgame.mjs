/**
 * 一局到底是怎么收场的：真开一局，用机器人一直滑到它自己结束。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8961 dist
 *   node scripts/check-endgame.mjs http://localhost:8961/
 *
 * 为什么要开浏览器：这一条判定横跨三个文件——各棋盘的 isGameOver（终局是什
 * 么）、engine/stalemate.ts（走不动了算不算）、gameController 的 finish（两者
 * 谁先问），而 runRecord 再把理由翻译成结算页上那句话。单元门量得到每一块，
 * 量不到「凑在一起之后，玩家看到的那一屏对不对」。
 *
 * 2026-09 玩家报的那一局就是凑在一起才错的：结算页写着「全部已變成星星」，盘
 * 面上还躺着四颗同色蓝星——星星消除上线之后，四颗同色星星自己就凑得出图案，
 * 可 isGameOver 还按老规矩把「全是星星」当成终局，先把局结了。
 *
 * 所以这道门只问两句话，都是从玩家那一侧问的：
 *
 *   ① **它结束的时候，盘面上真的没东西可玩了吗**——报「全部消完了」，那就一
 *     枚色块、一颗星星都不该剩；报「再也凑不出得分图案」，那就不该还剩着四颗
 *     同色星星（那是玩家亲眼看见的那一幕）。
 *   ② **它还结束得了吗**——「全是星星」不再是终局之后，如果死局那条路没跟着
 *     补上，一盘谁也凑不出来的棋盘会永远结束不了。机器人滑到没东西可动，这一
 *     局还挂着，就是这种情况。
 *
 * 机器人是随机滑的，所以每次跑到的局面不一样：有时候打到全消完，有时候打到死
 * 局，有时候预算用完了这一局还活着——**三种都算过**，第 ① 条只在真的结束了的
 * 时候才量。它是岗哨，不是复现脚本。
 *
 * 要开浏览器、一跑好几分钟，所以留在本地手跑，不进 CI。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8961/';
/** 滑多少步就收工（一步约 1.2 秒）。 */
const BUDGET = Number(process.argv[3] || 220);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } });
await ctx.addInitScript(() => {
  localStorage.setItem('slides_lang', 'zhHans');
  localStorage.setItem('slides_intro_seen', '1');
  // 头一局那套引导会把主菜单锁住，也会在棋盘底下摆一块教学条；这道门量的不是
  // 它，所以先把「已经玩过」记上，直接进正常的一局。
  for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_played_square', 'slides_played_circle', 'slides_know_how'])
    localStorage.setItem(k, '1');
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

const PIECES = '#boardWrap .ball';

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
await page.waitForTimeout(300);
const opened = await page.$$eval('.home-icon-btn', (els) => {
  const i = els.findIndex((e) => (e.getAttribute('aria-label') || '').trim() === '圆球');
  if (i < 0) return null;
  els[i].click();
  return true;
});
check('主菜单上开得了《圆球》', opened === true);
await page.waitForFunction((sel) => document.querySelectorAll(sel).length > 0, PIECES, { timeout: 30000 });
await page.waitForTimeout(900);

/**
 * 盘面此刻的样子：每一枚的面、颜色、位置。
 *
 * **颜色不能只读 background。** 星星那一面的 background 是 transparent，颜色画
 * 在里头那个 svg 的 stroke 上（circle.ts 的 makeBallEl）。这道门第一版读的是
 * background，于是二十一颗星星被算成同一种颜色，「同色星星最多几颗」那一条量
 * 的是「一共几颗星星」——又一次「量到了别的东西」。
 */
const snap = () =>
  page.$$eval(PIECES, (els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      const stroke = e.querySelector('svg g')?.getAttribute('stroke') || '';
      return {
        at: `${e.dataset.r},${e.dataset.c}`,
        face: e.dataset.face || '',
        color: e.dataset.face === 'dot' ? stroke : getComputedStyle(e).backgroundColor,
        x: r.x + r.width / 2,
        y: r.y + r.height / 2,
        w: r.width,
      };
    }),
  );

/**
 * 等这一步真的走完。
 *
 * 一步棋不是松手就结束：得分高亮 550ms、翻面 350ms、连锁一步接一步，整线消除
 * 那一下还要 1250ms。拖动过程中盘上还摆着低透明度的补位球，数着比实际多——第
 * 一版固定等 1150ms，量到过「盘上 36 枚」（这副棋盘一共只有 28 枚）。所以等到
 * 枚数连着两次一样为止。
 */
async function settle(maxMs = 6000) {
  const t0 = Date.now();
  let prev = -1;
  for (;;) {
    await page.waitForTimeout(450);
    const now = await snap();
    if (now.length === prev) return now;
    prev = now.length;
    if (Date.now() - t0 > maxMs) return now;
  }
}

/** 结算页出来了吗，写的是哪一句。 */
const ended = () =>
  page.evaluate(() => {
    const ov = document.querySelector('#endOverlay, .end-overlay');
    if (!ov || !ov.classList.contains('show')) return null;
    return (ov.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  });

/** 同色星星最多几颗（玩家看见的那件事：还剩四颗蓝星）。 */
function maxStarRun(board) {
  const byColor = new Map();
  for (const b of board) if (b.face === 'dot') byColor.set(b.color, (byColor.get(b.color) ?? 0) + 1);
  let most = 0;
  let which = '';
  for (const [c, n] of byColor) if (n > most) { most = n; which = c; }
  return { most, which };
}

let moves = 0;
let card = null;
let last = await settle();
/** 这一局里见过的最多星星数 / 有没有见过「一枚色块都不剩」。 */
let mostStarsSeen = 0;
let sawAllStars = false;
while (moves < BUDGET) {
  card = await ended();
  if (card) break;
  const alive = last.filter((b) => b.face !== 'blank');
  if (alive.length === 0) { await page.waitForTimeout(1500); card = await ended(); break; }
  const pick = alive[Math.floor(Math.random() * alive.length)];
  const dir = Math.random() < 0.5 ? -1 : 1;
  await page.mouse.move(pick.x, pick.y);
  await page.mouse.down();
  await page.mouse.move(pick.x + dir * pick.w * 1.15, pick.y, { steps: 6 });
  await page.mouse.up();
  moves++;
  await page.waitForTimeout(700);
  last = await settle();
  const nowStars = last.filter((b) => b.face === 'dot').length;
  if (nowStars > mostStarsSeen) mostStarsSeen = nowStars;
  if (nowStars > 0 && last.every((b) => b.face !== 'flavor')) sawAllStars = true;
  if (moves % 20 === 0) {
    const s = maxStarRun(last);
    console.log(`  · 第 ${moves} 步：剩 ${last.filter((b) => b.face !== 'blank').length} 枚（星星 ${last.filter((b) => b.face === 'dot').length}，同色最多 ${s.most}）`);
  }
}

const board = last;
const nonBlank = board.filter((b) => b.face !== 'blank');
const stars = board.filter((b) => b.face === 'dot');
const fronts = board.filter((b) => b.face === 'flavor');
const { most } = maxStarRun(board);
console.log(
  `\n滑了 ${moves} 步：${card ? '这一局结束了' : '这一局还活着'}；` +
  `盘上 ${nonBlank.length} 枚（色块 ${fronts.length}、星星 ${stars.length}、同色星星最多 ${most}）`,
);

if (card) {
  console.log(`结算页：${card.slice(0, 120)}`);
  const cleared = card.includes('全部消完了');
  const noMatch = card.includes('再也凑不出得分图案');
  check('结算页写的是认得出的收场理由', cleared || noMatch, card.slice(0, 80));

  // ① 报「全部消完了」，那就真的一枚不剩。
  if (cleared) {
    check(
      '报「全部消完了」时盘面真的空了（一颗星星都不剩）',
      nonBlank.length === 0,
      `还剩 ${nonBlank.length} 枚：色块 ${fronts.length}、星星 ${stars.length}`,
    );
  }
  // ② 报「再也凑不出」时，不该还剩着够凑一组的同色星星。小球最短的整线是 3
  //    颗，图案最少 4 颗，门槛取小的那个——3 颗。
  if (noMatch) {
    check(
      '报「再也凑不出」时，没有哪种颜色还剩着 3 颗以上的星星',
      most < 3,
      `同色星星最多 ${most} 颗`,
    );
  }
  // 玩家那一幕的直接复现：四颗同色星星在盘上，这一局绝不该已经结束。
  check(
    '结束的这一刻，盘上没有四颗同色星星还等着凑图案（玩家报的正是这一幕）',
    most < 4,
    `同色星星最多 ${most} 颗`,
  );
} else {
  // 没结束也要说得过去：盘上必须还有东西可玩。一枚不剩却还挂着，就是
  // 「isGameOver 不收场、死局判定又说还活着」那种永远结束不了的局。
  check(
    '没结束是因为盘上还有东西可玩，不是因为它忘了结束',
    nonBlank.length > 0,
    `盘上 ${nonBlank.length} 枚`,
  );
}

// 这道门自己的岗哨：机器人真的在玩。
//
// 它是随机滑的，所以上面那几条大多数时候走的是「还活着」那一支——如果哪天棋盘
// 的 DOM 变了、机器人其实一步都没滑动，那一支会安安静静地绿（盘上当然还有东
// 西）。所以这儿量一件必然发生的事：滑了上百步，总该有色块得分变成星星。
check(
  '机器人真的在玩（这一局里出现过星星）',
  mostStarsSeen > 0,
  `最多同时有 ${mostStarsSeen} 颗星星${sawAllStars ? '；见过「一枚色块都不剩」' : ''}`,
);
if (sawAllStars) {
  // 撞上玩家那一幕了：满盘星星。这时候只要还有一种颜色够得着门槛（小球 3
  // 颗），这一局就绝不该已经收场——星星自己还能凑图案、还能连成线。
  console.log('（这一趟真的走到过「满盘星星」，上面那几条量的就是玩家报的那一幕）');
}

console.log(errs.length ? `\n页面报错：${errs.slice(0, 3).join(' | ')}` : '\n全程零报错');
if (errs.length) fail++;
await browser.close();
process.exit(fail ? 1 : 0);

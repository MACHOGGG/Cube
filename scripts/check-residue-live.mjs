/**
 * 残局兜底的**端到端验收**：手摆一副残局，看它该不该结算。
 *
 *   npx vite --port 8951 --strictPort &            ← 必须是 **dev** 服务器，见下面那段
 *   node scripts/check-residue-live.mjs http://localhost:8951/
 *
 * ⚠️ **手跑，不进 CI**（它要一台 vite dev 服务器，而 CI 里那几道浏览器门跑的都是 `dist`）。
 *
 * ── 为什么非要一次端到端 ──────────────────────────────────────
 *
 * 残局那一套（《侵蚀阶梯》§4）的链条很长：棋盘的 `stuckAt` → 计数层 `findStuckColorGroups`
 * → 穷举层 `edgeResidue` → 回一组「卡死的棋子」→ gameController 的 `updateStuckState` 红一
 * 下、1.4 秒后 `endGame('无法继续匹配')`。
 *
 * 这条链上每一段都已经各有一道门（`check-residue-board` 量编码和判定、
 * `check-residue-wiring` 读源码钉住那四行的次序、`check-stalemate` 量计数层）。可**没有一处
 * 量过「真的开一局、真的走到残局、真的结算」**——因为一局正常的棋要打到「可用 ≤16 枚」得翻
 * 掉二三十枚，而自检机器人每十步左右才翻一枚。所以这条链从落地那天起只被分段验过。
 *
 * 分段全绿而整条断掉，这个仓库出过不止一次。这道门补的就是那一次整条。
 *
 * ── 为什么是 dev 服务器 ───────────────────────────────────────
 *
 * 手摆盘面靠 `engine/devDeal.ts`，而它整段藏在 `import.meta.env.DEV` 后面——**正式包里根本
 * 不存在**。那是有意的：一个能手摆盘面的入口在线上等于一个作弊器（摆一副一步就能清的盘，
 * 分数想多少有多少），而排行榜是真的。所以这道门只能对着 `vite` 的开发服务器跑。
 *
 * ── 两副盘面 ──────────────────────────────────────────────────
 *
 * 都是「**计数层说活**」的——不然结算是计数层做的，穷举那一层量不出东西。两副的差别只在
 * 几何：
 *
 *   ① 几何已死 → 该结算（1.4 秒之后，理由写「无法继续匹配」）。
 *   ② 几何也活 → 不许结算。②（反面那一副）才是这道门最要紧的一条：一道「什么都判死」的
 *      兜底会把每一局在残局处掐掉，而那比不结束难看得多。
 *
 * 两副都是拿真的小球线、真的判定搜出来的（脚本见 scratchpad 里的 find-fixture.mjs，筛的条件
 * 正是「计数活 ＋ 精确搜索死 / 活」）。
 */
import { chromium } from 'playwright';

const base = (process.argv[2] || '').replace(/\/+$/, '');
if (!base) {
  console.error('用法：node scripts/check-residue-live.mjs http://localhost:8951/');
  console.error('⚠️ 要 **vite dev** 服务器（npx vite --port 8951 --strictPort），不是 dist。');
  process.exit(2);
}

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/**
 * 两副手摆的小球残局。一行一格地写，`.` 是空白（已经削掉）。
 *
 * `1*` = 一枚 1 号色的星星；`1` = 一枚 1 号色的色块。格式见 engine/devDeal.ts。
 */
const DEAD = [
  '.',
  '. 2*',
  '. . .',
  '. . . 1*',
  '. . . . .',
  '. . . . . .',
  '. 1* . . . 1 .',
];
const ALIVE = [
  '.',
  '2* 3',
  '. . 1',
  '. . 2 .',
  '. . . . .',
  '. . . . 2 .',
  '. . . . 1 . .',
];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/**
 * 滑一枚棋子，直到真的有一枚动了。回「动了没有」。
 *
 * 换着棋子试：一条线上只有一枚活格的时候那一枚压根滑不动（循环位移在一格上是恒等），而
 * 残局上这种线很多。有一枚动了就算这一步走成了。
 */
async function dragAnyPiece(page) {
  const fingerprint = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('#boardWrap .ball, #boardWrap .tile')]
        .map((el) => {
          const r = el.getBoundingClientRect();
          return `${Math.round(r.left)},${Math.round(r.top)},${el.dataset.face ?? ''}`;
        })
        .join('|'));
  const before = await fingerprint();
  const n = await page.evaluate(() => document.querySelectorAll('#boardWrap .ball, #boardWrap .tile').length);
  /**
   * ⚠️ **滑多远是有讲究的**，不是「滑够远就行」。
   *
   * `applyDrag` 把位移折成整数格（`projectedSteps`），然后 `if (shift % n === 0) return
   * false`——**整圈等于没动**。残局上一条线常常只剩两个活格（n = 2），这时候只有**奇数**格
   * 才真的换位置；第一版一律滑两格多（2.5 个球宽 ≈ 2.3 格 → 折成 2），于是四枚球一枚都没
   * 动，而门报的是「这一步没走成」。
   *
   * 所以这儿按格距扫几个距离（0.8…3.2 格），再配上两个方向、三族线各一个大致角度。有一枚
   * 动了就算这一步走成了。
   */
  const DISTS = [1.05, 2.05, 3.05, 1.55];
  const DIRS = [[1, 0], [-1, 0], [0.5, 0.87], [-0.5, -0.87], [0.5, -0.87], [-0.5, 0.87]];
  for (let i = 0; i < n; i++) {
    const at = await page.evaluate((k) => {
      const all = [...document.querySelectorAll('#boardWrap .ball, #boardWrap .tile')];
      const el = all[k];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      // 格距：同一行里相邻两格的中心距。拿最接近的另一枚估一下，只有一枚时退回球宽 ×1.08。
      let pitch = r.width * 1.08;
      let best = Infinity;
      for (const other of all) {
        if (other === el) continue;
        const o = other.getBoundingClientRect();
        const d = Math.hypot(o.left - r.left, o.top - r.top);
        if (d < best) { best = d; }
      }
      if (best < r.width * 4) pitch = Math.max(r.width * 0.9, best / Math.round(best / (r.width * 1.08)) || pitch);
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, pitch };
    }, i);
    if (!at) continue;
    for (const dist of DISTS) {
      for (const [ux, uy] of DIRS) {
        const len = at.pitch * dist;
        await page.mouse.move(at.x, at.y);
        await page.mouse.down();
        for (let k = 1; k <= 12; k++) {
          await page.mouse.move(at.x + (ux * len * k) / 12, at.y + (uy * len * k) / 12);
        }
        await page.mouse.up();
        await page.waitForTimeout(260);
        if ((await fingerprint()) !== before) return true;
      }
    }
  }
  return false;
}

/** 开一局小球，手摆那副牌，走一步，等 `waitMs` 毫秒，回「结算了没有、理由是什么」。 */
async function run(rows, waitMs) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  // reduced-motion：每一拍都立刻跑完，1.4 秒那一下才量得准。
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((deal) => {
    localStorage.setItem('slides.devDeal', JSON.stringify({ circle: deal }));
  }, rows);
  await page.goto(base + '/', { waitUntil: 'networkidle' });

  // 主菜单 → 圆球那张卡 → 开局。卡片按 aria-label 认（菜单摆位改了也还认得）。
  await page.waitForSelector('.home-icon-btn', { timeout: 15000 });
  // 跳过最上面那张《每日挑战》（第 19 推）：这儿按下标点的是玩法卡，下标从方块数起。
  const card = page.locator('.home-icon-btn:not(.home-icon-btn--daily)').nth(1);
  await card.click();
  // ⚠️ `#startBtn` 是**藏着的**（开局页有自己的倒数窗，那颗键只给读屏和门用）。所以等
  // `attached` 而不是 `visible`，而且用 `$eval` 点，不用 `click()`——别的门也都是这么做的
  // （check-start-page / check-coach-aim），第一版照 `click()` 写，33 次重试之后超时。
  await page.waitForSelector('#startBtn', { timeout: 15000, state: 'attached' });
  await page.$eval('#startBtn', (el) => el.click());
  await page.waitForSelector('.board', { timeout: 15000 });
  // 开局页那段倒数走完才真的开始。
  await page.waitForTimeout(1200);

  // 手摆那副牌真的生效了没有：盘上**非空白**的球该正好这么多。
  const want = rows.join(' ').split(/\s+/).filter((t) => t && t !== '.').length;
  const got = await page.evaluate(() =>
    document.querySelectorAll('.ball:not([data-face="blank"]), .tile:not([data-face="blank"])').length);

  /*
   * ⚠️ **必须先走一步。**
   *
   * 死活是在一步的连锁走完之后才问的（gameController 的 `updateStuckState` 只在那一处被
   * 叫，见 check-residue-wiring）。摆好一副死盘面干等是等不到结算的——而那是对的：没碰过
   * 的盘面谈不上「卡死」。第一版就是干等，两副都「没结算」，而红的是门自己。
   *
   * 随便滑哪一枚都行，滑得动就算走了一步。四枚球里总有一枚所在的线上还有别的活格。
   */
  const moved = await dragAnyPiece(page);
  await page.waitForTimeout(waitMs);
  /**
   * 结算了没有，以及**为什么**。
   *
   * ⚠️ 理由不在屏幕上：结算页的标题永远是那句通用的「Challenge complete」
   * （gameController 的 `refs.endTitleEl.textContent = s.endTitleDefault`）。真正的理由
   * 存进了这一局的存档里（`RunData.reason`，runRecord.ts 的 REASON_LABEL_KEY 那张表）。
   * 所以这儿读 localStorage 里那几局，而不是读 DOM——第一版照 DOM 找「无法继续匹配」，
   * 那句话压根不在页面上。
   */
  const out = await page.evaluate(() => {
    /*
     * ⚠️ **结算页那块 DOM 从一开始就在**（gameShell 的模板里就有，标题写着那句通用的
     * 「Challenge complete」），结算只是给它加一个 `show`。所以判「结算了没有」**必须看
     * `show`**，不能看「这个元素在不在」或者「它有没有字」——第一版照后者写，两副盘面都
     * 报「结算了」，而其实一局都没结束。
     */
    const el = document.querySelector('#endOverlay');
    const on = !!el && el.classList.contains('show');
    const shown = on ? (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120) : null;
    let reason = null;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      // 存档键是 `<bestKey>::runs`（engine/persistence.ts 的 RUNS_SUFFIX）。
      if (!k || !k.endsWith('::runs')) continue;
      try {
        const list = JSON.parse(localStorage.getItem(k) || '[]');
        if (Array.isArray(list) && list.length) {
          const newest = list.slice().sort((a, b) => (b.at || 0) - (a.at || 0))[0];
          reason = newest?.data?.reason ?? null;
        }
      } catch { /* 坏了就算了 */ }
    }
    return { shown, reason };
  });
  await page.close();
  return { want, got, over: out.shown, reason: out.reason, moved };
}

console.log('① 计数说活、几何已死 → 该结算');
{
  const r = await run(DEAD, 2600);
  check('（尺子）手摆那副牌生效了，盘上正好那么多枚', r.got === r.want, `${r.got} / 要 ${r.want}`);
  check('（尺子）真的走出了一步（不然死活压根不会被问）', r.moved === true, String(r.moved));
  check('结算了', r.over !== null, String(r.over));
  check('理由是「无法继续匹配」（存档里那一位，不是屏幕上的标题）',
    r.reason === '无法继续匹配', String(r.reason));
}

console.log('\n② 几何也活 → 不许结算（这一条最要紧）');
{
  const r = await run(ALIVE, 3200);
  check('（尺子）手摆那副牌生效了，盘上正好那么多枚', r.got === r.want, `${r.got} / 要 ${r.want}`);
  check('**没有**结算', r.over === null, `${r.over} ／ 理由 ${r.reason}`);
}

await browser.close();
console.log(fail ? `\n${fail} 条红` : '\n全绿');
process.exit(fail ? 1 : 0);

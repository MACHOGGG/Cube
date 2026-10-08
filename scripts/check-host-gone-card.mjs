/**
 * 屋主走掉之后，坐在小屋页上的客人按《ok》——打过局的要拿到那张总战绩图（2026-10-08 方案 2-3）。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8822 dist      （内存版；TESTMONTH、TESTYEAR 各兑一次）
 *   node scripts/check-host-gone-card.mjs http://localhost:8822/
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么
 *
 * 一间屋子散场有三条路，屋里的人拿到的本该是同一样东西：
 *
 *   · 屋主按《解散》——屋里的人手上亮起那张总战绩图（watchRoom 读到 ended）；
 *   · 客人自己按《离开》——同一张图（multiplayer.ts 的 leaveSeat，check-room-leave-card 守着）；
 *   · 屋主**走掉**（把网页关了，服务器听到 bye）——小屋页上盖一层「屋主离家出走了，小屋暂时
 *     解散」，按《ok》出去。
 *
 * 第三条从前按完《ok》直接回主菜单：同一间屋子、同一桌人，屋主是按键解散的就有图，屋主是关
 * 网页走的就什么都没有——他们在这间屋子里打过的每一局一笔勾销。现在和 leaveSeat 一样：先抓下
 * 排行和「我是哪一位」，再交座位，打过局的看图，一局都没打过的照旧回主菜单（图上全是 0）。
 *
 *   ① 尺子：一局都没打过的屋子，屋主走掉，按《ok》回主菜单、不出图（不然 ② 在「什么时候都出
 *      图」时也绿）。
 *   ② 打过一局的屋子，屋主走掉：按《ok》拿到的是总战绩图——两个人都在、认得出自己、
 *      「共 1 局」、图画出来了。
 *   ③ 座位照样交回去了（这条路从前修过一次「只在本机忘掉、服务器上座位还占着」）：
 *      刷新之后不会被领回那间屋子。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2];
if (!BASE) {
  console.error('用法: node scripts/check-host-gone-card.mjs http://localhost:8822/');
  process.exit(2);
}
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

async function newPlayer() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => {
    // 预设「看过教学」：这台门量的是散场那一下，不是头一局的教学条（CLAUDE.md「跑门时的坑」）。
    for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
      localStorage.setItem(k, '1');
    localStorage.setItem('slides_lang', 'zhHans');
  });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#navProfile', { timeout: 20000 });
  return { ctx, page };
}

/** 兑一张内部码，这个人就有开屋的权限了。一张码在一台 dev-server 上只能兑一次。 */
async function giveGenius(page, code) {
  const ok = await page.evaluate(async (c) => {
    const r = await fetch('/api/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: c }),
    }).then((x) => x.json());
    if (!r.active) return false;
    localStorage.setItem(
      'slides_genius',
      JSON.stringify({ active: true, period: r.period, until: r.until, channel: 'code', email: r.email, token: r.token, code: r.code }),
    );
    return true;
  }, code);
  check(`（尺子）${code} 兑到了开屋的权限`, ok);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#navProfile');
}

const openRoom = async (page, name) => {
  await page.click('#navProfile');
  await page.click('#multiRow');
  await page.waitForSelector('#mpCreate');
  await page.fill('#mpName', name);
  await page.click('#mpCreate');
  await page.waitForSelector('.mp-code', { timeout: 10000 });
  return page.$eval('.mp-code', (e) => e.textContent.trim());
};
const joinRoom = async (page, name, code) => {
  await page.click('#navProfile');
  await page.click('#multiRow');
  await page.waitForSelector('#mpCreate');
  await page.fill('#mpName', name);
  // 四位打满自动进屋，没有《加入》那颗键（见 ui/multiplayer.ts 的 joinNow）。
  await page.fill('#mpCode', code);
  await page.waitForSelector('.mp-code', { timeout: 10000 });
};
const twoIn = (page) =>
  page.waitForFunction(() => document.querySelectorAll('.mp-player').length === 2, { timeout: 15000 });
/** 屋主给全屋挑一个玩法，开一局。跳过最上面那张《每日挑战》。 */
const hostPicks = async (page) => {
  await page.click('#mpPick');
  await page.waitForSelector('#roomPickBar');
  await page.$$eval('.home-icon-btn:not(.home-icon-btn--daily)', (els) => els[0].click());
};
const boardUp = (page) =>
  page.waitForFunction(() => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball').length > 0, { timeout: 20000 });
const finish = async (page) => {
  await page.click('#finishBtn');
  await page.waitForSelector('#finishConfirm', { timeout: 8000 });
  await page.click('#mpFinishYes');
};
/**
 * 屋主把网页关掉：pagehide 会发 bye，服务器再过 BYE_GRACE_MS（10 秒）才当真，客人那一页
 * 下一次轮询读到，盖上「小屋暂时解散」那一层。按一下《ok》。
 */
const hostWalksOff = async (host, guest) => {
  await host.page.goto('about:blank');
  const shown = await guest.page
    .waitForSelector('#roomCancelled', { timeout: 60000 })
    .then(() => true)
    .catch(() => false);
  check('（尺子）屋主关掉网页，客人那一页盖上了「小屋暂时解散」', shown);
  if (shown) await guest.page.click('#roomCancelledOk');
  return shown;
};
const finalShown = (page, ms) =>
  page
    .waitForSelector('#mpFinalDone', { timeout: ms })
    .then(() => true)
    .catch(() => false);

// ============ ① 尺子：一局都没打过，屋主走掉 → 回主菜单，不出图 ============
{
  const A = await newPlayer();
  await giveGenius(A.page, 'TESTMONTH');
  const code = await openRoom(A.page, '甲');
  const B = await newPlayer();
  await joinRoom(B.page, '乙', code);
  await twoIn(A.page);
  if (await hostWalksOff(A, B)) {
    const card = await finalShown(B.page, 3000);
    check('① 一局都没打过：按《ok》不出总战绩图（图上全是 0，不如不出）', !card);
    // 认「还在不在屋里」用小屋页那颗《离开小屋》（#mpLeave）和本机记的座位，不用 .mp-code——
    // 总战绩图上那个大数字也挂着 .mp-code，拿它认会把「出了图」误判成「还在屋里」。
    check('① 而且不再坐在那间小屋里', !(await B.page.$('#mpLeave')));
    check('① 本机记的座位清掉了', (await B.page.evaluate(() => localStorage.getItem('slides_mp_seat'))) === null);
  }
  await A.ctx.close();
  await B.ctx.close();
}

// ============ ② 打过一局，屋主走掉 → 按《ok》拿到总战绩图 ============
{
  const C = await newPlayer();
  await giveGenius(C.page, 'TESTYEAR');
  const code = await openRoom(C.page, '丙');
  const D = await newPlayer();
  await joinRoom(D.page, '丁', code);
  await twoIn(C.page);

  await hostPicks(C.page);
  await boardUp(C.page);
  await boardUp(D.page);
  await finish(C.page);
  await finish(D.page);
  const back = await D.page
    .waitForFunction(() => !document.querySelector('#mpWait') && !!document.querySelector('#mpLeave'), { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  check('（尺子）这一局两个人都交了卷，客人回到小屋页', back);

  if (back && (await hostWalksOff(C, D))) {
    const got = await finalShown(D.page, 15000);
    check('② 打过一局：按《ok》拿到的是总战绩图，不是空手回主菜单', got,
      await D.page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 90)));
    if (got) {
      const card = await D.page.evaluate(() => {
        const rows = [...document.querySelectorAll('#mpFinalRows .mp-player')];
        return {
          rows: rows.length,
          mine: rows.filter((r) => r.classList.contains('mp-player--me')).length,
          rounds: (document.body.innerText.match(/共\s*(\d+)\s*局/) || [])[1] ?? '',
        };
      });
      check('② 总排行上两个人都在（走掉的屋主也在——他那一局算数）', card.rows === 2, `${card.rows} 行`);
      check('② 自己那一行认得出来（座位刚交回去，认人靠走之前留的那份 id）', card.mine === 1,
        `${card.mine} 行标着「我」`);
      check('②「共 N 局」认得出这间屋子打过', card.rounds === '1', card.rounds);
      // 战绩图是异步画的，给它一帧。
      await D.page.waitForTimeout(600);
      const drawn = await D.page.evaluate(() => {
        const img = document.querySelector('#mpFinalCard');
        return !!img && (img.getAttribute('src') || '').startsWith('data:image');
      });
      check('② 战绩图画出来了（可以发出去的那一张）', drawn);
    }

    // ③ 座位交回去了：本机不再记着那间屋子，刷新之后不会被领回去。
    const seat = await D.page.evaluate(() => localStorage.getItem('slides_mp_seat'));
    check('③ 本机记的座位清掉了', seat === null, String(seat).slice(0, 60));
    await D.page.reload({ waitUntil: 'load' });
    await D.page.waitForSelector('#navProfile', { timeout: 20000 }).catch(() => {});
    await D.page.waitForTimeout(1500);
    check('③ 刷新之后没有被领回那间小屋', !(await D.page.$('#mpLeave')) && !(await D.page.$('#mpFinalDone')));
  }
  await C.ctx.close();
  await D.ctx.close();
}

await browser.close();
console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

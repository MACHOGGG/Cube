/**
 * 非屋主离开 / 屋主中途散场——那个人拿到的是什么。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8820 dist      （内存版，TESTMONTH 只能兑一次）
 *   node scripts/check-room-leave-card.mjs http://localhost:8820/
 *
 * 玩家报的原话：「非屋主的玩家离开游戏的时候还是完全没有得到任何结算分数和
 * 榜单的部分」。查两条路：
 *
 *   1. 小屋页上按《离开小屋》——从前这一条只是交座位、回设置页，一个数字都
 *      不给。现在要出那张总排行（名次、总分、战绩图），而且自己那一行要认得
 *      出来（座位刚交回去，认「我是谁」靠的是走之前留的那份 id）。
 *   2. 屋主中途解散、这一局转成单人接着打完——结算页上要两份：小屋的总排行
 *      和它的战绩图在上，这一局单人的结算和它自己那张图在下。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2];
if (!BASE) {
  console.error('用法: node scripts/check-room-leave-card.mjs http://localhost:8820/');
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

/** 兑一张内部码，这个人就有开屋 / 打天才玩法的权限了。 */
async function giveGenius(page) {
  await page.evaluate(async () => {
    const r = await fetch('/api/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'TESTMONTH' }),
    }).then((x) => x.json());
    if (r.active)
      localStorage.setItem(
        'slides_genius',
        JSON.stringify({ active: true, period: r.period, until: r.until, channel: 'code', email: r.email, token: r.token, code: r.code }),
      );
  });
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
  await page.fill('#mpCode', code);
  await page.click('#mpJoin');
  await page.waitForSelector('.mp-code', { timeout: 10000 });
};
/** 屋主给全屋挑一个玩法，开一局。 */
const hostPicks = async (page, i = 0) => {
  await page.click('#mpPick');
  await page.waitForSelector('#roomPickBar');
  await page.$$eval('.home-icon-btn', (els, k) => els[k].click(), i);
};
const boardUp = (page) =>
  page.waitForFunction(() => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball').length > 0, { timeout: 20000 });
/** 交卷。 */
const finish = async (page) => {
  await page.click('#finishBtn');
  await page.waitForSelector('#finishConfirm', { timeout: 8000 });
  await page.click('#mpFinishYes');
};
/** 按《离开小屋 / 解散小屋》并确认。 */
const leaveAndConfirm = async (page, sel) => {
  await page.click(sel);
  await page.waitForSelector('#leaveRoomConfirm', { timeout: 8000 });
  await page.$$eval('#leaveRoomConfirm button', (els) => els.find((e) => /还是离开|离开|解散/.test(e.textContent)).click());
};

// A 是屋主（有权限），整场都用他这一间屋子。
const A = await newPlayer();
await giveGenius(A.page);
const code = await openRoom(A.page, '甲');

// ============ 1. 打过一局的客人，从小屋页离开 ============
{
  const B = await newPlayer();
  await joinRoom(B.page, '乙', code);
  await A.page.waitForFunction(() => document.querySelectorAll('.mp-player').length === 2, { timeout: 15000 });

  // 打完一局：两个人都交卷，回到小屋页。
  await hostPicks(A.page);
  await boardUp(A.page);
  await boardUp(B.page);
  await finish(A.page);
  await finish(B.page);
  await B.page.waitForFunction(() => !document.querySelector('#mpWait') && !!document.querySelector('#mpLeave'), { timeout: 30000 });

  // 客人在小屋页上按《离开小屋》。
  await leaveAndConfirm(B.page, '#mpLeave');
  const got = await B.page
    .waitForSelector('#mpFinalDone', { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  check('客人从小屋页离开，拿到的是总排行那一页，不是空手回设置页', got,
    await B.page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 90)));
  if (got) {
    const card = await B.page.evaluate(() => {
      const rows = [...document.querySelectorAll('#mpFinalRows .mp-player')];
      return {
        rows: rows.length,
        mine: rows.filter((r) => r.classList.contains('mp-player--me')).length,
        total: document.querySelector('.mp-code')?.textContent?.trim() ?? '',
        rounds: (document.body.innerText.match(/共\s*(\d+)\s*局/) || [])[1] ?? '',
        img: !!document.querySelector('#mpFinalCard'),
      };
    });
    check('总排行上两个人都在', card.rows === 2, `${card.rows} 行`);
    check('自己那一行认得出来（座位已经交回去了）', card.mine === 1, `${card.mine} 行标着「我」`);
    // 总分这一格里的数字本身不查：测试里的人一分没得，0 是对的。查的是那一
    // 格在不在、以及「共几局」认得出这间屋子真打过。
    check('全屋总分那一格在', card.total !== '', card.total);
    check('「共 N 局」认得出这间屋子打过', card.rounds === '1', card.rounds);
    // 战绩图是异步画的，给它一帧。
    await B.page.waitForTimeout(600);
    const drawn = await B.page.evaluate(() => {
      const img = document.querySelector('#mpFinalCard');
      return !!img && (img.getAttribute('src') || '').startsWith('data:image');
    });
    check('战绩图画出来了（可以发出去的那一张）', drawn);
  }
  await B.ctx.close();
}

// ============ 2. 屋主中途散场，有权限的人转单人打完 ============
//
// 这一条要的是「两个结算分上下」：小屋的总排行 + 它的战绩图在上，这一局单人
// 的结算 + 它自己那张图在下。
//
// 接着上面那间屋子往下演，不另开一间：TESTMONTH 一台服务器只兑得动一次，
// 第二个屋主根本开不了屋。
{
  const C = await newPlayer();
  await joinRoom(C.page, '丙', code);
  await A.page.waitForFunction(() => document.querySelectorAll('.mp-player').length >= 2, { timeout: 15000 });

  // 第二局开着的时候屋主解散。基础玩法人人都能打，所以客人会原地转单人。
  await hostPicks(A.page);
  await boardUp(A.page);
  await boardUp(C.page);
  await leaveAndConfirm(A.page, '#leaveRoomBtn');

  // 客人这边：小屋没了，棋盘还在，底下那条实时排名撤了、《暂停》顶上来。
  const solo = await C.page
    .waitForFunction(
      () => !document.querySelector('#mpRank') && document.querySelectorAll('#boardWrap .tile, #boardWrap .ball').length > 0,
      { timeout: 25000 },
    )
    .then(() => true)
    .catch(() => false);
  check('屋主散场，有权限的客人原地转成单人接着打', solo);

  // 打完这一局单人。转单人之后《完成》是单人那一颗，不再问「交卷吗」。
  await C.page.click('#finishBtn');
  const ended = await C.page
    .waitForFunction(() => document.querySelector('#endOverlay')?.classList.contains('show'), { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  check('这一局单人打完，出结算页', ended);
  if (ended) {
    await C.page.waitForTimeout(800);
    const both = await C.page.evaluate(() => {
      const block = document.getElementById('endRoomBlock');
      const img = block?.querySelector('.end-room-card');
      const score = document.getElementById('endScore');
      const shareBtn = document.getElementById('shareBtn');
      return {
        roomShown: !!block && !block.hidden,
        roomRows: block ? block.querySelectorAll('.mp-player').length : 0,
        roomImg: !!img && (img.getAttribute('src') || '').startsWith('data:image'),
        roomTop: block && score ? block.getBoundingClientRect().top < score.getBoundingClientRect().top : false,
        soloScore: score?.textContent ?? '',
        soloShare: !!shareBtn && !shareBtn.hidden,
      };
    });
    check('结算页上摆着小屋那一份', both.roomShown && both.roomRows >= 2, `${both.roomRows} 行`);
    check('小屋那份带着它自己的战绩图', both.roomImg);
    check('小屋那份在上、这一局单人的在下', both.roomTop);
    check('单人这一份的综合得分还在', both.soloScore !== '', both.soloScore);
    check('单人这一份自己的《分享战绩》还在', both.soloShare);
  }

  // 再开一局纯单人：小屋那一块不该跟着冒出来（那份底开局就该清掉）。
  await C.page.evaluate(() => document.getElementById('restartBtn')?.click());
  await boardUp(C.page);
  await C.page.click('#finishBtn');
  await C.page
    .waitForFunction(() => document.querySelector('#endOverlay')?.classList.contains('show'), { timeout: 20000 })
    .catch(() => {});
  await C.page.waitForTimeout(400);
  const leaked = await C.page.evaluate(() => {
    const block = document.getElementById('endRoomBlock');
    return !!block && !block.hidden;
  });
  check('下一局纯单人的结算页上，早散了的那间小屋不再冒出来', !leaked);
  await C.ctx.close();
}

await browser.close();
console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

/**
 * 点了《再来一局》之后，等新的一局真的开起来（10-31 方案推06 Z-C05，D35 甲）。
 *
 * 原先《再来一局》直接 newGame：点完下一帧就是新棋盘，门里点完等几百毫秒就接着量。现在所有玩法重开都先回到
 * 那一页数 4-3-2-1（老虎机先转一遍轮子再数 5 下），数完才替玩家按 #startBtn——照旧等几百毫秒的门量到的还是
 * 上一局的盘面、按到的暂停键还没生效（控制器 started 为假时不理暂停）。
 *
 *   await afterRestart(page)              // 真等那一页数完（量倒数之外的东西，又想走真路的门）
 *   await afterRestart(page, { skip: true })   // 直接替玩家按 #startBtn 跳过——只用在不量倒数的门里
 *
 * skip 不会让这一局开两次：数完那一下「只有这一页还挂着才按」（gameShell.ts 的 runCount），而 #startBtn 一按
 * 那一页就收起来了。
 */
export async function afterRestart(page, { skip = false, timeout = 15000 } = {}) {
  // 《再来一局》那一下是同步把 #startOverlay 挂上 show 的；等它一下，免得在它露面之前就判「已经收起来了」。
  await page.waitForFunction(() => !!document.querySelector('#startOverlay.show'), null, { timeout: 3000 }).catch(() => {});
  if (skip) await page.evaluate(() => document.getElementById('startBtn')?.click());
  await page.waitForFunction(() => !document.querySelector('#startOverlay.show'), null, { timeout });
  // 新的一局的棋盘这一帧才发下去：给它两帧排好版。
  await page.waitForTimeout(300);
}

/**
 * 老虎机的局从基础那一本里搬出来——开机跑一次，两端共用（10-11 方案 B-7）。
 *
 * 老虎机那一局从前和基础局存在同一本里（原因见 engine/runKey.ts 的 SLOT_PART）。改过之后新局各进各的本，可
 * 这台设备上已经打过的那些还掺在基础那一本里：基础的「平均」照样把它们算进去，「本机最佳」可能就是老虎机那一
 * 局顶上去的。每一局自己记着 `data.slot`（gameController 结算时写的），所以分得准：带这一位的挪去老虎机那一
 * 本，别的留着。
 *
 * 「本机最佳」只有一个数，拆不开，只能推：
 *   · 老虎机那一本的最佳 = 挪过去那几局里最高的（moveRuns 自己会抬）；
 *   · 基础那一本的最佳**只在一种情形下改**：它正好等于挪走那几局里最高的分——这时它就是老虎机那一局顶上去
 *     的，改成留下来的基础局里最高的那个分（一局基础都没打过就删掉）。平手时改了也是同一个数；云上取回的基础
 *     局不抬最佳（mergeRuns 只并清单），所以留下来的基础局有可能比它还高，那就抬到那个分——那也是一局真打出来
 *     的基础分。别的情形一律不动：最佳比清单上每一局都高，说明那条纪录的局早被挤出存档了（只留最近 40 局），
 *     分不清是哪种玩法打的，改了反而可能抹掉一条真纪录（persistence 的 moveRuns 上面那段「只往上抬」是同一个
 *     道理）。
 *
 * 累计得分不受影响：它是所有本的清单加上各本被挤出去的那一笔（evictedScoreOf），局从一本挪到另一本，和不变。
 *
 * 开机时排在 restoreCloudRuns 之前，和 migrateMisfiledRuns 一样：先把本机理好，再接云上那份——云上那份按
 * runKeyFor 往下落，老虎机的局直接进老虎机那一本，mergeRuns 按编号去重，两头不会多出一局。
 *
 * 跑过就记一笔（SPLIT_KEY），不再跑。
 */
import { loadBest, loadRuns, moveRuns, overwriteBest } from './persistence';
import { suffixFor } from './runKey';

const SPLIT_KEY = 'slides_slot_split_v1';

/**
 * @param bestKeys 开得出老虎机的那几副棋盘的 card.bestKey（方块、小球）。多传几个不碍事——那几本里一局带
 *   `slot` 的都没有，什么也不挪。
 * @returns 挪了几局（给调用方打一行日志用）。
 */
export function splitSlotRuns(bestKeys: readonly string[]): number {
  try {
    if (localStorage.getItem(SPLIT_KEY)) return 0;
    let moved = 0;
    for (const bestKey of bestKeys) {
      const from = bestKey + suffixFor('base');
      const to = bestKey + suffixFor('base', { slot: true });
      let slotRuns = 0;
      let slotTop = 0;
      let baseTop = 0;
      for (const run of loadRuns(from)) {
        if (!run?.data) continue;
        const score = run.data.totalScore || 0;
        if (run.data.slot) {
          slotRuns++;
          slotTop = Math.max(slotTop, score);
        } else {
          baseTop = Math.max(baseTop, score);
        }
      }
      if (!slotRuns) continue;
      // moveRuns 不碰源那一档的最佳（见它上面那段），所以先读后读都一样；这里拿它和挪走那几局比。
      const best = loadBest(from);
      moved += moveRuns(from, to, (r) => !!r.data.slot);
      if (best === slotTop) overwriteBest(from, baseTop);
    }
    localStorage.setItem(SPLIT_KEY, '1');
    return moved;
  } catch {
    // 无痕模式之类读写不了的：这些局继续躺在基础那一本里，不该连带把开机拦住。
    return 0;
  }
}

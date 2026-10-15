import { BOMB_RULES_VERSION } from './bomb';
import { PUZZLE_RULES_VERSION } from './puzzleScore';
import { FLIP_RULES_VERSION, SCORING_RULES_HISTORY } from './scoring';
import { dropKey, markWiped, wipeKeyFor } from './persistence';
import { modeSuffix, suffixAt } from './runKey';

/**
 * 换计分规则时那一次性的清档——**两端共用**。
 *
 * 为什么非清不可：旧局和新局根本不是一把尺子量出来的。留着归档的话，记录页上那个
 * 「累计得分」是两套规则的和，结算页那个「本机最佳」还钉在一个现行规则下打不出来的
 * 旧数字上——无限反转封顶那次就是这么咬人的（见 engine/runKey.ts 开头）。
 *
 * 清的是两样：《侵蚀阶梯》之前那一套不带版本号的键（`modeSuffix` 给的玩法那一截）；和**每一个退下来的计分
 * 规则版本**的键（scoring.ts 的 SCORING_RULES_HISTORY，除了最后那个现行的）。每个玩法、每个已知的规则版本号
 * （炸弹、无限反转、步步为营各自的历史版本）都枚举一遍，普通那一本和老虎机那一本（`_slot`）都算——漏掉哪一个，
 * 那几局会在下一次有人按那个键去找的时候冒出来。
 *
 * 原先这一段只认《侵蚀阶梯》之前那一套，也没传步步为营的版本号（10-15 补充 S8，已复现）：模拟把计分规则升到
 * ero2、本机放 7 本 `_ero1` 存档（含 `_slot_ero1`、`_puzzle2_ero1`），跑一遍——一本都没清，哨兵还记成「本来就
 * 没东西可清」，记录页不会说「战绩从这里重新开始」。门 check-wipe-rules 量这一件。
 *
 * 跑过就记一笔（哨兵键跟着现行版本走），不再跑。
 *
 * ── 为什么搬出 main.ts ────────────────────────────────
 *
 * 它从前是 `src/main.ts` 里的一个私有函数，于是**只有网页端跑过**。小红书那一端
 * （`xhs/src/main.ts`）搜不到任何 `wipe` / `dropKey`——而两端用的是同一组
 * `sugarcube_*` 键名，所以那一端的旧局一直躺在本机上，哨兵键也永远不写入。搬成模块
 * 之后两端各调一次，谁都不会再漏。
 *
 * @param bestKeys 这一端有哪几副棋盘的档要清。网页端是全部六副，小红书端只有方块和
 *   小球——多传几个不存在的键不花什么（`dropKey` 删不到就回 false），少传一个就会漏
 *   掉一批局。
 * @param history 计分规则用过的每一版，最后一个是现行的（默认取 SCORING_RULES_HISTORY；门喂一张假的单子，模拟
 *   「下一次升版本」）。
 */
export function wipeOldRules(bestKeys: readonly string[], history: readonly string[] = SCORING_RULES_HISTORY): void {
  try {
    const current = history[history.length - 1];
    if (localStorage.getItem(wipeKeyFor(current))) return;
    const retired = history.slice(0, -1);
    // 规则版本号从 1 数到现行版本 + 2：多数两版是留给「哪天有人先升了版本、这段没跟上」的余量——多删两个不存在
    // 的键不花什么，漏掉一个就会漏掉一批局。
    const top = Math.max(BOMB_RULES_VERSION, FLIP_RULES_VERSION, PUZZLE_RULES_VERSION) + 2;
    const oldSuffixes = new Set<string>();
    for (const mk of ['base', 'timed', 'bomb', 'bombTimed', 'flip', 'puzzle'] as const) {
      for (let v = 1; v <= top; v++) {
        const rules = { bomb: v, flip: v, puzzle: v };
        // 《侵蚀阶梯》之前那一套：不带计分规则的版本号
        oldSuffixes.add(modeSuffix(mk, rules));
        // 每一个退下来的计分规则版本：普通那一本、老虎机那一本
        for (const ver of retired) {
          oldSuffixes.add(suffixAt(ver, mk, rules));
          oldSuffixes.add(suffixAt(ver, mk, { ...rules, slot: true }));
        }
      }
    }
    let dropped = 0;
    for (const bestKey of bestKeys) {
      for (const suffix of oldSuffixes) {
        if (dropKey(bestKey + suffix)) dropped++;
      }
    }
    // 记一笔「跑过了」，并且记清楚**有没有真的清掉东西**：记录页的空态只在真清过
    // 的那种情况下换那一句话（见 persistence.ts 的 wipeKeyFor）。
    markWiped(current, dropped);
    if (dropped) {
      const from = retired.length ? retired.join('、') + ' 及更早' : '《侵蚀阶梯》之前';
      console.info(`[slides] 计分规则换到 ${current}：清掉 ${from} 规则的存档 ${dropped} 档`);
    }
  } catch {
    // 无痕模式之类读写不了的：清不掉也别把开机拦住。反正新局落的是新键，
    // 旧键在那儿也进不了记录页（记录页只按 recordSources 里那几个键去找）。
  }
}

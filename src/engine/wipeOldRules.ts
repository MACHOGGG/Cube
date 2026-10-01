import { BOMB_RULES_VERSION } from './bomb';
import { FLIP_RULES_VERSION, SCORING_RULES_VERSION } from './scoring';
import { dropKey, markWiped, wipeKeyFor } from './persistence';
import { modeSuffix } from './runKey';

/**
 * 《侵蚀阶梯》上线那一次性的清档——**两端共用**。
 *
 * 为什么非清不可：旧局和新局根本不是一把尺子量出来的。留着归档的话，记录页上那个
 * 「累计得分」是两套规则的和，结算页那个「本机最佳」还钉在一个现行规则下打不出来的
 * 旧数字上——无限反转封顶那次就是这么咬人的（见 engine/runKey.ts 开头）。
 *
 * 清的是**《侵蚀阶梯》之前那一套键**：`modeSuffix` 给的是玩法那一截，不带 `_ero1`；
 * 现行的键全部多那一截，所以新局一个都不会被误删。每个玩法、每个已知的规则版本都枚
 * 举一遍——漏掉哪一个，那几局会在下一次有人按那个键去找的时候冒出来。
 *
 * 跑过就记一笔，不再跑。下次换规则版本时换一个新的哨兵键（跟着
 * SCORING_RULES_VERSION 走），别把这一次的重跑一遍。
 *
 * ── 为什么搬出 main.ts ────────────────────────────────
 *
 * 它从前是 `src/main.ts` 里的一个私有函数，于是**只有网页端跑过**。小红书那一端
 * （`xhs/src/main.ts`）搜不到任何 `wipe` / `dropKey`——而两端用的是同一组
 * `sugarcube_*` 键名，所以那一端的旧局一直躺在本机上，哨兵键也永远不写入。搬成模块
 * 之后两端各调一次，谁都不会再漏。
 *
 * @param bestKeys 这一端有哪几副棋盘的档要清。网页端是全部八副，小红书端只有方块和
 *   小球——多传几个不存在的键不花什么（`dropKey` 删不到就回 false），少传一个就会漏
 *   掉一批局。
 */
export function wipeOldRules(bestKeys: readonly string[]): void {
  try {
    if (localStorage.getItem(wipeKeyFor(SCORING_RULES_VERSION))) return;
    /** 每个玩法在《侵蚀阶梯》之前可能用过的所有旧键后缀。 */
    const oldSuffixes = new Set<string>();
    for (const mk of ['base', 'timed', 'bomb', 'bombTimed', 'flip', 'puzzle'] as const) {
      // 规则版本从 1 数到现行版本 + 2：多数两版是留给「哪天有人先升了版本、这段没
      // 跟上」的余量——多删两个不存在的键不花什么，漏掉一个就会漏掉一批局。
      for (let v = 1; v <= Math.max(BOMB_RULES_VERSION, FLIP_RULES_VERSION) + 2; v++) {
        oldSuffixes.add(modeSuffix(mk, { bomb: v, flip: v }));
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
    markWiped(SCORING_RULES_VERSION, dropped);
    if (dropped) console.info('[slides] 《侵蚀阶梯》上线：清掉旧规则的存档 ' + dropped + ' 档');
  } catch {
    // 无痕模式之类读写不了的：清不掉也别把开机拦住。反正新局落的是新键，
    // 旧键在那儿也进不了记录页（记录页只按 recordSources 里那几个键去找）。
  }
}

/**
 * 一局归到哪个本地存档键下——**写和读都走这一个文件**。
 *
 * 原先为什么是错的：同一件事手写了十六遍。
 *
 * 每副棋盘末尾都有两条紧挨着的三元链，从同样几个开关推出两样东西——`modeKey`
 * （不带版本号）和 `bestKey` 的后缀（带版本号）。八副棋盘乘两条。`main.ts` 的
 * `runKeyFor` 又从版本常量**另外推了一遍**。
 *
 * 于是炸弹规则升到第 3 版、无限反转升到第 2 版的那两次，改的是常量和读的那一
 * 头，唯独六副棋盘里写死的 `'_bomb2'` / `'_flip'` 没人记得。后果不报错、不白屏：
 *
 *   · 新规则的局被存进了旧规则的归档里，而分版本存档本来就是为了别让两套规则的
 *     分混在一起比；
 *   · 记录页只摆现行那张榜，所以这些局**在记录页上根本不出现**；
 *   · 累计得分是那几张榜的总和（recordsPage 的 loadAllRuns），所以它们也**没被
 *     算进累计得分**；
 *   · 最狠的一条：结算页那个「本机最佳」读的就是这个键（gameController 的
 *     saveBestIfHigher）。无限反转封顶之前的旧纪录高一个量级，于是封顶之后的新局
 *     **永远超不过它**——老玩家每打完一局，看到的都是一个在现行规则下根本打不出来
 *     的数字。
 *
 * 所以这儿定两件事，两头都引它：后缀由**版本常量**生成，模式名由**开关**生成。
 * 下次升版本只改 bomb.ts / scoring.ts 里那个数。
 */
import { BOMB_RULES_VERSION } from './bomb';
import { FLIP_RULES_VERSION } from './scoring';
import type { ModeKey } from './runRecord';

/**
 * 这一局开了哪几个开关。
 *
 * 收的是**棋盘自己认出来的那几位**（`isBomb` / `flipMode` / `puzzleMode`），不是
 * 直接收整份 `ShapeGameOpts`。差别在于：七色圆球和进阶三角压根不读 `opts.bomb`
 * ——哪天有人把 `bomb: true` 递给它们，读整份 opts 的版本会说「这是炸弹局」，而那
 * 副棋盘上一枚炸弹都没有，分就存进炸弹那张榜了。让每副棋盘报自己真的实现了的那
 * 几位，这种错就无从发生。
 */
/**
 * 一局自己带的规则版本号（RunData 的 bombRules / flipRules）。都不给就按现行规则。
 * 具名而不是两个位置参数——见 suffixFor 的说明，位置参数已经写错过一次。
 */
export interface RuleVersions {
  bomb?: number;
  flip?: number;
}

export interface ModeFlags {
  bomb?: boolean;
  flip?: boolean;
  steps?: boolean;
  timed?: boolean;
}

/** 这一局按什么模式记。从前八副棋盘各写一条三元链。 */
export function modeKeyOf(f: ModeFlags): ModeKey {
  if (f.steps) return 'puzzle';
  if (f.flip) return 'flip';
  if (f.bomb) return f.timed ? 'bombTimed' : 'bomb';
  return f.timed ? 'timed' : 'base';
}

/**
 * 第 1 版不带数字，之后就是版本号本身：`_bomb`、`_bomb2`、`_bomb3`……
 *
 * 这条规律不是新定的，是现有那几个键**本来就长这样**，所以旧档一个都不用动。
 */
const versioned = (base: string, v: number) => (v >= 2 ? base + v : base);

/**
 * 存档键的后缀。
 *
 * 版本号有默认值（现行规则），棋盘存新局时不必传；从云上取回旧局时传那一局自己
 * 带的版本号（`RunData.bombRules` / `flipRules`，老档没有就是第 1 版），这样旧局
 * 认回旧键、原样归档。
 *
 * 从前读的那一头是拿「当前版本」去比、把当前版本的后缀写死在条件里。等版本升到第
 * 4 版，第 3 版的旧局就会掉进第 2 版那一档（`3 >= 4` 不成立，落到下一个分支）。现在
 * 按版本号生成，没有这个坑。
 *
 * 版本号收的是**具名**的一个对象，不是两个位置参数。这一条是门当场逮出来的：写成
 * `suffixFor(mk, bombRules, flipRules)` 的时候，`suffixFor('flip', 1)`
 * 读起来像「无限反转第 1 版」，实际把 1 填给了炸弹、反转仍旧取默认的现行版本——
 * 迁移那段就是这么写的，于是「把第 1 版的局挪到第 2 版」变成了从自己挪到自己，一
 * 局都不动，而且不报错。具名之后这种错写不出来。
 */
export function suffixFor(mk: ModeKey, rules?: RuleVersions): string {
  const bombRules = rules?.bomb ?? BOMB_RULES_VERSION;
  const flipRules = rules?.flip ?? FLIP_RULES_VERSION;
  // 步步为营排最前面：它和炸弹、计时不会同时出现，摆最前面是为了读起来一眼看见
  // 「这一局另算一张榜」。它没有版本号——规则没改过。
  if (mk === 'puzzle') return '_puzzle';
  if (mk === 'flip') return versioned('_flip', flipRules);
  // 炸弹压过计时：定时炸弹存的也是炸弹那张榜。
  if (mk === 'bomb' || mk === 'bombTimed') return versioned('_bomb', bombRules);
  if (mk === 'timed') return '_timed';
  return '';
}

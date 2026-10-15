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
import { PUZZLE_RULES_VERSION } from './puzzleScore';
import { FLIP_RULES_VERSION, SCORING_RULES_VERSION } from './scoring';
import type { ModeKey } from './runRecord';

/**
 * 这一局开了哪几个开关。
 *
 * 收的是**棋盘自己认出来的那几位**（`isBomb` / `flipMode` / `puzzleMode`），不是
 * 直接收整份 `ShapeGameOpts`。差别在于：七色圆球压根不读 `opts.bomb`——哪天有人把
 * `bomb: true` 递给它，读整份 opts 的版本会说「这是炸弹局」，而那副棋盘上一枚炸弹都
 * 没有，分就存进炸弹那张榜了。让每副棋盘报自己真的实现了的那几位，这种错就无从发生。
 *
 * （这儿从前写的是「七色圆球和进阶三角」。不读 opts.bomb 的那副三角是 V 形的进阶三角，
 * PR-6 删了；剩下的这副三角——六边蜂窝，card id triangleBig——是读的，炸弹机制一行没动，
 * 只是主菜单上不摆它的炸弹局。10-09 补充方案 7-15 改了这句。）
 */
/**
 * 一局自己带的规则版本号（RunData 的 bombRules / flipRules）。都不给就按现行规则。
 * 具名而不是两个位置参数——见 suffixFor 的说明，位置参数已经写错过一次。
 */
export interface RuleVersions {
  bomb?: number;
  flip?: number;
  puzzle?: number;
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
 * suffixFor 收的那一包：规则版本号（见 RuleVersions），外加这一局是不是老虎机。
 *
 * 老虎机是 10-11 方案 B-7 加的，和版本号放在同一个具名对象里：`suffixFor('base', undefined, true)` 这种写法读
 * 不出那个 true 是什么，而位置参数在这个文件里已经写错过一次（见 suffixFor 的说明）。
 */
export interface KeyOpts extends RuleVersions {
  /** 老虎机那一局（RunData.slot）：另起一本，见 SLOT_PART。 */
  slot?: boolean;
}

/**
 * 老虎机那一局的存档另起一本：键里多一截 `_slot`，摆在玩法那一截前面（10-11 方案 B-7）。
 *
 * 原先为什么是错的：老虎机开在基础棋盘上，它那一局的 modeKey 就是 `'base'`（服务器的榜单和玩法白名单都认这
 * 个，换不得），而存档键只问 modeKey——于是老虎机的局和基础局存进同一本：结算页的「本机最佳」「平均」是两种
 * 玩法掺在一起算的，老虎机打出一个高分，基础局从此就在跟一个不是同一把尺子量出来的数比。服务器那头早就分开了
 * （RunData.slot → 排行榜上它自己一张榜），只有本机这一头没分。
 *
 * 下一次换计分规则要清档时，这一本也得清：10-15 补充 S8 起 wipeOldRules 拿 suffixAt 连这一本一起枚举（原先它只枚举
 * modeSuffix 玩法那一截，不带这一截）。
 */
const SLOT_PART = '_slot';

/**
 * 存档键的后缀：**玩法那一截 + 计分规则的版本号**；老虎机那一局前面再多一截 `_slot`（见 SLOT_PART）。
 *
 * 《侵蚀阶梯》v1.2 §6 之后每个键都多一截 `_ero1`（scoring.ts 的
 * `SCORING_RULES_VERSION`）——那一版把得分图案、翻面分、整线消除、综合分全换了，
 * 旧局和新局不是一把尺子量的，混在一张榜上比就是把老局钉死在榜首。
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
export function suffixFor(mk: ModeKey, opts?: KeyOpts): string {
  return suffixAt(SCORING_RULES_VERSION, mk, opts);
}

/**
 * 同一个拼法，计分规则的版本号由调用的那一头给（10-15 补充 S8）。存新局走 suffixFor（现行版本），开机清档拿退下来
 * 的那几版各拼一遍——两头用同一个函数，清档就不会和存档拼出两种键。
 */
export function suffixAt(version: string, mk: ModeKey, opts?: KeyOpts): string {
  return (opts?.slot ? SLOT_PART : '') + modeSuffix(mk, opts) + '_' + version;
}

/**
 * 只有玩法那一截的后缀，**不带计分规则的版本号**。
 *
 * 一次性清档要它：清的是《侵蚀阶梯》之前那一套键（`…_bomb3`、`…_timed`、没有后缀
 * 的基础局），而现行的键全部多一截 `_ero1`。两头共用同一个函数，清档就不会漏掉哪
 * 一个玩法——从前那种「常量改了、六副棋盘里写死的后缀没人记得」的事，就是各写各的
 * 招来的（见文件开头）。
 */
export function modeSuffix(mk: ModeKey, rules?: RuleVersions): string {
  const bombRules = rules?.bomb ?? BOMB_RULES_VERSION;
  const flipRules = rules?.flip ?? FLIP_RULES_VERSION;
  const puzzleRules = rules?.puzzle ?? PUZZLE_RULES_VERSION;
  // 步步为营排最前面：它和炸弹、计时不会同时出现，摆最前面是为了读起来一眼看见
  // 「这一局另算一张榜」。
  //
  // 2026-10-02 它有自己的版本号了（消线奖励 1 → 2，见 puzzleScore.ts 的
  // PUZZLE_RULES_VERSION）。这一行从前写死 `'_puzzle'`，旁边还注着「那个玩法的规则没单
  // 独改过」——改过了，而写死的后缀正是这个文件开头记的那次事故的形状。
  if (mk === 'puzzle') return versioned('_puzzle', puzzleRules);
  if (mk === 'flip') return versioned('_flip', flipRules);
  // 炸弹压过计时：定时炸弹存的也是炸弹那张榜。
  if (mk === 'bomb' || mk === 'bombTimed') return versioned('_bomb', bombRules);
  if (mk === 'timed') return '_timed';
  return '';
}

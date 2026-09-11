/**
 * 人多的时候，局中那条实时排名只摆三行：第一名、我前面那一名、我自己。
 *
 * 为什么要这么一条规矩：小屋开到 20 人之后，一人一行在 390 宽的手机上根本
 * 放不下——而且就算放得下也没用。选手在局中真正要知道的只有两件事：**冠军
 * 现在多少分**（还差多远），和**我前面那个人多少分**（伸手够不够得着）。全
 * 场名单是大屏那一端的事（见竞赛模式的只读投屏页），不是巴掌大的屏幕的事。
 *
 * 规矩是玩家定的，逐条写在下面的测试里：
 *
 *     我第 1     1. 我
 *     我第 2     1. 甲 / 2. 我
 *     我第 3     1. 甲 / 2. 乙 / 3. 我
 *     我第 4     1. 甲 / … / 3. 丙 / 4. 我
 *     我第 9     1. 甲 / … / 8. 戊 / 9. 我
 *
 * 也就是三个固定的位子（第一 / 我前一名 / 我），名次接不上的地方摆一个省略
 * 号。我在前三名时这三个位子本来就连着，省略号不出现——所以这块最多四行，
 * 高度只在「三行」和「四行」之间变一次。
 *
 * 纯算术，不碰 DOM：名单怎么画是 ui/ 那边的事，这儿只回答「该画哪几个」。
 * 所以 scripts/check-standings-window.mjs 能把边界情形一条条钉住，不用开浏
 * 览器。
 */

export type StandingsRow =
  /** 要画的一个人。`index` 是他在已排好序的名单里的下标，`rank` 是印出来的名次。 */
  | { kind: 'player'; rank: number; index: number }
  /** 中间跳过的那一截。`hidden` 是跳过了几个人——画面上只摆一个省略号，但读
   *  屏要报出「跳过 N 人」，所以这个数在这里备着。 */
  | { kind: 'gap'; hidden: number };

/**
 * 这一刻该摆哪几行。
 *
 * @param count   名单里一共几个人（已经按名次排好序）。
 * @param meIndex 我在名单里的下标；不在名单里传 −1（投屏那一端没有「我」）。
 */
export function standingsWindow(count: number, meIndex: number): StandingsRow[] {
  if (count <= 0) return [];
  // 三个位子：第一名、我前面那一名、我自己。重复的（我就是第一、我前面那个
  // 就是第一）在这儿自然合成一个，不必分情形去写。
  //
  // meIndex 是 −1（不在名单里，比如投屏那台机器）时，前两个位子一个是 −2 一
  // 个是 −1，都被下面这道范围过滤挡掉，只剩第一名——一个人也不认识的屏幕，
  // 能说的就只有「现在第一名是谁」。
  const wanted = [0, meIndex - 1, meIndex]
    .filter((i) => i >= 0 && i < count)
    .sort((a, b) => a - b)
    .filter((i, n, all) => all.indexOf(i) === n);

  const out: StandingsRow[] = [];
  for (const i of wanted) {
    const prev = out[out.length - 1];
    // 上一行和这一行的名次接不上，中间摆个省略号。差 1 是连着的，不摆。
    if (prev && prev.kind === 'player' && i - prev.index > 1) {
      out.push({ kind: 'gap', hidden: i - prev.index - 1 });
    }
    out.push({ kind: 'player', rank: i + 1, index: i });
  }
  return out;
}

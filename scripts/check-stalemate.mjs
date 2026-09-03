/**
 * 死局判定：图案门槛得跟着这一局走，反面得看整线。
 *
 *   npx esbuild src/engine/stalemate.ts --bundle --format=esm --outfile=/tmp/s.mjs
 *   node scripts/check-stalemate.mjs /tmp/s.mjs
 *
 * 两条规矩：
 *   · 图案门槛跟这一局走。《老虎机模式》最小的图案只要 2 枚（三角的「两块拼
 *     一个菱形」），写死 4 枚会把还能拼出小图案的残局判成死局——而死局没有
 *     按钮能拦，1.4 秒后直接结算。
 *   · 反面同色能不能得分，看整线，不看图案。图案得分至少要含一枚正面
 *     （scoring.ts），反面自己只有「连成整线消掉」这一条路：小球、三角各版式
 *     最短的整线是 3 枚，方块是整行 / 整列。按图案的 4 枚算，3 枚同色反面明
 *     明还能连成一线消掉却被判成死局——玩家看着场上还有能消的反面就被结算
 *     了；反过来 4 枚同色反面在 6×6 方块上其实什么都拼不出，却被当成还活着。
 *
 * 这里手搭几副残局，直接问那个函数：判死就是 1.4 秒后结算，判活就是继续。
 */
const S = await import(process.argv[2] || '/tmp/s.mjs');

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const live = (color, face) => ({ cell: [0, 0], tile: { id: 0, color, face, dotColor: color } });
const dot = (color) => live(color, 'dot');
const front = (color) => live(color, 'flavor');
const NONE = new Set();
/** 判死了吗（need 不给就是各玩法自己的 4 枚）。 */
const stuck = (board, need, lineMin) => S.findStuckColorGroups(board, NONE, need, lineMin).length > 0;
const LINE3 = 3; // 小球 / 三角各版式最短的整线
const ROW6 = 6; // 6×6 方块没消过行时的整行

// ---- 残局甲：三枚同色反面 + 一枚孤零零的正面（玩家报的那种局）----------
//
// 图案门槛 4：三枚够不着，何况反面不含正面本来就不算图案。
// 小球 / 三角的整线只要 3 枚：把这三枚推成一线就能消掉——还活着。
// 换成 6×6 方块（整行要 6 枚）：三枚反面哪条线都填不满——判死。
{
  const board = [dot(1), dot(1), dot(1), front(2)];
  check('三枚同色反面：整线 3 枚的棋盘还活着（能连成一线消掉）', !stuck(board, 4, LINE3));
  check('三枚同色反面：整行 6 枚的方块判死', stuck(board, 4, ROW6));
  check('两枚同色反面：整线 3 枚也判死', stuck([dot(1), dot(1), front(2)], 4, LINE3));
  check('三枚反面分属三色：整线 3 枚也判死', stuck([dot(1), dot(2), dot(3), front(4)], 4, LINE3));
}

// ---- 残局乙：四枚同色反面，正面谁也翻不动 ------------------------------
//
// 反面凑够图案枚数也不算图案（得含正面）。6×6 方块：整行要 6 枚——判死；
// 消过两行只剩 4 行的方块：整列 4 枚——还活着。
{
  const board = [dot(1), dot(1), dot(1), dot(1), front(2), front(3)];
  check('四枚同色反面：整行 6 枚的方块判死（反面不含正面不算图案）', stuck(board, 4, ROW6));
  check('四枚同色反面：只剩 4 行的方块还活着（整列 4 枚）', !stuck(board, 4, 4));
}

// ---- 残局丙：反面 + 同色正面拼图案 -------------------------------------
//
// 三枚反面加一枚同色正面：正好一个含正面的 4 枚图案——活着。
// 图案门槛 2（三角的两块菱形）：一反一正同色就够——活着；两枚同色反面 +
// 两枚各不相同的正面：反面不含正面不算图案，正面又各自孤单——判死。
{
  check('三反一正同色：门槛 4 还活着', !stuck([dot(1), dot(1), dot(1), front(1)], 4, ROW6));
  check('一反一正同色：门槛 2 还活着', !stuck([dot(1), front(1), front(2)], 2, LINE3));
  const lonely = [dot(1), dot(1), front(2), front(3)];
  check('两枚同色反面 + 两枚不同色正面：门槛 2 仍判死', stuck(lonely, 2, LINE3));
  check('同一副残局：门槛 4 也判死', stuck(lonely, 4, LINE3));
}

// ---- 底线：门槛再小也不能把「真的动不了」说成还活着 ---------------------
{
  check('两枚不同色的正面：门槛 2 仍然判死', stuck([front(1), front(2)], 2, LINE3));
  check('不给门槛就是 4 枚：三枚同色正面判死', stuck([front(1), front(1), front(1), front(2)], undefined, LINE3));
  check('不给门槛就是 4 枚：三正一反同色活着', !stuck([front(1), front(1), front(1), dot(1)], undefined, LINE3));
}

// ---- 还没开始翻的满盘，任何门槛都不该判死 -------------------------------
//
// 四色各四枚：门槛 4 的时候每种颜色刚好够着，是「活着」这一侧最紧的那个点。
{
  const board = Array.from({ length: 16 }, (_, i) => front(i % 4));
  for (const need of [2, 3, 4]) {
    check(`满盘没翻：门槛 ${need} 枚也不判死`, !stuck(board, need, LINE3));
  }
}

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项没过`);
process.exit(fail ? 1 : 0);

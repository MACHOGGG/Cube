/**
 * 死局判定：图案门槛得跟着这一局走，星星自己的两条得分路取小的那个。
 *
 *   npx esbuild src/engine/stalemate.ts --bundle --format=esm --outfile=/tmp/s.mjs
 *   node scripts/check-stalemate.mjs /tmp/s.mjs
 *
 * 三条规矩：
 *   · 图案门槛跟这一局走。《老虎机模式》最小的图案只要 2 枚（三角的「两块拼
 *     一个菱形」），写死 4 枚会把还能拼出小图案的残局判成死局——而死局没有
 *     按钮能拦，1.4 秒后直接结算。
 *   · **星星自己得分有两条路，门槛取小的那个**（2026-09 星星消除上线）：连成
 *     整线（小球、三角各版式最短 3 枚，方块是当前整行 / 整列），或者整组星星
 *     自己凑出图案（枚数就是图案门槛，按平方给分然后消掉）。只认一条都会判出
 *     死局来：只认图案枚数，3 枚同色星星明明还能连成一线；只认整线，6×6 方块
 *     上 4 枚同色星星明明能凑出 2×2。
 *   · **场上一枚色块都不剩时，这儿必须自己判完。** 从前这条路直接说「还活
 *     着」，交给各棋盘的 isGameOver 收场（那时候「全是星星」就是终局）。现在
 *     终局是「一枚不剩」，isGameOver 不再收这个场——这儿要是还说「还活着」，
 *     一盘谁也凑不出来的棋盘就永远结束不了。
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
const stuck = (board, need, lineMin) => S.findStuckColorGroups(board, need, lineMin).length > 0;
const LINE3 = 3; // 小球 / 三角各版式最短的整线
const ROW6 = 6; // 6×6 方块没消过行时的整行

// ---- 残局甲：三枚同色星星 + 一枚孤零零的正面（玩家报的那种局）----------
//
// 图案门槛 4：三枚够不着（整组星星凑图案那条路也要 4 枚）。
// 小球 / 三角的整线只要 3 枚：把这三枚推成一线就能消掉——还活着。
// 换成 6×6 方块（整行要 6 枚）：两条路都不成——判死。
{
  const board = [dot(1), dot(1), dot(1), front(2)];
  check('三枚同色星星：整线 3 枚的棋盘还活着（能连成一线消掉）', !stuck(board, 4, LINE3));
  check('三枚同色星星：整行 6 枚的方块判死', stuck(board, 4, ROW6));
  check('两枚同色星星：整线 3 枚也判死', stuck([dot(1), dot(1), front(2)], 4, LINE3));
  check('三枚星星分属三色：整线 3 枚也判死', stuck([dot(1), dot(2), dot(3), front(4)], 4, LINE3));
}

// ---- 残局乙：四枚同色星星，正面谁也翻不动 ------------------------------
//
// **玩家 2026-09 报的就是这一局**：结算页写着「全部已變成星星」，盘面上还躺着
// 四颗同色蓝星。四枚同色星星自己就凑得出图案（1×4、2×2），所以整行要 6 枚的
// 6×8 方块上它也还活着——门槛是 min(图案 4, 整行 6) = 4。
// 从前这儿按整行的 6 枚算，判死。
{
  const board = [dot(1), dot(1), dot(1), dot(1), front(2), front(3)];
  check('四枚同色星星：整行 6 枚的方块也还活着（整组星星自己凑得出图案）', !stuck(board, 4, ROW6));
  check('四枚同色星星：只剩 4 行的方块还活着（整列 4 枚）', !stuck(board, 4, 4));
  // 三枚就真的够不着了：图案要 4 枚，整行要 6 枚，两条路都不成。
  const three = [dot(1), dot(1), dot(1), front(2), front(3)];
  check('三枚同色星星：整行 6 枚的方块判死（两条路都够不着）', stuck(three, 4, ROW6));
}

// ---- 残局丙：星星 + 同色正面拼图案 -------------------------------------
//
// 三枚星星加一枚同色正面：正好一个含正面的 4 枚图案——活着。
// 图案门槛 2（三角的两块菱形）：一星一正同色就够——活着。
{
  check('三星一正同色：门槛 4 还活着', !stuck([dot(1), dot(1), dot(1), front(1)], 4, ROW6));
  check('一星一正同色：门槛 2 还活着', !stuck([dot(1), front(1), front(2)], 2, LINE3));
  const lonely = [dot(1), dot(1), front(2), front(3)];
  // 门槛 2（老虎机转出了两枚的图案）：两枚同色星星自己就是一组，能消掉——活着。
  check('两枚同色星星 + 两枚不同色正面：门槛 2 反而还活着', !stuck(lonely, 2, LINE3));
  check('同一副残局：门槛 4 判死（两枚星星够不着 4，也连不成 3 枚的线）', stuck(lonely, 4, LINE3));
}

// ---- 底线：门槛再小也不能把「真的动不了」说成还活着 ---------------------
{
  check('两枚不同色的正面：门槛 2 仍然判死', stuck([front(1), front(2)], 2, LINE3));
  check('不给门槛就是 4 枚：三枚同色正面判死', stuck([front(1), front(1), front(1), front(2)], undefined, LINE3));
  check('不给门槛就是 4 枚：三正一星同色活着', !stuck([front(1), front(1), front(1), dot(1)], undefined, LINE3));
}

// ---- 残局丁：一枚色块都不剩（全是星星的盘面）----------------------------
//
// 这条路从前直接 `return []`（「没有正面就不存在卡死」），靠各棋盘的 isGameOver
// 收场。现在「全是星星」不再是终局，所以这儿要自己判完——而且**判死的时候要把
// 那些星星报出来**：gameController 拿这些格子先红一下再结算（'无法继续匹配'），
// 报空数组就等于说「还活着」，一盘谁也凑不出来的棋盘会永远结束不了。
{
  const allStars = (...colors) => colors.map((c) => dot(c));
  check(
    '全是星星：四枚同色还活着（凑得出图案）',
    !stuck(allStars(1, 1, 1, 1, 2, 3), 4, ROW6),
  );
  check(
    '全是星星：三枚同色 + 整线 3 枚的棋盘还活着（连得成一线）',
    !stuck(allStars(1, 1, 1, 2), 4, LINE3),
  );
  const dead = allStars(1, 1, 2, 3);
  check('全是星星：谁也凑不出来就要判死', stuck(dead, 4, LINE3));
  // 报出来的必须就是场上那几枚星星，按颜色分组——不是空数组，也不能漏掉谁。
  const groups = S.findStuckColorGroups(dead, 4, LINE3);
  const sizes = groups.map((g) => g.length).sort((a, b) => b - a);
  check(
    '判死时把那几枚星星按颜色报出来（gameController 要拿它去红一下）',
    groups.length === 3 && sizes.join(',') === '2,1,1',
    `${groups.length} 组：${sizes.join(',')}`,
  );
  check('一枚不剩的空盘不报死（那一局由 isGameOver 收场）', !stuck([], 4, LINE3));
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

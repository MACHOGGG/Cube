/**
 * 死局判定：门槛得跟着这一局走，不能永远是 4 枚。
 *
 *   npx esbuild src/engine/stalemate.ts --bundle --format=esm --outfile=/tmp/s.mjs
 *   node scripts/check-stalemate.mjs /tmp/s.mjs
 *
 * 判「这盘再也走不动了」原来一律按「某种颜色能不能凑够 4 枚」算。《随机得分
 * 目标》里最小的图案只要 2 枚（三角那个「两块拼一个菱形」），于是残局上明明
 * 还摆得出那个图案、还能拿分，却被判成死局——而死局是没有按钮能拦的，1.4 秒
 * 后直接弹结算，玩家眼睁睁看着能得分的机会被系统自己判死。
 *
 * 这里手搭几副残局，直接问那个函数：门槛给 4 就该说「死了」，门槛给 2 就该
 * 说「还活着」。同一副盘、同一个函数，差别只在这一局的门槛。
 */
const S = await import(process.argv[2] || '/tmp/s.mjs');

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const live = (color, face) => ({ cell: [0, 0], tile: { id: 0, color, face, dotColor: color } });
const NONE = new Set();

// ---- 残局甲：两枚同色的反面 + 两枚各不相同的正面 -------------------------
//
// 门槛 4：这一种颜色只有 2 枚，别的颜色各 1 枚，谁也够不着 4——判死。
// 门槛 2：那两枚反面已经是同色的了，推到一起就是分——还活着。
{
  const board = [
    live(1, 'dot'), live(1, 'dot'),
    live(2, 'flavor'), live(3, 'flavor'),
  ];
  check('门槛 4 枚：这副残局被判死局', S.findStuckColorGroups(board, NONE, 4).length > 0);
  check('门槛 2 枚：同一副残局还活着', S.findStuckColorGroups(board, NONE, 2).length === 0);
  check('不给门槛就还是 4 枚（别的玩法不受影响）',
    S.findStuckColorGroups(board, NONE).length > 0);
}

// ---- 残局乙：三枚同色的反面 -------------------------------------------
//
// 三枚的图案（21/23/32/14…）在随机目标里很常见。门槛 3 该活，门槛 4 该死。
{
  const board = [
    live(1, 'dot'), live(1, 'dot'), live(1, 'dot'),
    live(2, 'flavor'),
  ];
  check('三枚同色反面：门槛 4 判死', S.findStuckColorGroups(board, NONE, 4).length > 0);
  check('三枚同色反面：门槛 3 还活着', S.findStuckColorGroups(board, NONE, 3).length === 0);
}

// ---- 底线：门槛再小也不能把「真的动不了」说成还活着 ---------------------
//
// 全是正面、每种颜色各一枚：门槛 1 的时候「一枚就算分」本来就成立，所以这
// 里要看的是门槛 2——两枚都凑不齐的时候，仍然该判死。
{
  const board = [live(1, 'flavor'), live(2, 'flavor')];
  check('两枚不同色的正面：门槛 2 仍然判死', S.findStuckColorGroups(board, NONE, 2).length > 0);
}

// ---- 还没开始翻的满盘，任何门槛都不该判死 -------------------------------
//
// 四色各四枚：门槛 4 的时候每种颜色刚好够着，是「活着」这一侧最紧的那个点。
{
  const board = Array.from({ length: 16 }, (_, i) => live(i % 4, 'flavor'));
  for (const need of [2, 3, 4]) {
    check(`满盘没翻：门槛 ${need} 枚也不判死`, S.findStuckColorGroups(board, NONE, need).length === 0);
  }
}

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项没过`);
process.exit(fail ? 1 : 0);

/**
 * 局中那条实时排名，人多的时候该摆哪几行。
 *
 *   npx esbuild src/engine/standingsWindow.ts --bundle --format=esm --outfile=/tmp/window.mjs
 *   node scripts/check-standings-window.mjs /tmp/window.mjs
 *
 * 规矩是玩家定的：第一名、我前面那一名、我自己，三个位子；名次接不上的地方
 * 摆一个省略号。听起来一句话就说完了，可它全是边界——我就是第一、我是第二
 * （前一名正好就是第一）、我第三（三个位子刚好连着）、我第四（中间只跳过一
 * 个人）、名单里只有一个人、我根本不在名单里（投屏那台机器）。这种规则写错
 * 了不会崩，只会在现场某个人身上默默少一行，所以逐条钉在这儿。
 *
 * 纯算术，不开浏览器，进得了 CI。
 */
const src = process.argv[2];
if (!src) {
  console.error('用法: node scripts/check-standings-window.mjs <打包好的 standingsWindow.mjs>');
  process.exit(2);
}
const { standingsWindow } = await import(src);

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/** 把结果画成一行字，跟屏幕上看到的一样：名次用数字，省略号用 …。 */
const draw = (rows) =>
  rows.map((r) => (r.kind === 'gap' ? '…' : String(r.rank))).join(' ');

// ---------------------------------------------------------------------------
// 玩家点名的那几种情形，一条一条对
// ---------------------------------------------------------------------------
check('我第 1：只摆我自己', draw(standingsWindow(20, 0)) === '1', draw(standingsWindow(20, 0)));
check('我第 2：第一名和我，不用省略号', draw(standingsWindow(20, 1)) === '1 2', draw(standingsWindow(20, 1)));
check('我第 3：三个位子正好连着，还是不用', draw(standingsWindow(20, 2)) === '1 2 3', draw(standingsWindow(20, 2)));
check('我第 4：中间跳过一个，摆省略号', draw(standingsWindow(20, 3)) === '1 … 3 4', draw(standingsWindow(20, 3)));
check('我第 9：1 … 8 9', draw(standingsWindow(20, 8)) === '1 … 8 9', draw(standingsWindow(20, 8)));
check('我第 20（满屋最后一名）：1 … 19 20', draw(standingsWindow(20, 19)) === '1 … 19 20', draw(standingsWindow(20, 19)));

// ---------------------------------------------------------------------------
// 省略号后面那个数：跳过了几个人
// ---------------------------------------------------------------------------
{
  const rows = standingsWindow(20, 3);
  const gap = rows.find((r) => r.kind === 'gap');
  check('我第 4：省略号代表 1 个人', gap && gap.hidden === 1, JSON.stringify(gap));
}
{
  const rows = standingsWindow(20, 8);
  const gap = rows.find((r) => r.kind === 'gap');
  check('我第 9：省略号代表 6 个人', gap && gap.hidden === 6, JSON.stringify(gap));
}

// ---------------------------------------------------------------------------
// 画的时候要拿 index 去名单里取人，不能拿 rank 减一以外的东西
// ---------------------------------------------------------------------------
{
  const rows = standingsWindow(20, 8).filter((r) => r.kind === 'player');
  check('每一行的 rank 就是 index + 1', rows.every((r) => r.rank === r.index + 1), JSON.stringify(rows));
  check('三行分别是第一名、我前一名、我', rows.map((r) => r.index).join(',') === '0,7,8');
}

// ---------------------------------------------------------------------------
// 人少 / 没有我 —— 这几种在现场一定会出现，不能崩也不能空着
// ---------------------------------------------------------------------------
check('屋里只有我一个：一行', draw(standingsWindow(1, 0)) === '1', draw(standingsWindow(1, 0)));
check('两个人，我是第二：1 2', draw(standingsWindow(2, 1)) === '1 2');
check('我不在名单里（投屏那台机器）：只报第一名', draw(standingsWindow(20, -1)) === '1', draw(standingsWindow(20, -1)));
check('空名单：一行都不摆', standingsWindow(0, -1).length === 0);
check('空名单也不会因为 meIndex 乱来而炸', standingsWindow(0, 5).length === 0);
check('meIndex 超出名单长度：当作不在名单里', draw(standingsWindow(3, 9)) === '1', draw(standingsWindow(3, 9)));

// ---------------------------------------------------------------------------
// 不变量：无论几个人、我在哪，这块最多四行（三行 + 一个省略号）
// ---------------------------------------------------------------------------
{
  let worst = 0;
  let worstAt = '';
  let bad = '';
  for (let n = 0; n <= 20; n++) {
    for (let me = -1; me < n; me++) {
      const rows = standingsWindow(n, me);
      if (rows.length > worst) { worst = rows.length; worstAt = `${n} 人，我第 ${me + 1}`; }
      if (rows.filter((r) => r.kind === 'player').length > 3) bad = `${n} 人，我第 ${me + 1}`;
      // 省略号绝不能出现在头尾——那是「上面还有人」「下面还有人」的意思，
      // 而这块只说这三位，不暗示别的。
      if (rows.length && (rows[0].kind === 'gap' || rows[rows.length - 1].kind === 'gap')) {
        bad = `${n} 人，我第 ${me + 1}：省略号跑到头或尾了`;
      }
    }
  }
  check('最多四行（三个人 + 一个省略号）', worst <= 4, `最长 ${worst} 行（${worstAt}）`);
  check('人再多也只摆三个人', !bad, bad);
}
{
  // 名次一定是从小到大，不重复——照着画就是从上往下一行一行。
  let bad = '';
  for (let n = 1; n <= 20; n++) {
    for (let me = 0; me < n; me++) {
      const ranks = standingsWindow(n, me).filter((r) => r.kind === 'player').map((r) => r.rank);
      const sorted = [...ranks].sort((a, b) => a - b);
      if (ranks.join() !== sorted.join() || new Set(ranks).size !== ranks.length) {
        bad = `${n} 人，我第 ${me + 1}：${ranks.join(',')}`;
      }
    }
  }
  check('名次从小到大且不重复', !bad, bad);
}
{
  // 我永远在最后一行——这块的落点就是「我在哪儿」。
  let bad = '';
  for (let n = 1; n <= 20; n++) {
    for (let me = 0; me < n; me++) {
      const rows = standingsWindow(n, me);
      const last = rows[rows.length - 1];
      if (!last || last.kind !== 'player' || last.index !== me) bad = `${n} 人，我第 ${me + 1}`;
    }
  }
  check('我永远是最后一行', !bad, bad);
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);

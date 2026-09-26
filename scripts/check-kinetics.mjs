/**
 * Kinetics 那一批手感件里三条纯判定的门——纯 node，不碰 DOM，几十毫秒，进 CI。
 *
 *   npx esbuild src/engine/kinetics.ts --bundle --format=esm --outfile=/tmp/kinetics.mjs
 *   node scripts/check-kinetics.mjs /tmp/kinetics.mjs
 *
 * 三条各盯一件**错了不报错**的事：
 *
 *   endCheckEligible  —— 通关那枚章盖在哪一种终局上。盖错了屏幕上不会红，只是
 *                        一枚「完成」的章出现在被炸出去的那一局上，那是在骗人。
 *   splitPastedCode   —— 从聊天软件粘来的码洗不洗干净。洗坏了玩家看到的是「码
 *                        不对」，而他手上那个码是对的。
 *   meterFill         —— 六段完成度表填几段。越界不钳制的话第七段会画到框外面，
 *                        或者负数把整排擦掉。
 */

const [src] = process.argv.slice(2);
if (!src) {
  console.error('用法: node scripts/check-kinetics.mjs <打包好的 kinetics.mjs>');
  process.exit(2);
}
const { ALL_FLIPPED_REASON, endCheckEligible, splitPastedCode, meterFill } = await import(src);

let fail = 0;
let ran = 0;
const check = (name, ok, extra = '') => {
  ran++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// ── §4 通关章：六种终局，只有一种为真 ──────────────────────────────
//
// 这六个字符串就是 gameController 真的会传进 endGame 的那六个（另外五个分别来自
// 那个文件、bomb.ts 的 BOMB_HAZARD_REASON、puzzleMode 的 PUZZLE_STEPS_OUT_REASON
// 和 runRecord 的 MANUAL_END_REASON）。抄在这儿是故意的：**门要和被测的代码分开
// 说一遍**，两边都从同一个常量取的话，改错了常量两边一起错、门照样绿。
const ENDINGS = {
  全部方块已翻成点面: true,
  时间到: false,
  无法继续匹配: false,
  手动结束: false,
  红色炸弹相连: false,
  步数用完了: false,
};
{
  const wrong = Object.entries(ENDINGS).filter(([r, want]) => endCheckEligible(r) !== want);
  check(
    '六种终局里只有「全部翻成点面」配那枚章',
    wrong.length === 0,
    wrong.length ? wrong.map(([r]) => r).join('、') : Object.keys(ENDINGS).length + ' 种都对',
  );
  // 上面那张表要真的有区分度：全 false 的实现也能让「只有一种为真」听起来成立，
  // 所以单独钉住「那一种确实为真」和「至少有一种为假」。
  check('真通关那一种确实为真（不是整张表全 false）', endCheckEligible('全部方块已翻成点面') === true);
  check('炸弹那一局没有章', endCheckEligible('红色炸弹相连') === false);
  // 常量和判定必须是同一个字符串。这两样分开写过——gameController 里一个裸字面
  // 量、runRecord 的查表里又抄了一遍，对不上的时候只是那一局的原因翻译不出来。
  check(
    '导出的常量就是判定认的那一个',
    typeof ALL_FLIPPED_REASON === 'string' && endCheckEligible(ALL_FLIPPED_REASON),
    String(ALL_FLIPPED_REASON),
  );
  // 空串、undefined 这类东西不该混进来（终局原因永远由调用方给），但混进来也不许
  // 盖章——一枚盖在「不知道怎么结束的」那一局上的章比不盖更糟。
  check('空的／没给的原因不盖章', !endCheckEligible('') && !endCheckEligible(undefined));
}

// ── §9 粘贴分格：洗成能落格的数字串 ────────────────────────────────
{
  const cases = [
    // 方案里点名的三组
    ['ab12 34-56', '123456'],
    ['123', '123'],
    ['abcdef', ''],
    // 从聊天软件复制来真的会带上的那几样
    ['  654321  ', '654321'],
    ['验证码：246 810', '246810'],
    ['1234567890', '123456'], // 只取前六位
    ['12-34-56-78', '123456'],
    ['', ''],
  ];
  const bad = cases.filter(([raw, want]) => splitPastedCode(raw) !== want);
  check(
    '粘贴进来的码洗得干净（' + cases.length + ' 组）',
    bad.length === 0,
    bad.length ? bad.map(([raw, want]) => `${JSON.stringify(raw)}→${splitPastedCode(raw)} 应为 ${want}` ).join('；') : '',
  );
  // 取的是**前**几位，不是后几位。这一条单独钉：两种实现对上面大半组用例都一样，
  // 只有超长的那一组分得开，而那一组正是从聊天记录里整段复制时的样子。
  check('超长的取前六位，不是后六位', splitPastedCode('1234567890') === '123456');
  // 小屋码是四位（api/room.js 的四位数字），所以位数是参数，不是写死的 6。
  check('位数可以是四位（小屋码）', splitPastedCode('12 34 56', 4) === '1234', splitPastedCode('12 34 56', 4));
}

// ── §8 六段完成度表：钳制与线性 ────────────────────────────────────
{
  const cases = [
    [-1, 0],
    [0, 0],
    [1, 1],
    [3, 3],
    [6, 6],
    [9, 6],
    [1000, 6],
  ];
  const bad = cases.filter(([len, want]) => meterFill(len) !== want);
  check(
    '完成度表两头钳得住、中间是线性的（' + cases.length + ' 组）',
    bad.length === 0,
    bad.length ? bad.map(([len]) => `${len}→${meterFill(len)}`).join('；') : '',
  );
  // 「线性」要真的被量到：常量实现（永远回 6、永远回 0）过不了这一条。
  const middle = [0, 1, 2, 3, 4, 5, 6].map(meterFill).join(',');
  check('0–6 一对一（不是一个常量）', middle === '0,1,2,3,4,5,6', middle);
  // NaN 走过这条路：输入框的 value.length 不会是 NaN，但 selectionStart 那一带的
  // 算术出过负数和 NaN，而 NaN 喂给 Math.min/max 会一路传下去变成 NaN 段数。
  check('NaN 回 0，不往下传', meterFill(NaN) === 0, String(meterFill(NaN)));
}

console.log(fail ? `\n${fail} 条没过（共 ${ran} 条）` : `\n全部通过（${ran} 条）`);
process.exit(fail ? 1 : 0);

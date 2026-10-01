/**
 * 一局结束、下一局开始，中间不许漏东西过去。
 *
 *   node scripts/check-run-lifecycle.mjs
 *
 * 读的是**源码**，不打包也不开浏览器——这四件事全都没有可以从外面量的症状：
 * 不崩、不白屏、不报错，只是下一局的规则悄悄变了，或者结算页干脆不弹。
 *
 *   ① 收尾放开不跨局（`endgameOpen` 要在 `resetBoard` 里放平）
 *   ② 这一局结束要**撤掉**排着的那一拍，不是把引用置空
 *   ③ `persistence.ts` 里每一个碰 localStorage 的导出函数都要包 try/catch
 *   ④ 付款后设密码那一屏，前置校验要和服务端同一条规矩
 *
 * 每一条都配一条尺子：先确认「要查的东西真的在这个文件里」，否则下面那一条是恒真的。
 */
import { readFileSync } from 'node:fs';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// ---- ① 收尾放开不跨局 ---------------------------------------------------
//
// `endgameOpen` 一局之内不回退（那是故意的，见各文件里那段注释），可 `newGame` 调
// `resetBoard` 重发牌时它从前还留在闭包里：下一局从第一步起就带着「最短边门槛 1」，
// 而玩家看到的是一副全新的棋盘。
{
  const 有这个变量 = [];
  const 没放平 = [];
  for (const f of ['circle', 'circleHex', 'circleSeven', 'squareDiamond', 'triangle', 'square']) {
    const src = read(`src/shapes/${f}.ts`);
    if (!/let endgameOpen\b/.test(src)) continue;
    有这个变量.push(f);
    const m = src.match(/function resetBoard\(\)\s*\{[\s\S]*?\n      \}/);
    if (!m || !/endgameOpen\s*=\s*false/.test(m[0])) 没放平.push(f);
  }
  // 尺子：这一条认的是「哪几副有收尾放开」。一副都认不出就是正则过期了，
  // 而那时下面那一条会空绿。
  check('认得出哪几副棋盘有收尾放开（尺子）', 有这个变量.length === 5,
    `${有这个变量.length} 副：${有这个变量.join(' ')}`);
  check('这几副的 resetBoard 都把 endgameOpen 放平了', 没放平.length === 0, 没放平.join(' '));
  // 方块是整行整列族，本来就没有这个变量——反面尺子，防止上面那条正则宽到见谁都算。
  check('方块那一副本来就没有这个变量（反面尺子）', !有这个变量.includes('square'));
}

// ---- ② 结束这一局要撤掉排着的那一拍 -------------------------------------
//
// 「把引用置空」拦不住已经排下的 setTimeout：它到点照样跑，往一副已经结清的盘上接着
// 翻、接着记分。
{
  const src = read('src/engine/gameController.ts');
  check('gameController 里有 cancelBeat（尺子）', /function cancelBeat\(\)/.test(src));
  check('cancelBeat 真的 clearTimeout，不只是置空',
    /function cancelBeat\(\)[\s\S]{0,220}clearTimeout\(pendingBeat\.id\)/.test(src));
  const endGame = src.match(/function endGame\([\s\S]*?\n    timer\.stop\(\);/);
  check('读得到 endGame 的开头（尺子）', Boolean(endGame));
  check('endGame 里撤掉了那一拍', Boolean(endGame) && /cancelBeat\(\)/.test(endGame[0]));
  const resolve = src.match(/function resolveMove\([\s\S]*?heldBeat = null;/);
  check('读得到 resolveMove 的开头（尺子）', Boolean(resolve));
  check('resolveMove 里也是撤，不是置空',
    Boolean(resolve) && /cancelBeat\(\)/.test(resolve[0]) && !/pendingBeat = null;\s*\n\s*heldBeat/.test(resolve[0]));
}

// ---- ③ persistence 里每个碰 localStorage 的导出都要包着 ------------------
//
// 唯一的生产调用点在 endGame 里、在 lastRun 赋值**之前**。抛出去的后果不是白屏，
// 是「最后一下之后界面停在棋盘上，结算页永远不弹出来」。
{
  const src = read('src/engine/persistence.ts');
  // 按 export function 切块，逐个看它碰不碰 localStorage、碰了有没有 try
  const blocks = [...src.matchAll(/export function (\w+)[\s\S]*?(?=\nexport |\n\/\*\*|$)/g)];
  check('切得出 persistence 里的导出函数（尺子）', blocks.length >= 6, `${blocks.length} 个`);
  const 裸调 = blocks
    .filter((b) => /localStorage\./.test(b[0]) && !/\btry\s*\{/.test(b[0]))
    .map((b) => b[1]);
  check('没有哪个导出函数裸着碰 localStorage', 裸调.length === 0, 裸调.join(' '));
}

// ---- ④ 付款后设密码：前置校验和服务端同一条规矩 --------------------------
//
// 从前是 `password.length !== 6`：`abc-12` 过得了客户端，被服务端 400 'weak' 打回来，
// 而那条错一路被压成「网络出错」——玩家刚付完钱，界面告诉他网络有问题。
{
  const ui = read('src/ui/subscribe.ts');
  const engine = read('src/engine/subscription.ts');
  const creem = read('src/engine/creem.ts');
  check('设密码那一屏用 isPin 前置校验，不是只数长度',
    // 反面那一半认的是**那条语句**（），不是「文件里出现过
    // 这几个字」——上面那段注释里就原样引着它，照字面查会被自己的注释红一下。
    /if \(!isPin\(password\)\)/.test(ui) && !/if \(password\.length !== 6\)/.test(ui));
  check('attachAccount 答得出 weak', /'unavailable' \| 'weak' \| 'failed'/.test(engine));
  check('weak 不再被压成 failed', /result === 'weak'\) return 'weak'/.test(engine));
  check('creem 那两处 catch 认得出服务端送回来的 weak',
    (creem.match(/err\.code === 'weak'\) return 'weak'/g) || []).length === 2);
  check('界面把 weak 说成「密码不合规矩」，不是「网络出错」',
    /done === 'weak' \? s\.setPwShort/.test(ui));
}

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 条没过`);
process.exit(fail ? 1 : 0);

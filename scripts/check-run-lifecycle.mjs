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
  /*
   * **「设密码那一屏」撤了**（E37，2026-10：密码取消）。这一条换成它的继承者。
   *
   * 要守的那条规矩没变：**前置校验必须和服务端同一条，而且认的是形状不是长度。**
   * 从前是 `password.length !== 6` 放过了 `abc-12`，被服务端 400 'weak' 打回来、一路压成
   * 「网络出错」——玩家刚付完钱，界面告诉他网络有问题。
   *
   * 现在那条规矩落在免邮箱凭据那两串上（E38）：客户端 `PAIR_RE` 必须和服务端
   * `api/_accounts.js` 的 `PAIR_RE` 一字不差，否则同一个坑换个地方再踩一次。
   */
  const uiPair = /const PAIR_RE = \/\^\[A-Za-z0-9\]\{8,64\}\$\//.exec(ui);
  check('客户端有 PAIR_RE，而且形状是「8 到 64 位字母数字」', Boolean(uiPair), String(uiPair?.[0]));
  const srvPair = /export const PAIR_RE = (\/[^\n]+\/);/.exec(read('api/_accounts.js'));
  check('（尺子）服务端那一条读得到', Boolean(srvPair), String(srvPair?.[1]));
  check('两边的 PAIR_RE 一字不差',
    Boolean(uiPair && srvPair) && uiPair[0].replace('const PAIR_RE = ', '') === srvPair[1],
    `${uiPair?.[0]} vs ${srvPair?.[1]}`);
  // 而且提交那一头真的用它拦了一次（光定义不用等于没有）。
  check('提交之前真的用 PAIR_RE 拦过', /if \(!PAIR_RE\.test\(first\) \|\| !PAIR_RE\.test\(second\)\)/.test(ui));
  check('attachAccount 答得出 weak', /'unavailable' \| 'weak' \| 'failed'/.test(engine));
  check('weak 不再被压成 failed', /result === 'weak'\) return 'weak'/.test(engine));
  /**
   * **每一个**往 /api/passcode 发请求的函数都要认得出 'weak'，不是「恰好两处」。
   *
   * 这一条原先写的是「出现次数 === 2」，钉的是当时那两处（setWebPasscode / bindCode）。
   * 2026-10 补了第三条路（webRegister，注册），这道门于是红了一次——而它红的不是漏，
   * 是**多**：三处都认得出 weak，只是数字对不上。那种红比不设断言更坏，因为下一个人
   * 会去改数字而不是去想这条断言在问什么。
   *
   * 现在按函数数：谁 post 到 /api/passcode，谁就得在自己的 catch 里认出 weak。少一处
   * 的后果是老样子——玩家的密码夹了个符号，被服务端 400 'weak' 打回来，而界面告诉他
   * 网络有问题。
   */
  {
    const fns = creem
      .split(/\nexport (?:async )?function /)
      .slice(1)
      .map((b) => ({ name: b.slice(0, b.indexOf('(')), body: b }))
      .filter((f) => f.body.includes("'/api/passcode'"));
    const missing = fns.filter((f) => !/err\.code === 'weak'\) return 'weak'/.test(f.body));
    check('（尺子）认得出哪几个函数发 /api/passcode', fns.length >= 3,
      fns.map((f) => f.name).join(' '));
    check('发 /api/passcode 的每一个都认得出服务端送回来的 weak',
      fns.length >= 3 && missing.length === 0,
      missing.length ? '少了：' + missing.map((f) => f.name).join(' ') : '');
  }
  /*
   * 界面要把每一种失败说成它自己那一句，不是一律「网络出错」。
   *
   * 这一条原先盯的是 `done === 'weak' ? s.setPwShort`（设密码那一屏）。那一屏撤了，继承它
   * 的是《注册 / 登录》那扇窗里的 `say()`：它把服务端送回来的每一个 error 串翻成一句话。
   * 少一种就会落到最后那句兜底「网络出错」上——而那正是这一条一直在防的事。
   */
  const says = ['mailDown', 'tooMany', 'badEmail', 'wrongCode', 'codeStale', 'taken', 'badPair', 'wrong', 'locked', 'unavailable'];
  const missed = says.filter((r) => !new RegExp(`reason === '${r}'`).test(ui));
  check('每一种失败都有自己的一句话（不许落到「网络出错」兜底上）',
    missed.length === 0, missed.length ? '少了：' + missed.join(' ') : `${says.length} 种`);
  // 兜底那一句以**逗号**还是分号收尾，取决于它写在哪儿：`accountFailText` 里是
  // `default: return …;`（分号），而《注册 / 登录》那扇窗的 `say()` 把整条三元链当**参数**
  // 递出去，收尾是逗号（2026-10-03 第 9 推把那一屏收成三态时改的）。这条尺子原先只认分
  // 号，于是它在这次改版之后变成了红的——而它要量的事情（兜底还在）一直成立。两种都认。
  check('（尺子）兜底那一句还在（不是把兜底删了才全绿）', /: s\.purchaseNetwork[;,]/.test(ui));
}

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 条没过`);
process.exit(fail ? 1 : 0);

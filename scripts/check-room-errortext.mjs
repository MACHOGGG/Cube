/**
 * 小屋的错误话术只有一份映射，两处都用它。
 *
 *   node scripts/check-room-errortext.mjs
 *
 * 读源码，不打包、不起服务器：`ui/multiplayer.ts` 整个模块在 node 里跑不起来
 * （它用 Vite 的 `import.meta.glob` 收图标），而要钉的事情全在字面上。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么
 *
 * 一次小屋请求失败了，屏幕上该写哪一句——这件事从前有两份答案：
 *
 *   · `ui/multiplayer.ts` 的 `errorText()`：十种 `RoomError` 各一句，剩下的落 default。
 *   · `main.ts` 的 `startRoundFor()`：自己拼了两分支，`tooFew` 说「人太少」，
 *     **其余一律**说「小屋还没开放」。
 *
 * 而屋主在主菜单上按一张棋盘走的正是后者，`startMatch` 答得出 `claimed`、`tooMany`、
 * `busy`、`ended`、`notHost`、`mode` 六种，全掉进那个「其余」里。最冤的是被限速挡住
 * 那一次：屋子开着、人也够，屏幕上却写着「小屋还没开放」，于是屋主一遍遍地按。
 *
 * 所以：一处映射，两处用。新来一种 `RoomError` 只在那个 switch 里接一次。
 *
 * ⚠️ 这台门**不量那十句话说得准不准**（那是文案，`check-rules-counts` 一类在管）。它量
 * 的是「只有一份映射」这件结构上的事，以及「每一种 RoomError 都被想过」。
 */
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const { readFileSync } = await import('node:fs');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const engine = read('src/engine/room.ts');
const mp = read('src/ui/multiplayer.ts');
const main = read('src/main.ts');

// ---- ① 那份映射导出了，而且只有一份 ------------------------------------
check('① errorText 从 ui/multiplayer.ts 导出', mp.includes('export function errorText('), '');
{
  // 别处不许再有一个同名的（两份映射正是这台门要防的那件事）。
  const others = ['src/ui/scoreboard.ts', 'src/ui/roomCard.ts', 'src/main.ts', 'src/ui/confirmLeaveRoom.ts']
    .filter((p) => read(p).includes('function errorText('));
  check('① 别的文件里没有第二份 errorText', others.length === 0, others.join('、'));
}

// ---- ② main.ts 用的就是它 ----------------------------------------------
check('② main.ts 从 ui/multiplayer 导入了 errorText', /import \{[^}]*\berrorText\b[^}]*\} from '\.\/ui\/multiplayer'/.test(main), '');
check('② 开局失败那一处调的是 errorText', main.includes('errorText(begun.reason, currentLang)'), '');
{
  // 从前那两分支的痕迹：`mpErrNotOpen` / `mpErrTooFew` 不该再出现在 main.ts 里。
  // （它们仍然在 i18n.ts 里，也仍然被 errorText 用着——只是不在这儿。）
  const strays = ['mpErrNotOpen', 'mpErrTooFew'].filter((k) => main.includes(k));
  check('② main.ts 里不再自己拼那两句', strays.length === 0, strays.join('、'));
}

// ---- ③ 每一种 RoomError 都被想过 ---------------------------------------
//
// 量程 + 棘轮：新加一种 `RoomError` 而不在那个 switch 里接一句，这一条就红。已知落
// 在 default 上的那几种写在下面这张单子里——那是**有意**的（要说得准得先有话可说，
// 四语各一句），不是漏了；哪天给它们写了话，把它从单子里划掉就行。
{
  const i = engine.indexOf('export type RoomError');
  const block = engine.slice(i, engine.indexOf(';', engine.indexOf('network', i)));
  const members = [...new Set([...block.matchAll(/\|\s*'([a-zA-Z]+)'/g)].map((m) => m[1]))];
  check('③ 量程：RoomError 真的读出来了（十来种）', members.length >= 10, `${members.length} 种：${members.join(' ')}`);

  const fn = mp.slice(mp.indexOf('export function errorText('));
  const cased = [...new Set([...fn.slice(0, fn.indexOf('\n}')).matchAll(/case '([a-zA-Z]+)':/g)].map((m) => m[1]))];
  check('③ 量程：那个 switch 真的读出来了', cased.length >= 8, `${cased.length} 句：${cased.join(' ')}`);

  /** 明知落在 default（「连不上网络」）上的几种。 */
  // 第 14 推给 notHost 和 mode 写了话（四语各一句），从单子上划掉了；剩下的 network 本
  // 来就该落 default（那一句就是「连不上网络」）。
  const KNOWN_DEFAULT = ['network'];
  const forgotten = members.filter((m) => !cased.includes(m) && !KNOWN_DEFAULT.includes(m));
  check('③ 没有哪一种 RoomError 是没想过的', forgotten.length === 0, forgotten.join('、'));
  // 反过来：单子上的也不许凭空长出来——`notHost` 哪天接上了话，就该从单子里划掉，
  // 而不是留在这儿让这台门替它说「明知落 default」。
  const stale = KNOWN_DEFAULT.filter((m) => cased.includes(m));
  check('③ 那张「明知落 default」的单子没过期', stale.length === 0, stale.join('、'));
  // default 本身要在：没有它，一个没接的 reason 会让这个函数回 undefined，屏幕上空一块。
  check('③ default 那一支还在', /default:\s*\n\s*return/.test(fn.slice(0, fn.indexOf('\n}'))), '');
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

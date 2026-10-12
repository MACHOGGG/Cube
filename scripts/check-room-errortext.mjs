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
 *
 * ④（2026-10-08 方案 2-1）：errorText 接了话的每一种，都得在 engine/room.ts 的 KNOWN 上——不
 * 在单子上的词会被改成 'network'，写好的那句话就永远显示不出来（blocked / bad 就这样掉过队）。
 *
 * ⑤⑥（10-11 方案 C-3）：服务器那头的错不说成「连不上网络」、也不说成「多人游玩尚未开放」；被限速挡了不说「等
 * 几秒」，大厅轮询被挡也有自己那一句；过期的小屋和从来没有过的号码分得开（墓碑）——⑥ 真叫一次 api/room.js
 * （内存库），不只读源码。
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

// ---- ④ errorText 接了的每一种，客户端都认得（2026-10-08 方案 2-1）--------------
//
// 服务器答的词要先过 engine/room.ts 的 KNOWN 那张单子，才会原样交给 errorText；不在单子上
// 的一律被改成 'network'。第 16 推给 `blocked` / `bad`（名字过不了关）在 errorText 里写了两句
// 话，单子上却没加——那两句从来没人看得见，屏幕上写的是「连不上网络」。
{
  const at = engine.indexOf('const KNOWN: RoomError[] = [');
  const list = engine.slice(at, engine.indexOf('];', at));
  const known = [...list.matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]);
  check('④ 量程：KNOWN 真的读出来了', known.length >= 10, `${known.length} 个：${known.join(' ')}`);
  const fn = mp.slice(mp.indexOf('export function errorText('));
  const cased = [...new Set([...fn.slice(0, fn.indexOf('\n}')).matchAll(/case '([a-zA-Z]+)':/g)].map((m) => m[1]))];
  const unseen = cased.filter((c) => !known.includes(c));
  check('④ errorText 里接了话的每一种都在 KNOWN 上（不然那句话永远显示不出来）', unseen.length === 0, unseen.join('、'));
}

// ---- ⑤ 服务器的错、限速，各说各的（10-11 方案 C-3 第 1、2 条）-------------------------
//
// 原先：开屋十二次撞号的 503 'busy' 写「多人游玩尚未开放」（功能好好开着）；认不出的 5xx 落成 'network'「连不上
// 网络」（网也好好的）；大厅轮询被限速写「网络断了一下，正在把您接回小屋」；限速那一句让人「等几秒」，而进屋的桶
// 是一小时六十次。
{
  check('⑤ 认不出的 5xx 认成 server（不落进 network）', /\?\? \(res\.status >= 500 \? 'server' : 'network'\)/.test(engine), '');
  const fn = mp.slice(mp.indexOf('export function errorText(')).slice(0, mp.slice(mp.indexOf('export function errorText(')).indexOf('\n}'));
  check('⑤ busy 和 server 说「服务器暂时出错」（serverBusy）', /case 'busy':\s*\n\s*case 'server':\s*\n\s*return s\.serverBusy;/.test(fn), '');
  check('⑤ notConfigured 才说「多人游玩尚未开放」', /case 'notConfigured':\s*\n\s*return s\.mpErrNotOpen;/.test(fn), '');
  check('⑤ 大厅轮询被限速：说限速那一句，不说「网络断了」', /reason === 'tooMany' \? s\.mpErrTooMany : s\.mpReconnecting/.test(mp), '');
  const i18n = read('src/i18n.ts');
  const tooMany = [...i18n.matchAll(/mpErrTooMany: '([^']+)'/g)].map((m) => m[1]);
  check('⑤（尺子）mpErrTooMany 四语都读到了', tooMany.length === 4, `${tooMany.length} 句`);
  check('⑤ 限速那一句不再让人「等几秒」（改成「稍后再试」）',
    tooMany.every((t) => !/等几秒|等幾秒|few seconds|quelques secondes/.test(t)) && tooMany.every((t) => /稍后再试|稍後再試|try again later|Réessayez plus tard/.test(t)),
    tooMany.join(' ｜ '));
}

// ---- ⑥ 过期的小屋答 ended，从来没有过的号码答 noRoom（10-11 方案 C-3 第 3 条）-----------
//
// 原先两种答的是同一句 noRoom：大厅里敲他刚刚还在的那间屋的号码，屏幕上写「没有这个小屋号码」。现在每次续命顺手
// 立一块墓碑（api/room.js 的 tombKey），屋子不在了、墓碑还在，就答 ended——客户端说的是屋主散场那同一句「这个小
// 屋已经结束了」。「过期」是把那间屋的键直接删掉摆出来的（真等二十分钟不现实）。
{
  process.env.ALLOW_MEMORY_STORE = '1';
  const room = (await import('../api/room.js')).default;
  const { saveAccount, newAccount } = await import('../api/_accounts.js');
  const { del } = await import('../api/_store.js');
  let ip = 0;
  const call = async (body) => {
    let status = 0;
    let text = '';
    const res = { status: (c) => ((status = c), res), setHeader: () => res, end: (t) => ((text = t), res) };
    await room({ method: 'POST', headers: { 'x-forwarded-for': `198.21.0.${++ip}` }, body }, res);
    return { status, body: JSON.parse(text || '{}') };
  };
  const account = newAccount('eee777', 'code');
  account.until = Date.now() + 9e8;
  await saveAccount('errortext@example.com', account);
  const h = await call({ action: 'create', name: '屋主', email: 'errortext@example.com', accountToken: account.token });
  const code = h.body.code;
  check('⑥（尺子）开得出一间屋', h.status === 200 && /^\d{4}$/.test(code || ''), `${h.status} ${code}`);
  const host = { playerId: h.body.playerId, playerToken: h.body.playerToken };
  await del('room:' + code);
  const joined = await call({ action: 'join', code, name: '晚来的' });
  check('⑥ 过期的屋子：大厅里敲它的号码，答 ended（不是「没有这个号码」）', joined.status === 409 && joined.body.error === 'ended',
    `${joined.status} ${joined.body.error}`);
  const polled = await call({ action: 'state', code, ...host });
  check('⑥ 过期的屋子：局中轮询也答 ended', polled.status === 409 && polled.body.error === 'ended', `${polled.status} ${polled.body.error}`);
  const never = await call({ action: 'join', code: code === '0000' ? '0001' : '0000', name: '敲错了' });
  check('⑥ 从来没有过的号码：照旧 noRoom', never.status === 404 && never.body.error === 'noRoom', `${never.status} ${never.body.error}`);
  await del('roomgone:' + code);
  const later = await call({ action: 'join', code, name: '第二天来的' });
  check('⑥ 墓碑也过了：回到 noRoom', later.status === 404 && later.body.error === 'noRoom', `${later.status} ${later.body.error}`);
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

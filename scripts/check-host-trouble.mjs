/**
 * 屋主出状况的时候，谁该被叫停、谁该接着打。纯 node，不开浏览器，几十毫秒。
 *
 *   npx esbuild src/engine/room.ts --bundle --format=esm --platform=neutral \
 *     --outfile=/tmp/room.mjs
 *   node scripts/check-host-trouble.mjs /tmp/room.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么
 *
 * `hostTroubleIn` 回的那三种结果不是三句提示语，是**三种后果**：
 *
 *   'gone'  → ui/scoreboard.ts 的 roomOver 当场成立，**正在打的人就地被转成一局单人**
 *             （goSolo）：座位交回去，这一局的分再也回不到小屋的榜上。
 *   'away'  → 屏幕上一句「屋主等一下就来」，大家继续。
 *   null    → 什么都不说。
 *
 * 而 `gone` 这个标记是服务器 90 秒（ABSENT_MS）没听见心跳给的——手机进后台、接个电
 * 话、过个隧道，90 秒都是常态，不是意外。于是原先的行为是：**屋主手机一黑，满屋人全
 * 被踢出这一局。** 服务器那边压根没有这回事（roundOver 不等缺席的人，playerCount 本
 * 来也不算竞赛屋的主持人），这一整条是客户端自己判出来的，所以门也在客户端这一侧：
 * 量的是那个纯函数对各种状态的映射。
 *
 * 两头都要量，因为这两件事会互相打架：
 *   · **倒数和对局中**，屋主出什么事都不算数——屋里其他人手上那一局和他的状态没关系；
 *   · 可**一局打完之后**（roundOver / lobby），他真的走了就是事——开下一局只有他能做，
 *     那时候该散场，大家看战绩卡。把后一半也放过去，屋里的人会永远等一个不回来的人。
 *
 * 这条规矩的边界 2026-10-03（第 10 推 #9）挪过两处，两处都往「别踢人」那头挪：
 *   · 倒数 / 对局中的豁免，从**只给竞赛屋**推开到**所有屋子**：普通屋的屋主自己也在
 *     打，可他那一局打完之后就不再翻页了——交完卷等别人的那几十秒里，他的设备照样可能
 *     被系统按下去。
 *   · `gone`（太久没动静）从 'gone' 那一档挪到 'away'：按《离开》是他自己的决定（座位
 *     都交回去了），90 秒没心跳只是他那台设备没说话，而他多半正拿着手机走回来。真的
 *     走了只剩两种：座位不在了 / 交回去了（left），和把网页关掉了（closed）。
 */
const bundle = process.argv[2];
if (!bundle) {
  console.error('用法：node scripts/check-host-trouble.mjs <打好的 room.mjs>');
  process.exit(2);
}
const { hostTroubleIn, roomPhase } = await import(bundle);

let fail = 0;
let ran = 0;
const check = (n, ok, extra = '') => {
  ran++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const HOST = 'h1';
/**
 * 一份房间状态。`phase` 只是个说法，真正决定段落的是下面这几个字段——所以这儿照
 * `roomPhase` 认的那几位来拼，拼完再验一遍它真的落在想要的那一段上（见下面那条
 * 「量程」断言）。
 */
function state({ contest = false, phase = 'playing', host = {}, ended = false } = {}) {
  const base = {
    ended,
    contest,
    host: HOST,
    players: [{ id: HOST, name: '主持人', score: 0, ...host }, { id: 'p2', name: '甲', score: 10 }],
    round: 1,
    seed: 'abc',
    // 开赛时刻：playing 要在过去，countdown 要在将来。serverTime 在 node 里就是
    // Date.now()（没有任何一份回包来校准过时钟偏移）。
    startAt: Date.now() - 5_000,
    roundOver: false,
    learnHold: false,
    mode: 'square',
    seats: 8,
    serverNow: Date.now(),
  };
  if (phase === 'lobby') return { ...base, round: 0, startAt: 0, seed: '' };
  if (phase === 'countdown') return { ...base, startAt: Date.now() + 5_000 };
  if (phase === 'roundOver') return { ...base, roundOver: true };
  if (phase === 'learnHold') return { ...base, learnHold: true };
  return base;
}

// 量程：下面每一条都建立在「这份状态真的落在那一段」上。拼错了 startAt 之类的话，
// 后面所有断言会一起变成空判——那正是最难发现的一种假绿。
{
  const got = ['lobby', 'countdown', 'playing', 'roundOver'].map((p) => roomPhase(state({ phase: p })));
  check('拼出来的四份状态真的落在四个不同的段上', got.join(' ') === 'lobby countdown playing roundOver', got.join(' '));
  // learnHold 是「等人学教学」：开赛时刻已经过去，但这一局一步都没走。roomPhase
  // 把它算 countdown（见那个函数的注释）——所以这一段也该放过。
  check('等人学教学那一格算 countdown', roomPhase(state({ phase: 'learnHold' })) === 'countdown', roomPhase(state({ phase: 'learnHold' })));
  check('散场那一份真的是 ended', roomPhase(state({ ended: true })) === 'ended', roomPhase(state({ ended: true })));
}

// ── 一、倒数和对局中：屋主出什么事都不算数 ──────────────────────────
//
// 两种屋子一起走：普通屋和竞赛屋的答案在这一段**必须一模一样**。写成两套的时候，普通
// 屋那半边就是「屋主手机一黑，满屋人全被踢出这一局」。
//
// `closed`（网页真的关掉了）也在里面：那在打完之后确实是散场，可**打着的时候**同样不该
// 把人踢出去——他手上这一局是真的，走到一半被没收，比小屋散了本身更难受（scoreboard
// 的 goSolo 那段注释）。
{
  for (const contest of [false, true]) {
    const kind = contest ? '竞赛屋' : '普通屋';
    for (const phase of ['countdown', 'playing', 'learnHold']) {
      for (const flag of ['left', 'closed', 'gone', 'away']) {
        const st = state({ contest, phase, host: { [flag]: true } });
        check(`① ${kind} · ${phase} · 屋主 ${flag}：大家接着打`, hostTroubleIn(st, false) === null, String(hostTroubleIn(st, false)));
      }
    }
  }
}

// ── 二、一局打完之后：真的走了才散场 ────────────────────────────────
//
// 这一半才让上一半安全。
{
  for (const contest of [false, true]) {
    const kind = contest ? '竞赛屋' : '普通屋';
    for (const phase of ['lobby', 'roundOver']) {
      for (const flag of ['left', 'closed']) {
        const st = state({ contest, phase, host: { [flag]: true } });
        check(`② ${kind} · ${phase} · 屋主 ${flag}：该散场`, hostTroubleIn(st, false) === 'gone', String(hostTroubleIn(st, false)));
      }
      // ⚠️ gone 在这一档，不在上面那一档：90 秒没心跳是「等他」，不是「他走了」。
      const gone = state({ contest, phase, host: { gone: true, away: true } });
      check(`③ ${kind} · ${phase} · 屋主太久没动静：等他（不散场）`, hostTroubleIn(gone, false) === 'away', String(hostTroubleIn(gone, false)));
      const away = state({ contest, phase, host: { away: true } });
      check(`③ ${kind} · ${phase} · 屋主暂时联系不上：等他`, hostTroubleIn(away, false) === 'away', String(hostTroubleIn(away, false)));
      // 只有 gone、没有 away：**线上出不来这一种**（两位都从同一个「最后一次露面」算，
      // 90 秒必然也过了 30 秒）。摆它只为一件事——钉住这个函数真的读了 `gone`。不摆的
      // 话，把 `host.gone` 从那一句里删掉，上面每一条都还是绿的（它们的 away 也是真），
      // 只有源码那一条会红。
      const onlyGone = state({ contest, phase, host: { gone: true } });
      check(`③ ${kind} · ${phase} · 只有 gone 没有 away：也是等他`, hostTroubleIn(onlyGone, false) === 'away', String(hostTroubleIn(onlyGone, false)));
      const fine = state({ contest, phase });
      check(`② ${kind} · ${phase} · 屋主好着：什么都不说`, hostTroubleIn(fine, false) === null, String(hostTroubleIn(fine, false)));
    }
  }
  // 名单里根本没有他（座位已经被删掉）也是「走了」——api/room.js 的 leave 会留着
  // 走掉的人是为了排名，但真删掉的那条路存在。
  const missing = { ...state({ phase: 'roundOver' }), players: [{ id: 'p2', name: '甲', score: 10 }] };
  check('② 名单里没有屋主：判「走了」', hostTroubleIn(missing, false) === 'gone', String(hostTroubleIn(missing, false)));
  // 而在对局中，连「名单里没有他」都不算事（同上：这一局和他没关系）。
  const missingMid = { ...state({ phase: 'playing' }), players: [{ id: 'p2', name: '甲', score: 10 }] };
  check('① 对局中名单里没有屋主：也不算事', hostTroubleIn(missingMid, false) === null, String(hostTroubleIn(missingMid, false)));
}

// ── 三、原来那三道前置闸一条都没动 ──────────────────────────────────
{
  check('已经正式散场了：这个函数不管（那条路有自己的战绩页）',
    hostTroubleIn(state({ ended: true, host: { left: true } }), false) === null);
  check('我自己就是屋主：不对自己报警',
    hostTroubleIn(state({ phase: 'roundOver', host: { left: true } }), true) === null);
  check('没有状态：什么都不说', hostTroubleIn(null, false) === null);
  const noHost = { ...state({ phase: 'roundOver', host: { left: true } }), host: '' };
  check('这间屋没有屋主字段：什么都不说', hostTroubleIn(noHost, false) === null);
}

// ── 四、源码：那两处边界还在原地 ────────────────────────────────────
//
// 上面都是行为。这两条钉的是**写法**：行为那几条红的时候，这两条告诉人红在哪一句；反
// 过来，这两条红而行为全绿，说明有人把整个判断挪走了，上面那些条喂的是一个不再被调用
// 的函数。
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/engine/room.ts', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export function hostTroubleIn'));
  const head = body.slice(0, body.indexOf('\n}'));
  const goneLine = head.split('\n').find((l) => l.includes("return 'gone'"));
  check('源码：散场那一句只认 left / closed / 没座位',
    Boolean(goneLine) && !goneLine.includes('.gone'), String(goneLine).trim());
  const awayLine = head.split('\n').find((l) => l.includes("? 'away'"));
  check('源码：gone 归到 away 那一档', Boolean(awayLine) && awayLine.includes('host.gone'), String(awayLine).trim());
  const exempt = head.split('\n').find((l) => l.includes("phase === 'countdown'"));
  check('源码：倒数 / 对局中那道豁免不挑屋子（没有 contest）',
    Boolean(exempt) && !exempt.includes('contest'), String(exempt).trim());
}

console.log(fail ? `\n${fail} 条没过（共 ${ran} 条）` : `\n全部通过（${ran} 条）`);
process.exit(fail ? 1 : 0);

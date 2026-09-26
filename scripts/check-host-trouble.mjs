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
 * `hostTroubleIn` 回 `'gone'` 的后果比它看起来重得多：`ui/scoreboard.ts` 的
 * `roomOver` 拿它当「小屋散了」，而那一头一判散场，**正在打的人就地被转成一局单人**
 * （goSolo）——他这一局的分再也回不到小屋的榜上。
 *
 * 而 `gone` 里包含 `host.gone`，那是服务器 90 秒（ABSENT_MS）没听见心跳给的标记。
 * 竞赛屋的主持人**不下场**：他那台设备就摆在那儿看实时榜单，锁屏过 90 秒是常态，不
 * 是意外。于是原先的行为是：**主持人一锁屏，满屋选手全被踢出这场比赛。**
 *
 * 服务器那边压根没有这回事——`playerCount` 不算主持人，`roundOver` 也不等他（见
 * api/room.js 的 isSpectator）。这一整条是客户端自己判出来的，所以门也在客户端这
 * 一侧：量的是那个纯函数对各种状态的映射。
 *
 * 两头都要量，因为这两件事会互相打架：
 *   · 竞赛屋**正在打**的时候，主持人不见了不算事；
 *   · 可一局打完之后（roundOver / lobby）他不见了**就是事**——开下一局只有他能做，
 *     那时候该散场，大家看战绩卡。把后一半也放过去，屋里的人会永远等一个不会回来
 *     的人。
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
  // 把它算 countdown（见那个函数的注释）——所以竞赛屋这一段也该放过。
  check('等人学教学那一格算 countdown', roomPhase(state({ phase: 'learnHold' })) === 'countdown', roomPhase(state({ phase: 'learnHold' })));
}

// ── 一、普通屋：一切照旧 ────────────────────────────────────────────
//
// 普通屋的屋主**是选手**，他不见了这一局就再也凑不齐——所以照旧判 gone，一处都
// 不许因为竞赛屋那条新规矩被放过。
{
  for (const phase of ['lobby', 'countdown', 'playing', 'roundOver']) {
    for (const flag of ['left', 'closed', 'gone']) {
      const st = state({ contest: false, phase, host: { [flag]: true } });
      check(`普通屋 · ${phase} · 屋主 ${flag}：照旧判「走了」`, hostTroubleIn(st, false) === 'gone', String(hostTroubleIn(st, false)));
    }
  }
  const away = state({ contest: false, phase: 'playing', host: { away: true } });
  check('普通屋 · 屋主只是卡住了：判「等他一下」', hostTroubleIn(away, false) === 'away', String(hostTroubleIn(away, false)));
  const fine = state({ contest: false, phase: 'playing' });
  check('普通屋 · 屋主好着：什么事都没有', hostTroubleIn(fine, false) === null, String(hostTroubleIn(fine, false)));
}

// ── 二、竞赛屋：局正打着的时候，主持人不见了不算事 ──────────────────
{
  for (const phase of ['countdown', 'playing', 'learnHold']) {
    for (const flag of ['left', 'closed', 'gone', 'away']) {
      const st = state({ contest: true, phase, host: { [flag]: true } });
      check(`竞赛屋 · ${phase} · 主持人 ${flag}：选手接着打`, hostTroubleIn(st, false) === null, String(hostTroubleIn(st, false)));
    }
  }
}

// ── 三、竞赛屋：一局打完之后，他不见了就是事 ────────────────────────
//
// 这一半才让上一半安全。开下一局只有他能做，所以两局之间他不回来就该散场——放过
// 去的话，屋里的人会永远等一个不会回来的人。
{
  for (const phase of ['lobby', 'roundOver']) {
    const gone = state({ contest: true, phase, host: { gone: true } });
    check(`竞赛屋 · ${phase} · 主持人不见了：该散场`, hostTroubleIn(gone, false) === 'gone', String(hostTroubleIn(gone, false)));
    const away = state({ contest: true, phase, host: { away: true } });
    check(`竞赛屋 · ${phase} · 主持人卡住了：说「等他一下」`, hostTroubleIn(away, false) === 'away', String(hostTroubleIn(away, false)));
  }
}

// ── 四、原来那三道前置闸一条都没动 ──────────────────────────────────
{
  check('已经正式散场了：这个函数不管（那条路有自己的战绩页）',
    hostTroubleIn(state({ ended: true, host: { gone: true } }), false) === null);
  check('我自己就是屋主：不对自己报警',
    hostTroubleIn(state({ host: { gone: true } }), true) === null);
  check('没有状态：什么都不说', hostTroubleIn(null, false) === null);
  const noHost = { ...state({ host: { gone: true } }), host: '' };
  check('这间屋没有屋主字段：什么都不说', hostTroubleIn(noHost, false) === null);
  // 名单里根本没有他（座位已经被删掉）也是「走了」——api/room.js 的 leave 会留着
  // 走掉的人是为了排名，但真删掉的那条路存在。
  const missing = { ...state(), players: [{ id: 'p2', name: '甲', score: 10 }] };
  check('名单里没有屋主：判「走了」', hostTroubleIn(missing, false) === 'gone', String(hostTroubleIn(missing, false)));
}

console.log(fail ? `\n${fail} 条没过（共 ${ran} 条）` : `\n全部通过（${ran} 条）`);
process.exit(fail ? 1 : 0);

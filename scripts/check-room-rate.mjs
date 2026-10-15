/**
 * 小屋的限速桶（state / nudge / join / create / rename 各一个、报分按座位一个、start / force / score / end / learn
 * 那五条合一个 room:auth）：该挡的挡住，该放过的一个都不能误伤。
 *
 *   node scripts/check-room-rate.mjs
 *
 * api/room.js 从前一条限速都没有，而它是全站唯一「不出示身份也办」的接口：
 * 房号四位数，一个脚本从 0000 扫到 9999 就能把每间正在打的小屋的 publicState
 * 全拉下来（玩家自己填的名字、头像、实时比分、谁交了卷）。
 *
 * **可这道门真正要盯的是反过来那一半。** 限速给紧了比不给更糟：callerId 认的
 * 是 IP，而小屋本来就是给朋友一起玩的，四个人常常在同一个 Wi-Fi 后面，轮询又
 * 是每人每秒一次（engine/room.ts 的 everyMs = 1000）。桶给小了，一屋人打到一
 * 半集体断线，而屏幕上写的是「连不上网络」——他们会去查路由器。
 *
 * 所以这道门两头都量：
 *   ① 竞赛屋二十一个人满座挤在一个 IP 后面轮询一整个十秒窗口（210 次），一次都不许被挡；
 *      再翻一倍（420 次：每人多开一个标签页）也不许——10-09 补充方案 7-13 第 5 条把桶从 300
 *      放到 600 就是为了这个余量（原先 300 只够八人屋，二十一个人只剩 1.43 倍）；
 *   ② 一秒上千次的扫号，必须在六百次之内被关在门外；
 *   ③ 被挡时回的是 429 + { error: 'tooMany' }（客户端认这个词，见 KNOWN）；
 *   ④ leave / bye 不挂限速——它们是关页面时用 beacon 发的，误伤一次全屋白等
 *      九十秒。这一条要是哪天「顺手」加上了，这里会红。
 *   ⑥ start / force / score / end / learn 对「号码在 / 不在」答两句不同的话（403 / 404），原先不挂桶，一个 IP 拿
 *      start 连扫两千个号码一次都没被挡（10-15 补充 S4）。现在合一个宽桶：扫到第 1001 次开始 429；21 座同一个 IP
 *      一个窗口 945 条零误伤；桶用完了 bye / leave 照旧放行。
 *
 * 不起服务器、不开浏览器：库用进程内那份，直接叫 handler。窗口是按
 * Math.floor(now / windowS) 切的（api/_ratelimit.js），所以下面每一段都在自己
 * 那个十秒窗口里跑完，不用等真钟。
 */
process.env.ALLOW_MEMORY_STORE = '1';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const room = (await import('../api/room.js')).default;
const { saveAccount, newAccount } = await import('../api/_accounts.js');

/** 每个「来客」一个 IP，这样各人的桶互不相干——正如线上那样。 */
const call = async (body, ip = '203.0.113.7') => {
  let status = 0;
  let text = '';
  const res = {
    status: (c) => ((status = c), res),
    setHeader: () => res,
    end: (t) => ((text = t), res),
  };
  await room({ method: 'POST', headers: { 'x-forwarded-for': ip }, body }, res);
  return { status, body: JSON.parse(text || '{}') };
};

const MAIL = 'ratehost@example.com';
const account = newAccount('aaa111', 'code');
account.until = Date.now() + 9e8;
await saveAccount(MAIL, account);
const who = { email: MAIL, accountToken: account.token };

const opened = await call({ action: 'create', name: 'HOST', ...who }, '198.51.100.1');
check('屋主开得出小屋', opened.status === 200 && Boolean(opened.body.code), String(opened.body.code));
const code = opened.body.code;

// ── ① 一屋二十一个人挤在一个 IP 后面轮询十秒：210 次，再翻一倍也不许被挡 ──────
//
// 每一段各用一个 IP（各是一个新桶），每一段都要在同一个十秒窗口里跑完——窗口是按
// Math.floor(now / windowS) 切的，跑到一半跨过边界，后半段落进新桶：① 成了空绿，② 成了偶发
// 红。一段几百次进程内调用不到半秒，所以只在这个窗口剩不到两秒时才等到下一个窗口开头（这道门
// 在 CI 的 check 里，不许为它干等十秒），并且量一下真的没跨过去。
const windowOf = () => Math.floor(Date.now() / 10000);
const freshWindow = async () => {
  if (10000 - (Date.now() % 10000) > 2000) return;
  const w = windowOf();
  while (windowOf() === w) await new Promise((r) => setTimeout(r, 50));
};
for (const [n, label, ip] of [
  [210, '竞赛屋二十一个人同一个 Wi-Fi 轮询一整个十秒窗口', '192.0.2.50'],
  [420, '再翻一倍（每人多开一个标签页）', '192.0.2.51'],
]) {
  await freshWindow();
  const w = windowOf();
  const polls = await Promise.all(Array.from({ length: n }, () => call({ action: 'state', code }, ip)));
  const blocked = polls.filter((r) => r.status === 429).length;
  check(`（尺子）${n} 次都落在同一个十秒窗口里`, windowOf() === w);
  check(`${label}，一次都没被误伤`, blocked === 0, `被挡 ${blocked} / ${n}`);
}

// ── ② 扫号：同一个来客六百次之内必须被关在门外 ──────────────────────────
const SCAN = '198.51.100.66';
await freshWindow();
const scanWindow = windowOf();
let first429 = -1;
for (let i = 1; i <= 800; i++) {
  const r = await call({ action: 'state', code: String(i % 10000).padStart(4, '0') }, SCAN);
  if (r.status === 429) { first429 = i; break; }
}
check('（尺子）扫号那一段也落在同一个十秒窗口里', windowOf() === scanWindow);
check('扫号在六百次之内被挡下来', first429 > 0 && first429 <= 601, `第 ${first429} 次开始 429`);

// ── ③ 被挡时说的是客户端认得的那个词 ───────────────────────────────────
const again = await call({ action: 'state', code }, SCAN);
check(
  '挡下来时回 429 + tooMany（客户端的 KNOWN 认这个词）',
  again.status === 429 && again.body.error === 'tooMany',
  `${again.status} ${JSON.stringify(again.body)}`,
);

// ── ④ leave / bye 故意不挂限速 ─────────────────────────────────────────
const BEACON = '192.0.2.99';
let beaconBlocked = 0;
for (let i = 0; i < 400; i++) {
  const r = await call({ action: 'bye', code, playerId: 'nobody' }, BEACON);
  if (r.status === 429) beaconBlocked++;
}
check(
  'bye 不挂限速：关页面的 beacon 一次都不许被挡（误伤一次全屋白等九十秒）',
  beaconBlocked === 0,
  `被挡 ${beaconBlocked} / 400`,
);

// ── ⑤ 报分按座位限速：一屋二十一个人同一个 IP 照常报，同一个座位狂发被挡（10-11 方案 C-6）──────
//
// 原先报分一条限速都没有。新加的那一道是**按座位**的（api/room.js 的 SCORE_RATE，十秒四十次）：按 IP 的话，竞赛屋
// 二十一个人在同一个教室 Wi-Fi 后面，一起报分就一起被挡。而且它排在 seatOf 验过座位之后——拿别人的 playerId、
// 配一把错的令牌狂发，挡掉的是这几条（403），他的桶一格都不占。
{
  const { hset, hgetall } = await import('../api/_store.js');
  const big = await call({ action: 'create', name: 'HOST2', contest: true, ...who }, '198.51.100.2');
  const room2 = big.body.code;
  const seats = [{ playerId: big.body.playerId, playerToken: big.body.playerToken }];
  for (let i = 1; i <= 20; i++) {
    const g = await call({ action: 'join', code: room2, name: '选手' + i }, '192.0.2.70');
    if (g.body.playerToken) seats.push({ playerId: g.body.playerId, playerToken: g.body.playerToken });
  }
  check('⑤（尺子）竞赛屋坐满二十一个人', seats.length === 21, `${seats.length} 人`);
  await call({ action: 'start', code: room2, ...seats[0], mode: 'square' }, '198.51.100.2');
  const hash = await hgetall('room:' + room2);
  await hset('room:' + room2, 'meta', { ...hash.meta, startAt: Date.now() - 30_000 });
  // 二十一个人同一个 IP，每人报十次（正常一局十秒里报的比这少：分数变了才报、没变四秒一次心跳）。
  await freshWindow();
  const w = windowOf();
  const sent = await Promise.all(seats.flatMap((p) =>
    Array.from({ length: 10 }, (_, k) => call({ action: 'score', code: room2, ...p, score: 10 * k, round: 1 }, '192.0.2.80'))));
  check('⑤（尺子）二百一十条都落在同一个十秒窗口里', windowOf() === w);
  const hit = sent.filter((r) => r.status === 429).length;
  check('⑤ 二十一个人同一个 IP 正常报分（每人十次）：一条都不挡', hit === 0, `被挡 ${hit} / ${sent.length}`);

  // 拿第二个人的 playerId、配一把错的令牌狂发一百条：403，不占他的桶。
  await freshWindow();
  const victim = seats[2];
  const forged = await Promise.all(Array.from({ length: 100 }, () =>
    call({ action: 'score', code: room2, playerId: victim.playerId, playerToken: 'wrong', score: 1, round: 1 }, '192.0.2.81')));
  check('⑤ 冒名狂发（令牌不对）：一律 403', forged.every((r) => r.status === 403), forged.map((r) => r.status).filter((s) => s !== 403).join(','));
  const own = await call({ action: 'score', code: room2, ...victim, score: 77, round: 1 }, '192.0.2.82');
  check('⑤ 被冒名的那个人自己报分：照收（他的桶没被别人灌满）', own.status === 200, String(own.status));

  // 同一个座位狂发：四十条之后被挡。另开一间屋、一个这个窗口里一条都没报过的座位（上面那二百一十条里每个座位
  // 已经用掉十条，同一个窗口里再量就是第三十一条被挡——量的是别的东西）。
  const small = await call({ action: 'create', name: 'HOST3', ...who }, '198.51.100.3');
  const room3 = small.body.code;
  const g3 = await call({ action: 'join', code: room3, name: '狂发的' }, '192.0.2.71');
  const g4 = await call({ action: 'join', code: room3, name: '老实的' }, '192.0.2.71');
  const spam = { playerId: g3.body.playerId, playerToken: g3.body.playerToken };
  const calm = { playerId: g4.body.playerId, playerToken: g4.body.playerToken };
  await call({ action: 'start', code: room3, playerId: small.body.playerId, playerToken: small.body.playerToken, mode: 'square' }, '198.51.100.3');
  await freshWindow();
  const w3 = windowOf();
  let first = -1;
  for (let i = 1; i <= 100; i++) {
    const r = await call({ action: 'score', code: room3, ...spam, score: i, round: 1 }, '192.0.2.83');
    if (r.status === 429) { first = i; break; }
  }
  check('⑤（尺子）狂发那一段落在同一个十秒窗口里', windowOf() === w3);
  check('⑤ 同一个座位狂发：第四十一条起被挡（429 tooMany）', first === 41, `第 ${first} 条开始 429`);
  const other = await call({ action: 'score', code: room3, ...calm, score: 5, round: 1 }, '192.0.2.83');
  check('⑤ 同一个 IP 上别的座位照常（按座位，不按 IP）', other.status === 200, String(other.status));
}

// ── 顺手钉住：这四个桶的名字和数值就是上面这几条的依据 ──────────────────
const { readFileSync } = await import('node:fs');
const src = readFileSync(new URL('../api/room.js', import.meta.url), 'utf8');
// join 每小时 300（站长 10-15 定；原先 60）；rename 照旧 60。
for (const [action, limit, windowS] of [
  ['state', 600, 10], ['nudge', 200, 10], ['join', 300, 3600], ['create', 20, 3600], ['rename', 60, 3600],
]) {
  const re = new RegExp(`${action}:\\s*\\{\\s*limit:\\s*${limit},\\s*windowS:\\s*${windowS}\\s*\\}`);
  check(`RATE 表里 ${action} 还是 ${limit} 次 / ${windowS} 秒`, re.test(src));
}
check('报分那一道是十秒四十次（SCORE_RATE）', /const SCORE_RATE = \{ limit: 40, windowS: 10 \};/.test(src));
check('报分限速排在 seatOf 验过座位之后', (() => {
  const body = src.slice(src.indexOf('async function score(res, body)'));
  return body.indexOf('seatOf(hash, body.playerId, body.playerToken)') < body.indexOf("tooMany('room:score'");
})());
check(
  'create 的限速排在 hostMayOpen 之前（不然烧 Creem 额度那条没堵上）',
  src.indexOf('RATE[body.action]') < src.indexOf('case \'create\': return await create'),
);

check('⑥ 那五条合一个桶 room:auth：名单、上限、窗口', /const AUTH_ACTIONS = \['start', 'force', 'score', 'end', 'learn'\];/.test(src)
  && /const AUTH_LIMIT = 1000;/.test(src) && /const AUTH_WINDOW_S = 10;/.test(src)
  && /tooMany\('room:auth', callerId\(req\), AUTH_LIMIT, AUTH_WINDOW_S\)/.test(src));

// ── ⑥ 要验身份的那五条：扫号挡住、一屋人零误伤、bye 照旧（10-15 补充 S4）────────────────────────
{
  // 扫号：一个 IP 拿 start 敲不存在的号码。前一千次答的是 404（号码不在），第 1001 次起 429。
  const SCAN2 = '198.51.100.99';
  await freshWindow();
  const w = windowOf();
  let firstBlock = -1;
  for (let i = 1; i <= 1100; i++) {
    const r = await call({ action: 'start', code: String(1000 + (i % 9000)).padStart(4, '0'), playerId: 'x', playerToken: 'y', mode: 'square' }, SCAN2);
    if (r.status === 429) {
      firstBlock = i;
      break;
    }
  }
  check('⑥（尺子）扫号那一段落在同一个十秒窗口里', windowOf() === w);
  check('⑥ 一个 IP 拿 start 扫号：第 1001 次起被挡（429）', firstBlock === 1001, `第 ${firstBlock} 次开始 429`);
  const bye = await call({ action: 'bye', code: '0000', playerId: 'x', playerToken: 'y' }, SCAN2);
  const leave = await call({ action: 'leave', code: '0000', playerId: 'x', playerToken: 'y' }, SCAN2);
  check('⑥ 桶用完了，bye / leave 照旧放行（不是 429）', bye.status !== 429 && leave.status !== 429, `${bye.status} / ${leave.status}`);

  // 一屋人：竞赛屋 21 座同一个 IP，一个窗口里每人报 40 次分（报分那一道按座位，十秒四十次）、客人再按 105 次「开局」
  // （不是屋主，答 403 notHost）——945 条，一条都不许被这个新桶挡。
  const big = await call({ action: 'create', name: 'HOST6', contest: true, ...who }, '198.51.100.3');
  const code6 = big.body.code;
  const seats = [{ playerId: big.body.playerId, playerToken: big.body.playerToken }];
  for (let i = 1; i <= 20; i++) {
    const g = await call({ action: 'join', code: code6, name: '六' + i }, '192.0.2.90');
    if (g.body.playerToken) seats.push({ playerId: g.body.playerId, playerToken: g.body.playerToken });
  }
  await call({ action: 'start', code: code6, ...seats[0], mode: 'square' }, '198.51.100.3');
  const { hset, hgetall } = await import('../api/_store.js');
  const hash = await hgetall('room:' + code6);
  await hset('room:' + code6, 'meta', { ...hash.meta, startAt: Date.now() - 30_000 });
  await freshWindow();
  const w2 = windowOf();
  const ROOM_IP = '192.0.2.91';
  const sent = await Promise.all([
    ...seats.flatMap((p) => Array.from({ length: 40 }, (_, k) => call({ action: 'score', code: code6, ...p, score: k, round: 1 }, ROOM_IP))),
    ...Array.from({ length: 105 }, (_, k) => call({ action: 'start', code: code6, ...seats[1 + (k % 20)], mode: 'square' }, ROOM_IP)),
  ]);
  check('⑥（尺子）945 条都落在同一个十秒窗口里', windowOf() === w2 && sent.length === 945, `${sent.length} 条`);
  const hit = sent.filter((r) => r.status === 429).length;
  check('⑥ 竞赛屋 21 座同一个 IP 一个窗口 945 条：一条都不挡', hit === 0, `被挡 ${hit} / ${sent.length}`);
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

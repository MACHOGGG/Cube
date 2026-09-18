/**
 * 小屋那四个桶：该挡的挡住，该放过的一个都不能误伤。
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
 *   ① 八个人满座挤在一个 IP 后面轮询一整个十秒窗口（80 次），一次都不许被挡；
 *   ② 一秒上千次的扫号，必须在三百次之内被关在门外；
 *   ③ 被挡时回的是 429 + { error: 'tooMany' }（客户端认这个词，见 KNOWN）；
 *   ④ leave / bye 不挂限速——它们是关页面时用 beacon 发的，误伤一次全屋白等
 *      九十秒。这一条要是哪天「顺手」加上了，这里会红。
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

// ── ① 一屋八个人挤在一个 IP 后面轮询十秒：80 次，一次都不许被挡 ──────────
const HOME = '192.0.2.50';
const polls = await Promise.all(
  Array.from({ length: 80 }, () => call({ action: 'state', code }, HOME)),
);
const blocked = polls.filter((r) => r.status === 429).length;
check(
  '八个人同一个 Wi-Fi 轮询一整个十秒窗口，一次都没被误伤',
  blocked === 0,
  `被挡 ${blocked} / 80`,
);

// ── ② 扫号：同一个来客三百次之内必须被关在门外 ──────────────────────────
const SCAN = '198.51.100.66';
let first429 = -1;
for (let i = 1; i <= 400; i++) {
  const r = await call({ action: 'state', code: String(i % 10000).padStart(4, '0') }, SCAN);
  if (r.status === 429) { first429 = i; break; }
}
check('扫号在三百次之内被挡下来', first429 > 0 && first429 <= 301, `第 ${first429} 次开始 429`);

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

// ── 顺手钉住：这四个桶的名字和数值就是上面这几条的依据 ──────────────────
const { readFileSync } = await import('node:fs');
const src = readFileSync(new URL('../api/room.js', import.meta.url), 'utf8');
for (const [action, limit, windowS] of [
  ['state', 300, 10], ['nudge', 200, 10], ['join', 60, 3600], ['create', 20, 3600],
]) {
  const re = new RegExp(`${action}:\\s*\\{\\s*limit:\\s*${limit},\\s*windowS:\\s*${windowS}\\s*\\}`);
  check(`RATE 表里 ${action} 还是 ${limit} 次 / ${windowS} 秒`, re.test(src));
}
check(
  'create 的限速排在 hostMayOpen 之前（不然烧 Creem 额度那条没堵上）',
  src.indexOf('RATE[body.action]') < src.indexOf('case \'create\': return await create'),
);

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

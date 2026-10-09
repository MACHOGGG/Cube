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
 *   ① 竞赛屋二十一个人满座挤在一个 IP 后面轮询一整个十秒窗口（210 次），一次都不许被挡；
 *      再翻一倍（420 次：每人多开一个标签页）也不许——10-09 补充方案 7-13 第 5 条把桶从 300
 *      放到 600 就是为了这个余量（原先 300 只够八人屋，二十一个人只剩 1.43 倍）；
 *   ② 一秒上千次的扫号，必须在六百次之内被关在门外；
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

// ── 顺手钉住：这四个桶的名字和数值就是上面这几条的依据 ──────────────────
const { readFileSync } = await import('node:fs');
const src = readFileSync(new URL('../api/room.js', import.meta.url), 'utf8');
for (const [action, limit, windowS] of [
  ['state', 600, 10], ['nudge', 200, 10], ['join', 60, 3600], ['create', 20, 3600],
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

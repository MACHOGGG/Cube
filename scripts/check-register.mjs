/**
 * 开账号 → 登录 → 终身授予，真起服务器走一遍。
 *
 *   GENIUS_GRANT_WINDOW=1 node scripts/dev-server.mjs 8993 dist &
 *   node scripts/check-register.mjs http://localhost:8993/
 *
 * ⚠️ **这道门 2026-10-02 换了被测的那条路，原因有两条，都值得记下来。**
 *
 * ── 一、它量的那条路撤了 ──────────────────────────────────────
 *
 * 原先量的是「邮箱 + 六位密码」那种注册（`api/passcode.js` 的 `signUp`）。那一支是个**抢
 * 注接口**：不要任何凭据就能在任意一个邮箱上开出账号，而且账号带着一把它自己设的密码
 * （passcode.js 末尾那段把后果写全了）。撤了之后这道门的正向断言全部失效，于是它反过来
 * 量那一支**真的关着**，正向那几条换到眼下活着的那条路上：
 *
 *   免邮箱凭据（`api/handle.js`，E38）——两串自己取的字符串，注册、登录都在那一个接口里
 *   （重设第二串 10-09 补充方案 7-8 撤了，回 410，见 ⑧）。另一条活路是邮箱验证码（`api/signin.js`），它过不来：验证码只在那封信里，而
 *   这道门不收信（那一条由 check-signin-otp.mjs 在进程内驱动，它拿得到码）。
 *
 * ── 二、它在 CI 里从来没真跑过 ────────────────────────────────
 *
 * ci.yml 里那一步起完服务器之后探的是 `/api/slots`，而那个接口随名额一起删了（E39）——于
 * 是 `curl -sf` 永远 404，等待循环空转 30 秒，后面那句硬探必败，整步在跑到这个文件之前就
 * 红了。**一条跑不起来的流水线看着像在守着，其实一行代码都没验过。** 探活改成探首页
 * （不会被删的那样东西），这个文件才第一次真的被执行。
 *
 * ── 量的是什么 ────────────────────────────────────────────────
 *
 *   ① 老的注册那一支撤了：带 `register: true` 答 400 `action`，不是悄悄落到某一支上去。
 *      改密码那一支（也撤了）同一句话。
 *   ② 免邮箱凭据：注册拿到 id 和令牌；拿同一对登录回来；第二串打错 401。
 *   ③ 窗口期里注册那一下就是天才（until 推到 LIFETIME_UNTIL）。
 *   ④ 不限人数：接着来的几个人一个都不许落空。
 *   ⑤ 第一串撞名答 409 `taken`，而且**没动**原来那个账号（旧第二串还登得上）。
 *   ⑥ 按来路限速（`pairin`，30 次/小时）：第 31 次挡下来，换个来路不受牵连。
 *   ⑦ **同一个 IPv6 /64 共用一个桶。** 家宽标配分到的是一整个 /64，换一个源地址不花一分
 *      钱——按单个地址分桶等于不限速（见 api/_ratelimit.js 的 bucketOf）。
 *   ⑧ 重设第二串撤了（10-09 补充方案 7-8）：`reset` 答 410 `gone`，旧的第二串照旧登得上。
 *   ⑨ 太常见的第一串注册不了：400 `common`（api/_commonpairs.js，大小写不敏感）。
 *
 * 每一节自带一个来路（`x-forwarded-for`），所以上面几节不会把 ⑥⑦ 的配额吃掉。
 */

const base = (process.argv[2] || '').replace(/\/+$/, '');
if (!base) {
  console.error('用法：node scripts/check-register.mjs http://localhost:8993/');
  console.error('（服务器要带 GENIUS_GRANT_WINDOW=1 起）');
  process.exit(2);
}

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const LIFETIME_UNTIL = Date.UTC(2999, 0, 1);
const stamp = Date.now().toString(36);
/** 第一串：大小写敏感的字母数字，8 到 64 位（_accounts.js 的 PAIR_RE）。 */
const first = (tag) => `Reg${tag}${stamp}`;

async function post(path, body, ip = '203.0.113.1') {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // 不是 JSON：下面的断言会把状态码和它一起摆出来。
  }
  return { status: res.status, body: json };
}

// ── ① 两条撤掉的路：答得明确，不许悄悄落到别处 ─────────────────
{
  const IP = '198.51.100.11';
  const reg = await post('/api/passcode',
    { register: true, email: `reg-old-${stamp}@example.com`, password: 'abc123' }, IP);
  check('① 老的注册那一支撤了 → 400 action',
    reg.status === 400 && reg.body?.error === 'action', `${reg.status} ${JSON.stringify(reg.body)}`);

  const chg = await post('/api/passcode',
    { email: `reg-old-${stamp}@example.com`, password: 'abc123', newPassword: 'xyz789' }, IP);
  check('① 改密码那一支也还是撤着的 → 400 action',
    chg.status === 400 && chg.body?.error === 'action', `${chg.status} ${JSON.stringify(chg.body)}`);

  // 尺子：这个接口本身没死——`bind`（内部码绑邮箱）那一支还在，拿一张不存在的码去绑，
  // 它答的是**自己那条路上的错**，不是 400 `action`。
  //
  // ⚠️ `code` 要给个**真值**：分发那一句是 `if (code)`，空串落不到 bind 上，于是这条尺子
  // 会和上面两条一样收到 400 action——看着红的是尺子，其实是尺子自己写错了。
  const bind = await post('/api/passcode',
    { code: 'NOSUCH', token: 'x', email: `bind-${stamp}@example.com`, password: 'abc123' }, IP);
  check('（尺子）接口本身还活着：bind 那一支照旧答得出自己的错',
    bind.body?.error !== 'action', `${bind.status} ${JSON.stringify(bind.body)}`);
}

// ── ②③ 注册 → 登录回来 → 窗口期就是天才 ────────────────────────
const A = first('A');
const A_SECOND = 'firstpass';
{
  const IP = '198.51.100.12';
  const made = await post('/api/handle', { action: 'register', first: A, second: A_SECOND }, IP);
  check('② 注册成了', made.status === 200 && made.body?.ok === true,
    `${made.status} ${JSON.stringify(made.body)}`);
  check('② 回了账号 id（hdl:<sha256>，第一串的原文不在回包里）',
    /^hdl:[0-9a-f]{64}$/.test(String(made.body?.id)), String(made.body?.id));
  check('② 第一串的原文不在回包里', !JSON.stringify(made.body ?? {}).includes(A));
  check('② 注册这一下就给了令牌（这台设备当场就是登着的）',
    typeof made.body?.token === 'string' && made.body.token.length > 0);
  check('③ 窗口期第一个人就是天才', made.body?.active === true, `active=${made.body?.active}`);
  check('③ 「终身」记的是那个一千年后的日子',
    (made.body?.until || 0) >= LIFETIME_UNTIL, String(made.body?.until));

  const back = await post('/api/handle', { first: A, second: A_SECOND }, IP);
  check('② 拿同一对登录回来', back.status === 200 && typeof back.body?.token === 'string',
    `${back.status}`);
  check('② 登录拿到的是**另一把**令牌，而不是把注册那把换掉',
    back.body?.token && back.body.token !== made.body?.token);
  check('② 登录回来照样是天才', back.body?.active === true, `active=${back.body?.active}`);

  // 尺子：第二串真的被当成凭据了。少了这一条，上面那句「登录回来」可能只是
  // 「这个接口对谁都发令牌」。
  const wrong = await post('/api/handle', { first: A, second: 'nottherigh' }, IP);
  check('（尺子）第二串打错进不去', wrong.status === 401,
    `${wrong.status} ${JSON.stringify(wrong.body)}`);
}

// ── ⑤ 第一串撞名：409，而且不许动原来那个账号 ───────────────────
{
  const IP = '198.51.100.13';
  const again = await post('/api/handle', { action: 'register', first: A, second: 'otherpass' }, IP);
  check('⑤ 同一个第一串再注册答 409 taken',
    again.status === 409 && again.body?.error === 'taken', `${again.status} ${JSON.stringify(again.body)}`);
  // 尺子：旧的第二串还好着——「不覆盖」必须是真的没动那份账号，而不是只回了个错。
  const still = await post('/api/handle', { first: A, second: A_SECOND }, IP);
  check('（尺子）旧的第二串还是那一个（账号没被覆盖）',
    still.status === 200 && typeof still.body?.token === 'string', String(still.status));
  // 而刚才那一串**没有**变成第二串。
  const notNew = await post('/api/handle', { first: A, second: 'otherpass' }, IP);
  check('（尺子）撞名那一次填的第二串没被写进去', notNew.status === 401, String(notNew.status));
}

// ── ④ 不限人数：接着来的几个人一个都不许落空 ────────────────────
//
// 这一节原先量的是「名额满了会怎么样」。名额撤了（E39，玩家：「不限人数」），所以反过来
// 量。为什么还值得量：撤掉计数是一次删代码，而删代码最容易留下半截——比如幂等那道短路顺
// 手也被删了（于是每次登录都重写一遍 grantedAt），或者某个判断还留着一个写死的上限。
{
  const IP = '198.51.100.14';
  for (let i = 0; i < 4; i++) {
    const who = first(`B${i}`);
    const made = await post('/api/handle', { action: 'register', first: who, second: `bulk${i}aaa` }, IP);
    check(`④ 第 ${i + 2} 个人注册成了`, made.status === 200 && made.body?.ok === true,
      `${made.status} ${JSON.stringify(made.body)}`);
    check(`④ 第 ${i + 2} 个人也是天才（没有上限了）`, made.body?.active === true,
      `active=${made.body?.active}`);
  }
}

// ── ⑥ 按来路限速：第 31 次挡下来 ────────────────────────────────
//
// 它挡的不是「猜某一个账号的第二串」（那件事由 checkPin 按账号计数管），而是**拿着一份第
// 一串的名单挨个去把别人锁掉**：对任意一个第一串连错 4 次，那个账号就锁 4 小时。见
// api/handle.js 的 PAIR_CALLS_PER_HOUR。
//
// 这一节打的都是**没人用过**的第一串，所以不会把谁的账号真锁上（loadAccount 回 null，在
// checkPin 之前就 401 了）。
{
  const IP = '198.51.100.21';
  const codes = [];
  for (let i = 0; i < 31; i++) {
    const r = await post('/api/handle', { first: `Sweep${stamp}${String(i).padStart(2, '0')}`, second: 'whatever1' }, IP);
    codes.push(r.status);
  }
  const first30 = codes.slice(0, 30);
  check('⑥ 前 30 次照常答 401（没人用过这一串）', first30.every((c) => c === 401),
    [...new Set(first30)].join(','));
  check('⑥ 第 31 次被来路限速挡下 → 429', codes[30] === 429, String(codes[30]));

  const other = await post('/api/handle', { first: `Else${stamp}0001`, second: 'whatever1' }, '198.51.100.22');
  check('⑥ 换一个来路不受牵连', other.status === 401, String(other.status));
}

// ── ⑦ 同一个 IPv6 /64 共用一个桶 ────────────────────────────────
//
// 这是 ⑥ 那道限速成不成立的前提。IPv4 时代换地址有成本（重拨、买代理），IPv6 下家宽标配
// 分到的是一整个 /64（1.8×10¹⁹ 个地址），一行 `ip -6 addr add` 就是一个全新的桶——按单个
// 地址分桶的话 ⑥ 那一节在真机上等于不存在，而它看着还在工作（日志里确实有键在涨）。
{
  const SAME_A = '2001:db8:aa:bb:1111:2222:3333:4444';
  const SAME_B = '2001:db8:aa:bb:9999:8888:7777:6666';   // 同一个 /64，后 64 位全不一样
  const OTHER_64 = '2001:db8:aa:cc:1111:2222:3333:4444'; // 第四组不同 → 另一个 /64
  const hit = async (ip, n) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const r = await post('/api/handle',
        { first: `V6${stamp}${Math.random().toString(36).slice(2, 10)}`, second: 'whatever1' }, ip);
      out.push(r.status);
    }
    return out;
  };

  const half1 = await hit(SAME_A, 16);
  check('⑦ 前 16 次（第一个地址）照常 401', half1.every((c) => c === 401), [...new Set(half1)].join(','));
  const half2 = await hit(SAME_B, 15);
  check('⑦ 换成同一个 /64 里的另一个地址，第 15 次（总第 31 次）被挡下',
    half2.slice(0, 14).every((c) => c === 401) && half2[14] === 429,
    `${[...new Set(half2.slice(0, 14))].join(',')} 然后 ${half2[14]}`);

  const elsewhere = await hit(OTHER_64, 1);
  check('⑦ 另一个 /64 不受牵连（没把所有人归进同一个桶）', elsewhere[0] === 401, String(elsewhere[0]));

  // 带方括号和端口的写法要归到同一个桶里——不剥的话每次连接一个新桶。
  const bracketed = await hit(`[${SAME_A}]:54321`, 1);
  check('⑦ `[addr]:port` 归的是同一个桶（照旧 429）', bracketed[0] === 429, String(bracketed[0]));
}

// ── ⑧⑨ 7-8：重设撤了、常见第一串注册不了 ─────────────────────────
{
  const IP = '198.51.100.31';
  const gone = await post('/api/handle', { action: 'reset', first: A, newSecond: 'takeover1' }, IP);
  check('⑧ 重设第二串 → 410 gone', gone.status === 410 && gone.body?.error === 'gone', `${gone.status} ${JSON.stringify(gone.body)}`);
  const still = await post('/api/handle', { first: A, second: A_SECOND }, IP);
  check('⑧ 旧的第二串照旧登得上（那一下什么都没改）', still.status === 200, `${still.status}`);
  const took = await post('/api/handle', { first: A, second: 'takeover1' }, IP);
  check('⑧ 想「重设」成的那一串登不进来', took.status === 401, `${took.status}`);
  const common = await post('/api/handle', { action: 'register', first: 'Password123', second: 'whatever1' }, '198.51.100.32');
  check('⑨ 常见第一串（Password123）注册不了 → 400 common', common.status === 400 && common.body?.error === 'common',
    `${common.status} ${JSON.stringify(common.body)}`);
}

console.log(fail ? `\n${fail} 条红` : '\n全绿');
process.exit(fail ? 1 : 0);

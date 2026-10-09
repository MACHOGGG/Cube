/**
 * 免邮箱凭据那条路：两串自己取的字母数字（E38）。
 *
 *   node scripts/check-handle-auth.mjs
 *
 * 不起服务器、不开浏览器：直接 import `api/handle.js` 的 handler，账号库用进程内那份
 * （ALLOW_MEMORY_STORE=1）。
 *
 * ── 量的是什么 ────────────────────────────────────────────────
 *
 * ① **大小写真的分得开。** `'Kqz48271'` / `'kqz48271'` / `'KQZ48271'` 必须建出**三个不
 *    同的账号**（原先拿的是 `Abc12345` 那一组——7-8 起 `abc12345` 在常见串表里，注册被拒）。这一条是整条路最要紧的：`normalizeEmail` 会 `.toLowerCase()`，而
 *    `accountKey`、`acctLockKey`、`identify` 全走它——第一串直接当 id 的话这三串当场撞成
 *    同一个 key，而界面上明写着「区分大小写」。解法是 sha256（`pairKey`）。
 * ② 第一串重复 → 409 `taken`。这一句是故意要说的（玩家必须换一串才走得下去），也正是
 *    「第一串可被枚举」那个代价的来处，代码里写明了。
 * ③ 两串对上能登录；第二串错 **4 次锁 4 小时**。
 * ④ **免邮箱账号不会被封号。** 封号（BLOCK_AFTER）是一道只有「拿邮箱证明自己」才解得
 *    开的门（api/unlock.js），而这种账号没有邮箱。`checkPin` 的 `block: false`。
 * ⑤ **没有「重设第二串」了**（10-09 补充方案 7-8）：`reset` 回 410，账号一个字都没动，旧的
 *    第二串照旧好使。原先这一条量的是「reset 之后别的设备掉线」——那一支只凭第一串就能重设，
 *    而第一串可以被挨个试出来，所以撤了。
 * ⑥ **库里找不到第一串的明文。** 服务端不需要还原它（排行榜回包不含 member、后台名单不
 *    收非邮箱账号、界面显示用客户端自己存的那份），所以不该以可还原的形式存着。
 * ⑦ **绑定邮箱**（7-8 给的退路，api/email.js）：码寄到那个邮箱、输对之后，战绩、存档、昵称（连
 *    nickidx）、榜上的位置都在 `acct:<邮箱>` 底下；旧的 `hdl:` 那一份拆了，两串再也登不进来；
 *    这台设备手里的令牌照旧好使；第二串的哈希抹掉了、邮箱记成验过的——之后拿验证码登录不会被当
 *    成抢注把设备全踢下线（signin.js 的 claimed，这一条端到端走一遍）。
 * ⑧ **邮箱上已经有账号：拒绝绑定**（409 taken），两边一个字都不动。
 * ⑨ **太常见的第一串注册不了**（400 common，大小写不敏感）；已经用着常见第一串的老账号照样登得
 *    进来（只挡注册）。
 *
 * 每条旁边配尺子或反面尺子。
 */
process.env.ALLOW_MEMORY_STORE = '1';
process.env.GENIUS_GRANT_WINDOW = '1';
// ⑦ 绑定邮箱要寄一封码：Resend 用一个假 fetch 顶掉，顺便把码从那封假邮件里读出来。
process.env.RESEND_API_KEY = 're_stub';
process.env.MAIL_FROM = 'Slides <noreply@example.com>';
const mails = [];
globalThis.fetch = async (url, init) => {
  if (!String(url).includes('api.resend.com')) throw new Error('unexpected fetch: ' + url);
  const body = JSON.parse(init.body);
  mails.push({ to: body.to[0], text: body.text });
  return { ok: true, status: 200, json: async () => ({ id: 'stub' }) };
};
const codeFor = (to) => ([...mails].reverse().find((m) => m.to === to)?.text.match(/\b(\d{6})\b/) || [])[1] ?? null;

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const { default: handle } = await import('../api/handle.js');
const { loadAccount, pairKey, tokenValid, PAIR_KEY_RE } = await import('../api/_accounts.js');

let fromIp = '10.1.0.1';
const freshIp = () => { fromIp = `10.1.${Math.floor(Math.random() * 1e6)}.1`; };
async function call(body) {
  const out = { code: 0, payload: null };
  await handle(
    { method: 'POST', body, headers: { 'x-vercel-forwarded-for': fromIp } },
    {
      status(c) { out.code = c; return this; },
      setHeader() {},
      end(t) { out.payload = JSON.parse(t); },
    },
  );
  return { status: out.code, body: out.payload };
}
const register = (first, second) => call({ action: 'register', first, second });
const signin = (first, second) => call({ first, second });
const reset = (first, newSecond) => call({ action: 'reset', first, newSecond });
const { default: emailApi } = await import('../api/email.js');
async function callEmail(body) {
  const out = { code: 0, payload: null };
  await emailApi(
    { method: 'POST', body, headers: { 'x-vercel-forwarded-for': fromIp } },
    {
      status(c) { out.code = c; return this; },
      setHeader() {},
      end(t) { out.payload = JSON.parse(t); },
    },
  );
  return { status: out.code, body: out.payload };
}

// ── ① 大小写分得开 ────────────────────────────────────────────
{
  freshIp();
  const THREE = ['Kqz48271', 'kqz48271', 'KQZ48271'];
  const made = [];
  for (const first of THREE) made.push(await register(first, 'secret88'));
  check('① 三种大小写都注册成了（没有一个撞成 409）',
    made.every((m) => m.status === 200), made.map((m) => `${m.status}:${m.body?.error ?? ''}`).join(' '));
  const ids = made.map((m) => m.body?.id);
  check('① 建出来的是三个不同的 id', new Set(ids).size === 3, ids.map((i) => String(i).slice(0, 14)).join(' '));
  check('（尺子）id 的形状是 hdl: 加 64 位 hex', ids.every((i) => PAIR_KEY_RE.test(i)), String(ids[0]));
  // 反面尺子：如果哪天有人把 pairKey 改成「原样当 id」，上面那条会红——这儿先确认
  // 「原样当 id」真的会撞，不然上面那条就是在量一件本来不会错的事。
  const { normalizeEmail } = await import('../api/_accounts.js');
  check('（反面尺子）原样当 id 的话三串确实会撞成一个',
    new Set(THREE.map(normalizeEmail)).size === 1, THREE.map(normalizeEmail).join(' '));

  // 三个账号各自登得进去，而且**不互通**：用 A 的第一串配 A 的第二串才行。
  const a = await signin('Kqz48271', 'secret88');
  check('① 第一个登得进去', a.status === 200 && typeof a.body?.token === 'string', String(a.status));
  check('① 它拿到的 id 就是注册时那一个', a.body?.id === ids[0]);
}

// ── ② 第一串重复 → 409 ────────────────────────────────────────
{
  freshIp();
  const again = await register('Kqz48271', 'different9');
  check('② 第一串已被占用 → 409 taken', again.status === 409 && again.body?.error === 'taken', JSON.stringify(again.body));
  // 尺子：被占那个账号没被动过——第二串还是原来的那一个。
  const still = await signin('Kqz48271', 'secret88');
  check('（尺子）原账号没被覆盖（旧的第二串还好使）', still.status === 200);
  const wrongNew = await signin('Kqz48271', 'different9');
  check('（尺子）撞名那次填的第二串没生效', wrongNew.status === 401, String(wrongNew.status));
}

// ── 两串的形状 ────────────────────────────────────────────────
{
  freshIp();
  const short = await register('abc1234', 'secret88');
  check('第一串只有 7 位 → 400 badPair', short.status === 400 && short.body?.error === 'badPair', JSON.stringify(short.body));
  const sym = await register('abc-1234', 'secret88');
  check('第一串带符号 → 400 badPair', sym.status === 400 && sym.body?.error === 'badPair');
  const short2 = await register('goodone1', 'short7');
  check('第二串只有 6 位 → 400 badPair', short2.status === 400 && short2.body?.error === 'badPair');
}

// ── ③④ 错 4 次锁住，但永远不封号 ──────────────────────────────
{
  freshIp();
  const FIRST = 'LockMe123';
  await register(FIRST, 'realpass9');
  const verdicts = [];
  for (let i = 0; i < 8; i++) {
    const r = await signin(FIRST, 'wrongpass');
    verdicts.push(`${r.status}${r.body?.error === 'locked' ? 'L' : ''}`);
  }
  check('③ 前 3 次 401，第 4 次起 423 locked', verdicts.join(' ') === '401 401 401 423L 423L 423L 423L 423L', verdicts.join(' '));

  const account = await loadAccount(pairKey(FIRST));
  check('④ 错了 8 次也没被封号（blocked 还是 false）', account.blocked === false, String(account.blocked));
  check('（尺子）但确实被锁住了（lockUntil 在将来）', (account.lockUntil || 0) > Date.now(), String(account.lockUntil));
  // 4 而不是 8：锁上之后 `checkPin` 第一句就 return 'locked'，**连计数都不走**
  // （`if (account.lockUntil > now)`）。所以锁住期间再怎么试，这个数都不动——这是对的，
  // 也顺带说明了封号为什么要有耐心（见下面那条反面尺子）。
  check('（尺子）错误次数真的记下来了（不是一次都没数）', (account.fails || 0) >= 4, String(account.fails));

  /*
   * 反面尺子：同一组输入，**只差 block 这一个开关**。
   *
   * ⚠️ 要先把 `lockUntil` 清掉再试下一次，否则永远走不到封号那一档：锁着的时候
   * `checkPin` 第一句就返回 'locked'，`tries` 根本不往上走。真实世界里那就是「等 4 小时
   * 锁自己开了再来一次」——封号需要耐心，不是连着点八下就能撞到的。第一版没清，于是这
   * 条对照答了 'locked'，看着像「这个仓库压根不会封号」。
   */
  const { checkPin, newAccount, saveAccount } = await import('../api/_accounts.js');
  const hammer = async (id, opts) => {
    const probe = newAccount('realpass9', 'code');
    await saveAccount(id, probe);
    let last = '';
    for (let i = 0; i < 8; i++) {
      probe.lockUntil = 0;           // 「4 小时过去了」
      last = await checkPin(id, 'wrongpass', probe, opts);
    }
    return { last, probe };
  };
  const on = await hammer('hdl:probe-block-on', undefined);
  check('（反面尺子）block 开着（默认）：同样的输入会封号', on.last === 'blocked', on.last);
  check('（反面尺子）而且旗子真的立上了', on.probe.blocked === true, String(on.probe.blocked));
  const off = await hammer('hdl:probe-block-off', { block: false });
  check('④ block 关着（免邮箱那条路）：同样的输入只到 locked', off.last === 'locked', off.last);
  check('④ 旗子一次都没立', off.probe.blocked === false, String(off.probe.blocked));
}

// ── ⑤ 没有「重设第二串」了：reset 回 410，账号一个字都没动 ──────────────────
{
  freshIp();
  const FIRST = 'ResetMe12';
  const made = await register(FIRST, 'firstpass');
  const before = JSON.stringify(await loadAccount(pairKey(FIRST)));
  const r = await reset(FIRST, 'secondpas');
  check('⑤ reset → 410 gone（这条路不在了，不是「两串对不上」）', r.status === 410 && r.body?.error === 'gone', JSON.stringify(r));
  check('⑤ 账号一个字都没动', JSON.stringify(await loadAccount(pairKey(FIRST))) === before);
  check('⑤ 旧的第二串照旧好使', (await signin(FIRST, 'firstpass')).status === 200);
  check('⑤ 想「重设」成的那一串登不进来', (await signin(FIRST, 'secondpas')).status === 401);
  const acc = await loadAccount(pairKey(FIRST));
  check('⑤ 注册时那把令牌照旧好使（没人能借「重设」把别的设备踢下线）', tokenValid(acc, made.body.token));
  // 锁着的账号也不会被「重设」解开——第一串不是钥匙了，等锁自己开。
  freshIp();
  const LOCKED = 'LockThen1';
  await register(LOCKED, 'realpass9');
  for (let i = 0; i < 5; i++) await signin(LOCKED, 'wrongpass');
  check('（尺子）先把它锁上', (await signin(LOCKED, 'realpass9')).status === 423);
  await reset(LOCKED, 'brandnew9');
  check('⑤ reset 解不开锁（照旧 423）', (await signin(LOCKED, 'realpass9')).status === 423);
}

// ── ⑥ 库里找不到第一串的明文 ──────────────────────────────────
{
  const { dumpMemory } = await import('../api/_store.js').then((m) => ({ dumpMemory: m.dumpMemory }));
  const FIRST = 'SecretKey1';
  freshIp();
  await register(FIRST, 'secret99x');
  // 没有 dumpMemory 这个导出就自己翻：把能读到的键值全序列化一遍找那一串。
  const all = dumpMemory ? JSON.stringify(dumpMemory()) : null;
  if (all === null) {
    // 退一步也要量得出东西：账号那一份里不许有第一串。
    const acc = await loadAccount(pairKey(FIRST));
    check('⑥ 账号那一份里找不到第一串的明文', !JSON.stringify(acc).includes(FIRST), JSON.stringify(acc).slice(0, 120));
    check('（尺子）读得到那份账号（不是因为读空了才找不到）', Boolean(acc?.hash));
  } else {
    check('⑥ 整个库里找不到第一串的明文', !all.includes(FIRST));
    check('（尺子）库里确实有这个账号（不是因为库是空的）', all.includes(pairKey(FIRST)));
  }
}

// ── ⑦⑧ 绑定邮箱：整个账号搬到 acct:<邮箱> 底下，两串作废；邮箱已占用的不绑 ────────────
{
  const { get, set, hget } = await import('../api/_store.js');
  const { registerNickname, NAMES, NICK_INDEX, nickKey } = await import('../api/_nickname.js');
  const { saveAccount, newAccount, hasSecret } = await import('../api/_accounts.js');
  freshIp();
  const FIRST = 'BindMe2026x';
  const SECOND = 'mysecret77';
  const made = await register(FIRST, SECOND);
  const id = made.body?.id;
  const token = made.body?.token;
  check('（尺子）免邮箱账号开出来了', made.status === 200 && PAIR_KEY_RE.test(String(id)) && Boolean(token), JSON.stringify(made.body).slice(0, 80));
  // 战绩、存档、昵称、榜上的位置——和真打出来的一样摆进去（scores.js 存的就是这几样）。
  await set('stats:' + id, { total: 777, runs: 2, best: { square: 777 }, seen: [] });
  await set('runs:' + id, [{ score: 777 }, { score: 120 }]);
  const named = await registerNickname(id, '绑邮箱的人');
  check('（尺子）昵称登记上了', named === 'ok', named);
  const { zadd, zscore } = await import('../api/_store.js');
  await zadd('lb:square', 777, id);

  const MAIL = 'bound-here@example.com';
  const asked = await callEmail({ email: id, token, newEmail: MAIL, lang: 'zhHans' });
  check('⑦ 免邮箱账号能要绑定码（「现在这个地址」认 hdl: 那把 id）', asked.status === 200 && asked.body?.sent === true, JSON.stringify(asked));
  const code = codeFor(MAIL);
  check('⑦ 码寄到了要绑的那个邮箱', /^\d{6}$/.test(String(code)), String(code));
  const wrong = await callEmail({ action: 'confirm', email: id, token, newEmail: MAIL, code: code === '000000' ? '111111' : '000000' });
  check('（尺子）码不对：不绑', wrong.status === 401 && wrong.body?.error === 'wrongCode', JSON.stringify(wrong));
  const done = await callEmail({ action: 'confirm', email: id, token, newEmail: MAIL, code });
  check('⑦ 码对上：绑好了，回的是新地址和这台设备手里那把令牌', done.status === 200 && done.body?.moved === true && done.body?.email === MAIL && done.body?.token === token,
    JSON.stringify(done));
  const acc = await loadAccount(MAIL);
  check('⑦ 账号在 acct:<邮箱> 底下了', Boolean(acc));
  check('⑦ 旧的 hdl: 那一份拆了', !(await loadAccount(id)));
  check('⑦ 这台设备的令牌在新账号上照旧好使', tokenValid(acc, token));
  check('⑦ 第二串的哈希抹掉了（两串不再是凭据）', acc && !hasSecret(acc));
  check('⑦ 邮箱记成验过的（之后拿验证码登录不会被当成抢注）', (acc?.emailVerifiedAt || 0) > 0, String(acc?.emailVerifiedAt));
  check('⑦ 战绩搬过来了', (await get('stats:' + MAIL))?.total === 777, JSON.stringify(await get('stats:' + MAIL)));
  check('⑦ 存档搬过来了', (await get('runs:' + MAIL))?.length === 2);
  check('⑦ 旧 id 底下的战绩和存档清掉了', !(await get('stats:' + id)) && !(await get('runs:' + id)));
  check('⑦ 昵称跟过来了', (await hget(NAMES, MAIL))?.name === '绑邮箱的人', JSON.stringify(await hget(NAMES, MAIL)));
  check('⑦ 昵称索引（nickidx）指向新账号', (await hget(NICK_INDEX, nickKey('绑邮箱的人'))) === MAIL, String(await hget(NICK_INDEX, nickKey('绑邮箱的人'))));
  check('⑦ 旧 id 的昵称那一行没了', !(await hget(NAMES, id)));
  check('⑦ 榜上的位置跟过来了', (await zscore('lb:square', MAIL)) !== null && (await zscore('lb:square', id)) === null);
  const again = await signin(FIRST, SECOND);
  check('⑦ 两串再也登不进来', again.status === 401, JSON.stringify(again));
  // 端到端：绑好之后在另一台设备上拿邮箱验证码登录一次（api/signin.js）。这台设备原来那把令牌不许
  // 被踢掉——没记 emailVerifiedAt、身上又挂着第二串的哈希的话，signin.js 会把它当成被抢注的账号，
  // 清凭据、作废所有令牌（claimed 那一段）。
  const { default: signinApi } = await import('../api/signin.js');
  const otp = async (body) => {
    const out = { code: 0, payload: null };
    await signinApi(
      { method: 'POST', body, headers: { 'x-vercel-forwarded-for': fromIp } },
      { status(c) { out.code = c; return this; }, setHeader() {}, end(t) { out.payload = JSON.parse(t); } },
    );
    return { status: out.code, body: out.payload };
  };
  const ask = await otp({ email: MAIL, lang: 'zhHans' });
  const otpCode = codeFor(MAIL);
  const viaMail = await otp({ action: 'confirm', email: MAIL, code: otpCode, challenge: ask.body?.challenge });
  check('⑦ 绑好之后拿邮箱验证码登得进来', viaMail.status === 200 && Boolean(viaMail.body?.token) && viaMail.body?.created !== true,
    `${viaMail.status} created=${viaMail.body?.created}`);
  const after = await loadAccount(MAIL);
  check('⑦ 登录那一下没有把绑定那台设备踢下线（不被当成抢注）', tokenValid(after, token) && tokenValid(after, viaMail.body?.token));

  // ⑧ 邮箱上已经有账号：拒绝（不合并）。
  freshIp();
  const OTHER = 'BindMe2027y';
  const other = await register(OTHER, 'othersecret');
  const TAKEN = 'already-here@example.com';
  await saveAccount(TAKEN, newAccount('', 'code'));
  const takenBefore = JSON.stringify(await loadAccount(TAKEN));
  const refused = await callEmail({ email: other.body.id, token: other.body.token, newEmail: TAKEN, lang: 'en' });
  check('⑧ 邮箱上已经有账号：要码那一步就 409 taken', refused.status === 409 && refused.body?.error === 'taken', JSON.stringify(refused));
  check('⑧ 那个邮箱上的账号一个字没动', JSON.stringify(await loadAccount(TAKEN)) === takenBefore);
  check('⑧ 免邮箱账号还在，两串照旧登得进来', (await signin(OTHER, 'othersecret')).status === 200);
  // 换邮箱那条路照旧只认令牌：拿不对的令牌要码，401。
  const noAuth = await callEmail({ email: other.body.id, token: 'not-a-token', newEmail: 'x-free@example.com', lang: 'en' });
  check('（尺子）令牌不对：401（hdl: 放行的只是「地址的形状」，人照旧要认）', noAuth.status === 401, JSON.stringify(noAuth));
}

// ── ⑨ 太常见的第一串注册不了 ────────────────────────────────────────
{
  const { COMMON_FIRST_COUNT } = await import('../api/_commonpairs.js');
  check('（尺子）常见串表有几百条（不是空表）', COMMON_FIRST_COUNT >= 200, String(COMMON_FIRST_COUNT));
  freshIp();
  for (const first of ['12345678', 'Password1', 'ABCD1234', 'qwertyuiop', 'woaini1314']) {
    const r = await register(first, 'anysecret9');
    check(`⑨ 「${first}」→ 400 common（大小写不敏感）`, r.status === 400 && r.body?.error === 'common', JSON.stringify(r.body));
  }
  check('（尺子）不常见的照样注册得了', (await register('Zq7Wm4Lp', 'anysecret9')).status === 200);
  // 已经用着常见第一串的老账号：照样登得进来（只挡注册）。直接摆一份「7-8 之前注册的」账号。
  const { saveAccount, newAccount } = await import('../api/_accounts.js');
  await saveAccount(pairKey('abcd1234'), newAccount('oldsecret9', 'code'));
  check('⑨ 老账号的第一串就算在表里，照样登得进来', (await signin('abcd1234', 'oldsecret9')).status === 200);
}

console.log(fail ? `\n${fail} 条红` : '\n全绿');
process.exit(fail ? 1 : 0);

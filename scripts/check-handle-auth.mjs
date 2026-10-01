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
 * ① **大小写真的分得开。** `'Abc12345'` / `'abc12345'` / `'ABC12345'` 必须建出**三个不
 *    同的账号**。这一条是整条路最要紧的：`normalizeEmail` 会 `.toLowerCase()`，而
 *    `accountKey`、`acctLockKey`、`identify` 全走它——第一串直接当 id 的话这三串当场撞成
 *    同一个 key，而界面上明写着「区分大小写」。解法是 sha256（`pairKey`）。
 * ② 第一串重复 → 409 `taken`。这一句是故意要说的（玩家必须换一串才走得下去），也正是
 *    「第一串可被枚举」那个代价的来处，代码里写明了。
 * ③ 两串对上能登录；第二串错 **4 次锁 4 小时**。
 * ④ **免邮箱账号不会被封号。** 封号（BLOCK_AFTER）是一道只有「拿邮箱证明自己」才解得
 *    开的门（api/unlock.js），而这种账号没有邮箱。`checkPin` 的 `block: false`。
 * ⑤ `reset` 之后别的设备令牌失效——这条路谁都走得通（只要知道第一串），所以原主人掉线
 *    是他唯一能察觉的信号。
 * ⑥ **库里找不到第一串的明文。** 服务端不需要还原它（排行榜回包不含 member、后台名单不
 *    收非邮箱账号、界面显示用客户端自己存的那份），所以不该以可还原的形式存着。
 *
 * 每条旁边配尺子或反面尺子。
 */
process.env.ALLOW_MEMORY_STORE = '1';
process.env.GENIUS_GRANT_WINDOW = '1';

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

// ── ① 大小写分得开 ────────────────────────────────────────────
{
  freshIp();
  const THREE = ['Abc12345', 'abc12345', 'ABC12345'];
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
  const a = await signin('Abc12345', 'secret88');
  check('① 第一个登得进去', a.status === 200 && typeof a.body?.token === 'string', String(a.status));
  check('① 它拿到的 id 就是注册时那一个', a.body?.id === ids[0]);
}

// ── ② 第一串重复 → 409 ────────────────────────────────────────
{
  freshIp();
  const again = await register('Abc12345', 'different9');
  check('② 第一串已被占用 → 409 taken', again.status === 409 && again.body?.error === 'taken', JSON.stringify(again.body));
  // 尺子：被占那个账号没被动过——第二串还是原来的那一个。
  const still = await signin('Abc12345', 'secret88');
  check('（尺子）原账号没被覆盖（旧的第二串还好使）', still.status === 200);
  const wrongNew = await signin('Abc12345', 'different9');
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

// ── ⑤ reset 之后别的设备掉线 ──────────────────────────────────
{
  freshIp();
  const FIRST = 'ResetMe12';
  const made = await register(FIRST, 'firstpass');
  const other = await signin(FIRST, 'firstpass');
  check('（尺子）两台设备各一把令牌', made.body.token !== other.body.token);
  const acc0 = await loadAccount(pairKey(FIRST));
  check('（尺子）reset 之前两把都好使',
    tokenValid(acc0, made.body.token) && tokenValid(acc0, other.body.token));

  const done = await reset(FIRST, 'secondpas');
  check('⑤ reset 成了，拿到一把新令牌', done.status === 200 && typeof done.body?.token === 'string', String(done.status));
  const acc1 = await loadAccount(pairKey(FIRST));
  check('⑤ 之前那两把令牌全失效了（别的设备掉线，原主人能察觉）',
    !tokenValid(acc1, made.body.token) && !tokenValid(acc1, other.body.token));
  check('⑤ 新那一把好使', tokenValid(acc1, done.body.token));

  const oldPw = await signin(FIRST, 'firstpass');
  check('⑤ 旧的第二串不好使了', oldPw.status === 401, String(oldPw.status));
  const newPw = await signin(FIRST, 'secondpas');
  check('⑤ 新的第二串好使', newPw.status === 200, String(newPw.status));

  // reset 也该把锁一起开掉——他刚证明过自己握着第一串。
  freshIp();
  const LOCKED = 'LockThen1';
  await register(LOCKED, 'realpass9');
  for (let i = 0; i < 5; i++) await signin(LOCKED, 'wrongpass');
  check('（尺子）先把它锁上', (await signin(LOCKED, 'realpass9')).status === 423);
  await reset(LOCKED, 'brandnew9');
  check('⑤ reset 把锁一起开掉了', (await signin(LOCKED, 'brandnew9')).status === 200);
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

console.log(fail ? `\n${fail} 条红` : '\n全绿');
process.exit(fail ? 1 : 0);

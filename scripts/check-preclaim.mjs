/**
 * 抢注：别人先用你的邮箱开了账号，而你一个字都看不出来。
 *
 *   node scripts/check-preclaim.mjs
 *
 * ── 这是什么攻击 ──────────────────────────────────────────────
 *
 * 旧的 `api/passcode.js` 有一支 `register: true`：**不要任何凭据**，拿任意邮箱加一个自选
 * 密码就开得出账号，而开出来的账号带着一把它自己设的密码和一把它自己的令牌。`bind` 那一支
 * 也类似：手里有一张内部码的令牌，就能把它绑到任意一个邮箱上并设一把密码。两条路都只证明
 * 了「我有某样东西」，**没有**证明「这个邮箱是我的」——而邮箱是公开的（CLAUDE.md：「邮箱
 * 地址本身不是证据。它印在收据上，谁都知道得到」）。
 *
 * 于是：
 *
 *   ① 外人拿 `victim@…` 注册一遍，密码是他设的，令牌他收着。
 *   ② 真正的主人将来用验证码登录。那个地址上已经有账号了，从前这一步只是「添一把令牌」。
 *   ③ 两个人从此都进得去：主人凭验证码，外人凭他那把密码和一直没作废的令牌。云端战绩、排
 *      行榜上的名字、后台寄进来的内部码，他全看得到、全改得了。
 *
 * **屏幕上一个字都不报。** 主人登进去看到的是一个空账号（他本来也以为是新的），外人那一头
 * 更安静。这正是这个仓库最怕的那种毛病——看着一切正常。
 *
 * 2026-10-02 两头一起堵：注册那一支撤了（passcode.js 末尾那段），而**已经被抢注的地址**
 * 靠 `api/signin.js` 的 confirm 收场——第一次验成功时把旧凭据整个清掉。
 *
 * ── 这道门怎么保证自己不是空绿 ────────────────────────────────
 *
 * 清理这件事两个方向都会出错，而且两边的症状完全相反，所以每一条断言都有一条反着的在盯：
 *
 *   把 api/signin.js 这样改坏                        这道门要红在
 *   ─────────────────────────────────────────────  ───────────
 *   压根不清（`if (false)`）                          ③
 *   只看 hasSecret（于是每次有密码就清）              ⑦′
 *   只看 emailVerifiedAt（于是见人就清）              ⑥
 *   不写 emailVerifiedAt                              ③⑥
 *   新账号不盖那一位                                  ⑤
 *   清理时只作废令牌、不抹密码                        ③
 *   清理时只抹密码、不作废令牌                        ③
 *   清理之后不清那个失败计数键                        ③
 *   抢不到锁时把码删掉                                ⑦
 *   回包里把 created 一律说成 true                    ②
 *
 * 十条都真的试过一遍（改坏源码、跑这道门、恢复），每一条都如上红。
 *
 * ⚠️ 「只看 hasSecret」那一条曾经漏过，而且漏得很隐蔽：清理那一下会把密码抹成空串，于是
 * `hasSecret` 从此为假——单看 `hasSecret` 在**绝大多数**路径上和两条合起来一模一样，③④⑤⑥
 * 会全绿。真正分得开它们的只有一条路：`api/_unlock_legacy.js` 的 confirm 会给一个**已经验过**的账号
 * 重新设一把密码（而那条路自己就要收一张寄到这个地址的码，所以设密码的人就是本人）。⑦′ 专
 * 门走它。少了 ⑦′ 的话，这道门对那种写法是**空绿**的。
 *
 * 不起服务器、不连 Redis、不真发信：库用进程内的那份，Resend 用一个假 fetch 顶掉——顺便把
 * 验证码从那封假邮件里读出来。
 */
process.env.ALLOW_MEMORY_STORE = '1';
process.env.RESEND_API_KEY = 're_stub';
process.env.MAIL_FROM = 'Slides <noreply@example.com>';
/*
 * 显式清掉授予开关（照 check-account-hub 那一条）：窗口一开，每次登录都会把账号写成终身天
 * 才，`until` 一变，下面那几条「账号没被动过」的尺子就分不清是谁改的了。
 */
delete process.env.GENIUS_GRANT_WINDOW;

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

let sentCode = null;
let mails = 0;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('api.resend.com')) {
    mails++;
    sentCode = (JSON.parse(init.body).text.match(/\b(\d{6})\b/) || [])[1] ?? null;
    return { ok: true, status: 200, json: async () => ({ id: 'stub' }) };
  }
  throw new Error('unexpected fetch: ' + u);
};

const signin = (await import('../api/signin.js')).default;
const subscription = (await import('../api/subscription.js')).default;
const A = await import('../api/_accounts.js');
const { bump, setnx, get, del } = await import('../api/_store.js');

const callOn = async (handler, body, ip = '203.0.113.1') => {
  let status = 0;
  let text = '';
  const res = {
    status: (c) => ((status = c), res),
    setHeader: () => res,
    end: (t) => ((text = t), res),
  };
  await handler({ method: 'POST', headers: { 'x-forwarded-for': ip }, body }, res);
  return { status, raw: text || '{}', body: JSON.parse(text || '{}') };
};

/**
 * 要一张码，然后把它打进去。返回 confirm 那一趟的回包。
 *
 * ⚠️ 要码那一趟会回一张**票**（`challenge`，2026-10-02 起），码存在那张票底下，交码时要原
 * 样递回去——见 api/signin.js 顶上那段。这道门不关心票本身（那是
 * `check-signin-challenge.mjs` 的事），只负责一路把它带着。
 */
async function otpSignIn(email, ip = '203.0.113.1') {
  sentCode = null;
  const asked = await callOn(signin, { email }, ip);
  if (asked.status !== 200) throw new Error(`要码失败 ${asked.status} ${asked.raw}`);
  if (!sentCode) throw new Error('假邮件里没读出码');
  const challenge = String(asked.body.challenge ?? '');
  if (!/^[0-9a-f]{16}$/.test(challenge)) throw new Error('要码没回票：' + asked.raw);
  return callOn(signin, { action: 'confirm', email, code: sentCode, challenge }, ip);
}

// ── ①② 被抢注的地址：主人第一次验成功 ──────────────────────────
const VICTIM = 'victim@example.com';
const ATTACK_PW = 'atk999';
const ATTACK_TOKEN = 'ATTACKER-DEVICE-TOKEN';
{
  // ① 外人开出来的那份账号，和旧 passcode.js 的 signUp 写出来的一模一样：一把自选密码、
  //    一把自己的令牌、**没有** emailVerifiedAt（他从没证明过这个地址是他的）。
  const planted = A.newAccount(ATTACK_PW, 'code');
  planted.tokens = [{ t: ATTACK_TOKEN, at: Date.now() }];
  planted.token = ATTACK_TOKEN;
  await A.createAccount(VICTIM, planted);
  check('（尺子）抢注那份账号真的种下去了，而且身上有一把密码',
    A.hasSecret(await A.loadAccount(VICTIM)) && !(await A.loadAccount(VICTIM)).emailVerifiedAt);
  // 再给它攒两次「输错」——有人（抢注的那个，或者主人自己）试过这把密码。那个计数不在账号
  // 里，是单独一个 Redis 键（_accounts.js 的 failKey）。
  await bump('pinfail:' + VICTIM, 86400);
  await bump('pinfail:' + VICTIM, 86400);
  check('（尺子）失败计数真的攒上了', Number(await get('pinfail:' + VICTIM)) === 2,
    String(await get('pinfail:' + VICTIM)));
  const before = await callOn(subscription, { email: VICTIM, token: ATTACK_TOKEN }, '198.51.100.1');
  check('（尺子）清理之前，外人那把令牌是**真的**能用的（否则下面 ③ 是空绿）',
    before.status === 200, `${before.status} ${before.raw}`);

  // ② 主人用验证码登录。
  const mine = await otpSignIn(VICTIM, '198.51.100.2');
  check('② 主人登得进去', mine.status === 200 && typeof mine.body.token === 'string',
    `${mine.status} ${mine.raw}`);
  check('② 服务端如实说这不是新账号（界面据此不再问「要不要收更新邮件」）',
    mine.body.created === false, `created=${mine.body.created}`);
  const myToken = mine.body.token;

  // ③ 外人手里那两样都废了。
  const stored = await A.loadAccount(VICTIM);
  check('③ 外人那把令牌作废了', !A.tokenValid(stored, ATTACK_TOKEN));
  const asAttacker = await callOn(subscription, { email: VICTIM, token: ATTACK_TOKEN }, '198.51.100.3');
  check('③ 拿它去问权益：401', asAttacker.status === 401, `${asAttacker.status} ${asAttacker.raw}`);
  check('③ 外人那把密码也抹掉了（账号上不再有任何一把密码）', !A.hasSecret(stored));
  check('③ 拿那把密码走登录接口也进不去（那一支本来也撤了）',
    (await callOn(subscription, { email: VICTIM, password: ATTACK_PW }, '198.51.100.4')).status === 401);
  check('③ 账号身上记下了「这个地址证明过自己了」', Number(stored.emailVerifiedAt) > 0,
    String(stored.emailVerifiedAt));
  check('③ 顺手把锁和封都解掉了（抢注的人可以先把它锁上，那就成了拒绝服务）',
    stored.blocked !== true && !(stored.lockUntil > 0));
  /*
   * 那个单独的失败计数键也要清掉。
   *
   * 这一条是白盒的（直接读 `pinfail:<邮箱>`），因为今天它**没有读者**：`checkPin` 眼下唯一
   * 的调用方是 `api/handle.js`，而那边的 id 是 `hdl:<sha256>`，不是邮箱。既然没人读，为什么
   * 还清、还要钉住？——哪天邮箱这一侧又冒出一条「拿某样可猜的东西来验」的路（它冒出过两
   * 次了），一个没清的旧计数会让主人**第一次手误就被锁四小时**，而屏幕上只写「锁了，4 小时
   * 后再试」。清理这件事的意思是「这个账号的凭据状态归零」，账号里那份 fails 和这个键是同一
   * 件事的两半，只清一半就是留了一颗哑弹。handle.js 的 reset 和 _unlock_legacy.js 都是这么做的。
   */
  check('③ 那个单独的「错了几次」计数键也清掉了', !(await get('pinfail:' + VICTIM)),
    String(await get('pinfail:' + VICTIM)));

  // 主人那把是好的——这一条是 ③ 的尺子：清理不许把主人也一起清掉。
  const asOwner = await callOn(subscription, { email: VICTIM, token: myToken }, '198.51.100.5');
  check('③（尺子）主人刚拿到的那把令牌好使', asOwner.status === 200 && asOwner.body.email === VICTIM,
    `${asOwner.status} ${asOwner.raw}`);

  // ── ④ 再登一次：这一回**不许**踢掉第一台 ──────────────────────
  const second = await otpSignIn(VICTIM, '198.51.100.6');
  check('④ 第二台设备也登得进来', second.status === 200 && Boolean(second.body.token));
  const after2 = await A.loadAccount(VICTIM);
  check('④ 第一台那把令牌还在（清理只发生一次，靠的是 emailVerifiedAt）',
    A.tokenValid(after2, myToken));
  check('④ 第二台那把也在（两台各拿各的）', A.tokenValid(after2, second.body.token));
  check('④ 两把不是同一把', myToken !== second.body.token);
  check('④ emailVerifiedAt 没被刷新（它记的是「第一次」）',
    after2.emailVerifiedAt === stored.emailVerifiedAt);
}

// ── ⑤ 全新的地址：一出生就带着那一位 ───────────────────────────
{
  const FRESH = 'fresh@example.com';
  const made = await otpSignIn(FRESH, '198.51.100.7');
  check('⑤ 新地址：账号当场开出来', made.status === 200 && made.body.created === true,
    `${made.status} ${made.raw}`);
  const acct = await A.loadAccount(FRESH);
  check('⑤ 一出生就有 emailVerifiedAt（这张码就是证明）', Number(acct.emailVerifiedAt) > 0);
  check('⑤ 身上没有任何一把密码', !A.hasSecret(acct));
  check('⑤ 回包里那把令牌就是账号上那一把（没有多发一把）',
    A.tokenValid(acct, made.body.token) && acct.tokens.length === 1, `${acct.tokens.length} 把`);
}

// ── ⑥ 老的验证码账号：没有 emailVerifiedAt，但也没有密码 → 不许清 ──
//
// 这一条是整道门最要紧的那一条**反方向**断言。改制之前开出来的验证码账号身上没有
// emailVerifiedAt（那一位是 2026-10-02 才有的），而**库里此刻所有的账号都是这一种**。只看
// 「没验过」就清的话，全站每一个人第一次登录都会被踢掉所有别的设备——一次性的、不可逆的、
// 而且屏幕上只会写「请重新登录」。
{
  const LEGACY = 'legacy-otp@example.com';
  const OLD_A = 'LEGACY-PHONE';
  const OLD_B = 'LEGACY-TABLET';
  const legacy = A.newAccount('', 'code');          // 密钥是空串，和 signin.js 开出来的一样
  legacy.tokens = [{ t: OLD_A, at: Date.now() - 1000 }, { t: OLD_B, at: Date.now() }];
  legacy.token = OLD_B;
  delete legacy.emailVerifiedAt;                     // 老账号没有这一位
  await A.createAccount(LEGACY, legacy);
  check('（尺子）这份老账号确实「没验过、也没有密码」',
    !A.hasSecret(await A.loadAccount(LEGACY)) && !(await A.loadAccount(LEGACY)).emailVerifiedAt);

  const back = await otpSignIn(LEGACY, '198.51.100.8');
  check('⑥ 登得进来', back.status === 200 && Boolean(back.body.token));
  const now = await A.loadAccount(LEGACY);
  check('⑥ 手机那把还在（没被当成抢注清掉）', A.tokenValid(now, OLD_A));
  check('⑥ 平板那把也还在', A.tokenValid(now, OLD_B));
  check('⑥ 新这把也在（添一把，不是换一把）', A.tokenValid(now, back.body.token));
  check('⑥ 顺手把 emailVerifiedAt 补上了（下一次不必再判一遍）',
    Number(now.emailVerifiedAt) > 0, String(now.emailVerifiedAt));
}

// ── ⑦ 抢不到锁的时候：**码不许删** ─────────────────────────────
//
// confirm 走的是带锁的读—改—写。抢不到锁（别处正在写这个账号）时到这一行什么不可逆的事都
// 没做成，所以必须答 503 并且**把码留在库里**——删掉的话玩家重输同一张码会被告知「已过
// 期」，而他什么都没做错，而且要一张新码那道限速是一小时三封。
{
  const BUSY = 'busy@example.com';
  await A.createAccount(BUSY, (() => { const a = A.newAccount('', 'code'); a.emailVerifiedAt = Date.now(); return a; })());

  sentCode = null;
  const asked = await callOn(signin, { email: BUSY }, '198.51.100.9');
  const code = sentCode;
  const ticket = String(asked.body.challenge ?? '');
  check('（尺子）码和票都要到了', /^\d{6}$/.test(String(code)) && ticket.length === 16,
    `${code} / ${ticket}`);

  // 把那把账号锁先占住。键名和 _accounts.js 的 acctLockKey 一样（'acctlock:' + 邮箱）。
  // withLock 会等 30 × 60ms 才认输，所以这一条慢两秒。
  const LOCK = 'acctlock:' + BUSY;
  check('（尺子）锁占住了', await setnx(LOCK, { at: Date.now() }, 30));

  const busy = await callOn(signin,
    { action: 'confirm', email: BUSY, code, challenge: ticket }, '198.51.100.10');
  check('⑦ 抢不到锁：答 503 busy，不是 200 也不是「码过期」',
    busy.status === 503 && busy.body.error === 'busy', `${busy.status} ${busy.raw}`);
  check('⑦ **码还在库里**（他重输一次就该成）', Boolean(await get(`signin:${BUSY}:${ticket}`)));

  await del(LOCK);
  const retry = await callOn(signin,
    { action: 'confirm', email: BUSY, code, challenge: ticket }, '198.51.100.11');
  check('⑦ 锁放开之后，同一张码照样好使', retry.status === 200 && Boolean(retry.body.token),
    `${retry.status} ${retry.raw}`);
  check('⑦ 这一趟之后码才删掉', !(await get(`signin:${BUSY}:${ticket}`)));
}

// ── ⑦′ 验过之后又设了一把密码：不许再清一遍 ────────────────────
//
// 这条路是 `api/_unlock_legacy.js` 的 confirm（《忘记密码》→ 重设）：它自己要收一张寄到这个地址的
// 码，所以设密码的人**就是本人**，没有任何该清的东西。而它过后账号身上确实又有一把密码
// 了——这正是「只看 hasSecret」那种写法唯一露馅的地方。
{
  const RESET = 'after-unlock@example.com';
  const R_A = 'RESET-PHONE';
  const R_B = 'RESET-TABLET';
  const seeded = A.newAccount('', 'code');
  seeded.emailVerifiedAt = Date.now() - 86400e3;      // 早就验过了
  seeded.tokens = [{ t: R_A, at: Date.now() - 2000 }, { t: R_B, at: Date.now() - 1000 }];
  seeded.token = R_B;
  await A.createAccount(RESET, seeded);
  // 他走了一趟《忘记密码》，顺手设了一把新密码（unblock 换盐换哈希）。
  await A.updateAccount(RESET, (x) => { A.unblock(x, 'newpw1'); });
  const armed = await A.loadAccount(RESET);
  check('（尺子）现在它身上确实有一把密码了，而且早就验过',
    A.hasSecret(armed) && Number(armed.emailVerifiedAt) > 0);

  const back = await otpSignIn(RESET, '198.51.100.12');
  check("⑦′ 登得进来", back.status === 200 && Boolean(back.body.token), `${back.status} ${back.raw}`);
  const now = await A.loadAccount(RESET);
  check("⑦′ 手机那把还在（验过的账号不许再清第二遍）", A.tokenValid(now, R_A));
  check("⑦′ 平板那把也还在", A.tokenValid(now, R_B));
  check("⑦′ 新这把也在", A.tokenValid(now, back.body.token));
  check("⑦′ 那把密码也没被动（它不是我们该抹的东西）", A.hasSecret(now));
}

// ── ⑧ 有账号和没账号，答的是同一句 ─────────────────────────────
//
// 清理那一段不许顺手把这条规矩改坏：登录接口不能当查号机。三种都走
// `api/subscription.js` 的同一行（`tokenValid` 自己兼顾了「没账号」和「没带令牌」）。
{
  const ip = (n) => `198.51.100.${100 + n}`;
  const has = await callOn(subscription, { email: VICTIM, token: 'NOT-A-TOKEN' }, ip(1));
  const hasnt = await callOn(subscription, { email: 'nobody-at-all@example.com', token: 'NOT-A-TOKEN' }, ip(2));
  check('⑧ 令牌不对 / 压根没这个账号：一字不差', has.status === hasnt.status && has.raw === hasnt.raw,
    `${has.status}:${has.raw} / ${hasnt.status}:${hasnt.raw}`);
  const pwHas = await callOn(subscription, { email: VICTIM, password: ATTACK_PW }, ip(3));
  const pwNone = await callOn(subscription, { email: 'nobody-at-all@example.com', password: ATTACK_PW }, ip(4));
  check('⑧ 拿密码来：有账号 / 没账号也一字不差（而且两边都进不去）',
    pwHas.status === 401 && pwHas.raw === pwNone.raw, `${pwHas.status}:${pwHas.raw} / ${pwNone.raw}`);
}

console.log(`\n（假邮件发了 ${mails} 封）`);
console.log(fail ? `${fail} 条红` : '全绿');
process.exit(fail ? 1 : 0);

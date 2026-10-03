/**
 * 验证码不许被外人破坏（#19）。
 *
 *   node scripts/check-signin-challenge.mjs
 *
 * ── 那个病 ────────────────────────────────────────────────────
 *
 * 2026-10-02 之前，码存在 `signin:<邮箱>` 底下、猜测次数存在 `signin:tries:<邮箱>` 底下
 * ——**按地址，不按这一次**。而这个接口对谁都发信（它是注册兼登录，没有「这个地址有没有
 * 号」可藏）。两件事合起来，任何知道某人邮箱的人都能把他挡在门外，不需要任何凭据：
 *
 *   ① 他正在读信的时候，外人替他要一张新码——`set` 把他那张**覆盖**掉。他照着信上那六位
 *      数打进来，得到「验证码不对」。
 *   ② 或者外人拿他的地址乱猜 5 次：`tries > MAX_TRIES` 那一支会**把码删掉**。他手里那张
 *      当场作废，答的是「验证码已过期」。
 *   ③ 他回头再要一张，而要码那道限速是一小时三封——外人也在用同一个桶。
 *
 * 全程他看不出任何异常，只会觉得「这个网站的验证码是坏的」。而这三件事里最难发现的是
 * ①：`request` 里那句 `del(triesKey(address))`（「新码新账」）本身就是这条破坏路的一半。
 *
 * 现在要码那一趟当场发一张票（`challenge`，16 位十六进制），码和计数都存在**这张票**底
 * 下，而票只回给要码的那台设备。
 *
 * ── 量的是什么 ────────────────────────────────────────────────
 *
 *   ① 票的形状和唯一性：16 位十六进制，每次都不一样。
 *   ② **外人替受害者要码，受害者手上那张照旧好使。**（原来的 ①）
 *   ③ **外人拿受害者的地址乱猜到挡住，受害者手上那张照旧好使。**（原来的 ②）
 *   ④ 票不对 / 不带票 / 编一张票，都进不去，而且三种答的是同一句。
 *   ⑤ **带冒号的地址被拒**——地址本身是键的一部分，一个叫 `tries:受害者@x.com` 的地址拼
 *      出来正好是受害者那个计数键。
 *   ⑥ 过渡路：不带票时认老键（`signin:<邮箱>`），这样一个卡在上线那一刻的标签页不会被判
 *      成失败。那些老码 30 分钟后自己过期，这条路自己就消失。
 *   ⑦ 两道只管 confirm 的限速：按邮箱 15 次（只数真有码可猜的那几次）、按来路 30 次。
 *      「只数真实猜测」这一条要紧：否则外人拿**编的**票打 15 次就把受害者这一小时的额度
 *      用光了，而那正是这道门要修的病。
 *
 * ── 这道门怎么保证自己不是空绿 ────────────────────────────────
 *
 *   把 api/signin.js（或 _accounts.js）这样改坏            这道门要红在
 *   ─────────────────────────────────────────────────  ───────────
 *   码的键回到按地址（票只当装饰）                          ①②③⑥⑦
 *   计数的键回到按地址                                      ③′⑦
 *   「按邮箱 15 次」挪到读码之前（于是编的票也算）           ⑦
 *   不验票的形状                                            ④′
 *   request 往老键里写                                      ①②③⑥⑦
 *   EMAIL_RE 放开冒号                                       ⑤
 *   不把票回给客户端                                        ①②③④⑤⑥⑦
 *
 * 七条都真的试过一遍（改坏源码、跑这道门、恢复），每一条都如上红。
 *
 * ⚠️ 还试了第八条——把 `request` 里原来那句 `del(triesKey(address))`（「新码新账」）加回
 * 去——**这道门一条都没红，而那是对的**：按票存之后那一句删的是老键，而老键没有任何活着
 * 的读者。换句话说「按票」这一件事本身就把那条破坏路堵死了，不用再另加一道闸。
 *
 * 不起服务器、不连 Redis、不发真信：库用进程内那份，Resend 用一个假 fetch 顶掉——顺便把
 * 码从那封假邮件里读出来。
 */
process.env.ALLOW_MEMORY_STORE = '1';
process.env.RESEND_API_KEY = 'stub';
process.env.MAIL_FROM = 'noreply@example.com';
// 窗口开着会让每次登录都写一次库（送终身天才），和这道门要量的事无关，关掉省事。
delete process.env.GENIUS_GRANT_WINDOW;

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

let lastCode = null;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (!u.includes('resend.com')) throw new Error('unexpected fetch: ' + u);
  lastCode = (JSON.parse(init.body).text.match(/\b(\d{6})\b/) || [])[1] ?? null;
  return { ok: true, status: 200, text: async () => 'stub' };
};

const { default: signin } = await import('../api/signin.js');
const { get, set } = await import('../api/_store.js');

/** 每一节自己带一个来路 IP：要码那道限速按来路数 10 封/小时，混在一个桶里门会自己红。 */
let ipSeq = 0;
const freshIp = () => `10.1.${++ipSeq}.1`;

async function call(body, ip) {
  const res = { code: 0, raw: '' };
  await signin(
    { method: 'POST', body, headers: { 'x-vercel-forwarded-for': ip } },
    {
      status(c) { res.code = c; return this; },
      setHeader() {},
      end(text) { res.raw = text; },
    },
  );
  return { status: res.code, raw: res.raw, body: JSON.parse(res.raw || '{}') };
}

/** 要一张码，把票和码一起拿回来。 */
async function askCode(email, ip) {
  lastCode = null;
  const r = await call({ email }, ip);
  return { ...r, ticket: String(r.body.challenge ?? ''), code: lastCode };
}
const tryCode = (email, code, challenge, ip) =>
  call({ action: 'confirm', email, code, ...(challenge === null ? {} : { challenge }) }, ip);

// ── ① 票的形状和唯一性 ─────────────────────────────────────────
{
  const ip = freshIp();
  const a = await askCode('shape-a@example.com', ip);
  const b = await askCode('shape-b@example.com', ip);
  check('① 票是 16 位小写十六进制', /^[0-9a-f]{16}$/.test(a.ticket), a.ticket);
  check('① 两次要码不是同一张票', a.ticket !== b.ticket, `${a.ticket} / ${b.ticket}`);
  const again = await askCode('shape-a@example.com', ip);
  check('① 同一个地址再要一次，也是新的一张票', again.ticket !== a.ticket,
    `${a.ticket} / ${again.ticket}`);
  check('① 码存在「票」那个键底下，不在老键底下',
    Boolean(await get(`signin:shape-a@example.com:${a.ticket}`)) &&
    !(await get('signin:shape-a@example.com')));
}

// ── ② 外人替受害者要码：受害者手上那张照旧好使 ──────────────────
{
  const VICTIM = 'victim-overwrite@example.com';
  const mine = await askCode(VICTIM, freshIp());
  check('（尺子）受害者拿到了码和票', /^\d{6}$/.test(String(mine.code)) && mine.ticket.length === 16);

  // 外人：知道他的邮箱，替他要一张（这一步谁都做得到，接口对谁都发信）。
  const theirs = await askCode(VICTIM, freshIp());
  check('（尺子）外人也要到了一张（这条路本来就对谁都开）', theirs.ticket.length === 16);
  check('（尺子）两张不是同一张票', theirs.ticket !== mine.ticket);

  const in1 = await tryCode(VICTIM, mine.code, mine.ticket, freshIp());
  check('② 受害者照着信上那六位数，登得进去', in1.status === 200 && Boolean(in1.body.token),
    `${in1.status} ${in1.raw}`);
  // 反面：外人那张码此刻**还在**（它是另一张票），这说明两张互不干扰，不是「后一张把前
  // 一张顶掉」碰巧让受害者赢了。
  check('② 外人那张码还在库里（两张互不干扰）',
    Boolean(await get(`signin:${VICTIM}:${theirs.ticket}`)));
}

// ── ③ 外人乱猜到挡住：受害者手上那张照旧好使 ────────────────────
{
  const VICTIM = 'victim-burn@example.com';
  const mine = await askCode(VICTIM, freshIp());
  const theirs = await askCode(VICTIM, freshIp());

  // 外人拿他自己那张票猜到被挡（第 6 次 429，而且连自己那张码一起作废）。
  const ip = freshIp();
  const seen = [];
  for (let i = 0; i < 6; i++) seen.push((await tryCode(VICTIM, '000000', theirs.ticket, ip)).status);
  check('（尺子）外人那一串确实猜到被挡了', seen[5] === 429, seen.join(' '));
  check('（尺子）外人那张码被作废了（他毁的是自己那一张）',
    !(await get(`signin:${VICTIM}:${theirs.ticket}`)));

  check('③ 受害者那张码还在库里', Boolean(await get(`signin:${VICTIM}:${mine.ticket}`)));
  const in1 = await tryCode(VICTIM, mine.code, mine.ticket, freshIp());
  check('③ 受害者照旧登得进去', in1.status === 200 && Boolean(in1.body.token),
    `${in1.status} ${in1.raw}`);
}

// ── ③′ 猜 5 次就停：受害者的第一次尝试不许被算成第六次 ───────────
//
// 这一节和 ③ 的区别只有一个数：外人猜 **5** 次，不猜到第 6 次。
//
// 为什么非要单独量：计数键要是回到按地址数（只把码按票存），③ 反而量不出来——外人第 6 次
// 那一下会把**共用的**计数键一起删掉（`tries > MAX_TRIES` 那一支两样都删），于是受害者接
// 下来那一次又从 1 开始数，③ 全绿。停在 5 的话计数正好满着，受害者那一次就成了第 6 次：
// 429，而且码被删掉。差一个数，门就从量得出变成量不出。
{
  const VICTIM = 'victim-five@example.com';
  const mine = await askCode(VICTIM, freshIp());
  const theirs = await askCode(VICTIM, freshIp());

  const ip = freshIp();
  const seen = [];
  for (let i = 0; i < 5; i++) seen.push((await tryCode(VICTIM, '000000', theirs.ticket, ip)).status);
  check("（尺子）外人那 5 次都真的猜了（全是 401，一次没被别的闸挡掉）",
    seen.every((c) => c === 401), seen.join(' '));

  const in1 = await tryCode(VICTIM, mine.code, mine.ticket, freshIp());
  check("③′ 受害者这一次是**他自己那张票的第一次**，不是第六次",
    in1.status === 200 && Boolean(in1.body.token), `${in1.status} ${in1.raw}`);
}

// ── ④ 票不对 / 编一张 / 不带票：都进不去，而且答同一句 ───────────
{
  const WHO = 'ticket-check@example.com';
  const mine = await askCode(WHO, freshIp());
  const ip = freshIp();

  const forged = await tryCode(WHO, mine.code, '0123456789abcdef', ip);
  check('④ 编一张票（形状对、不存在）→ 400 expired',
    forged.status === 400 && forged.body.error === 'expired', `${forged.status} ${forged.raw}`);
  const malformed = await tryCode(WHO, mine.code, 'NOT-A-TICKET', ip);
  check('④ 形状都不对的票 → 同一句（不另给一个错，免得能分出「票对不对」）',
    malformed.status === forged.status && malformed.raw === forged.raw, malformed.raw);
  const bare = await tryCode(WHO, mine.code, null, ip);
  check('④ 压根不带票 → 也是同一句（老键底下什么都没有）',
    bare.status === forged.status && bare.raw === forged.raw, bare.raw);

  /*
   * ④′ 形状那道闸真正买到的东西：**票绝不会变成键的一截**。
   *
   * 不验形状的话，`bump(triesKey(address, ticket))` 会按外人递进来的字符串造一个键出来
   * ——`signin:tries:<邮箱>:tries:<邮箱>` 这种。那是一个由外人拼出来的键名，而这个库里一
   * 切都靠键名区分（账号、码、计数、锁）。所以这一条是白盒的：喂一个带冒号的票，库里不许
   * 多出任何带着它的键。
   */
  const nasty = 'tries:' + WHO;
  await tryCode(WHO, mine.code, nasty, ip);
  check("④′ 形状不对的票不许变成键的一截",
    !(await get(`signin:tries:${WHO}:${nasty}`)) && !(await get(`signin:${WHO}:${nasty}`)),
    String(await get(`signin:tries:${WHO}:${nasty}`)));

  // 尺子：票对了就进得去——上面几条不是靠「对谁都 400」混过去的。
  const good = await tryCode(WHO, mine.code, mine.ticket, freshIp());
  check('④（尺子）票对了就进得去', good.status === 200 && Boolean(good.body.token),
    `${good.status} ${good.raw}`);
}

// ── ⑤ 带冒号的地址被拒 ─────────────────────────────────────────
//
// 地址本身是键的一部分（`signin:<邮箱>:<票>`、`signin:tries:<邮箱>:<票>`、`acct:<邮箱>`…）。
// 一个叫 `tries:受害者@x.com` 的地址，`'signin:' + 它` 正好是受害者那个「猜了几次」的计数
// 键——注册一个这样的地址就能把别人的计数顶满，而他看到的只是「验证码已过期」。
{
  const ip = freshIp();
  const CASES = [
    'tries:victim@example.com',
    'victim@example.com:deadbeefdeadbeef',
    'a@b:c.com',
  ];
  for (const bad of CASES) {
    const r = await call({ email: bad }, ip);
    check(`⑤ 带冒号的地址被拒：${bad} → 400 email`,
      r.status === 400 && r.body.error === 'email', `${r.status} ${r.raw}`);
  }
  // 尺子：不带冒号的照样进得来（上面三条不是靠「对谁都 400」）。
  const fine = await call({ email: 'no-colon@example.com' }, ip);
  check('⑤（尺子）不带冒号的地址照旧要得到码', fine.status === 200 && fine.body.sent === true,
    fine.raw);
  // 而 confirm 那一头也要拒：不然一个带冒号的地址仍然能拿去读别人的键。
  const conf = await call({ action: 'confirm', email: 'tries:victim@example.com', code: '123456' }, ip);
  check('⑤ confirm 那一头也拒', conf.status === 400 && conf.body.error === 'email', conf.raw);
}

// ── ⑥ 过渡路：不带票时认老键 ───────────────────────────────────
//
// 上线那一刻正好有人手里拿着一张码——那张存在老键（`signin:<邮箱>`）底下，而他的标签页是
// 上线前加载的，发不出票来。所以不带票时认老键，他那一趟不会被判成失败。
//
// 这条路自己会消失：从这一刻起没有任何地方再往老键里写，而老码 30 分钟后过期。不靠一个
// 「上线时间 + 30 分钟」的常数——那种常数一定会被忘在代码里。
{
  const OLD = 'legacy-tab@example.com';
  // 手摆一张「上线之前发出去的」码：老键、老计数键，和改版前一模一样。
  await set('signin:' + OLD, { code: '654321' }, 1800);
  const ok = await tryCode(OLD, '654321', null, freshIp());
  check('⑥ 不带票 + 老键里有码 → 登得进去', ok.status === 200 && Boolean(ok.body.token),
    `${ok.status} ${ok.raw}`);
  check('⑥ 用掉之后老键也清掉了', !(await get('signin:' + OLD)));

  // 而新发的码**绝不**落在老键上——不然这条过渡路永远不会消失。
  const fresh = await askCode('never-legacy@example.com', freshIp());
  check('⑥ 新发的码不写老键（所以这条过渡路 30 分钟后自己消失）',
    !(await get('signin:never-legacy@example.com')) &&
    Boolean(await get(`signin:never-legacy@example.com:${fresh.ticket}`)));
}

// ── ⑦ confirm 那两道限速 ───────────────────────────────────────
{
  // 按来路：30 次/小时。打的是编的票（每次一个新的），所以不碰任何人的码。
  const ip = freshIp();
  const codes = [];
  for (let i = 0; i < 31; i++) {
    const t = i.toString(16).padStart(16, '0');
    codes.push((await tryCode(`caller-${i}@example.com`, '000000', t, ip)).status);
  }
  check('⑦ 按来路：前 30 次放过（400 expired），第 31 次 429',
    codes.slice(0, 30).every((c) => c === 400) && codes[30] === 429,
    `${[...new Set(codes.slice(0, 30))].join(',')} 然后 ${codes[30]}`);

  // 而**受害者这一小时的额度一点没被动**：上面那 31 次打的都是编的票，一次也没数进
  // 「按邮箱」那个桶。这一条是 ⑦ 的要害——它钉住「只数真有码可猜的那几次」那个次序。
  const VICTIM = 'quota-victim@example.com';
  const burn = freshIp();
  for (let i = 0; i < 20; i++) {
    const t = (0xaaaa0000 + i).toString(16).padStart(16, '0');
    await tryCode(VICTIM, '000000', t, i < 15 ? burn : freshIp());
  }
  const mine = await askCode(VICTIM, freshIp());
  const in1 = await tryCode(VICTIM, mine.code, mine.ticket, freshIp());
  check('⑦ 外人拿编的票打 20 次，受害者照旧登得进去（额度没被吃掉）',
    in1.status === 200 && Boolean(in1.body.token), `${in1.status} ${in1.raw}`);

  // 反面：真实猜测是**真的**在数的。一个地址连着要三张票、每张猜 5 次 = 15 次，
  // 第 16 次真实猜测要被按邮箱那道挡下。
  const CAP = 'quota-cap@example.com';
  const seen = [];
  for (let round = 0; round < 3; round++) {
    const t = (await askCode(CAP, freshIp())).ticket;
    for (let i = 0; i < 5; i++) seen.push((await tryCode(CAP, '000000', t, freshIp())).status);
  }
  check('⑦（反面）15 次真实猜测都数上了：没有一次是 429',
    seen.every((c) => c === 401 || c === 429) && seen.filter((c) => c === 429).length === 0,
    seen.join(' '));
  // 第 4 张票：第 14 推起要码那道限速按「邮箱 + 来路」各算三封（见 ⑧），换一个来路照样要
  // 得到。原先这一条断言的是「第 4 封被挡下」——那正是外人能耗光别人额度的那条路：谁都能
  // 替这个地址要三封，真正的主人这一小时就一封都要不到了。
  const fourth = await askCode(CAP, freshIp());
  check('⑦ 第 4 封从另一个来路照样要得到（要码按「邮箱 + 来路」算）', fourth.status === 200, String(fourth.status));
  // 而猜的那一道还是按邮箱数：拿这张新票猜第 16 次，挡下。两道闸各管一段。
  const sixteenth = await tryCode(CAP, '000000', fourth.ticket, freshIp());
  check('⑦ 第 16 次真实猜测被按邮箱那道挡下（一小时十五次）', sixteenth.status === 429, String(sixteenth.status));
}

// ── ⑧ 要码的额度：外人耗不光别人的（第 14 推）──────────────────────
//
// 原先按邮箱一小时三封：谁都能替一个地址连要三封，主人这一小时就一封都要不到了——不用猜
// 码，只要知道他的邮箱。改成按「邮箱 + 来路」各三封，另给同一个邮箱一个一小时十封的总上限
// （挡的是一个人换着来路往同一个信箱里灌信）。
{
  const X = 'quota-two-ips@example.com';
  const A = freshIp();
  const fromA = [];
  for (let i = 0; i < 4; i++) fromA.push((await askCode(X, A)).status);
  check('⑧ 来路 A 替 X 要了三封，第 4 封挡下', fromA.slice(0, 3).every((c) => c === 200) && fromA[3] === 429, fromA.join(' '));
  const B = freshIp();
  const fromB = await askCode(X, B);
  check('⑧ 来路 B 给 X 要码仍得 200（A 耗不光 X 的额度）', fromB.status === 200 && Boolean(fromB.ticket),
    `${fromB.status} ${fromB.raw}`);
  const signIn = await tryCode(X, fromB.code, fromB.ticket, B);
  check('⑧ 而且那一封真能登进去', signIn.status === 200 && Boolean(signIn.body.token), `${signIn.status} ${signIn.raw}`);

  // 同一个邮箱的总上限：一小时十封，换多少个来路都一样。
  const Y = 'quota-total@example.com';
  const seen = [];
  for (let i = 0; i < 11; i++) seen.push((await askCode(Y, freshIp())).status);
  check('⑧ 同一个邮箱换十一个来路：前十封放过，第十一封挡下',
    seen.slice(0, 10).every((c) => c === 200) && seen[10] === 429, seen.join(' '));
}

console.log(fail ? `\n${fail} 条红` : '\n全绿');
process.exit(fail ? 1 : 0);

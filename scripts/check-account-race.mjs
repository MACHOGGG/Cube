/**
 * 开账号那三条路的并发门：两个人同时认领同一个邮箱，只能成一个。
 *
 *   node scripts/check-account-race.mjs
 *
 * 不起服务器、不开浏览器：库用进程内的那一份（ALLOW_MEMORY_STORE），直接叫
 * api/passcode.js、api/email.js 的 handler，并发那几条用 Promise.all 一起发
 * ——一个一个发的版本永远是绿的，量不到任何东西。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么
 *
 * 开账号有三条路——passcode 的 bind（内部码绑邮箱）、passcode 的 create（刷
 * 卡后设密码）、email 的确认换邮箱——从前三条都是「先 loadAccount 看一眼这个
 * 地址有没有人，再 saveAccount 把账号整份写进去」。那两步之间隔着一次网络往
 * 返，同一瞬间进来的两个请求都会读到「没人」，于是都写，后写的把先写的整个
 * 盖掉。
 *
 * 这不用刻意攻击，普通用户手快就能撞上，而且撞上之后比想象的难受。2026-09
 * 实测：一家人共用一个邮箱，两个人各拿一张不同的内部码前后脚点《绑定》——
 *
 *   · 两边手机上都显示「绑定成功」（两条都回 200）；
 *   · **两张码都被吃掉了**——取码那一步（takeAccount）用的是 GETDEL，本来就
 *     是原子的，所以两张都真的被取走了；
 *   · 而库里只留得下后写的那一份。先操作的那个人：码没了、权益没了，手里刚
 *     拿到的登录令牌当场作废，他那屏上写的却是「成功」。
 *
 * 现在三条路都改走 createAccount（SET ... NX：查和写同一步）。输的那一条要把
 * 码放回去——不然玩家是拿一张码换回一句拒绝。
 *
 * 三个场景：
 *
 *   ① bind 撞 bind         → 10-11 起 bind 回 410（方案 A-2，它不验邮箱归属）：两条都 410、
 *                             两张码都原样留着、地址上没有开出任何账号
 *   ② 换邮箱撞 signin 新建 → 谁先谁后都行，但谁的账号都不许被整个盖掉
 *   ③ createAccount 本身   → 同一地址写两次，第二次不写，第一份原样留着
 *
 * create（刷卡那条）这里没驱动：它开头就要向 Creem 查这笔结账，没有密钥连
 * 503 都出不来，而且第 20 推起它也回 410。
 *
 * ② 原先拿 bind 去撞换邮箱。bind 关了之后，眼下还开账号的路是 signin（邮箱 + 寄到的验证码，
 * 地址上没账号就新建）、handle 注册、换邮箱（email.js）——和换邮箱抢同一个邮箱地址的只剩
 * signin 新建那一条，所以改由它来撞。
 */
process.env.ALLOW_MEMORY_STORE = '1';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const passcode = (await import('../api/passcode.js')).default;
const emailApi = (await import('../api/email.js')).default;
const redeem = (await import('../api/redeem.js')).default;
const A = await import('../api/_accounts.js');
const signinApi = (await import('../api/signin.js')).default;
const { get, set } = await import('../api/_store.js');

const call = async (handler, body) => {
  let status = 0;
  let text = '';
  const res = {
    status: (c) => ((status = c), res),
    setHeader: () => res,
    end: (t) => ((text = t), res),
  };
  await handler({ method: 'POST', headers: {}, body }, res);
  return { status, body: JSON.parse(text || '{}') };
};

/** 发一张内部码，权益寄存在 code:XXXXXX 底下（见 _accounts.js 的 codeHolder）。 */
async function mint(code, days, plan) {
  const acc = A.newAccount(code, 'code');
  acc.until = Date.now() + days * 86400e3;
  acc.plan = plan;
  await A.saveAccount(A.codeHolder(code), acc);
  return acc.token;
}
const codeAlive = async (code) => Boolean(await A.loadAccount(A.codeHolder(code)));

// ---- ① 两张码，同一个邮箱，同时绑：bind 关了（10-11 方案 A-2）------------------
//
// 从前这一节量的是「只成一个、输的那张码要还回来」。bind 现在整支回 410——它从来不验那个
// 邮箱是谁的，兑一张码就能绑到别人的地址上。这一节改量「关得干净」：两条都 410，**两张码一张
// 都没被吃掉**（410 排在取码之前），地址上也没开出任何账号。哪天 bind 又被接回来，这一节先红，
// 那时请回 api/passcode.js 分发那一行的注释看清楚要先补什么。
{
  const t1 = await mint('AAAA11', 30, 'month');
  const t2 = await mint('BBBB22', 365, 'year');
  const mail = 'family@example.com';
  const [r1, r2] = await Promise.all([
    call(passcode, { code: 'AAAA11', token: t1, email: mail, password: 'aaa111' }),
    call(passcode, { code: 'BBBB22', token: t2, email: mail, password: 'bbb222' }),
  ]);
  check('① bind 关了：两条都回 410 gone',
    [r1, r2].every((r) => r.status === 410 && r.body.error === 'gone'), `${r1.status} / ${r2.status}`);
  check('① 两张码一张都没被吃掉', (await codeAlive('AAAA11')) && (await codeAlive('BBBB22')));
  check('① 地址上没有开出任何账号', !(await A.loadAccount(mail)));
}

// ---- ② 换邮箱撞上别人拿这个地址新建账号（signin）-------------------------------
//
// 要码到输码之间隔着 30 分钟，那头完全可能有人正好在拿这个地址注册。谁先谁后都行——**不能有
// 谁的账号被另一份整个盖掉**：
//   · signin 先建成：换邮箱那一条撞上「地址有人了」，旧地址一个字都没动，他重来一次就好；
//   · 换邮箱先搬成：signin 的 createAccount 写不进去，落到「已有账号」那一支，登进的是搬过来
//     的那一份（两边都证明过这个邮箱是自己的——码都寄到了这个地址），搬过来的东西一样不少。
// 两条从前都是「先看一眼有没有人、再整份写进去」时，第二种会让后写的那一份把先写的盖掉。
{
  const old = 'mover@example.com';
  const wanted = 'newhome@example.com';
  // 今天的邮箱账号长这样：验证码开出来的（密钥是空串）、带着 emailVerifiedAt。原先这里是一把
  // 六位密码的老账号；那种账号搬家之后头一次拿验证码登录会不会被当成抢注清理，是另一件事（10-11
  // 起搬家那一下就记上 emailVerifiedAt，由 check-account-hub ⑩ 量），不是这一节要量的并发。
  const mine = A.newAccount('', 'code');
  mine.emailVerifiedAt = Date.now() - 1000;
  mine.until = Date.now() + 9e8;
  await A.saveAccount(old, mine);
  await set('chmail:' + old, { code: '123456', to: wanted }, 600);

  // signin 那一头先要一张码（没配 Resend：信寄不出去，但票照回、码照旧写进库里）。
  const asked = await call(signinApi, { email: wanted });
  const pending = asked.body.challenge ? await get(`signin:${wanted}:${asked.body.challenge}`) : null;
  check('（尺子）signin 那张码签出来了', Boolean(pending?.code), `${asked.status} ${JSON.stringify(asked.body)}`);

  const [rMove, rSign] = await Promise.all([
    call(emailApi, { action: 'confirm', email: old, newEmail: wanted, code: '123456', token: mine.token }),
    call(signinApi, { action: 'confirm', email: wanted, code: pending?.code, challenge: asked.body.challenge }),
  ]);
  check('② signin 那一条码是对的，总登得进去', rSign.status === 200 && Boolean(rSign.body.token),
    `搬家 ${rMove.status} / signin ${rSign.status}`);
  const there = await A.loadAccount(wanted);
  if (rMove.status !== 200) {
    // 拦在搬家的第一步，所以旧地址一个字都还没动——他的账号原地不动，重来一次就好。
    const still = await A.loadAccount(old);
    check('② 搬家没成时，旧地址上的账号原封不动', Boolean(still) && A.tokenValid(still, mine.token));
    check('② 搬家没成时，新地址上是 signin 新建的那一份（不是搬家写了一半的）',
      Boolean(there) && A.tokenValid(there, rSign.body.token) && !A.tokenValid(there, mine.token));
  } else {
    check('② 搬家成了：账号确实落在新地址上（他的令牌、到期日都在）',
      Boolean(there) && A.tokenValid(there, mine.token) && there.until === mine.until);
    check('② 搬家成了：旧地址已经拆掉', !(await A.loadAccount(old)));
    check('② 搬家成了：signin 登进的是搬过来的那一份，不是另开一份把它盖掉',
      Boolean(there) && A.tokenValid(there, rSign.body.token));
  }
}

// ---- ③ createAccount 本身：第二次写不进去，第一份原样留着 ----------------
{
  const mail = 'twice@example.com';
  const first = A.newAccount('one111', 'code');
  const second = A.newAccount('two222', 'code');
  const [a, b] = await Promise.all([A.createAccount(mail, first), A.createAccount(mail, second)]);
  check('③ 同一地址开两次，只开成一次', (a ? 1 : 0) + (b ? 1 : 0) === 1, `${a} / ${b}`);
  const acct = await A.loadAccount(mail);
  const kept = a ? first : second;
  check('③ 留下的正是开成那一份，没被另一份盖掉', acct?.token === kept.token);
}

// ---- ④ 兑码撞登录 / 撞 reset：加上去的时长不许被盖掉 ------------------------
//
// 登录和重设凭据都只想改一样小东西——登录添一把令牌，reset 换一把钥匙——可它们写回去的
// 是**整份账号**。从前两处都是朴素的「loadAccount → 改 → saveAccount」，于是同一瞬间的
// 兑码（redeem 走 updateAccount 加时长）会被它们按进函数那一刻读到的旧 until 盖回去：
// 码真的被吃掉了、两边都说成功，而账号上一天都没多。玩家自己查不出来，客服也查不出来
// （码已经从库里拿走了）。
//
// 现在两处都走 updateAccount，和兑码抢同一把 acctlock:<id>。
//
// ⚠️ **第一对换了被测的那条登录路（2026-10-02）。** 原先是「兑码撞 /api/subscription 拿
// 密码登录」，而那一支随 E37 撤了（那个文件里记着为什么），而且撤掉之后那条路**一个字都
// 不写库**，再也撞不出任何东西。现在撞的是 `api/handle.js` 的 signin（免邮箱凭据登录）
// ——它正是眼下「登录添一把令牌」那件事的落处，而它在 2026-10-02 之前也还是朴素的
// `issueToken` + `saveAccount`，和原先那一支一模一样的毛病。
{
  const handleFirst = (await import('../api/handle.js')).default;
  const FIRST4 = 'RaceSignin1';
  const made4 = await call(handleFirst, { action: 'register', first: FIRST4, second: 'loginpass' });
  check('（尺子）免邮箱账号注册成了', made4.status === 200, String(made4.status));
  const mail = made4.body.id;
  await A.updateAccount(mail, (a) => { a.until = Date.now() + 5 * 86400e3; });   // 先有五天
  const before = (await A.loadAccount(mail))?.until || 0;

  // redeem 读的是码本身那张票（code:XXXXXX，takeOnce 取走），不是上面 mint()
  // 那个「绑码用的寄存处」（acct:code:XXXXXX）。两者是两条路，别搞混。
  await set('code:DDDD44', { plan: 'month' });
  const [rRedeem, rLogin] = await Promise.all([
    call(redeem, { code: 'DDDD44', email: mail, token: made4.body.token }),
    call(handleFirst, { first: FIRST4, second: 'loginpass' }),
  ]);
  check('④ 兑码撞登录：两条都办成了', rRedeem.status === 200 && rLogin.status === 200,
    `兑码 ${rRedeem.status} / 登录 ${rLogin.status}`);
  const after = (await A.loadAccount(mail))?.until || 0;
  // 一个月是 PLAN_MS.month（31 天）。只要比原来的五天多出二十天以上，就说明那
  // 张码真的加上去了、没被登录那一笔按旧值盖回去。
  check('④ 兑码撞登录：那一个月还在（没被登录写回去的旧到期日盖掉）',
    after - before > 20 * 86400e3, `到期日多了 ${Math.round((after - before) / 86400e3)} 天`);
  // 而登录发出去的那把令牌也要真的落在库里——不然是反过来被兑码那一笔盖掉了。
  check('④ 兑码撞登录：登录那把令牌也在（没被兑码那一笔盖回去）',
    A.tokenValid(await A.loadAccount(mail), rLogin.body.token), String(rLogin.body.token).slice(0, 8));

  /*
   * 第二对原先是「兑码撞改密码」。改密码那一支 2026-10 撤了（E37，密码取消），而它守的那
   * 件事换了一条路：免邮箱凭据账号（E38）的 `reset`——同样是「只想换一把钥匙，写回去的却
   * 是整份账号」。
   *
   * 这一对还顺手量了另一件事：**兑码认得出免邮箱账号**。`redeem.js` 那一句从前只认
   * `EMAIL_RE`，于是这种账号被判成「没登录」，码落到码自己名下而不是他账号上——他换台设
   * 备就找不着了，**而屏幕上写着「兑换成功」**。现在认的是 `accountId`。
   *
   * 10-09 补充方案 7-8 起 `reset` 也撤了（回 410，一个字都不写），「撞」这一半于是撞不出东西了。
   * 这一对照旧并发着发，量的变成：reset 确实只回 410（哪天它又回来、又是朴素的读改写，这一条先
   * 红），兑码那一个月照样加上、记在他账号上。
   */
  const handleApi = (await import('../api/handle.js')).default;
  const FIRST = 'RaceHandle1';
  const madeH = await call(handleApi, { action: 'register', first: FIRST, second: 'firstpass' });
  check('（尺子）免邮箱账号注册成了', madeH.status === 200, String(madeH.status));
  const hid = madeH.body.id;
  // 先给它五天，好看出那一个月有没有被盖掉。
  await A.updateAccount(hid, (a) => { a.until = Date.now() + 5 * 86400e3; });
  const beforeH = (await A.loadAccount(hid))?.until || 0;

  await set('code:EEEE55', { plan: 'month' });
  const [rRedeem2, rReset] = await Promise.all([
    call(redeem, { code: 'EEEE55', email: hid, token: madeH.body.token }),
    call(handleApi, { action: 'reset', first: FIRST, newSecond: 'secondpas' }),
  ]);
  check('④ 兑码撞 reset：兑码办成了，reset 回 410（7-8 撤了，一个字都不写）', rRedeem2.status === 200 && rReset.status === 410,
    `兑码 ${rRedeem2.status} / reset ${rReset.status}`);
  const afterH = (await A.loadAccount(hid))?.until || 0;
  check('④ 兑码撞 reset：那一个月还在（没被 reset 按旧快照盖掉）',
    afterH - beforeH > 20 * 86400e3, `到期日多了 ${Math.round((afterH - beforeH) / 86400e3)} 天`);
  // 尺子：那个月是真的记在**他账号**上，不是落到码自己名下（那就是 accountId 要解决的事）。
  check('④（尺子）兑码认得出免邮箱账号：时长记在他账号上',
    afterH > Date.now() + 25 * 86400e3, String(Math.round((afterH - Date.now()) / 86400e3)) + ' 天');
}

// ---- ⑤ 密码打错一次，不许顺手抹掉这期间别处写进去的东西 -----------------
//
// 上面 ④ 守的是「密码对」那几条路。可**密码打错**也要写账号——checkPin 要记下
// 「错了几次」、够次数了还要落锁、落封号。原先那三处写的都是裸的
// saveAccount(email, account)：把三个入口（登录 / 改密码 / 账号中心）**进门时
// loadAccount 读到的那份旧账号整份**存回去。
//
// 于是一次最普通的手滑就能抹掉这期间别处写进去的真东西。2026-09 实测的形状：
// 玩家在网页 A 上兑了一张月卡（到期日 5 天 → 36 天），同时在网页 B 上想改密码、
// 旧密码打错了一个字母——网页 B 那份「到期日还是 5 天」的旧账号被整份写回去，
// 网页 A 那笔真实生效的兑换就这样消失了。两边都不报错（一边 200、一边就是他预
// 期的「密码错」），玩家只当是改密码失败了，不知道账号同时被改坏了。同样会被
// 吞掉的还有：后台刚发给他的内部码（inbox）、他刚在另一台设备上登录拿到的令牌
// （那台设备被安静地顶下线）。
//
// 补锁那次（d23dff4）其实专门想到过 checkPin，但只核了「错误次数」那个字段安不
// 安全（它确实安全，真正计数的是另一把原子计数器），没注意到同一次 saveAccount
// 把 until / tokens / inbox 这些真金白银也一起整份覆盖了。
//
// 现在 checkPin 那三处走 patchCounters → updateAccount（带锁，而且在锁里那份新
// 账号上重算），只碰 fails / blocked / lockUntil 三格。
{
  const mail = 'fatfinger@example.com';
  const acct = A.newAccount('good11', 'code');
  acct.until = Date.now() + 5 * 86400e3;
  await A.saveAccount(mail, acct);

  // 按事故的真实次序走，不靠 Promise.all 撞运气——这里要量的正是「快照过期」，
  // 而两条路各有几次 await 是实现细节，一变这道门就变成摆设（第一版就是这样：
  // 把修复退回裸 saveAccount，它照样全绿）。
  //
  //   1. 网页 B 打开改密码那一屏，loadAccount 读到一份快照（到期日 5 天）
  const stale = await A.loadAccount(mail);
  //   2. 这期间玩家在网页 A 上兑了一张月卡（到期日 → 36 天）
  await set('code:FFFF66', { plan: 'month' });
  const rRedeem = await call(redeem, { code: 'FFFF66', email: mail, token: acct.token });
  const gained = (await A.loadAccount(mail))?.until || 0;
  check('⑤ 先兑上那一张月卡', rRedeem.status === 200 && gained > acct.until + 20 * 86400e3,
    `${rRedeem.status} / 多了 ${Math.round((gained - acct.until) / 86400e3)} 天`);
  //   3. 网页 B 上他手滑，旧密码打错一个字母
  const verdict = await A.checkPin(mail, 'nope99', stale);
  check('⑤ 打错就是打错（判定没变）', verdict === 'wrong', verdict);
  //   4. 那一个月必须还在。原先这一步把第 1 步那份旧快照整份写回去，36 天变回 5 天。
  const after = (await A.loadAccount(mail))?.until || 0;
  check('⑤ 那一个月还在（没被「密码打错」那一笔按旧快照盖回去）', after === gained,
    `现在 ${Math.round((after - Date.now()) / 86400e3)} 天，应该 ${Math.round((gained - Date.now()) / 86400e3)} 天`);
  // 这道门不能只看「东西没丢」：把写账号那一步整个删掉也能让上面那条绿。锁定计
  // 数必须照旧记下来，不然是拿一个更坏的 bug 换一个 bug。
  const counted = Number((await A.loadAccount(mail))?.fails || 0);
  check('⑤ 这次打错照旧记在账上（不是干脆不写了）', counted >= 1, `fails=${counted}`);
}

// ---- ⑥ 同一形状，吞的是令牌：新设备刚登录，这台手滑一次 -------------------
//
// 令牌环和到期日在同一份 JSON 里，所以同一笔整份覆盖两样都吞。玩家看到的是：
// 手机上刚登录好，电脑上手滑输错一次凭据，手机那台下次去看排行榜被告知「请重新
// 登录」——而两边都没有任何报错。
//
// 被测的登录路和 ④ 一样换成了 handle.js 的 signin（理由见 ④ 那条 ⚠️）。手滑那一下照旧
// 直接叫 `checkPin`，而且**故意喂一份过期的快照**——那正是「进门时读的那一份」。
{
  const handleSix = (await import('../api/handle.js')).default;
  const FIRST6 = 'RaceTwoDev1';
  const made6 = await call(handleSix, { action: 'register', first: FIRST6, second: 'good2222' });
  check('（尺子）免邮箱账号注册成了', made6.status === 200, String(made6.status));
  const mail = made6.body.id;
  await A.updateAccount(mail, (a) => { a.until = Date.now() + 40 * 86400e3; });
  const firstToken = made6.body.token;

  const stale = await A.loadAccount(mail);            // 电脑那台进门时的快照
  const rLogin = await call(handleSix, { first: FIRST6, second: 'good2222' });
  const fresh = await A.loadAccount(mail);
  check('⑥ 新设备登录拿到一把新令牌', rLogin.status === 200 && Boolean(rLogin.body.token)
    && A.tokenValid(fresh, rLogin.body.token), String(rLogin.status));
  await A.checkPin(mail, 'nope8888', stale, { block: false });   // 电脑那台手滑
  const later = await A.loadAccount(mail);
  check('⑥ 新设备那把令牌还有效（没被打错那一笔顶下线）',
    A.tokenValid(later, rLogin.body.token));
  // 原来那把也不许丢——他自己这台还在用着。
  check('⑥ 原来那把也还在（两台各拿各的）', A.tokenValid(later, firstToken));
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

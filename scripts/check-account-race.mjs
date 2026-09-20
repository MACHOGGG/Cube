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
 *   ① bind 撞 bind         → 只成一个；赢家的令牌有效；输家的码要回得来
 *   ② 换邮箱撞 bind        → 只成一个；输的是换邮箱时，旧地址一个字没动
 *   ③ createAccount 本身   → 同一地址写两次，第二次不写，第一份原样留着
 *
 * create（刷卡那条）这里没驱动：它开头就要向 Creem 查这笔结账，没有密钥连
 * 503 都出不来。它和 bind 用的是同一个 createAccount，改法一模一样。
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
const subscription = (await import('../api/subscription.js')).default;
const A = await import('../api/_accounts.js');
const { set } = await import('../api/_store.js');

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

// ---- ① 两张码，同一个邮箱，同时绑 --------------------------------------
{
  const t1 = await mint('AAAA11', 30, 'month');
  const t2 = await mint('BBBB22', 365, 'year');
  const mail = 'family@example.com';
  const [r1, r2] = await Promise.all([
    call(passcode, { code: 'AAAA11', token: t1, email: mail, password: 'aaa111' }),
    call(passcode, { code: 'BBBB22', token: t2, email: mail, password: 'bbb222' }),
  ]);
  const wins = [r1, r2].filter((r) => r.status === 200);
  const loses = [r1, r2].filter((r) => r.status !== 200);
  check('① 绑码撞绑码：只有一个说成功', wins.length === 1, `${r1.status} / ${r2.status}`);
  check('① 另一个明说地址已经有人了', loses.length === 1 && loses[0].body.error === 'exists', loses[0]?.body?.error);
  const acct = await A.loadAccount(mail);
  check('① 说成功那个人的令牌真的能用', Boolean(acct) && wins[0].body.token === acct.token);
  // 输的那一条必须把码放回去。少了这一步，玩家是拿一张码换回一句拒绝——
  // 那正是这条 bug 最疼的地方（码没了，什么都没换到）。
  const back = (await codeAlive('AAAA11')) || (await codeAlive('BBBB22'));
  check('① 输的那张码还回来了（不是白白烧掉）', back);
  const burned = (await codeAlive('AAAA11')) && (await codeAlive('BBBB22'));
  check('① 赢的那张码照常烧掉', !burned);
}

// ---- ② 换邮箱撞上别人拿这个地址绑码 --------------------------------------
//
// 要码到输码之间隔着 30 分钟，那头完全可能有人正好在注册这个地址。谁赢都行，
// 不能两个都赢——两个都赢就是有人的账号被另一个人整个盖掉。
{
  const old = 'mover@example.com';
  const wanted = 'newhome@example.com';
  const mine = A.newAccount('old111', 'code');
  mine.until = Date.now() + 9e8;
  await A.saveAccount(old, mine);
  await set('chmail:' + old, { code: '123456', to: wanted }, 600);

  const t3 = await mint('CCCC33', 30, 'month');
  const [rMove, rBind] = await Promise.all([
    call(emailApi, { action: 'confirm', email: old, newEmail: wanted, code: '123456', token: mine.token }),
    call(passcode, { code: 'CCCC33', token: t3, email: wanted, password: 'ccc333' }),
  ]);
  const wins = [rMove, rBind].filter((r) => r.status === 200).length;
  check('② 换邮箱撞绑码：只有一个成', wins === 1, `搬家 ${rMove.status} / 绑码 ${rBind.status}`);
  if (rMove.status !== 200) {
    // 拦在搬家的第一步，所以旧地址一个字都还没动——他的账号原地不动，重来一次就好。
    const still = await A.loadAccount(old);
    check('② 搬家没成时，旧地址上的账号原封不动', Boolean(still) && still.token === mine.token);
  } else {
    const moved = await A.loadAccount(wanted);
    check('② 搬家成了：账号确实落在新地址上', Boolean(moved) && moved.token === mine.token);
    check('② 搬家成了：旧地址已经拆掉', !(await A.loadAccount(old)));
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

// ---- ④ 兑码撞登录 / 撞改密码：加上去的时长不许被盖掉 ------------------------
//
// 登录（subscription.js）和改密码（passcode.js）都只想改一样小东西——登录添一
// 把令牌，改密码换一把钥匙——可它们写回去的是**整份账号**。从前两处都是朴素的
// 「loadAccount → 改 → saveAccount」，于是同一瞬间的兑码（redeem 走 updateAccount
// 加时长）会被它们按进函数那一刻读到的旧 until 盖回去：码真的被吃掉了、两边都
// 说成功，而账号上一天都没多。玩家自己查不出来，客服也查不出来（码已经从库里
// 拿走了）。
//
// 现在两处都走 updateAccount，和兑码抢同一把 acctlock:<邮箱>。
{
  const mail = 'racer@example.com';
  const acct = A.newAccount('old111', 'code');
  acct.until = Date.now() + 5 * 86400e3;   // 先有五天
  await A.saveAccount(mail, acct);
  const before = acct.until;

  // redeem 读的是码本身那张票（code:XXXXXX，takeOnce 取走），不是上面 mint()
  // 那个「绑码用的寄存处」（acct:code:XXXXXX）。两者是两条路，别搞混。
  await set('code:DDDD44', { plan: 'month' });
  const [rRedeem, rLogin] = await Promise.all([
    call(redeem, { code: 'DDDD44', email: mail, token: acct.token }),
    call(subscription, { email: mail, password: 'old111' }),
  ]);
  check('④ 兑码撞登录：两条都办成了', rRedeem.status === 200 && rLogin.status === 200,
    `兑码 ${rRedeem.status} / 登录 ${rLogin.status}`);
  const after = (await A.loadAccount(mail))?.until || 0;
  // 一个月是 PLAN_MS.month（31 天）。只要比原来的五天多出二十天以上，就说明那
  // 张码真的加上去了、没被登录那一笔按旧值盖回去。
  check('④ 兑码撞登录：那一个月还在（没被登录写回去的旧到期日盖掉）',
    after - before > 20 * 86400e3, `到期日多了 ${Math.round((after - before) / 86400e3)} 天`);

  await set('code:EEEE55', { plan: 'month' });
  const [rRedeem2, rChange] = await Promise.all([
    call(redeem, { code: 'EEEE55', email: mail, token: acct.token }),
    call(passcode, { action: 'change', email: mail, password: 'old111', newPassword: 'new222' }),
  ]);
  check('④ 兑码撞改密码：两条都办成了', rRedeem2.status === 200 && rChange.status === 200,
    `兑码 ${rRedeem2.status} / 改密码 ${rChange.status}`);
  const after2 = (await A.loadAccount(mail))?.until || 0;
  check('④ 兑码撞改密码：那一个月还在（没被改密码显式带过去的旧 until 盖掉）',
    after2 - after > 20 * 86400e3, `到期日又多了 ${Math.round((after2 - after) / 86400e3)} 天`);
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
// 手机上刚登录好，电脑上手滑输错一次密码，手机那台下次去看排行榜被告知「请重新
// 登录」——而两边都没有任何报错。
{
  const mail = 'twodevice@example.com';
  const acct = A.newAccount('good22', 'code');
  acct.until = Date.now() + 40 * 86400e3;
  await A.saveAccount(mail, acct);

  const stale = await A.loadAccount(mail);            // 电脑那台进门时的快照
  const rLogin = await call(subscription, { email: mail, password: 'good22' });
  const fresh = await A.loadAccount(mail);
  check('⑥ 新设备登录拿到一把新令牌', rLogin.status === 200 && Boolean(rLogin.body.token)
    && A.tokenValid(fresh, rLogin.body.token), String(rLogin.status));
  await A.checkPin(mail, 'nope88', stale);            // 电脑那台手滑
  const later = await A.loadAccount(mail);
  check('⑥ 新设备那把令牌还有效（没被打错那一笔顶下线）',
    A.tokenValid(later, rLogin.body.token));
  // 原来那把也不许丢——他自己这台还在用着。
  check('⑥ 原来那把也还在（两台各拿各的）', A.tokenValid(later, acct.token));
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

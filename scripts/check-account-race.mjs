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

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

/**
 * 登录之后那扇《账户》窗背后的三条路：**兑码、改密码、改邮箱。**
 *
 *   node scripts/check-account-hub.mjs
 *
 * 盯的是玩家一次点名的三件事（原话）：
 *
 *   「如果玩家在过去有账户的情况下也是应该能够登录，指示没有权限而已」
 *   「内部码不能加入过去已有的账户」
 *   「需要在个人主页里加入 更换邮箱/更换密码的按钮」
 *
 * 前两条是连着的：登不上，signedInEmail() 就是空的，兑码那一趟没有身份可
 * 报，服务器只好把这个月挂在码自己名下——玩家换台设备就找不着了。所以 ②
 * 验的是「一个订阅过期、但登着的人，码要落到他账户上」。
 *
 * ②′ 是同一件事的多设备版：一个人手机、电脑都登着，拿**先登那台**的令牌去
 * 兑码，也得落到账户上。这条已经修好很久了（885c154），加断言是因为它反复被
 * 当成「还没修的高优先级问题」重提——注释拦不住这个，门可以。
 *
 * 换邮箱是这里面唯一动数据的：账号存在 acct:<邮箱> 底下，排行榜上的成员也是
 * 这个地址，所以换邮箱是搬家。④⑤⑥ 分别验：码寄给**新**地址（不是现在这
 * 个）、账号和战绩确实搬过去了、以及几种该拦下来的。
 *
 * 不起服务器、不连 Redis、不真发信也不真问 Creem：库用进程内的那份，两个外
 * 部 HTTP 各用一个假 fetch 顶掉——顺便把验证码从那封假邮件里读出来。
 *
 * ⚠️ **凭据换了（2026-10-02）。** 这道门原先靠「拿密码打 /api/subscription」去换一把令
 * 牌，而那一支随 E37 撤了（那个文件里记着为什么）。现在的办法是**直接把令牌种进账号
 * 里**（`account.tokens`）——它和真实的登录给出来的东西一模一样（signin.js / handle.js
 * 发的就是这个），而且少一层依赖：这道门要量的是「账户窗背后那三条路」，不是登录本身
 * 怎么走（那一头由 check-signin-otp / check-handle-auth 守着）。
 */
process.env.ALLOW_MEMORY_STORE = '1';
/*
 * **显式清掉授予开关**（E48）。
 *
 * 这道门有一条断言是「订阅过期的人登得上，而且如实说不是天才」。`GENIUS_GRANT_WINDOW`
 * 一开，登录那一下就会把这个账号写成终身天才（api/subscription.js 的调用点），那条断言
 * 当场红——而红的不是代码，是环境。它从外面漏进来过一次（本地手跑时 shell 里带着），所
 * 以在这儿写死：这道门跑在「开关关着」那一侧。
 */
delete process.env.GENIUS_GRANT_WINDOW;
process.env.RESEND_API_KEY = 're_stub';
process.env.MAIL_FROM = 'Slides <noreply@example.com>';
// Creem 配着、也答得出话——答的是「这个人没有订阅」。这正是「有账号、但订阅
// 过期」那一支，也就是玩家撞上的那一种。
process.env.CREEM_API_KEY = 'creem_test_stub';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

let mails = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('api.resend.com')) {
    const body = JSON.parse(init.body);
    mails.push({ to: body.to[0], subject: body.subject, text: body.text });
    return { ok: true, status: 200, json: async () => ({ id: 'stub' }) };
  }
  if (u.includes('creem.io')) {
    return { ok: false, status: 404, text: async () => 'not found', json: async () => ({}) };
  }
  throw new Error('unexpected fetch: ' + u);
};
const lastCode = () => (mails.at(-1)?.text.match(/\b(\d{6})\b/) || [])[1] ?? null;

const subscription = (await import('../api/subscription.js')).default;
const redeem = (await import('../api/redeem.js')).default;
const passcode = (await import('../api/passcode.js')).default;
const emailApi = (await import('../api/email.js')).default;
const { saveAccount, loadAccount, checkPin, newAccount } = await import('../api/_accounts.js');
const { set, get } = await import('../api/_store.js');

const callOn = async (handler, body) => {
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

const EMAIL = 'lapsed@example.com';
const PW = 'aaa111';
const DEVICE = 'DEVICE-ONE-TOKEN';

/**
 * 一个订阅早就过期的老玩家：账号还在，我们自己库里没有到期日（刷卡的那一支，权益在
 * Creem 那边，而 Creem 答的是查无此人）。他那台设备上登着——令牌直接种进去（见文件顶
 * 上那条 ⚠️）。
 *
 * 密码照旧设着：下面 ③⑤ 还拿 `checkPin` 当尺子（「账号没坏」「搬家没把它弄丢」），而
 * 这种老账号在库里本来就带着一把密码。它只是**再也不能当登录凭据**，那一条由 ③ 反着量。
 */
const lapsedAcct = newAccount(PW, 'card');
lapsedAcct.tokens = [{ t: DEVICE, at: Date.now() }];
lapsedAcct.token = DEVICE;
await saveAccount(EMAIL, lapsedAcct);

// ---- ① 登得上，而且如实说没有权限 ------------------------------------------

const signedIn = await callOn(subscription, { email: EMAIL, token: DEVICE });
check('订阅过期的人，令牌对了就登得上', signedIn.status === 200, String(signedIn.status));
check('回了邮箱和令牌——前端拿这两样认「我是谁」',
  signedIn.body.email === EMAIL && typeof signedIn.body.token === 'string' && signedIn.body.token,
  JSON.stringify(signedIn.body));
check('同时如实说不是天才', signedIn.body.active !== true);

const token = signedIn.body.token;

// ---- ② 内部码落到这个账户上，不是挂在码自己名下 ----------------------------

await set('code:GATE01', { plan: 'month' });
const spent = await callOn(redeem, { code: 'GATE01', email: EMAIL, token });
check('兑码答 200', spent.status === 200, String(spent.status));
check('答复里带着这个邮箱——说明落到账户上了', spent.body.email === EMAIL, JSON.stringify(spent.body));
check('**没有** code 字段（有它才表示还挂在码自己名下）', spent.body.code === undefined);
check('这一刻成了天才', spent.body.active === true);
check('回的是这台设备自己那把令牌，没被换掉', spent.body.token === token);
const afterCode = await loadAccount(EMAIL);
check('账户上真的记了到期日', (afterCode.until || 0) > Date.now());
check('码从库里没了', (await get('code:GATE01')) === null || (await get('code:GATE01')) === undefined);

// ---- ②′ 两台设备都登着，拿**先登那台**的令牌兑码 --------------------------
//
// 这一条守的不是一个还没修的 bug，是一个**已经修好、却反复被当成没修重提**
// 的地方——巡检报告里到今天还写着「手机先登录、电脑后登录之后去兑换码会被
// 判定未登录，还会新建一个孤儿账号」。它在 885c154 就修了，可当时只留了一段
// 注释，没有任何一条断言守着。
//
// 会坏成什么样：tokenValid() 比的是账户上那一串令牌（多台设备各一把），
// 谁要是「顺手简化」成 token === account.token（最新签发的那一把），先登的
// 那台立刻被判成没登录。码照样兑得掉，可那个月挂在码自己名下、不在他账户
// 上——他换台设备就找不着了，而这种事玩家多半不会来报，只会觉得被骗了。
//
// 所以自带一个账号，跟上面那条主线互不干扰。

const TWO = 'twodevices@example.com';
const TWO_PW = 'ccc111';
const PHONE = 'PHONE-TOKEN';
const LAPTOP = 'LAPTOP-TOKEN';
const twoAcct = newAccount(TWO_PW, 'card');
// 手机先登、电脑后登：account.token 是后登那一把，而两把都还在那一串里。
twoAcct.tokens = [{ t: PHONE, at: Date.now() - 1000 }, { t: LAPTOP, at: Date.now() }];
twoAcct.token = LAPTOP;
await saveAccount(TWO, twoAcct);

const phone = await callOn(subscription, { email: TWO, token: PHONE });
const laptop = await callOn(subscription, { email: TWO, token: LAPTOP });
check('两台设备各报各的那一把，服务器原样回给它（不是一律回最新签发的那一把）',
  phone.body.token === PHONE && laptop.body.token === LAPTOP,
  `${phone.body.token} / ${laptop.body.token}`);

await set('code:GATE02', { plan: 'month' });
const oldDevice = await callOn(redeem, { code: 'GATE02', email: TWO, token: phone.body.token });
check('拿**先登那台**的令牌兑码，一样落到账户上',
  oldDevice.status === 200 && oldDevice.body.email === TWO, JSON.stringify(oldDevice.body));
check('**没有** code 字段——没被当成「没登录」挂到码自己名下',
  oldDevice.body.code === undefined);
check('回的是先登那台自己那把令牌，没被后登那台顶掉',
  oldDevice.body.token === phone.body.token);
const twoAfter = await loadAccount(TWO);
check('两台设备的令牌都还在，兑一次码没把谁挤下线',
  twoAfter.tokens.some((e) => e.t === phone.body.token) &&
  twoAfter.tokens.some((e) => e.t === laptop.body.token),
  `${twoAfter.tokens.length} 把`);
check('没有生出和账户无关的孤儿账号（acct:code:GATE02）',
  !(await loadAccount('code:GATE02')) && !(await get('acct:code:GATE02')));

// ---- ②″ 已经是终身天才的人兑码：那张码一个字都不许动 ----------------------
//
// `extend()` 对终身账号是个 no-op（_accounts.js：「Adding time to forever is not an error,
// it is simply nothing」），而 `redeem.js` 开头那一步 `takeOnce` 是 GETDEL——码从库里拿走
// 了。两件事合起来就是：**码烧掉、账上什么都没多、屏幕上写着「兑换成功」**。玩家下次想把它
// 送给朋友时才发现它没了，而那时谁也查不出发生过什么。
//
// 这不是边角情况：窗口期里「登录成功即送终身天才」（E11 / PR-12），所以开着那个开关时**每
// 一个登着的人都是终身**，每一张内部码兑到自己账号上都会这样消失一张。
{
  const LIFER = 'lifer@example.com';
  const LIFE_TOKEN = 'LIFER-DEVICE';
  const lifer = newAccount('zzz111', 'card');
  lifer.until = Date.UTC(2999, 0, 1);          // LIFETIME_UNTIL
  lifer.plan = 'life';
  lifer.tokens = [{ t: LIFE_TOKEN, at: Date.now() }];
  lifer.token = LIFE_TOKEN;
  await saveAccount(LIFER, lifer);

  await set('code:GATE03', { plan: 'year' });
  const tried = await callOn(redeem, { code: 'GATE03', email: LIFER, token: LIFE_TOKEN });
  check("②″ 答 409 active（界面上那句话早就写好了：「这张码留着以后用，或者送人」）",
    tried.status === 409 && tried.body.error === 'active', `${tried.status} ${JSON.stringify(tried.body)}`);
  check("②″ **码还在库里**（他可以原样送人）", Boolean(await get('code:GATE03')),
    JSON.stringify(await get('code:GATE03')));
  // 尺子：这张码本来是兑得掉的——换一个不是终身的人来，它照样到账。少了这一条，上面两条
  // 可能只是「这张码压根兑不了」。
  const MORTAL = 'mortal@example.com';
  const MORTAL_TOKEN = 'MORTAL-DEVICE';
  const mortal = newAccount('yyy111', 'card');
  mortal.tokens = [{ t: MORTAL_TOKEN, at: Date.now() }];
  mortal.token = MORTAL_TOKEN;
  await saveAccount(MORTAL, mortal);
  const ok = await callOn(redeem, { code: 'GATE03', email: MORTAL, token: MORTAL_TOKEN });
  check("②″（尺子）同一张码给一个不是终身的人，照样兑得上",
    ok.status === 200 && ok.body.email === MORTAL, `${ok.status} ${JSON.stringify(ok.body)}`);
  check("②″（尺子）这一次码才从库里拿走", !(await get('code:GATE03')));
}

// ---- ③ 换密码那条路撤了 ----------------------------------------------------
/*
 * 这儿原先有一整节（约 25 行）量「改密码」：旧密码是唯一凭据、新密码要合规矩、换完别的
 * 设备下线、内部码换来的时长不被抹掉。2026-10 的改制（E37）把密码整个取消了，
 * `api/passcode.js` 的 `change` 支随之撤掉——邮箱账号没有密码可改（登录走验证码），免邮
 * 箱账号要换第二串走 `api/handle.js` 的 `reset`（那条路由 check-handle-auth.mjs 守着）。
 *
 * 留一条反面尺子：那一支不许悄悄回来，而且认不出来的请求要**明确**答 400，不是落到某一
 * 支上去。
 */
{
  const gone = await callOn(passcode, { email: EMAIL, password: PW, newPassword: 'bbb222' });
  check('改密码那一支撤了：答 400 action，不是悄悄落到别处',
    gone.status === 400 && gone.body?.error === 'action', `${gone.status} ${JSON.stringify(gone.body)}`);

  // 注册那一支也撤了（2026-10-02）。它是个抢注接口：不要任何凭据就能在别人的邮箱上开出
  // 账号、还带着一把自己设的密码（api/passcode.js 末尾那段）。同一把尺子——不许悄悄回来。
  const reg = await callOn(passcode, { register: true, email: 'brand-new@example.com', password: 'zzz999' });
  check('注册那一支撤了：答 400 action',
    reg.status === 400 && reg.body?.error === 'action', `${reg.status} ${JSON.stringify(reg.body)}`);
  check('而且真的没在那个地址上开出账号来', !(await loadAccount('brand-new@example.com')));

  // 拿密码去登录也不行了（那一支在 api/subscription.js 里撤了）。
  const pwLogin = await callOn(subscription, { email: EMAIL, password: PW });
  check('拿密码登录那一支撤了：真密码也答 401',
    pwLogin.status === 401, `${pwLogin.status} ${JSON.stringify(pwLogin.body)}`);

  // 尺子：密码本身还在、还对得上（`bind` 那条路还要设六位密码）——上面那三条红的不是
  // 「账号坏了」，而是那几条路真的关了。
  check('（尺子）账号和密码都还好着', (await checkPin(EMAIL, PW, await loadAccount(EMAIL))) === 'ok');
}

// 下面 ④ 要一把活令牌。从前用的是改密码回来那一把，现在用登录拿到的这一把。
const live = token;

// ---- ④ 换邮箱：码寄给**新**地址 --------------------------------------------

const NEXT = 'moved@example.com';
mails = [];
const asked = await callOn(emailApi, { email: EMAIL, token: live, newEmail: NEXT, lang: 'zhHans' });
check('要码这一步答 200', asked.status === 200, String(asked.status));
check('只发了一封', mails.length === 1, `${mails.length} 封`);
check('**寄给新地址**，不是现在这个', mails[0]?.to === NEXT, String(mails[0]?.to));
check('信里有六位码', /^\d{6}$/.test(lastCode() || ''), String(lastCode()));
check('按界面语言写，并附了一份英文',
  mails[0]?.text.includes('确认码') && mails[0]?.text.includes('confirmation code'),
  JSON.stringify(mails[0]?.subject));

// 令牌不对：一句话都不该往下走。
const noToken = await callOn(emailApi, { email: EMAIL, token: 'NOT-A-TOKEN', newEmail: NEXT });
check('拿不出令牌就换不了邮箱', noToken.status === 401, String(noToken.status));

// ---- ⑤ 码对上了，账号连同战绩一起搬 ----------------------------------------

// 先给他记一笔战绩和一个榜上的位置，好验「搬家搬全了」。
const { zscore } = await import('../api/_store.js');
await set('stats:' + EMAIL, { total: 900, runs: 3, best: { square: 900 }, seen: [] });
await set('runs:' + EMAIL, [{ score: 900 }]);

const moved = await callOn(emailApi, {
  action: 'confirm', email: EMAIL, token: live, newEmail: NEXT, code: lastCode(),
});
check('码对了就搬', moved.status === 200 && moved.body.moved === true, String(moved.status));
check('答复里是新地址', moved.body.email === NEXT, JSON.stringify(moved.body));
check('令牌一把没动——换的是门牌不是钥匙', moved.body.token === live);

const atNew = await loadAccount(NEXT);
check('新地址底下有账号了', Boolean(atNew));
// 密码从头到尾没换过（改密码那一支撤了），所以这儿认的是最初那一把。
check('密码还是那一把', atNew && (await checkPin(NEXT, PW, atNew)) === 'ok');
check('内部码那段时间跟着过来了', (atNew?.until || 0) > Date.now());
check('旧地址底下清干净了', !(await loadAccount(EMAIL)));

check('战绩搬过来了', Boolean(await get('stats:' + NEXT)), JSON.stringify(await get('stats:' + NEXT)));
check('存档也搬过来了', Boolean(await get('runs:' + NEXT)));
check('旧地址下的战绩清掉了', !(await get('stats:' + EMAIL)));
check('排行榜上换成了新地址', (await zscore('lb:square', NEXT)) === 900, String(await zscore('lb:square', NEXT)));
check('排行榜上旧地址撤了', (await zscore('lb:square', EMAIL)) === null,
  String(await zscore('lb:square', EMAIL)));

// 换完之后，新地址真的登得上——这一条是「搬家搬活了」的收尾。
// 令牌一把没动（上面刚量过），所以还是手里这一把。
const reSignIn = await callOn(subscription, { email: NEXT, token: live });
check('新邮箱登得上', reSignIn.status === 200 && reSignIn.body.email === NEXT, String(reSignIn.status));
check('而且还是天才（内部码那段时间还在）', reSignIn.body.active === true);

// ---- ⑥ 该拦下来的几种 -------------------------------------------------------

const token2 = reSignIn.body.token;
const same = await callOn(emailApi, { email: NEXT, token: token2, newEmail: NEXT });
check('填的就是现在这个地址：拦下来', same.status === 400 && same.body.error === 'sameEmail',
  JSON.stringify(same.body));

const OTHER = 'somebody-else@example.com';
await saveAccount(OTHER, newAccount('ccc333', 'card'));
const taken = await callOn(emailApi, { email: NEXT, token: token2, newEmail: OTHER });
check('那个地址上已经有账号：拦下来，别把两个人并成一个',
  taken.status === 409 && taken.body.error === 'taken', JSON.stringify(taken.body));

// 拿 A 收到的码去认领 B：服务器记着「码是对着哪个地址发的」，对不上就不算。
mails = [];
await callOn(emailApi, { email: NEXT, token: token2, newEmail: 'first@example.com' });
const swapped = await callOn(emailApi, {
  action: 'confirm', email: NEXT, token: token2, newEmail: 'second@example.com', code: lastCode(),
});
check('中途把新地址换成别的，那张码不认', swapped.status === 400, String(swapped.status));
check('而且没有搬走', Boolean(await loadAccount(NEXT)));

// ---- ⑦ 那张六位码，猜错五次就作废 -------------------------------------------
//
// 六位数字只有一百万种。限速拦的是「一小时敲几次门」（而且只拦要码那一步，
// 输码这一步根本不过限速），不是「这张码被试了几次」——两件事。
//
// 少了这道闸能连成一条完整的链：坏人拿自己的账号申请搬到**别人**的地址上，
// 然后在 30 分钟里慢慢撞那六位数；撞中了，他的账号就挂在受害者的邮箱底下，
// 而受害者从此注册不了自己的邮箱——哪天真去刷卡订阅，设密码那一步会被「这
// 个地址已经有账号了」挡住，钱花了却进不去。
//
// 《忘记密码》那条路早就有这道闸（api/_unlock_legacy.js 的 MAX_TRIES），换邮箱这条
// 路一直没抄这份作业。两条路是同一件事，门也该是同一道。

const SIEGE = 'siege-one@example.com';
mails = [];
await callOn(emailApi, { email: NEXT, token: token2, newEmail: SIEGE, lang: 'en' });
const realCode = lastCode();
const guess = (code) =>
  callOn(emailApi, { action: 'confirm', email: NEXT, token: token2, newEmail: SIEGE, code });

const wrongs = [];
for (let i = 0; i < 5; i++) wrongs.push((await guess('000000')).status);
check('前 5 次猜错，如实答「码不对」', wrongs.every((c) => c === 401), wrongs.join(','));

// 第 6 次故意拿**对的**码来：闸在比对之前，所以它也进不去。
const sixth = await guess(realCode);
check('第 6 次连拿对的码也被挡下（闸在比对之前）', sixth.status === 429, String(sixth.status));

const afterBurn = await guess(realCode);
check('这张码已经作废了，重新要一张才行', afterBurn.status === 400, String(afterBurn.status));
check('而且没搬走', Boolean(await loadAccount(NEXT)) && !(await loadAccount(SIEGE)));

// 同时打进来的 50 次：也只有 5 次能摸到那张码。
//
// 这一条是拿来钉住「计数是一步做完的」的。原先那个写法（读一次次数 → 判断
// → 加一写回去）在一个一个发的时候是对的，上面那五条会全绿，可门是虚掩
// 的：并发打进来的请求会一起通过「还没到 5 次」那一关，然后一起猜。
const SIEGE2 = 'siege-two@example.com';
mails = [];
await callOn(emailApi, { email: NEXT, token: token2, newEmail: SIEGE2, lang: 'en' });
const swarmed = await Promise.all(
  Array.from({ length: 50 }, () =>
    callOn(emailApi, { action: 'confirm', email: NEXT, token: token2, newEmail: SIEGE2, code: '000000' })),
);
const compared = swarmed.filter((r) => r.status !== 429).length;
check('50 次并发，只有 5 次摸得到那张码', compared === 5, `摸到 ${compared} 次`);

// ---- ⑧ 搬家那段的**形状**：回滚只许守「改名之前」那一步 --------------------
//
// 这一节读源码，不量行为——因为量不了：要走到那条路上，得让 `renameScoreOwner` 成功而紧接着
// 的 `deleteAccount` 失败，而进程内那份 store 的 `del` 不会抛。没有缝可以注入，而这件事又太
// 贵，所以钉它的形状（和 check-grant-callsite.mjs 同一个路子：位置本身就是正确性）。
//
// ⚠️ **那条路真的弄坏过东西。** 原先那个 try 把四步打扫也一起包着：
//
//     try { 改名; 删旧账号; 清计数; 删码; 删猜测计数 } catch { 删掉新地址的账号; throw }
//
// 于是「改名成功了、删旧账号摔了」这一种，catch 照旧把刚占住的新地址删掉——可榜上那些行已经
// 改名成新地址了。结果是：账号还在旧地址（删失败了），战绩和排行榜上的成员名却指着一个**没
// 有账号的地址**。玩家那边看到「出错了，重试」，重来一次 `renameScoreOwner(旧, 新)` 在旧地址
// 底下什么也找不着——他的云端战绩和榜上的位置就这么没了，而两边都不报错。
//
// 所以回滚只守「改名之前」那一段。改名一旦成了，这次搬家就算成了，后面那几步只是打扫：每一
// 步摔了都只记一笔日志，绝不回滚、绝不抛。
{
  const strip = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  /** 判一份 email.js 的五条，返回红了的那几条。纯函数，好喂下面那几份改坏的。 */
  function judgeMove(raw) {
    const src = strip(raw);
    const bad = [];
    // 认的是「占住新地址」这一下，不认括号里写进去的是哪一份：7-8 起免邮箱账号绑邮箱也走这条路，
    // 写进去的那份先过一道 bound()（抹掉第二串、记上已验证），一字不差地认原来那句会把这一节整个判成
    // noClaim——位置没变，变的只是参数。
    const claim = /createAccount\(wanted, [^;]*\)/.exec(src);
    if (!claim) return ['noClaim'];
    const at = claim.index;
    const rest = src.slice(at);
    const tryAt = rest.indexOf('try {');
    const catchAt = rest.indexOf('} catch (err) {');
    const sweepAt = rest.indexOf('const sweep = [');
    if (tryAt < 0 || catchAt < 0 || sweepAt < 0) return ['noShape'];
    const guarded = rest.slice(tryAt, catchAt);       // 回滚守着的那一段
    const rescue = rest.slice(catchAt, sweepAt);      // catch 那一段
    const sweep = rest.slice(sweepAt);                // 打扫那一段

    // ① 守着的那一段里只有改名。
    if (!guarded.includes('renameScoreOwner(')) bad.push('guardsRename');
    // ② 而且**只有**它：删旧账号、清计数、删码都不许在里面。
    if (/deleteAccount\(|clearFails\(|\bdel\(/.test(guarded)) bad.push('tryTooWide');
    // ③ catch 里退回新地址（那是回滚的全部内容）。
    if (!rescue.includes('deleteAccount(wanted)')) bad.push('rollsBack');
    // ④ 打扫那一段真的在删旧地址。
    if (!sweep.includes('deleteAccount(address)')) bad.push('sweepsOld');
    // ⑤ 打扫那一段**绝不**碰新地址的账号。
    if (sweep.includes('deleteAccount(wanted)')) bad.push('sweepTouchesNew');
    return bad;
  }

  const { readFileSync } = await import('node:fs');
  const real = readFileSync(new URL('../api/email.js', import.meta.url), 'utf8');
  const got = judgeMove(real);
  check('⑧ api/email.js：搬家那段的位置和形状', got.length === 0, got.join(' '));

  const CONTROLS = [
    ['把「删旧账号」放回那个 try 里', 'tryTooWide',
      (t) => t.replace('    await renameScoreOwner(address, wanted);',
                       '    await renameScoreOwner(address, wanted);\n    await deleteAccount(address);')],
    ['打扫那一段顺手把新地址也删了', 'sweepTouchesNew',
      (t) => t.replace("['旧地址上的账号没删掉（玩家已经搬好了，这一份要手删）', () => deleteAccount(address)],",
                       "['旧地址上的账号没删掉（玩家已经搬好了，这一份要手删）', () => deleteAccount(wanted)],")],
    ['catch 里不退回新地址（于是重来一次被自己的半成品拦死）', 'rollsBack',
      (t) => t.replace('    await deleteAccount(wanted).catch(() => {});', '')],
    ['改名压根不在那个 try 里（摔了也不回滚）', 'guardsRename',
      (t) => t.replace('    await renameScoreOwner(address, wanted);', '    // 挪走了')],
  ];
  for (const [name, want, fn] of CONTROLS) {
    const broken = fn(real);
    if (broken === real) {
      check(`⑧ 反向对照：${name}`, false, '没改动任何东西（对照本身失效了）');
      continue;
    }
    const bad = judgeMove(broken);
    check(`⑧ 反向对照：${name} → 要红在 ${want}`, bad.includes(want),
      bad.length ? `实际红了：${bad.join(' ')}` : '实际全绿（空绿）');
  }
}

console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

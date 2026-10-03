/**
 * 没取名字的人，进小屋叫什么。
 *
 *   ALLOW_MEMORY_STORE=1 node scripts/check-room-names.mjs
 *
 * 不起浏览器也不起服务器：直接叫 api/room.js 的 handler，用内存里那个 Redis
 * 替身。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 查的是什么
 *
 * 从前名字栏空着就把占位那句话（《起个名字》/「Host」/「Player」）当名字用。
 * 两件事因此出错：
 *
 *   · 一屋子人可以全叫同一句话——排行榜上谁是谁看不出来，第二个进来的还会
 *     被加编号成「起个名字 2」，更难看；
 *   · 座位认领是按名字认的（走了又回来的人靠它拿回自己那把椅子、那份分
 *     数）。名字人人一样，认到的就可能是别人的椅子。
 *
 * 现在空名字由服务器发一个字母：A、B、C……屋里没被占的第一个。这个文件把
 * 「不重复」和「认领不串门」两件事各验一遍。
 * ─────────────────────────────────────────────────────────────────────────
 */
process.env.ALLOW_MEMORY_STORE = '1';

const { default: handler } = await import('../api/room.js');
const accounts = await import('../api/_accounts.js');

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/** 叫一次接口，把状态码和回包一起拿回来。 */
async function call(body) {
  const req = { method: 'POST', body, headers: {} };
  const res = {
    code: 200,
    payload: null,
    status(c) { res.code = c; return res; },
    setHeader() { return res; },
    end(text) {
      try { res.payload = JSON.parse(text); } catch { res.payload = text; }
      return res;
    },
  };
  await handler(req, res);
  return { status: res.code, payload: res.payload };
}

const AVATAR = { shape: 'circle', hue: 10 };

/** 开小屋是天才才有的事，所以先造一个开通着的账号，屋主用它的令牌。 */
const hostAccount = accounts.newAccount('secret', 'code');
hostAccount.until = Date.now() + 30 * 24 * 3600e3;
await accounts.saveAccount('host@example.com', hostAccount);
const hostProof = { email: 'host@example.com', accountToken: hostAccount.token };

const nameOf = (state, id) => state.players.find((p) => p.id === id)?.name;
const namesIn = (state) => state.players.map((p) => p.name);

// ---------------------------------------------------------------------------
// 1. 一个都不取名字：A、B、C，各不相同
// ---------------------------------------------------------------------------
const made = await call({ action: 'create', name: '', avatar: AVATAR, ...hostProof });
if (made.status !== 200) {
  console.error('开不了小屋，后面没法验：', made.status, JSON.stringify(made.payload));
  process.exit(2);
}
const code = made.payload.code;
const host = made.payload.playerId;
check('屋主没取名字 → A', nameOf(made.payload.state, host) === 'A', String(nameOf(made.payload.state, host)));

const b = await call({ action: 'join', code, name: '', avatar: AVATAR });
check('第二个没取名字的 → B', nameOf(b.payload.state, b.payload.playerId) === 'B', String(nameOf(b.payload.state, b.payload.playerId)));

const c = await call({ action: 'join', code, name: '', avatar: AVATAR });
check('第三个没取名字的 → C', nameOf(c.payload.state, c.payload.playerId) === 'C', String(nameOf(c.payload.state, c.payload.playerId)));

{
  const names = namesIn(c.payload.state);
  check('三个人三个名字，一个不重', new Set(names).size === names.length, names.join(' / '));
  check('没有人叫占位那句话', !names.some((n) => /起个名字|起個名字|Pick a name|Choisissez|Host|Player/.test(n)), names.join(' / '));
}

// ---------------------------------------------------------------------------
// 2. 取了名字的人照旧用自己的名字；字母只发给空着的
// ---------------------------------------------------------------------------
const named = await call({ action: 'join', code, name: '阿甲', avatar: AVATAR });
check('取了名字的人就叫那个名字', nameOf(named.payload.state, named.payload.playerId) === '阿甲', String(nameOf(named.payload.state, named.payload.playerId)));

const d = await call({ action: 'join', code, name: '', avatar: AVATAR });
check('接下来没取名字的 → D（跳过已占的 A/B/C，不管中间夹了谁）', nameOf(d.payload.state, d.payload.playerId) === 'D', String(nameOf(d.payload.state, d.payload.playerId)));

// ---------------------------------------------------------------------------
// 3. 屋里已经有人自己取名叫 B：字母要跳过它
// ---------------------------------------------------------------------------
{
  const made2 = await call({ action: 'create', name: 'A', avatar: AVATAR, ...hostProof });
  const code2 = made2.payload.code;
  await call({ action: 'join', code: code2, name: 'b', avatar: AVATAR }); // 小写，一样算占了
  const e = await call({ action: 'join', code: code2, name: '', avatar: AVATAR });
  check('有人自己取名叫 A 和 b，发的是 C（大小写都算占了）', nameOf(e.payload.state, e.payload.playerId) === 'C', String(nameOf(e.payload.state, e.payload.playerId)));
}

// ---------------------------------------------------------------------------
// 4. 认领座位不串门：报空名字的人拿不走别人的椅子
// ---------------------------------------------------------------------------
{
  const made3 = await call({ action: 'create', name: '', avatar: AVATAR, ...hostProof });
  const code3 = made3.payload.code;
  const gone = await call({ action: 'join', code: code3, name: '', avatar: AVATAR });
  const goneId = gone.payload.playerId;
  const goneName = nameOf(gone.payload.state, goneId);
  check('走之前他叫 B', goneName === 'B', String(goneName));
  await call({ action: 'leave', code: code3, playerId: goneId, playerToken: gone.payload.playerToken });

  // 另一个人，同样没取名字：不该捡到刚才那把椅子。
  const stranger = await call({ action: 'join', code: code3, name: '', avatar: AVATAR });
  check(
    '另一个空名字的人进来，不认领走掉那把椅子',
    stranger.payload.playerId !== goneId && !stranger.payload.rejoined,
    `${stranger.payload.playerId} vs ${goneId}`,
  );

  // 走掉那个人自己回来（网页记着他领到的字母，报的就是它）：椅子还他。
  const backAgain = await call({ action: 'join', code: code3, name: goneName, avatar: AVATAR });
  check('他自己报着领到的字母回来，认得出是同一把椅子', backAgain.payload.rejoined === true && backAgain.payload.playerId === goneId, JSON.stringify({ rejoined: backAgain.payload.rejoined, id: backAgain.payload.playerId }));

  // 他不在的时候，B 这个字母已经被刚才那个陌生人拿走了：回来得换一个，
  // 否则屋里两个 B，排行榜上分不出谁是谁。
  const names = namesIn(backAgain.payload.state);
  check('回来的人不和屋里现有的人重名', new Set(names.map((n) => n.toLowerCase())).size === names.length, names.join(' / '));
  check('换的还是一个字母，不是「B 2」', /^[A-Z]$/.test(String(nameOf(backAgain.payload.state, goneId))), String(nameOf(backAgain.payload.state, goneId)));
}

// ---------------------------------------------------------------------------
// 5. 自己取名字的人走了又回来：名字被占了就加编号，不会被换成一个字母
// ---------------------------------------------------------------------------
{
  const made4 = await call({ action: 'create', name: '', avatar: AVATAR, ...hostProof });
  const code4 = made4.payload.code;
  const jia = await call({ action: 'join', code: code4, name: '阿甲', avatar: AVATAR });
  await call({ action: 'leave', code: code4, playerId: jia.payload.playerId, playerToken: jia.payload.playerToken });
  await call({ action: 'join', code: code4, name: '阿甲', avatar: AVATAR }); // 另一个人占了这个名字
  const backJia = await call({ action: 'join', code: code4, name: '阿甲', avatar: AVATAR });
  const backName = String(nameOf(backJia.payload.state, backJia.payload.playerId));
  check('自己取的名字被占了，加编号而不是换成字母', backName.startsWith('阿甲') && backName !== '阿甲', backName);
}

// ---------------------------------------------------------------------------
// 6. 第 16 推：座位名和帐号昵称
//
// 方案那三条，外加「局中改名」那一条规矩：
//   · 座位名（发的字母、加的「 2」、没登记昵称的人敲的名字）不写进昵称；
//   · 没登录的人撞上一个帐号登记的昵称，直接给「名字 2」；
//   · 登录的人拿原名——屋里叫他的帐号昵称，名字栏里敲的不算；
//   · 局中某人把昵称改成屋里没登录的人正用着的名字：改名的人显示「 2」，不动别人。
// ---------------------------------------------------------------------------
{
  const { default: scores } = await import('../api/scores.js');
  const store = await import('../api/_store.js');
  async function scoreCall(body) {
    const out = { code: 0, payload: null };
    await scores(
      { method: 'POST', body, headers: { 'x-vercel-forwarded-for': '10.7.0.1' } },
      { status(c) { out.code = c; return this; }, setHeader() {}, end(t) { out.payload = JSON.parse(t); } },
    );
    return { status: out.code, payload: out.payload };
  }
  /** 一个开通了的帐号；`nick` 给了就从改名接口登记。 */
  async function account(email, nick) {
    const acc = accounts.newAccount('secret', 'code');
    acc.until = Date.now() + 30 * 24 * 3600e3;
    await accounts.saveAccount(email, acc);
    const proof = { email, accountToken: acc.token };
    if (nick) {
      const r = await scoreCall({ action: 'name', email, token: acc.token, name: nick });
      if (r.status !== 200) throw new Error(`登记昵称失败：${email} ${r.status} ${JSON.stringify(r.payload)}`);
    }
    return proof;
  }
  const names = async () => store.hgetall('lbnames');

  const hua = await account('hua@example.com', '阿花');
  const quiet = await account('quiet@example.com');            // 登录了、没登记昵称
  const made6 = await call({ action: 'create', name: '', avatar: AVATAR, ...hostProof });
  const code6 = made6.payload.code;

  // ① 没登录的人撞上已登记的昵称 → 「阿花 2」。
  const anon = await call({ action: 'join', code: code6, name: '阿花', avatar: AVATAR });
  const anonName = nameOf(anon.payload.state, anon.payload.playerId);
  check('⑥ 没登录的人敲了「阿花」（某个帐号登记的昵称）→ 屋里叫「阿花 2」', anonName === '阿花 2', String(anonName));

  // ② 登录的人拿原名——哪怕名字栏里敲的是别的。
  const owner = await call({ action: 'join', code: code6, name: '随便敲的', avatar: AVATAR, ...hua });
  const ownerName = nameOf(owner.payload.state, owner.payload.playerId);
  check('⑥ 登录的「阿花」进屋 → 叫「阿花」（帐号昵称，名字栏里敲的不算）', ownerName === '阿花', String(ownerName));
  // 尺子：同一个帐号的凭证换成错的令牌，就认不出他，名字栏里敲的那个照用。
  const forged = await call({ action: 'join', code: code6, name: '冒名', avatar: AVATAR, email: 'hua@example.com', accountToken: 'wrong' });
  check('（尺子）⑥ 报着阿花的邮箱、令牌不对 → 认不出，叫他自己敲的「冒名」',
    nameOf(forged.payload.state, forged.payload.playerId) === '冒名', String(nameOf(forged.payload.state, forged.payload.playerId)));

  // ③ 座位名不写进昵称：发的字母、「 2」、没登记昵称的人敲的名字。
  const before = await names();
  const letter = await call({ action: 'join', code: code6, name: '', avatar: AVATAR, ...quiet });
  const typedQuiet = await call({ action: 'join', code: code6, name: '小安', avatar: AVATAR, ...quiet });
  const after = await names();
  check('（尺子）⑥ 登录了、没昵称的人空着名字进屋，领到一个字母',
    /^[A-Z]$/.test(String(nameOf(letter.payload.state, letter.payload.playerId))), String(nameOf(letter.payload.state, letter.payload.playerId)));
  check('（尺子）⑥ 他敲了「小安」再进一次，座位就叫「小安」',
    nameOf(typedQuiet.payload.state, typedQuiet.payload.playerId) === '小安');
  check('⑥ 座位名一个都没写进昵称（lbnames 进屋前后一模一样）', JSON.stringify(after) === JSON.stringify(before),
    `${Object.keys(before).length} → ${Object.keys(after).length}`);
  check('⑥ 「阿花 2」没变成谁的昵称，「阿花」还是阿花的', after['hua@example.com']?.name === '阿花' &&
    !Object.values(after).some((r) => r?.name === '阿花 2'));

  // ④ 局中改名：屋里没登录的人正用着「小红」，阿花把昵称改成「小红」→ 屋里她叫「小红 2」。
  const red = await call({ action: 'join', code: code6, name: '小红', avatar: AVATAR });
  check('（尺子）⑥ 没登录的「小红」坐下了', nameOf(red.payload.state, red.payload.playerId) === '小红');
  const changed = await scoreCall({ action: 'name', email: 'hua@example.com', token: hua.accountToken, name: '小红' });
  check('（尺子）⑥ 阿花把昵称改成「小红」（全站没人登记过，改得成）', changed.status === 200, `${changed.status}`);
  const moved = await call({
    action: 'rename', code: code6, playerId: owner.payload.playerId, playerToken: owner.payload.playerToken, ...hua,
  });
  const st = moved.payload.state;
  check('⑥ 局中改名：改名的人在屋里叫「小红 2」', nameOf(st, owner.payload.playerId) === '小红 2', String(nameOf(st, owner.payload.playerId)));
  check('⑥ 先坐下的那个「小红」一个字没动', nameOf(st, red.payload.playerId) === '小红', String(nameOf(st, red.payload.playerId)));
  // 改名这条路不收请求里报的名字：座位名只能是那个帐号此刻的昵称。
  const sneaky = await call({
    action: 'rename', code: code6, playerId: owner.payload.playerId, playerToken: owner.payload.playerToken, ...hua, name: '管理员',
  });
  check('⑥ 局中改名不收请求里报的名字（报「管理员」也还是「小红 2」）', nameOf(sneaky.payload.state, owner.payload.playerId) === '小红 2');
  const noAuth = await call({ action: 'rename', code: code6, playerId: owner.payload.playerId, playerToken: owner.payload.playerToken });
  check('⑥ 局中改名不带帐号凭证 → 401', noAuth.status === 401, `${noAuth.status}`);

  // ⑤ 没登录的人敲的名字也过同一道关：词表、长度；单个字母照收（那是小屋的规矩）。
  const bad1 = await call({ action: 'join', code: code6, name: '官方客服', avatar: AVATAR });
  check('⑥ 没登录的人敲「官方客服」→ 400 blocked，不进屋', bad1.status === 400 && bad1.payload?.error === 'blocked', `${bad1.status} ${JSON.stringify(bad1.payload)}`);
  const bad2 = await call({ action: 'join', code: code6, name: 'abcdefghijklm', avatar: AVATAR });
  check('⑥ 没登录的人敲 13 个字 → 400 bad（不截断）', bad2.status === 400 && bad2.payload?.error === 'bad', `${bad2.status} ${JSON.stringify(bad2.payload)}`);
  const okLetter = await call({ action: 'join', code: code6, name: 'q', avatar: AVATAR });
  check('（尺子）⑥ 单个字母照收（昵称不收，小屋里收）', okLetter.status === 200, `${okLetter.status}`);
}

// ---------------------------------------------------------------------------
// 7. 网页那一头：名字栏不再读座位字母，服务器给的名字不写回来（读源码）
// ---------------------------------------------------------------------------
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/ui/multiplayer.ts', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  check('⑦ 不再读写 slides_mp_seat_name', !code.includes('slides_mp_seat_name') && !code.includes('ASSIGNED_NAME_KEY'));
  check('⑦ 名字栏预填的是昵称（getNickname）', /const savedName = getNickname\(\);/.test(code));
  const writes = code.match(/localStorage\.setItem\(NAME_KEY,[^)]*\)/g) || [];
  check('⑦ 写昵称缓存只有一处，写的是他自己敲的（没登录那一支）', writes.length === 1 && writes[0].includes('typed'), writes.join(' | '));
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

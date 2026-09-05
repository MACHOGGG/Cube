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

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

/**
 * 几个人同时按《加入》，会不会撞出两个一样的名字 / 头像。
 *
 *   ALLOW_MEMORY_STORE=1 node scripts/check-room-join-race.mjs
 *
 * 不起浏览器也不起服务器：直接叫 api/room.js 的 handler，用内存里那个 Redis
 * 替身。同时发请求，就是不 await 前一个、把几个 Promise 一起交给 Promise.all
 * ——每个 await 都会让出一次，几条 join 于是真的交错着跑，和几台手机同时按下
 * 去是一回事。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 查的是什么
 *
 * join() 里三件事各自要「屋里现在有谁」：发字母（freeLetter）、昵称去重
 * （uniqueName）、头像去重（avatarCandidates + claimTag）。占座位那一步是原子的
 * （claimSlot 走 HSETNX），这三件事却不是——从前它们吃的是函数一进来读的那
 * 一份旧快照，占完座位也没有重读。于是一群朋友几乎同时点《加入》：
 *
 *   · 两个都没填名字的人，各自坐进不同的座位，却都叫「A」；
 *   · 两个用了同一个常见昵称的人，也可能都判成「没重复」。
 *
 * 排行榜、结算图上就出现两行一模一样的名字——而这份代码自己的注释写着这正
 * 是要避免的事。座位认领还是按名字认的，名字一样就可能认到别人的椅子上去。
 *
 * 现在这三件事都改成原子的：名字先用 HSETNX 抢一把锁（n:<小写名字>），抢不
 * 到就往下试 A、B、C……或者「名字 2」「名字 3」；头像同理（a:<形状:色相格>）。
 * 抢锁和占座位用的是同一个 Redis 原语，两台手机同时按也只有一台抢得到。
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

const hostAccount = accounts.newAccount('secret', 'code');
hostAccount.until = Date.now() + 30 * 24 * 3600e3;
await accounts.saveAccount('race@example.com', hostAccount);
const hostProof = { email: 'race@example.com', accountToken: hostAccount.token };

/** 开一间屋，屋主自己取好名字，免得占掉待验的字母。 */
async function freshRoom() {
  const made = await call({ action: 'create', name: '屋主', avatar: { shape: 'square', hue: 200 }, ...hostProof });
  if (made.status !== 200) {
    console.error('开不了小屋，后面没法验：', made.status, JSON.stringify(made.payload));
    process.exit(2);
  }
  return made.payload.code;
}

/** 屋里现在这些人叫什么 / 用什么头像。以最后一次回包为准。 */
const namesIn = (state) => state.players.map((p) => p.name);
const avatarsIn = (state) =>
  state.players.map((p) => (p.avatar ? `${p.avatar.shape}:${p.avatar.hue}` : '—'));

const dupes = (list) => list.filter((v, i) => list.indexOf(v) !== i);

// ---------------------------------------------------------------------------
// 1. 四个人同时进，一个名字都不填
// ---------------------------------------------------------------------------
{
  const code = await freshRoom();
  const rounds = await Promise.all(
    [0, 1, 2, 3].map(() => call({ action: 'join', code, name: '', avatar: AVATAR })),
  );
  const ok = rounds.every((r) => r.status === 200);
  check('四个空名字同时进，都进得来', ok, ok ? '' : rounds.map((r) => r.status).join('/'));
  if (ok) {
    const state = (await call({ action: 'state', code, playerId: rounds[0].payload.playerId, playerToken: rounds[0].payload.playerToken })).payload;
    const names = namesIn(state);
    const d = dupes(names);
    check('四个人四个名字，一个不重', d.length === 0, names.join(' / ') + (d.length ? ' ← 撞了：' + d.join('、') : ''));
  }
}

// ---------------------------------------------------------------------------
// 2. 四个人同时进，用的是同一个常见昵称
// ---------------------------------------------------------------------------
{
  const code = await freshRoom();
  const rounds = await Promise.all(
    [0, 1, 2, 3].map(() => call({ action: 'join', code, name: '小明', avatar: AVATAR })),
  );
  const ok = rounds.every((r) => r.status === 200);
  check('四个同名的人同时进，都进得来', ok, ok ? '' : rounds.map((r) => r.status).join('/'));
  if (ok) {
    const state = (await call({ action: 'state', code, playerId: rounds[0].payload.playerId, playerToken: rounds[0].payload.playerToken })).payload;
    const names = namesIn(state);
    const d = dupes(names);
    check('同名的人自动加了编号，谁也不和谁重', d.length === 0, names.join(' / ') + (d.length ? ' ← 撞了：' + d.join('、') : ''));
  }
}

// ---------------------------------------------------------------------------
// 3. 四个人同时进，挑了同一个头像
// ---------------------------------------------------------------------------
{
  const code = await freshRoom();
  const rounds = await Promise.all(
    ['甲', '乙', '丙', '丁'].map((n) => call({ action: 'join', code, name: n, avatar: AVATAR })),
  );
  const ok = rounds.every((r) => r.status === 200);
  check('四个同头像的人同时进，都进得来', ok, ok ? '' : rounds.map((r) => r.status).join('/'));
  if (ok) {
    const state = (await call({ action: 'state', code, playerId: rounds[0].payload.playerId, playerToken: rounds[0].payload.playerToken })).payload;
    const avatars = avatarsIn(state);
    const d = dupes(avatars);
    check('头像被岔开，谁也不和谁重', d.length === 0, avatars.join(' / ') + (d.length ? ' ← 撞了：' + d.join('、') : ''));
  }
}

// ---------------------------------------------------------------------------
// 4. 挨个进（不并发）的老路子没被改坏：A、B、C 照旧
// ---------------------------------------------------------------------------
{
  const code = await freshRoom();
  const a = await call({ action: 'join', code, name: '', avatar: AVATAR });
  const b = await call({ action: 'join', code, name: '', avatar: AVATAR });
  const c = await call({ action: 'join', code, name: '', avatar: AVATAR });
  const got = [a, b, c].map((r) => r.payload.state.players.find((p) => p.id === r.payload.playerId)?.name);
  check('一个一个进，还是 A、B、C', got.join(',') === 'A,B,C', got.join(' / '));
}

// ---------------------------------------------------------------------------
// 5. 离开 → 满员 → 重进得 409 full → 空出座位 → 再重进成功（第 14 推）
// ---------------------------------------------------------------------------
//
// 走了的人回来，走的是「认领原来那个座位」那条路：先抢一把认领锁（claimKey），再占一把椅
// 子。椅子满了的时候，原先锁没还回去——他等到有人起身、再按一次《加入》，撞上的是自己上
// 一次留下的那把锁，答的是 claimed，而且这间屋子活着一天就一直是 claimed。
{
  const code = await freshRoom();
  const x = await call({ action: 'join', code, name: '回来的人', avatar: AVATAR });
  check('（尺子）回来的人先进得来', x.status === 200, String(x.status));
  await call({ action: 'leave', code, playerId: x.payload.playerId, playerToken: x.payload.playerToken });
  // 屋主一把 + 七个人，八把椅子坐满。
  const others = [];
  for (let i = 1; i <= 7; i++) others.push(await call({ action: 'join', code, name: '客' + i, avatar: AVATAR }));
  check('（尺子）另外七个人都进来了，屋里坐满', others.every((r) => r.status === 200), others.map((r) => r.status).join('/'));
  const full = await call({ action: 'join', code, name: '回来的人', avatar: AVATAR });
  check('满员时回来：409 full（不是 claimed）', full.status === 409 && full.payload?.error === 'full',
    `${full.status} ${JSON.stringify(full.payload)}`);
  const seven = others[6].payload;
  await call({ action: 'leave', code, playerId: seven.playerId, playerToken: seven.playerToken });
  const back = await call({ action: 'join', code, name: '回来的人', avatar: AVATAR });
  check('空出一把椅子之后再回来：进得来', back.status === 200, `${back.status} ${back.payload?.error ?? ''}`);
  check('而且回的是原来那个座位（同一个 playerId）', back.payload?.playerId === x.payload.playerId,
    `${back.payload?.playerId} / ${x.payload.playerId}`);
}

console.log(fail ? `\n${fail} 项没过。` : '\n全部通过。');
process.exit(fail ? 1 : 0);

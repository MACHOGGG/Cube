/**
 * 后台发码这条链，端到端跑一遍。
 *
 *   node scripts/check-inbox.mjs
 *
 * 不碰浏览器，也不起服务器：直接把几个 api/ 的 handler 请进来，喂一个假的
 * req/res。这条链横跨四个文件（名单在 _accounts、发码在 mint、码本身在
 * _codes、玩家那头在 subscription），任何一环对不上都会在这里露出来。
 *
 * 名单那一条是这里查出来的：第一版把还没绑邮箱的码寄存处（code:XXXXXX）
 * 也算成了玩家，后台会看到一堆叫 code:seed01 的「人」，还能勾中给它发码。
 */
// 内存版存储，进程一关就没：这个检查不该碰到任何真实数据。
process.env.ALLOW_MEMORY_STORE = '1';
process.env.ADMIN_TOKEN = 'test-admin-token-1234567890';
const A = new URL('../api/', import.meta.url).href;
const { set, setnx } = await import(A + '_store.js');
const accounts = await import(A + '_accounts.js');
const redeem = (await import(A + 'redeem.js')).default;
const mint = (await import(A + 'mint.js')).default;
const passcode = (await import(A + 'passcode.js')).default;
const subscription = (await import(A + 'subscription.js')).default;

const req = (body) => ({ method: 'POST', headers: { 'x-forwarded-for': '9.9.9.9' }, body,
  on(ev, fn) { if (ev==='data') fn(Buffer.from(JSON.stringify(body))); if (ev==='end') fn(); } });
const res = () => { const r = { code:0, payload:null, setHeader(){return r}, status(c){r.code=c;return r},
  json(o){r.payload=o;return r}, writeHead(c){r.code=c;return r}, send(o){r.payload=o;return r},
  end(s){ try{r.payload=JSON.parse(s)}catch{r.payload=s} return r } }; return r; };
let fail=0; const check=(n,ok,x='')=>{console.log(`${ok?'PASS':'FAIL'}  ${n}${x?'  '+x:''}`); if(!ok)fail++;};

// 1. 先弄一个玩家出来：兑一张码，再绑邮箱和密码
await set('code:SEED01', { plan: 'month' });
let r = res(); await redeem(req({ code: 'SEED01' }), r);
const holderCode = r.payload.code;
const r0token = r.payload.token;
r = res(); await passcode(req({ action:'bind', code: holderCode, token: r0token, email:'wan@example.com', password:'abc123' }), r);
check('玩家建好了', r.code === 200, JSON.stringify(r.payload).slice(0,60));
const token = r.payload.token;

// 2. 名单里能看到他
r = res(); await mint(req({ token: process.env.ADMIN_TOKEN, action:'list' }), r);
check('名单里列得出这个玩家', r.code===200 && r.payload.players.some(p=>p.email==='wan@example.com'),
      JSON.stringify(r.payload.players));

// 3. 给他发 3 张半年码，30 天到期
r = res(); await mint(req({ token: process.env.ADMIN_TOKEN, action:'grant', emails:['wan@example.com'],
                            plan:'half', count:3, expiresInDays:30 }), r);
check('发码成功', r.code===200 && r.payload.sent[0].codes.length===3, JSON.stringify(r.payload.sent[0]));
const given = r.payload.sent[0].codes;

// 4. 他登录时能看到这 3 张
r = res(); await subscription(req({ email:'wan@example.com', token }), r);
check('登录能看到收到的码', (r.payload.inbox||[]).length===3, JSON.stringify(r.payload.inbox));
check('提示计数是 3', r.payload.inboxUnseen===3, String(r.payload.inboxUnseen));
check('每张都带等级和到期', (r.payload.inbox||[]).every(c=>c.plan==='half'&&c.expiresAt&&c.sentAt));
check('都还没用过', (r.payload.inbox||[]).every(c=>c.spent===false));

// 5. 用掉一张，再看
r = res(); await redeem(req({ code: given[0], email:'wan@example.com', token }), r);
check('自己兑掉一张', r.code===200, JSON.stringify(r.payload).slice(0,50));
r = res(); await subscription(req({ email:'wan@example.com', token }), r);
const used = (r.payload.inbox||[]).filter(c=>c.spent).length;
check('那一张被标成用过了', used===1, `用掉 ${used} 张`);

// 6. 点开弹窗，提示清零
r = res(); await subscription(req({ action:'seenInbox', email:'wan@example.com', token }), r);
check('标记看过', r.code===200);
r = res(); await subscription(req({ email:'wan@example.com', token }), r);
check('提示计数清零了', r.payload.inboxUnseen===0, String(r.payload.inboxUnseen));
check('码还在，没被清掉', (r.payload.inbox||[]).length===3);

// 7. 别人报个邮箱不能把提示按掉
r = res(); await subscription(req({ action:'seenInbox', email:'wan@example.com', token:'瞎编的' }), r);
check('没有 token 清不掉别人的提示', r.code===401, String(r.code));

// ---------------------------------------------------------------------------
// 8. 有一个人的账号正被别的写入锁着：他这一份 busy，别人照旧收到码
// ---------------------------------------------------------------------------
//
// 发码是「先 mintCodes 把码落进库，再 updateAccount 写进收件箱」。第二步抢不到
// 锁（约一秒八），码已经造出来了——那一批必须撤回去，否则它留在库里没人知道归
// 谁：谁知道这串字就能兑，而后台的记录里没有它，账对不平，而且后台看到 busy 多
// 半会重试，于是又造一批。
//
// 这里量的是**这条路的对外契约**，因为撤回本身量不到：内存库没有 KEYS/SCAN，
// 而造出来的码是随机的，回包里又（故意）不给，所以没有任何办法从外面数一遍库
// 里还剩几张。能钉住的是三件事，而第三件恰恰是最容易写坏的那一件——撤码那一步
// 要是把异常抛出去，整批发码当场中断，勾了两个人另一个也收不到。
//
// 锁是手动占上的（和 _accounts.js 的 updateAccount 抢同一把 acctlock:<邮箱>），
// 这比真去制造并发稳：不依赖时序，每次都必然走到 busy 那一支。
{
  await accounts.saveAccount('other@example.com', accounts.newAccount('zzz999', 'code'));
  const locked = 'acctlock:' + accounts.normalizeEmail('wan@example.com');
  const held = await setnx(locked, { at: Date.now() }, 10);
  check('先把那个账号的锁占上', held === true);

  r = res();
  await mint(req({ token: process.env.ADMIN_TOKEN, action:'grant',
                   emails:['wan@example.com','other@example.com'], plan:'month', count:2 }), r);
  const rows = (r.payload && r.payload.sent) || [];
  const stuck = rows.find(x => x.email === 'wan@example.com') || {};
  const fine = rows.find(x => x.email === 'other@example.com') || {};
  check('锁着的那个人明说是 busy，不假装成功', stuck.error === 'busy', JSON.stringify(stuck));
  check('锁着的那个人一张码都没拿到', !stuck.codes, JSON.stringify(stuck.codes || null));
  check('同一批里另一个人照旧收到码（撤码那一步没把整批带崩）',
        Array.isArray(fine.codes) && fine.codes.length === 2, JSON.stringify(fine));

  // 锁着的那一份也不该悄悄写进收件箱——他手上还是原来那三张。
  r = res(); await subscription(req({ email:'wan@example.com', token }), r);
  check('锁着的那个人收件箱没变（还是 3 张）', (r.payload.inbox||[]).length===3,
        String((r.payload.inbox||[]).length));
}

console.log(fail ? `\n${fail} 条没过` : '\nALL PASS');
process.exit(fail?1:0);

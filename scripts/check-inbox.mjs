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
const { set } = await import(A + '_store.js');
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

console.log(fail ? `\n${fail} 条没过` : '\nALL PASS');
process.exit(fail?1:0);

/**
 * 注册那条路：从「填邮箱 + 六位密码」一直走到「用同一组凭据登录回来」。
 *
 *   GENIUS_GRANT_WINDOW=1 node scripts/dev-server.mjs 8993 dist &
 *   node scripts/check-register.mjs http://localhost:8993/
 *
 * 环境变量只要一个。原先还要 `GENIUS_GRANT_LIMIT=2`，因为那时名额有限（第一批 100 个），
 * 这道门要量「满了会怎么样」——把上限压到 2，第三个人就撞在边界上。2026-10-02 名额整个撤
 * 了（E39，玩家：「不限人数」），那几节随之撤掉，`/api/slots` 也删了。
 *
 * ⚠️ **这条路是过渡期留下的**：邮箱 + 六位密码的注册（`api/passcode.js` 的 signUp）。
 * 2026-10 的改制（E37）把身份换成了邮箱验证码（`api/signin.js`）和免邮箱凭据
 * （`api/handle.js`），两条新路各有自己的门（check-signin-otp / check-handle-auth）。这
 * 一支留着是为了老账号和在途的标签页，所以这道门也留着——它量的那条路一天没撤，就一天不
 * 该没人看着。
 *
 * ── 这条路从前是个死圈 ─────────────────────────────────────────
 *
 * 2026-10 把 Creem 的两个订阅商品暂时关掉，网页端改成「注册就解锁全部功能」。可在那之前
 * 「注册」等于「订阅」——邮箱是 Creem 的结账页替我们收的，所以服务端 `api/passcode.js` 只
 * 有三支（结账 id / 兑码令牌 / 改密码），「只有邮箱和密码」这条路**不存在**；而界面上那颗
 * 《注册》键按下去是 `close(); openGeniusWindow(...)`，转回天才那一屏。玩家照着那句承诺去
 * 做，两屏之间来回转，一个账号也开不出来——而屏幕上什么都不报。
 *
 * ── 量的是什么 ────────────────────────────────────────────────
 *
 * 服务端（真起 dev-server，真发请求）：
 *   ① 注册成了，而且是**真的**一个账号——拿同一组凭据登录回来，拿到令牌；
 *   ② 窗口期里注册完就是天才（until 推到 LIFETIME_UNTIL）；
 *   ③ 同一个地址再注册答 409，**不静默合并**（理由见 passcode.js 的 signUp）；
 *   ④ 邮箱不合格 400 invalid、密码不合六位字母数字 400 weak，两条错分得开。
 *
 * 客户端（读源码）：那个死圈真的拆了，而且密码框在注册那一栏放得出来、标注对得上。
 *
 * 每条断言旁边配了尺子或反向对照。源码那一半每条都有反向对照：把源码按那一条的反面改坏
 * 一次，这道门必须跟着红。
 */
import { readFileSync } from 'node:fs';

const base = (process.argv[2] || '').replace(/\/+$/, '');
if (!base) {
  console.error('用法：node scripts/check-register.mjs http://localhost:8993/');
  console.error('（服务器要带 GENIUS_GRANT_WINDOW=1 起）');
  process.exit(2);
}

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const LIFETIME_UNTIL = Date.UTC(2999, 0, 1);
const stamp = Date.now().toString(36);
const addr = (tag) => `reg-${tag}-${stamp}@example.com`;

async function post(path, body) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // 不是 JSON：下面的断言会把状态码和它一起摆出来。
  }
  return { status: res.status, body: json };
}
const register = (email, password) => post('/api/passcode', { register: true, email, password });
const login = (email, password) => post('/api/subscription', { email, password });

// ── ① 注册 → 登录回来 ───────────────────────────────────────────
const A = addr('a');
const PW_A = 'abc123';
{
  const made = await register(A, PW_A);
  check('第一个人注册成了', made.status === 200 && made.body?.ok === true, `${made.status} ${JSON.stringify(made.body)}`);
  check('注册这一下就给了令牌（这台设备当场就是登着的）', typeof made.body?.token === 'string' && made.body.token.length > 0);

  const back = await login(A, PW_A);
  check('用同一组凭据登录回来', back.status === 200 && typeof back.body?.token === 'string', `${back.status}`);
  check('② 窗口期第一个人就是天才', back.body?.active === true, `active=${back.body?.active}`);
  check('「终身」记的是那个一千年后的日子', (back.body?.until || 0) >= LIFETIME_UNTIL, String(back.body?.until));

  // 尺子：密码真的被当成凭据了。少了这一条，上面那句「登录回来」可能只是
  // 「这个接口对谁都发令牌」。
  const wrong = await login(A, 'zzz999');
  check('（尺子）密码打错进不去', wrong.status === 401, `${wrong.status} ${JSON.stringify(wrong.body)}`);
}

// ── ③ 同一个地址再注册：409，不合并 ────────────────────────────
{
  const again = await register(A, 'xyz789');
  check('③ 同一个地址再注册答 409', again.status === 409 && again.body?.error === 'exists', `${again.status} ${JSON.stringify(again.body)}`);
  // 尺子：旧密码还好着——「不合并」必须是真的没动那份账号，而不是只回了个错。
  const still = await login(A, PW_A);
  check('（尺子）旧密码还是那一个（账号没被覆盖）', still.status === 200 && typeof still.body?.token === 'string');
}

// ── ④ 两条错分得开 ────────────────────────────────────────────
{
  const bad = await register('not-an-email', 'abc123');
  check('④ 邮箱不合格 → 400 invalid', bad.status === 400 && bad.body?.error === 'invalid', `${bad.status} ${JSON.stringify(bad.body)}`);
  const weak = await register(addr('w'), 'abc-12');
  check('④ 密码夹了符号 → 400 weak（不是 invalid）', weak.status === 400 && weak.body?.error === 'weak', `${weak.status} ${JSON.stringify(weak.body)}`);
  const short = await register(addr('s'), 'abc12');
  check('④ 密码只有五位 → 400 weak', short.status === 400 && short.body?.error === 'weak', `${short.status}`);
  const empty = await register(addr('e'), '');
  check('④ 密码空着 → 400 weak', empty.status === 400 && empty.body?.error === 'weak', `${empty.status}`);
}

// ── 不限人数：第三、第四个人照样是天才 ────────────────────────
//
// 这一节原先量的是「名额满了会怎么样」（账号照样开出来、只是不是天才）。名额撤了（E39），
// 所以反过来量：**接着注册的人不许有任何一个落空**。
//
// 为什么还值得量：撤掉计数是一次删代码，而删代码最容易留下半截——比如幂等那道短路顺手也
// 被删了（于是每次登录都重写一遍 grantedAt），或者某个判断还留着一个写死的上限。这一节
// 多造几个人走一遍，落空一个就红。
{
  for (let i = 0; i < 4; i++) {
    const who = addr(`bulk${i}`);
    const made = await register(who, `bulk${i}a`);
    check(`第 ${i + 3} 个人注册成了`, made.status === 200 && made.body?.ok === true,
      `${made.status} ${JSON.stringify(made.body)}`);
    const back = await login(who, `bulk${i}a`);
    check(`第 ${i + 3} 个人也是天才（没有上限了）`, back.body?.active === true, `active=${back.body?.active}`);
  }
}

// ── 客户端那一半：死圈真的拆了 ────────────────────────────────
const sub = readFileSync(new URL('../src/ui/subscribe.ts', import.meta.url), 'utf8');
const i18n = readFileSync(new URL('../src/i18n.ts', import.meta.url), 'utf8');

/** 只看 openAuthWindow 那一段，别被别处同名的东西骗了。 */
function authWindow(src) {
  const at = src.indexOf('export function openAuthWindow');
  return at < 0 ? '' : src.slice(at);
}

/** 判这一份 subscribe.ts 的几条，返回红了的那几条。做成纯函数，下面好喂改坏的源码。 */
function judgeUi(src) {
  const w = authWindow(src);
  const bad = [];
  // 死圈：注册那一支不许再转回天才窗口。
  const sub2 = w.slice(w.indexOf('const submit = async () =>'));
  const body = sub2.slice(0, sub2.indexOf('\n  };'));
  if (/openGeniusWindow/.test(body)) bad.push('noCircle');
  // 真提交。
  if (!/registerAccount\(/.test(body)) bad.push('callsRegister');
  // 密码栏放出来：不许再有 `fields.hidden = next === 'register'`。
  if (!/fields\.hidden\s*=\s*false/.test(w)) bad.push('fieldsShown');
  // 《忘记密码？》只在登录那一栏。
  if (!/forgot\.hidden\s*=\s*next === 'register'/.test(w)) bad.push('forgotHidden');
  // 按钮文案换成注册用的那一句，不再写「订阅」。
  if (!/go\.textContent\s*=\s*next === 'register' \? s\.registerBtn/.test(w)) bad.push('registerBtnText');
  // 给密码管理器的两套标注。
  if (!/pwInput\.autocomplete\s*=\s*next === 'register' \? 'new-password'/.test(w)) bad.push('newPassword');
  if (!/setAttribute\('minlength', '6'\)/.test(w) || !/setAttribute\('maxlength', '6'\)/.test(w)) {
    bad.push('sixChars');
  }
  // 两栏都走表单自己的 submit（管理器靠这一下认出「这是一次注册」）。
  if (/current === 'register' \? submit\(\) :/.test(w)) bad.push('viaForm');
  return bad;
}

{
  const got = judgeUi(sub);
  check('subscribe.ts：注册那一栏（死圈拆了、真提交、标注对得上）', got.length === 0, got.length ? `红了：${got.join(' ')}` : '');
}

// 四语文案：旧那句不许还在，新那句四种都要有。
{
  check('旧那句「注册就是订阅」四语都清掉了', !i18n.includes('registerIsSubscribe'));
  const n = (i18n.match(/registerHint:/g) || []).length;
  check('registerHint 一处声明 + 四种语言', n === 5, `${n} 处`);
  check('新那句里不再有「订阅 / subscri / abonne」那样的承诺',
    !/registerHint: '[^']*(订阅|訂閱|subscri|abonn)/i.test(i18n));
}

// ── 反向对照：源码那几条每一条都要量得出坏 ────────────────────
const CONTROLS = [
  ['把注册那一支改回「转回天才窗口」', 'noCircle',
    (s) => s.replace('      const made = await registerAccount(email, password);',
                     '      close(); openGeniusWindow(lang, onChanged); return;')],
  ['密码栏又藏起来', 'fieldsShown',
    (s) => s.replace('    fields.hidden = false;', "    fields.hidden = next === 'register';")],
  ['《忘记密码？》两栏都摆', 'forgotHidden',
    (s) => s.replace("    forgot.hidden = next === 'register';", '    forgot.hidden = false;')],
  ['按钮文案改回「订阅」', 'registerBtnText',
    (s) => s.replace("next === 'register' ? s.registerBtn : s.signInBtn",
                     "next === 'register' ? s.subscribeBtn : s.signInBtn")],
  ['密码管理器那套标注不换', 'newPassword',
    (s) => s.replace("    pwInput.autocomplete = next === 'register' ? 'new-password' : 'current-password';", '')],
  ['六位那两个属性去掉', 'sixChars',
    (s) => s.replace("      pwInput.setAttribute('minlength', '6');", '')],
  ['注册绕开表单自己的 submit', 'viaForm',
    (s) => s.replace("  go.addEventListener('click', () => form.requestSubmit());",
                     "  go.addEventListener('click', () => (current === 'register' ? submit() : form.requestSubmit()));")],
];

/**
 * 改坏**只能改在 openAuthWindow 那一段里**。
 *
 * 这一条是踩出来的：`go.addEventListener('click', () => form.requestSubmit());` 这一行
 * 在 subscribe.ts 里有四处一模一样的（四扇窗各一处），而 `String.replace` 配字符串只
 * 换第一处——于是那条反向对照把**另一扇窗**改坏了，被测的那一行一个字没动，断言理所当
 * 然地全绿。对照「确实改了点东西」和「改的是被测那处」是两件事。
 */
function inAuthWindow(src, fn) {
  const at = src.indexOf('export function openAuthWindow');
  if (at < 0) return src;
  const head = src.slice(0, at);
  const tail = src.slice(at);
  const next = fn(tail);
  return next === tail ? src : head + next;
}

for (const [name, want, fn] of CONTROLS) {
  const broken = inAuthWindow(sub, fn);
  if (broken === sub) {
    check(`反向对照：${name}`, false, '没改动 openAuthWindow 那一段（对照本身失效了）');
    continue;
  }
  const bad = judgeUi(broken);
  check(`反向对照：${name} → 要红在 ${want}`, bad.includes(want),
    bad.length ? `实际红了：${bad.join(' ')}` : '实际全绿（空绿）');
}

console.log(fail ? `\n${fail} 条红` : '\n全绿');
process.exit(fail ? 1 : 0);

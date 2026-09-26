/**
 * 登录／改密那几扇窗的表单件——纯 node 读源码，不开浏览器，几十毫秒，进 CI。
 *
 *   node scripts/check-auth-form.mjs
 *
 * 三件事各盯一个「错了不报错」：
 *
 * ① **那一串给密码管理器的标注一个都没被动过。** `name` / `autocomplete` / `type` 的
 *    组合是精心挑过的（见 subscribe.ts 的 credentialForm 和 openPortalWindow 上面的注
 *    释）。浮动标签这一轮把 field() 的 DOM 顺序倒了过来，最容易顺手改掉的就是它们，而
 *    改掉之后不报错、不白屏——只是密码管理器从此不再提示保存，玩家下次进来得自己打。
 *
 * ② **field() 的顺序必须是 input 在前、label 在后。** 浮动标签靠相邻兄弟选择器，而那只
 *    能往后看。哪天有人「顺手把标签挪回上面」，样式不报错、只是标签再也不浮，空着的框
 *    上两层字叠在一起。
 *
 * ③ **完成度表只挂在设新密码那几处，登录那张表不挂。** 挂错了不报错，只是登录页上多出
 *    一块「你还差几位」的仪表——而他打的是一个自己早就知道的密码。
 */
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const sub = read('src/ui/subscribe.ts');
const bits = read('src/ui/authBits.ts');
const css = read('src/style.css');

let fail = 0;
let ran = 0;
const check = (name, ok, extra = '') => {
  ran++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// ── ① 密码管理器那一串标注 ─────────────────────────────────────────
//
// 这几条是逐字抄下来的现状。它们不是「好看的写法」，是**试出来的**组合：Safari 只从表
// 单结构推断、Chromium 可以被直接告知，而 readonly 的那个地址必须留在表单里（哪怕是隐
// 藏的），否则密码管理器压根不提示保存。
const MUST_KEEP = [
  // 登录：current-password，管理器会拿它已经有的那个去填，而不是发明一个新的
  `type="password" name="password" autocomplete="current-password"`,
  // 设新密码：new-password + 正好六位
  `type="password" name="password" autocomplete="new-password" minlength="6" maxlength="6"`,
  // 改密码：旧的是凭据（current-password），新的是 new-password
  `type="password" name="current-password" autocomplete="current-password"`,
  `type="password" name="new-password" autocomplete="new-password"`,
  // 账号那一头：username，管理器靠它把密码存到「哪个账号」底下
  `type="email" name="username" autocomplete="username"`,
  // 验证码：one-time-code，iOS 的短信自动填充要它
  `autocomplete="one-time-code"`,
];
{
  const missing = MUST_KEEP.filter((frag) => !sub.includes(frag));
  check(
    `密码管理器那一串标注一个都没少（${MUST_KEEP.length} 条）`,
    missing.length === 0,
    missing.length ? '少了：' + missing.join(' | ') : '',
  );
  // 那个隐藏的 username 输入框也必须还在——注释里写明了「管理器不会提示保存，除非表单
  // 里带着一个 autocomplete="username" 的字段」。
  check('隐藏的那个 username 字段还在（不然管理器不提示保存）',
    /id="pwUser"[\s\S]{0,200}autocomplete="username"/.test(sub));
}

// ── ② field() 的顺序 ───────────────────────────────────────────────
{
  const m = sub.match(/function field\([^)]*\): string \{[\s\S]*?\n\}/);
  check('找得到 field()（下面几条才有意义）', Boolean(m));
  if (m) {
    const body = m[0];
    const iIn = body.indexOf('<input');
    const iSpan = body.indexOf('<span>');
    check('field() 里 input 排在 label 前面（浮动标签靠相邻兄弟，只能往后看）',
      iIn > 0 && iSpan > iIn, `input@${iIn} span@${iSpan}`);
    // 没给 placeholder 的字段要自动补一个空格：`:placeholder-shown` 要有它才成立。
    check('没 placeholder 的字段自动补一个空格', body.includes('placeholder=" "'), '');
  }
  // 手写 .auth-field 的那两处（多人页）也得是同一个顺序，否则那两个框的标签不浮。
  const mp = read('src/ui/multiplayer.ts');
  for (const [name, id] of [['名字', 'mpName'], ['屋号', 'mpCode']]) {
    const blk = mp.match(new RegExp(`<label class="auth-field[^"]*">[\\s\\S]{0,400}?</label>`, 'g'))
      ?.find((b) => b.includes(`id="${id}"`));
    const ok = blk && blk.indexOf('<input') < blk.indexOf('<span>');
    check(`多人页那个${name}框也是 input 在前`, Boolean(ok), blk ? '' : '找不到这一块');
  }
  // CSS 那一头：两条相邻兄弟选择器都在，而且没有用 :has()（Chrome 61 不认识它，
  // 整条规则会连着作废——这仓库为此栽过一次）。
  check('CSS 用的是相邻兄弟，不是 :has()',
    css.includes('.auth-field > input:focus + span') &&
      css.includes('.auth-field > input:not(:placeholder-shown) + span'));
  const hasInAuth = (css.match(/\.auth-field[^{\n]*:has\(/g) || []);
  check('.auth-field 那一段里没有 :has()', hasInAuth.length === 0, hasInAuth.join(' '));
}

// ── ③ 完成度表挂在哪、没挂在哪 ─────────────────────────────────────
{
  const mounted = [...sub.matchAll(/mountPwMeter\((\w+), lang\)/g)].map((m) => m[1]);
  // 设新密码的三处：注册/设密码（pwNew → 变量 input）、改密（cpwNew → newPw）、
  // 解锁（unlockPw → pwBox）。
  check('设新密码那三处都挂了完成度表', mounted.length === 3, mounted.join(' '));
  // 登录那几个框一个都不许挂。这几个 id 是 current-password 那一路。
  const loginBoxes = ['portalPw', 'authPw', 'cpwOld'];
  const wrong = loginBoxes.filter((id) => new RegExp(`mountPwMeter\\([^)]*${id}`).test(sub));
  check('登录／旧密码那几个框没挂', wrong.length === 0, wrong.join(' '));
  // 六格验证码挂在两处验证码框上（解锁、换邮箱），一处都不许挂到密码框上。
  const pins = [...sub.matchAll(/mountPin\((\w+)\)/g)].map((m) => m[1]);
  check('两处验证码框都换成了六格', pins.length === 2, pins.join(' '));
  check('六格没挂到密码框上', !pins.some((v) => /pw|Pw/.test(v)), pins.join(' '));
}

// ── ④ 两个零件本身的分寸 ───────────────────────────────────────────
{
  // 完成度表的段数由纯函数 meterFill 算（它自己的钳制和线性由 check-kinetics 钉着）。
  check('完成度表的段数走 meterFill，不自己算', bits.includes('meterFill(input.value.length)'));
  // 粘贴走 splitPastedCode，不自己写正则——码是从聊天软件复制来的，带空格、连字符。
  check('粘贴分格走 splitPastedCode', bits.includes('splitPastedCode(raw, len)'));
  // 六格**不新建 input**：焦点、粘贴、输入法、iOS 短信自动填充全走原生那一个框。
  // 六个各自独立的 input 是这类控件最常见也最常出问题的做法。
  check('六格一个 input 都没新建（只建 i 元素当格子）',
    !/createElement\('input'\)/.test(bits), '');
  // reduced-motion 下每一样都要有交代：段照样填、格子照样出字、只是不弹。
  for (const cls of ['pw-meter--full', 'pin-cell--pop', 'err-shake']) {
    const at = css.indexOf('.' + cls);
    const reduced = css.slice(at).indexOf('prefers-reduced-motion');
    check(`${cls} 接了 reduced-motion`, at > 0 && reduced > 0 && reduced < 1600, `距离 ${reduced}`);
  }
}

console.log(fail ? `\n${fail} 条没过（共 ${ran} 条）` : `\n全部通过（${ran} 条）`);
process.exit(fail ? 1 : 0);

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
/*
 * **四条密码相关的撤了**（E37，2026-10：密码整个取消）。
 *
 * 原先这张表里还有：登录那个 current-password、设新密码那个
 * `new-password minlength="6" maxlength="6"`、改密码那两个（current-password + new-password）。
 * 四扇用它们的窗全撤了（《设置密码》《改密码》《忘记密码》，以及登录窗里那个密码框），
 * 所以那四条钉的是不存在的字符串。
 *
 * 留下的两条照旧要紧：
 *   · `username` —— 管理器靠它把一份凭据存到「哪个账号」底下。免邮箱凭据那两串
 *     （E38）走的也是它（offerToSave 把第一串当 id）。
 *   · `one-time-code` —— iOS 的短信 / 邮件验证码自动填充要它，而现在**登录全靠验证码**，
 *     这一条比从前更要紧。
 */
const MUST_KEEP = [
  // 账号那一头：username，管理器靠它把密码存到「哪个账号」底下
  `type="email" name="username" autocomplete="username"`,
  // 验证码：one-time-code，iOS 的短信自动填充要它
  `autocomplete="one-time-code"`,
];
{
  const missing = MUST_KEEP.filter((frag) => !sub.includes(frag));
  check(
    `给密码管理器那几条标注一个都没少（${MUST_KEEP.length} 条）`,
    missing.length === 0,
    missing.length ? '少了：' + missing.join(' | ') : '',
  );
  // 那个 `#pwUser` 只读邮箱框属于 credentialForm（《设置密码》《改密码》两扇窗用它），
  // 两扇窗和那个函数一起撤了（E37）。现在要紧的是**还有一个** username 字段在，而且它
  // 和真输入框在同一个表单里——那是管理器提示保存的前提。
  // 认的是 field() 的调用（id 是 field() 自己拼的，源码里没有 id="authEmail" 这个串）。
  check('username 那个字段还在，而且是可见的真输入框（隐藏的管理器不信）',
    /field\('authEmail'[\s\S]{0,240}autocomplete="username"/.test(sub));
}

// ── ② field() 的顺序 ───────────────────────────────────────────────
{
  const m = sub.match(/function field\([^)]*\): string \{[\s\S]*?\n\}/);
  check('找得到 field()（下面几条才有意义）', Boolean(m));
  if (m) {
    const body = m[0];
    const iIn = body.indexOf('<input');
    // `<span` 不写成 `<span>`：那个 span 2026-10-03 起会按情形带一个 class
    // （验证码那一栏的标签只给读屏念）。认带不带尖括号的收尾，等于认「有没有属性」。
    const iSpan = body.indexOf('<span');
    check('field() 里 input 排在 label 前面（浮动标签靠相邻兄弟，只能往后看）',
      iIn > 0 && iSpan > iIn, `input@${iIn} span@${iSpan}`);
    // 没给 placeholder 的字段要自动补一个空格：`:placeholder-shown` 要有它才成立。
    check('没 placeholder 的字段自动补一个空格', body.includes('placeholder=" "'), '');
  }
  // 多人页那两个手写的 .auth-field。**它们现在不是同一种框了**，所以分开量：
  const mp = read('src/ui/multiplayer.ts');
  const blockOf = (id) => mp.match(/<label class="auth-field[\s\S]{0,500}?<\/label>/g)
    ?.find((b) => b.includes(`id="${id}"`));
  // 屋号那个框照旧是浮动标签那一套：input 在前、span 在后（相邻兄弟只能往后看）。
  {
    const blk = blockOf('mpCode');
    check('多人页那个屋号框是 input 在前',
      Boolean(blk && blk.indexOf('<input') < blk.indexOf('<span>')), blk ? '' : '找不到这一块');
  }
  // 名字那个框**一层字都不许多**：设计稿上那格里就写着一句浅色的占位字，而这一页又把
  // 占位字改成一直看得见——再挂一个浮动标签，两行字就叠印在同一处（玩家 2026-09 拍到
  // 的「严重的覆盖、穿模」）。所以这儿量的是「没有那一层」，不是「顺序对不对」：
  // 标签那句话移进了 aria-label，看不见屏幕的人照旧听得到。
  {
    const blk = blockOf('mpName');
    check('多人页那个名字框只有一层字（没有浮动标签那个 span）',
      Boolean(blk && !blk.includes('<span')), blk ? blk.replace(/\s+/g, ' ').slice(0, 90) : '找不到这一块');
    check('名字那句话没丢，挂在 aria-label 上',
      Boolean(blk && /aria-label="\$\{esc\(s\.mpNameLabel\)\}"/.test(blk)), '');
  }
  // CSS 那一头：两条相邻兄弟选择器都在，而且没有用 :has()（Chrome 61 不认识它，
  // 整条规则会连着作废——这仓库为此栽过一次）。
  check('CSS 用的是相邻兄弟，不是 :has()',
    css.includes('.auth-field > input:focus + span') &&
      css.includes('.auth-field > input:not(:placeholder-shown) + span'));
  const hasInAuth = (css.match(/\.auth-field[^{\n]*:has\(/g) || []);
  check('.auth-field 那一段里没有 :has()', hasInAuth.length === 0, hasInAuth.join(' '));
}

// ── ③ 完成度表撤了，六格挂在哪 ────────────────────────────────────
{
  /*
   * **完成度表（mountPwMeter）一处都不许再挂**（E37）。
   *
   * 它是「你这个新密码还差几位」那一小截进度条，挂在三处设新密码的框上。密码整个取消之
   * 后那三扇窗都撤了，所以这儿从「恰好三处」翻成「零处」——而**不是把这一条删掉**：删了
   * 的话哪天有人把那个函数重新挂到一个框上（最省事的「让这个框看起来专业点」的办法），
   * 这儿不会红，而屏幕上会多出一条量着一件不存在的事的进度条。
   */
  const mounted = [...sub.matchAll(/mountPwMeter\((\w+), lang\)/g)].map((m) => m[1]);
  check('完成度表一处都没挂（密码取消了）', mounted.length === 0, mounted.join(' '));
  check('（尺子）那个函数也不再 import 进来', !/mountPwMeter/.test(sub.split('\n')[3] ?? ''));

  /*
   * 六格验证码：现在是**三处**。
   *
   *   · 换邮箱确认那一张（cemCode）
   *   · 登录 / 注册那一张（authCode）—— 2026-10 新增，而且是全站最要紧的那一张：
   *     登录从此全靠它。
   *   · 小屋房号那四格走的是另一条路（ui/multiplayer.ts），不在这个文件里。
   *
   * 从前是两处（换邮箱、解锁）。解锁那扇窗撤了，登录那一张补上。
   */
  const pins = [...sub.matchAll(/mountPin\((\w+)/g)].map((m) => m[1]);
  check('验证码框都换成了六格（换邮箱 + 登录）', pins.length === 2, pins.join(' '));
  check('（尺子）登录那一张在里头', pins.includes('codeInput'), pins.join(' '));

}

// ── ⑤ 能打字的框，字号不许低于 16px（iOS 一点就放大）──────────────
{
  /*
   * 玩家 2026-09：「每次在文字框输入之后回到的界面就自动放大了。」
   *
   * 那不是我们画的界面，是 iOS 自己放的：**焦点落在字号小于 16px 的输入框上，整页就
   * 被放大一截**（Safari 和 Capacitor 那层 WebView 都这样），而装成 App 之后退出输入
   * 也不缩回去。原先 .auth-field input 是 0.95rem ＝ 15.2px，差的就是那 0.8px。
   *
   * 这是 iOS 唯一认的开关：viewport 上写 maximum-scale 挡不住（iOS 10 起忽略它），JS
   * 也收不回已经放大的页面。所以规矩只能钉在字号上，而且要连**看不见的那个框**一起钉
   * ——六格验证码底下那个框是 opacity: 0 的，iOS 照样按它的字号放大。
   *
   * 量的是样式表里所有「选到输入框」的规则。::placeholder 那几条不算：iOS 看的是框自
   * 己的字号，占位字多大它不管。
   */
  const RULES = [...css.matchAll(/([^{}]*)\{([^}]*)\}/g)]
    .map(([, sel, body]) => ({ sel: sel.split('*/').pop().trim().replace(/\s+/g, ' '), body }))
    .filter((r) => /\binput\b/.test(r.sel) && !/::placeholder/.test(r.sel))
    .filter((r) => !/\[type=['"]?(?:range|checkbox|radio|button|submit)/.test(r.sel))
    /*
     * ⚠️ 选择器里带 `input` 不等于**选中的是** input。
     *
     * 浮标签那几条 2026-10-03 从 `.auth-field > span` 改成了 `.auth-field > input + span`
     * （那一行里现在还坐着一把钥匙和「勿外传」，不限定的话它也会被当成标签摆）——选择器
     * 里于是有了 `input` 两个字，而它选中的是**标签**，0.95rem。这一条当场红，而页面上
     * 的框一个像素都没动。
     *
     * 判据：选择器的**最后一个简单选择器**是不是 input。`+ span` / `~ span` / ` span`
     * 收尾的都不是。
     */
    .filter((r) => r.sel.split(',').some((one) => /(^|[\s>+~])input[^\s>+~]*$/.test(one.trim())));
  const px = (v) => {
    const m = /^([\d.]+)(rem|em|px)$/.exec(v.trim());
    if (!m) return null;
    return m[2] === 'px' ? Number(m[1]) : Number(m[1]) * 16;
  };
  const sized = RULES
    .map((r) => ({ sel: r.sel, fs: (/font-size:\s*([^;]+);/.exec(r.body) || [])[1] }))
    .filter((r) => r.fs);
  // 尺子：真的挑出了几条（挑不到的话下面那一条等于没量）。
  check('样式表里找得到给输入框定字号的规则', sized.length >= 2, `${sized.length} 条`);
  const small = sized.filter((r) => { const v = px(r.fs); return v === null || v < 16; });
  check('能打字的框字号都不低于 16px（低了 iOS 一点就放大整页）',
    small.length === 0, small.map((r) => `${r.sel} → ${r.fs}`).join(' · ') || sized.map((r) => r.fs).join(' / '));
  // 那个透明的框单独点名：它最容易被漏掉，因为屏幕上看不见它。
  const pin = sized.find((r) => /auth-field--pin\s*>\s*input/.test(r.sel));
  check('六格底下那个透明框自己写了字号（不继承小字号）',
    Boolean(pin) && px(pin.fs) >= 16, pin ? `${pin.fs}` : '没写');
}

console.log(fail ? `\n${fail} 条没过（共 ${ran} 条）` : `\n全部通过（${ran} 条）`);
process.exit(fail ? 1 : 0);

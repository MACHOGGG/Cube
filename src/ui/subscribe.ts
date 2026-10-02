import { PRIVILEGES, STRINGS, type Lang } from '../i18n';
import { pushLayer } from '../engine/backNav';
import { playCopied } from '../engine/juice';
import { mountPin } from './authBits';
import { GENIUS_LAYOUTS } from '../engine/geniusContent';
import { shapeName } from './shapeLabels';
import { isStoreChannel, payeeName } from '../engine/channel';
import {
  clearEntitlement,
  entitlement,
  isGenius,
  askForCode,
  pairAuth,
  restore,
  setEntitlement,
  signInWithCode,
  type Entitlement,
  type GiftCode,
  type PurchaseFailure,
} from '../engine/subscription';
import {
  confirmEmailChange,
  requestEmailChange,
  type AccountFailure,
} from '../engine/account';
import { CONTACT_EMAIL } from '../legal';

/**
 * How the paywall describes each board the subscription unlocks.
 *
 * Longer than the board's own name, and it should be: on the home page the
 * label sits under an icon and only has to be recognised, while here it has
 * to tell someone who has not paid what they would be getting. Keyed by the
 * same ids as GENIUS_LAYOUTS, so a board added to the subscription without
 * a blurb falls back to its name rather than vanishing from the list.
 */
function geniusBoardBlurb(id: string, lang: Lang): string {
  const s = STRINGS[lang];
  if (id === 'circleSeven') return s.geniusNowCircleSeven;
  if (id === 'triangleBig') return s.geniusNowTriangleBig;
  return shapeName(lang, id, id);
}

/**
 * 「Slides 天才」 as a player meets it: the window that sells it, and the one
 * the site uses to find a subscription again.
 *
 * The two channels are never mixed on screen. In the App Store and Google
 * Play builds this window offers ¥2 and ¥9.9, buys through the store sheet,
 * and has no notion of an account — 恢复购买 is the whole of "log in", since
 * the store already knows who is holding the phone. On the site it offers
 * US$1.99 and US$4.99, hands off to Creem's checkout, and finds a
 * subscription again by the address it was bought with.
 *
 * Neither price list is reachable from the other build. That is not enforced
 * here but in engine/pricing.ts, which only ever hands over one of them —
 * this file simply prints what it is given, which is why there is no place
 * in the markup below for a currency to be chosen by mistake.
 */


const LOCALES: Record<Lang, string> = {
  en: 'en',
  fr: 'fr',
  zhHant: 'zh-Hant',
  zhHans: 'zh-Hans',
};

/** The same overlay the rules and icon windows use. */
function openModal(className: string, html: string, dismissable = true) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay show';
  overlay.innerHTML = `<div class="modal ${className}">${html}</div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  // 手机的返回键：能点掉的窗就关掉；不能点掉的那扇（设密码）返回也不放行——
  // 登记一个什么都不做的关法，这一下就被吞掉，人还在窗里。
  pushLayer(dismissable ? close : () => {}, overlay);
  // Every window here can be tapped away except the one that decides whether
  // this player can ever use their subscription on a second device.
  if (dismissable) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }
  return { overlay, close };
}

/**
 * "Forever", as the server writes it (api/_accounts.js LIFETIME_UNTIL). A
 * lifetime is stored as a date a thousand years out so every 到期 check
 * downstream stays one comparison; here it has to be read back as a word.
 */
const LIFETIME_UNTIL = Date.UTC(2999, 0, 1);

const esc = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Which of the four wordings a failed purchase deserves. */
function failureText(reason: PurchaseFailure, lang: Lang): string {
  const s = STRINGS[lang];
  switch (reason) {
    case 'cancelled':
      return s.purchaseCancelled;
    case 'unavailable':
      return s.purchaseUnavailable;
    case 'notConfigured':
      return s.notOnSaleYet;
    case 'none':
      return s.restoreNothing;
    case 'server':
      return s.serverBusy;
    case 'tooMany':
      return s.tooManyTries;
    default:
      return s.purchaseNetwork;
  }
}

/** What went wrong with a passcode, a code, or the unlock mail. */
function accountFailText(reason: AccountFailure, lang: Lang, retryInMs?: number): string {
  const s = STRINGS[lang];
  switch (reason) {
    case 'wrong':
      return s.pwWrong;
    case 'locked':
      return s.pwLocked.replace('{hours}', String(Math.max(1, Math.ceil((retryInMs ?? 0) / 3600e3))));
    case 'blocked':
      return s.pwBlocked;
    case 'code':
      return s.redeemBadCode;
    case 'email':
      return s.emailInvalid;
    case 'password':
      return s.passwordLabel;
    case 'wrongCode':
      return s.unlockBadCode;
    case 'expired':
      return s.unlockExpired;
    case 'noMail':
      return s.unlockNoMail.replace('{email}', CONTACT_EMAIL);
    case 'codeExpired':
      return s.codeExpired;
    case 'tooMany':
      return s.tooManyTries;
    case 'active':
      return s.alreadyActive;
    /*
     * 帐号那一头答 `notConfigured`，说的是**服务器没配好**（没有 Redis，见 api/_store.js
     * 那条「这个功能还没开」），不是「订阅还没开卖」。
     *
     * 从前这儿借了订阅那句 `notOnSaleYet`（「订阅尚未开放」）：玩家在**登录窗**里打完两
     * 串按下去，屏幕上答的是一句和登录毫不相干的话——他会以为自己走错了地方，而其实是我
     * 们这头的后台掉了。订阅那条路照旧用 `notOnSaleYet`（failureText 那一支），两句话各
     * 回各的事。
     */
    case 'notConfigured':
      return s.serverBusy;
    case 'taken':
      return s.emailTaken;
    case 'sameEmail':
      return s.emailSame;
    case 'weak':
      return s.setPwShort;
    // 令牌不作数了（在别处改过密码、或者过期）：这台设备得重新登一次。这
    // 一支从没问过密码，答「密码不对」会把玩家支到一个他改不动的地方去。
    case 'auth':
      return s.sessionGone;
    default:
      return s.purchaseNetwork;
  }
}

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
/**
 * 密码够不够格。和服务器的 PASS_RE 是同一条规矩：正好 6 位，数字或字母。
 *
 * 这里原来只数长度，不看是什么字符，而标签和输入框的提示又写着「至少 6 位」
 * ——同一扇窗里三种说法打架：玩家看到「至少 6 位」，打不进第 7 个字符，提交
 * 之后被告知「必须正好 6 位」。四种语言都是这样。现在四处（标签、提示、报错、
 * 这条校验）说的是同一句话，服务器那头也是同一条正则。
 */
/**
 * 这是一个免邮箱凭据账号吗——是的话返回要显示的那一串（E38/E53）。
 *
 * 只写一遍。屏幕上「你是谁」那一行、以及「摆不摆《更换邮箱》」都问它：那两处判错了都不
 * 报错，只是前者印出一串 64 位 hex，后者给出一行点下去必是 400 的路。
 *
 * 判据是 `handle` 这一位在不在，**不是**去看 `email` 长得像不像 hdl: ——那种长相判断会在
 * 哪天 id 的形状变一下的时候静默失效。`handle` 只有 pairAuth 那条路会写（engine/
 * subscription.ts）。
 */
const handleOf = (e: Entitlement): string | undefined => e.handle;
/**
 * 免邮箱凭据那两串（E38）：大小写敏感的字母 + 数字，8 到 64 位。
 *
 * **和服务端 api/_accounts.js 的 PAIR_RE 必须是同一条**。前置挡一下只为了省一次往返，说
 * 了算的还是服务端那一条——所以两边不一致的后果是「客户端放过、服务端打回」，而那条错一
 * 路压成「网络出错」。同一个坑在六位密码上踩过一次（见 attachAccount 那段注释）。
 */
const PAIR_RE = /^[A-Za-z0-9]{8,64}$/;

/**
 * One labelled input, in the shape the auth windows all use.
 *
 * **顺序是 input 在前、label 在后**，而屏幕上看到的仍旧是「标签在上、框在下」——
 * 标签由 CSS 绝对定位摆回去（style.css 的 .auth-field）。为什么要这么倒过来：浮动
 * 标签靠的是 `input:focus + span` 和 `input:not(:placeholder-shown) + span` 两条相邻
 * 兄弟选择器，而「相邻兄弟」只能往后看。倒过来是唯一不引 `:has()` 的写法，而 `:has()`
 * 在这仓库里栽过一次（Chrome 61 不认识它，整条规则连着作废，不报错、不白屏，只是样式
 * 不生效——见 ui/coachBar.ts 的 paintPeek 那段）。
 *
 * **没给 placeholder 的字段自动补一个空格。** `:placeholder-shown` 要有 placeholder
 * 才成立；补一个空格，「框是空的」这件事就有了纯 CSS 的判据。已经有 placeholder 的字段
 * 原样留着——那几句是有信息的（`you@example.com`、`6 位数字或字母`），标签替不了它们。
 * 那几句只在获得焦点时才显现（见 style.css 的 `input:not(:focus)::placeholder`），所以
 * 空着没点的时候屏幕上只有标签一层字，不会两层叠在一起。
 *
 * **那一串 name / autocomplete / type 一个字都不许动**：这张表是为密码管理器精心标注
 * 过的（见 credentialForm 和 openPortalWindow 上面的注释），这儿加的只是视觉层。
 */
function field(id: string, label: string, attrs: string): string {
  const withPlaceholder = /\bplaceholder\s*=/.test(attrs) ? attrs : `${attrs} placeholder=" "`;
  return `<label class="auth-field">
      <input id="${id}" ${withPlaceholder} />
      <span>${label}</span>
    </label>`;
}

/**
 * 去 Creem 自己的账单页（退订、换卡、拿收据）。
 *
 * **这儿原先是一扇窗**：把邮箱只读地摆着、再问一次密码，理由是「这个链接后面是卡号后四
 * 位、付款记录和那颗退订键」。2026-10 密码取消了（E37），身份改用登录令牌证明（E44）
 * ——而令牌这台设备手上就有，所以**没有东西要问了，窗也就不必存在**。
 *
 * 少一扇窗不只是少几行代码：那扇窗上「再输一次密码」这件事本身，对一个刚刚用验证码登进
 * 来的人是说不通的（他压根没有密码）。
 *
 * 开不出来就在《账户》那一屏上说一句。不新开一扇窗来报错——玩家按的是一行「管理订阅」，
 * 他要的结果是一个页面，不是一扇窗。
 */
async function openPortal(lang: Lang, onChanged: () => void): Promise<void> {
  const s = STRINGS[lang];
  const current = entitlement();
  const { webPortal } = await import('../engine/creem');
  const opened = await webPortal(current.email ?? '', current.token ?? '');
  // 开不出来：回到《账户》并在那一屏上带一句话（它的第三个参数就是这个用处）。
  if (!opened) openStatusWindow(lang, onChanged, s.serverBusy);
}

/*
 * **credentialForm() 撤了**（E37）。
 *
 * 它拼的是一张「密码管理器认得出来」的表单：真 <form>、一个标着 username 的只读邮箱、一
 * 个标着 new-password 的密码框。两扇用它的窗（《设置密码》《改密码》）都撤了，而新的
 * 《注册 / 登录》不收密码——没有密码可存，这张表也就没有对象了。
 *
 * 它底下那个 offerToSave() **留着**：免邮箱凭据那两串（E38）正好是一对「账号 + 密码」，
 * 存进管理器比让玩家自己截图可靠得多。
 */

/** Chromium can be told outright; Safari only ever infers it from the form. */
async function offerToSave(email: string, password: string): Promise<void> {
  try {
    const w = window as unknown as {
      PasswordCredential?: new (data: { id: string; password: string }) => Credential;
    };
    if (!w.PasswordCredential || !navigator.credentials?.store) return;
    await navigator.credentials.store(new w.PasswordCredential({ id: email, password }));
  } catch {
    // A manager that declines, or a browser without one, is not a failure:
    // the password is already saved on the server either way.
  }
}

/*
 * **《设置密码》那扇窗撤了**（E37）。
 *
 * 它是「刚从 Creem 结账页回来，设一把密码」那一屏。密码整个取消之后它没有对象了：注册和
 * 登录都走邮箱验证码（api/signin.js）或者两串免邮箱凭据（api/handle.js）。
 *
 * 后端 `api/passcode.js` 的 `create` 支留着（在途的标签页、老账号），只是前端不再开这扇
 * 窗——走到那一步的人现在从《注册 / 登录》那一扇进来。
 */

/*
 * **「刚付过款就追问密码」那一下撤了**（E37）。
 *
 * 它是开场时检查「有没有一笔刚结完账、还没设密码」，有就弹上面那扇窗。两样东西都没了：
 * 没有结账了，也没有密码了。`src/main.ts` 里那一句调用一并撤掉。
 */

/*
 * **付款墙上那三条法务链接撤了**（E42）。
 *
 * 这儿原先是 `paywallLegalLinks()`：在价目行底下摆《价格与订阅》《条款》《退款》三条，
 * 理由是「按下那一行价钱就直接去结账页了，这儿是最后一处还来得及说的地方」。
 *
 * 2026-10 不卖了，那三份文档本身也从 `LEGAL_ORDER` 里撤了（`build-legal.mjs` 按它出静态
 * 页，所以 /pricing /terms /refund 三个网址会 404）。链一条通向 404 的法务链接，比不链更
 * 糟。个人主页底部留着《隐私政策》和《联系与特别感谢》两行。
 */

/**
 * The window behind 成为 Slides 天才. Already a subscriber? Then it is the
 * status window instead — there is nothing to sell someone who has bought it.
 */
export function openGeniusWindow(lang: Lang, onChanged: () => void): void {
  if (isGenius()) return openStatusWindow(lang, onChanged);

  const s = STRINGS[lang];
  const store = payeeName();
  // What the subscription actually hands over the moment it is bought. The
  // board names are read from GENIUS_LAYOUTS rather than written out again,
  // so adding a board to the subscription adds it here too and this list can
  // never drift into promising something the code does not lock.
  // 「订阅后立刻解锁」跟个人主页那一段走：两副棋盘、小屋，再加做好了的几样——
  // 配色、翻面速度、老虎机模式、更多得分目标、更多布局、世界排名。个人主页上
  // 还在「敬请期待」的才留在下面那一段（玩家的原话：「一些已经上的内容还没有
  // 被更新进来」）。
  const nowList = [
    ...GENIUS_LAYOUTS.map((id) => geniusBoardBlurb(id, lang)),
    s.geniusHostRooms,
    PRIVILEGES[lang][0],
    s.flipSpeedTitle,
    s.randomTargetTitle,
    PRIVILEGES[lang][2],
    PRIVILEGES[lang][3],
    PRIVILEGES[lang][6],
    `${PRIVILEGES[lang][4]} · ${s.flipModeTitle} · ${s.puzzleModeTitle}`,
  ];
  /**
   * 这一窗**只列头几条，剩下的收成一个「……」**（玩家 2026-09：这一窗太长了，要
   * 完整显示得出来）。
   *
   * 原先十条「订阅后立刻解锁」＋ 三条「敬请期待」，一共十三行——加上价目、收款方、
   * 三条法务链接和底下那排键，整窗七百多像素。手机上算掉浏览器自己的地址栏工具栏
   * 常常只剩六百出头，于是最底下那排键落在屏幕外；在小红书那种内嵌浏览器里，可视
   * 区还被上下两条自己的栏再夹一道，连滚都滚不到。
   *
   * 列表本身没删：完整那一份在个人主页的《Slides 天才特供》那一段（accountPage），
   * 那一页是可以往下滚的，而这一窗是一次性的决定窗——它要回答的是「多少钱、谁收
   * 钱、值不值」，不是把货架整个搬出来。
   *
   * 「敬请期待」那三条在这一窗里整段撤掉：付款窗上摆着还没做出来的东西，既占地方，
   * 又是这个仓库一向躲着的那种陈述（见 CLAUDE.md 里法务文本那一段）。个人主页上那
   * 三行照旧写着「敬请期待」。
   */
  /**
   * **十条全摆**（E40，玩家 2026-10-02）。
   *
   * 这儿原先只摆 4 条、剩下的收成一行「……」，理由是那一窗太长：十条「立刻解锁」＋三条
   * 「敬请期待」＋价目＋收款方＋三条法务链接＋底下那排键，整窗七百多像素，手机上最底下
   * 那排键落在屏幕外。
   *
   * 现在撑长的那几样全撤了（价钱、收款方、法务链接、内部码那一行，E40/E41/E42），腾出
   * 来的地方正好摆满十条——而这一屏要回答的问题也换了：从前是「多少钱、谁收钱、值不
   * 值」，现在是「注册能换到什么」，那就该把货列全。
   *
   * ⚠️ **十条照旧会把窗撑长。** 门里必须在 360×640 和 390×844 两档各量一次底排键还在
   * 屏内（check-register-guide.mjs）——超了就退回省略号版，别靠眼睛看一眼就算了。
   */
  const PERKS_SHOWN = nowList.length;
  /**
   * **网页端停售**（《侵蚀阶梯》E11 / PR-12，玩家 2026-10 在 Creem 后台把两个商品
   * archive 掉了，在续的订阅也一并取消了）。
   *
   * 所以这一窗在网页端不再摆价钱、也不再有任何一条通向结账的路。不是「禁用那两颗
   * 键」——留着一颗按不动的价钱键，玩家只会一直去按它，那正是「意料之外的界面」。
   *
   * 开关在 `engine/saleWindow.ts` 一个布尔上（玩家点名要的：「完整保留现在已有的这套跟
   * creem 之间的联络机制……有一天可以改回来的时候会比较方便」）。所以**下面渲染价钱那
   * 一段原样留着**，一行都没删，只是走不到；改回开售把那一个布尔翻成 true 就行。
   *
   * 只收网页这一端：商店渠道（App Store / Google Play）那一套走的是另一条路
   * （`iap.ts`），而且还没上线，这一轮不碰它。判法和全站一致，问 `isStoreChannel()`。
   *
   * ⚠️ 商品归档之后，结账接口拿不到商品会答 404 → `/api/checkout` 转成 502 → 屏幕上
   * 写「服务器出了点问题」。把入口撤掉之后玩家根本走不到那一步，可**后台那三个
   * `CREEM_*` 环境变量也该清掉**：清了之后 `configured()` 为假，接口答的是 503
   * 「订阅尚未开放」，而不是一句听着像我们服务器坏了的话。
   */
  /*
   * **价钱整段撤了**（E40）。
   *
   * 2026-10 的改制把「付钱解锁」换成「注册解锁」，所以这一屏不再是付款窗。原先这儿有
   * `webClosed` 一个布尔 + 一段 `plans().map()` 生成价目行，留着是为了「有一天改回来方
   * 便」——现在改制已经定了，留一段走不到的生成器只会让下一个人以为这一屏还会卖东西。
   *
   * **跟 Creem 之间的机制一行没动**：`engine/pricing.ts` 的 plans() / formatPrice()、
   * `api/checkout.js`、`api/portal.js`、`engine/saleWindow.ts` 那个布尔全在原处。要重开
   * 订阅，回来在这儿摆回价目行就是；那时也必须同时改掉上面那句写死的承诺（E54）。
   */
  const { overlay, close } = openModal(
    'genius-modal',
    `
    <h2>${s.subscribeTitle}</h2>
    <!--
      这一屏是**注册引导**（E40）。这一句话写死，不再问服务端。

      它从前分两步：先摆中性的「订阅目前不开放」，问到 /api/slots 的真实名额之后再换成
      那句承诺——因为那时名额有限（第一批 100 个），而「还剩几个」只有服务端数得清。
      2026-10-02 名额整个撤了（E39，不限人数），没有可问的了，于是也没有「说得出才说」
      这回事：这句话什么时候都成立。

      ⚠️ 但它成立有一个前提：服务端的 GENIUS_GRANT_WINDOW 开着。那个开关和这句话之间
      已经没有任何自动的联系了，所以要关它必须先回来改这句话——api/_entitlement.js
      的 grantWindowOpen 旁边钉着同一条（E54）。
    -->
    <p class="tag-line" id="geniusTag">${s.registerUnlocks}</p>
    ${
      // 商店那一端还有一句值得说的：不用注册、不离开 App。网页端没有对应的话——它要说的
      // 本来是「刷卡不用设密码」，而密码整个取消之后那句话连对象都没有了。
      isStoreChannel()
        ? `<p class="auth-hint">${s.storeNoAccountHint.replace('{store}', store)}</p>`
        : ''
    }
    <!--
      这儿原先还有三样，2026-10 全撤（E40/E41/E42）：

      · 收款方那一句（merchantNote）——没有在收的款，它是这一页上唯一还在说「这儿能付
        钱」的话；
      · 三条法务链接（paywallLegalLinks：价格 / 条款 / 退款）——那三份文档本身也撤了，
        LEGAL_ORDER 只留隐私（E42），链过去就是 404；
      · 《有兑换码》那一行（geniusRedeem）——内部码的前端全撤（E41）。后端
        api/redeem.js 一行没动，码还能用，只是不在界面上招手了。
    -->
    <p class="auth-msg" id="geniusMsg" role="status"></p>
    <div class="genius-perks">
      <div class="menu-section-label">${s.geniusNowTitle}</div>
      ${nowList
        .slice(0, PERKS_SHOWN)
        .map((p) => `<div class="genius-perk">${esc(p)}</div>`)
        .join('')}
      ${
        // 剩下的收成一行淡的「……」。它不点、不展开——要看全的去个人主页那一段
        // （见上面 PERKS_SHOWN 那段说明）。
        nowList.length > PERKS_SHOWN
          ? `<div class="genius-perk genius-perk--more" aria-label="${esc(s.geniusNowTitle)}">……</div>`
          : ''
      }
    </div>
    <div class="btn-row">
      <!-- 登录 is the accented one. Someone who already subscribed and is
           looking at the paywall got here by accident, and the way out of
           that is signing in, not closing the window. -->
      <button class="btn-quiet" id="geniusClose">${s.closeBtn}</button>
      <button class="primary" id="geniusRestore">${
        isStoreChannel() ? s.restoreBtn : s.registerBtn
      }</button>
    </div>
  `,
  );

  overlay.querySelector<HTMLButtonElement>('#geniusRestore')!.addEventListener('click', () => {
    close();
    if (isStoreChannel()) runStoreRestore(lang, onChanged);
    // 网页端这颗键是《注册》，开的就是那一扇窗——而注册和登录在那扇窗里是同一条路
    // （服务端自己知道这个地址上有没有账号），所以已经有账号的人按它也对。
    else openAuthWindow(lang, onChanged);
  });
  overlay.querySelector<HTMLButtonElement>('#geniusClose')!.addEventListener('click', close);
}

/**
 * 《账户》——登录之后，跟这个账号有关的每一件事都在这一扇窗里。
 *
 * 原先它叫「订单情况」，只有天才点得开，抬头写着「你已是 Slides 天才」，底
 * 下横着一排小按钮（管理订阅 / 退出登录 / 绑定），《关闭》还是最红的那一颗。
 * 玩家指出的两件事都指向同一个毛病：
 *
 *   「登录是登录……登录不代表有权限」——订阅过期的人照样是这个账号的主人，
 *     他的云端战绩、别人寄给他的内部码都在里面，那扇门不该只对天才开。
 *   「注意整体排版清晰放在一起，不要东一个西一个」——一排横着的小按钮，
 *     宽窄不一、轻重不分，本来就不是给「几件并列的事」用的排法。
 *
 * 所以现在：抬头只写《账户》；是不是天才由《订单情况》如实回答（没有在续
 * 的订阅就写那一句 orderLapsed）；能做的事排成一列，和个人主页上那些行长得
 * 一模一样——同一种样子代表同一件事「点进去还有一层」，玩家不用重新学。
 *
 * 底下只留一颗《关闭》。一排里只有它，就不存在「本来想按别的、顺手按到关
 * 闭」——那正是玩家抱怨的那一下。
 */
export function openStatusWindow(lang: Lang, onChanged: () => void, notice = ''): void {
  const s = STRINGS[lang];
  const current = entitlement();
  /** 刷卡订阅那一条：商店里买的没有这个门户，内部码换来的也没有。 */
  const hasPortal = !isStoreChannel() && current.channel !== 'code';
  const row = (id: string, label: string) =>
    `<button class="profile-row" id="${id}">
       <span class="profile-row-label">${label}</span>
       <span class="profile-row-value">&rsaquo;</span>
     </button>`;
  const { overlay, close } = openModal(
    'genius-modal',
    `
    <h2>${s.accountTitle}</h2>
    ${orderBlock(current, lang)}
    ${giftBlock(current.gifts ?? [], lang)}
    <p class="auth-msg" id="statusMsg" role="status">${esc(notice)}</p>
    <div class="menu-section-label acct-label">${s.accountActions}</div>
    <!--
      这一列 2026-10 瘦了三行（E43）：改密码（密码取消了）、兑内部码（前端全撤，E41）、
      绑定（它开的是《设置密码》那扇窗，一起撤了）。

      ⚠️ **免邮箱凭据账号不摆《更换邮箱》**（E53）。api/email.js 要求「现在这个地址」
      过 EMAIL_RE，而这种账号的 id 是 hdl: 加一串 hex——点下去必是 400，而屏幕上只会
      写一句含糊的失败。一条走不通的路比没有这条路更糟。
      他的「第二串」也不显示：服务端只有哈希，客户端也不存，**显示不出来**，这是设计。
    -->
    <div class="acct-rows">
      ${handleOf(current) ? '' : row('statusChangeEmail', s.changeEmailRow)}
      ${hasPortal ? row('statusManage', s.manageSubscription) : ''}
      ${isStoreChannel() ? '' : row('statusSignOut', s.signOutBtn)}
    </div>
    ${
      isStoreChannel()
        ? `<p class="auth-hint">${s.manageOnStore.replace('{store}', payeeName())}</p>`
        : ''
    }
    <!-- 客服信箱。它本来只活在法务文档里和一句「你没填邮箱」的提示里，而收单
         方要的是「公开网站上有，用户自己的账户里也有」——所以摆在这儿：他为
         订阅的事来这扇窗，要写信也是在这一刻。写成 mailto，点一下就是新邮件。 -->
    <p class="auth-hint">${s.supportLine.replace(
      '{email}',
      `<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>`,
    )}</p>
    <div class="btn-row">
      <button class="btn-quiet" id="statusClose">${s.closeBtn}</button>
    </div>
  `,
  );

  // 换邮箱：一扇小窗，关掉之后回到这一扇（back），这样玩家改完能当场看见改成了什么，
  // 不用自己再点回来。
  const back = (notice = '') => openStatusWindow(lang, onChanged, notice);
  overlay.querySelector<HTMLButtonElement>('#statusChangeEmail')?.addEventListener('click', () => {
    close();
    openChangeEmailWindow(lang, onChanged, back);
  });

  // Cancelling a web subscription happens on Creem's own portal page — they
  // hold the billing record, so it is never something this app pretends to do.
  overlay.querySelector<HTMLButtonElement>('#statusManage')?.addEventListener('click', () => {
    // 这个链接后面是卡号后四位、付款记录和那颗退订键。身份用**登录令牌**证明（E44）——
    // 密码取消之后它是唯一还存在的证明，而且是同样强的那一种（24 字节随机）。
    close();
    void openPortal(lang, onChanged);
  });
  // Signing out only forgets the address on this device: it cancels nothing,
  // and naming the address again brings the subscription straight back.
  overlay.querySelector<HTMLButtonElement>('#statusSignOut')?.addEventListener('click', () => {
    clearEntitlement();
    close();
    onChanged();
  });
  overlay.querySelector<HTMLButtonElement>('#statusClose')!.addEventListener('click', close);
  wireCopyButtons(overlay, lang);
}

/**
 * 订单情况 — the three facts a signed-in player came here to check: which
 * address this is, what they bought, and how long it is paid up for.
 *
 * Set out as labelled rows rather than a sentence, because it is looked at
 * rather than read: someone opening this window already knows they
 * subscribed and is checking one line of it.
 */
function orderBlock(current: Entitlement, lang: Lang): string {
  const s = STRINGS[lang];
  const lifetime = Boolean(current.until && current.until >= LIFETIME_UNTIL);
  const rows: [string, string][] = [];
  /*
   * 「你是谁」那一行（E53）。
   *
   * 免邮箱凭据账号（E38）的 `email` 里放的是服务端认人的那把 id（`hdl:` 加 64 位 hex），
   * **那一串不能印给人看**——而服务端也印不出来，它只存第一串的 sha256。所以这种账号印的
   * 是客户端自己留的那份原文（`handle`），标签也跟着换成「第一串」。
   *
   * 第二串一个字都不显示：服务端只有 scrypt 哈希，客户端也不存。这是设计，不是漏了。
   */
  const handle = handleOf(current);
  if (handle) rows.push([s.pairFirstShort, handle]);
  else if (current.email) rows.push([s.emailLabel, current.email]);
  /*
   * 「哪一档」这一行**只有真买过的人才有**。
   *
   * `entitlementOf`（api/_accounts.js）里 `period` 是从 `plan` 推出来的，而它**总有值**
   * （不是 'month' 就按 'yearly' 答）。于是 2026-10 之后每一个注册进来的人都会看到一行
   * 「年付」——而他一分钱没付，站上也没有在卖。那一行是假话。
   *
   * 终身（免费期授予的那一份）这儿就不摆档位：底下那一行已经写着「永久」，说清了。
   */
  if (current.period && !lifetime) {
    rows.push([s.orderPlanLabel, current.period === 'monthly' ? s.planMonthly : s.planYearly]);
  }
  if (lifetime) rows.push([s.orderUntilLabel, s.orderLifetime]);
  else if (current.until) {
    rows.push([s.orderUntilLabel, new Date(current.until).toLocaleDateString(LOCALES[lang])]);
  }
  /**
   * 没有在续的订阅，就明说这一句。
   *
   * 原先它只在「一行都排不出来」时才出现，可登录之后邮箱那一行总是排得出来
   * ——于是一个订阅早过期的人，看到的是一块写着《你的订阅》、底下只有他邮箱
   * 的牌子，一个字都没说他此刻没有权限。玩家的原话是「登录是登录……登录不代
   * 表有权限」，那这扇窗就得把后半句说出来。
   */
  const lapsed = current.active ? '' : `<p class="auth-hint">${s.orderLapsed}</p>`;
  if (!rows.length) return lapsed || `<p class="auth-hint">${s.orderLapsed}</p>`;
  return `<div class="order-block">
    <div class="menu-section-label">${s.orderTitle}</div>
    ${rows
      .map(
        ([label, value]) => `<div class="order-row">
          <span class="order-label">${esc(label)}</span>
          <span class="order-value">${esc(value)}</span>
        </div>`,
      )
      .join('')}
  </div>${lapsed}`;
}

/**
 * 年付赠码. Each code gets its own copy button, because what a player does
 * with these is paste one into a message to one particular person — and a
 * six-character code read off a screen and typed back in is exactly the
 * errand a copy button exists to remove.
 *
 * A spent one stays on the list, struck through: a code that quietly
 * vanished the day a friend used it would read as one we took back.
 */
function giftBlock(gifts: GiftCode[], lang: Lang): string {
  const s = STRINGS[lang];
  if (!gifts.length) return '';
  return `<div class="gift-block">
    <div class="menu-section-label">${s.giftTitle}</div>
    <p class="auth-hint">${s.giftHint}</p>
    ${gifts
      .map((gift) => {
        const by = gift.expiresAt
          ? s.giftExpires.replace('{date}', new Date(gift.expiresAt).toLocaleDateString(LOCALES[lang]))
          : '';
        return `<div class="gift-row${gift.spent ? ' gift-row--spent' : ''}">
          <span class="gift-code">${esc(gift.code)}</span>
          <span class="gift-note">${gift.spent ? esc(s.giftUsed) : esc(by)}</span>
          ${
            gift.spent
              ? ''
              : // 两层字叠在一块，交叉淡化：文字换掉的同时右边多一个绿勾。
                // 不是「换 textContent」——那样宽度会跳一下，一排码里跳的那一个
                // 看起来像出了错。两层都在，宽度取两者里宽的那一个。
                `<button class="gift-copy" data-copy="${esc(gift.code)}">` +
                `<span class="gift-copy-face gift-copy-face--idle">${esc(s.copyBtn)}</span>` +
                `<span class="gift-copy-face gift-copy-face--done">` +
                `<span class="gift-copy-tick" aria-hidden="true">✓</span>${esc(s.copiedLabel)}</span>` +
                `</button>`
          }
        </div>`;
      })
      .join('')}
  </div>`;
}

/** 复制成功之后那句「已复制」停多久。 */
const COPIED_MS = 1400;

/**
 * 复制，按钮自己说一声——这颗键没有别的确认通道，所以这一声是全部。
 *
 * **只有真的成了才说「已复制」。** 这一条是这段代码唯一要紧的事：剪贴板可能没
 * 权限（浏览器设置、非安全上下文、某些内嵌容器），那时候 writeText 是 reject 的。
 * 从前这儿 catch 里退回去选中文本，但**外面那句 setTimeout 无论成败都把文案改回
 * 去**——也就是说失败那一路它压根没说过「已复制」，这是对的；现在多了个绿勾，更
 * 得守住这一条：一句假的「已复制」比按了没反应糟得多，他会直接去粘贴，粘出来的
 * 是上一次剪贴板里的东西。
 *
 * 失败那一路的行为一个字没改：把码选中，他自己长按复制。
 */
function wireCopyButtons(overlay: HTMLElement, lang: Lang): void {
  void lang; // 文案现在印在两层 span 里（见 giftBlock），这儿只管状态
  for (const btn of Array.from(overlay.querySelectorAll<HTMLButtonElement>('.gift-copy'))) {
    let revert = 0;
    btn.addEventListener('click', async () => {
      const code = btn.dataset.copy ?? '';
      // 连点节流：已经在「已复制」里了，再点不重播那一下淡化（重播看起来像又
      // 复制了一次，而剪贴板里本来就已经是它了）。这一颗键按两下是常事——人会
      // 怀疑自己第一下按没按到。
      if (btn.classList.contains('is-copied')) return;
      let ok = false;
      try {
        await navigator.clipboard.writeText(code);
        ok = true;
      } catch {
        // No clipboard permission: select it instead, so it can still be
        // copied by hand rather than the button doing nothing at all.
        const node = btn.parentElement?.querySelector('.gift-code');
        if (node) {
          const range = document.createRange();
          range.selectNodeContents(node);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      }
      if (!ok) return; // 停在 idle。屏幕上是一段选中的码，那句话本来就该由他自己完成。
      btn.classList.add('is-copied');
      // 没有别的确认通道的动作配一声（cuelume 现有的 tick，和拖动过一格是同一颗）。
      playCopied();
      if (revert) window.clearTimeout(revert);
      revert = window.setTimeout(() => btn.classList.remove('is-copied'), COPIED_MS);
    });
  }
}

/*
 * **《改密码》那扇窗撤了**（E37）。
 *
 * 后端那一支也撤了（`api/passcode.js` 的 change，见那个文件末尾）。邮箱账号没有密码可
 * 改；免邮箱账号要换第二串，走《注册 / 登录》那扇窗里的《忘了第二串？》（api/handle.js
 * 的 reset，凭第一串）。
 */

/**
 * 更换邮箱。两步，一屏——不另开一扇窗，因为这是同一件事的上下半段。
 *
 * 邮箱在这个站里就是账号本身（账号存在 acct:<邮箱> 底下，排行榜上的成员也是
 * 这个地址），所以换邮箱是搬家：服务器会把账号、云端战绩、榜上的位置一起挪
 * 过去。见 api/email.js。
 *
 * 确认码寄给**新**地址，不是现在这个。谁收得到，那个地址就是谁的——少了这一
 * 步，打错一个字母就把自己关在门外（此后《忘记密码》的信永远寄到一个他打不
 * 开的信箱），更别说可以把账号停在别人的地址上。
 */
export function openChangeEmailWindow(
  lang: Lang,
  onChanged: () => void,
  onBack: (notice?: string) => void,
): void {
  const s = STRINGS[lang];
  const current = entitlement();
  const email = current.email ?? '';
  const { overlay, close } = openModal(
    'auth-modal',
    `
    <h2>${s.changeEmailRow}</h2>
    <p class="auth-hint">${esc(email)}</p>
    ${field('cemNew', s.newEmailLabel,
      `type="email" autocomplete="off" inputmode="email" placeholder="${esc(s.emailPlaceholder)}"`)}
    <div id="cemStep2" hidden>
      ${field('cemCode', s.codeFieldLabel,
        `type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6"`)}
    </div>
    <p class="auth-msg" id="cemMsg" role="status"></p>
    <div class="btn-row">
      <button class="btn-quiet" id="cemClose">${s.closeBtn}</button>
      <button class="primary" id="cemGo">${s.unlockSendBtn}</button>
    </div>
  `,
  );

  const wanted = overlay.querySelector<HTMLInputElement>('#cemNew')!;
  const step2 = overlay.querySelector<HTMLElement>('#cemStep2')!;
  const codeInput = overlay.querySelector<HTMLInputElement>('#cemCode')!;
  const cemPin = mountPin(codeInput);
  const msg = overlay.querySelector<HTMLElement>('#cemMsg')!;
  const go = overlay.querySelector<HTMLButtonElement>('#cemGo')!;
  let sent = false;

  const submit = async () => {
    const next = wanted.value.trim();
    if (!isEmail(next)) return void (msg.textContent = s.emailInvalid);
    const token = entitlement().token ?? '';
    go.disabled = true;
    msg.textContent = s.workingLabel;

    if (!sent) {
      const asked = await requestEmailChange(email, token, next, lang);
      go.disabled = false;
      if (!asked.ok) {
        msg.textContent = accountFailText(asked.reason, lang);
        return;
      }
      // 码寄出去了，这一屏就变成第二段：新地址那一栏锁住（改了它，手里那张
      // 码就对不上——服务器认的是「发码时的那个地址」），下面露出验证码。
      sent = true;
      wanted.readOnly = true;
      step2.hidden = false;
      go.textContent = s.confirmBtn;
      msg.textContent = s.emailCodeSent;
      codeInput.focus();
      return;
    }

    const done = await confirmEmailChange(email, token, next, codeInput.value.trim());
    go.disabled = false;
    if (!done.ok) {
      msg.textContent = accountFailText(done.reason, lang);
      // 和解锁那扇窗同一条规矩：只在说的确实是那六位的时候抖格子。
      if (done.reason === 'wrongCode' || done.reason === 'expired') cemPin.reject();
      return;
    }
    // 搬完了。本机这份要跟着换——不换的话它还拿旧地址去问权益，服务器那边已
    // 经没有那个账号了，下一次刷新就成了「查无此人」。
    setEntitlement({ ...entitlement(), email: done.email, token: done.token });
    onChanged();
    close();
    onBack(s.emailChanged);
  };

  for (const el of [wanted, codeInput]) {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void submit();
    });
  }
  go.addEventListener('click', () => void submit());
  overlay.querySelector<HTMLButtonElement>('#cemClose')!.addEventListener('click', () => {
    close();
    onBack();
  });
}

/**
 * 注册 / 登录 —— the site only。**一扇窗，三态同屏**（E37/E38）。
 *
 * ```
 * ① 邮箱态（默认）     [ 邮箱 ] [→]        《免邮箱注册 / 登录》
 * ② 验证码态           「验证码已寄到 …」 六格  ☐ 更新邮件（只有新账号才问）  《换个邮箱》
 * ③ 免邮箱态           [ 第一串 ] [ 第二串 ]  那句警告  [ 保存 ]  《忘了第二串？》《改用邮箱》
 * ```
 *
 * ── 从前是什么样 ────────────────────────────────────────────
 *
 * 两栏：《注册》和《登录》，各收邮箱 + 六位密码，底下常驻《忘记密码？》和《有兑换码》。
 * 2026-10 的改制（E37）把密码整个取消了——身份改成「一张寄到邮箱的六位验证码」，于是：
 *
 *   · **两栏并成一条路。** 这个地址上有没有账号，服务端自己知道（`created`），玩家分不
 *     出、也不该要他分。所以没有 tab 了。
 *   · **《忘记密码？》没了。** 没有密码可忘，而那扇窗（openUnlockWindow）整个撤了。
 *   · **《有兑换码》没了**（E41）。前端全撤，后端 api/redeem.js 一行没动。
 *
 * ── 为什么三态在同一扇窗里，不是三扇 ──────────────────────
 *
 * 玩家定的站点原则有一条「不要出现意料之外的界面」。②是①的下一拍（码刚寄出去，他还在
 * 等），③是①的另一条路（邮箱这条走不通的时候）——三样都是「我要进去」这一件事的不同时
 * 刻，分成三扇窗就会出现「刚才那扇哪儿去了」。
 *
 * 一个具体的好处：收到 `mailDown`（E51，Resend 发不出信）时**不进②**，留在①上添一句提
 * 示。玩家手里那一步没动，他看到的是「这条路暂时不通，旁边还有一条」。
 */
export function openAuthWindow(lang: Lang, onChanged: () => void): void {
  const s = STRINGS[lang];
  const { overlay, close } = openModal(
    'auth-modal',
    `
    <div class="auth-body">
      <p class="auth-hint" id="authHint"></p>

      <!-- ① 邮箱态。一个框一颗箭头，不写字（玩家定的「少文字」）。 -->
      <form id="authMailForm" autocomplete="on">
        ${field('authEmail', s.emailLabel,
          `type="email" name="username" autocomplete="username" inputmode="email" placeholder="${s.emailPlaceholder}"`)}
        <button type="submit" hidden></button>
      </form>

      <!-- ② 验证码态。六格由 mountPin 画（style.css 的 .pin-row / .pin-cell 已有三
           态），这儿只摆那个真输入框。 -->
      <form id="authCodeForm" autocomplete="on" hidden>
        ${field('authCode', s.codeFieldLabel,
          'type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code"')}
        <label class="auth-optin" id="authNewsRow" hidden>
          <input type="checkbox" id="authNews" />
          <span>${s.newsOptIn}</span>
        </label>
        <button type="submit" hidden></button>
      </form>

      <!-- ③ 免邮箱态。两个框都是**明文**：玩家要抄下来的东西，遮住反而抄错。 -->
      <form id="authPairForm" autocomplete="off" hidden>
        ${field('authFirst', s.pairFirstLabel,
          'type="text" autocomplete="off" autocapitalize="off" spellcheck="false" minlength="8" maxlength="64"')}
        ${field('authSecond', s.pairSecondLabel,
          'type="text" autocomplete="off" autocapitalize="off" spellcheck="false" minlength="8" maxlength="64"')}
        <p class="auth-warn" id="authPairWarn">${s.pairWarning}</p>
        <button type="submit" hidden></button>
      </form>

      <p class="auth-msg" id="authMsg" role="status"></p>
      <button class="link-btn" id="authAlt"></button>
      <button class="link-btn" id="authPairForgot" hidden>${s.pairForgot}</button>
    </div>
    <div class="btn-row">
      <button class="btn-quiet" id="authClose">${s.closeBtn}</button>
      <button class="primary" id="authGo"></button>
    </div>
  `,
  );

  const hint = overlay.querySelector<HTMLElement>('#authHint')!;
  const msg = overlay.querySelector<HTMLElement>('#authMsg')!;
  const go = overlay.querySelector<HTMLButtonElement>('#authGo')!;
  const alt = overlay.querySelector<HTMLButtonElement>('#authAlt')!;
  const pairForgot = overlay.querySelector<HTMLButtonElement>('#authPairForgot')!;
  const mailForm = overlay.querySelector<HTMLFormElement>('#authMailForm')!;
  const codeForm = overlay.querySelector<HTMLFormElement>('#authCodeForm')!;
  const pairForm = overlay.querySelector<HTMLFormElement>('#authPairForm')!;
  const mailInput = overlay.querySelector<HTMLInputElement>('#authEmail')!;
  const codeInput = overlay.querySelector<HTMLInputElement>('#authCode')!;
  const newsRow = overlay.querySelector<HTMLElement>('#authNewsRow')!;
  const newsBox = overlay.querySelector<HTMLInputElement>('#authNews')!;
  const firstInput = overlay.querySelector<HTMLInputElement>('#authFirst')!;
  const secondInput = overlay.querySelector<HTMLInputElement>('#authSecond')!;
  const warn = overlay.querySelector<HTMLElement>('#authPairWarn')!;

  /** 六格那一排。`mountPin` 自己管格子、粘贴分格、三态动画（ui/authBits.ts）。 */
  const pin = mountPin(codeInput, () => void submit());

  type Stage = 'mail' | 'code' | 'pair';
  let stage: Stage = 'mail';
  /** ②③ 要记住上一步填的东西：②要知道码寄给了谁，③的「重设」要知道第一串。 */
  let sentTo = '';
  /**
   * ② 还要记住**那张票**（服务端的 `challenge`）：码和「猜了几次」都存在它底下。
   *
   * 它只回给要码的这台设备，所以外人替你要一次码、或者拿你的地址乱猜，动的都是他自己那
   * 一张（见 api/signin.js 顶上那段）。它只活在这个闭包里：不进 localStorage，也不进
   * entitlement——码本来就只在这一屏里用一次，存下来只会多一个会泄露的地方。
   *
   * 代价说明白：这一屏关掉再开，票就没了，他得重新要一张（一小时三封）。
   */
  let sentTicket = '';
  /** ③ 有两档：取一对新的（register）还是重设第二串（reset）。 */
  let pairMode: 'register' | 'reset' = 'register';

  const show = (next: Stage) => {
    stage = next;
    msg.textContent = '';
    mailForm.hidden = next !== 'mail';
    codeForm.hidden = next !== 'code';
    /*
     * 「愿不愿意收 Slides 的更新邮件」摆在②上，**对谁都摆**，出厂不勾。
     *
     * 方案里写的是「仅 created=true 时出现」，可那一位要到码验过之后才知道（服务端的
     * `created`）——而要在**发码之前**知道，这个接口就得先回答「这个地址有没有账号」，那
     * 正是它刻意不肯回答的那一问（api/signin.js 顶上那段：有号没号回包一字不差）。两者
     * 不能同时成立，所以选了不开那个洞。
     *
     * 代价很小：服务端只在建账号那一刻读这一位（`createAccount` 那一支），已经有账号的人
     * 传什么都不动他当初的选择。所以老玩家看到这个框、不勾它，他原来勾过的意愿一个字都不
     * 会变。
     */
    newsRow.hidden = next !== 'code';
    pairForm.hidden = next !== 'pair';
    pairForgot.hidden = next !== 'pair' || pairMode === 'reset';
    // ③ 的「重设」那一档只填第一串和新的第二串，那句警告照旧要在（它说的是第一串）。
    warn.hidden = false;
    hint.textContent =
      next === 'mail'
        ? s.signInHint
        : next === 'code'
          ? s.codeSentTo.replace('{email}', sentTo)
          : pairMode === 'reset'
            ? s.pairWarning
            : s.pairlessEntry;
    // ③ 重设那一档：第二串的标签要说「新的」，而那句话就是 pairResetBtn 的意思，所以
    // 用按钮文案去说，标签不动——多一句话不如换一颗键上的字。
    /*
     * ① 那颗键是**一枚箭头**，不是字（玩家定的「少文字」，方案 ① 那一行写的就是
     * `[ 邮箱 ] [→]`）。
     *
     * 从前这儿摆 `s.signInBtn`（「登录」），而那是错的：按《注册》进来的人看到一颗写着
     * 「登录」的键，会以为自己点错了。箭头没有这个问题——它说的是「接着往下」，而往下
     * 到底是注册还是登录，服务端自己知道（`created`），不必在这颗键上替他分。
     *
     * `aria-label` 照旧给一句话，读屏的人要听得懂。
     */
    go.textContent = next === 'mail' ? '→' : next === 'code' ? s.signInBtn : pairMode === 'reset' ? s.pairResetBtn : s.pairSaveBtn;
    go.setAttribute(
      'aria-label',
      next === 'mail' ? s.signInBtn : (go.textContent ?? ''),
    );
    alt.textContent = next === 'mail' ? s.pairlessEntry : next === 'code' ? s.useAnotherEmail : s.useEmailInstead;
    alt.hidden = false;
    (next === 'mail' ? mailInput : next === 'code' ? codeInput : firstInput).focus();
  };

  /** 把一次失败翻译成屏幕上那一句。认的是服务端送回来的那个词，不是状态码。 */
  const say = (reason: string) => {
    msg.textContent =
      reason === 'mailDown'
        ? s.mailDownHint
        : reason === 'tooMany'
          ? s.tooManyTries
          : reason === 'badEmail'
            ? s.emailInvalid
            : reason === 'wrongCode'
              ? s.codeWrong
              : reason === 'codeStale'
                ? s.codeStale
                : reason === 'taken'
                  ? s.pairTaken
                  : reason === 'badPair'
                    ? s.pairBad
                    : reason === 'wrong'
                      ? s.pairWrong
                      : reason === 'locked'
                        ? s.pwLocked.replace('{hours}', '4')
                        : reason === 'unavailable'
                          ? s.serverBusy
                          : s.purchaseNetwork;
  };

  /** 登进去了：缓存已经由 engine 那边写好，这儿只管关窗和把背后那一页刷新。 */
  const landed = () => {
    onChanged();
    close();
    openStatusWindow(lang, onChanged);
  };

  const submit = async () => {
    if (stage === 'mail') {
      const email = mailInput.value.trim();
      if (!isEmail(email)) return void (msg.textContent = s.emailInvalid);
      go.disabled = true;
      msg.textContent = s.workingLabel;
      const asked = await askForCode(email, lang);
      go.disabled = false;
      if (typeof asked === 'string') {
        // mailDown 时**留在这一屏**（E51）：他手里那一步没动，旁边就是另一条路。
        say(asked);
        return;
      }
      sentTo = email;
      sentTicket = asked.challenge;
      codeInput.value = '';
      show('code');
      msg.textContent = s.codeSentNote;
      return;
    }

    if (stage === 'code') {
      const code = codeInput.value.trim();
      if (!/^\d{6}$/.test(code)) return void (msg.textContent = s.codeWrong);
      go.disabled = true;
      msg.textContent = s.workingLabel;
      const done = await signInWithCode(sentTo, code, newsBox.checked, sentTicket);
      go.disabled = false;
      if (!done.ok) {
        pin.reject();
        say(done.reason);
        return;
      }
      await pin.accept();
      landed();
      return;
    }

    // ③ 免邮箱
    const first = firstInput.value.trim();
    const second = secondInput.value.trim();
    if (!PAIR_RE.test(first) || !PAIR_RE.test(second)) return void (msg.textContent = s.pairBad);
    go.disabled = true;
    msg.textContent = s.workingLabel;
    const done = await pairAuth(pairMode === 'reset' ? 'reset' : 'register', first, second);
    go.disabled = false;
    if (!done.ok) {
      // 注册撞名（taken）时**自动改成登录试一次**是不对的：第一串撞上了，第二串几乎不
      // 可能正好也是人家那一串，于是那一次会答「对不上」，而屏幕上写的是两句互相矛盾
      // 的话。如实说「这一串有人用了」，让他换一串。
      say(done.reason);
      return;
    }
    // 先让这台设备的密码管理器存一份（这两串正好是一对「账号 + 密码」），再提醒他截
    // 图——这两串**只有他自己有**：服务端存的是第一串的 sha256，还原不出来，客服也帮不
    // 了他。两样都做，因为管理器可能压根不在（无痕窗口、某些内嵌浏览器）。
    await offerToSave(first, second);
    msg.textContent = s.pairSavedHint;
    // 让那句话在屏幕上留一拍再关窗。reduced-motion 下也一样——这不是动画，是读字的时间。
    await new Promise((r) => setTimeout(r, 1400));
    landed();
  };

  /**
   * ③ 的登录和注册是**同一颗键**。
   *
   * 服务端那两支分得很清（register 要求第一串没人用过，signin 要求两串都对），可玩家手里
   * 只有两串字，他不知道自己算哪一种——**他自己也不该要知道**。所以这颗键先试「登录」，
   * 对不上再试「注册」：
   *
   *   · 两串都对            → 登进去（老用户）
   *   · 第一串没人用过      → 注册出来（新用户）
   *   · 第一串有人、第二串错 → 如实说「对不上」
   *
   * 次序不能反。先注册的话，老用户每次回来都会撞一个 409「已被占用」——而那正是他自己的
   * 账号。
   */
  const pairSubmit = async () => {
    const first = firstInput.value.trim();
    const second = secondInput.value.trim();
    if (!PAIR_RE.test(first) || !PAIR_RE.test(second)) return void (msg.textContent = s.pairBad);
    go.disabled = true;
    msg.textContent = s.workingLabel;
    const signedIn = await pairAuth('signin', first, second);
    if (signedIn.ok) {
      go.disabled = false;
      landed();
      return;
    }
    // 'wrong' 既是「第一串没人用过」也是「第二串不对」——服务端故意答同一句（不然
    // signin 也成了一个枚举接口）。所以这儿只能试一次注册，由它的 409 来分开。
    if (signedIn.reason !== 'wrong') {
      go.disabled = false;
      say(signedIn.reason);
      return;
    }
    const made = await pairAuth('register', first, second);
    go.disabled = false;
    if (!made.ok) {
      // 409 taken 在这一步的意思很明确：第一串有人用，而上面那次登录说两串对不上——
      // 所以是第二串错了。说「对不上」比说「已被占用」准。
      say(made.reason === 'taken' ? 'wrong' : made.reason);
      return;
    }
    await offerToSave(first, second);
    msg.textContent = s.pairSavedHint;
    await new Promise((r) => setTimeout(r, 1400));
    landed();
  };

  for (const form of [mailForm, codeForm, pairForm]) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void (stage === 'pair' && pairMode === 'register' ? pairSubmit() : submit());
    });
  }
  // 走表单自己的 submit，不直接叫 submit()：那一下是手机上的密码管理器认出「这是一次登
  // 录」的唯一凭据，绕过去它就不提示保存。
  go.addEventListener('click', () => {
    (stage === 'mail' ? mailForm : stage === 'code' ? codeForm : pairForm).requestSubmit();
  });

  alt.addEventListener('click', () => {
    if (stage === 'mail') {
      pairMode = 'register';
      show('pair');
      return;
    }
    // ②的《换个邮箱》和③的《改用邮箱》都回①。②那一下**不清掉已经寄出的那张码**：
    // 他可能只是打错了一个字母，回去改完还是同一个地址。
    show('mail');
  });

  pairForgot.addEventListener('click', () => {
    pairMode = 'reset';
    secondInput.value = '';
    show('pair');
  });

  overlay.querySelector<HTMLButtonElement>('#authClose')!.addEventListener('click', () => {
    pin.destroy();
    close();
  });
  show('mail');
}

/**
 * 恢复购买 in the store builds. Apple requires an app selling a subscription
 * to offer this, and it is the only "sign in" those builds have.
 */
export async function runStoreRestore(lang: Lang, onChanged: () => void): Promise<void> {
  const s = STRINGS[lang];
  const { overlay, close } = openModal(
    'auth-modal',
    `
    <h2>${s.restoreBtn}</h2>
    <p class="auth-msg" id="restoreMsg" role="status">${s.workingLabel}</p>
    <div class="btn-row"><button class="primary" id="restoreClose">${s.closeBtn}</button></div>
  `,
  );
  overlay.querySelector<HTMLButtonElement>('#restoreClose')!.addEventListener('click', close);

  const outcome = await restore();
  if (outcome.ok === true) {
    close();
    onChanged();
    openStatusWindow(lang, onChanged);
    return;
  }
  const msg = overlay.querySelector<HTMLElement>('#restoreMsg');
  if (msg) msg.textContent = failureText(outcome.ok === false ? outcome.reason : 'network', lang);
}

/*
 * **《有兑换码》那扇窗撤了**（E41）。
 *
 * 内部码的**前端**全撤：这扇窗、天才那一屏上那一行、《账户》里那一行、个人主页上那一
 * 行。**后端 `api/redeem.js` 和 `api/passcode.js` 的 bind 支一行没动**——已经发出去的码
 * 照旧兑得了，玩家手里那张纸没作废，只是界面上不再招手。
 *
 * 为什么连窗一起撤：「注册就免费解锁全部内容」之后，一张「开通一个月」的码没有任何意
 * 义。留着入口只会让人以为还有什么是要另外换的。
 */

/*
 * **《忘记密码》那扇窗撤了**（E37）。
 *
 * 它是「拿邮箱证明这个账号是自己的，然后设一把新密码」。没有密码了，所以这条路的终点不
 * 存在了；而「拿邮箱证明自己」这件事现在就是**登录本身**（一张寄到邮箱的验证码），忘不
 * 忘无所谓。
 *
 * **后端 `api/unlock.js` 一行没动**：它还守着老账号那条路（在途的标签页、装着旧包的
 * App）。前端不再开这扇窗而已。
 */

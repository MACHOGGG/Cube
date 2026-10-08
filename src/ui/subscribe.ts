import { PRIVILEGES, STRINGS, type Lang } from '../i18n';
import { pushLayer } from '../engine/backNav';
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
  type PurchaseFailure,
} from '../engine/subscription';
import {
  confirmEmailChange,
  requestEmailChange,
  type AccountFailure,
} from '../engine/account';
import { CONTACT_EMAIL } from '../legal';
import { CTL_LEAVE, CTL_REPLAY } from './ctlIcons';
import { ICON_ARROW, ICON_CLOSE, ICON_EYE, ICON_EYE_OFF, ICON_LOGIN, ICON_MAIL } from './uiIcons';
import { geniusLogoTag } from './geniusLogo';

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


/** The same overlay the rules and icon windows use. */
interface ModalOpts {
  /**
   * 点背景、按手机返回键能不能关。默认能。
   *
   * 不能的那一扇从前是《设置密码》（「这一步决定他以后能不能在第二台设备上用这个账号」，
   * 点空了就白设了）——它 2026-10 随密码一起撤了（E37），眼下没有谁传 false。开关留着，
   * 是因为「这一扇不许点掉」是一件真会再出现的事，到时候不用再想一遍返回键要怎么吞。
   */
  dismissable?: boolean;
  /**
   * 按 Esc 关。帐号窗和邀请窗要（第 17 推，方案原话：「点背景或按 Esc 也能关」）。
   *
   * 不一口气给所有窗都打开：登录窗里有输入框和六格验证码，Esc 在那儿常是「清掉这一格」
   * 的手势，按一下整扇窗没了、填了一半的东西也没了——那是「意料之外的疏漏操作」。要给别的
   * 窗打开，先想清楚那扇窗里有没有填到一半的东西。
   */
  escCloses?: boolean;
}

function openModal(className: string, html: string, opts: ModalOpts = {}) {
  const { dismissable = true, escCloses = false } = opts;
  const overlay = document.createElement('div');
  overlay.className = 'overlay show';
  overlay.innerHTML = `<div class="modal ${className}">${html}</div>`;
  document.body.appendChild(overlay);
  let onKey: ((e: KeyboardEvent) => void) | null = null;
  const close = () => {
    overlay.remove();
    if (onKey) window.removeEventListener('keydown', onKey, true);
  };
  // 手机的返回键：能点掉的窗就关掉；不能点掉的那扇返回也不放行——登记一个什么都不做
  // 的关法，这一下就被吞掉，人还在窗里。
  pushLayer(dismissable ? close : () => {}, overlay);
  if (dismissable) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }
  if (escCloses) {
    onKey = (e) => {
      if (e.key !== 'Escape') return;
      // 只有最上面那一层收这一下。窗口级的捕获监听是**按登记先后**依次跑的，不是按谁在
      // 上面：底下要是还压着一扇也收 Esc 的（记录页那张放大的牌子），先登记的那个先跑
      // ——不看层次的话，一下 Esc 会把底下那一层关掉，上面这扇还开着。
      const overlays = document.querySelectorAll('.overlay');
      if (overlays[overlays.length - 1] !== overlay) return;
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
  }
  return { overlay, close };
}


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
function field(
  id: string,
  label: string,
  attrs: string,
  opts: {
    /**
     * 标签只给读屏念，屏幕上不画。
     *
     * 验证码那一栏用它：那六个格子（mountPin）本身就是「在这儿填验证码」，上面那句
     * 「信件里的 6 位数验证码」和格子说的是同一件事，而它还要和浮起来的标签抢那一行。
     * 读屏那一头一个字都不少——`.sr-only` 是「看不见但念得到」，不是 `display: none`。
     */
    srLabel?: boolean;
    /** 标签后面挂的一小行（已经是 HTML，调用方自己转义）。 */
    note?: string;
  } = {},
): string {
  const withPlaceholder = /\bplaceholder\s*=/.test(attrs) ? attrs : `${attrs} placeholder=" "`;
  return `<label class="auth-field${opts.note ? ' auth-field--note' : ''}">
      <input id="${id}" ${withPlaceholder} />
      <span${opts.srLabel ? ' class="sr-only"' : ''}>${label}</span>${opts.note ?? ''}
    </label>`;
}

/**
 * 第一串标签后面那把钥匙 ＋「勿外传」。
 *
 * `aria-hidden`：整句话由 `aria-describedby` 挂在框上念（见 openAuthWindow），这一行是
 * 画给眼睛看的那一份，念两遍反而啰嗦。
 */
const keyNote = (text: string): string =>
  `<span class="auth-keynote" aria-hidden="true">` +
  `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor"` +
  ` stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">` +
  `<circle cx="5" cy="11" r="3"/><path d="M7.2 8.8 13 3"/><path d="M11 5l1.6 1.6"/>` +
  `</svg>${esc(text)}</span>`;

/*
 * **openPortal()（去 Creem 自己的账单页：退订、换卡、拿收据）撤了**（第 17 推）。
 *
 * 唯一的入口是帐号窗里那一行《管理订阅》，而那一行随着「Creem 那几行」一起撤了（网页端
 * 停售，见 openStatusWindow 头上那段）。门户接口 `api/portal.js` 和 `engine/creem.ts` 的
 * `webPortal()` 都还在原处：要重开订阅，回来在帐号窗里摆回一颗键、接回 webPortal 就是。
 * 身份用登录令牌证明（E44），不必再开一扇窗问密码——那一段道理记在 git 历史里这个函数头上。
 */

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
  /**
   * 列表**以一行「……」结尾**（第 17 推，方案原话：「右边功能列表左对齐，以『……』结尾」）。
   *
   * 十条照旧全摆（E40 没动）：这一行「……」不是「剩下的收起来了」——一条都没收——而是
   * 「还不止这些」：天才特供还有个人主页上那三行「敬请期待」，这一窗按 E40 不摆还没做出来
   * 的东西，可也不该让人以为货就这么多。它是装饰，读屏不念（aria-hidden）。
   *
   * ⚠️ **十条加吉祥物会把窗撑长。** 门里必须在 360×640 和 390×844 两档各量一次底排键还在
   * 屏内（check-register-guide.mjs），新版式另由 check-redesign-fit 量不溢出、不重叠——超
   * 了就只能退回「头几条 + ……」那一版，而那是撤回 E40，要先问玩家。
   */
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
    'invite-modal',
    `
    <!--
      抬头底下一道下划线（第 17 推），把「这一窗在说什么」和底下的货单分开。

      ⚠️ 抬头这句话本身就是一句承诺：「仅需注册即可免费成为 Slides 天才」。它成立有一个
      前提——服务端的 GENIUS_GRANT_WINDOW 开着，而两者之间没有任何自动的联系（E54，见
      api/_entitlement.js 的 grantWindowOpen）。要关那个开关，先回来改这句话。

      抬头底下原先还有一句「注册后免费立即解锁全部内容」（registerUnlocks）——和抬头说的
      是同一件事，第 17 推按方案删掉了（「少文字」）。货单上那个小标题「注册后立即解锁」
      也不再印出来，留给读屏当这张单子的名字（见 ul 的 aria-label）。
    -->
    <h2 class="invite-title">${s.subscribeTitle}</h2>
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
    <!-- 原先这儿有一行空着的状态句（#geniusMsg），可从来没有谁往里写过字——它只是在
         抬头和货单之间垫了 30 来像素的空白。第 17 推撤掉。 -->
    <!-- 左边吉祥物，右边货单（第 17 推）。吉祥物是装饰，读屏不念。 -->
    <div class="invite-body">
      <div class="invite-mascot">${geniusLogoTag(64, 'genius-logo--invite')}</div>
      <ul class="invite-perks" aria-label="${esc(s.geniusNowTitle)}">
        ${nowList.map((p) => `<li class="genius-perk">${esc(p)}</li>`).join('')}
        <li class="genius-perk genius-perk--more" aria-hidden="true">……</li>
      </ul>
    </div>
    <!--
      两颗等宽、对称的棕色药丸，只放图标：✕ 和登录（第 17 推）。字留给 aria-label。

      从前右边那颗是有字的《注册》，而且是全窗最亮的一颗：一个已经注册过、却被带到这一
      窗的人，出路是登录，不是关窗。现在两颗一样重，可左右的位置照旧——出路在右手边。
    -->
    <div class="invite-actions">
      <button type="button" class="pill-icon" id="geniusClose" aria-label="${esc(s.closeBtn)}">${ICON_CLOSE}</button>
      <button type="button" class="pill-icon" id="geniusRestore" aria-label="${esc(
        isStoreChannel() ? s.restoreBtn : s.registerBtn,
      )}">${ICON_LOGIN}</button>
    </div>
  `,
    { escCloses: true },
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
 * 《账号》——登录之后，跟这个账号有关的事都在这一扇窗里。
 *
 * 原先它叫「订单情况」，只有天才点得开，抬头写着「你已是 Slides 天才」，底
 * 下横着一排小按钮（管理订阅 / 退出登录 / 绑定），《关闭》还是最红的那一颗。
 * 玩家指出的两件事都指向同一个毛病：
 *
 *   「登录是登录……登录不代表有权限」——订阅过期的人照样是这个账号的主人，
 *     那扇门不该只对天才开。
 *   「注意整体排版清晰放在一起，不要东一个西一个」——一排横着的小按钮，
 *     宽窄不一、轻重不分，本来就不是给「几件并列的事」用的排法。
 *
 * ── 第 17 推（2026-10）又瘦了一圈 ────────────────────────────────────
 *
 * 现在这扇窗只答一件事：「这是谁的账号」。一张白卡，抬头《账号》，底下**一条**字段（只
 * 有一道 2px 的下划线，没有框），再下面三颗只放图标的棕色药丸，竖着排、一样宽、一样
 * 远：更换（只有邮箱账号有）、登出、联络。右上角一颗 ✕，点背景、按 Esc 也关。
 *
 * 撤掉的三样，各有各的理由：
 *
 *   · **有效期**——注册即终身（E45/E46），这一行对每个人写的都是「永久」，一句永远一样
 *     的话不是信息。
 *   · **礼物码**——那是年付送的码（每单两张）。站上已经不卖年付了，新账号一张都不会有。
 *     后端发码、兑码那两支一行没动（`api/redeem.js`），手上已经有码的人照样兑得了。
 *   · **Creem 那几行**（订的是哪一档、《管理订阅》）——网页端停售（E11 / PR-12）。结账、
 *     门户那两支接口和 `engine/creem.ts` 都还在原处，要重开订阅回来在这儿摆回一行就是。
 *
 * 客服信箱从前印成一整句「有问题……写信到 xxx」，现在是第三颗键（mailto）。地址本身还
 * 印在个人主页的《联系与特别感谢》里。
 */
export function openStatusWindow(lang: Lang, onChanged: () => void, notice = ''): void {
  const s = STRINGS[lang];
  const current = entitlement();
  const store = isStoreChannel();
  /**
   * 三颗键，按这个顺序竖着排。
   *
   * ⚠️ **免邮箱凭据账号不摆《更换》**（E53）。api/email.js 要求「现在这个地址」过
   * EMAIL_RE，而这种账号的 id 是 hdl: 加一串 hex——点下去必是 400，而屏幕上只会写一句含
   * 糊的失败。一条走不通的路比没有这条路更糟。门（check-redesign-fit）钉着这一条。
   *
   * 商店那一端不摆《登出》：那一端没有账号这回事（App Store / Google Play 本来就知道是谁
   * 拿着手机），沿用原先的规矩。
   */
  const actions = [
    handleOf(current) ? '' : pillIcon('statusChangeEmail', s.changeEmailRow, CTL_REPLAY),
    store ? '' : pillIcon('statusSignOut', s.signOutBtn, CTL_LEAVE),
    `<a class="pill-icon" id="statusMail" href="mailto:${CONTACT_EMAIL}" aria-label="${esc(s.contactTitle)}">${ICON_MAIL}</a>`,
  ].join('');
  const { overlay, close } = openModal(
    'acct-modal',
    `
    <button type="button" class="modal-x" id="statusClose" aria-label="${esc(s.closeBtn)}">${ICON_CLOSE}</button>
    <h2>${s.accountTitle}</h2>
    ${idField(current, lang)}
    ${
      // 没有在续的权益就明说这一句——登录是登录，有没有权限是另一件事（见上面那段）。
      current.active ? '' : `<p class="auth-hint">${s.orderLapsed}</p>`
    }
    ${
      // 只有带着一句话回来的时候才有这一行（换完邮箱回到这扇窗，见下面那个 back）。从前它
      // 一直在，空着也要占一行高，于是字段和三颗键之间凭空多出一截空白。
      notice ? `<p class="auth-msg" id="statusMsg" role="status">${esc(notice)}</p>` : ''
    }
    <div class="acct-actions">${actions}</div>
    ${store ? `<p class="auth-hint">${s.manageOnStore.replace('{store}', payeeName())}</p>` : ''}
  `,
    { escCloses: true },
  );

  // 换邮箱：一扇小窗，关掉之后回到这一扇（back），这样玩家改完能当场看见改成了什么，
  // 不用自己再点回来。回来那一下是重新开的窗，所以第一串照样是遮着的。
  const back = (notice = '') => openStatusWindow(lang, onChanged, notice);
  overlay.querySelector<HTMLButtonElement>('#statusChangeEmail')?.addEventListener('click', () => {
    close();
    openChangeEmailWindow(lang, onChanged, back);
  });
  // Signing out only forgets the address on this device: it cancels nothing,
  // and naming the address again brings the account straight back.
  overlay.querySelector<HTMLButtonElement>('#statusSignOut')?.addEventListener('click', () => {
    clearEntitlement();
    close();
    onChanged();
  });
  overlay.querySelector<HTMLButtonElement>('#statusClose')!.addEventListener('click', close);
  wireHandleEye(overlay, current, lang);
}

/** 一颗只放图标的棕色药丸。字不上键，只给读屏（方案：「每个按钮都带 aria-label」）。 */
function pillIcon(id: string, label: string, icon: string): string {
  return `<button type="button" class="pill-icon" id="${id}" aria-label="${esc(label)}">${icon}</button>`;
}

/**
 * 第一串遮起来时的样子：四个圆点加末四位。
 *
 * 末四位是让他认得出「是我那一串」——一串全遮的点谁都长一样；全露出来又等于把钥匙摊在
 * 屏幕上（第一串是钥匙，知道它的人可以重设第二串，见注册窗里那句警告）。少于五位的串
 * 不会有（PAIR_RE 要八位起），这里照样兜一下：整串都遮。
 */
export function maskHandle(handle: string): string {
  return handle.length > 4 ? '••••' + handle.slice(-4) : '••••';
}

/**
 * 「你是谁」那一条字段（E53 → 第 17 推）。
 *
 * 免邮箱凭据账号（E38）的 `email` 里放的是服务端认人的那把 id（`hdl:` 加 64 位 hex），
 * **那一串不能印给人看**——服务端也印不出来，它只存第一串的 sha256。所以这种账号印的是客
 * 户端自己留的那份原文（`handle`），标签换成「第一串」，**默认遮住**：旁边一颗眼睛，按
 * 一下才露出来。每次开窗都重新遮上——遮不遮不记在任何地方，状态就活在这一扇窗里。
 *
 * 第二串一个字都不显示：服务端只有 scrypt 哈希，客户端也不存。这是设计，不是漏了。
 */
function idField(current: Entitlement, lang: Lang): string {
  const s = STRINGS[lang];
  const handle = handleOf(current);
  if (handle) {
    return `<div class="acct-field">
      <span class="acct-field-label" id="acctIdLabel">${esc(s.pairFirstShort)}</span>
      <span class="acct-field-value" id="acctId" aria-labelledby="acctIdLabel">${esc(maskHandle(handle))}</span>
      <button type="button" class="acct-eye" id="acctEye" aria-pressed="false" aria-label="${esc(s.showHandle)}">${ICON_EYE}</button>
    </div>`;
  }
  if (!current.email) return '';
  return `<div class="acct-field">
    <span class="acct-field-label">${esc(s.emailLabel)}</span>
    <span class="acct-field-value">${esc(current.email)}</span>
  </div>`;
}

/** 那颗眼睛：遮 ⇄ 露。图标跟着换（睁眼＝「按我露出来」，划掉的眼＝「按我遮回去」）。 */
function wireHandleEye(overlay: HTMLElement, current: Entitlement, lang: Lang): void {
  const handle = handleOf(current);
  const eye = overlay.querySelector<HTMLButtonElement>('#acctEye');
  const value = overlay.querySelector<HTMLElement>('#acctId');
  if (!handle || !eye || !value) return;
  const s = STRINGS[lang];
  eye.addEventListener('click', () => {
    const shown = eye.getAttribute('aria-pressed') !== 'true';
    value.textContent = shown ? handle : maskHandle(handle);
    eye.setAttribute('aria-pressed', String(shown));
    eye.setAttribute('aria-label', shown ? s.hideHandle : s.showHandle);
    eye.innerHTML = shown ? ICON_EYE_OFF : ICON_EYE;
  });
}

/*
 * **《订单情况》那一块（orderBlock）、礼物码那一块（giftBlock）和它的复制键
 * （wireCopyButtons）撤了**（第 17 推）。理由在 openStatusWindow 头上那三条。
 *
 * 复制键那一套里有一条值得记住的规矩，下回再做「复制」时照着来：**只有真的写进了剪贴板
 * 才说「已复制」**——writeText 可能 reject（没权限、非安全上下文、某些内嵌容器），一句假
 * 的「已复制」比按了没反应糟得多，他会直接去粘贴，粘出来的是上一次剪贴板里的东西。代码
 * 在 git 历史里（第 13 推那一版的 subscribe.ts）。
 */

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
           态），这儿只摆那个真输入框。标签只给读屏念：六个格子本身就是那句话。 -->
      <form id="authCodeForm" autocomplete="on" hidden>
        ${field('authCode', s.codeFieldLabel,
          'type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code"',
          { srLabel: true })}
        <label class="auth-optin" id="authNewsRow" hidden>
          <input type="checkbox" id="authNews" />
          <span>${s.newsOptIn}</span>
        </label>
        <button type="submit" hidden></button>
      </form>

      <!-- ③ 免邮箱态。两个框都是**明文**：玩家要抄下来的东西，遮住反而抄错。
           第一串那一行挂着钥匙和「勿外传」，整句警告由 aria-describedby 念（见下面）。 -->
      <form id="authPairForm" autocomplete="off" hidden>
        ${field('authFirst', s.pairFirstLabel,
          `type="text" autocomplete="off" autocapitalize="off" spellcheck="false" minlength="8" maxlength="64"` +
          ` placeholder="${esc(s.pairPlaceholder)}" aria-describedby="authPairWarn"`,
          { note: keyNote(s.pairKeyNote) })}
        ${field('authSecond', s.pairSecondLabel,
          `type="text" autocomplete="off" autocapitalize="off" spellcheck="false" minlength="8" maxlength="64"` +
          ` placeholder="${esc(s.pairPlaceholder)}"`)}
        <p class="sr-only" id="authPairWarn">${s.pairWarning}</p>
        <button type="submit" hidden></button>
      </form>

      <p class="auth-msg" id="authMsg" role="status"></p>
      <button class="link-btn" id="authAlt"></button>
      <button class="link-btn" id="authPairForgot" hidden>${s.pairForgot}</button>
    </div>
    <!--
      两颗等宽、对称的棕色药丸，只放图标：✕ 和 →（第 17 推第 8 条：「登录窗同样改成 ✕ 和棕色
      『→』，四扇窗按钮风格一致」）。和邀请窗那一排同一个零件（.pill-icon）；字留给 aria-label。

      从前这一排是一枚灰色的小 ✕ 加一颗砖红的长药丸（第 9 推）：四扇窗里只有这一扇长这样，从
      邀请窗点《登录》过来，底下那两颗键当场换了样子、换了颜色。出路照旧在右手边。
    -->
    <div class="auth-actions">
      <button type="button" class="pill-icon" id="authClose" aria-label="${esc(s.closeBtn)}">${ICON_CLOSE}</button>
      <button type="button" class="pill-icon" id="authGo" aria-label="${esc(s.continueBtn)}">${ICON_ARROW}</button>
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
    tell('');
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
    // 它现在是读屏专用的那一段（`.sr-only`），所以「在不在」仍然要紧，只是看不见。
    warn.hidden = false;
    hint.textContent =
      next === 'mail'
        ? s.signInHint
        : next === 'code'
          ? s.codeSentTo.replace('{email}', sentTo)
          : pairMode === 'reset'
            ? s.pairResetBtn
            : s.pairlessEntry;
    // ③ 重设那一档：第二串的标签要说「新的」，而那句话就是 pairResetBtn 的意思，所以
    // 用按钮文案去说，标签不动——多一句话不如换一颗键上的字。
    /*
     * **三态共用一枚箭头**（玩家定的「少文字」）。
     *
     * 从前只有①是箭头，②摆「登录」、③摆「保存」/「重设第二串」——三颗不同的键摆在同一
     * 个位置上，而玩家做的是同一件事：接着往下。「登录」那一颗还错得更具体：按《注册》
     * 进来的人看到它会以为自己点错了，而「到底是注册还是登录」服务端自己知道
     * （`created`），不必在这颗键上替他分。
     *
     * `aria-label` 一律念 `continueBtn`（「继续」），读屏的人听得懂，而且三态一致——念
     * 「保存」的那一版会让人以为这一步和上一步是两回事。
     */
    go.innerHTML = ICON_ARROW;
    go.setAttribute('aria-label', s.continueBtn);
    alt.textContent = next === 'mail' ? s.pairlessEntry : next === 'code' ? s.useAnotherEmail : s.useEmailInstead;
    alt.hidden = false;
    (next === 'mail' ? mailInput : next === 'code' ? codeInput : firstInput).focus();
  };

  /**
   * 底下那一行提示分两档。
   *
   * 从前**整行恒是报错色**（style.css 的 `.auth-msg` 写死 `--accent-ink`），于是「正在
   * 处理…」「已存好」这种好消息也印成红的——玩家按下去，屏幕上红一行，他的第一反应是出
   * 事了。现在默认灰，只有真的出错才加 `auth-msg--bad`。
   */
  const tell = (text: string) => {
    msg.textContent = text;
    msg.classList.remove('auth-msg--bad');
  };
  const oops = (text: string) => {
    msg.textContent = text;
    msg.classList.add('auth-msg--bad');
  };

  /** 把一次失败翻译成屏幕上那一句。认的是服务端送回来的那个词，不是状态码。 */
  const say = (reason: string) => {
    oops(
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
                          : s.purchaseNetwork,
    );
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
      if (!isEmail(email)) return void oops(s.emailInvalid);
      go.disabled = true;
      tell(s.workingLabel);
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
      return;
    }

    if (stage === 'code') {
      const code = codeInput.value.trim();
      if (!/^\d{6}$/.test(code)) return void oops(s.codeWrong);
      go.disabled = true;
      tell(s.workingLabel);
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
    if (!PAIR_RE.test(first) || !PAIR_RE.test(second)) return void oops(s.pairBad);
    go.disabled = true;
    tell(s.workingLabel);
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
    tell(s.pairSavedHint);
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
    if (!PAIR_RE.test(first) || !PAIR_RE.test(second)) return void oops(s.pairBad);
    go.disabled = true;
    tell(s.workingLabel);
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
    // 登录对不上、注册成了：他按的是同一颗键，多半以为自己在登旧账号——第一串打错一个字就会
    // 这样悄悄开出一个新号。说出来（2026-10-08 方案 2-13，玩家原话），流程一个字不动。
    tell(s.pairNewAccountHint);
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
 * 后端 `api/unlock.js` 起初一行没动，留给老账号那条路（在途的标签页、装着旧包的 App）；
 * **第 20 推起它整条回 410**（实现留着、走不到，见那个文件）。这里调它的两个函数
 * （engine/account.ts 的 requestUnlock / confirmUnlock）已经没有任何入口在叫。
 */

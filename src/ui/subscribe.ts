import { PRIVILEGES, STRINGS, type Lang } from '../i18n';
import { pushLayer } from '../engine/backNav';
import { GENIUS_LAYOUTS } from '../engine/geniusContent';
import { shapeName } from './shapeLabels';
import { isStoreChannel, payeeName } from '../engine/channel';
import { formatPrice, plans, type PlanPeriod } from '../engine/pricing';
import {
  attachAccount,
  clearEntitlement,
  entitlement,
  isGenius,
  pendingAccount,
  purchase,
  rememberPending,
  restore,
  setEntitlement,
  signedInEmail,
  type Entitlement,
  type GiftCode,
  type PendingAccount,
  type PurchaseFailure,
} from '../engine/subscription';
import {
  changePasscode,
  confirmEmailChange,
  confirmUnlock,
  redeemCode,
  requestEmailChange,
  requestUnlock,
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
  if (id === 'triangleAdvanced') return s.geniusNowTriangleAdvanced;
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

export type AuthTab = 'register' | 'login';

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
    case 'notConfigured':
      return s.notOnSaleYet;
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
const isPin = (value: string) => /^[A-Za-z0-9]{6}$/.test(value);

/** One labelled input, in the shape the auth windows all use. */
function field(id: string, label: string, attrs: string): string {
  return `<label class="auth-field">
      <span>${label}</span>
      <input id="${id}" ${attrs} />
    </label>`;
}

/**
 * The password, asked once more before the billing page opens.
 *
 * `current-password` rather than `new-password` here, so a manager offers to
 * fill the one it already has rather than to invent another.
 */
export function openPortalWindow(lang: Lang, email: string): void {
  const s = STRINGS[lang];
  const { overlay, close } = openModal(
    'auth-modal',
    `
    <h2>${s.manageSubscription}</h2>
    <form id="portalForm" class="auth-body" autocomplete="on">
      ${field('portalUser', s.emailLabel,
        `type="email" name="username" autocomplete="username" readonly value="${esc(email)}"`)}
      ${field('portalPw', s.passwordAny,
        `type="password" name="password" autocomplete="current-password"`)}
      <button type="submit" hidden></button>
    </form>
    <p class="auth-msg" id="portalMsg" role="status"></p>
    <div class="btn-row">
      <button class="btn-quiet" id="portalClose">${s.closeBtn}</button>
      <button class="primary" id="portalGo">${s.manageSubscription}</button>
    </div>
  `,
  );
  const form = overlay.querySelector<HTMLFormElement>('#portalForm')!;
  const pw = overlay.querySelector<HTMLInputElement>('#portalPw')!;
  const msg = overlay.querySelector<HTMLElement>('#portalMsg')!;
  const go = overlay.querySelector<HTMLButtonElement>('#portalGo')!;

  const submit = async () => {
    if (!pw.value) return void (msg.textContent = s.pwWrong);
    go.disabled = true;
    msg.textContent = s.workingLabel;
    const { webPortal } = await import('../engine/creem');
    const opened = await webPortal(email, pw.value);
    go.disabled = false;
    if (opened) return close();
    msg.textContent = s.pwWrong;
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void submit();
  });
  go.addEventListener('click', () => form.requestSubmit());
  overlay.querySelector<HTMLButtonElement>('#portalClose')!.addEventListener('click', close);
  pw.focus();
}

/**
 * A form that a phone's password manager will recognise.
 *
 * Both platforms decide whether to offer "save this password?" by looking at
 * the shape of the markup, not by being asked, and both want the same three
 * things: a real <form>, an identifying field marked `username`, and the
 * password field marked `new-password` when one is being chosen. The username
 * here is the address the player already paid with, so it is shown read-only
 * rather than asked for again — visible, because a hidden field is exactly
 * what a manager is trained to distrust.
 */
function credentialForm(
  email: string,
  emailLabel: string,
  label: string,
  placeholder: string,
  readOnly: boolean,
  newsLabel: string,
): string {
  // An address we already know is shown, not put in a box. A readonly input
  // is one line wide and quietly cuts a long address off at the edge — and
  // this is the address the whole subscription will hang on, so it is worth
  // being able to read all of it before choosing the password underneath.
  // The input stays, hidden, because a password manager will not offer to
  // save anything unless the form carries an autocomplete="username" field.
  const known = readOnly
    ? `<div class="auth-account">
         <span class="auth-account-label">${esc(emailLabel)}</span>
         <span class="auth-account-value">${esc(email)}</span>
       </div>
       <input id="pwUser" type="email" name="username" autocomplete="username"
              value="${esc(email)}" hidden readonly />`
    : field('pwUser', emailLabel,
        `type="email" name="username" autocomplete="username" inputmode="email" value="${esc(email)}"`);
  // Its own class, not .auth-body: that one is a centring flex *row*, built
  // to hold a single child, and it laid the address and the password box
  // side by side — half a window each, and the address cut off. Here they
  // are stacked, which is also what the window is meant to say: this is your
  // account, and this is the password you are choosing for it.
  return `<form id="pwForm" class="pw-form" autocomplete="on">
      ${known}
      ${field('pwNew', label,
        `type="password" name="password" autocomplete="new-password" minlength="6" maxlength="6" placeholder="${esc(placeholder)}"`)}
      <!-- 这是账号建起来的那一刻，也是唯一一次能在给出邮箱的当下问一句「要不要
           收信」的机会。默认不勾：同意得是主动给的，预先替人勾上的不算同意
           （GDPR 明确不认），所以这个框出厂就是空的。 -->
      <label class="auth-optin">
        <input type="checkbox" id="pwNews" />
        <span>${esc(newsLabel)}</span>
      </label>
      <button type="submit" hidden></button>
    </form>`;
}

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

/**
 * Choosing the password, the moment the player lands back from Creem.
 *
 * They are already a subscriber when this opens — the boards are unlocked
 * behind it — so nothing here is a gate. It is the one step that makes the
 * subscription theirs rather than this browser's: without it, the only way
 * back in on another phone would be to name an address anyone could guess.
 */
export function openSetPasswordWindow(
  lang: Lang,
  pending: PendingAccount,
  email: string,
  onChanged: () => void,
): void {
  const s = STRINGS[lang];
  // A card checkout already knows the address — Creem collected it, and it is
  // shown rather than asked for. A code knows nothing about who typed it, so
  // here the field is theirs to fill in.
  const fromCode = pending.kind === 'code';
  const { overlay, close } = openModal(
    'auth-modal',
    `
    <h2>${fromCode ? s.bindTitle : s.setPwTitle}</h2>
    <p class="auth-hint">${fromCode ? s.bindHint : s.setPwHint}</p>
    ${credentialForm(email, s.emailLabel, s.setPwLabel, s.setPwPlaceholder, !fromCode, s.newsOptIn)}
    <p class="auth-msg" id="pwMsg" role="status"></p>
    <div class="btn-row">
      ${fromCode ? `<button class="btn-quiet" id="pwLater">${s.bindLater}</button>` : ''}
      <button class="primary" id="pwGo">${fromCode ? s.bindTitle : s.setPwTitle}</button>
    </div>
  `,
    // 刷卡的那扇不能点掉：刚付了钱、还没设密码的人，手上的订阅只活在这一个
    // 浏览器里，永远搬不走；所有不是「设一个」的出路都通向那儿。
    // 内部码的那扇能点掉：码一输进去权益就已经生效了，绑不绑账号是他自己的
    // 事——这里只是建议（玩家的原话：「改为建议注册，不要一直弹窗然后不注
    // 册就不能玩」）。以后想绑，状态窗里有《绑定到账户》。
    fromCode,
  );
  overlay.querySelector<HTMLButtonElement>('#pwLater')?.addEventListener('click', close);

  const form = overlay.querySelector<HTMLFormElement>('#pwForm')!;
  const input = overlay.querySelector<HTMLInputElement>('#pwNew')!;
  const msg = overlay.querySelector<HTMLElement>('#pwMsg')!;
  const go = overlay.querySelector<HTMLButtonElement>('#pwGo')!;

  const user = overlay.querySelector<HTMLInputElement>('#pwUser')!;
  const news = overlay.querySelector<HTMLInputElement>('#pwNews')!;
  const submit = async () => {
    const address = user.value.trim();
    if (fromCode && !isEmail(address)) return void (msg.textContent = s.emailInvalid);
    const password = input.value;
    if (password.length !== 6) return void (msg.textContent = s.setPwShort);
    go.disabled = true;
    msg.textContent = s.workingLabel;
    const done = await attachAccount(pending, password, address, news.checked);
    go.disabled = false;
    // For a checkout, 'exists' means the address already had a password and
    // there is nothing left to do. For a code it is the opposite: this is the
    // wrong address to attach it to, and another one will work.
    if (done === 'exists') {
      if (!fromCode) return close();
      msg.textContent = s.bindTaken;
      return;
    }
    // Both remaining failures say so and leave the window open. Closing
    // quietly on the server's 503 was worse than useless: the player typed a
    // password, the window vanished, and nothing had been saved — a failure
    // wearing the exact face of success.
    if (done !== 'ok') {
      msg.textContent = done === 'unavailable' ? s.serverBusy : s.purchaseNetwork;
      return;
    }
    // Saved on the server; now let the phone keep a copy too.
    await offerToSave(address || email, password);
    close();
    onChanged();
  };

  // A real submit is what the password manager watches for, so let the form
  // fire one and stop only the navigation.
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void submit();
  });
  go.addEventListener('click', () => form.requestSubmit());
  // No opt-out button and no way to tap it away: one field, and it is the
  // whole of what makes this subscription theirs rather than this browser's.
  // Force-quitting is not an escape either — the checkout is remembered, so
  // the window is the first thing the next launch puts up.
  input.focus();
}

/**
 * Called once at boot: if a checkout is still waiting for a password — this
 * launch's, or one from a launch where it never got set — that window is the
 * first thing the player sees. It keeps coming back until the password
 * exists, because that password is the only way a subscription bought on one
 * device is ever reachable from another.
 */
export function promptPasswordIfJustPaid(lang: Lang, onChanged: () => void): void {
  const pending = pendingAccount();
  // 只追刷卡的。内部码兑换后的绑定是建议，不在每次打开时再弹一遍。
  if (pending && pending.kind !== 'code') openSetPasswordWindow(lang, pending, signedInEmail() ?? '', onChanged);
}

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
    `${PRIVILEGES[lang][4]} · ${s.flipModeTitle}`,
  ];
  const soonList = [1, 5, 7].map((i) => PRIVILEGES[lang][i]);
  const priceRows = plans()
    .map(
      (plan) => `
      <button class="plan-row" data-period="${plan.period}">
        <span class="plan-period">${plan.period === 'yearly' ? s.planYearly : s.planMonthly}</span>
        <span class="plan-price">${esc(formatPrice(plan, lang))}</span>
      </button>`,
    )
    .join('');

  const { overlay, close } = openModal(
    'genius-modal',
    `
    <h2>${s.subscribeTitle}</h2>
    <p class="tag-line">${s.subscribeIntro}</p>
    <div class="plan-list">${priceRows}</div>
    ${
      // The store has something worth saying here — no sign-up, never leaves
      // the app. Paying by card no longer does: what used to sit here said
      // there was no password to set, which the very next window disproves.
      isStoreChannel()
        ? `<p class="auth-hint">${s.storeNoAccountHint.replace('{store}', store)}</p>`
        : ''
    }
    <button class="link-btn" id="geniusRedeem">${s.haveCode}</button>
    <p class="auth-msg" id="geniusMsg" role="status"></p>
    <div class="genius-perks">
      <div class="menu-section-label">${s.geniusNowTitle}</div>
      ${nowList.map((p) => `<div class="genius-perk">${esc(p)}</div>`).join('')}
      <div class="menu-section-label">${s.geniusSoonTitle}</div>
      ${soonList.map((p) => `<div class="genius-perk genius-perk--soon">${p}</div>`).join('')}
    </div>
    <div class="btn-row">
      <!-- 登录 is the accented one. Someone who already subscribed and is
           looking at the paywall got here by accident, and the way out of
           that is signing in, not closing the window. -->
      <button class="btn-quiet" id="geniusClose">${s.closeBtn}</button>
      <button class="primary" id="geniusRestore">${
        isStoreChannel() ? s.restoreBtn : s.signInBtn
      }</button>
    </div>
  `,
  );

  const msg = overlay.querySelector<HTMLElement>('#geniusMsg')!;
  const rows = Array.from(overlay.querySelectorAll<HTMLButtonElement>('.plan-row'));
  const setBusy = (busy: boolean) => {
    for (const row of rows) row.disabled = busy;
    msg.textContent = busy ? s.workingLabel : '';
  };

  for (const row of rows) {
    row.addEventListener('click', async () => {
      setBusy(true);
      const outcome = await purchase(row.dataset.period as PlanPeriod);
      // The web hands the tab to Creem; there is no result to show here.
      if (outcome.ok === 'redirecting') return;
      setBusy(false);
      if (outcome.ok === true) {
        close();
        onChanged();
        openStatusWindow(lang, onChanged);
        return;
      }
      msg.textContent = failureText(outcome.reason, lang);
    });
  }

  overlay.querySelector<HTMLButtonElement>('#geniusRedeem')!.addEventListener('click', () => {
    close();
    openRedeemWindow(lang, onChanged);
  });
  overlay.querySelector<HTMLButtonElement>('#geniusRestore')!.addEventListener('click', () => {
    close();
    if (isStoreChannel()) runStoreRestore(lang, onChanged);
    else openAuthWindow(lang, 'login', onChanged);
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
    <div class="acct-rows">
      ${row('statusChangePw', s.changePwRow)}
      ${row('statusChangeEmail', s.changeEmailRow)}
      ${
        // 没有在续的订阅：兑一张内部码就是他此刻最该走的那条路，所以它排在
        // 这里，而不是只藏在登录窗的一行小字后面。
        isGenius() ? '' : row('statusRedeem', s.insiderCode)
      }
      ${pendingAccount()?.kind === 'code' ? row('statusBind', s.bindNow) : ''}
      ${hasPortal ? row('statusManage', s.manageSubscription) : ''}
      ${isStoreChannel() ? '' : row('statusSignOut', s.signOutBtn)}
    </div>
    ${
      isStoreChannel()
        ? `<p class="auth-hint">${s.manageOnStore.replace('{store}', payeeName())}</p>`
        : ''
    }
    <div class="btn-row">
      <button class="btn-quiet" id="statusClose">${s.closeBtn}</button>
    </div>
  `,
  );

  // 换密码 / 换邮箱：各自一扇小窗，关掉之后回到这一扇（refresh），这样玩家
  // 改完能当场看见改成了什么，不用自己再点回来。
  const back = (notice = '') => openStatusWindow(lang, onChanged, notice);
  overlay.querySelector<HTMLButtonElement>('#statusChangePw')?.addEventListener('click', () => {
    close();
    openChangePasswordWindow(lang, onChanged, back);
  });
  overlay.querySelector<HTMLButtonElement>('#statusChangeEmail')?.addEventListener('click', () => {
    close();
    openChangeEmailWindow(lang, onChanged, back);
  });
  overlay.querySelector<HTMLButtonElement>('#statusRedeem')?.addEventListener('click', () => {
    close();
    openRedeemWindow(lang, onChanged);
  });

  // 内部码还只跟着这台设备走：想让它跟着自己走，从这儿绑到一个邮箱。
  overlay.querySelector<HTMLButtonElement>('#statusBind')?.addEventListener('click', () => {
    const pending = pendingAccount();
    close();
    if (pending) openSetPasswordWindow(lang, pending, '', onChanged);
  });

  // Cancelling a web subscription happens on Creem's own portal page — they
  // hold the billing record, so it is never something this app pretends to do.
  overlay.querySelector<HTMLButtonElement>('#statusManage')?.addEventListener('click', () => {
    // Behind this link are the card's last four digits, the payment history
    // and the cancel button, so it asks for the password again even though
    // this device is signed in — the same re-check a bank does.
    close();
    openPortalWindow(lang, signedInEmail() ?? '');
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
  if (current.email) rows.push([s.emailLabel, current.email]);
  if (current.period) {
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
              : `<button class="gift-copy" data-copy="${esc(gift.code)}">${esc(s.copyBtn)}</button>`
          }
        </div>`;
      })
      .join('')}
  </div>`;
}

/** Copy, with the button saying so for a moment — the whole feedback. */
function wireCopyButtons(overlay: HTMLElement, lang: Lang): void {
  const s = STRINGS[lang];
  for (const btn of Array.from(overlay.querySelectorAll<HTMLButtonElement>('.gift-copy'))) {
    btn.addEventListener('click', async () => {
      const code = btn.dataset.copy ?? '';
      const was = btn.textContent;
      try {
        await navigator.clipboard.writeText(code);
        btn.textContent = s.copiedLabel;
      } catch {
        // No clipboard permission: select it instead, so it can still be
        // copied by hand rather than the button doing nothing at all.
        const node = btn.previousElementSibling?.previousElementSibling;
        if (node) {
          const range = document.createRange();
          range.selectNodeContents(node);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      }
      window.setTimeout(() => (btn.textContent = was), 1400);
    });
  }
}

/**
 * 更换密码。旧密码是唯一的凭据——不是「登着就能改」。
 *
 * 一台没锁屏的手机被人拿去，如果登着就能改密码，那台手机的主人当场就丢了账
 * 号（新密码是拿手机的人设的，真主人反而进不去）。多问一次旧密码，挡的正是
 * 这一种；真主人不过是多打六个字符。
 *
 * 改完服务端会把所有设备的令牌一并作废（换了钥匙，别人手上那把就该不好使），
 * 再发一把新的给这台。那把新的一定要存下来，不然刚改完密码的人自己先掉线。
 */
export function openChangePasswordWindow(
  lang: Lang,
  onChanged: () => void,
  onBack: (notice?: string) => void,
): void {
  const s = STRINGS[lang];
  const email = signedInEmail() ?? '';
  const { overlay, close } = openModal(
    'auth-modal',
    `
    <h2>${s.changePwRow}</h2>
    <p class="auth-hint">${esc(email)}</p>
    <form id="cpwForm" autocomplete="on">
      <input type="email" name="username" autocomplete="username" value="${esc(email)}" hidden readonly />
      ${field('cpwOld', s.oldPwLabel, `type="password" name="current-password" autocomplete="current-password"`)}
      ${field('cpwNew', s.newPwLabel,
        `type="password" name="new-password" autocomplete="new-password" placeholder="${esc(s.setPwPlaceholder)}"`)}
      <button type="submit" hidden></button>
    </form>
    <p class="auth-msg" id="cpwMsg" role="status"></p>
    <div class="btn-row">
      <button class="btn-quiet" id="cpwClose">${s.closeBtn}</button>
      <button class="primary" id="cpwGo">${s.confirmBtn}</button>
    </div>
  `,
  );

  const oldPw = overlay.querySelector<HTMLInputElement>('#cpwOld')!;
  const newPw = overlay.querySelector<HTMLInputElement>('#cpwNew')!;
  const msg = overlay.querySelector<HTMLElement>('#cpwMsg')!;
  const go = overlay.querySelector<HTMLButtonElement>('#cpwGo')!;
  const form = overlay.querySelector<HTMLFormElement>('#cpwForm')!;

  const submit = async () => {
    if (!oldPw.value) return void (msg.textContent = s.pwWrong);
    // 和服务器同一条规矩（PASS_RE：正好 6 位，数字或字母）。先在这儿说一遍，
    // 省一趟往返，也省得玩家把「不合格」读成「旧密码错了」。
    if (!isPin(newPw.value)) return void (msg.textContent = s.setPwShort);
    go.disabled = true;
    msg.textContent = s.workingLabel;
    const done = await changePasscode(email, oldPw.value, newPw.value);
    go.disabled = false;
    if (!done.ok) {
      msg.textContent = accountFailText(done.reason, lang);
      return;
    }
    // 旧的那些令牌已经在服务端作废了，这一把是刚发给这台设备的。不接住的话，
    // 这台设备下一次去看排行榜就会被告知「请重新登录」——刚改完密码的人被自
    // 己的改动踢下线，是说不通的。
    setEntitlement({ ...entitlement(), token: done.token });
    void offerToSave(email, newPw.value);
    onChanged();
    close();
    onBack(s.pwChanged);
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void submit();
  });
  go.addEventListener('click', () => form.requestSubmit());
  overlay.querySelector<HTMLButtonElement>('#cpwClose')!.addEventListener('click', () => {
    close();
    onBack();
  });
}

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
      ${field('cemCode', s.unlockCodeLabel,
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
 * 注册 / 登录 — the site only. Registering is subscribing: there is no
 * password anywhere in this flow, so an account with no subscription behind
 * it would be an empty thing to have. Logging in is naming the address the
 * subscription was bought with and letting Creem confirm it.
 */
export function openAuthWindow(lang: Lang, tab: AuthTab, onChanged: () => void): void {
  const s = STRINGS[lang];
  const { overlay, close } = openModal(
    'auth-modal',
    `
    <div class="auth-tabs">
      <button class="auth-tab" data-tab="register">${s.tabRegister}</button>
      <button class="auth-tab" data-tab="login">${s.tabLogin}</button>
    </div>
    <div class="auth-body">
      <p class="auth-hint" id="authHint"></p>
      <form id="authForm" autocomplete="on">
        <div id="authFields">
          ${field('authEmail', s.emailLabel,
            `type="email" name="username" autocomplete="username" inputmode="email" placeholder="${s.emailPlaceholder}"`)}
          ${field('authPw', s.passwordAny,
            `type="password" name="password" autocomplete="current-password"`)}
        </div>
        <button type="submit" hidden></button>
      </form>
      <p class="auth-msg" id="authMsg" role="status"></p>
      <button class="link-btn" id="authForgot">${s.forgotPw}</button>
      <button class="link-btn" id="authRedeem">${s.haveCode}</button>
    </div>
    <div class="btn-row">
      <button class="btn-quiet" id="authClose">${s.closeBtn}</button>
      <button class="primary" id="authGo"></button>
    </div>
  `,
  );

  const hint = overlay.querySelector<HTMLElement>('#authHint')!;
  const fields = overlay.querySelector<HTMLElement>('#authFields')!;
  const input = overlay.querySelector<HTMLInputElement>('#authEmail')!;
  const pwInput = overlay.querySelector<HTMLInputElement>('#authPw')!;
  const msg = overlay.querySelector<HTMLElement>('#authMsg')!;
  const go = overlay.querySelector<HTMLButtonElement>('#authGo')!;
  const tabs = Array.from(overlay.querySelectorAll<HTMLButtonElement>('.auth-tab'));
  const forgot = overlay.querySelector<HTMLButtonElement>('#authForgot')!;
  let current: AuthTab = tab;

  /**
   * 《忘记密码？》——常驻，不是等出事了才冒出来。
   *
   * 原先这一行只在登录被答「blocked」（连输错六次，账号锁死）之后才摆出来，
   * 而服务器那头也只给锁死的账号发码。合起来的意思是：一个老老实实「我忘了
   * 密码」的人根本没有入口——除非他自己想到「故意连错六次把自己锁死」，而没
   * 有人会这么想。两头一起改（见 api/unlock.js）。
   *
   * 锁死那一支因此不必再单独摆一行：这一行本来就在他眼前，摆第二个一模一样
   * 的按钮只会让人以为那是两件不同的事。
   */
  forgot.addEventListener('click', () => {
    const address = input.value.trim();
    close();
    openUnlockWindow(lang, address, onChanged);
  });

  const setTab = (next: AuthTab) => {
    current = next;
    for (const el of tabs) el.classList.toggle('active', el.dataset.tab === next);
    msg.textContent = '';
    hint.textContent = next === 'register' ? s.registerIsSubscribe : s.signInHint;
    // Registering asks for nothing: Creem's checkout collects the address
    // itself, and one form is better than two asking for the same thing.
    // 没有密码栏的那一屏上，《忘记密码？》无从谈起，一并收起来。
    fields.hidden = next === 'register';
    forgot.hidden = next === 'register';
    go.textContent = next === 'register' ? s.subscribeBtn : s.signInBtn;
  };

  const submit = async () => {
    if (current === 'register') {
      close();
      openGeniusWindow(lang, onChanged);
      return;
    }
    const email = input.value.trim();
    if (!isEmail(email)) {
      msg.textContent = s.emailInvalid;
      return;
    }
    const password = pwInput.value;
    if (!password) return void (msg.textContent = s.pwWrong);
    go.disabled = true;
    msg.textContent = s.workingLabel;

    // One call for both kinds of subscriber. Which one this address is, the
    // server knows and the browser cannot: a card password of six digits and
    // a redeemed code's six-digit passcode are the same string.
    const outcome = await restore(email, password);
    go.disabled = false;
    if (outcome.ok === true) {
      onChanged();
      // 登上了，可这个账号此刻没有在续的订阅——《订单情况》那一屏抬头写着
      // 「已订阅」，开给他看是说假话。就地说一句，《关闭》让他自己走；他确实
      // 已经登录了，背后那一页（onChanged）已经跟着变了。
      if (!outcome.entitlement.active) {
        msg.textContent = s.signedInNoSub;
        return;
      }
      close();
      openStatusWindow(lang, onChanged);
      return;
    }
    if (outcome.ok === false && outcome.reason === 'needsPasscode') {
      msg.textContent = s.needsPwHint;
      return;
    }
    if (outcome.ok === false && outcome.reason === 'wrong') {
      msg.textContent = s.pwWrong;
      return;
    }
    // Two different locks, two different things to say — and only one of
    // them has anything the player can press.
    //
    //   locked  — four wrong tries; it opens by itself, and the server has
    //             already worked out when. Saying "check your email" here
    //             sent people looking for a message that is never sent.
    //   blocked — six; the address itself has to vouch for them, which is
    //             exactly what openUnlockWindow does——而那扇窗现在有一行常驻
    //             的《忘记密码？》通着，不必等锁死了才现身。
    if (outcome.ok === false && outcome.reason === 'locked') {
      msg.textContent = s.pwLocked.replace(
        '{hours}',
        String(Math.max(1, Math.ceil((outcome.retryInMs ?? 0) / 3600e3))),
      );
      return;
    }
    if (outcome.ok === false && outcome.reason === 'blocked') {
      // 出路那一行（《忘记密码？》）一直就在下面，不用再补一个。
      msg.textContent = s.pwBlocked;
      return;
    }
    msg.textContent =
      outcome.ok === false && outcome.reason === 'none'
        ? s.signInNotFound
        : failureText(outcome.ok === false ? outcome.reason : 'network', lang);
  };

  for (const el of tabs) el.addEventListener('click', () => setTab(el.dataset.tab as AuthTab));
  // Going through the form's own submit is what lets a phone's password
  // manager recognise this as a sign-in and offer to fill or update it.
  const form = overlay.querySelector<HTMLFormElement>('#authForm')!;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void submit();
  });
  go.addEventListener('click', () => (current === 'register' ? submit() : form.requestSubmit()));
  overlay.querySelector<HTMLButtonElement>('#authRedeem')!.addEventListener('click', () => {
    close();
    openRedeemWindow(lang, onChanged);
  });
  overlay.querySelector<HTMLButtonElement>('#authClose')!.addEventListener('click', close);
  setTab(tab);
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

/**
 * Spending a code. One field, and it is the code.
 *
 * It used to ask for an address and a passcode in the same window, which
 * turned a gift into a registration form and buried the one field that
 * mattered between two that did not. A code is a thing that unlocks, so it
 * unlocks the moment it is typed; attaching an address so it survives a new
 * phone is worth doing and is the very next question, asked on its own.
 */
export function openRedeemWindow(lang: Lang, onChanged: () => void): void {
  const s = STRINGS[lang];
  const { overlay, close } = openModal(
    'auth-modal',
    `
    <h2>${s.redeemTitle}</h2>
    ${field('redeemCode', s.redeemCodeLabel,
      `type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="${esc(s.redeemCodePlaceholder)}"`)}
    <p class="auth-msg" id="redeemMsg" role="status"></p>
    <div class="btn-row">
      <button class="btn-quiet" id="redeemClose">${s.closeBtn}</button>
      <button class="primary" id="redeemGo">${s.redeemBtn}</button>
    </div>
  `,
  );

  const code = overlay.querySelector<HTMLInputElement>('#redeemCode')!;
  const msg = overlay.querySelector<HTMLElement>('#redeemMsg')!;
  const go = overlay.querySelector<HTMLButtonElement>('#redeemGo')!;

  const submit = async () => {
    const ticket = code.value.trim();
    if (!ticket) return void (msg.textContent = s.redeemBadCode);
    // Spending a code on top of a subscription that is still running throws
    // most of it away. The check is here rather than on the server because
    // this is where the answer is known, and because the only person a
    // bypass costs is the one who burned their own gift early.
    if (isGenius()) return void (msg.textContent = s.alreadyActive);
    go.disabled = true;
    msg.textContent = s.workingLabel;
    const held = entitlement();
    const result = await redeemCode(ticket, signedInEmail() ?? undefined, held.token);
    go.disabled = false;
    if (!result.ok) {
      msg.textContent = accountFailText(result.reason, lang, result.retryInMs);
      return;
    }
    // Unlocked. What it granted lives under the code until an address is
    // attached, and that is remembered so the question survives a closed
    // window or a reload — otherwise one dismissal would strand a gift in
    // this browser forever.
    setEntitlement(result.entitlement);
    // The server attached it to a signed-in account, so there is nobody left
    // to ask about: `code` comes back only when it is still held by the code.
    if (result.entitlement.token && result.code) {
      rememberPending({
        kind: 'code',
        code: ticket.toUpperCase().replace(/[^0-9A-Z]/g, ''),
        token: result.entitlement.token,
      });
    }
    close();
    onChanged();
    const pending = pendingAccount();
    if (pending) openSetPasswordWindow(lang, pending, '', onChanged);
    else openStatusWindow(lang, onChanged);
  };

  code.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
  go.addEventListener('click', submit);
  overlay.querySelector<HTMLButtonElement>('#redeemClose')!.addEventListener('click', close);
}

/**
 * The way back into an account that has been shut after six wrong
 * passcodes. Six wrong guesses out of ten thousand is not someone breaking
 * in; it is someone who has forgotten which four digits they picked — so
 * this ends by setting a new passcode rather than merely lifting the lock,
 * which would hand them back the same door they were already stuck at.
 */
export function openUnlockWindow(lang: Lang, email: string, onChanged: () => void): void {
  const s = STRINGS[lang];
  const { overlay, close } = openModal(
    'auth-modal',
    `
    <h2>${s.unlockTitle}</h2>
    <p class="auth-hint">${s.unlockIntro}</p>
    ${field('unlockEmail', s.emailLabel,
      `type="email" autocomplete="email" inputmode="email" value="${esc(email)}"`)}
    <div id="unlockStep2" hidden>
      ${field('unlockCode', s.unlockCodeLabel, 'type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code"')}
      ${field('unlockPw', s.unlockNewPw,
        `type="password" minlength="6" maxlength="6" autocomplete="new-password" placeholder="${s.passwordPlaceholder}"`)}
    </div>
    <p class="auth-msg" id="unlockMsg" role="status"></p>
    <div class="btn-row">
      <button class="btn-quiet" id="unlockClose">${s.closeBtn}</button>
      <button class="primary" id="unlockGo">${s.unlockSendBtn}</button>
    </div>
  `,
  );

  const address = overlay.querySelector<HTMLInputElement>('#unlockEmail')!;
  const intro = overlay.querySelector<HTMLElement>('.auth-hint')!;
  const mailRow = address.closest('label') ?? address.parentElement!;
  const step2 = overlay.querySelector<HTMLElement>('#unlockStep2')!;
  const codeBox = overlay.querySelector<HTMLInputElement>('#unlockCode')!;
  const pwBox = overlay.querySelector<HTMLInputElement>('#unlockPw')!;
  const msg = overlay.querySelector<HTMLElement>('#unlockMsg')!;
  const go = overlay.querySelector<HTMLButtonElement>('#unlockGo')!;
  let sent = false;

  const submit = async () => {
    const mail = address.value.trim();
    if (!isEmail(mail)) return void (msg.textContent = s.emailInvalid);
    go.disabled = true;
    msg.textContent = s.workingLabel;

    if (!sent) {
      const asked = await requestUnlock(mail, lang);
      go.disabled = false;
      if (!asked.sent) {
        msg.textContent = accountFailText(asked.reason, lang);
        return;
      }
      sent = true;
      step2.hidden = false;
      address.readOnly = true;
      go.textContent = s.unlockConfirmBtn;
      msg.textContent = s.unlockSent;
      codeBox.focus();
      return;
    }

    const pin = pwBox.value.trim();
    if (!isPin(pin)) {
      go.disabled = false;
      msg.textContent = s.passwordLabel;
      return;
    }
    const result = await confirmUnlock(mail, codeBox.value.trim(), pin);
    go.disabled = false;
    if (result.ok) {
      setEntitlement(result.entitlement);
      onChanged();
      // 密码换好了，可这个账号此刻没有在续的订阅——《订单情况》那一屏的抬头
      // 写着「已订阅」，开给他看就是说了句假话，而且他还会以为自己刚才什么
      // 也没改成。就地说一句「新密码已经设好」，留着《关闭》让他自己走。
      if (!result.entitlement.active) {
        // 说完「新密码已经设好」，这一屏上就不该再留着「我们会寄一组六位数
        // 验证码到你的信箱」——那句话是给还没开始的人看的，码早就寄过、用过
        // 了。同一屏里一句说要寄、一句说已经设好，读起来是自相矛盾的。
        intro.hidden = true;
        mailRow.hidden = true;
        step2.hidden = true;
        go.hidden = true;
        msg.textContent = s.pwReset;
        return;
      }
      close();
      openStatusWindow(lang, onChanged);
      return;
    }
    msg.textContent = accountFailText(result.reason, lang, result.retryInMs);
  };

  for (const box of [address, codeBox, pwBox]) {
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
  }
  go.addEventListener('click', submit);
  overlay.querySelector<HTMLButtonElement>('#unlockClose')!.addEventListener('click', close);
}

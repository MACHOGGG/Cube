import { PRIVILEGES, STRINGS, type Lang } from '../i18n';
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
  confirmUnlock,
  redeemCode,
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
    default:
      return s.purchaseNetwork;
  }
}

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
/**
 * 密码够不够格。和服务器的 PASS_RE、以及设置密码那一页用的是同一条规矩：
 * 6 到 128 位任意字符。
 *
 * 这里原来是 /^\d{4,6}$/——4 到 6 位纯数字。于是走一趟「忘了密码，用邮箱解
 * 锁」，密码就被悄悄降级成一个四位数字，比正门弱得多。一条通往重设密码的路，
 * 不该比正门更宽。
 */
const isPin = (value: string) => value.length === 6;

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
      <button class="icon-btn" id="portalGo">${s.manageSubscription}</button>
      <button class="primary" id="portalClose">${s.closeBtn}</button>
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
      <button class="primary" id="pwGo">${fromCode ? s.bindTitle : s.setPwTitle}</button>
    </div>
  `,
    // Not dismissable. Someone who has just paid and has no password owns a
    // subscription that lives in one browser and can never be moved; every
    // way out of this window that is not "set one" leads there.
    false,
  );

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
  if (pending) openSetPasswordWindow(lang, pending, signedInEmail() ?? '', onChanged);
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
  const nowList = [
    ...GENIUS_LAYOUTS.map((id) => geniusBoardBlurb(id, lang)),
    s.geniusHostRooms,
  ];
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
      ${PRIVILEGES[lang].map((p) => `<div class="genius-perk genius-perk--soon">${p}</div>`).join('')}
    </div>
    <div class="btn-row">
      <!-- 登录 is the accented one. Someone who already subscribed and is
           looking at the paywall got here by accident, and the way out of
           that is signing in, not closing the window. -->
      <button class="secondary" id="geniusClose">${s.closeBtn}</button>
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

/** What a subscriber sees: how long they have, and the way out. */
export function openStatusWindow(lang: Lang, onChanged: () => void): void {
  const s = STRINGS[lang];
  const current = entitlement();
  const { overlay, close } = openModal(
    'genius-modal',
    `
    <h2>${s.subscribedTitle}</h2>
    ${orderBlock(current, lang)}
    ${giftBlock(current.gifts ?? [], lang)}
    <p class="auth-hint">${
      isStoreChannel()
        ? s.manageOnStore.replace('{store}', payeeName())
        : s.subscribeIntro
    }</p>
    <p class="auth-msg" id="statusMsg" role="status"></p>
    <div class="btn-row">
      ${
        isStoreChannel()
          ? ''
          : `<button class="icon-btn" id="statusManage">${s.manageSubscription}</button>
             <button class="icon-btn" id="statusSignOut">${s.signOutBtn}</button>`
      }
      <button class="primary" id="statusClose">${s.closeBtn}</button>
    </div>
  `,
  );

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
  if (!rows.length) return `<p class="auth-hint">${s.orderLapsed}</p>`;
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
  </div>`;
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
      <div id="authUnlock"></div>
      <button class="link-btn" id="authRedeem">${s.haveCode}</button>
    </div>
    <div class="btn-row">
      <button class="icon-btn" id="authGo"></button>
      <button class="primary" id="authClose">${s.closeBtn}</button>
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
  const unlockSlot = overlay.querySelector<HTMLElement>('#authUnlock')!;
  let current: AuthTab = tab;

  /** The way out of a blocked account, offered only once there is one. */
  const showUnlock = (address: string) => {
    unlockSlot.innerHTML = `<button class="link-btn" id="authUnlockGo">${s.unlockNow}</button>`;
    unlockSlot.querySelector<HTMLButtonElement>('#authUnlockGo')!.addEventListener('click', () => {
      close();
      openUnlockWindow(lang, address, onChanged);
    });
  };

  const setTab = (next: AuthTab) => {
    current = next;
    for (const el of tabs) el.classList.toggle('active', el.dataset.tab === next);
    msg.textContent = '';
    unlockSlot.innerHTML = '';
    hint.textContent = next === 'register' ? s.registerIsSubscribe : s.signInHint;
    // Registering asks for nothing: Creem's checkout collects the address
    // itself, and one form is better than two asking for the same thing.
    fields.hidden = next === 'register';
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
      close();
      onChanged();
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
    //             exactly what openUnlockWindow does. That window has been
    //             finished for a while and nothing ever opened it.
    if (outcome.ok === false && outcome.reason === 'locked') {
      msg.textContent = s.pwLocked.replace(
        '{hours}',
        String(Math.max(1, Math.ceil((outcome.retryInMs ?? 0) / 3600e3))),
      );
      return;
    }
    if (outcome.ok === false && outcome.reason === 'blocked') {
      msg.textContent = s.pwBlocked;
      showUnlock(email);
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
    <p class="auth-hint">${s.redeemHint}</p>
    ${field('redeemCode', s.redeemCodeLabel,
      `type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="${esc(s.redeemCodePlaceholder)}"`)}
    <p class="auth-msg" id="redeemMsg" role="status"></p>
    <div class="btn-row">
      <button class="primary" id="redeemGo">${s.redeemBtn}</button>
      <button class="icon-btn" id="redeemClose">${s.closeBtn}</button>
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
      <button class="icon-btn" id="unlockGo">${s.unlockSendBtn}</button>
      <button class="primary" id="unlockClose">${s.closeBtn}</button>
    </div>
  `,
  );

  const address = overlay.querySelector<HTMLInputElement>('#unlockEmail')!;
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
      const asked = await requestUnlock(mail);
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
      close();
      onChanged();
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

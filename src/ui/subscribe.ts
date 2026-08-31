import { PRIVILEGES, STRINGS, type Lang } from '../i18n';
import { isStoreChannel, payeeName } from '../engine/channel';
import { formatPrice, plans, type PlanPeriod } from '../engine/pricing';
import {
  clearEntitlement,
  entitlement,
  isGenius,
  purchase,
  restore,
  setEntitlement,
  signedInEmail,
  type PurchaseFailure,
} from '../engine/subscription';
import {
  accountLogin,
  confirmUnlock,
  redeemCode,
  requestUnlock,
  type AccountFailure,
} from '../engine/account';
import { CONTACT_EMAIL } from '../legal';

/**
 * 「Slides 天才」 as a player meets it: the window that sells it, and the one
 * the site uses to find a subscription again.
 *
 * The two channels are never mixed on screen. In the App Store and Google
 * Play builds this window offers ¥2 and ¥9.9, buys through the store sheet,
 * and has no notion of an account — 恢复购买 is the whole of "log in", since
 * the store already knows who is holding the phone. On the site it offers
 * US$0.99 and US$4.99, hands off to Creem's checkout, and finds a
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
function openModal(className: string, html: string) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay show';
  overlay.innerHTML = `<div class="modal ${className}">${html}</div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
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
    case 'notConfigured':
      return s.notOnSaleYet;
    default:
      return s.purchaseNetwork;
  }
}

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const isPin = (value: string) => /^\d{4,6}$/.test(value);

/** One labelled input, in the shape the auth windows all use. */
function field(id: string, label: string, attrs: string): string {
  return `<label class="auth-field">
      <span>${label}</span>
      <input id="${id}" ${attrs} />
    </label>`;
}

/**
 * The window behind 成为 Slides 天才. Already a subscriber? Then it is the
 * status window instead — there is nothing to sell someone who has bought it.
 */
export function openGeniusWindow(lang: Lang, onChanged: () => void): void {
  if (isGenius()) return openStatusWindow(lang, onChanged);

  const s = STRINGS[lang];
  const store = payeeName();
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
    <p class="auth-hint">${
      isStoreChannel() ? s.storeNoAccountHint.replace('{store}', store) : s.registerHint
    }</p>
    <button class="link-btn" id="geniusRedeem">${s.haveCode}</button>
    <p class="auth-msg" id="geniusMsg" role="status"></p>
    <div class="genius-perks">
      <div class="menu-section-label">${s.geniusSpecialTitle}</div>
      ${PRIVILEGES[lang].map((p) => `<div class="genius-perk">${p}</div>`).join('')}
    </div>
    <div class="btn-row">
      <button class="icon-btn" id="geniusRestore">${
        isStoreChannel() ? s.restoreBtn : s.signInBtn
      }</button>
      <button class="primary" id="geniusClose">${s.closeBtn}</button>
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
  const until = current.until
    ? `<p class="tag-line">${s.subscribedUntil} ${new Date(current.until).toLocaleDateString(
        LOCALES[lang],
      )}</p>`
    : '';
  const email = current.email ? `<p class="auth-hint">${esc(current.email)}</p>` : '';

  const { overlay, close } = openModal(
    'genius-modal',
    `
    <h2>${s.subscribedTitle}</h2>
    ${until}
    ${email}
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
  overlay.querySelector<HTMLButtonElement>('#statusManage')?.addEventListener('click', async () => {
    const msg = overlay.querySelector<HTMLElement>('#statusMsg')!;
    msg.textContent = s.workingLabel;
    const { webPortal } = await import('../engine/creem');
    const opened = await webPortal(signedInEmail() ?? '');
    msg.textContent = opened ? '' : s.purchaseNetwork;
  });
  // Signing out only forgets the address on this device: it cancels nothing,
  // and naming the address again brings the subscription straight back.
  overlay.querySelector<HTMLButtonElement>('#statusSignOut')?.addEventListener('click', () => {
    clearEntitlement();
    close();
    onChanged();
  });
  overlay.querySelector<HTMLButtonElement>('#statusClose')!.addEventListener('click', close);
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
      <div id="authFields">
        ${field('authEmail', s.emailLabel,
          `type="email" autocomplete="email" inputmode="email" placeholder="${s.emailPlaceholder}"`)}
        ${field('authPw', s.passwordOptional,
          `type="password" inputmode="numeric" maxlength="6" autocomplete="current-password" placeholder="${s.passwordPlaceholder}"`)}
      </div>
      <p class="auth-msg" id="authMsg" role="status"></p>
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
  let current: AuthTab = tab;

  const setTab = (next: AuthTab) => {
    current = next;
    for (const el of tabs) el.classList.toggle('active', el.dataset.tab === next);
    msg.textContent = '';
    hint.textContent = next === 'register' ? s.registerHint : s.signInHint;
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
    const pin = pwInput.value.trim();
    go.disabled = true;
    msg.textContent = s.workingLabel;

    // Two kinds of subscriber sign in here, and the passcode is what tells
    // them apart. Someone who paid by card has none — Creem is asked about
    // the address instead. Someone who redeemed a code set one, and it is
    // the only thing that proves the account is theirs.
    if (pin) {
      const result = await accountLogin(email, pin);
      go.disabled = false;
      if (result.ok) {
        setEntitlement(result.entitlement);
        close();
        onChanged();
        openStatusWindow(lang, onChanged);
        return;
      }
      msg.textContent = accountFailText(result.reason, lang, result.retryInMs);
      if (result.reason === 'blocked') {
        close();
        openUnlockWindow(lang, email, onChanged);
      }
      return;
    }

    const outcome = await restore(email);
    go.disabled = false;
    if (outcome.ok === true) {
      close();
      onChanged();
      openStatusWindow(lang, onChanged);
      return;
    }
    msg.textContent =
      outcome.ok === false && outcome.reason === 'none'
        ? s.signInNotFound
        : failureText(outcome.ok === false ? outcome.reason : 'network', lang);
  };

  for (const el of tabs) el.addEventListener('click', () => setTab(el.dataset.tab as AuthTab));
  go.addEventListener('click', submit);
  for (const box of [input, pwInput]) {
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
  }
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
 * Spending a code. Three fields, and the last two are the point: a code is
 * worth a month or a year, and without an address and a passcode to attach
 * it to it would be worth that on one device only, until the day the browser
 * data is cleared.
 *
 * The passcode is four to six digits because it has to be remembered rather
 * than stored, and what makes that safe enough is on the server: every guess
 * costs scrypt time, four wrong ones shut the account for hours, and six
 * shut it until the address itself vouches for whoever is trying.
 */
export function openRedeemWindow(lang: Lang, onChanged: () => void): void {
  const s = STRINGS[lang];
  const { overlay, close } = openModal(
    'auth-modal',
    `
    <h2>${s.redeemTitle}</h2>
    <p class="auth-hint">${s.redeemHint}</p>
    ${field('redeemCode', s.redeemCodeLabel, 'type="text" autocomplete="off" placeholder="XXXX-XXXX"')}
    ${field('redeemEmail', s.emailLabel,
      `type="email" autocomplete="email" inputmode="email" placeholder="${s.emailPlaceholder}"`)}
    ${field('redeemPw', s.passwordLabel,
      `type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" placeholder="${s.passwordPlaceholder}"`)}
    <p class="auth-msg" id="redeemMsg" role="status"></p>
    <div class="btn-row">
      <button class="icon-btn" id="redeemGo">${s.redeemBtn}</button>
      <button class="primary" id="redeemClose">${s.closeBtn}</button>
    </div>
  `,
  );

  const code = overlay.querySelector<HTMLInputElement>('#redeemCode')!;
  const email = overlay.querySelector<HTMLInputElement>('#redeemEmail')!;
  const pw = overlay.querySelector<HTMLInputElement>('#redeemPw')!;
  const msg = overlay.querySelector<HTMLElement>('#redeemMsg')!;
  const go = overlay.querySelector<HTMLButtonElement>('#redeemGo')!;

  const submit = async () => {
    const address = email.value.trim();
    const pin = pw.value.trim();
    if (!code.value.trim()) return void (msg.textContent = s.redeemBadCode);
    if (!isEmail(address)) return void (msg.textContent = s.emailInvalid);
    if (!isPin(pin)) return void (msg.textContent = s.passwordLabel);

    go.disabled = true;
    msg.textContent = s.workingLabel;
    const result = await redeemCode(code.value, address, pin);
    go.disabled = false;
    if (result.ok) {
      setEntitlement(result.entitlement);
      close();
      onChanged();
      openStatusWindow(lang, onChanged);
      return;
    }
    msg.textContent = accountFailText(result.reason, lang, result.retryInMs);
    // A blocked account cannot redeem either — the same door has to be
    // opened first, so go straight there rather than leaving them stuck.
    if (result.reason === 'blocked') {
      close();
      openUnlockWindow(lang, address, onChanged);
    }
  };

  for (const box of [code, email, pw]) {
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
  }
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
        `type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" placeholder="${s.passwordPlaceholder}"`)}
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

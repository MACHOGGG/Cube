import { PRIVILEGES, STRINGS, type Lang } from '../i18n';
import { GENIUS_LAYOUTS } from '../engine/geniusContent';
import { shapeName } from './shapeLabels';
import { isStoreChannel, payeeName } from '../engine/channel';
import { formatPrice, plans, type PlanPeriod } from '../engine/pricing';
import {
  clearEntitlement,
  entitlement,
  isGenius,
  purchase,
  restore,
  setEntitlement,
  setPasscode,
  signedInEmail,
  takePendingCheckout,
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
function credentialForm(email: string, label: string, placeholder: string): string {
  return `<form id="pwForm" class="auth-body" autocomplete="on">
      ${field('pwUser', 'Email',
        `type="email" name="username" autocomplete="username" readonly value="${esc(email)}"`)}
      ${field('pwNew', label,
        `type="password" name="password" autocomplete="new-password" minlength="6" placeholder="${esc(placeholder)}"`)}
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
  checkoutId: string,
  email: string,
  onChanged: () => void,
): void {
  const s = STRINGS[lang];
  const { overlay, close } = openModal(
    'auth-modal',
    `
    <h2>${s.setPwTitle}</h2>
    <p class="auth-hint">${s.setPwHint}</p>
    ${credentialForm(email, s.setPwLabel, s.setPwPlaceholder)}
    <p class="auth-msg" id="pwMsg" role="status"></p>
    <div class="btn-row">
      <button class="icon-btn" id="pwGo">${s.setPwTitle}</button>
      <button class="primary" id="pwLater">${s.setPwLater}</button>
    </div>
  `,
  );

  const form = overlay.querySelector<HTMLFormElement>('#pwForm')!;
  const input = overlay.querySelector<HTMLInputElement>('#pwNew')!;
  const msg = overlay.querySelector<HTMLElement>('#pwMsg')!;
  const go = overlay.querySelector<HTMLButtonElement>('#pwGo')!;

  const submit = async () => {
    const password = input.value;
    if (password.length < 6) return void (msg.textContent = s.setPwShort);
    go.disabled = true;
    msg.textContent = s.workingLabel;
    const done = await setPasscode(checkoutId, password);
    go.disabled = false;
    // Both failures say so and leave the window open. Closing quietly on the
    // server's 503 was worse than useless: the player typed a password, the
    // window vanished, and nothing had been saved — a failure wearing the
    // exact face of success. Whatever they do next, they should know this
    // step did not take.
    if (done !== 'ok') {
      msg.textContent = done === 'unavailable' ? s.serverBusy : s.purchaseNetwork;
      return;
    }
    // Saved on the server; now let the phone keep a copy too.
    await offerToSave(email, password);
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
  overlay.querySelector<HTMLButtonElement>('#pwLater')!.addEventListener('click', close);
  input.focus();
}

/**
 * Called once at boot, after the return from Creem has been settled: if this
 * launch was one, the password window is the first thing the player sees.
 */
export function promptPasswordIfJustPaid(lang: Lang, onChanged: () => void): void {
  const checkoutId = takePendingCheckout();
  if (checkoutId) openSetPasswordWindow(lang, checkoutId, signedInEmail() ?? '', onChanged);
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
    ...GENIUS_LAYOUTS.map((id) => shapeName(lang, id, id)),
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
    <p class="auth-hint">${
      isStoreChannel() ? s.storeNoAccountHint.replace('{store}', store) : s.registerHint
    }</p>
    <button class="link-btn" id="geniusRedeem">${s.haveCode}</button>
    <p class="auth-msg" id="geniusMsg" role="status"></p>
    <div class="genius-perks">
      <div class="menu-section-label">${s.geniusNowTitle}</div>
      ${nowList.map((p) => `<div class="genius-perk">${esc(p)}</div>`).join('')}
      <div class="menu-section-label">${s.geniusSoonTitle}</div>
      ${PRIVILEGES[lang].map((p) => `<div class="genius-perk genius-perk--soon">${p}</div>`).join('')}
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
    if (outcome.ok === false && outcome.reason === 'locked') {
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

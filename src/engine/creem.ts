import type { PlanPeriod } from './pricing';
import type { Entitlement, GiftCode, PurchaseOutcome } from './subscription';

/**
 * The web counter: Creem, in US dollars, one price for the whole world.
 *
 * This file only ever talks to our own two endpoints under /api. The secret
 * half of Creem — CREEM_API_KEY — lives there and never reaches the bundle,
 * which is also why there is no Creem SDK here: the browser's part of a
 * hosted checkout is to be sent to a URL and to come back from it.
 *
 * A web subscription is attached to the email it was bought with, because
 * that is the only identity the site has. There is no password anywhere in
 * this flow: what proves the subscription is Creem's own record of that
 * address, asked for fresh each time, so there is no credential of ours for
 * anyone to lose. Signing in on a new device means naming the address and
 * having Creem confirm it.
 *
 * None of this is reachable from the App Store or Google Play builds —
 * engine/subscription.ts routes those to the store instead. A phone in
 * mainland China cannot open Creem's checkout at all, which is the reason
 * the app is sold through the stores rather than through this page.
 */

/** What api/subscription answers with. */
interface SubscriptionReply {
  active: boolean;
  /** Present on a password sign-in; stands in for it on this device after. */
  token?: string;
  /** 'code' when the entitlement came from a redeemed code rather than a
   *  card — it belongs to the address, not to this channel. */
  kind?: 'code';
  period?: PlanPeriod;
  /** Epoch ms, when Creem gives an end date for the paid period. */
  until?: number;
  email?: string;
  /** Paid up, but no password set yet — see api/subscription.js. */
  needsPasscode?: boolean;
  /** 年付赠码 — the two one-month codes a yearly subscriber may pass on. */
  gifts?: GiftCode[];
}

/**
 * A failed request, with what the server actually said still attached.
 *
 * Throwing a bare status code threw away the two things that decide what the
 * player is told: whether this is the four-hour lock or the permanent one,
 * and how long the four hours have left to run. Both are in the body; only
 * the status was surviving the trip.
 */
class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
    readonly retryInMs?: number,
  ) {
    super(String(status));
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const said = (await res.json().catch(() => ({}))) as { error?: string; retryInMs?: number };
    throw new HttpError(res.status, said.error, said.retryInMs);
  }
  return (await res.json()) as T;
}

/**
 * Hand the tab to Creem's hosted checkout. On success this function does not
 * really return — the page is replaced — so the caller is told 'redirecting'
 * rather than being left waiting for a result that will arrive in a new
 * document, through takeReturnedCheckoutId() and settleCheckout() below.
 */
export async function webCheckout(period: PlanPeriod, email?: string): Promise<PurchaseOutcome> {
  try {
    const { url } = await postJson<{ url?: string }>('/api/checkout', {
      period,
      email,
      // Where Creem sends them afterwards: back to this page, which will
      // find the order in the query string and record it.
      returnUrl: window.location.origin + window.location.pathname,
    });
    if (!url) return { ok: false, reason: 'notConfigured' };
    window.location.assign(url);
    return { ok: 'redirecting' };
  } catch (err) {
    // 每一种失败都要说对是哪一种，这一段从前一律报「连不上网络」——玩家的网
    // 络好好的，坏的是别处，他照着那句话去重连 Wi-Fi 只会白忙。三种：
    //
    //   503  服务器说它没有 Creem 密钥或没配商品 → 确实还没开售
    //   5xx  我们这边或 Creem 那边出错（最常见的是 502：商品 id 和密钥不是同
    //        一个模式，test 的 id 配 live 的密钥，或者反过来）→ 服务器出错
    //   别的 请求发出去了但被拒了 → 也算服务器出错，不是他的网络
    //
    // 真正的「连不上网络」只有一种：fetch 本身就没发出去（抛的不是 HttpError）。
    if (err instanceof HttpError) {
      if (err.status === 503) return { ok: false, reason: 'notConfigured' };
      if (err.status === 429) return { ok: false, reason: 'tooMany' };
      return { ok: false, reason: 'server' };
    }
    return { ok: false, reason: 'network' };
  }
}

/**
 * Ask Creem whether this address has a live subscription. This is both
 * "log in" and "restore" on the web — there is nothing else to check.
 */
export async function webRestore(email: string, password: string): Promise<PurchaseOutcome> {
  const address = email.trim();
  if (!address) return { ok: false, reason: 'none' };
  try {
    const reply = await postJson<SubscriptionReply>('/api/subscription', {
      email: address,
      password,
    });
    // Paid, but the password step never happened. Sending them to finish it
    // is the only honest answer: they own this subscription, and the way to
    // prove it on the next device is the password they have yet to choose.
    if (reply.needsPasscode) return { ok: false, reason: 'needsPasscode' };
    // 密码对了、令牌拿到了，就是登录成功——哪怕这个账号此刻一份在续的订阅都
    // 没有。原先这里是 `if (!reply.active) return 'none'`，于是订阅过期的人被
    // 挡在自己的账号外面，屏幕上写「这个邮箱名下没有有效的订阅」：那句话本身
    // 是真的，可他要的不是订阅，是进他自己的账号——里头有他的云端战绩和寄给
    // 他的内部码。没有令牌才是真的没登上（服务器那头也认这一条）。
    if (!reply.token) return { ok: false, reason: 'none' };
    return { ok: true, entitlement: toEntitlement(reply, address) };
  } catch (err) {
    const { reason, retryInMs } = failureFor(err);
    return { ok: false, reason, retryInMs };
  }
}

/**
 * Sets the password on a subscription just paid for.
 *
 * The proof is the checkout id the browser was sent back with, never
 * anything the player has to read or type — they see the window, choose a
 * password, and that is the whole of it. Resolves to true when it took.
 */
export async function setWebPasscode(
  checkoutId: string,
  password: string,
  news = false,
): Promise<{ email: string; token: string } | 'exists' | 'unavailable' | 'weak' | null> {
  try {
    const reply = await postJson<{ email?: string; token?: string }>('/api/passcode', {
      checkoutId,
      password,
      news,
    });
    return reply.token ? { email: reply.email ?? '', token: reply.token } : null;
  } catch (err) {
    // 503: nowhere to keep an account yet — the player can do nothing about
    // it, so say so plainly rather than blaming their connection.
    // 409: this address already has a password, which is not a failure at all.
    const code = String(err).replace('Error: ', '');
    if (code === '503') return 'unavailable';
    if (code === '409') return 'exists';
    // 400 'weak'：密码不合规矩（服务端 api/_accounts.js 的 PASS_RE，六位字母数字）。
    // **认的是服务端送回来的那个 error 串**，不是光看状态码——400 还有别的来路，
    // 一律说成「密码太短」会把人支到改不动的地方去。
    // 从前这一支和别的失败一起落到 null，再被 attachAccount 压成 'failed'，屏幕上
    // 于是写「网络出错」：玩家刚付完钱、密码打了六位（只是夹了个符号），而界面告诉
    // 他网络有问题。
    if (err instanceof HttpError && err.code === 'weak') return 'weak';
    return null;
  }
}

/**
 * 身份 2026-10 换了一套（E37/E38）：没有密码了。
 *
 * 两条路，各自一个接口：
 *
 *   /api/signin  —— 邮箱 + 六位验证码。注册和登录是同一条路，服务端用 `created` 告诉我们
 *                   这一次是哪一种（那一位决定要不要问「愿不愿意收更新邮件」）。
 *   /api/handle  —— 两串自己取的凭据，给没有邮箱、或者不想留邮箱的人。
 *
 * 下面这五个函数只做一件事：把接口的回包翻译成界面认得的那几个词。**不碰 entitlement**
 * ——写缓存那一步在 subscription.ts 里（那边才是管状态的地方）。
 */

/** 这一屏认得的失败。都是服务端 error 串的原样，没有一个是前端猜的。 */
export type CodeFailure = 'mailDown' | 'tooMany' | 'badEmail' | 'wrongCode' | 'codeStale' | 'unavailable' | 'failed';
export type PairFailure = 'taken' | 'badPair' | 'wrong' | 'locked' | 'tooMany' | 'unavailable' | 'failed';

/** 回包里我们用得到的那几样（服务端还会多带 entitlement 那几位，原样往上传）。 */
export interface AuthReply extends SubscriptionReply {
  /** 邮箱那条路：这个地址上本来没有账号，刚建的。 */
  created?: boolean;
  /** 免邮箱那条路：服务端认人的那把 id（`hdl:` 加 sha256）。 */
  id?: string;
}

/**
 * 要一张验证码。
 *
 * **发不出去也是 200**（`{ sent: false, reason: 'mailDown' }`，服务端 E51）：Resend 的额
 * 度一满或者域名验证掉了，所有人都收不到码——如实回报，界面据此把人引到免邮箱那条路。所
 * 以这儿不是 catch 里认那一条，而是在成功的回包里认。
 */
export async function webRequestCode(email: string, lang: string): Promise<true | CodeFailure> {
  try {
    const reply = await postJson<{ sent?: boolean; reason?: string }>('/api/signin', { email, lang });
    if (reply.sent === true) return true;
    return reply.reason === 'mailDown' ? 'mailDown' : 'failed';
  } catch (err) {
    return codeFailure(err);
  }
}

/** 把验证码交上去。成了就带回完整的 entitlement 回包（含 `created`）。 */
export async function webConfirmCode(
  email: string,
  code: string,
  news: boolean,
): Promise<AuthReply | CodeFailure> {
  try {
    const reply = await postJson<AuthReply>('/api/signin', { action: 'confirm', email, code, news });
    return reply.token ? reply : 'failed';
  } catch (err) {
    return codeFailure(err);
  }
}

function codeFailure(err: unknown): CodeFailure {
  if (!(err instanceof HttpError)) return 'failed';
  if (err.status === 503) return 'unavailable';
  if (err.status === 429) return err.code === 'expired' ? 'codeStale' : 'tooMany';
  // 400 有两种来路：'email'（地址不合格）和 'expired'（码过期 / 压根没发过）。
  // **认服务端送回来的那个串**，不是光看状态码——两件事玩家要做的动作完全不一样。
  if (err.code === 'email') return 'badEmail';
  if (err.code === 'expired') return 'codeStale';
  if (err.code === 'wrongCode') return 'wrongCode';
  return 'failed';
}

/** 免邮箱：注册（第一串必须没人用过）。 */
export const webPairRegister = (first: string, second: string) =>
  pairCall({ action: 'register', first, second });

/** 免邮箱：登录。 */
export const webPairSignIn = (first: string, second: string) => pairCall({ first, second });

/** 免邮箱：忘了第二串，凭第一串重设。**别的设备会全部下线**（服务端 revokeTokens）。 */
export const webPairReset = (first: string, newSecond: string) =>
  pairCall({ action: 'reset', first, newSecond });

async function pairCall(body: Record<string, string>): Promise<AuthReply | PairFailure> {
  try {
    const reply = await postJson<AuthReply>('/api/handle', body);
    return reply.token ? reply : 'failed';
  } catch (err) {
    if (!(err instanceof HttpError)) return 'failed';
    if (err.status === 503) return 'unavailable';
    if (err.status === 429) return 'tooMany';
    if (err.status === 409) return 'taken';
    if (err.status === 423) return 'locked';
    if (err.code === 'badPair') return 'badPair';
    return 'wrong';
  }
}

/**
 * 注册：开一个账号，不带任何凭据。
 *
 * 和上面两支的区别在于**它不证明什么**。setWebPasscode 拿的是一笔付过款的结账、
 * bindCode 拿的是兑码返回的令牌；这一支手上什么都没有，因为这一步要回答的只是
 * 「这个地址还空着吗」，而服务端那头问这一句和写进去是同一步（SET NX）。
 *
 * 2026-10 补的这条路：Creem 的两个订阅商品暂时关掉，网页端改成「注册就解锁全部
 * 功能」。在那之前「注册」等于「订阅」，邮箱是 Creem 的结账页替我们收的，所以
 * 「只有邮箱和密码」这条路从来不存在。
 *
 * **它不回答「是不是天才」**。那一问交给紧接着的那一次登录（/api/subscription）：
 * 名额可能正好在这一瞬间满了，而只有服务端数得清。这儿多答一句就是多一份会走样
 * 的副本。
 */
export async function webRegister(
  email: string,
  password: string,
  news = false,
): Promise<{ email: string; token: string } | 'exists' | 'unavailable' | 'weak' | 'tooMany' | null> {
  try {
    const reply = await postJson<{ email?: string; token?: string }>('/api/passcode', {
      register: true,
      email,
      password,
      news,
    });
    return reply.token ? { email: reply.email ?? email, token: reply.token } : null;
  } catch (err) {
    const status = String(err).replace('Error: ', '');
    // 503：还没有地方存账号（没配 Redis）。玩家什么都做不了，照实说，不要说成
    // 「网络出错」把他支到自己的 WiFi 上去。
    if (status === '503') return 'unavailable';
    // 409：这个地址已经有账号了。这不是失败，是「走另一扇门」——界面据此让他去登录。
    if (status === '409') return 'exists';
    if (status === '429') return 'tooMany';
    // 400 'weak'：密码不合六位字母数字那条规矩。**认服务端送回来的那个 error 串**，
    // 不是光看状态码——400 还有别的来路（'invalid' 是邮箱不合格），一律说成「密码太
    // 短」会把人支到改不动的地方去。同一个坑在 setWebPasscode 上踩过一次。
    if (err instanceof HttpError && err.code === 'weak') return 'weak';
    return null;
  }
}

/**
 * Attaching an address to what a code granted. Same window and same shape of
 * answer as setWebPasscode — only the proof differs, and 'exists' here means
 * the address is already taken rather than the job already done.
 */
export async function bindCode(
  code: string,
  token: string,
  email: string,
  password: string,
  news = false,
): Promise<{ email: string; token: string } | 'exists' | 'unavailable' | 'weak' | null> {
  try {
    const reply = await postJson<{ email?: string; token?: string }>('/api/passcode', {
      code,
      token,
      email,
      password,
      news,
    });
    return reply.token ? { email: reply.email ?? email, token: reply.token } : null;
  } catch (err) {
    const status = String(err).replace('Error: ', '');
    if (status === '503') return 'unavailable';
    if (status === '409') return 'exists';
    // 同 setWebPasscode：400 'weak' 要单独认出来，别和「网络出错」混在一起。
    if (err instanceof HttpError && err.code === 'weak') return 'weak';
    return null;
  }
}

/**
 * 401 and 423 are answers about the password. A 5xx is the server admitting
 * it could not answer at all — which is emphatically not the same thing as
 * the phone being offline, and saying so cost an afternoon once.
 *
 * 423 covers two different situations and they need different words. Four
 * wrong tries shuts the account for four hours and then it opens by itself;
 * six shuts it until the address vouches for whoever is trying. Collapsing
 * both into 'locked' told everyone in the first group to go and check their
 * email for a message that only the second group ever gets — and threw away
 * the hours the server had already worked out.
 */
function failureFor(err: unknown): {
  reason: 'wrong' | 'locked' | 'blocked' | 'server' | 'network' | 'tooMany';
  retryInMs?: number;
} {
  if (err instanceof HttpError) {
    if (err.status === 401) return { reason: 'wrong' };
    // 限速把这条来路挡下了。落到下面那行会被算成 'network'（429 不到 500），
    // 于是屏幕上写「连不上网络」——他的网好好的，去重连 Wi-Fi 只会白忙。
    if (err.status === 429) return { reason: 'tooMany' };
    if (err.status === 423) {
      return err.code === 'blocked'
        ? { reason: 'blocked' }
        : { reason: 'locked', retryInMs: err.retryInMs };
    }
    return { reason: err.status >= 500 && err.status < 600 ? 'server' : 'network' };
  }
  return { reason: 'network' };
}

/**
 * The order a player has just come back from the checkout page with.
 *
 * Creem appends it to the return URL. This reads it out and wipes it from
 * the address bar in the same breath, so that a reload or a shared link is
 * not a second attempt at the same order.
 *
 * Reading it is deliberately all this does. It used to also be the function
 * that confirmed the order, and those two jobs in one had an order of
 * operations that could take away someone's money: the id left the address
 * bar first, the request went second, and nothing wrote the id down until
 * that request came back saying 'paid'. One blip in between — a dropped
 * connection, a tab closed at the wrong second, a 3-D Secure card Creem
 * still reports as processing — and the only proof of purchase this browser
 * would ever hold was gone, on a subscription that had already been charged.
 *
 * The caller now writes the id down before asking anything (refreshEntitlement
 * in subscription.ts), which lets the answer be 'not yet' and the next launch
 * simply ask again.
 */
export function takeReturnedCheckoutId(): string | null {
  const params = new URLSearchParams(window.location.search);
  const checkoutId = params.get('checkout_id') || params.get('checkoutId');
  if (!checkoutId) return null;
  clearReturnParams(params);
  return checkoutId;
}

/**
 * Ask our own endpoint whether that order is paid — asked, not believed,
 * because anyone can type a checkout id into an address bar.
 *
 * Null means 'nothing to grant from this, not now', and it deliberately
 * covers three different things — unpaid, unanswerable, still clearing —
 * because the caller does the same thing with all three: keep the id, ask
 * again next time.
 */
export async function settleCheckout(checkoutId: string): Promise<Entitlement | null> {
  try {
    const reply = await postJson<SubscriptionReply>('/api/subscription', { checkoutId });
    if (!reply.active) return null;
    return toEntitlement(reply, reply.email ?? '');
  } catch {
    return null;
  }
}

/**
 * The silent re-ask at launch, on a device that has already typed the
 * password once. The token stands in for it; Creem is still the one who says
 * whether the subscription is paid up, so a cancelled one lapses here on its
 * own. Null means "no answer" — the caller keeps whatever it had.
 */
export async function webRefresh(email: string, token: string): Promise<Entitlement | null> {
  try {
    const reply = await postJson<SubscriptionReply>('/api/subscription', { email, token });
    if (!reply.active) return null;
    return toEntitlement(reply, reply.email ?? email);
  } catch {
    return null;
  }
}

/**
 * Open Creem's customer portal — cancelling, cards and receipts, all on
 * Creem's own page. Returns false when there is nothing to open, so the
 * caller can say so rather than leaving a button that does nothing.
 */
export async function webPortal(email: string, token: string): Promise<boolean> {
  try {
    // 身份用**登录令牌**，不是密码（E44）。密码 2026-10 取消了，令牌是唯一还存在的证明。
    const { url } = await postJson<{ url?: string }>('/api/portal', { email, token });
    if (!url) return false;
    window.open(url, '_blank', 'noopener');
    return true;
  } catch {
    return false;
  }
}

function toEntitlement(reply: SubscriptionReply, email: string): Entitlement {
  return {
    // 如实照抄，不写死 true：这份东西同时充当「我是谁」和「我是不是天才」，
    // 而登录成功的人完全可以不是天才（见上面 webRestore 那段）。
    active: Boolean(reply.active),
    period: reply.period,
    until: reply.until,
    channel: reply.kind === 'code' ? 'code' : 'web',
    email: reply.email ?? email,
    ...(reply.token ? { token: reply.token } : {}),
    ...(reply.gifts?.length ? { gifts: reply.gifts } : {}),
  };
}

/** Take Creem's parameters back out of the address bar, leaving the rest. */
function clearReturnParams(params: URLSearchParams): void {
  for (const key of ['checkout_id', 'checkoutId', 'order_id', 'customer_id', 'subscription_id', 'signature', 'product_id', 'request_id']) {
    params.delete(key);
  }
  const query = params.toString();
  // 只换地址，不动状态：状态里记着返回键那套的「根 / 哨兵」（见 backNav.ts），抹掉它
  // 返回键就又变成直接退出网站。
  history.replaceState(history.state, '', window.location.pathname + (query ? '?' + query : '') + window.location.hash);
}

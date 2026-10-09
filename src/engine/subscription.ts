import { report } from './analytics';
import { salesChannel, type SalesChannel } from './channel';
import type { PlanPeriod } from './pricing';
// 只借两个失败类型（纯类型 import，不会把 creem.ts 拉进启动包——别处都是 await import）。
import type { CodeFailure, PairFailure } from './creem';

/**
 * Whether this player is a 「Slides 天才」, and the one door through which
 * they can become one.
 *
 * Two channels sell the subscription and they prove it in entirely different
 * ways. The store builds get their answer from Apple or Google, who know who
 * the player is because they are signed into the device — nothing is
 * registered, nothing is typed, and a reinstall is recovered with 恢复购买.
 * The web has no such signed-in identity, so a subscription bought on the
 * site belongs to the email address it was bought with, and coming back to
 * it later means naming that address again.
 *
 * That asymmetry is why 注册 exists on the site and does not exist in the
 * app: an account is not a feature we wanted, it is the web's substitute for
 * the identity a store already has. Neither channel is ever asked to
 * understand the other's proof.
 *
 * What is cached here is only a cache. It lets the game know, offline and
 * instantly, what it last established — it is never the authority. The
 * authority is Creem (asked through api/subscription) or the store receipt,
 * and both are re-checked on the next launch that has a network.
 */

/** One 内部码 a yearly subscriber may pass on. */
export interface GiftCode {
  code: string;
  /** Epoch ms. After this the code is refused, and says why. */
  expiresAt?: number;
  /** Somebody has redeemed it — shown struck through, not hidden. */
  spent?: boolean;
}

export interface Entitlement {
  active: boolean;
  period?: PlanPeriod;
  /** Epoch ms at which the paid period runs out, when the seller says. */
  until?: number;
  /**
   * Which counter it came from — a store purchase is never resolved by
   * Creem, and vice versa. `'code'` is the exception: a redeemed code is
   * granted by us rather than sold by anyone, so it belongs to the address
   * it was redeemed with and travels with the player across every build.
   */
  channel: SalesChannel | 'code';
  /** The address a web subscription is attached to. Unused in the app. */
  email?: string;
  /**
   * 免邮箱凭据账号（E38）的**第一串原文**，只用来在屏幕上显示「你是谁」。
   *
   * 这种账号的 `email` 里放的是 `pairKey(first)` 算出来的那把 id（`hdl:` 加 64 位
   * hex）——那是服务端认人的那一位，`identify`、`cloudScores` 的 auth()、
   * `api/scores.js`、`api/room.js` 全链路照着它走，一行都不用改。
   *
   * 可那一串 hex 不能印给人看。**而服务端也印不出来**：它只存第一串的 sha256，
   * 还原不回去（见 api/_accounts.js 的 pairKey 为什么这么做）。所以原文只能由这台
   * 设备自己留着，就留在这儿。
   *
   * 邮箱账号没有这一位。清了它只影响屏幕上那一行字，不影响登录。
   */
  handle?: string;
  /**
   * 年付赠码 — two one-month codes a yearly subscriber can hand to friends.
   *
   * Minted and remembered by the server, so this is a copy for showing, not
   * the record: signing in on a second device brings back the same two, and
   * one already spent comes back marked as spent rather than disappearing —
   * a code that quietly vanished would read as one we took away.
   */
  gifts?: GiftCode[];
  /**
   * The redeem code this is still held under, when no address is attached
   * yet. It is half of the pair — with `token` — that names the account on
   * the server, because an unbound code account has no address to name it
   * by. Set when a code is spent, and gone the moment one is attached.
   */
  code?: string;
  /**
   * Rotated on every sign-in to a code-granted account, and the only proof
   * of it we hold: the passcode is never kept on the device. It is what the
   * server checks before letting this player open a multiplayer room.
   */
  token?: string;
}

export type PurchaseOutcome =
  | { ok: true; entitlement: Entitlement }
  /** The site hands off to Creem's page; the tab is on its way out. */
  | { ok: 'redirecting' }
  | {
      ok: false;
      reason: PurchaseFailure;
      detail?: string;
      /** 'locked' 才有：这把锁还剩多久自己开。 */
      retryInMs?: number;
    };

export type PurchaseFailure =
  /** The player backed out of the store sheet or the checkout page. */
  | 'cancelled'
  /** No store to talk to — a native build whose billing plugin is absent. */
  | 'unavailable'
  /** Products aren't set up yet: no Creem ids, or the store has no listing. */
  | 'notConfigured'
  | 'network'
  /** 恢复购买 / signing back in found nothing to restore. */
  | 'none'
  /** The password did not match — or the address has no account, which is
   *  answered identically so that this cannot be used to find subscribers. */
  | 'wrong'
  /** Four wrong guesses: shut for a few hours, then it opens by itself. */
  | 'locked'
  /** Six: shut until the address behind it vouches for whoever is trying. */
  | 'blocked'
  /** Subscribed, but no password was ever set on the way back from the
   *  checkout. Not a failure to apologise for — a step still to finish. */
  | 'needsPasscode'
  /** The request reached the server and the server could not answer. Kept
   *  apart from 'network' because telling someone whose connection is fine
   *  to check their connection sends them looking in the wrong place. */
  | 'server'
  /** 这条来路问得太密了（api/subscription.js 的两个限速桶）。同样不是他的网
   *  络坏了——说成「连不上网络」他会去重连 Wi-Fi，那儿什么也修不好。 */
  | 'tooMany';

const KEY = 'slides_genius';

const PENDING_KEY = 'slides_pending_account';

/**
 * An entitlement this device holds that no address can reach yet, and the
 * proof needed to attach one.
 *
 * Two ways to arrive here and they are genuinely different: a card payment
 * knows the address already (Creem collected it) and only needs a password,
 * while a redeemed code knows neither — it was typed by someone who may
 * never have told us anything about themselves. What they share is the part
 * that matters: until an address is attached, what the player has lives in
 * this browser alone.
 */
export type PendingAccount =
  | { kind: 'checkout'; id: string }
  | { kind: 'code'; code: string; token: string };

/**
 * The checkout a return was settled from, kept until a password is actually
 * set from it.
 *
 * It used to live in a variable and be read once, which meant a single
 * failure — the server briefly unable to answer, a closed window, a reload
 * at the wrong moment — took away the only proof this player had, and the
 * subscription they had paid for became one they could never claim on
 * another device. Surviving in localStorage costs nothing and turns that
 * into "we will ask again next time".
 *
 * It is not a secret worth guarding on this device: it names a checkout that
 * this browser has just completed, and the server only ever accepts it for
 * an address with no password yet.
 */
export function rememberPending(pending: PendingAccount): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    // Private mode. The window still opens this launch; only the retry is lost.
  }
}

export function pendingAccount(): PendingAccount | null {
  let saved: PendingAccount | null = null;
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    const parsed = raw ? (JSON.parse(raw) as PendingAccount) : null;
    if (parsed?.kind === 'checkout' && parsed.id) saved = parsed;
    if (parsed?.kind === 'code' && parsed.code && parsed.token) saved = parsed;
  } catch {
    return null;
  }
  if (!saved) return null;

  // What "finished" means is not the same on both sides, and reading it wrong
  // is worse than not reading it at all.
  //
  //   checkout — the address came from Creem and was always known; what was
  //     missing is the password, and setting one is what issues a token.
  //   code — the token exists from the moment the code is spent, because the
  //     entitlement lives under the code and something has to claim it. What
  //     is missing is the address, so an email is what says this is done.
  //
  // Treating a token as the answer for both quietly threw away the claim on
  // every redeemed code the instant it was redeemed.
  const mine = entitlement();
  const done = saved.kind === 'checkout' ? Boolean(mine.token) : Boolean(mine.email);
  if (done) {
    clearPendingAccount();
    return null;
  }
  return saved;
}

export function clearPendingAccount(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // Nothing to do: an unreadable store is also an unwritable one.
  }
}

/**
 * Choosing the password on a subscription just paid for. On success the
 * token that comes back is folded into the entitlement already on this
 * device, so the act of choosing it is also the sign-in.
 */
export async function attachAccount(
  pending: PendingAccount,
  password: string,
  email?: string,
  /** 他们在建账号那一刻勾没勾「愿意收 Slides 的邮件」。这个答案随账号一起
   *  存下来（连同时间），因为「能证明当初确实同意过」本身就是要求之一。 */
  news = false,
): Promise<'ok' | 'exists' | 'unavailable' | 'weak' | 'failed'> {
  const creem = await import('./creem');
  const result =
    pending.kind === 'checkout'
      ? await creem.setWebPasscode(pending.id, password, news)
      : await creem.bindCode(pending.code, pending.token, email ?? '', password, news);
  if (result === 'unavailable') return 'unavailable';
  // 密码不合规矩，和「网络出错」是两回事。从前它和别的失败一起落进下面那句
  // `if (!result) return 'failed'`，屏幕上写的是「网络出错」——玩家刚付完钱、密码
  // 打了六位（只是夹了个符号），而界面告诉他网络有问题。
  if (result === 'weak') return 'weak';
  // 'exists' is the server refusing to overwrite a password this address
  // already has. Nothing is wrong and nothing is left to do here, so the
  // pending checkout goes too — asking again every launch would be a bug.
  if (result === 'exists') {
    // A card checkout whose address already has a password is finished. A
    // code being bound to an address that already has an account is not:
    // that address is simply the wrong one to attach it to, and the code is
    // still worth what it was worth, so the pending entry stays.
    if (pending.kind === 'checkout') clearPendingAccount();
    return 'exists';
  }
  if (!result) return 'failed';
  clearPendingAccount();
  setEntitlement({
    ...entitlement(),
    email: result.email || entitlement().email,
    token: result.token,
    // The holder under the code is deleted as part of binding, so the code
    // no longer names anything. The address does that now.
    code: undefined,
  });
  return 'ok';
}

/**
 * 注册：开一个账号。
 *
 * 和 attachAccount 并列，只是手上没有任何凭据可交（见 creem.ts 的 webRegister）。
 *
 * **它不定权益**。写进来的只有 email 和 token，`active` 原样留着——「是不是天才」
 * 由紧接着那一次 `restore(email, password)` 问出来，那一问打的是
 * /api/subscription，而窗口期的终身授予就挂在那条路上（api/subscription.js）。
 * 在这儿顺手写一个 `active: true` 会多出一份会走样的副本：名额可能正好在这一瞬间
 * 满了，而屏幕上那句话必须是服务端数出来的那个答案。
 */
export async function registerAccount(
  email: string,
  password: string,
  /** 建账号那一刻勾没勾「愿意收 Slides 的邮件」，和另外两条路同一个规矩。 */
  news = false,
): Promise<'ok' | 'exists' | 'unavailable' | 'weak' | 'tooMany' | 'failed'> {
  const creem = await import('./creem');
  const result = await creem.webRegister(email, password, news);
  if (typeof result === 'string') return result;
  if (!result) return 'failed';
  setEntitlement({ ...entitlement(), email: result.email, token: result.token });
  return 'ok';
}

/**
 * 登录之后这份权益记在哪个柜台（10-09 补充方案 7-9）。
 *
 * 服务端只在权益**记在我们自己库里**的时候（内部码、注册送的终身那一份，api/_entitlement.js 的
 * localAnswer）回 `kind: 'code'`；刷卡订阅那一份是去问 Creem 问出来的，不带它。
 *
 * 原先两处登录（signInWithCode、pairAuth）一律写死 `channel: 'code'`。而开机那一下
 * （refreshEntitlement）对「还在有效期的内部码」是不去问的（codeStillLive：码自带到期日，没人替它
 * 续）——于是一个刷卡订阅、后来退了款的人，本机记着「天才、一年后到期」，开机一次都不再问，权限
 * 一直开着到那个日子。服务器那头早就答 active: false 了（门 check-entitlement ⑪ 量的就是「答了
 * 之后本机撤不撤」，可它摆的测试数据是 `channel: 'web'`——真登录路径从来写不出这个值，那一条是
 * 假绿）。
 *
 * **原生 App 必须仍是 `'code'`**：read() 只认 `'code'` 和本机这个柜台（ios / android），记成
 * `'web'` 的话下一次开机 read() 就当他登出了。App 里本来也不卖网页订阅。
 *
 * 目前网页端停售（E11），这一处眼下不影响任何玩家；重开订阅那天它得是对的。
 */
export function signedInChannel(kind: string | undefined): SalesChannel | 'code' {
  if (salesChannel() !== 'web') return 'code';
  return kind === 'code' ? 'code' : 'web';
}

/**
 * 身份 2026-10 换了一套（E37/E38）：没有密码了。两条路的「写进缓存」都走这儿。
 *
 * 和 `registerAccount` / `restore` 并列。它们各自从一个接口拿回一份 entitlement 回包，
 * 这一层只管同一件事：**把那份回包原样写进缓存，不自己加工**。
 *
 * ⚠️ `active` 照抄服务端，不写死 true。登录成功和「是天才」是两件事（CLAUDE.md 那条），
 * 混用过一次，代价是玩家进不去自己的账号。
 */
export async function signInWithCode(
  email: string,
  code: string,
  news: boolean,
  challenge: string,
): Promise<{ ok: true; created: boolean } | { ok: false; reason: CodeFailure }> {
  const creem = await import('./creem');
  const reply = await creem.webConfirmCode(email, code, news, challenge);
  if (typeof reply === 'string') return { ok: false, reason: reply };
  setEntitlement({
    active: Boolean(reply.active),
    period: reply.period,
    until: reply.until,
    // 权益在哪个柜台由服务端说（kind），不写死——见 signedInChannel。
    channel: signedInChannel(reply.kind),
    email: reply.email ?? email,
    ...(reply.token ? { token: reply.token } : {}),
    ...(reply.gifts?.length ? { gifts: reply.gifts } : {}),
  });
  return { ok: true, created: reply.created === true };
}

/**
 * 要一张验证码。不碰缓存——这一步还没有任何身份可写。
 *
 * 成了回的是 `{ challenge }`：那张票要一路带到 `signInWithCode`。见 creem.ts 的
 * `webRequestCode`，以及 api/signin.js 顶上那段「为什么要有票」。
 */
export async function askForCode(
  email: string,
  lang: string,
): Promise<{ challenge: string } | CodeFailure> {
  return (await import('./creem')).webRequestCode(email, lang);
}

/**
 * 免邮箱凭据那条路：注册 / 登录（E38）。重设第二串那一支 10-09 补充方案 7-8 撤了。
 *
 * **`email` 里存的是服务端那把 id（`hdl:` 加 sha256），`handle` 里存第一串原文。**
 * 前者是全链路认人的那一位（identify、cloudScores 的 auth()、scores.js、room.js），后者
 * 只用来在屏幕上显示——而且只有这台设备有，服务端还原不出来。
 */
export async function pairAuth(
  kind: 'register' | 'signin',
  first: string,
  second: string,
): Promise<{ ok: true } | { ok: false; reason: PairFailure; retryInMs?: number }> {
  const creem = await import('./creem');
  const reply =
    kind === 'register' ? await creem.webPairRegister(first, second) : await creem.webPairSignIn(first, second);
  if (typeof reply === 'string') return { ok: false, reason: reply };
  // 锁住了：带着服务端算好的剩余时间（见 creem.ts 的 PairLocked）
  if ('reason' in reply) return { ok: false, reason: reply.reason, retryInMs: reply.retryInMs };
  setEntitlement({
    active: Boolean(reply.active),
    period: reply.period,
    until: reply.until,
    // 同 signInWithCode：由服务端说（免邮箱账号没有邮箱，Creem 不认识它，实际上总是 'code'）。
    channel: signedInChannel(reply.kind),
    email: reply.id ?? reply.email ?? '',
    handle: first,
    ...(reply.token ? { token: reply.token } : {}),
    ...(reply.gifts?.length ? { gifts: reply.gifts } : {}),
  });
  return { ok: true };
}

const NOBODY: Entitlement = { active: false, channel: salesChannel() };

let cached: Entitlement | null = null;
const listeners = new Set<(e: Entitlement) => void>();

function read(): Entitlement {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return NOBODY;
    const saved = JSON.parse(raw) as Entitlement;
    // A subscription bought in one channel proves nothing in the other: the
    // same phone can run the app and the site, and the app must not inherit
    // a web entitlement it has no way to renew or refund. A redeemed code is
    // the exception — nobody sold it, so no channel owns it.
    if (saved.channel !== 'code' && saved.channel !== salesChannel()) return NOBODY;
    return saved;
  } catch {
    // Private mode, a cleared profile, or something else's key on ours.
    return NOBODY;
  }
}

/** What we last established. Cheap, synchronous, and safe to call in render. */
export function entitlement(): Entitlement {
  if (!cached) cached = read();
  return cached;
}

/** The question every locked feature actually asks. */
export function isGenius(): boolean {
  const e = entitlement();
  if (!e.active) return false;
  // An expiry we were given is honoured even with no network to re-check it,
  // so a lapsed subscription doesn't stay unlocked forever offline. One day
  // of slack absorbs the gap between a renewal and the next time we can ask.
  if (e.until && Date.now() > e.until + 24 * 60 * 60 * 1000) return false;
  return true;
}

/** The address a web subscription is attached to, when there is one. */
export function signedInEmail(): string | undefined {
  return entitlement().email;
}

export function setEntitlement(next: Entitlement): void {
  cached = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Nothing to do — the in-memory copy still serves this session.
  }
  for (const fn of listeners) fn(next);
}

/** Signing out of the site, and what a store build has no button for. */
export function clearEntitlement(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Same as above: the in-memory clear below is what matters.
  }
  cached = { active: false, channel: salesChannel() };
  for (const fn of listeners) fn(cached);
}

/** Fires whenever the answer changes, so open screens can re-draw. */
export function onGeniusChange(fn: (e: Entitlement) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Buy it. Which counter this reaches is not a parameter and not a choice the
 * caller gets to make — it is whichever one can charge this build.
 */
export async function purchase(period: PlanPeriod, email?: string): Promise<PurchaseOutcome> {
  const channel = salesChannel();
  report('subscribe_start', { channel, period });
  const outcome =
    channel === 'web'
      ? await (await import('./creem')).webCheckout(period, email)
      : await (await import('./iap')).storePurchase(period);
  if (outcome.ok === true) setEntitlement(outcome.entitlement);
  report('subscribe_result', {
    channel,
    period,
    result: outcome.ok === true ? 'active' : outcome.ok === 'redirecting' ? 'redirecting' : outcome.reason,
  });
  return outcome;
}

/**
 * Get an existing subscription back: 恢复购买 in the app, and on the web
 * naming the address it was bought with. Apple requires the app to offer
 * this, and a player who reinstalls has every right to expect it.
 */
export async function restore(email?: string, password?: string): Promise<PurchaseOutcome> {
  const channel = salesChannel();
  const outcome =
    channel === 'web'
      ? await (await import('./creem')).webRestore(email ?? '', password ?? '')
      : await (await import('./iap')).storeRestore();
  if (outcome.ok === true) setEntitlement(outcome.entitlement);
  report('subscribe_restore', {
    channel,
    result: outcome.ok === true ? 'active' : outcome.ok === 'redirecting' ? 'redirecting' : outcome.reason,
  });
  return outcome;
}

/**
 * 手上这份内部码权益还在有效期内。
 *
 * 「是不是内部码」和「还没过期」要一起问。只问前一半的后果见下面
 * refreshEntitlement 里那两处注释：过期之后就再也不去问卖家了。
 */
function codeStillLive(): boolean {
  return entitlement().channel === 'code' && isGenius();
}

/**
 * Quietly re-ask the seller whether the subscription is still live, and
 * settle a checkout the player has just come back from. Called once at boot;
 * it never blocks a screen and it never reports an error to anyone — with no
 * network the cache stands, which is exactly what it is for.
 */
export async function refreshEntitlement(): Promise<void> {
  try {
    if (salesChannel() === 'web') {
      const creem = await import('./creem');
      // A return from Creem's page carries the order in the URL, and reading
      // it is also what clears it out of the address bar — so from that line
      // on, whatever is in `returned` is the only copy anywhere. Write it
      // down first, ask afterwards. The reverse order is what used to let a
      // dropped request destroy the proof of a payment already taken (see
      // takeReturnedCheckoutId in creem.ts).
      const returned = creem.takeReturnedCheckoutId();
      if (returned) rememberPending({ kind: 'checkout', id: returned });
      // 这一笔可能是刚回来的，也可能是上回没问出结果的：网断了、标签页关早
      // 了，或者那张卡还在走 3-D Secure，Creem 当时只肯说 processing。两种都
      // 从这儿再问一次，而这不是一个会永远问下去的问题——密码一设上，
      // pendingAccount() 自己就把它扔了。
      const outstanding = pendingAccount();
      if (outstanding?.kind === 'checkout') {
        const paid = await creem.settleCheckout(outstanding.id);
        if (paid) {
          setEntitlement(paid);
          return;
        }
        // 刚从结账页回来、却还问不出结果：就停在这儿。底下那半段是「拿旧凭据
        // 去续问」，而刚订阅的人手上多半还没有凭据，问下去只会把「钱刚付过」
        // 冲成「你没登录」。下次打开再问，id 已经记下了。
        if (returned) return;
      }
      // 码还在有效期内：它自带到期日，也没人能替它续，确实没什么可问的。
      //
      // 可**过期之后**要问。这一行从前不管到没到期一律不问，于是「先兑过一
      // 张码、后来又刷卡订阅」的人被卡死在这儿：channel 一直停在 'code'，码
      // 一到期应用就说他没开通，而卡还在按月扣——它再也不去问 Creem，除非他
      // 自己想到退出重登一次。服务器那头是同一个毛病，一起改的（见
      // api/_entitlement.js 的 resolveEntitlement）。
      if (codeStillLive()) return;
      // Re-asking needs a credential now, and the password is deliberately
      // not kept on the device — the token issued at sign-in is. Without one
      // (a subscription that predates passwords) the cache simply stands and
      // lapses on its own at `until`, which is what it is for.
      const email = signedInEmail();
      const token = entitlement().token;
      if (!email || !token) return;
      // 有答案就照答案改，「不是」也算答案（退款、拒付之后 active 为假，本地那份权限要
      // 跟着撤，见 creem.ts 的 webRefresh）；null 才是「没问出来」，本地那份照旧。
      const current = await creem.webRefresh(email, token);
      if (current) setEntitlement(current);
      return;
    }
    // 同上：过期之后要回去问商店，不然刷卡（这里是商店订阅）那一份永远看不见。
    if (codeStillLive()) return;
    const iap = await import('./iap');
    // Loading the store's own price list is part of the same round trip, so
    // the paywall shows Apple's or Google's figure rather than our fallback.
    await iap.loadStorePrices();
    const current = await iap.storeRestore(true);
    if (current.ok === true) setEntitlement(current.entitlement);
  } catch {
    // Offline, or a store that would not answer. The cache stands.
  }
}

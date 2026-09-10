import { salesChannel } from './channel';
import type { Entitlement } from './subscription';

/**
 * The account a redeem code creates — the only account this app has.
 *
 * A card subscriber needs none of this: Creem holds their record and is
 * asked about the address directly, with no password anywhere. But a code we
 * granted is ours to remember, so it needs an address to belong to and a
 * passcode to prove it by, and this is the client half of that.
 *
 * A code-granted entitlement is not tied to a sales channel. It was not
 * sold at either counter, so it works the same in the browser and in both
 * app builds, and it simply runs out on its own date.
 */

export type AccountFailure =
  /** Wrong passcode, or no account on that address — deliberately the same. */
  | 'wrong'
  /** Four wrong tries: shut for a few hours. `retryInMs` says how long. */
  | 'locked'
  /** Six wrong tries: shut until the address itself vouches for you. */
  | 'blocked'
  /** No such code, or it has already been spent. */
  | 'code'
  | 'email'
  | 'password'
  /** The verification code was wrong, or has expired. */
  | 'wrongCode'
  | 'expired'
  /** The code was real but its use-by window has passed. */
  | 'codeExpired'
  /** Too many tries from here for now — the guard against guessing codes. */
  | 'tooMany'
  /** Already subscribed: the code is worth more kept than spent today. */
  | 'active'
  /** Codes and accounts are not switched on for this deployment yet. */
  | 'notConfigured'
  /** Nowhere to send the unlock mail from — the app points at support. */
  | 'noMail'
  | 'network';

export type AccountResult =
  /** `code` comes back from a redemption that is still held by the code —
   *  absent when the server attached it straight onto a signed-in account,
   *  which is exactly how the caller tells those two apart. */
  | { ok: true; entitlement: Entitlement; code?: string }
  | { ok: false; reason: AccountFailure; retryInMs?: number };

interface Reply {
  /** Echoed by /api/redeem: the code just spent, needed to attach an address. */
  code?: string;
  /** 年付赠码, when the account has any. */
  gifts?: { code: string; expiresAt?: number; spent?: boolean }[];
  active?: boolean;
  period?: 'monthly' | 'yearly';
  until?: number;
  email?: string;
  token?: string;
  error?: string;
  retryInMs?: number;
  sent?: boolean;
  /** /api/unlock 的 confirm：这一趟把密码换好了。和 active 是两件事。 */
  reset?: boolean;
  /** 'code' 表示这份权益是内部码给的；刷卡订阅那一支不带它。 */
  kind?: string;
}

async function post(path: string, body: unknown): Promise<{ status: number; reply: Reply }> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, reply: (await res.json().catch(() => ({}))) as Reply };
}

function toResult(status: number, reply: Reply): AccountResult {
  // 「这一趟成没成」和「这个人是不是天才」是两个问题。
  //
  // 兑内部码那一支两者同真——码兑上了就是天才。可邮箱重设密码那一支不是：
  // 密码换好了，而这个账号此刻完全可以没有在续的订阅（服务器如实答
  // active: false，那是正确答案）。原先这里只认 active，于是那种情况被判成
  // 失败，还落进最后那行兜底的 'network'——屏幕上写「连不上网络」。玩家再点
  // 一次，验证码已经用掉了，答的是「验证码已过期」，而他的密码早就换好了。
  if (status === 200 && (reply.active || reply.reset)) {
    return {
      ok: true,
      ...(reply.code ? { code: reply.code } : {}),
      entitlement: {
        active: Boolean(reply.active),
        period: reply.period,
        until: reply.until,
        // 内部码不属于任何柜台（没人卖过它），刷卡订阅属于这个构建所在的
        // 那个柜台。原先一律写死 'code'：刷卡的人走一趟邮箱重设密码，就被
        // 贴上内部码的标签，此后再也不去问 Creem——因为「码自带到期日，没什
        // 么可问的」（见 engine/subscription.ts 的 codeStillLive）。
        channel: reply.kind === 'code' ? 'code' : salesChannel(),
        email: reply.email,
        token: reply.token,
        code: reply.code,
        gifts: reply.gifts,
      },
    };
  }
  const known: AccountFailure[] = [
    'wrong', 'locked', 'blocked', 'code', 'email', 'password',
    'wrongCode', 'expired', 'notConfigured', 'noMail', 'tooMany',
  ];
  // The server calls it 'expired' on its own endpoint; here it has to be
  // told apart from the unlock mail's expiry, which shares the word.
  if (status === 410) return { ok: false, reason: 'codeExpired' };
  const reason = known.find((k) => k === reply.error) ?? 'network';
  return { ok: false, reason, retryInMs: reply.retryInMs };
}

const guard = async (run: () => Promise<AccountResult>): Promise<AccountResult> => {
  try {
    return await run();
  } catch {
    return { ok: false, reason: 'network' };
  }
};

/**
 * Spend a code. One field, and it is the code — a code is a thing that
 * unlocks, and it unlocks the moment it is typed. Attaching an address so it
 * survives a new phone is worth doing and is asked separately, right after.
 *
 * The reply carries the code and the token that claim what it granted, so the
 * caller can remember them until an address is attached.
 */
export function redeemCode(
  code: string,
  email?: string,
  token?: string,
): Promise<AccountResult> {
  return guard(async () => {
    // Signed in on this device: the month goes straight onto that account
    // rather than being held under the code and asked about afterwards.
    const { status, reply } = await post('/api/redeem', { code, email, token });
    return toResult(status, reply);
  });
}

/** Whether the mail went out — never whether the address had an account. */
export type UnlockRequest = { sent: true } | { sent: false; reason: AccountFailure };

/**
 * Ask for the six-digit code that reopens a blocked account. Answers the
 * same whether or not the address has one, so it cannot be used to find out
 * who plays — 'noMail' is the one real failure, and it means this
 * deployment has no way to send it, so the app says to write to support.
 */
export async function requestUnlock(email: string, lang: string): Promise<UnlockRequest> {
  try {
    // 界面上是哪种语言，那封信就用哪种写（服务器那头只认四个名字，别的当英
    // 文，而且英文永远附一份——见 api/unlock.js 的 MAIL）。
    const { status, reply } = await post('/api/unlock', { email, lang });
    if (status === 200 && reply.sent) return { sent: true };
    const failed = toResult(status, reply);
    return { sent: false, reason: failed.ok ? 'network' : failed.reason };
  } catch {
    return { sent: false, reason: 'network' };
  }
}

/** Prove the address, and set a new passcode in the same step. */
export function confirmUnlock(email: string, code: string, password: string): Promise<AccountResult> {
  return guard(async () => {
    const { status, reply } = await post('/api/unlock', {
      action: 'confirm',
      email,
      code,
      password,
    });
    return toResult(status, reply);
  });
}

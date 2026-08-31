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
  /** Codes and accounts are not switched on for this deployment yet. */
  | 'notConfigured'
  /** Nowhere to send the unlock mail from — the app points at support. */
  | 'noMail'
  | 'network';

export type AccountResult =
  | { ok: true; entitlement: Entitlement }
  | { ok: false; reason: AccountFailure; retryInMs?: number };

interface Reply {
  /** Echoed by /api/redeem: the code just spent, needed to attach an address. */
  code?: string;
  active?: boolean;
  period?: 'monthly' | 'yearly';
  until?: number;
  email?: string;
  token?: string;
  error?: string;
  retryInMs?: number;
  sent?: boolean;
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
  if (status === 200 && reply.active) {
    return {
      ok: true,
      entitlement: {
        active: true,
        period: reply.period,
        until: reply.until,
        channel: 'code',
        email: reply.email,
        token: reply.token,
      },
    };
  }
  const known: AccountFailure[] = [
    'wrong', 'locked', 'blocked', 'code', 'email', 'password',
    'wrongCode', 'expired', 'notConfigured', 'noMail',
  ];
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
export function redeemCode(code: string): Promise<AccountResult> {
  return guard(async () => {
    const { status, reply } = await post('/api/redeem', { code });
    return toResult(status, reply);
  });
}

/** Sign back in to a code-granted account on another device. */
export function accountLogin(email: string, password: string): Promise<AccountResult> {
  return guard(async () => {
    const { status, reply } = await post('/api/login', { email, password });
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
export async function requestUnlock(email: string): Promise<UnlockRequest> {
  try {
    const { status, reply } = await post('/api/unlock', { email });
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

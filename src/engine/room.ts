import { entitlement, isGenius } from './subscription';
import { isStoreChannel } from './channel';

/**
 * The client half of a multiplayer room.
 *
 * What this does not do is worth saying first: it never sends or receives a
 * board. The server names a seed, every device deals the identical board
 * from it (engine/rng.ts), and what travels between them is only a room
 * code, a handful of names, and a score each.
 *
 * Nor does it hold a socket open. The countdown is an instant the server
 * names, which each device counts down to on its own, and the scoreboard is
 * polled about once a second — a leaderboard that re-orders a second later
 * reads as live, and nobody watching one can tell the difference.
 *
 * Because every reply carries the server's own clock, a device whose clock
 * is wrong still starts its run at the same moment as everyone else: what is
 * agreed is an instant on the server's clock, and each client works out for
 * itself how far its own is from that.
 */

export interface Avatar {
  shape: 'circle' | 'triangle' | 'square';
  /** 0-359. The player's colour, drawn from it at render time. */
  hue: number;
}

export interface RoomPlayer {
  id: string;
  name: string;
  avatar: Avatar;
  score: number;
  finished: boolean;
  isHost: boolean;
}

export interface RoomState {
  code: string;
  host: string | null;
  /** The board the host chose; null until they do. */
  mode: string | null;
  /** What every device deals the board from. Null before the match starts. */
  seed: string | null;
  /** The agreed instant, on the server's clock. */
  startAt: number | null;
  players: RoomPlayer[];
  serverNow: number;
}

export type RoomError =
  /** Only a 「Slides 天才」 opens rooms; joining one is free. */
  | 'geniusOnly'
  | 'noRoom'
  | 'started'
  | 'full'
  | 'notHost'
  | 'tooFew'
  | 'mode'
  | 'busy'
  /** Rooms are not switched on for this deployment yet. */
  | 'notConfigured'
  | 'network';

export type RoomResult<T> = { ok: true; value: T } | { ok: false; reason: RoomError };

interface Session {
  code: string;
  playerId: string;
  playerToken: string;
}

let session: Session | null = null;
/** serverNow minus our own clock, so we can count down to the right instant. */
let clockOffset = 0;

export const currentRoom = (): Session | null => session;

/** The server's clock, as best we can tell it from here. */
export const serverTime = (): number => Date.now() + clockOffset;

const KNOWN: RoomError[] = [
  'geniusOnly', 'noRoom', 'started', 'full', 'notHost',
  'tooFew', 'mode', 'busy', 'notConfigured',
];

async function post<T>(body: unknown): Promise<RoomResult<T>> {
  try {
    const res = await fetch('/api/room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const reply = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
      error?: string;
      serverNow?: number;
      state?: { serverNow?: number };
    };
    // Every reply is a chance to re-measure the gap between the clocks.
    const stamp = reply.serverNow ?? reply.state?.serverNow;
    if (typeof stamp === 'number') clockOffset = stamp - Date.now();
    if (!res.ok) {
      return { ok: false, reason: KNOWN.find((k) => k === reply.error) ?? 'network' };
    }
    return { ok: true, value: reply as T };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

/**
 * What we can offer the server as proof of a subscription. A card
 * subscription is checked against Creem and a redeemed code against its own
 * token; a store purchase has no server-side proof yet, so it is sent as a
 * claim and the server says as much about how far it trusts it.
 */
function hostProof() {
  const mine = entitlement();
  return {
    email: mine.email,
    accountToken: mine.channel === 'code' ? mine.token : undefined,
    storeClaim: isStoreChannel() && isGenius(),
  };
}

export async function createRoom(name: string, avatar: Avatar): Promise<RoomResult<RoomState>> {
  const made = await post<{ code: string; playerId: string; playerToken: string; state: RoomState }>({
    action: 'create',
    name,
    avatar,
    ...hostProof(),
  });
  if (!made.ok) return made;
  session = {
    code: made.value.code,
    playerId: made.value.playerId,
    playerToken: made.value.playerToken,
  };
  return { ok: true, value: made.value.state };
}

export async function joinRoom(
  code: string,
  name: string,
  avatar: Avatar,
): Promise<RoomResult<RoomState>> {
  const joined = await post<{ playerId: string; playerToken: string; state: RoomState }>({
    action: 'join',
    code: code.trim(),
    name,
    avatar,
  });
  if (!joined.ok) return joined;
  session = { code: code.trim(), playerId: joined.value.playerId, playerToken: joined.value.playerToken };
  return { ok: true, value: joined.value.state };
}

export function fetchState(): Promise<RoomResult<RoomState>> {
  if (!session) return Promise.resolve({ ok: false, reason: 'noRoom' });
  return post<RoomState>({ action: 'state', code: session.code });
}

/** Host only: pick the board, and put everyone on the same countdown. */
export function startMatch(mode: string): Promise<RoomResult<RoomState>> {
  if (!session) return Promise.resolve({ ok: false, reason: 'noRoom' });
  return post<RoomState>({ action: 'start', mode, ...session });
}

export function reportScore(score: number, finished: boolean): Promise<RoomResult<RoomState>> {
  if (!session) return Promise.resolve({ ok: false, reason: 'noRoom' });
  return post<RoomState>({ action: 'score', score, finished, ...session });
}

export async function leaveRoom(): Promise<void> {
  if (!session) return;
  const leaving = session;
  session = null;
  await post({ action: 'leave', ...leaving });
}

/** Forget the room without telling the server — for a run that has ended. */
export const forgetRoom = (): void => void (session = null);

/**
 * Poll the room. Returns the stop function; every caller must keep it and
 * call it, since a timer left running would keep asking about a room nobody
 * is looking at any more.
 */
export function watchRoom(
  onState: (state: RoomState) => void,
  onError: (reason: RoomError) => void,
  everyMs = 1000,
): () => void {
  let stopped = false;
  let timer = 0;
  const tick = async () => {
    if (stopped) return;
    const now = await fetchState();
    if (stopped) return;
    if (now.ok) onState(now.value);
    else onError(now.reason);
    timer = window.setTimeout(tick, everyMs);
  };
  void tick();
  return () => {
    stopped = true;
    window.clearTimeout(timer);
  };
}

const SHAPES: Avatar['shape'][] = ['circle', 'triangle', 'square'];

/** A ball, a triangle or a square, in a colour of its own. */
export function randomAvatar(): Avatar {
  return {
    shape: SHAPES[Math.floor(Math.random() * SHAPES.length)],
    hue: Math.floor(Math.random() * 360),
  };
}

export const avatarColor = (avatar: Avatar): string => `hsl(${avatar.hue} 58% 52%)`;

/** The player's mark, at whatever size the row it sits in wants. */
export function avatarSvg(avatar: Avatar): string {
  const fill = avatarColor(avatar);
  const body =
    avatar.shape === 'circle'
      ? `<circle cx="16" cy="16" r="12" fill="${fill}"/>`
      : avatar.shape === 'square'
        ? `<rect x="4" y="4" width="24" height="24" rx="6" fill="${fill}"/>`
        : `<polygon points="16,3 29,27 3,27" fill="${fill}"/>`;
  return `<svg viewBox="0 0 32 32" class="avatar" aria-hidden="true">${body}</svg>`;
}

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
  /** This round only. Zeroed when the host puts up the next board. */
  score: number;
  finished: boolean;
  isHost: boolean;
  /** 服务器有一阵子没听见这台设备了。房主 away 就是「房主在修电缆」。 */
  away: boolean;
  /** Every round banked so far — what the closing card ranks people by. */
  total: number;
  /** The best single round, and the quickest one, over the whole room. */
  best: number;
  bestTime: number | null;
  /** How long this round took them, once they are done with it. */
  seconds: number | null;
  rounds: number;
  /** 中途走了。人留在名单和排名里，只是不再报到，也不占座位。 */
  left: boolean;
  /** 正在看这个玩法的教学。全屋等他学完，再一起数 4-3-2-1。 */
  learning: boolean;
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
  /** Rounds played. 0 before the host has put up anything. */
  round: number;
  /** Everyone is done: the host picks the next board, or closes the room. */
  roundOver: boolean;
  /** The host has closed it. What is left is the closing card. */
  ended: boolean;
  /** Seats open today. The room machinery carries more; this is what is on. */
  seats: number;
  players: RoomPlayer[];
  /** 这间小屋被催了多少下。房主那边看它变大就往标题里掉图形。 */
  nudges: number;
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
  /** The host has closed the room; nothing more happens in it. */
  | 'ended'
  | 'busy'
  /** Rooms are not switched on for this deployment yet. */
  | 'notConfigured'
  | 'network';

export type RoomResult<T> =
  | { ok: true; value: T }
  /** `seats` comes back with 'full': how many the room really holds. */
  | { ok: false; reason: RoomError; seats?: number };

interface Session {
  code: string;
  playerId: string;
  playerToken: string;
}

/**
 * 座位记在 sessionStorage 里，不只是一个变量。
 *
 * playerId 和 playerToken 是这台设备在房间里的身份，服务器只认这两样。
 * 它们本来只活在一个 JS 变量里——手机切到后台被系统回收、顺手刷新一下、
 * 甚至只是一次请求超时，身份就没了，人也就回不去了。
 *
 * 用 sessionStorage 而不是 localStorage：一个房间属于这一次游玩，标签页
 * 关了它就该结束，不该在两周后打开网站时还试图挤回一间早就散了的房间。
 */
const SEAT_KEY = 'slides_mp_seat';

function loadSeat(): Session | null {
  try {
    const raw = sessionStorage.getItem(SEAT_KEY);
    const seat = raw ? (JSON.parse(raw) as Session) : null;
    return seat?.code && seat.playerId && seat.playerToken ? seat : null;
  } catch {
    return null;
  }
}

function rememberSeat(seat: Session | null): void {
  try {
    if (seat) sessionStorage.setItem(SEAT_KEY, JSON.stringify(seat));
    else sessionStorage.removeItem(SEAT_KEY);
  } catch {
    // 私密模式：这一次还能玩，只是刷新之后回不去了。
  }
}

/**
 * 这台设备已经打完的回合号，按房号记。
 *
 * 和座位一样，它必须活过「页面被重建」这件事。多人页面每次回来都是新的一份
 * 闭包，如果这个数字只存在那份闭包里，回到房间的一瞬间它就归零——服务器说
 * 「第 1 局，开始时间是刚才」，页面拿 1 去比 0，于是把刚刚打完的那一局当成
 * 新的一局重新开起来，人被扔回一块已经结束的棋盘，出不去。这就是「一局结束
 * 后回主页卡住」的真正原因。
 *
 * 按房号存，所以换一个房间是干净的开始，不会被上一间的进度挡住。
 */
const PLAYED_KEY = 'slides_mp_played';

/** 这一间房里，本机已经打完的最大回合号；不是这一间就当没打过。 */
export function lastPlayedRound(code = session?.code): number {
  if (!code) return 0;
  try {
    const raw = sessionStorage.getItem(PLAYED_KEY);
    const saved = raw ? (JSON.parse(raw) as { code?: string; round?: number }) : null;
    return saved?.code === code && Number.isFinite(saved.round) ? Number(saved.round) : 0;
  } catch {
    return 0;
  }
}

/** 记下「这一局我打过了」。只进不退，晚到的旧消息不会把它推回去。 */
export function markRoundPlayed(round: number, code = session?.code): void {
  if (!code || !Number.isFinite(round) || round <= 0) return;
  if (round <= lastPlayedRound(code)) return;
  try {
    sessionStorage.setItem(PLAYED_KEY, JSON.stringify({ code, round }));
  } catch {
    // 私密模式：这一次还能玩，只是这一台设备回房间时可能重开已打完的一局。
  }
}

const forgetPlayed = (): void => {
  try {
    sessionStorage.removeItem(PLAYED_KEY);
  } catch {
    /* 同上 */
  }
};

let session: Session | null = loadSeat();
/** serverNow minus our own clock, so we can count down to the right instant. */
let clockOffset = 0;
/**
 * The room as of the last reply that described one.
 *
 * The standings on the share card are the standings at the moment the run
 * ended, and by then the page that was polling for them is gone. Keeping the
 * last one here means the card can be drawn from the same numbers the player
 * was watching, without the poll having to be threaded through the game.
 */
let lastState: RoomState | null = null;

export const currentRoom = (): Session | null => session;

/** The room as last seen, or null outside one. */
export const latestRoomState = (): RoomState | null => lastState;

/** Whether this device is the one that opened the room. */
export function iAmHost(state: RoomState | null = lastState): boolean {
  const seat = session;
  return Boolean(seat && state?.host && state.host === seat.playerId);
}

/** The server's clock, as best we can tell it from here. */
export const serverTime = (): number => Date.now() + clockOffset;

const KNOWN: RoomError[] = [
  'geniusOnly', 'noRoom', 'started', 'full', 'notHost',
  'tooFew', 'mode', 'ended', 'busy', 'notConfigured',
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
      seats?: number;
      serverNow?: number;
      state?: { serverNow?: number };
    };
    // Every reply is a chance to re-measure the gap between the clocks.
    const stamp = reply.serverNow ?? reply.state?.serverNow;
    if (typeof stamp === 'number') clockOffset = stamp - Date.now();
    // …and to remember the room, whether it came back on its own or wrapped
    // in the reply to create/join.
    const described = (reply.state ?? reply) as unknown as RoomState;
    if (res.ok && Array.isArray(described?.players)) lastState = described;
    if (!res.ok) {
      return {
        ok: false,
        reason: KNOWN.find((k) => k === reply.error) ?? 'network',
        // A refusal can carry facts too — "full" says how many seats there
        // actually are, which is the number the message needs.
        ...(typeof reply.seats === 'number' ? { seats: reply.seats } : {}),
      };
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
    // Redeemed but not yet attached to an address: the code is the only name
    // this entitlement has, so it has to travel with the token that claims it.
    holderCode: mine.channel === 'code' ? mine.code : undefined,
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
  rememberSeat(session);
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
  rememberSeat(session);
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

export function reportScore(
  score: number,
  finished: boolean,
  seconds?: number,
): Promise<RoomResult<RoomState>> {
  if (!session) return Promise.resolve({ ok: false, reason: 'noRoom' });
  return post<RoomState>({ action: 'score', score, finished, seconds, ...session });
}

/** Host only: 结束房间. Everyone still polling sees the closing card. */
export function endRoom(): Promise<RoomResult<RoomState>> {
  if (!session) return Promise.resolve({ ok: false, reason: 'noRoom' });
  return post<RoomState>({ action: 'end', ...session });
}

export async function leaveRoom(): Promise<void> {
  if (!session) return;
  const leaving = session;
  session = null;
  lastState = null;
  rememberSeat(null);
  forgetPlayed();
  await post({ action: 'leave', ...leaving });
}

/**
 * 「我去看教学了」／「我看完了」。
 *
 * 看完的那一下是有后果的：服务器发现全屋都不学了，会把开赛时刻重新盖一遍，
 * 于是所有人一起从 4 数起。所以这个调用要等它回来再往下走。
 */
export async function setLearning(learning: boolean): Promise<void> {
  if (!session) return;
  await post({ action: 'learn', learning, ...session });
}

/**
 * 催一下房主。
 *
 * 服务器只记一个数，不记谁按的：要的是「有人在催了」这件事，按几下就掉几个
 * 图形。失败了一声不吭——催不到是件小事，为它弹个错误反而更吵。
 */
export async function nudgeHost(): Promise<void> {
  if (!session) return;
  await post({ action: 'nudge', ...session });
}

/** Forget the room without telling the server — for a run that has ended. */
export const forgetRoom = (): void => {
  session = null;
  lastState = null;
  rememberSeat(null);
  forgetPlayed();
};

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

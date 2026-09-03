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
  /** 服务器有一阵子没听见这台设备了。屋主 away 就是「屋主在修电缆」。 */
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
  /**
   * 他的网页被关掉了（不是网差，是真的关了——见 api/room.js 的 closed）。
   *
   * 老一点的服务器不会带这个字段，所以它是可选的：读不到就当没关。
   */
  closed?: boolean;
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
  /** 这间小屋被催了多少下。屋主那边看它变大就往标题里掉图形。 */
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
 * 座位记在硬盘上，不只是一个变量。
 *
 * playerId 和 playerToken 是这台设备在小屋里的身份，服务器只认这两样。
 * 它们本来只活在一个 JS 变量里——手机切到后台被系统回收、顺手刷新一下、
 * 甚至只是一次请求超时，身份就没了，人也就回不去了。
 *
 * 从前存在 sessionStorage 里，理由是「一间小屋属于这一次游玩，标签页关了就
 * 该结束」。装成 App 之后这个理由站不住了：把 App 划掉再打开是很平常的一件
 * 事，而 sessionStorage 一关就空。屋主回来时身份没了，看到的是「输小屋号码」
 * 那一页，他输自己的号码进去——服务器给他一个全新的 playerId，可小屋记着的
 * 屋主还是旧的那个。于是他在自己的小屋里成了客人：没有《为大家选择游戏》，
 * 只有《催屋主》，而那个唯一能开局的人已经不存在了。整间屋子就这么卡死。
 *
 * 所以改存 localStorage，但带一个时间戳。两个小时——服务器那边小屋的 TTL
 * 就是两个小时（api/room.js 的 ROOM_TTL_S）。过了这个点，座位指着的小屋本来
 * 也没了，再留着只会让人往一间早就散掉的屋子里挤。
 */
const SEAT_KEY = 'slides_mp_seat';
/**
 * 座位能活多久。
 *
 * 比服务器那边的 ROOM_TTL_S（二十分钟）长得多，而且是故意的：小屋的二十分钟
 * 是「屋里所有人都不再点它」之后才开始算的，别人还在打，屋子就一直活着。要
 * 是这边也只留二十分钟，一个人切出去半小时再回来，屋子明明还在，他的身份却
 * 已经被自己删了。所以这一头留得宽，让服务器去判——屋子真没了，下一次问就
 * 是 noRoom，那时候再忘掉也不迟。
 */
const SEAT_TTL_MS = 2 * 3600_000;
/** 隔多久把时间戳往前挪一次。人还在屋里，座位就不该到期。 */
const SEAT_TOUCH_MS = 5 * 60_000;

interface StoredSeat extends Session {
  /** 上一次确认「人还在这间屋里」的时刻。 */
  at?: number;
}

function loadSeat(): Session | null {
  try {
    // 老版本存在 sessionStorage 里。发版的那一刻正坐在屋里的人不该被踢出去，
    // 所以两个地方都读，localStorage 优先。
    const raw = localStorage.getItem(SEAT_KEY) ?? sessionStorage.getItem(SEAT_KEY);
    const seat = raw ? (JSON.parse(raw) as StoredSeat) : null;
    if (!seat?.code || !seat.playerId || !seat.playerToken) return null;
    // 没有时间戳的是老版本留下的，当作刚存的——它本来就活不过这一次会话。
    if (seat.at && Date.now() - seat.at > SEAT_TTL_MS) return null;
    return { code: seat.code, playerId: seat.playerId, playerToken: seat.playerToken };
  } catch {
    return null;
  }
}

function rememberSeat(seat: Session | null): void {
  try {
    if (seat) localStorage.setItem(SEAT_KEY, JSON.stringify({ ...seat, at: Date.now() }));
    else localStorage.removeItem(SEAT_KEY);
    // 老键不再用了，顺手清掉，免得两边不一致。
    sessionStorage.removeItem(SEAT_KEY);
  } catch {
    // 私密模式：这一次还能玩，只是关掉 App 之后回不去了。
  }
}

/**
 * 「我还在这间屋里」——把座位的时间戳往前挪。
 *
 * 每次轮询都写一遍硬盘太吵，所以隔五分钟才写一次：一场多人的晚上可以打好几
 * 个小时，而座位只认两小时，不往前挪的话打到一半身份就过期了。
 */
function touchSeat(): void {
  try {
    const raw = localStorage.getItem(SEAT_KEY);
    const seat = raw ? (JSON.parse(raw) as StoredSeat) : null;
    if (!seat?.code) return;
    if (seat.at && Date.now() - seat.at < SEAT_TOUCH_MS) return;
    localStorage.setItem(SEAT_KEY, JSON.stringify({ ...seat, at: Date.now() }));
  } catch {
    /* 同上 */
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

/**
 * 和座位一起搬到 localStorage。
 *
 * 座位现在能活过「把 App 划掉再打开」，这个数字就必须一起活过去——不然人回
 * 到小屋，身份还在（服务器说这是第 3 局），这台设备却以为自己一局都没打过，
 * 于是把刚打完的那一局又重开一遍。两个数字要么一起记住，要么一起忘掉。
 */
export function lastPlayedRound(code = session?.code): number {
  if (!code) return 0;
  try {
    const raw = localStorage.getItem(PLAYED_KEY) ?? sessionStorage.getItem(PLAYED_KEY);
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
    localStorage.setItem(PLAYED_KEY, JSON.stringify({ code, round }));
    sessionStorage.removeItem(PLAYED_KEY);
  } catch {
    // 私密模式：这一次还能玩，只是这一台设备回小屋时可能重开已打完的一局。
  }
}

const forgetPlayed = (): void => {
  try {
    localStorage.removeItem(PLAYED_KEY);
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
 *
 * 令牌任何一种身份都要带上，不只是内部码那一种。邮箱本身不是证据——它印在
 * 收据上，谁都知道得到；服务器现在（也应该）要求先拿令牌证明「这个邮箱是我
 * 自己的」，才肯拿它去问 Creem。原来这里只在内部码那一支带令牌，于是刷卡订
 * 阅那一支等于只报了个邮箱，服务器也就只能靠邮箱放行——那正是「报别人的邮
 * 箱就能开走一间小屋」的另一半。见 api/_entitlement.js。
 */
function hostProof() {
  const mine = entitlement();
  return {
    email: mine.email,
    accountToken: mine.token,
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

/**
 * 「这台设备上有人动过」。
 *
 * 服务器那边小屋只留二十分钟，从最后一次有人碰它算起（api/room.js 的
 * ROOM_TTL_S）。「碰」不限于走棋：屋里任何一个人在自己的网页上点一下都算，
 * 所以这里听的是整页的 pointerdown 和键盘，而不是棋盘上的某个动作。
 *
 * 只记一个布尔值，下一次轮询顺手带出去然后清零。不为它单发请求，也不让轮询
 * 本身冒充点击——轮询每秒都在，那等于永不过期，一分钱也省不下来。
 */
let touched = false;
if (typeof window !== 'undefined') {
  const note = () => { touched = true; };
  // capture：有些地方会把事件拦下来（棋盘拖动就 preventDefault），冒泡阶段
  // 等不到，抓在最外面这一层才是「这个人确实动了」。
  window.addEventListener('pointerdown', note, { capture: true, passive: true });
  window.addEventListener('keydown', note, { capture: true, passive: true });
}

export function fetchState(): Promise<RoomResult<RoomState>> {
  if (!session) return Promise.resolve({ ok: false, reason: 'noRoom' });
  // 带上自己的身份，不只是房号。
  //
  // 服务器靠 playerId/playerToken 认出是谁在问，然后顺手把「他还在」记一笔
  // （api/room.js 的 state）。只发房号的话，这台设备每秒都在说话，服务器却
  // 一句也没听出是谁——于是坐在小屋里不动的人过一会儿全成了「不在」，屋里
  // 挂出一句《屋主正在修电缆》。
  // 人还在屋里，座位就不该到期（见 touchSeat）。
  touchSeat();
  const moved = touched;
  touched = false;
  return post<RoomState>({ action: 'state', touched: moved, ...session });
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
 * 催一下屋主。
 *
 * 服务器只记一个数，不记谁按的：要的是「有人在催了」这件事，按几下就掉几个
 * 图形。失败了一声不吭——催不到是件小事，为它弹个错误反而更吵。
 */
export async function nudgeHost(): Promise<void> {
  if (!session) return;
  await post({ action: 'nudge', ...session });
}

/**
 * 网页被关掉的那一下，替这台设备说一声。
 *
 * 用 sendBeacon 而不是 fetch：页面正在被卸载，普通请求会被浏览器一并取消，
 * beacon 是唯一能保证发出去的那种。它不等回包，也不该等。
 *
 * pagehide 里带 persisted 的那一次不算：那是 iOS 把页面收进 bfcache（切到
 * 别的应用、锁屏），人一回来页面原样醒过来。把那当成「走了」，就等于每次
 * 切个应用都告诉全屋「他不在了」——那正是要修的毛病，不是要加的功能。
 */
function wireLeaveBeacon(): void {
  const bye = (e: PageTransitionEvent) => {
    if (e.persisted || !session) return;
    try {
      const body = JSON.stringify({ action: 'bye', ...session });
      navigator.sendBeacon?.('/api/room', new Blob([body], { type: 'application/json' }));
    } catch {
      // 发不出去也就算了：超时那条路还在，只是慢一点。
    }
  };
  window.addEventListener('pagehide', bye);
}
if (typeof window !== 'undefined') wireLeaveBeacon();

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

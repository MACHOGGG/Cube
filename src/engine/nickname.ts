import { entitlement, signedInEmail } from './subscription';
import { isStoreChannel } from './channel';
import { auth, invalidateBoards } from './cloudScores';
import { currentRoom, renameSeat } from './room';
import { STRINGS, type Lang } from '../i18n';

/**
 * 昵称（第 16 推）：一个帐号一个，全站唯一，**服务器是唯一来源**。
 *
 * ── 从前 ──────────────────────────────────────────────────────────────
 *
 * 名字住在本机 `slides_mp_name` 里，每打完一局随 push 报上去，服务器谁报的算谁的。所以在
 * 这台手机上改了名，换台平板打一局又变回去；全站可以有任意多个「阿花」；小屋发的字母「B」
 * 和重名加的「 2」也曾被当成名字记下来上了榜。
 *
 * ── 现在 ──────────────────────────────────────────────────────────────
 *
 *   · 改名只有一条路：`setNickname()` → `POST /api/scores {action:'name'}`（api/scores.js 的
 *     rename）。服务器验过、登记进唯一索引，才算改成了；成功之后才写本机缓存。
 *   · 本机 `slides_mp_name` 只是缓存。`getNickname()` 读它，榜上写的、小屋名字栏里预填的都
 *     是它。登录之后、每次取回云上存档（fetchMine）之后，用服务器那一份盖掉它
 *     （`adoptServerNickname()`）。
 *   · 本机有、服务器没有（第 16 推之前取过名字的老玩家，或者刚换的帐号）：自动上传一次；
 *     传不上去（被人占了、过不了词表），头卡上写「设置昵称」，让他自己再取一个。
 *
 * 没登录的人照旧能在小屋里敲名字——那一份只留在本机（ui/multiplayer.ts 的 remember），
 * 不上服务器，也不是谁的昵称。
 *
 * ── ⚠️ 这儿从前拿登录凭据当名字，那是一次泄露（#2，2026-10-02 修）──────
 *
 * 这一段原来在 engine/cloudScores.ts 的 `leaderboardName()` 顶上，跟着函数搬了过来。
 *
 * 没取名字的人，榜上印的曾经是**他的凭据**：免邮箱帐号印第一串的前 12 位（第一串**就是那
 * 把钥匙**——api/handle.js 顶上写着，知道它的人凭 `reset` 就能接管帐号），邮箱帐号印
 * `邮箱.split('@')[0]` 的前 12 位。两样都是在玩家没做任何选择的情况下被摆到公开页面上的。
 *
 * 所以 `getNickname()` / `leaderboardName()` **只回他自己取的名字**，别的一个字都不猜。门
 * （check-board-no-id 的 ⑷）钉着：这两个函数的函数体里不许出现 `handle` 和 `signedInEmail`。
 * 反过来，他**自己**把凭据敲成名字也拦下来（isOwnCredential），服务器那头也拦一遍。
 */
export const PLAYER_NAME_KEY = 'slides_mp_name';

/** 最多几个码点。和 api/_nickname.js 的 NICK_MAX 是同一个数。 */
export const NICK_MAX = 12;

/** 改名失败的原因：前四种是服务器那四句（见 api/scores.js 的 rename），后三种是这一头的。 */
export type NicknameError =
  | 'taken'
  | 'blocked'
  | 'bad'
  | 'required'
  | 'tooMany'
  | 'signedOut'
  | 'network';

export type NicknameResult = { ok: true; name: string } | { ok: false; reason: NicknameError };

/** 本机缓存的昵称。没取过就是空串。 */
export function getNickname(): string {
  try {
    const raw = (localStorage.getItem(PLAYER_NAME_KEY) || '').trim();
    // 缓存是这一头写的，本来不会超过 12 个码点；手改过的存储就截一下，免得一行榜被撑坏。
    // 按码点截，不按 UTF-16 截：后者会把一个 emoji 劈成半个。
    return Array.from(raw).slice(0, NICK_MAX).join('');
  } catch {
    /* 私密模式：读不到就当没取过。 */
    return '';
  }
}

/** 榜上写哪个名字（方案原话：「leaderboardName() 改成调用 getNickname()」）。 */
export function leaderboardName(): string {
  return getNickname();
}

function writeCache(name: string): void {
  try {
    if (name) localStorage.setItem(PLAYER_NAME_KEY, name);
    else localStorage.removeItem(PLAYER_NAME_KEY);
  } catch {
    /* 存不下就只活在这一次打开里。 */
  }
}

/** 「算不算同一个名字」：NFKC、小写、去首尾空白（和 api/_nickname.js 的 nickKey 一样）。 */
const nickKey = (name: string): string => String(name ?? '').normalize('NFKC').toLowerCase().trim();

/**
 * 他是不是把自己的凭据敲成了名字（方案第 16 推第 4 条）：第一串的前 12 位，或者邮箱 @ 前
 * 面那一段（以及它的前 12 位——从前泄露出去的正是这个形状）。
 *
 * 第一串只有这台设备有原文（服务器只存它的 sha256），所以「前 12 位」这一条只有这里拦得住。
 */
function isOwnCredential(name: string): boolean {
  const key = nickKey(name);
  if (!key) return false;
  const first = String(entitlement().handle || '').trim();
  if (first && (key === nickKey(first.slice(0, 12)) || key === nickKey(first))) return true;
  const mail = String(signedInEmail() || '');
  const at = mail.indexOf('@');
  if (at > 0) {
    const local = nickKey(mail.slice(0, at));
    if (key === local || key === local.slice(0, 12)) return true;
  }
  return false;
}

/**
 * 「头卡上该写『设置昵称』」：登录了，而服务器那边没有他的昵称、本机这一份又没传上去。
 * 和「本机缓存是空的」不完全是一回事——自动上传断在网上的时候，缓存还留着（下次再试），可
 * 那个名字还不是他的。
 */
let unconfirmed = false;
const listeners = new Set<() => void>();
const changed = () => {
  for (const fn of listeners) fn();
};

/** 昵称变了（改名成功、服务器那一份盖下来、自动上传失败）。返回取消订阅。 */
export function onNicknameChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * 头卡上那一格写什么：已登记的昵称；没有就是空串（调用方写「设置昵称」）。
 */
export function confirmedNickname(): string {
  return unconfirmed ? '' : getNickname();
}

/**
 * 改昵称。
 *
 * 先在这一头挡掉三种不用问服务器的（空、超过 12 个码点、是自己的凭据），再问服务器。成功
 * 之后才写缓存——服务器说了算，这台设备只是记下它说了什么。顺手：
 *
 *   · 清掉排行榜缓存（engine/cloudScores.ts 的 invalidateBoards）：他点开榜要看到的就是新
 *     名字，不是十秒前缓存的那一张。
 *   · 这台设备正坐在一间小屋里，就让屋里那把椅子也换名字（engine/room.ts 的 renameSeat）。
 */
export async function setNickname(raw: string): Promise<NicknameResult> {
  const name = String(raw ?? '').trim();
  if (!name) return { ok: false, reason: 'required' };
  if (Array.from(name).length > NICK_MAX) return { ok: false, reason: 'bad' };
  if (isOwnCredential(name)) return { ok: false, reason: 'blocked' };
  const who = auth();
  if (!who) return { ok: false, reason: 'signedOut' };

  let res: Response;
  try {
    res = await fetch('/api/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...who, storeClaim: isStoreChannel(), action: 'name', name }),
    });
  } catch {
    return { ok: false, reason: 'network' };
  }
  const reply = (await res.json().catch(() => ({}))) as { name?: unknown; error?: unknown };
  if (res.status === 409) return { ok: false, reason: 'taken' };
  if (res.status === 429) return { ok: false, reason: 'tooMany' };
  if (res.status === 401) return { ok: false, reason: 'signedOut' };
  if (res.status === 400) {
    const why = String(reply.error || '');
    return { ok: false, reason: why === 'blocked' || why === 'required' ? why : 'bad' };
  }
  if (!res.ok) return { ok: false, reason: 'network' };

  // 服务器清洗过的那一份（去掉了零宽字符之类）才是他的名字。
  const saved = typeof reply.name === 'string' && reply.name ? reply.name : name;
  writeCache(saved);
  unconfirmed = false;
  invalidateBoards();
  changed();
  if (currentRoom()) void renameSeat().catch(() => {});
  return { ok: true, name: saved };
}

/** 这一次打开网页，给哪个身份自动上传过（「一次」就是一次，失败不重试）。 */
let uploadedFor = '';
const whoAmI = (): string => signedInEmail() || entitlement().code || '';

/**
 * 服务器那一份昵称来了（登录之后、每次 fetchMine 之后，engine/cloudRestore.ts 调它）。
 *
 *   · 服务器有 → 盖掉本机那一份。
 *   · 服务器没有、本机有 → 自动上传一次。传上去了就是他的；被占了、过不了词表 → 本机那一份
 *     清掉（它不是这个帐号的名字），头卡写「设置昵称」；断网 → 本机那一份留着下次再试，
 *     头卡照样写「设置昵称」（它此刻还不是他的）。
 *   · 两边都没有 → 头卡写「设置昵称」。
 *
 * `serverName` 是 undefined（旧服务器不回这一位）就什么都不做——那不是「服务器说没有」。
 */
export async function adoptServerNickname(serverName: unknown): Promise<void> {
  if (serverName === undefined || serverName === null) return;
  const name = typeof serverName === 'string' ? serverName.trim() : '';
  if (name) {
    writeCache(name);
    unconfirmed = false;
    changed();
    return;
  }
  const local = getNickname();
  const me = whoAmI();
  if (!local || uploadedFor === me) {
    unconfirmed = true;
    changed();
    return;
  }
  uploadedFor = me;
  const r = await setNickname(local);
  if (r.ok) return;
  if (r.reason === 'taken' || r.reason === 'blocked' || r.reason === 'bad' || r.reason === 'required') {
    writeCache('');
  }
  unconfirmed = true;
  changed();
}

/** 改名失败时屏幕上那一句。 */
export function nicknameErrorText(reason: NicknameError, lang: Lang): string {
  const s = STRINGS[lang];
  switch (reason) {
    case 'taken':
      return s.nickTaken;
    case 'blocked':
      return s.nickBlocked;
    case 'bad':
      return s.nickBad;
    case 'required':
      return s.nickRequired;
    case 'tooMany':
      return s.tooManyTries;
    case 'signedOut':
      return s.sessionGone;
    default:
      return s.purchaseNetwork;
  }
}

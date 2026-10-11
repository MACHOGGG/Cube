import { entitlement, signedInEmail } from './subscription';
import { isStoreChannel } from './channel';
import { auth, invalidateBoards } from './cloudScores';
import { currentRoom, renameSeat } from './room';
import { STRINGS, type Lang } from '../i18n';
import { fetchWithTimeout } from './fetchTimeout';

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
  /** 服务器那头 5xx，不是他的网络（10-09 补充方案 7-13 第 3 条）。 */
  | 'unavailable'
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

/*
 * 「算不算同一个名字」——**和 api/_nickname.js 的 nickKey 一字不差的一份**（10-11 方案 A-6）：先洗掉看不
 * 见的字符，再 NFKC、再洗一遍、小写。api/ 是纯 .js，这一头 import 不进去，只能抄；check-nickname ⑪ 拿
 * 一串刁钻的名字比两份算出来的键，对不上就红。
 *
 * 这一头只拿它拦「把自己凭据的前 12 位敲成昵称」（服务器只有第一串的 sha256，这一条只有这里拦得
 * 住）。原先只做 NFKC + 小写：在自己的第一串里夹一个软连字符，这一道就认不出来，而服务器洗掉那个字符
 * 之后，榜上印出来的正是第一串的前 12 位。洗法的来由见那个文件 scrubName 上面那一段。
 */
const CONTROL_RE = /[\p{Cc}\u2028\u2029]/gu;
const FORMAT_RE = /\p{Cf}/u;
const INVISIBLE = new Set(['\u034f', '\u115f', '\u1160', '\u17b4', '\u17b5', '\u2800', '\u3164', '\uffa0']);
const VARIATION_RE = /[\ufe00-\ufe0f\u{e0100}-\u{e01ef}]/u;
const ZWJ = '\u200d';
const BLACK_FLAG = '\u{1f3f4}';
const TAG_RE = /[\u{e0020}-\u{e007e}]/u;
const CANCEL_TAG = '\u{e007f}';
const KEYCAP = '\u20e3';
const EMOJI_BEFORE = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\ufe0f]/u;
const EMOJI_AFTER = /\p{Extended_Pictographic}/u;
const EMOJI_BASE = /\p{Extended_Pictographic}/u;
const KEYCAP_BASE = /^[0-9#*]$/;

function scrubName(raw: string): string {
  const chars = Array.from(String(raw ?? '').replace(CONTROL_RE, ''));
  const kept: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const before = kept[kept.length - 1];
    if (INVISIBLE.has(ch)) continue;
    if (ch === ZWJ) {
      const after = chars[i + 1];
      if (before && after && EMOJI_BEFORE.test(before) && EMOJI_AFTER.test(after)) kept.push(ch);
      continue;
    }
    if (before === BLACK_FLAG && TAG_RE.test(ch)) {
      let end = i;
      while (end < chars.length && TAG_RE.test(chars[end])) end++;
      if (chars[end] === CANCEL_TAG) {
        kept.push(...chars.slice(i, end + 1));
        i = end;
        continue;
      }
    }
    if (VARIATION_RE.test(ch)) {
      const keycap = before !== undefined && KEYCAP_BASE.test(before) && chars[i + 1] === KEYCAP;
      if (before !== undefined && (EMOJI_BASE.test(before) || keycap)) kept.push(ch);
      continue;
    }
    if (FORMAT_RE.test(ch)) continue;
    kept.push(ch);
  }
  return kept.join('').trim();
}

/** 「算不算同一个名字」只问它。导出给门比两份（见上）。 */
export const nickKey = (name: string): string => scrubName(scrubName(name).normalize('NFKC')).toLowerCase();

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
    res = await fetchWithTimeout('/api/scores', {
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
  // 5xx 是我们这头的事，说「服务器忙」；只有剩下那些才落到「连不上网络」（10-09 补充方案 7-13 第 3 条）。
  if (!res.ok) return { ok: false, reason: res.status >= 500 ? 'unavailable' : 'network' };

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
    case 'unavailable':
      return s.serverBusy;
    default:
      return s.purchaseNetwork;
  }
}

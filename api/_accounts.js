import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mintCodes } from './_codes.js';
import { del, get, hdel, hgetall, hset, set, takeOnce } from './_store.js';

/**
 * The accounts a redeemed code creates — the only accounts this app has.
 *
 * A card subscription needs none of this: Creem holds that record and is
 * asked about it directly. But a redeemed code is ours to honour, so it
 * needs somewhere to live and some way for the player to prove, on a new
 * phone, that it is theirs. That is an address and a passcode.
 *
 * ── About a 4-digit passcode ─────────────────────────────────────────────
 * Four digits is ten thousand possibilities, and six is a million; allowing
 * anything from four to six makes the union 1.11 million, but an attacker
 * enumerates the short ones first, so whoever chooses four digits is sitting
 * in a ten-thousand-wide space no matter what the other players chose.
 *
 * The length is therefore not what protects the account. These two things
 * are, and they are why a short passcode is defensible here at all:
 *
 *   scrypt, not a plain hash. Every single guess costs real CPU time, so an
 *   attacker who somehow walked off with the whole store still cannot run
 *   ten thousand guesses per account for free.
 *
 *   A hard lockout. Four wrong tries and the account stops answering for
 *   four hours; six and it stops answering at all until the address proves
 *   itself by email (LOCK_AFTER / BLOCK_AFTER / LOCK_MS below — this used
 *   to describe a five-try, fifteen-minutes-to-a-day ladder that the code
 *   never had). Ten thousand guesses at four per lockout is not an attack
 *   anyone finishes.
 *
 * What is behind the account is a game subscription, which is what makes
 * that trade — a passcode short enough to actually remember, defended by
 * cost and by lockout rather than by length — a reasonable one to offer.
 */

/**
 * 只剩下认「老的那种」用的：早期内部码账号设的是 4 到 6 位纯数字。新设的
 * 密码一律走 PASS_RE（正好 6 位，数字或字母），任何一个入口都不再拿这一条
 * 挡人——挡了就等于把当年那批账号锁在门外，而且还挡在计数之前，连「错太多
 * 次去邮箱找回」那条路都走不到。
 */
export const PIN_RE = /^\d{4,6}$/;

/**
 * 密码：正好 6 位，数字或字母。
 *
 * 全站只有这一条规矩——注册、绑码、改密码、忘了密码用邮箱找回、换设备登录，
 * 都走它。原来是三条：这里写「6 位以上都行」（注释这么写，正则却是恰好 6
 * 位），登录那个接口要「4 到 6 位纯数字」，界面上的提示又是第三种说法。三条
 * 规矩打架的结果是玩家看到「至少 6 位」、却打不进第 7 个字符，提交了又被告
 * 知「必须正好 6 位」。
 *
 * 长度短不是靠长度防的，靠的是另外两件事：每一次猜都要真花一次 scrypt 的
 * CPU；以及错四次锁四小时、错六次彻底封（见下面的 LOCK_AFTER / BLOCK_AFTER）。
 */
export const PASS_RE = /^[A-Za-z0-9]{6}$/;

/**
 * What an endpoint accepts before it knows which kind of account it is
 * looking at. Deliberately loose: the stored hash is what actually decides,
 * and rejecting a shape here early would tell a stranger which kind of
 * account an address has.
 */
export const SECRET_RE = /^.{4,128}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Wrong tries are counted cumulatively and only a correct passcode clears
 * them, so waiting out a lock does not buy a fresh budget of guesses.
 *
 *   4 wrong  the account stops answering for four hours
 *   6 wrong  it stops answering at all, until the address behind it proves
 *            itself and sets a new passcode
 *
 * Six guesses out of ten thousand is not an attack; it is a person who has
 * forgotten which four digits they picked, which is why the way out is the
 * email rather than a longer wait.
 */
const LOCK_AFTER = 4;
const BLOCK_AFTER = 6;
const LOCK_MS = 4 * 3600e3;

export const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

/**
 * The identifier a redeemed code lives under before any address is attached.
 *
 * A code grants its month or year the instant it is typed — that is the whole
 * point of a code, and asking for an address and a password first turned a
 * gift into a form to fill in. But the entitlement still has to live
 * somewhere the server can find again, or clearing the browser would take
 * away something that was given. So it lives here, under the code itself,
 * until the player attaches an address to it — which is what api/passcode.js
 * does, and what the app asks for right after the code goes in.
 *
 * Shaped so it can never collide with a real address: an email cannot
 * contain a colon before its @, and this has no @ at all.
 */
export const codeHolder = (ticket) => 'code:' + String(ticket || '').toUpperCase();
const accountKey = (email) => 'acct:' + normalizeEmail(email);

/**
 * 所有账户的名单。
 *
 * 账户是一个邮箱一把钥匙（acct:<邮箱>）分开存的，彼此之间没有任何联系——
 * 「列出所有玩家」在数据库里因此不是一件慢的事，而是一件做不到的事，而发码
 * 后台的第一步就是把人列出来。所以每次存账户时顺手往这个哈希里记一笔。
 *
 * 记的是筛选和显示要用的那几样，一样秘密都不带：没有 hash、没有 salt、没有
 * token。管理页一次 HGETALL 就够，不用挨个去查账户本体。
 */
const INDEX_KEY = 'accounts';

const indexRow = (account) => ({
  kind: account.kind,
  plan: account.plan || null,
  until: account.until || 0,
  createdAt: account.createdAt || 0,
  blocked: Boolean(account.blocked),
  news: Boolean(account.news),
  /** 后台发给他、他还没看的码有几张。主菜单那块提示读的就是它。 */
  inbox: Array.isArray(account.inbox) ? account.inbox.length : 0,
});

export const loadAccount = (email) => get(accountKey(email));

export async function deleteAccount(email) {
  await del(accountKey(email));
  try {
    await hdel(INDEX_KEY, normalizeEmail(email));
  } catch (err) {
    console.error('名单没删掉', email, err);
  }
}

export async function saveAccount(email, account) {
  await set(accountKey(email), account);
  // 名单只收真正的邮箱。
  //
  // 一张还没绑邮箱的码，它的权益暂存在一个叫 code:XXXXXX 的「账户」下（见
  // codeHolder）。那不是一个人，是一张码的寄存处——把它列进玩家名单，后台会
  // 看到一堆 code:seed01 这样的「玩家」，还能勾中给它发码。实测过，第一版就
  // 是这样。
  //
  // 名单写在账户之后，而且它自己摔了不算这次保存失败：账户本体存住了才是要紧
  // 的，名单只是一份为了能列出来而维护的副本，下一次保存就会把它补上。
  const address = normalizeEmail(email);
  if (!EMAIL_RE.test(address)) return;
  try {
    await hset(INDEX_KEY, address, indexRow(account));
  } catch (err) {
    console.error('名单没记上', address, err);
  }
}

/** 名单全文：{ 邮箱: indexRow }。只有带 ADMIN_TOKEN 的后台读得到。 */
export const listAccounts = () => hgetall(INDEX_KEY);

/**
 * Read an account and delete it in one step — the atomic claim.
 *
 * Only one caller can win a GETDEL, which is what makes it safe for two
 * requests to reach for the same code-held entitlement at the same instant:
 * the loser gets null rather than a second copy of the same month.
 *
 * Whoever takes it now owns putting it back if they cannot finish. See
 * api/passcode.js bind().
 */
export async function takeAccount(email) {
  const gone = await takeOnce(accountKey(email));
  try {
    await hdel(INDEX_KEY, normalizeEmail(email));
  } catch (err) {
    console.error('名单没删掉', email, err);
  }
  return gone;
}

function hash(pin, saltHex) {
  return scryptSync(String(pin), Buffer.from(saltHex, 'hex'), 32).toString('hex');
}

/** 只为了花掉一次 scrypt 的时间，结果扔掉。见 burnGuess。 */
const DECOY_SALT = randomBytes(16).toString('hex');

/**
 * 这个地址根本没有账号——但还是花一次算哈希的时间再回答。
 *
 * 「地址不存在」和「密码不对」故意回同一句话，为的是不让人拿这个接口打听某
 * 个邮箱有没有注册过。可是有账号的那一路真的算了一次 scrypt（那是故意慢的），
 * 没账号的那一路直接就返回了——两句话一样，回答的快慢却不一样，够细心的人
 * 还是分得出来。所以没账号的时候也照样烧掉同一份 CPU。
 *
 * 这是把差距压下去，不是把它证明为零：网络抖动本来就比这点毫秒大得多，而
 * 存储那一次读也只在有账号时才有回包。真要彻底消掉，得让两条路读一样多的
 * 东西——那是另一件事，不值得为它把每个接口都改成假读一次。
 */
export function burnGuess(secret) {
  hash(String(secret ?? ''), DECOY_SALT);
}

export function newAccount(secret, kind = 'code') {
  const salt = randomBytes(16).toString('hex');
  const newToken = randomBytes(24).toString('hex');
  const now = Date.now();
  return {
    /** 'card' — Creem holds the entitlement, this only proves identity.
     *  'code' — a redeemed code, whose entitlement lives in `until` below. */
    kind,
    salt,
    hash: hash(secret, salt),
    until: 0,
    fails: 0,
    lockUntil: 0,
    /** Set once the address itself has to vouch for whoever is trying. */
    blocked: false,
    token: newToken,
    /** 同时在线的几台设备，见 issueToken。新账号先记下第一台。 */
    tokens: [{ t: newToken, at: now }],
    createdAt: now,
    /** 他们愿不愿意收我们的邮件，以及是什么时候说的。
     *
     *  存两个字段而不是一个，是因为「同意」不只是一个是非题：真被问起来，要
     *  拿得出「谁、什么时候、对什么说的同意」。默认 false——出厂就勾上的框
     *  不算同意，写死在这里比写在页面上更保险。
     *
     *  这只是一个偏好，不是权限：改它、清它都不影响账号本身能不能登录。 */
    news: false,
    newsAt: 0,
  };
}

/** 记下这次「愿意/不愿意收信」，连同说这话的时刻。 */
export function setNews(account, wanted) {
  const yes = wanted === true;
  if (account.news === yes) return account;
  account.news = yes;
  account.newsAt = Date.now();
  return account;
}

/**
 * Checks a passcode and records the attempt. Returns one of
 * 'ok' | 'wrong' | 'locked' | 'blocked'. Callers must give the same answer
 * for 'wrong' as for an address with no account at all, so that this cannot
 * be used to find out who has one.
 */
export async function checkPin(email, pin, account) {
  const now = Date.now();
  if (account.blocked) return 'blocked';
  if (account.lockUntil && account.lockUntil > now) return 'locked';

  const attempt = Buffer.from(hash(pin, account.salt), 'hex');
  const known = Buffer.from(account.hash, 'hex');
  const ok = attempt.length === known.length && timingSafeEqual(attempt, known);

  if (ok) {
    // Only getting it right clears the count.
    if (account.fails || account.lockUntil) {
      account.fails = 0;
      account.lockUntil = 0;
      await saveAccount(email, account);
    }
    return 'ok';
  }

  account.fails = (account.fails || 0) + 1;
  if (account.fails >= BLOCK_AFTER) account.blocked = true;
  else if (account.fails >= LOCK_AFTER) account.lockUntil = now + LOCK_MS;
  await saveAccount(email, account);
  return account.blocked ? 'blocked' : account.lockUntil > now ? 'locked' : 'wrong';
}

/** Cleared by the address proving itself — see api/unlock.js. */
export function unblock(account, newPin) {
  account.salt = randomBytes(16).toString('hex');
  account.hash = hash(newPin, account.salt);
  account.fails = 0;
  account.lockUntil = 0;
  account.blocked = false;
  return account;
}

/** How long a timed lock still has to run, for the message shown. */
export const lockRemainingMs = (account) =>
  Math.max(0, (account.lockUntil || 0) - Date.now());

/**
 * 一个账号可以同时在几台设备上登录。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么要一串令牌，不是一把
 *
 * 从前账号上只有一把 `token`，每次拿密码登录都换一把新的，旧的立刻作废。手
 * 机上登录一次，电脑上再登录一次，手机那台下次去看排行榜就被服务器认成陌生
 * 人（401），界面只能说「请重新登录」——玩家看到的就是「登录了一会儿又要重
 * 新登录」。一个人有手机也有电脑，这不是异常用法，是常态。
 *
 * 所以改成一串：每次登录**添**一把，不动别人手里那几把。最多留 MAX 把（再
 * 多就把最老的挤掉——不是为了安全，是为了这条记录不会无限长），每把有自己
 * 的签发时间，超过 TTL 自然失效。
 *
 * `account.token` 保留，指向最新签发的那一把：老版本的客户端和几处只读它的
 * 代码照旧能用，而「这把还算不算数」一律走 tokenValid()。
 *
 * 什么时候该把所有设备都踢下线：改密码、以及邮箱验证解锁（那两件事的前提正
 * 是「这个账号可能已经不只我一个人在用」）。那两处调 revokeTokens()。
 * ─────────────────────────────────────────────────────────────────────────
 */
const MAX_TOKENS = 8;
/** 一把令牌能用多久。一年不动的设备，下次要重新登录。 */
const TOKEN_TTL_MS = 365 * 24 * 3600e3;

/** 把老账号（只有一把 token、还没有这一串）就地补成一串。 */
function tokenRing(account) {
  if (Array.isArray(account.tokens)) return account.tokens;
  account.tokens = account.token
    ? [{ t: account.token, at: account.createdAt || Date.now() }]
    : [];
  return account.tokens;
}

const live = (entry, now) => entry && entry.t && now - (entry.at || 0) < TOKEN_TTL_MS;

/** 又一台设备登录了。添一把，别人手里那几把不动。 */
export function issueToken(account) {
  const now = Date.now();
  const ring = tokenRing(account).filter((e) => live(e, now));
  const fresh = randomBytes(24).toString('hex');
  ring.push({ t: fresh, at: now });
  // 挤掉最老的：留住的是最近用得上的那几台。
  account.tokens = ring.slice(-MAX_TOKENS);
  account.token = fresh;
  return fresh;
}

/** 这把令牌此刻还算不算数。 */
export function tokenValid(account, presented) {
  const token = String(presented || '');
  if (!account || !token) return false;
  const now = Date.now();
  return tokenRing(account).some((e) => live(e, now) && e.t === token);
}

/** 全部作废，另发一把——改密码和邮箱解锁走这条。 */
export function revokeTokens(account) {
  account.tokens = [];
  return issueToken(account);
}

/** How long a redeemed code is worth. 'life' is handled separately below. */
export const PLAN_MS = {
  month: 31 * 24 * 3600e3,
  half: 184 * 24 * 3600e3,
  year: 366 * 24 * 3600e3,
};

/** The four tiers a code can carry, in the order they are worth. */
export const PLANS = ['month', 'half', 'year', 'life'];
export const isPlan = (plan) => PLANS.includes(plan);

/**
 * "Forever", as a date.
 *
 * Everything downstream — isGenius on the device, entitlementOf here — asks
 * the same question of every entitlement: has `until` passed yet. Giving
 * lifetime a date a thousand years out lets it answer that question the same
 * way as every other tier, instead of every one of those places growing a
 * second branch it would eventually get wrong.
 */
export const LIFETIME_UNTIL = Date.UTC(2999, 0, 1);
export const isLifetime = (account) => (account?.until || 0) >= LIFETIME_UNTIL;

/**
 * Adds a plan to whatever the account already has. Redeeming a second code
 * extends the run rather than replacing it, so nothing a player has already
 * paid for is thrown away by using a gift code early.
 */
export function extend(account, plan) {
  // Adding time to forever is not an error, it is simply nothing.
  if (isLifetime(account)) return account.until;
  if (plan === 'life') {
    account.until = LIFETIME_UNTIL;
    account.plan = 'life';
    return account.until;
  }
  const from = Math.max(Date.now(), account.until || 0);
  account.until = from + (PLAN_MS[plan] ?? PLAN_MS.month);
  account.plan = plan;
  return account.until;
}

/**
 * 年付赠码 — two one-month codes a yearly subscriber can pass to friends.
 *
 * A year is a long thing to ask someone to buy on their own recommendation,
 * so a yearly subscriber gets two months to hand out. They carry a use-by
 * date because a gift with no deadline is one that sits in a drawer: the
 * point of it is that someone plays this month.
 *
 * Issued once and remembered on the account, so this can be called on every
 * sign-in without a subscriber quietly accumulating codes — which is also
 * what makes it work for people who subscribed before the gift existed.
 */
export const GIFT_PLAN = 'month';
export const GIFT_COUNT = 2;
export const GIFT_DAYS = 30;

export async function ensureGiftCodes(email, account, period) {
  if (Array.isArray(account.gifts)) return account.gifts;
  if (period !== 'yearly') return null;
  const expiresAt = Date.now() + GIFT_DAYS * 24 * 3600e3;
  const codes = await mintCodes(GIFT_PLAN, GIFT_COUNT, expiresAt, { source: 'gift' });
  // An empty mint means the store refused; leaving `gifts` unset lets the
  // next sign-in try again rather than recording that they got nothing.
  if (!codes.length) return null;
  account.gifts = codes.map((code) => ({ code, expiresAt }));
  await saveAccount(email, account);
  return account.gifts;
}

/** The gifts as the browser should see them, minus any already spent. */
export async function liveGifts(account) {
  if (!Array.isArray(account?.gifts)) return [];
  const alive = [];
  for (const gift of account.gifts) {
    // A code that is no longer in the store has been redeemed by somebody;
    // showing it would have the subscriber hand out a code that is dead.
    const doc = await get('code:' + String(gift.code).toUpperCase());
    alive.push({ ...gift, spent: !doc });
  }
  return alive;
}

/**
 * 后台发给这个玩家的码，以及还剩几张没看。
 *
 * 存在账户上（account.inbox）而不是另开一个键：它跟着账户走，删账户就跟着
 * 没，不会留下一堆指向不存在的人的孤儿数据。每一条记的是发的时候就定下来的
 * 事实——哪张码、什么等级、什么时候发的、什么时候过期——而「用没用过」是现
 * 场去库里问的，因为码可能被这个人以外的任何人兑掉。
 */
export async function liveInbox(account) {
  if (!Array.isArray(account?.inbox)) return [];
  const out = [];
  for (const item of account.inbox) {
    const doc = await get('code:' + String(item.code).toUpperCase());
    out.push({ ...item, spent: !doc });
  }
  // 新发的排前面——玩家打开弹窗最想看的是刚收到的那几张。
  return out.sort((a, b) => (b.sentAt || 0) - (a.sentAt || 0));
}

/** 把一批码记到这个账户名下，并标上「有新的没看」。 */
export function addToInbox(account, codes, plan, expiresAt) {
  if (!Array.isArray(account.inbox)) account.inbox = [];
  const sentAt = Date.now();
  for (const code of codes) {
    account.inbox.push({ code, plan, sentAt, ...(expiresAt ? { expiresAt } : {}) });
  }
  // 主菜单那块《收到了内部码！去查看》读的就是它。玩家点开弹窗时清零。
  account.inboxUnseen = (account.inboxUnseen || 0) + codes.length;
  return account;
}

/** What the browser is told. Never the hash, the salt or the attempt count. */
export const entitlementOf = (account, email) => ({
  active: (account.until || 0) > Date.now(),
  // The app only draws two words, and `until` carries the real answer — a
  // half-year and a lifetime both read as the longer of the two.
  period: account.plan === 'month' ? 'monthly' : 'yearly',
  plan: account.plan,
  until: account.until || undefined,
  email,
  token: account.token,
});

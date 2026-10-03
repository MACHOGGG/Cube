/**
 * 昵称（第 16 推）：一个帐号一个，全站唯一，服务器是唯一来源。
 *
 * ── 从前是什么样 ────────────────────────────────────────────────────────
 *
 * 榜上那个名字是**每打完一局顺手报上来的**（push 带一个 `name`），存在 `lbnames` 里谁报
 * 的算谁的。于是三件事一直对不上：
 *
 *   · 两台设备各存着一个名字，哪台最后交卷，榜上就是哪个——改了名，换台手机打一局就又
 *     变回去了；
 *   · 全站可以有任意多个「阿花」，榜上分不出谁是谁；
 *   · 小屋给没取名字的人发的字母、给重名的人加的「 2」会被当成名字记下来，于是榜上冒出
 *     一个孤零零的「B」和一个「阿花 2」。
 *
 * 现在名字只有一条路写进来：`POST /api/scores {action:'name'}`（必须登录，见 scores.js
 * 的 rename）。push 不再碰它。
 *
 * ── 两张表 ────────────────────────────────────────────────────────────
 *
 *   lbnames   帐号 id → `{ name, v: 3 }`。`v: 3` 的意思是「这是从改名接口登记的」；
 *             比它小的是旧客户端随 push 报上来的老条目（见 scores.js 的 shownName），
 *             管理员跑一次《建立昵称索引》（scores.js 的 buildNicknameIndex）之后就都是 3 了。
 *   nickidx   规范化之后的名字 → 帐号 id。**唯一性靠它**：抢名字是一次 HSETNX，两个帐
 *             号同一瞬间抢同一个名字，只有一个写得进去。
 *
 * 规范化是 NFKC + 小写 + 去首尾空白：`Ａｌｉｃｅ`（全角）、`ALICE`、` alice ` 是同一个名字。
 * 显示的仍然是他敲的那个样子（`lbnames` 里存原样），索引只管「算不算同一个」。
 *
 * ── 这个文件只放「名字本身」的事 ───────────────────────────────────────
 *
 * 校验（清洗、长度、词表）和两张表的读写都在这儿，scores.js（改名接口、换邮箱、迁移）和
 * room.js（小屋里的座位名）共用同一份——两边各写一份的话，迟早有一边放行另一边拦下的名字。
 * 「谁在调用、握着哪把锁」是调用方的事：这里的写入假定调用方已经拿着这个帐号那把锁
 * （scores.js 的 statsLockKey）。
 */
import { hdel, hget, hset, hsetnx } from './_store.js';
import { isBlockedName } from './_badwords.js';

export const NAMES = 'lbnames';
export const NICK_INDEX = 'nickidx';
/** 从改名接口登记的条目带这个版本号。旧客户端随 push 写的是 2 或者没有。 */
export const NICK_V = 3;
/** 最多几个码点（`Array.from` 数的那种：一个 emoji 是一个，不是两个）。 */
export const NICK_MAX = 12;

/**
 * 要清掉的字符：
 *
 *   · 控制字符（C0、DEL、C1）、换行和段落分隔符 —— 会把一行榜撑成两行；
 *   · 双向控制字符（LRM、RLM、ALM、LRE…PDF、LRI…PDI）—— 能把后面整行的字倒过来排，
 *     「把名次和分数排成别人的样子」就是靠它；
 *   · 零宽字符（ZWSP、ZWNJ、WJ、BOM、蒙古文元音分隔符、几个不可见运算符）—— 看不见，
 *     却能让两个看起来一模一样的名字各占一格索引，唯一性就名存实亡。
 *
 * ZWJ（U+200D）单独处理：它在 emoji 里是正经字符（👨\u200d👩\u200d👧 是三个 emoji 用两个 ZWJ 粘起来
 * 的），去掉的话一家三口就散成三个人。所以**夹在两个 emoji 中间的 ZWJ 留着**，别处的去掉。
 */
const STRIP_RE =
  /[\u0000-\u001f\u007f-\u009f\u061c\u180e\u200b\u200c\u200e\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;
const ZWJ = '\u200d';
/** ZWJ 前面那一个算不算 emoji 的一部分：emoji 本身、肤色修饰、变体选择符 16。 */
const EMOJI_BEFORE = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\ufe0f]/u;
const EMOJI_AFTER = /\p{Extended_Pictographic}/u;

/** 清洗：去掉上面那几类字符（emoji 里的 ZWJ 留着），再去首尾空白。不截断。 */
export function scrubName(raw) {
  const chars = Array.from(String(raw ?? '').replace(STRIP_RE, ''));
  const kept = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === ZWJ) {
      const before = kept[kept.length - 1];
      const after = chars[i + 1];
      if (!(before && after && EMOJI_BEFORE.test(before) && EMOJI_AFTER.test(after))) continue;
    }
    kept.push(ch);
  }
  return kept.join('').trim();
}

/**
 * 一个名字能不能用。
 *
 * 只回四种结果之一，**不说命中了哪个词**（见 _badwords.js 文件头）：
 *
 *   required  清洗之后是空的。设过昵称的人也不能改成空——榜上那一行会变回「匿名玩家」，
 *             而那正是他取名字要避开的东西。
 *   bad       超过 12 个码点。**拒绝，不截断**：截掉的那一截可能正是他要的那部分（「阿花
 *             和小明的猫」截成「阿花和小明的」），而他在屏幕上看不出被截过。
 *   blocked   词表或保留名。
 *
 * @param opts.letter 单个字母放不放行（小屋里匿名座位放，昵称不放，见 _badwords.js）。
 * @returns {{ ok: true, name: string } | { ok: false, error: 'required' | 'bad' | 'blocked' }}
 */
export function checkNickname(raw, { letter = false } = {}) {
  if (raw !== undefined && raw !== null && typeof raw !== 'string') return { ok: false, error: 'bad' };
  const name = scrubName(raw);
  if (!name) return { ok: false, error: 'required' };
  if (Array.from(name).length > NICK_MAX) return { ok: false, error: 'bad' };
  if (isBlockedName(name, { letter })) return { ok: false, error: 'blocked' };
  return { ok: true, name };
}

/** 索引的键：NFKC、小写、去首尾空白。「算不算同一个名字」只问它。 */
export const nickKey = (name) => String(name ?? '').normalize('NFKC').toLowerCase().trim();

/**
 * 这个帐号登记过的昵称。没有就是空串。
 *
 * **只认 v3**（从改名接口登记的）。旧客户端随 push 报上来的老条目不算：它们没进过索引，
 * 不知道是不是独一份。客户端拿到空串、自己手上又有名字，会自动上传一次（src/engine/
 * nickname.ts 的 adoptServerNickname）——于是常来的玩家打开一次网页就自己登记好了，剩下
 * 的交给管理员那一次迁移。
 */
export async function nicknameOf(id) {
  if (!id) return '';
  const row = await hget(NAMES, id);
  return row && Number(row.v) >= NICK_V && typeof row.name === 'string' ? row.name : '';
}

/** 这个名字现在登记在哪个帐号名下。没人登记就是 null。 */
export async function nicknameOwner(name) {
  const key = nickKey(name);
  if (!key) return null;
  const owner = await hget(NICK_INDEX, key);
  return typeof owner === 'string' && owner ? owner : null;
}

/**
 * 把 `name` 登记成 `id` 的昵称。调用方已经验过格式（checkNickname），并且握着这个帐号那把锁。
 *
 * 三步，顺序是方案定的，每一步摔在中间都只会「多占」不会「丢」：
 *
 *   ① HSETNX 抢新名字。抢不到、而且索引上那一格也不是他自己 → `taken`，什么都没动。
 *      （是他自己的：只改了大小写或者全半角，`Bob` → `bob`，键是同一个。）
 *   ② 写 `lbnames`。从这一刻起榜上就是新名字。
 *   ③ 删旧名字那一格索引——**只在它还指向自己的时候**。旧名字从此谁都能用。
 *
 * ①② 之间摔了：新名字被他占着，榜上还是旧名字——重试一次就好（①会认出「是我自己的」）。
 * ②③ 之间摔了：旧名字多被他占一阵子，别人暂时取不到。两种都不会让两个帐号叫同一个名字。
 *
 * 「只在它还指向自己的时候」不是多余的：③ 读和删之间没人能把那一格换成别人——它指向自己
 * 的时候 HSETNX 写不进去——所以先读后删在这儿是安全的。
 *
 * @returns {'ok' | 'taken'}
 */
export async function registerNickname(id, name) {
  const key = nickKey(name);
  const before = await hget(NAMES, id);
  const oldKey =
    before && Number(before.v) >= NICK_V && typeof before.name === 'string' ? nickKey(before.name) : '';
  if (!(await hsetnx(NICK_INDEX, key, id))) {
    if ((await hget(NICK_INDEX, key)) !== id) return 'taken';
  }
  await hset(NAMES, id, { name, v: NICK_V });
  if (oldKey && oldKey !== key && (await hget(NICK_INDEX, oldKey)) === id) {
    await hdel(NICK_INDEX, oldKey);
  }
  return 'ok';
}

/**
 * 换邮箱时，索引那一格改指向新 id（scores.js 的 moveScores 调它）。
 *
 * **只改指向旧 id 的那一格**：索引上那个名字要是已经归了别人（不该发生，但库里的东西不能
 * 全信），就不去抢——他搬过去之后显示的还是那个名字，管理员下一次迁移会把重名的那一份清掉。
 */
export async function repointNickname(row, from, to) {
  if (!row || Number(row.v) < NICK_V || typeof row.name !== 'string') return;
  const key = nickKey(row.name);
  if (!key) return;
  const owner = await hget(NICK_INDEX, key);
  if (owner === from || owner === null) await hset(NICK_INDEX, key, to);
}

/**
 * 帐号没了：`lbnames` 那一条、索引里指向它的那一格，一起删（_accounts.js 的 deleteAccount
 * 调它）。不删的话那个名字就被一个谁也登不进去的帐号永远占着。
 */
export async function dropNickname(id) {
  if (!id) return;
  const row = await hget(NAMES, id);
  if (row && typeof row.name === 'string') {
    const key = nickKey(row.name);
    if (key && (await hget(NICK_INDEX, key)) === id) await hdel(NICK_INDEX, key);
  }
  await hdel(NAMES, id);
}

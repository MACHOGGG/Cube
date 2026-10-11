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
 * 规范化是清洗（scrubName）+ NFKC + 小写 + 去首尾空白：`Ａｌｉｃｅ`（全角）、`ALICE`、` alice `、
 * `Ali\u00ADce`（夹一个软连字符）是同一个名字。
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
 *   · **全部格式字符**（`\p{Cf}`，10-11 方案 A-6）：双向控制字符（LRM、RLM、LRE…PDF、LRI…PDI——能把后
 *     面整行的字倒过来排，「把名次和分数排成别人的样子」就是靠它）、零宽字符（ZWSP、ZWNJ、WJ、BOM）、
 *     软连字符（U+00AD）、tag 字符……全都看不见，却能让两个看起来一模一样的名字各占一格索引。原先这儿
 *     是一张清单，清单外面那几个就是这么漏过去的：`Sli\u00ADdes`（中间一个软连字符）绕过了保留名
 *     Slides，`管\u00AD理员` 绕过了「管理员」；
 *   · 几个**不算格式字符、却同样看不见**的（INVISIBLE）：CGJ（U+034F）、四个韩文填充符（U+115F、
 *     U+1160、U+3164、U+FFA0）、盲文空白（U+2800）、高棉文的两个「内含元音」（U+17B4、U+17B5，Unicode
 *     自己写着不该用）。它们归在字母或符号类里，「至少含一个字母」那种检查挡不住——`官\u3164方` 原样
 *     过了，整串只有一个 U+3164 的名字也过了；
 *   · 不跟在 emoji 后面的变体选择符（U+FE00–FE0F、U+E0100–E01EF）：跟在字母后面它什么都不改，只是又一
 *     个看不见的字符。
 *
 * emoji 里有两样格式字符是正经的，留着：
 *   · ZWJ（U+200D）：👨\u200d👩\u200d👧 是三个 emoji 用两个 ZWJ 粘起来的，去掉的话一家三口就散成三个人。
 *     **夹在两个 emoji 中间的 ZWJ 留着**，别处的去掉；
 *   · 旗帜的 tag 序列：🏴 后面跟一串 tag 字符、以 U+E007F 收尾（英格兰、苏格兰、威尔士那几面旗）。整串
 *     留着；不成串的 tag 字符去掉。
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
/** ZWJ 前面那一个算不算 emoji 的一部分：emoji 本身、肤色修饰、变体选择符 16。 */
const EMOJI_BEFORE = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\ufe0f]/u;
const EMOJI_AFTER = /\p{Extended_Pictographic}/u;
/** 变体选择符跟在它后面才留：emoji 本身；或者键帽的那个数字 / # / *（后面紧跟 U+20E3，1️⃣ 那种）。 */
const EMOJI_BASE = /\p{Extended_Pictographic}/u;
const KEYCAP_BASE = /^[0-9#*]$/;

/** 清洗：去掉上面那几类字符（emoji 里的 ZWJ、旗帜的 tag 序列留着），再去首尾空白。不截断。 */
export function scrubName(raw) {
  const chars = Array.from(String(raw ?? '').replace(CONTROL_RE, ''));
  const kept = [];
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
      // 不成串：这一个当格式字符去掉（下面那一句），后面的同理。
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

/**
 * 拿来**比**的那个样子：NFKC 之后再洗一遍（U+FFA0 经 NFKC 变成 U+1160，全角那几个也是这一步才统一），
 * 再小写。唯一性（nickKey）、保留名和词表（isBlockedName）都比这一份——三处过的是同一道清洗，不然总
 * 有一处放行另一处拦下的名字。
 */
const matchForm = (name) => scrubName(scrubName(name).normalize('NFKC')).toLowerCase();

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
  if (!name || !matchForm(name)) return { ok: false, error: 'required' };
  if (Array.from(name).length > NICK_MAX) return { ok: false, error: 'bad' };
  if (isBlockedName(matchForm(name), { letter })) return { ok: false, error: 'blocked' };
  return { ok: true, name };
}

/** 索引的键：清洗、NFKC、再清洗、小写（matchForm）。「算不算同一个名字」只问它。 */
export const nickKey = (name) => matchForm(name);

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

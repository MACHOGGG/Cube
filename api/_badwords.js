/**
 * 昵称不许用的词（第 16 推）：一份中英法的基础词表，加上几个保留名。
 *
 * ── 为什么要有它 ──────────────────────────────────────────────────────
 *
 * 昵称第 16 推起是「一个帐号一个、全站唯一」，而且印在三个公开的地方：排行榜、小屋、分享
 * 卡。没有这一道的话，第一个打到榜首的人就能把一句脏话挂在所有人的首页上。
 *
 * ── 只做「基础」那一层 ────────────────────────────────────────────────
 *
 * 方案的字面要求是「中英法基础词表」，所以这儿只放最常见、几乎不会误伤的那一批，不做变形
 * 识别（拆字、谐音、夹空格的那些）。词表不追求全，追求**不误伤**：一个正常的名字被拒，玩家
 * 只看见一句「换一个名字」，不知道哪儿错了，那比漏掉一个生僻的脏词更伤人。
 *
 * 匹配法（玩家定的「按整词或短语匹配」）：
 *   · 拉丁字母那几个词按**整词**认：名字先规范化（NFKC、小写），再按「不是字母也不是数字」
 *     切成几段，某一段等于这个词才算——所以 `Scunthorpe` 不会因为中间那四个字母被拒。
 *   · 中文那几个按**短语**认：中文没有空格分词，只能整段子串比。所以这一组只收那种拆开来
 *     也不会出现在正常名字里的说法（「傻逼」可以，单个「死」不行）。
 *
 * 命中了只回一个笼统的 `blocked`，**不说是哪一个词**——说了等于把词表一条一条念给想绕过它
 * 的人听。
 */

/** 拉丁字母的：按整词比（见上面）。全部小写、不带重音的那一份另外也放了。 */
const WORDS = [
  // English
  'fuck', 'fucker', 'fucking', 'motherfucker', 'shit', 'bullshit', 'bitch', 'cunt', 'cock',
  'pussy', 'asshole', 'bastard', 'whore', 'slut', 'nigger', 'nigga', 'faggot', 'rape', 'rapist',
  'nazi', 'hitler', 'porn',
  // Français
  'merde', 'putain', 'pute', 'salope', 'salaud', 'connard', 'connasse', 'enculé', 'encule',
  'enculer', 'bâtard', 'batard', 'nique', 'niquer', 'pédé', 'pede', 'couille', 'couilles',
  'branleur', 'négro', 'negro',
];
/*
 * 故意**没收**的几个（常见词表里有，可在这儿会误伤）：dick（英文里是常见的名字）、fag（英国
 * 口语里是烟）、retard 和 chatte（法语里是「迟到」「母猫」）、bite（英语「咬一口」）、pd（缩
 * 写，撞名字首字母）、sex。中文同理：「他妈」「妈的」会切到「他妈妈」「我妈的猫」，只收整句
 * 「他妈的」；「尼玛」同时是常见的藏族名字，不收。
 */

/** 中文的：按短语（子串）比。只收拆开也不会在正常名字里出现的说法。 */
const PHRASES = [
  '傻逼', '傻比', '煞笔', '沙比', '傻屌', '操你', '草你', '肏', '日你', '他妈的', '你妈的',
  '草泥马', '婊子', '贱人', '贱货', '鸡巴', '屌丝', '王八蛋', '狗日', '去死', '滚蛋', '强奸',
  '色情', '法西斯', '纳粹',
  // 繁体
  '傻屄', '幹你', '操妳', '他媽的', '你媽的', '婊', '雞巴', '賤人', '強姦', '納粹',
];

/**
 * 保留名（方案原单：Slides、官方、管理员、admin、匿名玩家、单个字母 A–Z）：装成官方、装成系统
 * 发的那个名字。
 *
 *   · Slides、admin —— 按整词比（`Slides 官方号`、`admin123` 前者拦，后者不拦：`admin123`
 *     切出来只有一段 `admin123`，不等于 `admin`）。
 *   · 官方、管理员、匿名玩家 —— 按短语比。「匿名玩家」是榜上没取名字那一行印的字（i18n 的
 *     `rankAnon`），谁拿它当昵称，榜上就分不清哪一行是真的没取名字——所以那一句的另外三种
 *     语言（Anonymous player、Joueur anonyme，繁体同字）也一起保留，管理员也收了繁体那一种。
 *   · 单个字母 A–Z —— 只认**整个名字就是那一个字母**：小屋给没取名字的人发的正是这些（api
 *     /room.js 的 freeLetter），让一个帐号占住「B」，下一个没取名字的人进屋就会被认成他。
 */
const RESERVED_WORDS = ['slides', 'admin'];
const RESERVED_PHRASES = ['官方', '管理员', '管理員', '匿名玩家', 'anonymousplayer', 'joueuranonyme'];

/** 比之前先规范化：全角半角、兼容字形统一（NFKC），再小写。 */
export const normalizeForMatch = (name) => String(name ?? '').normalize('NFKC').toLowerCase();

/** 按「不是字母、不是数字、不是记号」切成几段整词。 */
const wordsOf = (norm) => norm.split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean);

/**
 * 这个名字能不能用。
 *
 * @param opts.letter 单个字母放不放行。**昵称不放**（见上面保留名那一段：帐号占住「B」，
 *   下一个没取名字的人进屋就会被认成他）；**小屋里没登录的人自己敲的座位名放**——字母本来
 *   就是小屋那一套（freeLetter 会跳过屋里已经有人敲了的那个字母），一个匿名座位叫「B」不
 *   冒充任何帐号，而且它从来不写进昵称（第 16 推第 6 条）。
 * @returns `true` = 撞上了词表或保留名（该拒）。
 */
export function isBlockedName(name, { letter = false } = {}) {
  const norm = normalizeForMatch(name).trim();
  if (!norm) return false;
  if (!letter && /^[a-z]$/.test(norm)) return true;
  const words = wordsOf(norm);
  for (const w of words) {
    if (WORDS.includes(w) || RESERVED_WORDS.includes(w)) return true;
  }
  // 中文短语：去掉空白和标点再比，免得夹一个空格就绕过去（「傻 逼」）。
  const squeezed = norm.replace(/[\s\p{P}\p{S}]+/gu, '');
  for (const p of PHRASES) if (squeezed.includes(p)) return true;
  for (const p of RESERVED_PHRASES) if (squeezed.includes(p)) return true;
  return false;
}

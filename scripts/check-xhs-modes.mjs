/**
 * 小红书那一端的玩法表，一共有**七张**，加一档玩法要七张都动。
 *
 *   node scripts/check-xhs-modes.mjs        # 纯 node，读源码，不打包不开浏览器
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么要有这一道
 *
 * 2026-10 往这一端补《步步为营》（决策 §10 的 E20），一档玩法要在七个互不相干的
 * 地方各登记一次：
 *
 *   ① `xhs/src/menu.ts` 的 `XhsMode` 联合 —— 这一端认得哪几档；
 *   ② 同文件的 `CARDS` —— 主菜单上摆哪几张卡；
 *   ③ 同文件的 `perRow`（宽屏那个数）—— 一排摆得下几张；
 *   ④ `xhs/src/main.ts` 的 `onPlay` 分派 —— 点下去进哪一屏；
 *   ⑤ 同文件的 `FirstKey` ＋ `DAILY_MODE_KEYS` —— 头一回的那句提示、成绩页翻哪几本（`BOOKS`
 *     从 2026-10-08 起由「全部棋盘 × DAILY_MODE_KEYS」拼出来，不再手写）；
 *   ⑥ `soon` ＋ `dim` —— 那块「进阶入口」牌子、头几局的压暗路标；
 *   ⑦ `xhs/check-vsweb.mjs` 的 `XHS_CARD` —— 那道门按下标点卡。
 *
 * 七张里漏一张，症状各不相同，而且**全都不当场报错**（只有 ⑤ 的 `FirstKey` 例外）：
 *
 *   · 漏 ③ ：六张卡排成「宽屏一排五张 + 最后一张单独吊一行」。
 *   · 漏 ④ ：从前最后一档是 `return showFlip()` 兜底，新来的那一档于是**进了无限
 *     反转那一屏**。点《步步为营》打开的是别的玩法，一个错都不报。
 *   · 漏 ⑤ 的 `BOOKS`：这一档打完的局在成绩页上**整片不存在**，累计得分不涨，也
 *     不报错（check-vsweb 2026-09 逮到过同一个毛病的上一版；2026-10-08 每日挑战的
 *     计时两档又漏过一回，之后 BOOKS 改成拼出来的）。
 *   · 漏 ⑤ 的 `FirstKey`：这一个是唯一会当场拦住人的——`npm run build:xhs` 编译不
 *     过。可它**只在 `xhs/tsconfig.json` 下才编译不过**：`npm run typecheck`
 *     （`tsc -b`）管不到 `xhs/`，所以「typecheck 全绿」这句话对这一端不成立。
 *   · 漏 ⑥ ：六张卡里只有新来的那一张既不暗、也没「进阶入口」牌子——四个兄弟都有、
 *     它没有，看上去像「这张才是正式的」。玩家定的是「基础的两个明亮，剩下的轻微
 *     暗淡」，少的不是功能，是一屏卡说不到一块去。
 *   · 漏 ⑦ ：`check-vsweb` 按下标点卡，插卡而这张表没动，那道门底下每一屏点开的都是
 *     隔壁那个玩法——**一道全绿的门在比错的两屏**，比没有门更糟。
 *
 * 顺带钉住第六件、它和小红书无关只是只在这一端犯过：**一次性清档两端都要调**
 * （`src/engine/wipeOldRules.ts`，决策 §6）。它从前是 `src/main.ts` 的私有函数，
 * 于是这一端一次都没跑过——同一个玩家在这儿看到的是旧规则时代的最高分，而哨兵键
 * 那套防重跑机制让它永远不会自己修好。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这道门的规矩
 *
 * 每一条先摆一把**尺子**：确认要查的那张表真的在那个文件里、真的解析出了东西。
 * 没有尺子的话，正则改一个字就得到一张空表，而「空表里的每一项都对」恒真——这个
 * 仓库里的假绿多半是这么来的。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(repo, p), 'utf8');

let fails = 0;
const say = (ok, text, extra = '') => {
  if (!ok) fails++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + text + (extra ? '  ' + extra : ''));
};
const note = (t) => console.log('  ····  ' + t);
const head = (t) => console.log('\n' + t);

const menuSrc = read('xhs/src/menu.ts');
const mainSrc = read('xhs/src/main.ts');
const webMainSrc = read('src/main.ts');
const wipeSrc = read('src/engine/wipeOldRules.ts');

/** 从 `const NAME … = [` 起到第一处行首 `];` 为止的那一段。 */
function blockOf(src, startRe) {
  const m = src.match(startRe);
  if (!m) return null;
  const from = src.indexOf(m[0]);
  const end = src.indexOf('\n];', from);
  return end < 0 ? null : src.slice(from, end);
}

// ── ① XhsMode ───────────────────────────────────────────────────────────────
head('① XhsMode：这一端认得哪几档');

const modeLine = menuSrc.match(/export type XhsMode =([^;]*);/);
say(!!modeLine, '尺子：menu.ts 里有 `export type XhsMode = …`');
const MODES = modeLine ? [...modeLine[1].matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]) : [];
say(MODES.length >= 5, `尺子：解析出 ${MODES.length} 档`, MODES.join('、'));
say(MODES.includes('puzzle'), 'XhsMode 里有 puzzle（《步步为营》，E20）');

// ── ② CARDS ────────────────────────────────────────────────────────────────
head('② CARDS：主菜单上摆哪几张');

const cardsBlock = blockOf(menuSrc, /const CARDS:[^=]*=\s*\[/);
say(!!cardsBlock, '尺子：menu.ts 里切出了 CARDS 那一段');
const CARD_MODES = cardsBlock ? [...cardsBlock.matchAll(/mode:\s*'([a-zA-Z]+)'/g)].map((m) => m[1]) : [];
say(CARD_MODES.length >= 5, `尺子：解析出 ${CARD_MODES.length} 张卡`, CARD_MODES.join('、'));

// 两张表要**互相覆盖**，不是单向包含：少一张是「认得却不摆」（玩家点不到），多一
// 张是「摆了却不认」（tsc 能拦，但这儿一并钉住，顺序不依赖编译）。
for (const m of MODES) say(CARD_MODES.includes(m), `XhsMode 的 ${m} 在 CARDS 里摆了一张`);
for (const m of CARD_MODES) say(MODES.includes(m), `CARDS 的 ${m} 在 XhsMode 里登记过`);

// 每张卡的图标都是真从 homeIcons 引进来的那一个，不是别处抄的字面量。
const iconNames = cardsBlock ? [...cardsBlock.matchAll(/icon:\s*([A-Z_0-9]+)/g)].map((m) => m[1]) : [];
say(iconNames.length === CARD_MODES.length, `尺子：${iconNames.length} 张卡各有一个具名图标`);
for (const n of iconNames) {
  say(
    new RegExp(`^\\s*${n},?$`, 'm').test(menuSrc) || new RegExp(`\\b${n}\\b[^\\n]*from`, '').test(menuSrc),
    `图标 ${n} 是 import 进来的，不是就地写的字面量`,
  );
}

// ── ③ perRow ───────────────────────────────────────────────────────────────
head('③ perRow：宽屏一排摆几张');

const perRow = menuSrc.match(/const perRow = wide \? (\d+) : (\d+);/);
say(!!perRow, '尺子：menu.ts 里有 `const perRow = wide ? N : M;`');
if (perRow) {
  say(
    Number(perRow[1]) === CARD_MODES.length,
    `宽屏 perRow（${perRow[1]}）= 卡数（${CARD_MODES.length}）：一排摆完，没有谁单独吊一行`,
  );
  // 窄屏两张一排是玩家定的（E20「主菜单排布冻结」）。钉住它，顺手也钉住「排数没
  // 变」——menuFit.ts 按排数平摊缩减，排数变了那一页的高度就得重算。
  say(Number(perRow[2]) === 2, `窄屏 perRow = 2（E20 排布冻结）`);
  const rows = Math.ceil(CARD_MODES.length / Number(perRow[2]));
  say(rows === 3, `窄屏排成 ${rows} 排（五张和六张都是 3 排，menuFit 量到的高度不变）`);
}

// ── ④ onPlay 分派 ──────────────────────────────────────────────────────────
head('④ onPlay：点下去进哪一屏');

const dispatch = mainSrc.match(/onPlay: \(mode: XhsMode\) => \{[\s\S]*?\n {4}\},/);
say(!!dispatch, '尺子：main.ts 里切出了 onPlay 那一段');
const body = dispatch ? dispatch[0] : '';
const cases = [...body.matchAll(/case '([a-zA-Z]+)':/g)].map((m) => m[1]);
say(cases.length >= 5, `尺子：解析出 ${cases.length} 条 case`, cases.join('、'));
for (const m of CARD_MODES) say(cases.includes(m), `${m} 有自己那一条 case`);

// 这一条是 2026-10 真踩过的那个坑：兜底分支一旦存在，新来的那一档就静悄悄地走进
// 最后那一屏。所以既不许有 default，也不许有落在 switch 之后的裸 return 调用。
say(!/\bdefault:/.test(body), 'onPlay 里没有 default 分支（兜底就是「新来的那一档走错屏」）');
say(/const missed: never = mode;/.test(body), '穷举靠 `const missed: never = mode;` 把关（漏一档 tsc 当场报错）');
say(
  !/^\s*return show[A-Z]\w*\(\);\s*$/m.test(body.slice(body.indexOf('const missed'))),
  'never 那一行之后没有别的 `return showXxx()` 兜底',
);

// ── ⑤ FirstKey ＋ BOOKS ────────────────────────────────────────────────────
head('⑤ FirstKey ＋ BOOKS：头一回那句提示、成绩页翻哪几本');

const firstLine = mainSrc.match(/type FirstKey =([^;]*);/);
say(!!firstLine, '尺子：main.ts 里有 `type FirstKey = …`');
const FIRST = firstLine ? [...firstLine[1].matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]) : [];
say(FIRST.length >= 5, `尺子：解析出 ${FIRST.length} 把钥匙`, FIRST.join('、'));

// 要 coach tip 的那几档是 tipFor 的 kind 联合——它和 FirstKey 是两张表，而
// firstTimeIn(kind) 收的是 FirstKey。漏一档这儿就是 build:xhs 编译不过。
const tipLine = mainSrc.match(/function tipFor\(\s*kind:([^,]*),/);
say(!!tipLine, '尺子：main.ts 里有 tipFor 的 kind 联合');
const TIP_KINDS = tipLine ? [...tipLine[1].matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]) : [];
say(TIP_KINDS.length >= 3, `尺子：解析出 ${TIP_KINDS.length} 档要摆提示的`, TIP_KINDS.join('、'));
for (const k of TIP_KINDS) {
  say(FIRST.includes(k), `tipFor 的 ${k} 在 FirstKey 里（否则 build:xhs 编译不过）`);
}
// 反过来不要求：FirstKey 里还有 endcard 这种不是玩法的钥匙。
note(`FirstKey 里不是玩法的那几把：${FIRST.filter((k) => !TIP_KINDS.includes(k) && !MODES.includes(k)).join('、') || '（没有）'}`);

// BOOKS 从 2026-10-08（方案 2-2）起不再手写：它是「这一端建了的每一副棋盘 × DAILY_MODE_KEYS」
// 两层循环拼出来的，dailyBest() 也翻同一组。手写那一版漏过两回，每回都是「那几局在成绩页上整片
// 不存在」：《步步为营》补进来时漏过一回（E20）；第 19 推的每日挑战开得出计时、计时炸弹两档，
// 还轮得到另外四副棋盘，又漏了一回——发笔记带的是上一局的分。
// 所以这儿量的不再是「八行字面量」，而是：循环真的是那两张表相乘、两张表该有的都有。
const listIn = (re, item) => {
  const m = mainSrc.match(re);
  return m ? [...m[1].matchAll(item)].map((x) => x[1]) : [];
};
const MODE_KEYS = listIn(/const DAILY_MODE_KEYS:[^=]*=\s*\[([^\]]*)\]/, /'(\w+)'/g);
say(MODE_KEYS.length >= 4, `尺子：解析出 DAILY_MODE_KEYS ${MODE_KEYS.length} 种`, MODE_KEYS.join('、'));
const ALL = listIn(/const ALL_GAMES:[^=]*=\s*\[([^\]]*)\]/, /(\w+)/g);
say(ALL.length >= 2, `尺子：解析出 ALL_GAMES ${ALL.length} 副`, ALL.join('、'));

say(/const BOOKS: Book\[\] = \[\];/.test(mainSrc), 'BOOKS 从空表起（不再有手写的那几本）');
say(
  /for \(const (\w+) of ALL_GAMES\)\s*\{?\s*for \(const (\w+) of DAILY_MODE_KEYS\)\s*\{?\s*BOOKS\.push\(\{\s*card:\s*\1\.card,\s*suffix:\s*suffixFor\(\2\)\s*\}\)/
    .test(mainSrc),
  'BOOKS 是 ALL_GAMES × DAILY_MODE_KEYS 两层循环拼的，后缀问 suffixFor 要',
);
const writes = mainSrc.match(/\bBOOKS\s*(?:\.(?:push|unshift|splice)\(|=[^=>])/g) || [];
say(writes.length === 1, '除了那一处 push，没有别处往 BOOKS 里塞东西、也没有别处给它重新赋值', `${writes.length} 处`);
// 后缀一律问 suffixFor 要，不许手写字面量——手写的那一版 2026-09 全错过一次。
say(!/suffix:\s*'/.test(mainSrc), 'main.ts 里没有手写的后缀字面量（一律走 suffixFor）');

// 存档后缀的全集是 runRecord.ts 的 ModeKey。少一种，那一种打完的局就不进成绩页。
const modeKeyLine = read('src/engine/runRecord.ts').match(/export type ModeKey =([^;]*);/);
const ALL_KEYS = modeKeyLine ? [...modeKeyLine[1].matchAll(/'(\w+)'/g)].map((m) => m[1]) : [];
say(ALL_KEYS.length >= 6, `尺子：解析出 ModeKey ${ALL_KEYS.length} 种`, ALL_KEYS.join('、'));
for (const mk of ALL_KEYS) {
  say(MODE_KEYS.includes(mk), `DAILY_MODE_KEYS 里有 ${mk}（这一种打完的局进得了成绩页）`);
}
// 主菜单上自己记一本的那几档也逐个点一遍名。老虎机借基础那本（它换的只是得分图案，和网页版
// 一致），所以 slot 不该是一种后缀。
for (const mk of ['base', 'bomb', 'flip', 'puzzle']) {
  say(MODE_KEYS.includes(mk), `主菜单的 ${mk} 那一档在 DAILY_MODE_KEYS 里`);
}
say(!MODE_KEYS.includes('slot'), 'DAILY_MODE_KEYS 里没有 slot（老虎机记在基础那本上，同网页版）');

// 这一端建了几副棋盘，ALL_GAMES 就要有几副——每日挑战轮得到的那四副打完的局也进成绩页。
const BUILT = [...mainSrc.matchAll(/^const (\w+Game) = create\w+Game\(\);/gm)].map((m) => m[1]);
say(BUILT.length >= 2, `尺子：main.ts 里建了 ${BUILT.length} 副棋盘`, BUILT.join('、'));
for (const g of BUILT) say(ALL.includes(g), `${g} 在 ALL_GAMES 里`);
note(`成绩页翻 ${ALL.length} × ${MODE_KEYS.length} = ${ALL.length * MODE_KEYS.length} 本存档`);

// dailyBest 不许自己再拼一遍键——两处各拼一遍，正是从前「每日最佳看得到、成绩页看不到」的来路。
const dbFrom = mainSrc.indexOf('function dailyBest(');
const dbBody = dbFrom < 0 ? '' : mainSrc.slice(dbFrom, mainSrc.indexOf('\n}\n', dbFrom));
say(dbBody.length > 0, '尺子：切出了 dailyBest 那一段');
say(/\bBOOKS\b/.test(dbBody) && !/suffixFor\(/.test(dbBody), 'dailyBest 翻的就是 BOOKS，没有自己再拼一遍键');

// ── ⑥ soon ＋ dim ──────────────────────────────────────────────────────────
head('⑥ soon ＋ dim：「进阶入口」牌子和头几局的压暗路标');

const BASIC = ['square', 'circle'];
const advLine = menuSrc.match(/export const XHS_ADVANCED_MODES[^;]*;/);
say(!!advLine, '尺子：menu.ts 里有 `export const XHS_ADVANCED_MODES`');
if (advLine) {
  // 关键不是「这张表里有 puzzle」，而是**它根本不是手写的**：手写的那一份
  // 2026-10 两处一起漏过。从 CARDS 里算，加卡就自动跟上。
  say(
    /CARDS\.map\(/.test(advLine[0]),
    'XHS_ADVANCED_MODES 是从 CARDS 算出来的，不是手写的一串 mode 名',
  );
  say(
    !/'(bomb|slot|flip|puzzle)'/.test(advLine[0]),
    '它里面没有点名任何一档玩法（点了名就会再漏一次）',
  );
  // 基础那两张要排除掉，而且**排除的是哪两张也不许手写第二遍**。
  const basicLine = menuSrc.match(/export const XHS_BASIC_MODES[^;]*;/);
  say(!!basicLine, '尺子：menu.ts 里有 `export const XHS_BASIC_MODES`');
  const parsedBasic = basicLine ? [...basicLine[0].matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]) : [];
  say(
    parsedBasic.length === BASIC.length && BASIC.every((b) => parsedBasic.includes(b)),
    `XHS_BASIC_MODES 就是 ${BASIC.join(' / ')}`,
    parsedBasic.join('、'),
  );
  say(
    /XHS_BASIC_MODES/.test(advLine[0]),
    '进阶那一份是「CARDS 减去 XHS_BASIC_MODES」，两处共用同一份基础名单',
  );
  // 算出来应该正好是这几档——这一条是算术尺子：表解析对了，名单才说得上对。
  const expect = CARD_MODES.filter((m) => !BASIC.includes(m));
  say(expect.length === CARD_MODES.length - BASIC.length, `算出来该有 ${expect.length} 档进阶`, expect.join('、'));
  say(expect.includes('puzzle'), '《步步为营》算在进阶里（会被压暗、会挂牌子）');
}

// main.ts 那两行要真的收它，不许再出现手写的数组。
const soonLine = mainSrc.match(/\n\s*soon: ([^\n]*),/);
const dimLine = mainSrc.match(/\n\s*dim: ([^\n]*),/);
say(!!soonLine && !!dimLine, '尺子：main.ts 里有 soon: … 和 dim: … 两行');
say(soonLine ? /XHS_ADVANCED_MODES/.test(soonLine[1]) : false, 'soon 收的是 XHS_ADVANCED_MODES', soonLine?.[1]);
say(dimLine ? /XHS_ADVANCED_MODES/.test(dimLine[1]) : false, 'dim 收的是 XHS_ADVANCED_MODES', dimLine?.[1]);
say(
  soonLine ? !/\['/.test(soonLine[1]) : false,
  'soon 那一行没有手写的数组字面量',
);
say(
  dimLine ? !/\['/.test(dimLine[1]) : false,
  'dim 那一行没有手写的数组字面量（空的 [] 不算，那是「路标撤掉」）',
  dimLine?.[1],
);
// dim 仍要看 basicsDone()：两副基础都打过之后压暗必须撤掉（玩家定的）。
say(dimLine ? /basicsDone\(\)/.test(dimLine[1]) : false, 'dim 仍然问 basicsDone()：头几局过后路标要撤');

// ── ⑦ check-vsweb 的 XHS_CARD ──────────────────────────────────────────────
head('⑦ check-vsweb 的 XHS_CARD：那道门按下标点卡');

const vswebSrc = read('xhs/check-vsweb.mjs');
const cardIdx = vswebSrc.match(/const XHS_CARD = \{([^}]*)\}/);
say(!!cardIdx, '尺子：check-vsweb.mjs 里有 `const XHS_CARD = { … }`');
const pairs = cardIdx ? [...cardIdx[1].matchAll(/(\w+):\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]) : [];
say(pairs.length >= 5, `尺子：解析出 ${pairs.length} 项`, pairs.map(([k, v]) => `${k}=${v}`).join('、'));
say(pairs.length === CARD_MODES.length, `项数（${pairs.length}）= CARDS 的卡数（${CARD_MODES.length}）`);
for (const [mode, idx] of pairs) {
  say(
    CARD_MODES[idx] === mode,
    `XHS_CARD.${mode} = ${idx}，CARDS 第 ${idx} 张正是 ${mode}`,
    CARD_MODES[idx] === mode ? '' : `CARDS 第 ${idx} 张是 ${CARD_MODES[idx] ?? '（没有）'}`,
  );
}

// ── ⑧ 清档两端都调 ─────────────────────────────────────────────────────────
head('⑧ 一次性清档：两端各调一次（决策 §6）');

say(/export function wipeOldRules\(/.test(wipeSrc), '尺子：engine/wipeOldRules.ts 导出了 wipeOldRules');
say(
  /bestKeys:\s*readonly string\[\]/.test(wipeSrc),
  '它收的是一组 bestKey（而不是自己 import 八副棋盘——那样搬了也还是只有网页端能用）',
);
say(!/everyGame/.test(wipeSrc), 'wipeOldRules.ts 里不提 everyGame（它不认识主菜单）');
say(/markWiped\(/.test(wipeSrc), '尺子：它写哨兵键（markWiped），所以不会每次开机重跑');

for (const [file, src] of [
  ['src/main.ts', webMainSrc],
  ['xhs/src/main.ts', mainSrc],
]) {
  say(/\bwipeOldRules\(\s*\[?/.test(src), `${file} 调了 wipeOldRules()`);
  say(
    /from '(\.\.\/)*(\.\.\/)?src\/engine\/wipeOldRules'|from '\.\/engine\/wipeOldRules'/.test(src) ||
      /wipeOldRules['"]/.test(src),
    `${file} 是 import 进来的，不是本地又抄了一份`,
  );
  say(
    !/function wipeOldRules\(/.test(src),
    `${file} 里没有第二份 wipeOldRules 实现`,
  );
}

// ── ⑧ 介绍页那句「开放几个玩法」要和 XhsMode 对得上 ───────────────────────
//
// 这一条是数出来的，不是抄的。它从前是漏的：`XhsMode` 补上《步步为营》之后，介绍页上那
// 句还写着「开放五个单机玩法」，而屏幕上不报任何错——只有玩家自己数一遍才知道。笔记正文
// （shareActions.ts 的 noteContent）会把同一类说法发到小红书上，传得比站内说明远得多，
// 所以这几处都值得钉住。
//
// 中文数字写法照代码里的来：现在是「六个」。哪天模式数再变，这一条会红在「数不对」上，
// 而改法是改那句话，不是改这一条。
{
  const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  const want = CN[MODES.length] ?? String(MODES.length);
  const profileSrc = read('xhs/src/profile.ts');
  const shareSrc = read('xhs/src/shareActions.ts');
  const readme = read('xhs/README.md');

  say(MODES.length >= 5 && MODES.length <= 10, `（尺子）数得出 XhsMode 有几个：${MODES.length}`);
  // 介绍页那一句：只认「开放<数字>个」这个形状，别被别处的数字骗了。
  const onProfile = /开放([零一二三四五六七八九十\d]+)个单机玩法/.exec(profileSrc);
  say(Boolean(onProfile), '（尺子）介绍页上找得到那句「开放 N 个单机玩法」');
  if (onProfile) {
    say(onProfile[1] === want, `介绍页写的是「${onProfile[1]}个」，XhsMode 是 ${MODES.length} 个（要「${want}个」）`);
  }
  // 那三处「特供」的旧口径：2026-10 之后天才不是买的了（E45/E46），这几处不许再写「特
  // 供」——那是在说一件已经不成立的事，而笔记正文那一处会发到站外。
  /*
   * ⚠️ **先把注释剥掉再查。** 这个仓库的注释里经常原样引着那句旧口径（「『Slides 天才特
   * 供』这个说法 2026-10 改了口径……」），照字面查会被自己的注释红一下——第一版就是这样。
   * 剥的是三种：HTML 注释（模板字符串里那种）、`/* *\/` 和整行 `//`。
   */
  const stripComments = (src) =>
    src
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
  for (const [name, src] of [['介绍页', profileSrc], ['笔记正文', shareSrc], ['README', readme]]) {
    const code = stripComments(src);
    say(!/天才特供/.test(code), `${name} 里没有「天才特供」这个旧口径`);
    // 尺子：剥注释没把整份剥空（不然上面那条永远绿）。
    say(code.trim().length > src.length / 4, `（尺子）${name} 剥掉注释之后还剩大半`);
  }
  // README 里那几处玩法数。
  say(!/五个玩法|五组开关/.test(readme), 'README 里没有「五个玩法 / 五组开关」这种旧数字');
}

// ── ⑧ 主菜单排布**冻结**（E20）────────────────────────────────────────────
//
// 玩家 2026-09-30 定的三条里的第一条：「小红书版主菜单排布**冻结**（主站排布改动不下
// 发）」。眼下它成立是因为这一端的主菜单是**自己一套**（xhs/src/menu.ts 的
// renderXhsMenu），而网页端那一页是 src/ui/menu.ts 的 renderMenu 加鱼眼轴。
//
// 但「成立」和「守得住」是两回事。网页端这一页 2026-09 一个月里改了十三轮（鱼眼轴），
// 2026-10 又整个换成两列（E18 / PR-21）。哪天有人图省事，把这一端接到 renderMenu 上
// ——「少维护一份」听起来总是对的——冻结就当场破了，而屏幕上不报任何错：这一端的菜单
// 会跟着主站一起变，玩家下次打开看到的是另一副样子。
//
// 所以这儿钉死：**xhs/src/ 里谁都不许 import 网页端那一页的排版件**。
{
  const LAYOUT = [
    { from: '../../src/ui/menu', what: '网页端主菜单（renderMenu）' },
    { from: '../../src/ui/modeAxis', what: '鱼眼轴（mountModeAxis）' },
    { from: '../../src/ui/modeStrip', what: '那条带子（mountModeStrip）' },
    { from: '../../src/ui/homeIcons', what: null }, // 图标是美术件，允许
  ];
  const srcDir = join(repo, 'xhs', 'src');
  const files = readdirSync(srcDir).filter((f) => f.endsWith('.ts'));
  say(files.length >= 10, `（尺子）xhs/src 下扫到 ${files.length} 个 .ts`);
  const bad = [];
  for (const f of files) {
    const code = readFileSync(join(srcDir, f), 'utf8');
    for (const l of LAYOUT) {
      if (!l.what) continue;
      // 只看 import 那一行，不看注释——menu.ts 开头正写着「为什么不复用网页版的
      // renderMenu」，照字面查会被这个仓库自己的注释红一下。
      const re = new RegExp(`^\\s*import[^;]*from\\s*['"]${l.from.replace(/\//g, '\\/')}['"]`, 'm');
      if (re.test(code)) bad.push(`${f} ← ${l.what}`);
    }
  }
  say(bad.length === 0, '主菜单排布冻结：xhs/src 里没人 import 网页端那一页的排版件', bad.join('；'));
  // 反面：这一端真的有自己那一份（上面那条不是因为「一个菜单都没有」才绿的）。
  const own = readFileSync(join(srcDir, 'menu.ts'), 'utf8');
  say(/export function renderXhsMenu/.test(own), '（尺子）这一端有自己的 renderXhsMenu');
  say(/class="home-row"|home-row/.test(own), '（尺子）排布也是自己摆的（menu.ts 里自己拼 .home-row）');
}

// ── ⑨ E20 冻结唯一的例外：最上面那一行《每日挑战》（第 19 推）────────────────
//
// 方案原话：「小红书：只在最上方加这一张、居中，其余排布一点不动；在决策文档记为 E20 的唯一例
// 外；冻结门改成『除第一行每日挑战外逐项一致』」。所以这一节量三件事：
//
//   · 它**不是一档 XhsMode**、不在 CARDS 里——放进 CARDS 的话，「窄屏两张一排、三排」那几条
//     冻结的排布当场被挤动（六张变七张，排成 2 + 2 + 2 + 1），上面 ①–③ 也会跟着乱；
//   · 它是 grid 里**第一个**被摆进去的那一行，而且那一行只有它一张；
//   · 那一行之后，CARDS 那几排照旧（上面 ③ 量的 perRow 和排数，正是「其余排布一点不动」）。
//
// 例外只有这一个：要是哪天第二张卡也这么塞进来，下面「grid 里在 CARDS 之前摆进去的只有这一
// 行」那一条会红。
head('⑨ E20 冻结唯一的例外：最上面那一行《每日挑战》');
{
  say(!MODES.includes('daily') && !CARD_MODES.includes('daily'), '每日挑战不是一档 XhsMode、不在 CARDS 里');
  const render = menuSrc.match(/export function renderXhsMenu[\s\S]*?\n\}/);
  say(!!render, '（尺子）切出了 renderXhsMenu 那一段');
  const body = render ? render[0] : '';
  const dailyAt = body.indexOf("'home-row xhs-daily-row'");
  const cardsAt = body.indexOf('for (let i = 0; i < CARDS.length; i += perRow)');
  say(dailyAt > 0 && cardsAt > 0, '（尺子）两段都找得到：每日挑战那一行、CARDS 那几排', `${dailyAt} / ${cardsAt}`);
  say(dailyAt > 0 && dailyAt < cardsAt, '每日挑战那一行在 CARDS 那几排**之前**摆进 grid（最上面）');
  const before = cardsAt > 0 ? body.slice(0, cardsAt) : '';
  const rowsBefore = (before.match(/grid\.appendChild\(/g) || []).length;
  say(rowsBefore === 1, 'CARDS 之前摆进 grid 的只有这一行（唯一的例外）', `${rowsBefore} 行`);
  const oneCard = before.match(/row\.appendChild\(/g) || [];
  say(oneCard.length === 1, '那一行里只有一张卡', `${oneCard.length} 张`);
  say(/home-icon-btn--daily/.test(before), '那张卡挂着 home-icon-btn--daily（门和样式都认它）');
  // 冻结门那一条（上面第 ⑧ 节）照旧：这一行用的是网页端的画图件（dailyArt），不是网页端的排版件。
  say(/from '\.\.\/\.\.\/src\/ui\/dailyArt'/.test(menuSrc), '图是网页端那一份（src/ui/dailyArt），不在这一端另画一份');
}

// ── 收尾 ───────────────────────────────────────────────────────────────────
console.log('');
if (fails) {
  console.log(`FAIL ${fails} 条`);
  process.exit(1);
}
console.log('ALL PASS');

/**
 * 带钟的玩法各多长：**生效的那个数**和**屏幕上写着的那些数**不许分家（10-31 方案推14 Z-B05 整份改写）。
 *
 *   npx esbuild src/i18n.ts --bundle --format=esm --outfile=/tmp/i18n.mjs
 *   npx esbuild src/rules.ts --bundle --format=esm --outfile=/tmp/rules.mjs
 *   node scripts/check-mode-clock.mjs /tmp/i18n.mjs /tmp/rules.mjs
 *
 * 起因是这件事本来就出过：《无限反转》从 120 秒改到 60 秒那一次，小红书那一份是**手抄**过去的（靠一句注释「和网页版
 * 同一个数」维持），于是落后过一版；而屏幕上那句「60s 挑战」和炸弹图标上那枚「90s」从来就是**手写的字**，和真正生效
 * 的秒数没有任何关系——改一头忘一头，屏幕上写着一个数、局里跑着另一个数，玩家没有任何办法发现自己读到的是假的。
 *
 * 2026-09 三个带钟的玩法统一成 100 秒（MODE_SECONDS）。10-31 方案推14 Z-B05（站长）拆开：计时挑战和定时炸弹按棋盘走——
 * **小球 60 秒、方块 100 秒**（TIMED_SECONDS / timedSecondsFor）；无限反转单独一个数，仍是 **100 秒**（FLIP_SECONDS）。
 * MODE_SECONDS 删了。
 *
 * ── 这道门自己写死那几个数 ─────────────────────────────────────
 *
 * 不从 modeClock.ts 读那几个数再拿去对别处——那样只证明「大家抄的是同一个数」，不证明「那个数是站长拍的那个」。
 *
 * ── 量四样 ─────────────────────────────────────────────────
 *
 * ① 常量：TIMED_SECONDS 正好是 { square: 100, circle: 60 }、FLIP_SECONDS === 100；源码里没有 MODE_SECONDS 了。
 * ② 源码里所有 timeLimitSec: 只许是 timedSecondsFor(…)、FLIP_SECONDS 或 undefined（opts 透传那一种照放）；网页、小红书
 *    都从 engine/modeClock 引 FLIP_SECONDS；seedDeal.ts 计时 / 定时炸弹两行用 timedSecondsFor(board)、反转那一行用
 *    FLIP_SECONDS；图标里没有画死的秒数。
 * ③ 文案：flipModeTagline、MODE_TIPS.flip 四语都含 100、不含 60；MODE_TIPS.timed 四语都含 {s}、不含任何数字；
 *    timedModeTagline 四语都同时含 60 和 100（字是写死的）。
 * ④ 规则书：《计时挑战》那一条四语都同时写着 60 和 100（和棋盘名在同一句），《无限反转》那一条含 100；炸弹那一条
 *    （「扣 100 分」）不在挑选之列。
 * 反面尺子：TIMED_SECONDS.circle 改成 100、MODE_TIPS.timed 换回「100s」那一句，各自要红。
 */
if (!process.argv[2] || !process.argv[3]) {
  console.error('用法: node scripts/check-mode-clock.mjs <打包好的 i18n.mjs> <打包好的 rules.mjs>');
  console.error('  npx esbuild src/i18n.ts  --bundle --format=esm --outfile=/tmp/i18n.mjs');
  console.error('  npx esbuild src/rules.ts --bundle --format=esm --outfile=/tmp/rules.mjs');
  process.exit(2);
}
const I = await import(process.argv[2]);
const R = await import(process.argv[3]);
const { readFileSync } = await import('node:fs');

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/** 站长 10-30 拍的数（Z-B05），这道门自己抄一份。 */
const WANT_TIMED = { square: 100, circle: 60 };
const WANT_FLIP = 100;
const LANGS = ['en', 'fr', 'zhHant', 'zhHans'];
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
/** 当数字用的 n（前后不是数字）。 */
const hasNum = (s, n) => new RegExp(`(?<!\\d)${n}(?!\\d)`).test(String(s));

// ---- ① 常量本身 --------------------------------------------------------
/** 读 modeClock.ts 的源码，回 { timed, flip, legacy }。反面尺子拿改过的源码喂同一个函数。 */
const readClock = (src) => {
  const t = src.match(/export const TIMED_SECONDS[^=]*=\s*Object\.freeze\(\{\s*square:\s*(\d+),\s*circle:\s*(\d+)\s*\}\)/);
  const f = src.match(/export const FLIP_SECONDS\s*=\s*(\d+);/);
  return {
    timed: t ? { square: Number(t[1]), circle: Number(t[2]) } : null,
    flip: f ? Number(f[1]) : null,
    legacy: /\bMODE_SECONDS\b/.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')),
  };
};
const clockOk = (c) => JSON.stringify(c.timed) === JSON.stringify(WANT_TIMED) && c.flip === WANT_FLIP && !c.legacy;
{
  const src = read('src/engine/modeClock.ts');
  const c = readClock(src);
  check('（尺子）modeClock.ts 里读得到 TIMED_SECONDS 和 FLIP_SECONDS', Boolean(c.timed) && c.flip !== null, JSON.stringify(c));
  check('① TIMED_SECONDS = { square: 100, circle: 60 }、FLIP_SECONDS = 100、代码里没有 MODE_SECONDS 了', clockOk(c), JSON.stringify(c));
  check('① timedSecondsFor 认不出的棋盘给 100（不会给 0）', /export const timedSecondsFor = \(shapeId: string\): number => TIMED_SECONDS\[shapeId\] \?\? 100;/.test(src));
  const mutated = src.replace(/circle:\s*60/, 'circle: 100');
  check('①（反面尺子）把 TIMED_SECONDS.circle 改成 100 要红', mutated !== src && !clockOk(readClock(mutated)));
}

// ---- ② 入口都从常量来，一个手写的秒数都没有 -------------------------------
{
  const files = ['src/main.ts', 'xhs/src/main.ts', 'src/engine/seedDeal.ts'];
  const bad = [];
  for (const f of files) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const mm of src.matchAll(/timeLimitSec:\s*([^,\n}]+)/g)) {
      const v = mm[1].trim();
      const ok = /^timedSecondsFor\([^)]*\)$/.test(v) || v === 'FLIP_SECONDS' || v === 'undefined' ||
        /^(tier === 'timed' \? timedSecondsFor\(\w+\) : undefined|flip \? FLIP_SECONDS : undefined)$/.test(v) || /^opts\??\.timeLimitSec$/.test(v);
      if (!ok) bad.push(`${f}: timeLimitSec: ${v}`);
    }
  }
  check('② 所有 timeLimitSec: 只许是 timedSecondsFor(…)、FLIP_SECONDS 或 undefined', bad.length === 0, bad.join(' · ') || files.join(' '));
  const web = read('src/main.ts');
  const xhs = read('xhs/src/main.ts');
  const deal = read('src/engine/seedDeal.ts');
  const IMPORT = /import \{[^}]*\bFLIP_SECONDS\b[^}]*\} from '(\.\/|\.\.\/\.\.\/src\/)engine\/modeClock';|import \{[^}]*\bFLIP_SECONDS\b[^}]*\} from '\.\/modeClock';/;
  check('② 网页、小红书、seedDeal 都从 engine/modeClock 引 FLIP_SECONDS（小红书从前是手抄的）',
    IMPORT.test(web) && IMPORT.test(xhs) && IMPORT.test(deal));
  check('②《计时挑战》按棋盘：showGame 那一句是 timedSecondsFor(game.card.id)', /timeLimitSec: timedSecondsFor\(game\.card\.id\)/.test(web));
  check('②《定时炸弹》那一档按棋盘', /tier === 'timed' \? timedSecondsFor\(id\)/.test(web));
  check('②《无限反转》网页、小红书都是 FLIP_SECONDS', /timeLimitSec: FLIP_SECONDS/.test(web) && /timeLimitSec: FLIP_SECONDS/.test(xhs));
  check('② seedDeal：计时、定时炸弹两行 timedSecondsFor(board)，反转那一行 FLIP_SECONDS',
    (deal.match(/timeLimitSec: timedSecondsFor\(board\)/g) || []).length === 2 && /flip: true, timeLimitSec: FLIP_SECONDS/.test(deal));
  // 图标里不许出现画死的秒数（第 18 推那一页换成棋盘图标 ＋ 三个字，徽记撤了；哪天谁再把秒数画回去，必须插值）。
  const painted = read('src/ui/homeIcons.ts').match(/>\s*\d+s\s*</);
  check('② 图标里没有画死的秒数', !painted, painted ? `画死了：${painted[0]}` : '');
}

// ---- ③ 四种语言的那几句 -------------------------------------------------
/** 回不合格的那几句（键名）。反面尺子拿改过的 MODE_TIPS 喂同一个函数。 */
const copyBad = (STRINGS, TIPS) => {
  const bad = [];
  for (const lang of LANGS) {
    const S = STRINGS[lang] ?? {};
    const T = TIPS[lang] ?? {};
    for (const [k, v] of [['flipModeTagline', S.flipModeTagline], ['MODE_TIPS.flip', T.flip]]) {
      if (!(typeof v === 'string' && hasNum(v, WANT_FLIP) && !hasNum(v, 60))) bad.push(`${lang}.${k}`);
    }
    if (!(typeof T.timed === 'string' && T.timed.includes('{s}') && !/\d/.test(T.timed))) bad.push(`${lang}.MODE_TIPS.timed`);
    const tag = S.timedModeTagline;
    if (!(typeof tag === 'string' && hasNum(tag, 60) && hasNum(tag, 100))) bad.push(`${lang}.timedModeTagline`);
  }
  return bad;
};
{
  const bad = copyBad(I.STRINGS, I.MODE_TIPS);
  check('（尺子）四种语言的那四句都读到了', LANGS.every((l) => I.STRINGS[l]?.timedModeTagline && I.STRINGS[l]?.flipModeTagline && I.MODE_TIPS[l]?.timed && I.MODE_TIPS[l]?.flip));
  check('③ 反转两句说 100 不说 60；计时那句用 {s} 不写数；计时标语同时写 60 和 100', bad.length === 0, bad.join(' · ') || '干净');
  const T2 = JSON.parse(JSON.stringify(I.MODE_TIPS));
  T2.en.timed = '100 seconds on the clock — how many points can you get?';
  check('③（反面尺子）MODE_TIPS.timed 换回「100 seconds」那一句要红', copyBad(I.STRINGS, T2).includes('en.MODE_TIPS.timed'));
}

// ---- ④ 规则书那两条 ----------------------------------------------------
{
  // 按词条名字挑（炸弹那一条写着「扣 100 分」，按「提到了时长」挑会把它误挑进来）。
  const TIMED = /^(计时挑战|計時挑戰|Timed modes|Modes chronométrés)$/;
  const FLIP = /^(无限反转|無限反轉|Endless flip|Retournement infini)$/;
  // 棋盘名（主菜单卡名）：计时那一句里 60 跟着小球、100 跟着方块，名字要在同一句。
  const NAME = { zhHans: ['经典小球', '经典方块'], zhHant: ['經典小球', '經典方塊'], en: ['Classic Balls', 'Classic Squares'], fr: ['Billes classiques', 'Carrés classiques'] };
  const bad = [];
  for (const lang of LANGS) {
    const items = [...(R.RULES[lang]?.general ?? []), ...(R.RULES[lang]?.modes ?? [])];
    const timed = items.find((it) => TIMED.test(it.term));
    const flip = items.find((it) => FLIP.test(it.term));
    if (!timed || !flip) { bad.push(`${lang}：找不到《计时挑战》或《无限反转》`); continue; }
    const first = timed.body.split(/(?<=[。.])\s*/)[0];
    if (!(hasNum(first, 60) && hasNum(first, 100) && NAME[lang].every((n) => first.includes(n)))) bad.push(`${lang}「${timed.term}」第一句：${first.slice(0, 50)}`);
    if (!hasNum(flip.body, WANT_FLIP)) bad.push(`${lang}「${flip.term}」没写 100`);
  }
  check('④ 规则书：《计时挑战》第一句写着「小球 60、方块 100」（和棋盘名同一句），《无限反转》写着 100', bad.length === 0, bad.slice(0, 4).join(' · ') || '四语都对');
}

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项没过`);
process.exit(fail ? 1 : 0);

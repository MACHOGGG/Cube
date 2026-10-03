/**
 * 三个带钟的玩法一个时长：**生效的那个数**和**屏幕上写着的那些数**不许分家。
 *
 *   npx esbuild src/i18n.ts --bundle --format=esm --outfile=/tmp/i18n.mjs
 *   npx esbuild src/rules.ts --bundle --format=esm --outfile=/tmp/rules.mjs
 *   node scripts/check-mode-clock.mjs /tmp/i18n.mjs /tmp/rules.mjs
 *
 * 起因是这件事本来就出过：《无限反转》从 120 秒改到 60 秒那一次，小红书那一份是
 * **手抄**过去的（靠一句注释「和网页版同一个数」维持），于是落后过一版；而屏幕上那
 * 句「60s 挑战」和炸弹图标上那枚「90s」从来就是**手写的字**，和真正生效的秒数没有
 * 任何关系——改一头忘一头，屏幕上写着一个数、局里跑着另一个数，玩家没有任何办法
 * 发现自己读到的是假的。玩家 2026-09 把三个统一成 100 秒之后，同一个走样有四个新
 * 地方可以发生（四种语言各一句），所以要有这道门。
 *
 * ── 这道门自己写死 100 ─────────────────────────────────────────
 *
 * 不从 modeClock.ts 读那个数再拿它去对别处——那样只证明「大家抄的是同一个数」，不
 * 证明「那个数是玩家拍的那个」。100 是《侵蚀阶梯》v1.3.1 §7 的字面值，这道门抄一
 * 份，两边对不上就是有一头错了，而这正是要问的。
 *
 * ── 量四样 ─────────────────────────────────────────────────
 *
 * ① 常量本身是 100。
 * ② 三个入口都从常量来，源码里一个手写的 `timeLimitSec: <数字>` 都不许有
 *    （网页端三处 + 小红书端一处）。
 * ③ 四种语言 × 四句给玩家看的话（计时标语、反转标语、局中那两条教学）都说 100，
 *    而且**一句都不许还留着 60 / 90**。反面尺子在同一处：这十六句必须真的被读到、
 *    真的非空、真的含数字——键名改了名字就该当场红，而不是空绿。
 * ④ 规则书里《计时挑战》和《无限反转》那两条，四种语言都说 100、不说 60/90。
 */
// 缺参数时说一句人话再退场。不加这一句的话 node 抛的是
// `Cannot find package 'undefined'`——手跑的人第一反应是「这道门坏了」，而不是
// 「我忘了先 esbuild」。
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

/** 《侵蚀阶梯》v1.3.1 §7 的字面值，这道门自己抄一份。 */
const WANT = 100;
const LANGS = ['en', 'fr', 'zhHant', 'zhHans'];
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// ---- ① 常量本身 --------------------------------------------------------
{
  const src = read('src/engine/modeClock.ts');
  const m = src.match(/export const MODE_SECONDS\s*=\s*(\d+)/);
  check('engine/modeClock.ts 里读得到 MODE_SECONDS（尺子）', Boolean(m), m ? m[1] : '（找不到）');
  check(`MODE_SECONDS = ${WANT}`, Boolean(m) && Number(m[1]) === WANT, m ? m[1] : '');
}

// ---- ② 三个入口都从常量来，一个手写的秒数都没有 -------------------------
{
  const web = read('src/main.ts');
  const xhs = read('xhs/src/main.ts');
  // 手写的数字：`timeLimitSec: 60` / `? 90 :` 这一类。只认字面数字，认不到常量。
  const literal = [];
  for (const [name, src] of [['src/main.ts', web], ['xhs/src/main.ts', xhs]]) {
    for (const mm of src.matchAll(/timeLimitSec:\s*([^,\n]+)/g)) {
      const v = mm[1].trim();
      if (/\d/.test(v) && !v.includes('MODE_SECONDS')) literal.push(`${name}: timeLimitSec: ${v}`);
    }
  }
  check('没有哪一处的 timeLimitSec 是手写的数字', literal.length === 0, literal.join(' · '));
  // 正面：三个入口确实都点到了那个常量。少一个就是又有人回去手写了。
  check('《计时挑战》走常量', /timeLimitSec: MODE_SECONDS/.test(web));
  check('《定时炸弹》那一档走常量', /tier === 'timed' \? MODE_SECONDS/.test(web));
  check('《无限反转》走常量（网页）', /FLIP_SECONDS = MODE_SECONDS/.test(web));
  check('《无限反转》走常量（小红书，从前是手抄的）', /FLIP_SECONDS = MODE_SECONDS/.test(xhs));
  // 炸弹那一页从前在定时那两枚上印着「100s」（PR-20），这一条量的是「那个数是插值进去的，
  // 不是画死的」。第 18 推那一页换成棋盘图标 ＋ 左边三个字（「计时」），徽记撤了，不再印秒
  // 数。剩下的那半照旧守着：图标里不许出现画死的秒数——哪天谁再把秒数画回图标上，必须插值
  // MODE_SECONDS，写死一个数这一条就红。
  const icons = read('src/ui/homeIcons.ts');
  const painted = icons.match(/>\s*\d+s\s*</);
  check('图标里没有画死的秒数（要印就插值 MODE_SECONDS）', !painted,
    painted ? `画死了：${painted[0]}` : '');
}

// ---- ③ 四种语言 × 四句给玩家看的话 --------------------------------------
{
  const lines = [];
  for (const lang of LANGS) {
    const S = I.STRINGS[lang];
    const T = I.MODE_TIPS[lang];
    lines.push([`${lang}.timedModeTagline`, S?.timedModeTagline]);
    lines.push([`${lang}.flipModeTagline`, S?.flipModeTagline]);
    lines.push([`${lang}.MODE_TIPS.timed`, T?.timed]);
    lines.push([`${lang}.MODE_TIPS.flip`, T?.flip]);
  }
  // 反面尺子，三条：十六句一句不少、一句不空、一句都含数字。键名改了名字就在这儿红。
  check('十六句都读到了（4 语 × 4 句）', lines.length === 16, String(lines.length));
  const empty = lines.filter(([, v]) => typeof v !== 'string' || !v.trim()).map(([k]) => k);
  check('十六句一句都不空（尺子：键名改了这儿就红）', empty.length === 0, empty.join(' · '));
  const noDigit = lines.filter(([, v]) => typeof v === 'string' && !/\d/.test(v)).map(([k]) => k);
  check('十六句里都真的有数字（尺子：不然下面两条是恒真的）', noDigit.length === 0, noDigit.join(' · '));

  const wrong = lines.filter(([, v]) => typeof v === 'string' && !v.includes(String(WANT))).map(([k]) => k);
  check(`十六句都说 ${WANT}`, wrong.length === 0, wrong.join(' · '));
  // 「还留着旧数」要看**当数字用的** 60 / 90，别被别处的 60 误伤，所以带着词界看。
  const stale = lines
    .filter(([, v]) => typeof v === 'string' && /(?<!\d)(60|90)(?!\d)/.test(v))
    .map(([k, v]) => `${k}「${v.slice(0, 24)}…」`);
  check('十六句里一句都没留着 60 / 90', stale.length === 0, stale.join(' · '));
}

// ---- ④ 规则书那两条 ----------------------------------------------------
{
  const bad = [];
  for (const lang of LANGS) {
    const book = R.RULES[lang];
    const items = [...(book?.general ?? []), ...(book?.modes ?? [])];
    // 按「哪一条里提到了时长」找，不按词条名字找——四种语言的词条名字各不相同，
    // 而且改过名。只要是讲这两个玩法的那两条，里头必须写着 100。
    const clocked = items.filter((it) => /(?<!\d)(60|90|100)(?!\d)/.test(it.body ?? ''));
    if (clocked.length < 2) bad.push(`${lang}：只找到 ${clocked.length} 条提到时长的（该有两条：计时、无限反转）`);
    for (const it of clocked) {
      if (/(?<!\d)(60|90)(?!\d)/.test(it.body)) bad.push(`${lang}「${it.term}」还写着 60/90`);
      if (!it.body.includes(String(WANT))) bad.push(`${lang}「${it.term}」没写 ${WANT}`);
    }
  }
  check(`规则书：四种语言里讲时长的那两条都说 ${WANT}`, bad.length === 0, bad.slice(0, 4).join(' · '));
}

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项没过`);
process.exit(fail ? 1 : 0);

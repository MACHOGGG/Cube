/**
 * 种子码（第 19 推）：编码、校验、每日轮换，和服务器那一份抄本对得上。
 *
 *   npx esbuild src/engine/seedCode.ts --bundle --format=esm --outfile=/tmp/seedcode.mjs
 *   npx esbuild src/engine/rng.ts --bundle --format=esm --outfile=/tmp/rng.mjs
 *   node scripts/check-seed-code.mjs /tmp/seedcode.mjs /tmp/rng.mjs
 *
 * 纯逻辑，不开浏览器（「同一个种子在每副棋盘上发出同一副牌」要真的发牌，在
 * check-seed-deal.mjs 里量）。守的是：
 *
 *   ① 编码再解码还原：版本、玩法编号、随机数一位不差；显示成 XXXX-XXXX；大小写不敏感，
 *      O 当 0、I 和 L 当 1，横杠和空格不算。
 *   ② 校验位拦得住输错：**任意一个字符抄错一律拦下**（逐位逐字符穷举），相邻两个字符抄反
 *      拦下的比例照实印出来（CRC-5 理论上是 31/32）。
 *   ③ 版本对不上说「已过期」（version），不是悄悄当成另一副牌。
 *   ④ 编号表只增不改：前二十行一行都不许变（下标写在每一串已经发出去的码里）。
 *   ⑤ 每日轮换：二十个编号一个不少一个不重；挨着的两天不是同一个玩法（炸弹三档算一个）、
 *      不是同一族棋盘。
 *   ⑥ 北京时间：UTC 16:00（北京零点）那一毫秒换日，早一毫秒不换；日期键 YYYYMMDD 对。
 *   ⑦ **服务器那一份（api/_seedcode.js）和这边一个数都不差**：前后八百天的每日种子码、日
 *      期键、编码、校验——走散了的后果是那一天每一局都被服务器当成「伪造的每日」拒掉，今日
 *      榜上一个人都没有，而屏幕上不报任何错。
 *   ⑧ 编号表和玩法判定两份一行对一行（服务器拿它核对「是不是那一天的那个玩法」）。
 *   ⑨ 连着七天，星期几和真的日历对得上（主菜单那张卡按星期几换底图）。
 *   ⑩ 客户端的 xmur3 只有 rng.ts 那一份（seedCode.ts 从那儿 import），而且它和种流一个数都
 *      没变：几串字符串的哈希、一串码开头六个数写死在这儿（10-08 方案第五批第 6 条）。
 */
const lib = process.argv[2];
const rngLib = process.argv[3];
if (!lib || !rngLib) {
  console.error('用法: node scripts/check-seed-code.mjs /tmp/seedcode.mjs /tmp/rng.mjs');
  process.exit(2);
}
const C = await import(lib);
const R = await import(rngLib);
const S = await import(new URL('../api/_seedcode.js', import.meta.url));

let fail = 0;
let pass = 0;
const check = (name, ok, extra = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
// 一个确定的伪随机数（不用 Math.random：门要每次跑出同一批样本）。
let st = 20261003;
const rnd = () => ((st = (Math.imul(st ^ (st >>> 15), 2246822507) + 0x6d2b79f5) >>> 0) / 4294967296);

// ── ① 编码再解码 ──
{
  let bad = 0;
  let shown = '';
  for (let i = 0; i < 2000; i++) {
    const variant = Math.floor(rnd() * C.VARIANTS.length);
    const rand = Math.floor(rnd() * 2 ** 27);
    const code = C.encodeSeed(C.DEAL_VERSION, variant, rand);
    const d = C.decodeSeed(code);
    if (!(code.length === 8 && d.ok && d.variant === variant && d.rand === rand && d.version === C.DEAL_VERSION)) {
      bad++;
      shown = shown || `${variant}/${rand} → ${code} → ${JSON.stringify(d)}`;
    }
  }
  check('① 两千串码编码再解码，版本、玩法、随机数一位不差', bad === 0, shown);
  const code = C.encodeSeed(C.DEAL_VERSION, 7, 123456);
  check('① 显示成 XXXX-XXXX', /^[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(C.formatSeed(code)), C.formatSeed(code));
  const sloppy = C.formatSeed(code).toLowerCase().replace(/0/g, 'o').replace(/1/g, 'l');
  check('① 小写、O 当 0、L 当 1、带横杠，照样认得', C.decodeSeed(sloppy).ok && C.decodeSeed(sloppy).code === code, `${sloppy} → ${JSON.stringify(C.decodeSeed(sloppy))}`);
  check('① 中间夹空格也认得', C.decodeSeed(code.slice(0, 4) + ' ' + code.slice(4)).ok);
  check('① 七位、九位、带 U 的都不认（format）',
    C.decodeSeed(code.slice(0, 7)).reason === 'format' && C.decodeSeed(code + '0').reason === 'format' && C.decodeSeed('U' + code.slice(1)).reason === 'format');
  check('① 规范写法是大写八位、没有横杠', C.normalizeSeed(' ' + C.formatSeed(code).toLowerCase() + ' ') === code);
}

// ── ② 校验位 ──
{
  let missed = 0;
  let tried = 0;
  let example = '';
  for (let k = 0; k < 60; k++) {
    const code = C.encodeSeed(C.DEAL_VERSION, Math.floor(rnd() * 20), Math.floor(rnd() * 2 ** 27));
    for (let pos = 0; pos < 8; pos++) {
      for (const ch of ALPHABET) {
        if (ch === code[pos]) continue;
        const typo = code.slice(0, pos) + ch + code.slice(pos + 1);
        tried++;
        if (C.decodeSeed(typo).ok) {
          missed++;
          example = example || `${code} → ${typo}`;
        }
      }
    }
  }
  check(`② 任意一个字符抄错一律拦下（${tried} 种抄错法逐个试）`, missed === 0, example);
  let swaps = 0;
  let caught = 0;
  for (let k = 0; k < 400; k++) {
    const code = C.encodeSeed(C.DEAL_VERSION, Math.floor(rnd() * 20), Math.floor(rnd() * 2 ** 27));
    for (let pos = 0; pos < 7; pos++) {
      if (code[pos] === code[pos + 1]) continue;
      const typo = code.slice(0, pos) + code[pos + 1] + code[pos] + code.slice(pos + 2);
      swaps++;
      if (!C.decodeSeed(typo).ok) caught++;
    }
  }
  check('② 相邻两个字符抄反，拦下九成以上', caught / swaps > 0.9, `${caught}/${swaps} ＝ ${((caught / swaps) * 100).toFixed(1)}%`);
}

// ── ③ 版本 ──
{
  // 旧版本（比现在小）说「已过期」；新版本（比现在大，还没更新的客户端拿到新码）说「要新版本」
  // ——两样都不当成一副牌开出来。DEAL_VERSION 现在是 1，所以「旧」那一档拿 0。
  const old = C.encodeSeed(C.DEAL_VERSION - 1, 3, 99);
  check('③ 旧发牌版本发的码：说「已过期」，不当成一副牌', C.decodeSeed(old).reason === 'version', JSON.stringify(C.decodeSeed(old)));
  const newer = C.encodeSeed(C.DEAL_VERSION + 1, 3, 99);
  check('③ 新发牌版本发的码：说「要新版本」，不说过期、也不开', C.decodeSeed(newer).reason === 'newer', JSON.stringify(C.decodeSeed(newer)));
  const future = C.encodeSeed(C.DEAL_VERSION, 31, 99);
  check('③ 编号表里没有的那一行：认不出（variant），不乱开一局', C.decodeSeed(future).reason === 'variant', JSON.stringify(C.decodeSeed(future)));
}

// ── ④ 编号表只增不改 ──
{
  const PINNED = [
    'base/square', 'base/circle', 'base/squareDiamond', 'base/circleHex', 'base/circleSeven', 'base/triangleBig',
    'timed/square', 'timed/circle', 'bomb/square', 'bomb/circle', 'bombTimed/square', 'bombTimed/circle',
    'bombAdv/squareDiamond', 'bombAdv/circleHex', 'slot/square', 'slot/circle', 'flip/square', 'flip/circle',
    'puzzle/square', 'puzzle/circle',
  ];
  const now = C.VARIANTS.map((v) => `${v.mode}/${v.board}`);
  const changed = PINNED.map((p, i) => (now[i] === p ? null : `${i}: ${p} → ${now[i]}`)).filter(Boolean);
  check('④ 前二十行一行都没变（只增不改）', changed.length === 0, changed.join(' / '));
  check('④ 每一行都不重复', new Set(now).size === now.length);
  check('④ 最多 32 行（编号只有 5 位）', now.length <= 32, String(now.length));
  check('④ 服务器那份知道的行数和这边一样', S.VARIANT_COUNT === now.length, `${S.VARIANT_COUNT} / ${now.length}`);
}

// ── ⑤ 每日轮换 ──
{
  const R = C.DAILY_ROTATION;
  const sorted = [...R].sort((a, b) => a - b);
  check('⑤ 每一个玩法编号都在轮换里，一个不少一个不重',
    R.length === C.VARIANTS.length && sorted.every((v, i) => v === i), R.join(','));
  const group = (m) => (m.startsWith('bomb') ? 'bomb' : m);
  const fam = (b) => (b === 'square' || b === 'squareDiamond' ? 'square' : b.startsWith('circle') ? 'circle' : 'triangle');
  const clash = [];
  for (let i = 0; i < R.length; i++) {
    const a = C.VARIANTS[R[i]];
    const b = C.VARIANTS[R[(i + 1) % R.length]];
    if (group(a.mode) === group(b.mode)) clash.push(`第 ${i} 天和第 ${i + 1} 天都是 ${a.mode}/${b.mode}`);
    if (fam(a.board) === fam(b.board)) clash.push(`第 ${i} 天和第 ${i + 1} 天都是 ${fam(a.board)} 一族`);
  }
  check('⑤ 挨着的两天不是同一个玩法、不是同一族棋盘（首尾也接得上）', clash.length === 0, clash.slice(0, 3).join(' / '));
  check('⑤ 服务器那份的轮换和这边一字不差', JSON.stringify(S.DAILY_ROTATION) === JSON.stringify([...R]));
}

// ── ⑥ 北京时间 ──
{
  const midnight = Date.UTC(2026, 9, 2, 16, 0, 0); // 北京 2026-10-03 00:00:00
  const before = C.dayIndexOf(midnight - 1);
  const after = C.dayIndexOf(midnight);
  check('⑥ 北京零点那一毫秒换日，早一毫秒不换', after === before + 1, `${before} → ${after}`);
  check('⑥ 那一天的日期键是 20261003，前一毫秒是 20261002', C.dayKey(after) === '20261003' && C.dayKey(before) === '20261002', `${C.dayKey(before)} / ${C.dayKey(after)}`);
  check('⑥ 那一天北京零点的时间戳算得回来', C.dayStartOf(after) === midnight);
  const bd = C.beijingDate(after);
  check('⑥ 2026-10-03 是星期六', bd.weekday === 6, JSON.stringify(bd));
  check('⑥ 日期键反算回第几天；不是真日期的键认不出', C.dayIndexOfKey('20261003') === after && C.dayIndexOfKey('20261332') === null && C.dayIndexOfKey('2026103') === null);
  check('⑥ 同一天里种子码一样，换日就换', C.dailySeed(after) === C.dailySeed(C.dayIndexOf(midnight + 86_399_999)) && C.dailySeed(after) !== C.dailySeed(before));
}

// ── ⑦ 两份抄本一个数都不差 ──
{
  const base = C.dayIndexOf(Date.UTC(2026, 9, 3));
  const diff = [];
  for (let d = base - 400; d <= base + 400; d++) {
    if (C.dailySeed(d) !== S.dailySeed(d)) diff.push(`第 ${d} 天种子 ${C.dailySeed(d)} / ${S.dailySeed(d)}`);
    if (C.dayKey(d) !== S.dayKey(d)) diff.push(`第 ${d} 天日期 ${C.dayKey(d)} / ${S.dayKey(d)}`);
    if (S.dayIndexOfKey(C.dayKey(d)) !== d) diff.push(`第 ${d} 天日期键反算 ${S.dayIndexOfKey(C.dayKey(d))}`);
  }
  check('⑦ 前后八百天的每日种子码和日期键，两份一个不差', diff.length === 0, diff.slice(0, 3).join(' / '));
  let enc = 0;
  for (let i = 0; i < 2000; i++) {
    const v = Math.floor(rnd() * 32);
    const r = Math.floor(rnd() * 2 ** 27);
    const ver = Math.floor(rnd() * 8);
    if (C.encodeSeed(ver, v, r) !== S.encodeSeed(ver, v, r)) enc++;
    const code = C.encodeSeed(ver, v, r);
    if (C.normalizeSeed(code.toLowerCase()) !== S.normalizeSeed(code.toLowerCase())) enc++;
  }
  check('⑦ 两千串码的编码和规范化，两份一个不差', enc === 0, String(enc));
  check('⑦ 两份的 hash32 对得上', C.hash32('daily:20729') === S.hash32('daily:20729') && C.hash32('') === S.hash32(''));
  check('⑦ 两份的北京日', C.dayIndexOf(1759507200000) === S.dayIndexOf(1759507200000));
}

// ── ⑧ 编号表和玩法判定：服务器那一份一行对一行 ──
//
// 服务器拿它核对「这一局是不是那一天的那个玩法」（api/scores.js 的 pushDaily）。两份走散了，
// 那一天的每一局都会被当成「玩法不对」拒掉——今日榜上一个人都没有，屏幕上什么都不报。
{
  check('⑧ 尺子：服务器那一份编号表有二十行', S.VARIANTS.length === C.VARIANTS.length && S.VARIANTS.length === 20, String(S.VARIANTS.length));
  const rows = C.VARIANTS.map((v, i) => [v, S.VARIANTS[i]]).filter(([a, b]) => !b || a.mode !== b.mode || a.board !== b.board);
  check('⑧ 编号表两份一行对一行（玩法、棋盘、次序）', rows.length === 0, rows.map(([a, b]) => `${a.mode}/${a.board} ≠ ${b?.mode}/${b?.board}`).join('；'));
  // 玩法判定：客户端 variantForGame 倒推回来的那一行，和服务器 seedModeOf 认的那个玩法是同一个。
  const KEY = { base: 'base', timed: 'timed', bomb: 'bomb', bombTimed: 'bombTimed', bombAdv: 'bomb', slot: 'base', flip: 'flip', puzzle: 'puzzle' };
  const bad = [];
  C.VARIANTS.forEach((v, i) => {
    const mk = KEY[v.mode];
    const slot = v.mode === 'slot';
    if (C.variantForGame(mk, v.board, slot) !== i) bad.push(`客户端 ${v.mode}/${v.board} → ${C.variantForGame(mk, v.board, slot)}`);
    if (S.seedModeOf(mk, v.board, slot) !== v.mode) bad.push(`服务器 ${v.mode}/${v.board} → ${S.seedModeOf(mk, v.board, slot)}`);
  });
  check('⑧ 二十行每一行：客户端倒推回自己那一行、服务器认出同一个玩法', bad.length === 0, bad.join('；'));
  check('⑧ 两份的北京零点', C.dayStartOf(20730) === S.dayStartOf(20730));
}

// ── ⑨ 七天：星期几对得上真的日历 ──
//
// 主菜单那张卡按星期几换底图（daily-1 … daily-7，1 ＝ 周一），按北京日期压数字。这儿拿 JS 自
// 己的日历（UTC+8 那一刻的 getUTCDay）对一整周——beijingDate 自己算的星期错开一天，周六那张
// 奶白就会摆在周日。配色本身（哪一天哪个颜色、奶白那天字是深灰）在 check-daily.mjs 里开浏览器量。
{
  const start = C.dayIndexOf(Date.UTC(2026, 9, 5, 4)); // 北京 2026-10-05（周一）中午
  const seen = [];
  let off = 0;
  for (let k = 0; k < 7; k++) {
    const d = start + k;
    const noon = C.dayStartOf(d) + 12 * 3600e3;
    const js = new Date(noon + 8 * 3600e3).getUTCDay(); // 0 ＝ 周日
    const want = js === 0 ? 7 : js;
    const bd = C.beijingDate(d);
    seen.push(bd.weekday);
    if (bd.weekday !== want) off++;
    if (`${bd.y}${String(bd.m).padStart(2, '0')}${String(bd.d).padStart(2, '0')}` !== C.dayKey(d)) off++;
  }
  check('⑨ 连着七天：星期一到星期日各一次、和日历对得上，年月日和日期键一致', off === 0 && seen.join('') === '1234567', seen.join(','));
}

// ── ⑩ 客户端只有一份 xmur3，而且它没变（10-08 方案第五批第 6 条）──
//
// rng.ts（拿码发牌的那条流）和 seedCode.ts（每日挑战、小屋换算成码）从前各抄了一份一字不差的
// xmur3。合成一份之后守两件事：
//   · 不许再长回第二份：src/、xhs/src/、wxgame/src/ 里认得出 xmur3 起始常数的只有 rng.ts，
//     seedCode.ts 的 hash32 是从 rng.ts import 来的。两份今天一样，可哪天只改了一份，「换算成
//     码」和「拿码发牌」两头就各算各的——分享卡上那串码输进去，发出来的不是那一副牌。
//   · 它没变：几串字符串的哈希、2026-10-03 那天每日挑战（5DG9-G1PQ）那条流开头六个数，写死在
//     这儿。这个函数（或者 mulberry32）一变，每一串已经发出去的码都会发出另一副牌，而 ⑦ 拦不
//     住（两份一起改，两份照样对得上）。真要改，先加 DEAL_VERSION，再回来改这几个数。
{
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const { join, relative } = await import('node:path');
  const root = new URL('..', import.meta.url).pathname;
  const walk = (dir) => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|js|mjs)$/.test(f) ? [p] : [];
  });
  const files = ['src', 'xhs/src', 'wxgame/src'].flatMap((d) => walk(join(root, d)));
  const holders = files.filter((f) => readFileSync(f, 'utf8').includes('1779033703')).map((f) => relative(root, f));
  check('⑩ 尺子：扫到了 src/ 底下的 rng.ts 和 seedCode.ts', files.some((f) => f.endsWith('src/engine/rng.ts')) && files.some((f) => f.endsWith('src/engine/seedCode.ts')),
    `${files.length} 个文件`);
  check('⑩ 客户端认得出 xmur3 的只有 rng.ts 一处', holders.length === 1 && holders[0] === 'src/engine/rng.ts', holders.join(' / ') || '一处都没有');
  const sc = readFileSync(join(root, 'src/engine/seedCode.ts'), 'utf8');
  check('⑩ seedCode.ts 的 hash32 是从 rng.ts import 来的', /import \{[^}]*\bhash32\b[^}]*\} from '\.\/rng';/.test(sc) && !/function hash32\(/.test(sc));
  check('⑩ 两头拿到的是同一个函数（seedCode 导出的 hash32 和 rng 的一个数不差）',
    ['s1:5DG9G1PQ', 'daily:20729', 'room:abc', ''].every((x) => C.hash32(x) === R.hash32(x)));
  const HASH = { 's1:5DG9G1PQ': 918439689, 'daily:20729': 453296182, 'room:abc': 3221750265, '': 167010153 };
  const off = Object.entries(HASH).filter(([k, v]) => R.hash32(k) !== v).map(([k, v]) => `${JSON.stringify(k)} → ${R.hash32(k)}（该是 ${v}）`);
  check('⑩ 四串字符串的哈希和写死的一样', off.length === 0, off.join('；'));
  check('⑩ 尺子：2026-10-03 的每日挑战确实是 5DG9-G1PQ（下面那条流就是那一天的牌）',
    C.dailySeed(20729) === '5DG9G1PQ' && C.dealSeed('5DG9G1PQ') === 's1:5DG9G1PQ', C.dailySeed(20729));
  R.seedRandom('s1:5DG9G1PQ');
  const got = Array.from({ length: 6 }, () => R.random() * 4294967296);
  R.clearSeed();
  const want = [3680136716, 1239740699, 762293618, 3811813699, 2929528798, 1407185242];
  check('⑩ 那条流开头六个数和写死的一样（同一串码，还是同一副牌）', got.every((x, i) => x === want[i]), got.join(','));
  // 反向对照：换一串码，流就不一样——不然「一样」可能只是「怎么种都一样」
  R.seedRandom('s1:5DG9G1PR');
  const other = R.random() * 4294967296;
  R.clearSeed();
  check('⑩ 尺子：换一串码，开头那个数就不一样', other !== want[0], String(other));
}

console.log(`\n${pass} 条通过，${fail} 条没过`);
process.exit(fail ? 1 : 0);

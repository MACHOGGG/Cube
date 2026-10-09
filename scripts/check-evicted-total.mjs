/**
 * 打到第 41 局，累计得分不许往下掉。
 *
 *   npx esbuild src/engine/persistence.ts --bundle --format=esm --platform=neutral \
 *     --outfile=/tmp/persist.mjs
 *   node scripts/check-evicted-total.mjs /tmp/persist.mjs
 *
 * 纯 node：`persistence.ts` 只碰 localStorage，拿一个 Map 当它就行。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么
 *
 * 累计得分是**存档这张清单的总和**（`ui/recordsPage.ts` 的 `totalScoreOf(runs)`），而存档
 * 只留最近 MAX_ARCHIVE（40）局。于是打到第 41 局那一下，最早那一局被挤出去，而他的累计得
 * 分**当场往下掉**——掉的正好是那一局的分。
 *
 * 屏幕上不报错，只是那个数变小了，而玩家一直盯着它：这是「意料之外」里最伤的一种，因为它
 * 看起来像我们把他的成绩弄丢了。而且越往后越明显：打到 80 局时，前 40 局的分全都不见了。
 *
 * 修法是一笔只加不减的总账（`EVICTED_SUFFIX`），读的时候加回去。这一台量三件事：
 *
 *   ① 一局一局打下去，「清单的和 ＋ 那一笔」永远等于**真的打了多少分**，一分不少；
 *   ② 那个数**从头到尾只涨不跌**（这是玩家看得见的那一条）；
 *   ③ `dropKey`（换规则版本清档）要把那一笔一起删掉——漏了它，清完档累计得分还挂着上一版
 *      的分，而记录页上一局都看不到，那个数于是无从对账。
 *
 * ── 10-09 补充方案 7-2（审计 #2，实测 500 → 600 → 700 → 800）──────────────────────
 *
 * 云上留 60 局、本机留 40 局。每次从云上并战绩，云上那 60 局里比本机清单旧的那 20 局本机找不到，于是补进
 * 来、随即又被挤出去——挤一次记一笔，同一局每并一次就多算一遍。修法是水位线 `::evictedAt`（已经记进账的
 * 最新一局的 at），只给比它新的挤出局记账。这一台另量：
 *
 *   ⑥ 打了 50 局的设备，和同一份 60 局的云端连并三次：累计得分一分不变；
 *   ⑦ 新设备并那 60 局：屏幕上是 60 局之和，再并两次不再变；
 *   ⑧ dropKey 之后 `::evicted`、`::evictedAt` 两个键都不在；
 *   ⑨ 水位线之前就记过账的老设备（有账、没水位线）：上线后头一次并云端，不再多记那 20 局。
 */
const bundle = process.argv[2];
if (!bundle) {
  console.error('用法：node scripts/check-evicted-total.mjs <打好的 persistence.mjs>');
  process.exit(2);
}

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// 一个够用的 localStorage：这份模块只用 getItem / setItem / removeItem。
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
};

const { saveRun, loadRuns, loadAllRuns, totalScoreOf, evictedScoreOf, dropKey, mergeRuns } = await import(bundle);

const KEY = 'sugarcube_best_ero1';
/** 第 i 局：分数照 i 走，这样「一共多少分」一眼算得出来。 */
const runOf = (i) => ({
  at: 1_700_000_000_000 + i * 1000,
  start: null,
  end: null,
  data: { shapeId: 'square', modeKey: 'base', totalScore: 100 + i, rules: 'ero1' },
});

// ---- ①② 打 60 局，一路盯着那个数 ---------------------------------------
{
  let 真的打了 = 0;
  let 上一次看到的 = 0;
  let 掉过 = null;
  let 对不上 = null;
  let 清单最长 = 0;
  for (let i = 1; i <= 60; i++) {
    saveRun(KEY, runOf(i));
    真的打了 += 100 + i;
    const runs = loadAllRuns([KEY]);
    清单最长 = Math.max(清单最长, runs.length);
    const 屏幕上 = totalScoreOf(runs) + evictedScoreOf([KEY]);
    if (屏幕上 < 上一次看到的 && !掉过) 掉过 = `第 ${i} 局之后从 ${上一次看到的} 掉到 ${屏幕上}`;
    if (屏幕上 !== 真的打了 && !对不上) 对不上 = `第 ${i} 局之后屏幕上 ${屏幕上}，真的打了 ${真的打了}`;
    上一次看到的 = 屏幕上;
  }
  // 量程：这一节真的越过了那条线。存档没被收过（清单一直在涨）的话，下面两条都是空判。
  check('量程：存档真的被收过（清单停在 40 局）', 清单最长 === 40, `最长 ${清单最长} 局`);
  check('量程：挤出去的那一笔真的记上了', evictedScoreOf([KEY]) > 0, String(evictedScoreOf([KEY])));
  check('① 六十局下来，屏幕上那个数和「真的打了多少分」一分不差', 对不上 === null, 对不上 || `${上一次看到的}`);
  check('② 这个数一路只涨不跌', 掉过 === null, 掉过 || '');
  // 清单那一头照旧只留 40 局（这一改不该把存档撑大）。
  check('存档还是只留 40 局', loadRuns(KEY).length === 40, String(loadRuns(KEY).length));
}

// ---- ③ dropKey 要把那一笔一起删掉 --------------------------------------
{
  check('量程：清档之前那一笔还在', evictedScoreOf([KEY]) > 0, String(evictedScoreOf([KEY])));
  const had = dropKey(KEY);
  check('③ dropKey 说它删掉了东西', had === true, String(had));
  check('③ 清档之后那一笔也没了', evictedScoreOf([KEY]) === 0, String(evictedScoreOf([KEY])));
  check('③ 清档之后清单也空了', loadAllRuns([KEY]).length === 0, String(loadAllRuns([KEY]).length));
  // 库里一个带 ::evicted 的键都不该剩下。
  const 剩下 = [...mem.keys()].filter((k) => k.includes('::evicted'));
  check('③ 库里没留下 ::evicted 的死键', 剩下.length === 0, 剩下.join(' | '));
}

// ---- ④ 没有被挤掉的时候，那一笔是 0（别无端多出一笔） ------------------
{
  const K2 = 'sugarcube_best_ero1::flip';
  for (let i = 1; i <= 10; i++) saveRun(K2, runOf(i));
  check('④ 只打十局：一笔都没记（没挤掉任何人）', evictedScoreOf([K2]) === 0, String(evictedScoreOf([K2])));
  check('④ 而那十局的和就是屏幕上那个数',
    totalScoreOf(loadAllRuns([K2])) + evictedScoreOf([K2]) === 1055, String(totalScoreOf(loadAllRuns([K2]))));
}

// ---- ⑤ 同一局报两次不许记两笔 ------------------------------------------
//
// 那一笔只加不减、而且没有去重，所以「谁来写」要管死。同一局重复 saveRun（网差重发、返回
// 键再点一下）在存档那一头是会去重的吗？**不是**——saveRun 直接往前插。那它会不会把一局
// 算两遍？会，而且本来就会（存档里就有两条）。这儿钉的是**那一笔不额外多算**：挤出去几局
// 就记几局的分，不多不少。
{
  const K3 = 'sugarcube_best_ero1::twice';
  for (let i = 1; i <= 45; i++) saveRun(K3, runOf(i));
  const 之前 = evictedScoreOf([K3]);
  const 清单之前 = totalScoreOf(loadAllRuns([K3]));
  // 再存一局**全新的**，于是正好又挤掉一局（清单满着）。
  saveRun(K3, runOf(46));
  const 多记了 = evictedScoreOf([K3]) - 之前;
  const 清单变化 = totalScoreOf(loadAllRuns([K3])) - 清单之前;
  check('⑤ 又挤掉一局：那一笔只多了被挤掉那一局的分', 多记了 > 0 && 多记了 < 200, String(多记了));
  check('⑤ 两头加起来正好多了新这一局的分（146）', 多记了 + 清单变化 === 146, `${多记了} + ${清单变化}`);
}

// ---- ⑥⑦⑧⑨ 水位线（10-09 补充方案 7-2）--------------------------------------------------------
/** 屏幕上那个数：清单的和 ＋ 挤出去的那一笔。 */
const screen = (key) => totalScoreOf(loadAllRuns([key])) + evictedScoreOf([key]);
/**
 * 云上那 60 局：这台设备自己的第 1–50 局，外加 10 局更早的（另一台设备在这之前打的，第 -9 到第 0 局）。
 * 从云上取回来的局没有照片（start / end 是 null），和真的一样。
 */
const cloud60 = Array.from({ length: 60 }, (_, k) => runOf(k - 9));
const sumOf = (from, to) => { let t = 0; for (let i = from; i <= to; i++) t += 100 + i; return t; };
{
  const K6 = 'sugarcube_best_ero1::cloud';
  for (let i = 1; i <= 50; i++) saveRun(K6, runOf(i));
  const before = screen(K6);
  check('⑥ （量程）打了 50 局：屏幕上是这 50 局之和，账上已经记着被挤掉的 10 局', before === sumOf(1, 50) && evictedScoreOf([K6]) === sumOf(1, 10), `${before} / 账 ${evictedScoreOf([K6])}`);
  const seen = [];
  for (let n = 1; n <= 3; n++) {
    const added = mergeRuns(K6, cloud60);
    seen.push(`${added} 局 → ${screen(K6)}`);
  }
  check('⑥ 同一份 60 局的云端连并三次：累计得分一分不变（从前每并一次多出那 20 局的分）',
    seen.every((x) => x.endsWith(`→ ${before}`)), seen.join(' ｜ '));
  check('⑥ （量程）每次并都真的补进来又挤出去了 20 局——不是因为没并成才不变', seen.every((x) => x.startsWith('20 局')), seen.join(' ｜ '));
  check('⑥ 本机清单照旧 40 局', loadRuns(K6).length === 40, String(loadRuns(K6).length));
}
{
  const K7 = 'sugarcube_best_ero1::fresh';
  const added = mergeRuns(K7, cloud60);
  const first = screen(K7);
  check('⑦ 新设备并那 60 局：屏幕上是 60 局之和', added === 60 && first === sumOf(-9, 50), `${added} 局，${first} / ${sumOf(-9, 50)}`);
  mergeRuns(K7, cloud60);
  mergeRuns(K7, cloud60);
  check('⑦ 再并两次：不再变', screen(K7) === first, `${first} → ${screen(K7)}`);
  // 并完再打一局新的：挤掉的是清单里最旧那一局（还没记过账的那一局），照常记上。
  saveRun(K7, runOf(51));
  check('⑦ 并完再打一局新的：屏幕上正好多了这一局的分（被它挤掉的那一局照常记账，没被水位线挡掉）',
    screen(K7) === first + 151, `${first} → ${screen(K7)}`);
}
{
  const K8 = 'sugarcube_best_ero1::fresh';
  check('⑧ （量程）清档之前两个键都在', mem.has(K8 + '::evicted') && mem.has(K8 + '::evictedAt'));
  dropKey(K8);
  check('⑧ dropKey 之后 ::evicted、::evictedAt 两个键都不在', !mem.has(K8 + '::evicted') && !mem.has(K8 + '::evictedAt'),
    [...mem.keys()].filter((k) => k.startsWith(K8)).join(' | '));
}
{
  // 7-2 之前就记过账的设备：照老代码打了 50 局（账上记着第 1–10 局），没有水位线。
  const K9 = 'sugarcube_best_ero1::legacy';
  for (let i = 1; i <= 50; i++) saveRun(K9, runOf(i));
  mem.delete(K9 + '::evictedAt');
  const before = screen(K9);
  check('⑨ （量程）老设备：账上有数、没有水位线', mem.has(K9 + '::evicted') && !mem.has(K9 + '::evictedAt'));
  mergeRuns(K9, cloud60);
  check('⑨ 上线后头一次并云端：不再多记那 20 局（水位线从本机最旧那一局的前一格起）', screen(K9) === before, `${before} → ${screen(K9)}`);
  mergeRuns(K9, cloud60);
  check('⑨ 再并一次：照样不变', screen(K9) === before, `${before} → ${screen(K9)}`);
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

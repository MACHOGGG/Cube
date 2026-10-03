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

const { saveRun, loadRuns, loadAllRuns, totalScoreOf, evictedScoreOf, dropKey } = await import(bundle);

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

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

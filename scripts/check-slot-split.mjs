/**
 * 老虎机和基础各记各的：键分开、旧档拆得准、累计得分一分不差（10-11 方案 B-7）。
 *
 *   npx esbuild src/engine/slotSplit.ts --bundle --format=esm --platform=neutral --outfile=/tmp/slotsplit.mjs
 *   npx esbuild src/engine/persistence.ts --bundle --format=esm --platform=neutral --outfile=/tmp/persist.mjs
 *   npx esbuild src/engine/runKey.ts --bundle --format=esm --outfile=/tmp/runkey.mjs
 *   node scripts/check-slot-split.mjs /tmp/slotsplit.mjs /tmp/persist.mjs /tmp/runkey.mjs
 *
 * 纯 node：这几份模块只碰 localStorage，拿一个 Map 当它就行（三份包各打各的，共用同一个 globalThis.localStorage）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么
 *
 * 老虎机开在基础棋盘上，它那一局的 modeKey 就是 'base'，而存档键原先只问 modeKey——老虎机的局和基础局存进同一
 * 本：结算页的「本机最佳」「平均」是两种玩法掺着算的。改法是老虎机那一局另起一本（engine/runKey.ts 的
 * SLOT_PART），已经掺在一起的旧档开机拆一次（engine/slotSplit.ts）。
 *
 *   ① 键：老虎机那一本和基础那一本不是同一个键；别的玩法的键一个字不动（动了就是这台设备上那几档整片「消失」）。
 *   ② 打一局老虎机：基础那一本的最佳、平均、清单一样都不变。
 *   ③ 拆旧档：带 `slot` 的挪走、别的留着；基础的最佳是老虎机顶上去的才改，别的情形一律不动；累计得分
 *      （所有本的清单 ＋ 各本挤出去的那一笔）拆之前拆之后一分不差；只跑一次。
 *
 * 真打一局、看它落进哪一本，在 check-seed-deal（码开出来的二十种局，每一局结算之后读存档）；棋盘、记录页、
 * 云端取回、小红书那一端有没有接上，在 check-run-lifecycle ⑤（读源码）。
 */
const [splitBundle, persistBundle, keyBundle] = process.argv.slice(2);
if (!splitBundle || !persistBundle || !keyBundle) {
  console.error('用法：node scripts/check-slot-split.mjs <slotsplit.mjs> <persist.mjs> <runkey.mjs>');
  process.exit(2);
}

let fail = 0;
let ran = 0;
const check = (n, ok, extra = '') => {
  ran++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
};

const { splitSlotRuns } = await import(splitBundle);
const { saveRun, loadRuns, loadBest, saveBestIfHigher, loadAllRuns, totalScoreOf, evictedScoreOf, mergeRuns } = await import(persistBundle);
const { suffixFor, modeSuffix } = await import(keyBundle);

const SQUARE = 'sugarcube_best';
const CIRCLE = 'sugarcube_circles_best';
const BASE = suffixFor('base');
const SLOT = suffixFor('base', { slot: true });

let clock = 1_700_000_000_000;
/** 一局：只带结算页、记录页读的那几位。 */
const runOf = (score, slot, shapeId = 'square') => ({
  at: (clock += 60_000),
  data: { shapeId, modeKey: 'base', totalScore: score, ...(slot ? { slot: true } : {}) },
  start: null,
  end: null,
});
/** 结算那一刻控制器干的三件事（gameController 的 endGame：最佳、平均、存档），键由棋盘给。 */
const finish = (key, run) => {
  const past = loadRuns(key);
  const avg = Math.round((past.reduce((s, r) => s + (r.data?.totalScore ?? 0), 0) + run.data.totalScore) / (past.length + 1));
  const best = saveBestIfHigher(key, run.data.totalScore);
  saveRun(key, run);
  return { best, avg };
};
const avgOf = (key) => {
  const list = loadRuns(key);
  return list.length ? Math.round(list.reduce((s, r) => s + (r.data?.totalScore ?? 0), 0) / list.length) : 0;
};
/** 累计得分：记录页那个数（recordsPage：清单之和 ＋ 挤出去的那一笔），四本一起算。 */
const BOOKS = [SQUARE + BASE, SQUARE + SLOT, CIRCLE + BASE, CIRCLE + SLOT];
const grandTotal = () => totalScoreOf(loadAllRuns(BOOKS)) + evictedScoreOf(BOOKS);

// ── ① 键 ────────────────────────────────────────────────────────────────
{
  check('老虎机那一本和基础那一本不是同一个键', SLOT !== BASE, `${BASE} / ${SLOT}`);
  check('老虎机那一本 = 基础那一本前面多一截 _slot', SLOT === '_slot' + BASE, SLOT);
  // 别的玩法的键一个字不动：动了的话，这台设备上那几档在记录页上整片消失（它们还在，只是没人按旧键去找）。
  const same = ['base', 'timed', 'bomb', 'bombTimed', 'flip', 'puzzle'].filter(
    (mk) => suffixFor(mk) === suffixFor(mk, { slot: false }) && !suffixFor(mk).includes('_slot'),
  );
  check('不是老虎机的局，键和原先一字不差', same.length === 6, same.join(' '));
  check('modeSuffix（清档按它找旧键）不认 slot', modeSuffix('base', { slot: true }) === '', JSON.stringify(modeSuffix('base', { slot: true })));
  check('slot 和版本号互不串台', suffixFor('bomb', { bomb: 2, slot: true }) === '_slot' + suffixFor('bomb', { bomb: 2 }),
    suffixFor('bomb', { bomb: 2, slot: true }));
}

// ── ② 打一局老虎机，基础那一本一样都不变 ────────────────────────────────
{
  mem.clear();
  for (const s of [400, 600, 500]) finish(SQUARE + BASE, runOf(s, false));
  const before = { best: loadBest(SQUARE + BASE), avg: avgOf(SQUARE + BASE), n: loadRuns(SQUARE + BASE).length };
  const end = finish(SQUARE + SLOT, runOf(9000, true));
  const after = { best: loadBest(SQUARE + BASE), avg: avgOf(SQUARE + BASE), n: loadRuns(SQUARE + BASE).length };
  check('打一局老虎机（9000）：基础的本机最佳不变', after.best === before.best && before.best === 600, `${before.best} → ${after.best}`);
  check('打一局老虎机：基础的平均不变', after.avg === before.avg && before.avg === 500, `${before.avg} → ${after.avg}`);
  check('打一局老虎机：基础那一本的清单不变', after.n === before.n && before.n === 3, `${before.n} → ${after.n}`);
  check('老虎机那一局自己的最佳、平均只算它自己', end.best === 9000 && end.avg === 9000, JSON.stringify(end));
  // 尺子：要是这一局还存进基础那一本（原先的做法），上面三条会怎样——证明 9000 这个数真的会把基础顶歪。
  const was = finish(SQUARE + BASE, runOf(9000, true));
  check('（尺子）原先那样存进基础那一本：最佳当场变 9000、平均 2625', was.best === 9000 && was.avg === 2625, JSON.stringify(was));
}

// ── ③ 拆旧档 ────────────────────────────────────────────────────────────
{
  mem.clear();
  clock = 1_700_000_000_000;
  // 方块：三局基础（300 / 500 / 200）、三局老虎机（900 / 100 / 0），最佳 900 是老虎机顶上去的；另有挤出去的一笔 1000。
  for (const [s, slot] of [[300, false], [900, true], [500, false], [100, true], [200, false], [0, true]]) {
    finish(SQUARE + BASE, runOf(s, slot));
  }
  localStorage.setItem(SQUARE + BASE + '::evicted', '1000');
  // 小球：最佳 2000 比清单上每一局都高——那条纪录的局早被挤出存档了，分不清是哪种玩法打的。
  for (const [s, slot] of [[700, true], [450, false]]) finish(CIRCLE + BASE, runOf(s, slot, 'circle'));
  saveBestIfHigher(CIRCLE + BASE, 2000);
  const totalBefore = grandTotal();

  const moved = splitSlotRuns([SQUARE, CIRCLE]);
  const sqBase = loadRuns(SQUARE + BASE).map((r) => r.data.totalScore);
  const sqSlot = loadRuns(SQUARE + SLOT).map((r) => r.data.totalScore);
  check('挪了四局（方块三局、小球一局）', moved === 4, String(moved));
  check('方块：基础那一本只剩基础局', sqBase.length === 3 && loadRuns(SQUARE + BASE).every((r) => !r.data.slot), sqBase.join(' '));
  check('方块：老虎机那一本是那三局（0 分那一局也在）', sqSlot.length === 3 && loadRuns(SQUARE + SLOT).every((r) => r.data.slot),
    sqSlot.join(' '));
  check('方块：基础的最佳退回基础局自己的 500（原先 900 是老虎机顶上去的）', loadBest(SQUARE + BASE) === 500, String(loadBest(SQUARE + BASE)));
  check('方块：老虎机那一本的最佳是 900', loadBest(SQUARE + SLOT) === 900, String(loadBest(SQUARE + SLOT)));
  check('方块：基础的平均只算基础局（333）', avgOf(SQUARE + BASE) === 333, String(avgOf(SQUARE + BASE)));
  check('小球：最佳 2000 比清单上每一局都高——分不清是谁打的，不动', loadBest(CIRCLE + BASE) === 2000, String(loadBest(CIRCLE + BASE)));
  check('小球：老虎机那一本的最佳是 700', loadBest(CIRCLE + SLOT) === 700, String(loadBest(CIRCLE + SLOT)));
  check('累计得分拆之前拆之后一分不差（清单之和 ＋ 挤出去的那一笔）', grandTotal() === totalBefore, `${totalBefore} → ${grandTotal()}`);
  check('挤出去的那一笔还在基础那一本上，没被搬也没被记第二遍', evictedScoreOf([SQUARE + BASE]) === 1000 && evictedScoreOf([SQUARE + SLOT]) === 0,
    `${evictedScoreOf([SQUARE + BASE])} / ${evictedScoreOf([SQUARE + SLOT])}`);
  check('跑过就记一笔', localStorage.getItem('slides_slot_split_v1') === '1');

  // 只跑一次：再开一次机，哪怕基础那一本里又冒出一局带 slot 的（不该有，这里硬塞一局当记号），也不再动。
  finish(SQUARE + BASE, runOf(50, true));
  const again = splitSlotRuns([SQUARE, CIRCLE]);
  check('第二次开机不再拆', again === 0 && loadRuns(SQUARE + BASE).length === 4, `${again} 局 / 基础那一本 ${loadRuns(SQUARE + BASE).length} 局`);
}

// 只打过老虎机：基础那一本的最佳整个是老虎机顶上去的 → 删掉（基础局一局都没打过）。
// 平手（老虎机最高 = 基础最高 = 最佳）：说不清是谁顶上去的，不动。
{
  mem.clear();
  for (const s of [700, 300]) finish(SQUARE + BASE, runOf(s, true));
  for (const [s, slot] of [[800, true], [800, false]]) finish(CIRCLE + BASE, runOf(s, slot, 'circle'));
  splitSlotRuns([SQUARE, CIRCLE]);
  check('只打过老虎机：基础的最佳删掉（读出来是 0）', loadBest(SQUARE + BASE) === 0 && localStorage.getItem(SQUARE + BASE) === null,
    String(localStorage.getItem(SQUARE + BASE)));
  check('只打过老虎机：基础那一本空了，老虎机那一本两局', loadRuns(SQUARE + BASE).length === 0 && loadRuns(SQUARE + SLOT).length === 2);
  check('平手：基础的最佳不动', loadBest(CIRCLE + BASE) === 800, String(loadBest(CIRCLE + BASE)));
}

// 云上取回的基础局不抬最佳（mergeRuns 只并清单）：本机最佳 900 是老虎机顶上去的，清单上却有一局取回来的基础局
// 1200——拆完基础的最佳是 1200（清单上基础局里最高的那个），不是停在老虎机的 900，也不是退到本机打的 400。
{
  mem.clear();
  for (const [s, slot] of [[400, false], [900, true]]) finish(SQUARE + BASE, runOf(s, slot));
  mergeRuns(SQUARE + BASE, [runOf(1200, false)]);
  const before = loadBest(SQUARE + BASE);
  splitSlotRuns([SQUARE, CIRCLE]);
  check('取回的基础局比老虎机那一局还高：基础的最佳改成它（1200）', before === 900 && loadBest(SQUARE + BASE) === 1200,
    `${before} → ${loadBest(SQUARE + BASE)}`);
}

// 一局老虎机都没有：什么也不动（键、清单、最佳），只记那一笔。
{
  mem.clear();
  for (const s of [120, 340]) finish(SQUARE + BASE, runOf(s, false));
  const snap = JSON.stringify([...mem.entries()].sort());
  const moved = splitSlotRuns([SQUARE, CIRCLE]);
  mem.delete('slides_slot_split_v1');
  check('一局老虎机都没有：一个键都不动', moved === 0 && JSON.stringify([...mem.entries()].sort()) === snap);
}

console.log(fail ? `\n${fail} 条没过（共 ${ran} 条）` : `\n全部通过（${ran} 条）`);
process.exit(fail ? 1 : 0);

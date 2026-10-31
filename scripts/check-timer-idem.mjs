/**
 * 计时器的 pause / resume 是幂等的（10-31 方案推07 Z-H03，debug G16）。纯 node，不开浏览器，几毫秒。
 *
 *   npx esbuild src/engine/timer.ts --bundle --format=esm --outfile=/tmp/timer.mjs
 *   node scripts/check-timer-idem.mjs /tmp/timer.mjs
 *
 * 原先 pause() / resume() 都不看表在不在走（engine/timer.ts）：
 *
 *   · 停着再 pause 一次：pausedElapsed 被改成「从开表到现在」，停着的那一段算进了用时。复现：打 10 秒 → pause
 *     → 过 10 秒 → 再 pause → 过 5 秒 → resume，用时变 20 秒（该是 10）。用时印在结算页、战绩里，无限反转那一档
 *     服务器还按它判 flipTime（超过 105 秒整局拒收）。
 *   · 走着再 resume 一次：startTime 被拨回「上一次停下的那一刻」，这一段白走了。
 *
 * 量法：timer.ts 读的是单调钟 performance.now（10-15 补充 S8），这里换成一只手拨的假钟；setInterval 换成空的
 * （tick 只管刷新读数，elapsedSeconds 不靠它）。
 *
 *   ① start → 拨 10 秒 → pause → 拨 10 秒 → 再 pause → 拨 5 秒 → resume → 拨 0 秒：用时 10（改之前 20，这条能红）。
 *   ② start → 拨 10 秒 → pause → 拨 7 秒 → resume → 拨 5 秒 → 再 resume → 拨 0 秒：用时 15（只多那 5 秒；改之前 10）。
 *   ③ 尺子：stop() 以后再问，是停下那一刻的数；stop 以后 resume 照旧接着走（这一条行为不变）。
 */
import { pathToFileURL } from 'node:url';

const file = process.argv[2];
if (!file) {
  console.error('用法: node scripts/check-timer-idem.mjs /tmp/timer.mjs');
  process.exit(2);
}

let now = 0;
Object.defineProperty(globalThis, 'performance', { value: { now: () => now }, configurable: true, writable: true });
globalThis.window = { setInterval: () => 1, clearInterval: () => {} };
const rawClear = globalThis.clearInterval;
globalThis.clearInterval = (id) => (typeof id === 'number' ? undefined : rawClear(id));

const { createTimer } = await import(pathToFileURL(file).href);

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const sec = (s) => {
  now += s * 1000;
};

{
  now = 0;
  const t = createTimer(() => {});
  t.start();
  sec(10);
  t.pause();
  sec(10);
  t.pause();
  sec(5);
  t.resume();
  sec(0);
  check('① 停着再 pause 一次：停着的那一段不算进用时（10 秒）', t.elapsedSeconds() === 10, `${t.elapsedSeconds()} 秒`);
}
{
  now = 0;
  const t = createTimer(() => {});
  t.start();
  sec(10);
  t.pause();
  sec(7);
  t.resume();
  sec(5);
  t.resume();
  sec(0);
  check('② 走着再 resume 一次：用时只多走着的那 5 秒（15 秒）', t.elapsedSeconds() === 15, `${t.elapsedSeconds()} 秒`);
}
{
  now = 0;
  const t = createTimer(() => {});
  t.start();
  sec(12);
  t.stop();
  sec(30);
  const stopped = t.elapsedSeconds();
  t.resume();
  sec(3);
  check('③（尺子）stop 以后读到的是停下那一刻（12 秒）', stopped === 12, `${stopped} 秒`);
  check('③（尺子）stop 以后 resume 照旧接着走（12 + 3 = 15 秒）', t.elapsedSeconds() === 15, `${t.elapsedSeconds()} 秒`);
}

console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

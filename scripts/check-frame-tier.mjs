/**
 * 跑不动的机器上自动降一档特效——降得对，而且**不会误降**。
 *
 *   npx esbuild src/engine/frameTier.ts --bundle --format=esm --outfile=/tmp/tier.mjs
 *   node scripts/check-frame-tier.mjs /tmp/tier.mjs
 *
 * 为什么要有这道门：这件事全靠一个「连续 120 帧的均值」在判，而判错的两种
 * 后果不对称——
 *
 *   · 该降没降：老安卓上继续撒十颗粒子、继续 heavy 震屏，卡上加卡。这种玩家
 *     会走，但不会来报。
 *   · **不该降却降了**：一台好手机，玩家什么也没做，特效突然少了一半，而且
 *     这一局再也回不去（只降不升）。这种更糟，因为它看起来像「游戏坏了」。
 *
 * 所以这里喂的四种帧流，每一种都对应一个具体的怕：开局那阵子必然慢（不该降）、
 * 切到后台那一帧长达几秒（不该降）、偶尔一两帧毛刺（不该降）、真的连续两秒
 * 跑不到 45fps（该降）。
 *
 * 时钟是假的：rAF 和 cancelAnimationFrame 都换成自己的，帧时想喂多少喂多少，
 * 不用真的等两秒，也不看这台机器自己跑得快不快。
 */
const bundle = process.argv[2];
if (!bundle) {
  console.log('用法: node scripts/check-frame-tier.mjs <打包好的 frameTier.mjs>');
  process.exit(2);
}

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// ---- 假时钟 ---------------------------------------------------------------
let pending = null;
let nextId = 1;
globalThis.requestAnimationFrame = (fn) => {
  pending = fn;
  return nextId++;
};
globalThis.cancelAnimationFrame = () => {
  pending = null;
};

const { motionTier, watchFrames, resetFrameTier } = await import(bundle);

let now = 0;
/** 喂 n 帧，每帧 dt 毫秒。模块自己停掉之后就不再喂（pending 为空）。 */
function feed(n, dt) {
  for (let i = 0; i < n; i++) {
    if (!pending) return i;
    const fn = pending;
    pending = null;
    now += dt;
    fn(now);
  }
  return n;
}

const FAST = 16; // 60fps
const SLOW = 30; // ≈33fps，超过 22ms 的门槛
const WINDOW = 120;
const WARMUP = 30;

// ---------------------------------------------------------------------------
// 1. 一直很快：永远不降
// ---------------------------------------------------------------------------
{
  resetFrameTier();
  const stop = watchFrames();
  check('出厂就是 full', motionTier() === 'full', motionTier());
  feed(WARMUP + WINDOW * 3, FAST);
  check('一直 60fps：不降档', motionTier() === 'full', motionTier());
  stop();
}

// ---------------------------------------------------------------------------
// 2. 一直很慢：降，而且不早于「热身 + 一整扇窗」
// ---------------------------------------------------------------------------
{
  resetFrameTier();
  const stop = watchFrames();
  feed(WARMUP + WINDOW - 2, SLOW);
  check('还差两帧凑不满一扇窗：先别降', motionTier() === 'full', motionTier());
  feed(4, SLOW);
  check('一整扇窗都在 33fps：降到 lite', motionTier() === 'lite', motionTier());
  check('降完就不再量了（rAF 停掉，采样自己也不花钱）', pending === null);
  feed(WINDOW * 2, FAST); // 喂不进去了，pending 是空的
  check('只降不升：之后再快也回不去 full', motionTier() === 'lite', motionTier());
  stop();
}

// ---------------------------------------------------------------------------
// 3. 开局那阵子慢：不算数
// ---------------------------------------------------------------------------
{
  resetFrameTier();
  const stop = watchFrames();
  // 热身期整段都很慢（开局在建 DOM、量地板、跑 4-3-2-1），之后一路 60fps。
  feed(WARMUP, 60);
  feed(WINDOW * 2, FAST);
  check('开局那 30 帧再慢也不算数', motionTier() === 'full', motionTier());
  stop();
}

// ---------------------------------------------------------------------------
// 4. 切到后台那一帧长达几秒：不算数
// ---------------------------------------------------------------------------
{
  resetFrameTier();
  const stop = watchFrames();
  feed(WARMUP + 10, FAST);
  feed(1, 4000); // 锁屏四秒
  feed(WINDOW * 2, FAST);
  check('切后台那一帧（4 秒）不当作「一帧慢」', motionTier() === 'full', motionTier());
  stop();
}

// ---------------------------------------------------------------------------
// 5. 偶尔一两帧毛刺：不算数
// ---------------------------------------------------------------------------
{
  resetFrameTier();
  const stop = watchFrames();
  feed(WARMUP, FAST);
  // 每 20 帧插一帧 120ms 的毛刺（一次垃圾回收、一次图片解码）。
  // 均值 = (19×16 + 120) / 20 = 21.2ms，压在 22 以下。
  for (let k = 0; k < 12; k++) {
    feed(19, FAST);
    feed(1, 120);
  }
  check('二十帧里毛刺一帧：均值还在门槛内，不降', motionTier() === 'full', motionTier());
  stop();
}

// ---------------------------------------------------------------------------
// 6. 引用计数：最后一个走的才真的停
// ---------------------------------------------------------------------------
{
  resetFrameTier();
  const a = watchFrames();
  // 中途有人加进来（小屋里练习盘和正式局会短暂重叠）：不能把已经攒的那扇窗
  // 清零，否则两处轮流进出就等于永远攒不满，降档从此不会发生。
  feed(WARMUP + WINDOW - 2, SLOW);
  const b = watchFrames();
  feed(4, SLOW);
  check('中途多一处在看，不会把攒了一半的那扇窗清零', motionTier() === 'lite', motionTier());

  resetFrameTier();
  const c = watchFrames();
  const d = watchFrames();
  c();
  check('走了一个，还在量', pending !== null);
  d();
  check('最后一个也走了，rAF 停掉', pending === null);
  c(); // 同一个停手函数再叫一次，不该把计数弄成负的
  c();
  const e = watchFrames();
  check('重新看得起来（计数没被重复的 stop 弄坏）', pending !== null);
  e();
  check('再停一次就真的停了', pending === null);
  a();
  b();
}

// ---------------------------------------------------------------------------
// 7. 接线：juice 里那两处真的问了档位
// ---------------------------------------------------------------------------
{
  const { readFileSync } = await import('node:fs');
  const juice = readFileSync(new URL('../src/engine/juice.ts', import.meta.url), 'utf8');
  check("juice 引了 motionTier", juice.includes("from './frameTier'"));
  // 降的只有这两样。少了哪一处，降档就是句空话。
  check('震屏按档位收到 light', /motionTier\(\) === 'lite' \? 'light' : tier/.test(juice));
  check('粒子按档位减半', /motionTier\(\) === 'lite' \? Math\.max\(3, Math\.round\(count \/ 2\)\)/.test(juice));
  // 顿帧、落位、翻面、音效一概不动——full 档和 lite 档在它们身上没有区别。
  const mentions = (juice.match(/motionTier\(\)/g) || []).length;
  check('只有这两处按档位分叉（别的一律不动）', mentions === 2, `${mentions} 处`);

  const gc = readFileSync(new URL('../src/engine/gameController.ts', import.meta.url), 'utf8');
  check('局中才采样：开局挂上', gc.includes('const stopFrameWatch = watchFrames();'));
  check('局中才采样：destroy 摘掉', gc.includes('stopFrameWatch();'));
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

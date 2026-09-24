/**
 * 主菜单那条轴的**运动学**单元测试——纯 node，不碰 DOM，几十毫秒，进 CI。
 *
 *   npx esbuild src/engine/axisMotion.ts --bundle --format=esm --outfile=/tmp/axismotion.mjs
 *   npx esbuild src/engine/spring.ts     --bundle --format=esm --outfile=/tmp/spring.mjs
 *   node scripts/check-axis-motion.mjs /tmp/axismotion.mjs /tmp/spring.mjs
 *
 * 它盯的是一类**量不出来也不报错**的毛病：手感在不同机器上不一样。
 * 60Hz 的开发机上调好的追赶和弹簧，到了 iPhone 低电量模式（30Hz）会慢一倍，
 * 到了 120Hz 的机器上快一倍——屏幕上什么都不会红，只是「这台手机上的轴手感
 * 不对」，而这种话没人报得清楚。所以把「帧率无关」写成断言。
 *
 * 和 check-fisheye 的分工：那道门量的是**形变**（fisheye 的几何）和弹簧的
 * 整定时间；这道门量的是**时间**这一维——同一段真实时间，帧率不同结果要一样。
 */

const [motionSrc, springSrc] = process.argv.slice(2);
if (!motionSrc || !springSrc) {
  console.error('用法: node scripts/check-axis-motion.mjs <打包好的 axisMotion.mjs> <打包好的 spring.mjs>');
  process.exit(2);
}
const { damp, AXIS_LERP, AXIS_LAMBDA, rubber, RUBBER_D } = await import(motionSrc);
const { createSpring, stepSpring } = await import(springSrc);

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// ── 弹簧：同一段真实时间，帧率不同结果要一样 ────────────────────────
//
// engine/spring.ts 本来就收真实 dt（MAX_DT_MS 截断 + 4ms 子步）。写这一条是因为
// **调用方**曾经把步长写死成 16.7ms：30Hz 下一秒只积分半秒，弹簧慢一倍。改回真实
// dt 之后，这一条就是那件事的地基——地基要是也不成立，改调用方也白搭。
{
  const run = (dtMs, steps) => {
    const s = createSpring(0);
    s.velocity = 2; // 带一点初速度：只有静止起步的话，速度那一维根本没被检验到
    for (let i = 0; i < steps; i++) stepSpring(s, 1, dtMs);
    return s;
  };
  const a = run(8.3335, 2); // 120Hz 走两帧
  const b = run(16.667, 1); // 60Hz 走一帧
  check(
    '弹簧帧率无关：dt=8.33 两步 ≈ dt=16.67 一步（差 < 1e-3）',
    Math.abs(a.value - b.value) < 1e-3,
    `${a.value.toFixed(6)} / ${b.value.toFixed(6)}（差 ${Math.abs(a.value - b.value).toExponential(2)}）`,
  );
  // 走满 200ms 再比一次：一帧的误差会不会攒起来。三种帧率都走 200ms 真实时间。
  const long = [
    ['120Hz', run(200 / 24, 24)],
    ['60Hz', run(200 / 12, 12)],
    ['30Hz', run(200 / 6, 6)],
  ];
  const vals = long.map(([, s]) => s.value);
  check(
    '走满 200ms 之后三种帧率也还在一起（差 < 0.5%）',
    Math.max(...vals) - Math.min(...vals) < 0.005,
    long.map(([n, s]) => `${n} ${s.value.toFixed(5)}`).join(' / '),
  );
}

// ── 追赶：同一段真实时间，帧率不同追到的地方要一样 ──────────────────
//
// 这是 damp 存在的全部理由。写成 `x += (target - x) * 0.1` 的话，同样 100ms 里
// 30Hz 只追回 27.1%、60Hz 46.9%、120Hz 71.8%——开发机上调好的那一点「慢半拍」，
// 到低电量模式的 iPhone 上是拖泥带水，到 120Hz 上几乎不慢。
{
  const run = (dtMs, steps) => {
    let x = 0;
    for (let i = 0; i < steps; i++) x = damp(x, 1, dtMs);
    return x;
  };
  // 都走满 100ms 真实时间，只是帧数不同。
  const at = [
    ['120Hz', run(100 / 12, 12)],
    ['60Hz', run(100 / 6, 6)],
    ['30Hz', run(100 / 3, 3)],
  ];
  const vals = at.map(([, v]) => v);
  const spread = Math.max(...vals) - Math.min(...vals);
  check(
    '追赶帧率无关：100ms 里 120/60/30Hz 追到同一处（相差 < 0.5%）',
    spread / vals[1] < 0.005,
    at.map(([n, v]) => `${n} ${(v * 100).toFixed(2)}%`).join(' / '),
  );
  // 60Hz 那一档必须正好等于 AXIS_LERP：这是「λ 由 0.1 反推」那句话的验算。数对
  // 不上的话，参照 Lenis 的那个 0.1 就名存实亡了。
  check(
    `60Hz 下每帧正好追 AXIS_LERP（${AXIS_LERP}）`,
    Math.abs(damp(0, 1, 1000 / 60) - AXIS_LERP) < 1e-6,
    `${damp(0, 1, 1000 / 60).toFixed(8)}，λ = ${AXIS_LAMBDA.toFixed(6)}`,
  );
  // 切后台回来那一下 dt 可能是几秒：截断到 64ms，不能一帧贴到目标上。
  check(
    'dt 再大也截断在 64ms（切后台回来不会一帧跳到位）',
    Math.abs(damp(0, 1, 5000) - damp(0, 1, 64)) < 1e-12 && damp(0, 1, 5000) < 0.4,
    `dt=5000ms 追了 ${(damp(0, 1, 5000) * 100).toFixed(2)}%`,
  );
}

// ── 橡皮筋：越拉越难拉，但没有墙 ────────────────────────────────────
//
// 上一版是「线性打 0.35 折、到 0.55 项一刀切」——拉到 0.55 就是一堵墙。现在换成
// iOS UIScrollView 那条渐近曲线。两条断言把这次换的两个要点各钉死一头：
//   · 和旧手感的**对齐点**还在（拉出 1 项时仍然是 0.350）；
//   · 渐近线永远到不了（没有墙，也不会拉到天上去）。
{
  check('拉出 1 项时和旧手感一样（0.350）', Math.abs(rubber(1) - 0.35) < 1e-3, rubber(1).toFixed(4));
  let mono = true;
  let over = null;
  let prev = -Infinity;
  for (let x = 0; x <= 1e6; x = x < 10 ? x + 0.01 : x * 1.5) {
    const v = rubber(x);
    if (v < prev - 1e-12) mono = false;
    if (v >= RUBBER_D) over = over ?? x;
    prev = v;
  }
  check('越拉越远，单调递增（拉回去也没有反向的台阶）', mono);
  check(
    `永远到不了 ${RUBBER_D} 项（渐近线，不是墙）`,
    over === null,
    over === null
      ? `拉出 3 项 ${rubber(3).toFixed(3)} / 10 项 ${rubber(10).toFixed(3)} / 1e6 项 ${rubber(1e6).toFixed(6)}`
      : `x=${over} 就到顶了`,
  );
  // 「越拉越难拉」不是形容词：同样再拉 1 项，露出来的那一截必须一段比一段短。
  const gain = [1, 2, 3, 4].map((x) => rubber(x) - rubber(x - 1));
  check(
    '同样再拉一项，露出来的越来越少（阻力递增）',
    gain.every((g, i) => i === 0 || g < gain[i - 1]),
    gain.map((g) => g.toFixed(3)).join(' > '),
  );
}

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 条没过`);
process.exit(fail ? 1 : 0);

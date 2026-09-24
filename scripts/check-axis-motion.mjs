/**
 * 主菜单那条轴的**运动学**单元测试——纯 node，不碰 DOM，几十毫秒，进 CI。
 *
 *   npx esbuild src/engine/spring.ts --bundle --format=esm --outfile=/tmp/spring.mjs
 *   node scripts/check-axis-motion.mjs /tmp/spring.mjs
 *
 * 它盯的是一类**量不出来也不报错**的毛病：手感在不同机器上不一样。
 * 60Hz 的开发机上调好的追赶和弹簧，到了 iPhone 低电量模式（30Hz）会慢一倍，
 * 到了 120Hz 的机器上快一倍——屏幕上什么都不会红，只是「这台手机上的轴手感
 * 不对」，而这种话没人报得清楚。所以把「帧率无关」写成断言。
 *
 * 和 check-fisheye 的分工：那道门量的是**形变**（fisheye 的几何）和弹簧的
 * 整定时间；这道门量的是**时间**这一维——同一段真实时间，帧率不同结果要一样。
 */

const [springSrc] = process.argv.slice(2);
if (!springSrc) {
  console.error('用法: node scripts/check-axis-motion.mjs <打包好的 spring.mjs>');
  process.exit(2);
}
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

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 条没过`);
process.exit(fail ? 1 : 0);

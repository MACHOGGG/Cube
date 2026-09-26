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
const { damp, AXIS_LERP, AXIS_LAMBDA, AXIS_SETTLE_LAMBDA, blurFor, BLUR_EDGE, BLUR_MAX, BLUR_EXEMPT,
  flatFor, FLAT_MAX, FLAT_DEAD, FLAT_VMAX, rubber, RUBBER_D, skewFor, SKEW_DEAD, SKEW_MAX } = await import(motionSrc);
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

// ── 无滞后直贴：AXIS_LERP 现在是 1 ─────────────────────────────────
//
// 玩家在调参模拟台上把它拉到了顶（附录 A：`"lerp":1`），语义是「画面每帧直接等于手指
// 的目标，没有追赶曲线」。数学上 λ 就是无穷大——这一段量的是那一档真的成立，而且**下游
// 不必为它写分支**：damp 自己算出来就是 target。
{
  check(`AXIS_LERP 是 1（无滞后直贴）`, AXIS_LERP === 1, String(AXIS_LERP));
  check('λ 因此是 Infinity', AXIS_LAMBDA === Infinity, String(AXIS_LAMBDA));
  check('停住追赶那个常量也跟着失效（无滞后就没有「还差半拍」）',
    AXIS_SETTLE_LAMBDA === Infinity, String(AXIS_SETTLE_LAMBDA));
  // 一帧就到，任何 dt 都一样——包括被截断的那一档。
  const spots = [1000 / 120, 1000 / 60, 1000 / 30, 5000].map((dt) => damp(0.3, 7, dt));
  check('λ = ∞ 下 damp 一帧到位（dt 多少都一样）',
    spots.every((v) => v === 7), spots.join(' '));
}

// ── 追赶那条路本身：同一段真实时间，帧率不同追到的地方要一样 ────────
//
// 这是 damp 存在的全部理由。写成 `x += (target - x) * 0.1` 的话，同样 100ms 里
// 30Hz 只追回 27.1%、60Hz 46.9%、120Hz 71.8%——开发机上调好的那一点「慢半拍」，
// 到低电量模式的 iPhone 上是拖泥带水，到 120Hz 上几乎不慢。
//
// **λ 显式传进去**，不走默认值：默认值现在是 ∞（一帧到位），那一档量不到帧率无关这件
// 事。追赶那条路仍旧活着——`slides.axisTune` 把 `lerp` 调回小于 1，modeAxis 的 loop 就
// 又走它（见那个文件里 `AXIS_LERP >= 1` 那一支）。这一段量的就是那条路。
{
  /** lerp = 0.1 对应的 λ，也就是这条路从前的默认值。 */
  const LAMBDA_01 = -Math.log(1 - 0.1) * 60;
  const run = (dtMs, steps) => {
    let x = 0;
    for (let i = 0; i < steps; i++) x = damp(x, 1, dtMs, LAMBDA_01);
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
  // 60Hz 那一档必须正好等于那个 lerp：这是「λ 由 0.1 反推」那句话的验算。
  check(
    '60Hz 下每帧正好追 0.1（λ 由它反推）',
    Math.abs(damp(0, 1, 1000 / 60, LAMBDA_01) - 0.1) < 1e-6,
    `${damp(0, 1, 1000 / 60, LAMBDA_01).toFixed(8)}，λ = ${LAMBDA_01.toFixed(6)}`,
  );
  // 切后台回来那一下 dt 可能是几秒：截断到 64ms，不能一帧贴到目标上。
  check(
    'dt 再大也截断在 64ms（切后台回来不会一帧跳到位）',
    Math.abs(damp(0, 1, 5000, LAMBDA_01) - damp(0, 1, 64, LAMBDA_01)) < 1e-12 &&
      damp(0, 1, 5000, LAMBDA_01) < 0.4,
    `dt=5000ms 追了 ${(damp(0, 1, 5000, LAMBDA_01) * 100).toFixed(2)}%`,
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

// ── 速度倾斜：死区和封顶 ────────────────────────────────────────────
{
  const dead = [0, 0.5, 1, SKEW_DEAD - 1e-9, -1, -SKEW_DEAD + 1e-9];
  check(
    `死区：|v| < ${SKEW_DEAD} 项/秒一律为 0`,
    dead.every((v) => skewFor(v) === 0),
    dead.map((v) => `${v}→${skewFor(v)}`).join(' '),
  );
  const wild = [2, 5, 20, 1e6, -2, -5, -20, -1e6];
  check(
    `封顶：再快也不超过 ${SKEW_MAX}°`,
    wild.every((v) => Math.abs(skewFor(v)) <= SKEW_MAX + 1e-12),
    wild.map((v) => `${v}→${skewFor(v).toFixed(2)}`).join(' '),
  );
  // 方向要跟着速度的正负走：两边都往一个方向歪的话，甩上去和甩下去看着一样，
  // 「被甩动」那点意思就没了。
  check('方向跟着速度走（左右对称）', skewFor(5) === -skewFor(-5) && skewFor(5) > 0, `${skewFor(5).toFixed(2)}° / ${skewFor(-5).toFixed(2)}°`);
  // 死区刚出去那一下不能是个台阶——从 0 突然跳到一度多，眼睛看得见。
  check(
    '刚出死区是从 0 连续长出来的（不是台阶）',
    skewFor(SKEW_DEAD + 0.01) < 0.05 && skewFor(SKEW_DEAD + 0.01) > 0,
    `${skewFor(SKEW_DEAD + 0.01).toFixed(4)}°`,
  );
}

// ── 速度耦合的扁平化（flatFor）─────────────────────────────────────
//
// 滑得越快，鱼眼的变形越收。幅度是玩家在模拟台上调定的 FLAT_MAX = 0.1——**只收一成**。
// 很轻是有意的：这一项是「高速时别晃眼」，不是一个看得见的特效。所以这一段除了量形状，
// 还要量**它确实很轻**：一旦有人把它当特效加大，最小值那一条会红。
{
  check('慢慢挑的时候一点都不收（死区内恒为 1）',
    [0, 0.1, FLAT_DEAD].every((v) => flatFor(v) === 1),
    [0, 0.1, FLAT_DEAD].map((v) => `${v}→${flatFor(v)}`).join(' '));
  // 单调不增：速度越大，收得越多（或者一样），不许中间反弹。
  let mono = true;
  let prev = flatFor(0);
  for (let v = 0; v <= 12; v += 0.1) {
    const cur = flatFor(v);
    if (cur > prev + 1e-12) { mono = false; break; }
    prev = cur;
  }
  check('速度越大收得越多，单调不增', mono);
  check(`最小值就是 1 − FLAT_MAX（${(1 - FLAT_MAX).toFixed(2)}），不许更狠`,
    Math.abs(flatFor(1e6) - (1 - FLAT_MAX)) < 1e-12, flatFor(1e6).toFixed(4));
  check('到 FLAT_VMAX 就吃满', Math.abs(flatFor(FLAT_VMAX) - (1 - FLAT_MAX)) < 1e-12,
    `${FLAT_VMAX} → ${flatFor(FLAT_VMAX).toFixed(4)}`);
  check('左右对称（往哪个方向滑都一样）',
    flatFor(3) === flatFor(-3) && flatFor(9) === flatFor(-9), `${flatFor(3)} / ${flatFor(-3)}`);
  // 死区刚出来那一下是连续的，不是台阶——台阶会让形变在某个手速上「啪」地收一下。
  const justOut = flatFor(FLAT_DEAD + 1e-6);
  check('刚出死区是连续的（不是台阶）', justOut < 1 && 1 - justOut < 1e-5, (1 - justOut).toExponential(2));
}

// ── 两头那一点虚，和焦点豁免（blurFor）───────────────────────────
//
// 焦点豁免是这个函数存在的理由：只按离屏幕边多远算的话，把轴拖到两端、焦点那张自己贴着
// 屏幕边的时候，**正被选中的那张卡是虚的**——玩家盯着看的恰好是最模糊的一张。不报错、不
// 白屏，只是「到了顶那一张看不清」。
{
  // 正例：一张远处的卡贴着屏幕边，该虚。
  check('远处的卡贴着屏幕边：虚', blurFor(0, 0) > 0, String(blurFor(0, 0)));
  check('离边够远：不虚', blurFor(BLUR_EDGE, 0) === 0, String(blurFor(BLUR_EDGE, 0)));
  check('越靠边越虚（单调不减）',
    blurFor(0, 0) >= blurFor(50, 0) && blurFor(50, 0) >= blurFor(120, 0),
    `${blurFor(0, 0)} ${blurFor(50, 0)} ${blurFor(120, 0)}`);
  check(`最多 ${BLUR_MAX}px`, blurFor(-999, 0) === BLUR_MAX, String(blurFor(-999, 0)));
  // 豁免：影响度高的那几张一律不虚，哪怕贴在边上。
  check('焦点贴着屏幕边也不虚（豁免）', blurFor(0, 1) === 0, String(blurFor(0, 1)));
  check('刚过豁免线就不虚了', blurFor(0, BLUR_EXEMPT + 0.01) === 0, String(blurFor(0, BLUR_EXEMPT + 0.01)));
  // 尺子：豁免线**以下**的还是要虚，不然「豁免」就等于「整个关掉虚化」。
  check('豁免线以下照旧虚（尺子：不是把虚化整个关掉）',
    blurFor(0, BLUR_EXEMPT - 0.01) > 0, String(blurFor(0, BLUR_EXEMPT - 0.01)));
  // 关掉豁免这一档也要能走（模拟台的 blurExempt 是个开关）。
  check('豁免关掉时，焦点照旧按距离虚', blurFor(0, 1, false) > 0, String(blurFor(0, 1, false)));
  // 量化成 0.5px 一档：filter 一改就要重新栅格化那张卡，量化之后一次滑动只写几次。
  const qs = [0, 20, 40, 60, 80, 100, 130].map((r) => blurFor(r, 0));
  check('量化成 0.5px 一档', qs.every((v) => Math.abs(v * 2 - Math.round(v * 2)) < 1e-9), qs.join(' '));
}

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 条没过`);
process.exit(fail ? 1 : 0);

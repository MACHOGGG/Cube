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
const { damp, chase, settleStep, AXIS_LERP, AXIS_LAMBDA, AXIS_SETTLE_LAMBDA, AXIS_VMAX_ROWS, blurFor, BLUR_EDGE, BLUR_MAX, BLUR_EXEMPT,
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

// ── 滑动阻尼：AXIS_LERP 现在是 0.12（10-08 方案 3-D-4）─────────────────
//
// 玩家拍板，是对上一版「1：无滞后直贴」（2026-09，模拟台上拉到顶）的有意反转。这一段量的是
// 那一档真的生效了：λ 有限、60Hz 下每帧正好追 0.12、停住追齐那个常量也跟着活过来。λ = ∞ 那一
// 档 damp 照旧一帧到位——点点那条路（一比一贴手指）用的就是它。
{
  check('AXIS_LERP 是 0.12（滑动阻尼，10-08 方案 3-D-4）', AXIS_LERP === 0.12, String(AXIS_LERP));
  check('λ 有限，由 0.12 反推', Number.isFinite(AXIS_LAMBDA) && Math.abs(AXIS_LAMBDA + Math.log(1 - 0.12) * 60) < 1e-9,
    String(AXIS_LAMBDA));
  check('60Hz 下每帧正好追 0.12', Math.abs(damp(0, 1, 1000 / 60) - 0.12) < 1e-6, damp(0, 1, 1000 / 60).toFixed(8));
  check('停住追齐那个常量活过来了（λ 的 8 倍）', Number.isFinite(AXIS_SETTLE_LAMBDA) && Math.abs(AXIS_SETTLE_LAMBDA - 8 * AXIS_LAMBDA) < 1e-9,
    String(AXIS_SETTLE_LAMBDA));
  const spots = [1000 / 120, 1000 / 60, 1000 / 30, 5000].map((dt) => damp(0.3, 7, dt, Infinity));
  check('λ = ∞ 下 damp 一帧到位（点点那条路；dt 多少都一样）', spots.every((v) => v === 7), spots.join(' '));
}

// ── 追赶那条路本身：同一段真实时间，帧率不同追到的地方要一样 ────────
//
// 这是 damp 存在的全部理由。写成 `x += (target - x) * 0.1` 的话，同样 100ms 里
// 30Hz 只追回 27.1%、60Hz 46.9%、120Hz 71.8%——开发机上调好的那一点「慢半拍」，
// 到低电量模式的 iPhone 上是拖泥带水，到 120Hz 上几乎不慢。
//
// 量的是默认那个 λ（0.12 反推出来的）。2026-09 到 10-08 那一段默认是 ∞，这一节只好拿 0.1 显式
// 传进去量；现在默认值本身就是一条活的追赶路。
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
  // 切后台回来那一下 dt 可能是几秒：截断到 64ms，不能一帧贴到目标上。
  check(
    'dt 再大也截断在 64ms（切后台回来不会一帧跳到位）',
    Math.abs(damp(0, 1, 5000) - damp(0, 1, 64)) < 1e-12 && damp(0, 1, 5000) < 0.4,
    `dt=5000ms 追了 ${(damp(0, 1, 5000) * 100).toFixed(2)}%`,
  );
}

// ── 高速甩动：任何一帧都走不满一排（10-08 方案 3-D-4）────────────────────
//
// 方案定的规则：「换行必须经过过渡动画——单手势可跨多行，但行切换由弹簧驱动、禁止瞬时置位」，
// 门要「高速甩动帧序列无单帧超一行高的跳变」。光有阻尼不够：damp 每帧走「剩下那段的一个比
// 例」，剩下那段一长，一帧就跨过好几排（0.12 在 30Hz、离目标 6 排时一帧 1.35 排；64ms 那种长
// 帧 2.3 排）。点点那条路（λ = ∞）更直接：手指一帧划多远画面就跳多远。chase() 在阻尼之后按时
// 间封一道速度（AXIS_VMAX_ROWS 排/秒）。
//
// 四条会动画面的路，各在 120 / 60 / 30Hz 和 64ms 长帧上跑一遍，记下每一帧走了多远：
//   ① 拖动追赶：手指一下子指到 6 排外（轴最多 7 排），画面一路追过去；
//   ② 点点那条路：手指在点点上一帧划 3 排，划两帧；
//   ③ 停住追齐：同 ①，但按停住那个 λ（8 倍）追；
//   ④ 松手之后的弹簧（settleStep）：落点最远在画面前头六排——有了拖动阻尼，一把快快地拖过整
//      条轴，画面才追了一两排，落点已经定在最后一排（轴最多 7 排，0 到 6）；初速度带满（3 排/
//      秒，FLING_VMAX），两个方向都试。
// 每一条都还要真的到得了（尺子：不是因为封得太死才「走不满一排」）。
{
  check('封顶的那个速度乘上最长那一帧（64ms）不满一排', AXIS_VMAX_ROWS * 0.064 < 1, `${AXIS_VMAX_ROWS} × 0.064 = ${(AXIS_VMAX_ROWS * 0.064).toFixed(3)}`);
  const RATES = [['120Hz', 1000 / 120], ['60Hz', 1000 / 60], ['30Hz', 1000 / 30], ['64ms', 64]];
  for (const [name, dt] of RATES) {
    // ① ③
    for (const [label, lambda] of [['拖动追赶', AXIS_LAMBDA], ['停住追齐', AXIS_SETTLE_LAMBDA]]) {
      let x = 0, maxStep = 0, t = 0;
      while (t < 3000 && Math.abs(6 - x) > 1e-3) {
        const nx = chase(x, 6, dt, lambda);
        maxStep = Math.max(maxStep, Math.abs(nx - x));
        x = nx;
        t += dt;
      }
      check(`${label} ${name}：单帧最多走 ${maxStep.toFixed(3)} 排（< 1），${(t / 1000).toFixed(2)} 秒到位`,
        maxStep < 1 && Math.abs(6 - x) <= 1e-3, `落在 ${x.toFixed(4)}`);
    }
    // ②
    {
      let x = 0, aim = 0, maxStep = 0, t = 0;
      for (let f = 0; t < 3000 && (f < 2 || Math.abs(aim - x) > 1e-3); f++) {
        if (f < 2) aim += 3;
        const nx = chase(x, aim, dt, Infinity);
        maxStep = Math.max(maxStep, Math.abs(nx - x));
        x = nx;
        t += dt;
      }
      check(`点点一比一 ${name}：手指一帧划 3 排，画面单帧最多走 ${maxStep.toFixed(3)} 排（< 1）`,
        maxStep < 1 && Math.abs(aim - x) <= 1e-3, `落在 ${x.toFixed(4)} / ${aim}`);
    }
    // ④
    for (const [from, to, v0] of [[0, 2.5, 3], [0, 6, 3], [6, 0, -3], [0, 6, -3]]) {
      const sp = createSpring(from);
      sp.velocity = v0;
      let maxStep = 0, t = 0;
      while (t < 3000) {
        const prev = sp.value;
        settleStep(sp, to, dt);
        maxStep = Math.max(maxStep, Math.abs(sp.value - prev));
        t += dt;
      }
      check(`松手弹簧 ${name}（${from} → ${to}，初速 ${v0}）：单帧最多走 ${maxStep.toFixed(3)} 排（< 1）`,
        maxStep < 1 && Math.abs(sp.value - to) < 1e-3, `落在 ${sp.value.toFixed(4)}`);
    }
  }
  // 尺子：上面那一道封顶真的在干活。不封的话，同一把弹簧落后六排、64ms 一帧，单帧要走一排以上——
  // 不然「走不满一排」可能只是因为弹簧本来就软，那这一节量的就不是 settleStep。
  {
    const sp = createSpring(0);
    sp.velocity = 3;
    let maxStep = 0;
    for (let t = 0; t < 3000; t += 64) {
      const prev = sp.value;
      stepSpring(sp, 6, 64);
      maxStep = Math.max(maxStep, Math.abs(sp.value - prev));
    }
    check('尺子：不封顶的弹簧落后六排、64ms 一帧，单帧会走一排以上（所以上面那一道封顶是有用的）', maxStep > 1,
      `${maxStep.toFixed(3)} 排`);
  }
  // 平常那种松手（落点就在一排以内）碰不到封顶：弹簧的手感一点不变。
  {
    const a = createSpring(0), b = createSpring(0);
    a.velocity = b.velocity = 2;
    let same = true;
    for (let t = 0; t < 1500; t += 1000 / 60) {
      stepSpring(a, 0.8, 1000 / 60);
      settleStep(b, 0.8, 1000 / 60);
      if (a.value !== b.value || a.velocity !== b.velocity) same = false;
    }
    check('落点在一排以内时 settleStep 和原样的弹簧逐帧一模一样（玩家调定的手感没被封顶改掉）', same);
  }
  // dt 是 0：λ 无穷大那一支不许算出 NaN（−∞ × 0）。画面位置成了 NaN，整条轴一张卡都画不出来。
  {
    const r = [chase(2.3, 5, 0, Infinity), chase(2.3, 5, 0), chase(2.3, 5, NaN, Infinity)];
    check('dt 为 0（或 NaN）时 chase 原地不动，不出 NaN', r.every((v) => v === 2.3), r.join(' / '));
    const sp = createSpring(1.5);
    sp.velocity = 2;
    settleStep(sp, 4, 0);
    check('dt 为 0 时 settleStep 原地不动', sp.value === 1.5 && sp.velocity === 2, `${sp.value} / ${sp.velocity}`);
  }
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

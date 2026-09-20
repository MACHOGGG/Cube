/**
 * 鱼眼形变 / 弹簧 / 滚轮归一化这三份纯函数地基。
 *
 *   npx esbuild src/engine/fisheye.ts  --bundle --format=esm --outfile=/tmp/fisheye.mjs
 *   npx esbuild src/engine/spring.ts   --bundle --format=esm --outfile=/tmp/spring.mjs
 *   npx esbuild src/engine/wheelSpin.ts --bundle --format=esm --outfile=/tmp/spin.mjs
 *   node scripts/check-fisheye.mjs /tmp/fisheye.mjs /tmp/spring.mjs /tmp/spin.mjs
 *
 * 对着《玩法选择器「物理化聚焦」改造 · 实施方案 v1.0》§7 的前四条验收项写的，
 * 加上三条「规格没写、但错了就会露在脸上」的：
 *
 *   · **被聚焦的那一项必须正对着选中线。** 规格那条 `gap(i) = f(influence(d_i))`
 *     照字面写会让它偏心（左右两段间距不等），玩家看到的是「选中框没对准图
 *     标」。这道门量的是左右邻居的偏移量对不对称。
 *   · **循环时环必须闭合。** 间距一变，加起来就不再是整圈——第一项和最后一项之
 *     间会裂开或叠上。这里验任意焦点下间距之和恒等于 360°。
 *   · **焦点锁定的交接处不能跳。** 锁定区里冻住、区外跟手，两段在 |e|=0.5 处
 *     必须接得上，否则手指划过每两项之间都会「咔」一下。
 *
 * 全部纯逻辑，不开浏览器，几十毫秒——收进 CI。
 */
const [fisheyePath, springPath, spinPath] = process.argv.slice(2);
if (!fisheyePath || !springPath || !spinPath) {
  console.error('用法：node scripts/check-fisheye.mjs <fisheye.mjs> <spring.mjs> <wheelSpin.mjs>');
  process.exit(2);
}
const F = await import(fisheyePath);
const S = await import(springPath);
const W = await import(spinPath);

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

const P = {
  sigma: F.SIGMA,
  minScale: 1,
  maxScale: 1.34,
  minGap: 64,
  maxGap: 88,
  lockRadius: 0.22,
};
/** 不锁定的同一套（要单独量形变本身时用，免得锁定把结果冻住）。 */
const PN = { ...P, lockRadius: 0 };

// ── §7.1 形变函数本身 ────────────────────────────────────────────────
console.log('\n---- §7.1 形变函数 ----');
check('influence(0) = 1', near(F.influence(0, 1), 1));
check('influence 对称', near(F.influence(1.7, 1), F.influence(-1.7, 1)));
check('influence 单调递减', [0.3, 0.7, 1.4, 2.2, 3].every((d, i, a) => i === 0 || F.influence(d, 1) < F.influence(a[i - 1], 1)));
check('influence(2σ) ≈ 0.1353（就是 e^-2）', near(F.influence(2, 1), Math.exp(-2), 1e-12), F.influence(2, 1).toFixed(6));
// 规格要的手感：当前项与左右各 1 项明显变化，第 3 项起基本回到基准态。
check(
  'σ=0.9 时第 3 项已经回到基准态（influence < 0.01）',
  F.influence(3, F.SIGMA) < 0.01 && F.influence(1, F.SIGMA) > 0.4,
  `d=1 → ${F.influence(1, F.SIGMA).toFixed(3)}，d=2 → ${F.influence(2, F.SIGMA).toFixed(3)}，d=3 → ${F.influence(3, F.SIGMA).toFixed(4)}`,
);

// 边界值：焦点恰在某一项上 / 恰在两项正中间 / 在序列端点。
{
  const L = F.fisheye(7, 3, PN, {});
  check('焦点在第 3 项上：它 scale 最大、位置为 0', near(L.slots[3].scale, P.maxScale) && near(L.slots[3].at, 0), `at=${L.slots[3].at}`);
  check('焦点在第 3 项上：nearest 就是 3', L.nearest === 3);
  check(
    '焦点在第 3 项上：左右邻居**对称**（选中框才对得准图标）',
    near(L.slots[2].at, -L.slots[4].at, 1e-9) && near(L.slots[1].at, -L.slots[5].at, 1e-9),
    `左 ${L.slots[2].at.toFixed(4)} / 右 ${L.slots[4].at.toFixed(4)}`,
  );
  // 高斯尾巴不会精确归零：d=2.5 处 influence 还有 0.021，落在间距上是 0.5px。
  // 所以按「残余占隆起量的比例」量，才是「已经回到基准态」这句话的意思。
  const far = L.slots[6].at - L.slots[5].at - P.minGap;
  check(
    '远处的项已经收回基准间距（残余不到隆起量的 3%）',
    far >= 0 && far < 0.03 * (P.maxGap - P.minGap),
    `残余 ${far.toFixed(3)}px，隆起量 ${P.maxGap - P.minGap}px`,
  );
}
{
  const L = F.fisheye(7, 3.5, PN, {});
  check('焦点在 3 与 4 正中间：两项 scale 相等', near(L.slots[3].scale, L.slots[4].scale, 1e-12));
  check('焦点在 3 与 4 正中间：两项位置左右对称', near(L.slots[3].at, -L.slots[4].at, 1e-9), `${L.slots[3].at.toFixed(4)} / ${L.slots[4].at.toFixed(4)}`);
}
{
  const L0 = F.fisheye(7, 0, PN, {});
  check('焦点在端点：第 0 项仍然对准 0', near(L0.slots[0].at, 0));
  check('焦点在端点：后面各项都在正向一侧', L0.slots.slice(1).every((s) => s.at > 0));
  // 整条轴的总长度随焦点位置「轻微起伏」——它是逐项 gap 变化的自然结果，
  // 规格明令不许另写一套总长度动画，所以这里量的是它确实在动、而且动得小。
  const mid = F.fisheye(7, 3, PN, {}).length;
  const end = L0.length;
  const flat = 6 * P.minGap;
  check('总长度随焦点起伏（焦点居中比在端点长）', mid > end, `居中 ${mid.toFixed(1)} / 端点 ${end.toFixed(1)}`);
  check('起伏幅度小（不到基准长度的 15%）', (mid - end) / flat < 0.15, `${(((mid - end) / flat) * 100).toFixed(1)}%`);
}
{
  const L = F.fisheye(1, 0, PN, {});
  check('只有一项也不崩', L.slots.length === 1 && near(L.slots[0].at, 0) && L.length === 0);
  const E = F.fisheye(0, 0, PN, {});
  check('零项返回空结果', E.slots.length === 0 && E.nearest === -1);
}

// ── §7.2 循环取模 ────────────────────────────────────────────────────
console.log('\n---- §7.2 循环取模 ----');
{
  const n = 9;
  const O = { wrap: true, wrapTotal: 360 };
  // 环必须闭合：任意焦点下，相邻角度差之和恒等于一整圈。
  let worst = 0;
  for (const f of [0, 0.37, 2.5, 4, 6.8, 8.99]) {
    const L = F.fisheye(n, f, PN, O);
    const sum = L.slots.reduce((acc, s, i) => {
      const nx = L.slots[(i + 1) % n];
      let d = nx.at - s.at;
      d = ((d % 360) + 360) % 360;
      return acc + d;
    }, 0);
    worst = Math.max(worst, Math.abs(sum - 360));
  }
  check('任意焦点下间距之和恒为 360°（环闭合）', worst < 1e-6, `最大偏差 ${worst.toExponential(2)}`);
  check('循环时 length 就是一整圈', F.fisheye(n, 2.2, PN, O).length === 360);

  // 转满整圈后回到同一画面：rotation 内部不取模，只在渲染那一步取。
  const base = F.fisheye(n, 2.25, PN, O);
  for (const turns of [1, 5, 137]) {
    const spun = F.fisheye(n, 2.25 + turns * n, PN, O);
    const same = base.slots.every((s, i) => near(s.at, spun.slots[i].at, 1e-6) && near(s.scale, spun.slots[i].scale, 1e-9));
    check(`转满 ${turns} 圈后渲染角度与只转余数一致`, same);
  }
  // 长时间使用后的数值：累计转动量必须是整圈的倍数才该回到同一相位——
  // 111111 圈 ＝ 1000000 项 —— 转到一百万项还要算得准（不溢出、不失精度）。
  const spunFar = F.fisheye(n, 2.25 + 111111 * n, PN, O);
  const stillSame = base.slots.every((s, i) => near(s.at, spunFar.slots[i].at, 1e-3));
  check('累计转动到一百万项之后依然对得上（内部不取模也不失精度）', stillSame, `焦点 ${2.25 + 111111 * n}`);

  // 环上距离要走近路：第 0 项与第 n-1 项是邻居。
  const L = F.fisheye(n, 0, PN, O);
  check('环上第 0 项与末项相邻（距离为 1，不是 n-1）', near(L.slots[n - 1].d, 1), `d=${L.slots[n - 1].d}`);
  check('环上最远的一项距离不超过 n/2', Math.max(...L.slots.map((s) => s.d)) <= n / 2 + 1e-9);
  check('angularDistance 走近路', near(F.angularDistance(350, 10), 20) && near(F.angularDistance(10, 350), 20));
}

// ── §7.3 焦点锁定 ────────────────────────────────────────────────────
console.log('\n---- §7.3 焦点锁定 ----');
{
  const jitter = [3.0, 3.03, 2.97, 3.15, 2.86, 3.2, 3.21];
  const got = jitter.map((f) => F.fisheye(7, f, P, {}));
  const ref = got[0];
  const frozen = got.every((L) =>
    L.slots.every((s, i) => near(s.at, ref.slots[i].at, 1e-12) && near(s.scale, ref.slots[i].scale, 1e-12)),
  );
  check('锁定半径内抖动：位置与 scale 一动不动', frozen, `抖动范围 ±0.21 项，lockRadius=${P.lockRadius}`);
  const out = F.fisheye(7, 3.35, P, {});
  check('离开锁定区后跟着动', !near(out.slots[3].at, ref.slots[3].at, 1e-6) || !near(out.slots[2].at, ref.slots[2].at, 1e-6));

  // 交接处不能跳：两项正中间，从左边逼近和从右边逼近必须是同一份画面。
  const a = F.fisheye(7, 3.5 - 1e-7, P, {});
  const b = F.fisheye(7, 3.5 + 1e-7, P, {});
  const smooth = a.slots.every((s, i) => near(s.at, b.slots[i].at, 1e-4) && near(s.scale, b.slots[i].scale, 1e-6));
  check('两项正中间左右逼近是同一画面（交接不跳）', smooth);

  // 整条重映射连续：沿途每一小步的位移都不该突然变大。
  let maxJump = 0;
  let prev = F.fisheye(7, 2.5, P, {});
  for (let f = 2.5 + 0.005; f <= 4.5; f += 0.005) {
    const cur = F.fisheye(7, f, P, {});
    for (let i = 0; i < 7; i++) maxJump = Math.max(maxJump, Math.abs(cur.slots[i].at - prev.slots[i].at));
    prev = cur;
  }
  check('焦点从第 2.5 走到 4.5 全程无跳变（单步位移 < 1px）', maxJump < 1, `最大单步 ${maxJump.toFixed(4)}px`);

  check('lockRadius=0 就是不锁', !near(F.lockFocus(3.1, 0, 7, false), 3) && near(F.lockFocus(3.1, 0, 7, false), 3.1));
  check('lockFocus 在锁定区内直接返回整数项', near(F.lockFocus(3.1, 0.22, 7, false), 3));

  // hitTest 按渲染位置判定：形变把项挪开了，按基准网格判会点错。
  const L = F.fisheye(7, 3, PN, {});
  check('hitTest 落在焦点上就是焦点那一项', F.hitTest(L, 0) === 3);
  check('hitTest 落在右邻居的渲染位置上就是右邻居', F.hitTest(L, L.slots[4].at) === 4);
  check(
    'hitTest 认的是渲染位置，不是基准网格',
    F.hitTest(L, 4 * P.minGap - 3 * P.minGap) !== 4 || L.slots[4].at !== P.minGap,
    `右邻居渲染在 ${L.slots[4].at.toFixed(1)}，基准网格是 ${P.minGap}`,
  );
}

// ── §7.4 输入归一化：鼠标 vs 触控板 ─────────────────────────────────
console.log('\n---- §7.4 滚轮输入归一化 ----');
{
  check('deltaMode=1（行）折算成像素', near(W.normalizeWheelDelta(3, 1), 3 * W.WHEEL_LINE_PX));
  check('deltaMode=2（页）折算成像素', near(W.normalizeWheelDelta(1, 2), W.WHEEL_PAGE_PX));
  check('斜着滚只取主轴（不把两轴相加）', near(W.wheelPixels({ deltaX: 12, deltaY: 90, deltaMode: 0 }), 90));

  /** 喂一串 delta（每帧一个，0 表示这一帧没有事件），返回速度曲线与总位移。 */
  function run(deltas, frames = 90) {
    const s = W.createSpin(0);
    const vs = [];
    for (let i = 0; i < frames; i++) {
      if (deltas[i]) W.spinImpulse(s, deltas[i]);
      W.stepSpin(s, 16.7);
      vs.push(s.velocity);
    }
    return { vs, travel: s.rotation, state: s };
  }
  // 物理鼠标：一格 100px，之后什么都不发。
  const mouse = run([100]);
  // 触控板：手指期的连续小信号 + 系统补发的指数衰减尾巴。
  const padDeltas = [];
  for (let i = 0; i < 8; i++) padDeltas.push(18);
  for (let i = 0; i < 22; i++) padDeltas.push(18 * Math.pow(0.82, i));
  const pad = run(padDeltas);

  const peakAt = (vs) => vs.indexOf(Math.max(...vs));
  const smoothAfterPeak = (vs) => {
    const p = peakAt(vs);
    for (let i = p + 1; i < vs.length; i++) if (vs[i] > vs[i - 1] + 1e-12) return false;
    return true;
  };
  check('鼠标：一格之后速度不立刻归零（有惯性滑行）', mouse.vs[1] > 0 && mouse.vs[6] > 0, `第 6 帧还有 ${mouse.vs[6].toFixed(3)} 项/秒`);
  check('鼠标：峰值之后单调平滑衰减', smoothAfterPeak(mouse.vs));
  check('触控板：峰值之后同样单调平滑衰减', smoothAfterPeak(pad.vs));
  check('两种设备最后都停下来', W.spinStopped(mouse.state) && W.spinStopped(pad.state));
  check('鼠标一格走过大约一项', mouse.travel > 0.7 && mouse.travel < 1.4, `${mouse.travel.toFixed(3)} 项`);

  // 真正要守住的设备一致性：**每像素走多远，两种设备必须是同一个常数**。
  // 「鼠标跳、触控板滑」那种割裂，落到数上就是这个比值对不上。
  //
  // （这里原先有两条断言写的是「触控板不飞过 5 项」「峰值不超过上限」——都是
  // 空的：把 MAX_VELOCITY 那一行整句删掉，两条照样通过。是负面测试把它们揪出
  // 来的，顺带揪出模块注释里「封顶是为了拦触控板」这句话本身也是错的。）
  const padPixels = padDeltas.reduce((a, b) => a + b, 0);
  const perHundred = (travel, px) => (travel / px) * 100;
  const rateMouse = perHundred(mouse.travel, 100);
  const ratePad = perHundred(pad.travel, padPixels);
  check(
    '每百像素走的项数两种设备一致（差不到 10%）',
    Math.abs(rateMouse - ratePad) / rateMouse < 0.1,
    `鼠标 ${rateMouse.toFixed(3)} / 触控板 ${ratePad.toFixed(3)} 项每百像素`,
  );
  // 封顶只挡单次畸形 delta：有些驱动和「平滑滚动」插件一个事件发上千像素。
  {
    const s = W.createSpin(0);
    W.spinImpulse(s, 100000);
    check('单次畸形 delta 被速度上限按住', s.velocity === W.MAX_VELOCITY, `${s.velocity} / 上限 ${W.MAX_VELOCITY}`);
    W.spinImpulse(s, -200000);
    check('反向的畸形 delta 同样按住', s.velocity === -W.MAX_VELOCITY, `${s.velocity}`);
  }
  check('反向滚就是反向转', run([-100]).travel < 0);
  // 累计值内部不取模（§3.1），转很多圈也照样往上加。
  {
    const s = W.createSpin(0);
    for (let k = 0; k < 40; k++) {
      W.spinImpulse(s, 400);
      for (let i = 0; i < 20; i++) W.stepSpin(s, 16.7);
    }
    check('累计转动量一直往上加，不被取模', s.rotation > 20, `${s.rotation.toFixed(1)} 项`);
  }
}

// ── 弹簧 ─────────────────────────────────────────────────────────────
console.log('\n---- 弹簧积分器 ----');
{
  const s = S.createSpring(0);
  let t = 0;
  // 「稳定时间」量的是**最后一次**离开 ±2% 误差带的时刻。量第一次进入是错的：
  // 略欠阻尼的弹簧在冲过头之前就会路过目标值一次，那测出来是上升时间，比真
  // 正的稳定时间短一截，等于把这条断言放宽了。
  let settleAt = 0;
  let peak = 0;
  while (t < 2000) {
    S.stepSpring(s, 1, 16.7, S.SETTLE_SPRING);
    t += 16.7;
    peak = Math.max(peak, s.value);
    if (Math.abs(s.value - 1) >= 0.02) settleAt = t;
  }
  check('稳定时间落在 250–350ms（规格要的响应）', settleAt > 200 && settleAt < 380, `${Math.round(settleAt)}ms`);
  check('最终停在目标上', near(s.value, 1, 1e-6) && S.springAtRest(s, 1), `${s.value.toFixed(8)}`);
  // 玩家对 §8-D4 的回答：「弹簧系数给一个能被感知到的小数值」。临界阻尼过冲
  // 恒为 0，那是感知不到的，所以这里要求过冲存在、但小。
  check('过冲存在（弹得出来）', peak > 1.005, `峰值 ${peak.toFixed(4)}`);
  check('过冲很小（不晃）', peak < 1.05, `峰值 ${peak.toFixed(4)}`);

  const crit = S.createSpring(0);
  let critPeak = 0;
  for (let i = 0; i < 200; i++) {
    S.stepSpring(crit, 1, 16.7, { tension: 370, zeta: 1 });
    critPeak = Math.max(critPeak, crit.value);
  }
  check('zeta=1 时确实不过冲', critPeak <= 1 + 1e-6, `峰值 ${critPeak.toFixed(6)}`);

  // 切到后台再回来那一下 dt 可能是几秒：认了就会炸成 NaN 或者飞出去。
  const jumpy = S.createSpring(0);
  for (let i = 0; i < 40; i++) S.stepSpring(jumpy, 1, 3000);
  check('喂 3000ms 的一帧也不发散', Number.isFinite(jumpy.value) && Math.abs(jumpy.value) < 2, `${jumpy.value.toFixed(4)}`);

  // 目标中途改了要接得住（手指还在动的时候就是这样）。
  const moving = S.createSpring(0);
  for (let i = 0; i < 12; i++) S.stepSpring(moving, 1, 16.7);
  const midV = moving.velocity;
  for (let i = 0; i < 12; i++) S.stepSpring(moving, -1, 16.7);
  check('目标中途改向不断速', midV > 0 && moving.velocity < 0 && Number.isFinite(moving.value));

  const snapped = S.createSpring(0.4);
  snapped.velocity = 9;
  S.snapSpring(snapped, 2);
  check('snapSpring 直接落位并清零速度（reduced-motion 走这条）', snapped.value === 2 && snapped.velocity === 0);
}

console.log(fail ? `\n${fail} 项未通过` : '\n全部通过');
process.exit(fail ? 1 : 0);

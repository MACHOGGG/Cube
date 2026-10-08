/**
 * HUD 那一块《得分图案》画的枚数，必须等于**此刻**的级数——不是解锁之后那一级。
 *
 *   npx esbuild src/engine/erosion.ts --bundle --format=esm --outfile=/tmp/erosion.mjs
 *   npx esbuild src/engine/patternIcon.ts --bundle --format=esm --outfile=/tmp/paticon.mjs
 *   npx esbuild src/engine/targets.ts --bundle --format=esm --outfile=/tmp/targets.mjs
 *   npx esbuild src/engine/targetMatch.ts --bundle --format=esm --outfile=/tmp/match.mjs
 *   node scripts/check-pattern-level.mjs /tmp/erosion.mjs /tmp/paticon.mjs /tmp/targets.mjs /tmp/match.mjs
 *
 * 起因是玩家实测的一条（v1.3.1 的 E25）：**这一块显示的是「解锁之后」那一级，不是当前
 * 这一级**。屏幕上看不出是 off-by-one——四枚和三枚都是一排同色的小方块，差一枚要数才数
 * 得出来，而玩家读到的是「我该凑三枚」，实际规则还要四枚，于是「明明凑好了却不给分」。
 * 方案点名要「以回归测试驱动修复」，这道门就是那个测试。
 *
 * ── 这道门怎么判「当前这一级」是哪一级 ────────────────────────
 *
 * **不问 erosion 自己**，那样就成了「它说它是对的」。改成从**累计翻面枚数**推：《侵蚀
 * 阶梯》§2 那张表写死了三级的段数（方块 [31,3,2]），而「每翻一枚扣一段、段尽降一级」是
 * 规则原文——所以
 *
 *     翻了 0…s₄−1 枚 → 4 枚级
 *     翻了 s₄…s₄+s₃−1 枚 → 3 枚级
 *     翻了 s₄+s₃…s₄+s₃+s₂−1 枚 → 2 枚级
 *     翻满 s₄+s₃+s₂（= 全盘枚数）枚 → 1 枚级
 *
 * 这张表这道门自己写一份（就是 §2 的字面值），不从 erosion 读——两边对不上就是有一头
 * 错了，而这正是要问的。（表本身对不对由 check-erosion.mjs 逐行复算，它在 CI 里。）
 *
 * ── 量三样，因为嫌疑有三个 ─────────────────────────────────
 *
 * ① `erosion.spend()` 一枚一枚喂到底：每一枚之后的 level 必须等于上面那张表说的。
 * ② `runPatternDef(family, level)` 画出来的图形个数必须**正好等于 level**。基础玩法那一
 *    块画的就是它——这一头错一枚，屏幕上就是少一枚或多一枚。
 * ③ 老虎机那一路（`sizeAtLevel` + `erodedFace`）：第 4 级必须是目标本身，往下每级少一
 *    枚、下限 1，而且 `erodedFace` 吐出来的格子数必须等于 `sizeAtLevel`。两个函数各算一
 *    遍「几枚」，对不上就是画的和判的不是同一件事。
 *
 * 末位那一枚的淡出下限也在这儿钉住（E24 把 0.15 提到 0.45）：0.15 的时候那一枚几乎看不
 * 见，四枚读起来就是三枚——这是同一个 bug 的另一半，而且是**看起来**的那一半。
 */
const E = await import(process.argv[2]);
const P = await import(process.argv[3]);
const T = await import(process.argv[4]);
const M = await import(process.argv[5]);

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/**
 * 侵蚀阶梯那张表的字面值，这道门自己抄一份。2026-10 二版（10-08 方案 3-A）：三级合计
 * 小于全盘枚数，余下的是 1×1 那一段。
 *
 * 抄一份而不是 import，是这道门成立的前提：它要问的就是「erosion 那边的级数和规则说的
 * 对不对得上」，两边读同一个常量的话这一问就没有了。
 */
const LADDER = {
  square: [15, 11, 6],
  circle: [12, 8, 5],
  squareDiamond: [15, 11, 6],
  triangleBig: [20, 15, 11],
  circleHex: [15, 11, 6],
  circleSeven: [18, 14, 10],
};
const TILES = { square: 36, circle: 28, squareDiamond: 36, triangleBig: 54, circleHex: 36, circleSeven: 49 };

/** 翻了 n 枚之后，按规则原文该是第几枚级。 */
function levelAfter(seg, n) {
  const [s4, s3, s2] = seg;
  if (n < s4) return 4;
  if (n < s4 + s3) return 3;
  if (n < s4 + s3 + s2) return 2;
  return 1;
}

// ---- ① erosion 的级数 = 规则说的级数 -----------------------------------
for (const [id, seg] of Object.entries(LADDER)) {
  const total = TILES[id];
  // 尺子：下面那一趟翻到全盘为止，三级合计得在全盘之内（二版：严格小于，余下的是 1×1
  // 那一段），不然那一趟根本走不到 1 枚级，「每一步都对得上」就只验了前几级。
  check(`${id}：段数合计 < 全盘枚数、1×1 那一段至少 3 枚（尺子，不然下面那一趟到不了 1 枚级）`,
    total - (seg[0] + seg[1] + seg[2]) >= 3, `${seg.join('+')} = ${seg[0] + seg[1] + seg[2]} / ${total}`);
  const ero = E.createErosion({ seg, par: 1 });
  const bad = [];
  check(`${id}：一枚没翻的时候是 4 枚级`, ero.level() === 4, String(ero.level()));
  for (let n = 1; n <= total; n++) {
    ero.spend(1);
    const want = levelAfter(seg, n);
    if (ero.level() !== want) bad.push(`翻满 ${n} 枚：erosion 说 ${ero.level()}，规则说 ${want}`);
  }
  check(`${id}：一枚一枚翻到底，每一步的级数都和规则对得上`, bad.length === 0, bad.slice(0, 3).join(' · '));
  // 反面尺子：这个循环真的跨过了每一级，不然上面那一条只验了「一直是 4 枚」。
  const ero2 = E.createErosion({ seg, par: 1 });
  const seen = new Set([ero2.level()]);
  for (let n = 1; n <= total; n++) { ero2.spend(1); seen.add(ero2.level()); }
  check(`${id}：这一趟真的跨过了四个级别（尺子）`,
    [4, 3, 2, 1].every((l) => seen.has(l)), [...seen].join(','));
}

// 一步翻好几枚（结转）也要落在同一张表上——玩家最容易撞到 off-by-one 的正是这一下。
for (const [id, seg] of Object.entries(LADDER)) {
  const total = TILES[id];
  for (const step of [2, 3, 5, 7]) {
    const ero = E.createErosion({ seg, par: 1 });
    let n = 0;
    let bad = null;
    while (n < total) {
      const take = Math.min(step, total - n);
      ero.spend(take);
      n += take;
      const want = levelAfter(seg, n);
      if (ero.level() !== want && !bad) bad = `翻满 ${n} 枚（每步 ${take}）：${ero.level()} vs ${want}`;
    }
    check(`${id}：每步翻 ${step} 枚（走结转）级数照样对`, bad === null, bad || '');
  }
}

// ---- ② 基础玩法那一块画几枚 --------------------------------------------
{
  const bad = [];
  for (const family of ['square', 'circle', 'triangle']) {
    for (const level of [4, 3, 2, 1]) {
      const def = P.runPatternDef(family, level);
      if (def.cells.length !== level) bad.push(`${family} 第 ${level} 枚级画了 ${def.cells.length} 个`);
      if (def.label !== `1×${level}`) bad.push(`${family} 第 ${level} 枚级的名字是 ${def.label}`);
    }
  }
  check('1×N 图标：画出来的图形个数正好等于级数（三族 × 四级）', bad.length === 0, bad.join(' · '));
  // 反面尺子：拿一个错的级数问，它就该画出别的个数——不然上面那一条是恒真的。
  check('（尺子）问第 5 枚级就画 5 个', P.runPatternDef('square', 5).cells.length === 5);
}

// ---- ③ 老虎机那一路：sizeAtLevel 和 erodedFace 说的是同一件事 ------------
{
  const bad = [];
  for (const t of T.TARGETS) {
    const n = t.cells.length;
    for (const level of [4, 3, 2, 1]) {
      const want = Math.max(1, n - (4 - level));
      const size = T.sizeAtLevel(t, level);
      if (size !== want) bad.push(`${t.id} 第 ${level} 级：sizeAtLevel ${size}，该是 ${want}`);
      const face = M.erodedFace(t, size);
      if (face.cells.length !== size) bad.push(`${t.id} 第 ${level} 级：画了 ${face.cells.length} 枚，该 ${size} 枚`);
    }
    if (T.sizeAtLevel(t, 4) !== n) bad.push(`${t.id}：第 4 级不是目标本身`);
  }
  check('老虎机：sizeAtLevel 和 erodedFace 每一级都说同一个枚数', bad.length === 0, bad.slice(0, 3).join(' · '));
}

// ---- 末位那一枚：**整枚在，或者整枚没了** -------------------------------
//
// 这一条量的是**源码**，不是行为：那一枚确实一直在（级数是对的，上面逐级验过），错的
// 是「看起来」——任何喂函数的测试都抓不到。
//
// 历史：原先末位那一枚跟着本级剩余段数线性淡下去（1 → 0.15），玩家读成了 off-by-one
// （「显示的是解锁之后那一级」）；E24 把下限抬到 0.45，淡得没那么狠，但题还在——一排
// 四枚里有一枚是半透明的，数出来是几枚仍然要想一下。玩家 2026-10 直接拍板：「切换的时
// 候逐一取出就好」。
//
// 所以现在钉的是反面：`paintIcon` 里**不许再有逐枚设透明度那段**。只要那段回来，这一
// 条就红。
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/ui/patternBlock.ts', import.meta.url), 'utf8');
  const paint = src.match(/function paintIcon\([\s\S]*?\n  \}/);
  check('patternBlock 里读得到 paintIcon（尺子：读不到下面那条是恒真的）', Boolean(paint),
    paint ? `${paint[0].split('\n').length} 行` : '（找不到）');
  check('paintIcon 不再逐枚设透明度（「逐一取出」：整枚在，或者整枚没了）',
    Boolean(paint) && !/opacity/.test(paint[0]), paint ? (paint[0].match(/.*opacity.*/) || [''])[0].trim() : '');
  check('整个文件里也没剩下末位淡出的那个常量', !/TAIL_MIN_OPACITY/.test(src));
}

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项没过`);
process.exit(fail ? 1 : 0);

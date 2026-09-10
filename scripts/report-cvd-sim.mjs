/**
 * 色盲开关**关着**的时候，棋子的颜色对色盲玩家还分不分得开。
 *
 *   node scripts/report-cvd-sim.mjs
 *
 * 这是一台**体检台，不是一道门**：它永远返回 0，只把数字摆出来。因为它量出
 * 来的东西现在还没有一个「对」的答案——标准配色对二色觉确实不友好（见下面
 * 的数），而要不要为此把八副棋盘的颜色全换掉，是玩家拍板的事，不是脚本能替
 * 他决定的。等颜色定了，把 REPORT 改回 check 并让它判定，就是一道门。
 *
 * 为什么单开一道门：站里原来那把尺子（CIEDE2000 ≥20 / 离底板 ≥28）量的是
 * 「正常三色视觉」下的可辨识度。它是对的，但它管不到二色觉——一对在正常眼睛
 * 里差 30 的红和绿，在红绿色盲眼里可能只差 3。巡检的原话：「CIEDE2000 门槛
 * 验证的是"正常三色视觉"下的可辨识度；不能替代色盲模拟」。
 *
 * 而这件事真正要紧的地方在于：站里**有**一套色盲配色，可它是个开关，默认关
 * 着。一个没找到那个开关、或者压根不知道自己有轻度色弱的玩家，看的一直是这
 * 套标准配色。所以这道门量的是「关着的时候」。
 *
 * 怎么量：
 *   sRGB → 线性 RGB → 三种二色觉的模拟矩阵（Machado, Oliveira & Fernandes
 *   2009，severity 1.0：红色盲 protan、绿色盲 deutan、蓝黄色盲 tritan）
 *   → 回到 Lab → 两两算 CIEDE2000。
 *
 * 门槛：模拟之后棋子彼此 ≥10，离底板（#3D3128，游戏页那块地板）≥15。
 * 这两个数比正常视觉那套（20 / 28）松，是有意的——二色觉本来就把一整个维度
 * 压没了，拿同一把尺子量等于要求「色盲看着也像正常人一样鲜艳」，那不可能，
 * 也不是玩家要的。要的是「不至于两两难以区分」：10 大约是「并排放着看得出不
 * 是一个颜色」，再低就只能靠位置猜了。
 *
 * 三套配色（现在线上这套 now、天才可选的甲和丙）× 八个玩法各自用几支，全都
 * 量一遍。颜色直接从源文件里读，读的就是线上跑的那几行——抄一份到脚本里，改
 * 了颜色这道门不会红，那就白设了。
 */
import { readFileSync } from 'node:fs';

let below = 0;
const line = (n, ok, extra = '') => {
  console.log(`${ok ? '  ok ' : '低于门槛'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) below++;
};

// ---- 颜色从源文件里读 -------------------------------------------------------

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const arrayAfter = (text, key) => {
  const m = text.match(new RegExp(key + "\\s*:\\s*\\[([^\\]]*)\\]"));
  if (!m) throw new Error('读不到 ' + key);
  return [...m[1].matchAll(/#[0-9a-fA-F]{6}/g)].map((x) => x[0].toLowerCase());
};

/** 八个玩法各自那套标准配色（色盲开关关着时用的就是它）。 */
const BOARDS = [
  ['基础方块', 'src/shapes/square.ts'],
  ['菱形方块', 'src/shapes/squareDiamond.ts'],
  ['基础小球', 'src/shapes/circle.ts'],
  ['六边小球', 'src/shapes/circleHex.ts'],
  ['七色圆球', 'src/shapes/circleSeven.ts'],
  ['基础三角', 'src/shapes/triangle.ts'],
  ['大三角', 'src/shapes/triangleBig.ts'],
  ['进阶三角', 'src/shapes/triangleAdvanced.ts'],
].map(([name, file]) => ({
  name,
  colors: arrayAfter(read(file), 'standard'),
  // 开关打开之后那一套（Okabe–Ito 那几支，本来就是为二色觉挑的）。摆在一起
  // 是为了看清「开关到底顶不顶用」——顶用，那问题就只在「默认关着」这件事上。
  cvd: arrayAfter(read(file), 'colorblind'),
}));

/** 天才那两套。它们是按「贪心最远点」排过序的，所以直接切前 N 支。 */
const pref = read('src/engine/palettePref.ts');
const VARIANTS = { 甲: arrayAfter(pref, 'jia'), 丙: arrayAfter(pref, 'bing') };

/** 游戏页那块地板。 */
const PANEL = '#3d3128';

// ---- 色彩学 -----------------------------------------------------------------

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

/**
 * 二色觉的模拟矩阵，作用在线性 RGB 上。
 * Machado, Oliveira & Fernandes (2009)，severity 1.0。
 */
const SIM = {
  正常: null,
  红色盲: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  绿色盲: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.011820, 0.042940, 0.968881],
  蓝黄色盲: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.303900],
};

function simulate(h, m) {
  const [r, g, b] = hex(h).map(toLinear);
  if (!m) return [r, g, b];
  return [
    clamp01(m[0] * r + m[1] * g + m[2] * b),
    clamp01(m[3] * r + m[4] * g + m[5] * b),
    clamp01(m[6] * r + m[7] * g + m[8] * b),
  ];
}

/** 线性 RGB → Lab（D65）。 */
function lab(lin) {
  const [r, g, b] = lin.map((c) => toSrgb(clamp01(c))).map(toLinear);
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const Y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
  const Z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const [fx, fy, fz] = [f(X), f(Y), f(Z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIEDE2000。照 Sharma, Wu & Dalal (2005) 那份实现写的。 */
function ciede2000([L1, a1, b1], [L2, a2, b2]) {
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1;
  const ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1);
  const Cp2 = Math.hypot(ap2, b2);
  const hp = (b, ap) => {
    if (b === 0 && ap === 0) return 0;
    const h = Math.atan2(b, ap) / rad;
    return h < 0 ? h + 360 : h;
  };
  const hp1 = hp(b1, ap1);
  const hp2 = hp(b2, ap2);
  const dLp = L2 - L1;
  const dCp = Cp2 - Cp1;
  let dhp = 0;
  if (Cp1 * Cp2 !== 0) {
    dhp = hp2 - hp1;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dhp / 2) * rad);
  const Lbp = (L1 + L2) / 2;
  const Cbp = (Cp1 + Cp2) / 2;
  let hbp = hp1 + hp2;
  if (Cp1 * Cp2 !== 0) {
    if (Math.abs(hp1 - hp2) > 180) hbp += hbp < 360 ? 360 : -360;
    hbp /= 2;
  }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad)
    + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.20 * Math.cos((4 * hbp - 63) * rad);
  const dTh = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTh * rad) * Rc;
  return Math.sqrt(
    (dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh),
  );
}

const dist = (h1, h2, m) => ciede2000(lab(simulate(h1, m)), lab(simulate(h2, m)));

// ---- 量 ---------------------------------------------------------------------

/** 模拟之后：棋子彼此、棋子离底板，各自的门槛。 */
const PAIR_MIN = 10;
const PANEL_MIN = 15;

function measure(label, colors) {
  for (const [vision, m] of Object.entries(SIM)) {
    let worstPair = { d: Infinity, a: '', b: '' };
    for (let i = 0; i < colors.length; i++) {
      for (let j = i + 1; j < colors.length; j++) {
        const d = dist(colors[i], colors[j], m);
        if (d < worstPair.d) worstPair = { d, a: colors[i], b: colors[j] };
      }
    }
    let worstPanel = { d: Infinity, a: '' };
    for (const c of colors) {
      const d = dist(c, PANEL, m);
      if (d < worstPanel.d) worstPanel = { d, a: c };
    }
    // 正常视觉那一档只打印不判定——它由站里原来那套门槛管着，这里列出来是为了
    // 一眼看出「同一套颜色，二色觉下掉了多少」。
    const note = `最近一对 ${worstPair.a}/${worstPair.b} ${worstPair.d.toFixed(1)}，离底板最近 ${worstPanel.a} ${worstPanel.d.toFixed(1)}`;
    if (vision === '正常') {
      console.log(`      ${label} · ${vision}  ${note}`);
      continue;
    }
    line(`${label} · ${vision}`, worstPair.d >= PAIR_MIN && worstPanel.d >= PANEL_MIN, note);
  }
}

console.log('色盲开关**关着**的时候，三套配色在二色觉下还分不分得开');
console.log(`门槛：棋子彼此 ≥${PAIR_MIN}，离底板（${PANEL}）≥${PANEL_MIN}\n`);

console.log('════ 一、开关关着（默认）：八副棋盘的标准配色 ════\n');
for (const b of BOARDS) {
  console.log(`— ${b.name}（${b.colors.length} 支）`);
  measure(b.name, b.colors);
}

console.log('\n════ 二、开关打开：同样八副，色盲配色 ════\n');
for (const b of BOARDS) {
  console.log(`— ${b.name}·色盲（${b.cvd.length} 支）`);
  measure(`${b.name}·色盲`, b.cvd);
}

console.log('\n════ 三、天才那两套（也是开关关着时用的） ════\n');
for (const [name, all] of Object.entries(VARIANTS)) {
  // 各玩法用几支就切几支：4 / 5 / 6 / 7 覆盖了八副棋盘的全部档位。
  for (const n of [4, 5, 6, 7]) {
    console.log(`— ${name}·前 ${n} 支`);
    measure(`${name}·前 ${n} 支`, all.slice(0, n));
  }
}

console.log(`\n低于门槛的：${below} 处。这是体检不是判卷——数字交给玩家定夺，脚本一律返回 0。`);
process.exit(0);

/**
 * 《Pro》这个设置：开关在哪儿、记在哪儿、以及棋盘上那一圈描的是**哪一个**颜色。
 *
 *   node scripts/check-pro.mjs
 *
 * 不起服务器、不开浏览器、不打包：读的是源码本身。理由和 check-shape-registry 一样
 * ——这件事的要害是「八副棋盘会不会有一副写错」，而写错了不报错、不白屏，只是那一副
 * 棋盘上的提示**说了假话**：描的要是 `tile.color`（它现在的颜色），那圈线就成了「你
 * 现在是什么颜色」——一句所有人一眼就能看见、根本不需要提示的废话，而玩家要的是
 * 「得分之后会变成什么颜色」（`tile.dotColor`）。两者在屏幕上都是一圈彩色的线，谁也
 * 看不出来哪一副错了。
 *
 * 界面那一半（真的画出来没有、开关拨得动没有）由 check-pro-ui.mjs 管，那一道要开浏
 * 览器。
 */
import { readFileSync } from 'node:fs';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// ---- ① 设置本身 ---------------------------------------------------------
{
  const mod = read('src/engine/proMode.ts');
  check('设置记在本机（slides_pro）', /const KEY = 'slides_pro'/.test(mod));
  check('挂到 <html> 上（样式表跟着它走）', /setAttribute\('data-pro', '1'\)/.test(mod) && /removeAttribute\('data-pro'\)/.test(mod));
  check('默认是关的（读不到就当没开）', /return localStorage\.getItem\(KEY\) === '1'/.test(mod));
  check('存不下也不崩（无痕模式）', /catch \{[\s\S]{0,120}return false/.test(mod));
}

// ---- ② 两处开关：个人主页、暂停面板 -------------------------------------
{
  const acct = read('src/ui/accountPage.ts');
  const shell = read('src/ui/gameShell.ts');
  // 玩家 2026-09：「开启的形式和情况和现在的色盲友好模式一样」——所以这两处都得有，
  // 而且和色盲那一条长得一样（同一套 pill-switch）。
  check('个人主页上有这颗开关，和色盲那条同一副样子',
    /id="proRow"[\s\S]{0,200}pill-switch/.test(acct) && /role="switch" aria-checked="\$\{proOn\(\)\}"/.test(acct));
  check('个人主页上那颗拨得动', /on\('proRow'[\s\S]{0,120}setPro\(!proOn\(\)\)/.test(acct));
  check('暂停面板里也有一颗，同一副样子',
    /id="proBtn"[\s\S]{0,200}pill-switch/.test(shell));
  check('暂停面板里那颗拨得动', /proBtn\?\.addEventListener\('click'[\s\S]{0,120}setPro\(!proOn\(\)\)/.test(shell));
  // 两处写的是同一个词（i18n 的 proBtn），不是各写各的。
  check('两处用的是同一句文案（s.proBtn）',
    /\$\{s\.proBtn\}/.test(acct) && /\$\{s\.proBtn\}/.test(shell));
}

// ---- ③ 四种语言都写了 ---------------------------------------------------
{
  const i18n = read('src/i18n.ts');
  const hits = i18n.match(/^ {4}proBtn: '[^']+',$/gm) ?? [];
  check('四种语言都写了 proBtn', hits.length === 4, `${hits.length} 处：${hits.map((h) => h.trim()).join(' ')}`);
  check('接口里声明了 proBtn', /^ {2}proBtn: string;$/m.test(i18n));
}

// ---- ④ 八副棋盘描的都是「将来那一颗星星」的颜色 -------------------------
{
  const BOARDS = {
    square: 'proSquareRing', squareDiamond: 'proSquareRing',
    circle: 'setProHint', circleHex: 'setProHint', circleSeven: 'setProHint',
    triangle: 'proTriRing', triangleBig: 'proTriRing', triangleAdvanced: 'proTriRing',
  };
  let wired = 0;
  for (const [name, fn] of Object.entries(BOARDS)) {
    const src = read(`src/shapes/${name}.ts`);
    const called = src.includes(fn + '(');
    // **要害在这一条**：描的是 dotColor（得分之后那一面），不是 color（现在这一面）。
    const usesDot = new RegExp(`${fn}\\([^;]*COLORS\\[tile\\.dotColor\\]`).test(src);
    const notNow = !new RegExp(`${fn}\\([^;]*COLORS\\[tile\\.color\\]`).test(src);
    // 翻过面的、空位的没有这件事可说，不许给它们描。
    const onlyFlavor = /tile\.face !== 'flavor' \? null :/.test(src) || /tile\.face === 'flavor'/.test(src);
    check(`[${name}] 描的是得分之后那颗星星的颜色`, called && usesDot && notNow && onlyFlavor,
      `调用:${called} dotColor:${usesDot} 没用 color:${notNow} 只描正面:${onlyFlavor}`);
    if (called && usesDot && notNow && onlyFlavor) wired++;
  }
  // 尺子：八副一副都不能少（少一副的那一副在屏幕上只是「没有提示」，不报错）。
  check('八副棋盘一副都没落下', wired === 8, `${wired}/8`);
}

// ---- ⑤ 真画进 DOM 的那几副，拨开关要重画 --------------------------------
{
  // 方块和三角那一圈是真节点（虚线的节奏、三角的轮廓都不是 CSS 画得出来的），所以它
  // 们只在开着 Pro 的时候建——那就必须接上 onProChange，不然拨了开关要等下一步棋才
  // 看得见。小球那一圈纯 CSS，不需要。
  for (const name of ['square', 'squareDiamond', 'triangle', 'triangleBig', 'triangleAdvanced']) {
    const src = read(`src/shapes/${name}.ts`);
    check(`[${name}] 拨开关当场重画`, /onProChange\(\(\) => \{[\s\S]{0,120}render\(\)/.test(src) && /stopPro\(\)/.test(src));
  }
  for (const name of ['circle', 'circleHex', 'circleSeven']) {
    const src = read(`src/shapes/${name}.ts`);
    // 小球那一版不许接：接了等于白重画一遍棋盘（CSS 已经跟着 data-pro 变了）。
    check(`[${name}] 小球那一版不用重画（纯 CSS）`, !src.includes('onProChange'));
  }
}

// ---- ⑥ 线宽：细，而且跟着棋子大小走 -------------------------------------
{
  const hint = read('src/engine/proHint.ts');
  const ratio = Number(/const W_RATIO = ([\d.]+)/.exec(hint)?.[1]);
  const min = Number(/const W_MIN = ([\d.]+)/.exec(hint)?.[1]);
  // 玩家：「不能太粗，需要是明显知道是非常次要的色彩信息」。那三张参考图上量到的是
  // 棋子的 2%–4%。
  check('线宽是棋子的 2%–4%', ratio >= 0.02 && ratio <= 0.04, String(ratio));
  check('再细也不低于 1px（低于就等于没画）', min >= 1 && min <= 2, String(min));
  check('线宽跟着棋子大小走，不是写死的像素', /Math\.max\(W_MIN, .*size \* W_RATIO/.test(hint));
}

console.log(fail ? `\n${fail} 条没过` : '\n全过');
process.exit(fail ? 1 : 0);

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
    circle: 'proCircleRing', circleHex: 'proCircleRing', circleSeven: 'proCircleRing',
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

// ---- ⑤ 八副都是真画进 DOM 的，所以拨开关都要重画 ------------------------
{
  // 三族的那一圈都是 SVG 描边（虚线的节奏 CSS 的 border-style: dashed 定不了，见
  // proHint.ts 开头那段），所以它们只在开着 Pro 的时候建——那就必须接上 onProChange，
  // 不然拨了开关要等下一步棋才看得见，而开关就摆在暂停面板里，拨完一抬头正是棋盘。
  for (const name of Object.keys({
    square: 1, squareDiamond: 1, circle: 1, circleHex: 1, circleSeven: 1,
    triangle: 1, triangleBig: 1, triangleAdvanced: 1,
  })) {
    const src = read(`src/shapes/${name}.ts`);
    check(`[${name}] 拨开关当场重画`, /onProChange\(\(\) => \{[\s\S]{0,120}render\(\)/.test(src) && /stopPro\(\)/.test(src));
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
  const max = Number(/const W_MAX = ([\d.]+)/.exec(hint)?.[1]);
  // 玩家 2026-09：「三角的边框太粗」。三角的棋子比另外两族大得多（一条边一百来像
  // 素），按比例算会到 3px 以上——这条上限把三族拉到同一个观感。
  check('有上限，再大的棋子也不会描粗', max >= 1.5 && max <= 2.5, String(max));
}

// ---- ⑦ 虚线的节奏：三族各一副，都是照设计图量出来的 ---------------------
{
  const hint = read('src/engine/proHint.ts');
  const dash = (name) => /([\d.]+) ([\d.]+)/.exec(new RegExp(`const ${name} = '([^']+)'`).exec(hint)?.[1] ?? '');
  // 玩家 2026-09：「严格参考设计图上虚线在边上呈现的线段数量和位置」。三族的段数是
  // 量出来的：方块一条边两段（四条边共八段，角上那几段跨过拐角）、小球两段（缺口在
  // 正上和正下）、三角一条边一段。写成 pathLength=100 上的份数之后，「几段」就是
  // 100 ÷（段+缺）——这一条算给它看，翻新节奏的时候不至于把段数改飞。
  for (const [name, want] of [['SQUARE_DASH', 8], ['CIRCLE_DASH', 2], ['TRI_DASH', 3]]) {
    const m = dash(name);
    const n = m ? 100 / (Number(m[1]) + Number(m[2])) : 0;
    check(`${name} 排出来是 ${want} 段`, Math.abs(n - want) < 0.1, m ? `段 ${m[1]} 缺 ${m[2]} → ${n.toFixed(2)} 段` : '没找到');
  }
  check('三族都写了 pathLength（份数和棋子大小无关）', /pathLength', '100'/.test(hint));
  check('三族都是虚线（有 dasharray）', /stroke-dasharray/.test(hint));
}

// ---- ⑧ 得分图示那一圈描边：浅色描黑、深色描白 ---------------------------
{
  /*
   * 玩家 2026-09：「在浅色模式的时候得分图案的边框需要是黑色的，在深色模式的时候才是
   * 白色的。」那正是 :root 上 --mark-edge 的定义。
   *
   * 这一条守在这儿，是因为它正是被这一轮改动碰坏过的：上一版为了去掉「不该出现的黑
   * 边」，把棋盘上方那一排图示的 --mark-edge 改成了底色——描出来是一道看不见的缝，玩
   * 家要的黑边没了。真正该去掉的黑边是另外两处（翻成星星的棋子留下的幽灵边、iOS 上
   * 合成出来的方框），各自修在别处。
   */
  const css = read('src/style.css');
  check('浅色那一套描的是深色', /^ {2}--mark-edge: #2E2430;$/m.test(css));
  const darkHits = (css.match(/--mark-edge: #FFFFFF;/g) ?? []).length;
  check('深色那几套描的是白色', darkHits >= 2, `${darkHits} 处`);
  // 不许再有人把它按到底色上（那等于没画）。老虎机那一窗例外：它的底是白的，而且玩
  // 家点名要「同样的圆角黑边」，所以它自己写死了一个深色。
  const overrides = (css.match(/--mark-edge: var\(--(?:play-)?bg\)|--mark-edge: var\(--surface\)/g) ?? []);
  check('没有人把它按成底色（那等于没画）', overrides.length === 0, overrides.join(' '));
  check('老虎机那一窗照旧自己写死深色（玩家点名要的）', /\.slot-reel \{[\s\S]{0,400}--mark-edge: #2E2430;/.test(css));
}

console.log(fail ? `\n${fail} 条没过` : '\n全过');
process.exit(fail ? 1 : 0);

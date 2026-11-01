/**
 * 暂停｜灯泡那块牌分两半时的样子——读 style.css，不开浏览器（11-01 补充方案推15B）。
 *
 *   node scripts/check-bulb-geometry.mjs
 *
 * 推12（Z-J03）只写了 `.stop-btn--split-h .ctl-glyph { width: 58% }`：图形收窄了，可 #stopBtn 是居中的弹性盒
 * （justify-content: center），收窄了的图形照旧摆在整颗正中——压在分缝上（390 竖屏偏 37px、320 偏 30px、电脑偏 51.5px）。
 * 灯泡那一半 `border-radius: 0`，按下去换了底色就露出两个直角；电脑上暂停没有圆盘，灯泡却还画着。浏览器那一半由
 * check-hint-bulb ⑨–⑬ 量（那道在 CI 的 h 片，等它要十几分钟）；这一道零点几秒，在 check 那一条里先拦：
 *
 *   ① 分两半时 #stopBtn 的主轴不是 center：split-h 那一条 justify-content、split-v 那一条 align-items 都是 flex-start，
 *      图形 flex: none（不许被拉伸回整颗）；
 *   ② #hintBtn 的圆角不是 0：左右分时右两角、上下分时下两角是 .controls .icon-btn 那个圆角；
 *   ③ 电脑档（min-width 1000 且 min-height 561）里灯泡和暂停的 --ctl-disc 一样（都是 transparent），按下时记号同色；
 *   ④ 照这几条算一遍几何（各档 #stopBtn 的宽高、4px 内边距、图形 58%、svg 按 meet 居中、暂停两根条在 viewBox 的
 *      35–65、灯泡占右 round(0.42·宽)）：两根条的并框中心离左半正中 ≤ 4、右沿离灯泡 > 2；尺子：同样的数按 center
 *      排（推12 那样）必须不过——不然这一节量不出那个毛病。
 *
 * 方案说这一道「照 sim1031/bulb-geom.mjs」写，那份参照没随补充方案附来；④ 的模型照方案正文和 ctlIcons.ts 的
 * viewBox 自己写。
 */
import { readFileSync } from 'node:fs';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const RAW = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
// 去掉注释（注释里提到旧写法不算），保留换行好报行号。
const CSS = RAW.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/** 顶层和 @media 里的每一条规则：{ media, sel, body }。只认一层 @media（这个文件就这么写）。 */
function rules(css) {
  const out = [];
  let i = 0;
  const stack = [];
  let start = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '{') {
      const head = css.slice(start, i).trim();
      stack.push(head);
      start = i + 1;
    } else if (ch === '}') {
      const head = stack.pop();
      if (head !== undefined && !head.startsWith('@')) {
        out.push({ media: stack.filter((h) => h.startsWith('@media')).join(' '), sel: head, body: css.slice(start, i) });
      }
      start = i + 1;
    }
    i++;
  }
  return out;
}
const ALL = rules(CSS);
const DESK = '@media (min-width: 1000px) and (min-height: 561px)';
/** 选择器（按逗号拆开）里有这一句的规则里，这个属性最后一次写成什么。 */
function last(selector, prop, media = '') {
  let v = null;
  for (const r of ALL) {
    if (r.media !== media) continue;
    if (!r.sel.split(',').map((x) => x.trim().replace(/\s+/g, ' ')).includes(selector)) continue;
    const m = new RegExp(`(?:^|;|\\s)${prop.replace(/[-]/g, '\\-')}\\s*:\\s*([^;]+)`).exec(r.body);
    if (m) v = m[1].trim();
  }
  return v;
}

// ── ① 主轴不是 center ────────────────────────────────────────────────────────────
const H = '.app--game .controls #stopBtn.stop-btn--split-h';
const V = '.app--game .controls #stopBtn.stop-btn--split-v';
check('① 左右分：#stopBtn 的 justify-content 是 flex-start（不是 center）', last(H, 'justify-content') === 'flex-start', String(last(H, 'justify-content')));
check('① 上下分：#stopBtn 的 align-items 是 flex-start（不是 center）', last(V, 'align-items') === 'flex-start', String(last(V, 'align-items')));
check('① 左右分：图形 58% 宽、flex: none', last(`${H} .ctl-glyph`, 'width') === '58%' && last(`${H} .ctl-glyph`, 'flex') === 'none',
  `width ${last(`${H} .ctl-glyph`, 'width')} · flex ${last(`${H} .ctl-glyph`, 'flex')}`);
check('① 上下分：图形 58% 高、flex: none', last(`${V} .ctl-glyph`, 'height') === '58%' && last(`${V} .ctl-glyph`, 'flex') === 'none',
  `height ${last(`${V} .ctl-glyph`, 'height')} · flex ${last(`${V} .ctl-glyph`, 'flex')}`);

// ── ② 灯泡那一半的圆角 ──────────────────────────────────────────────────────────
const chipR = last('.app--game .controls .icon-btn', 'border-radius');
const hr = last('.app--game .controls #hintBtn', 'border-radius');
const hrV = last('.app--game .controls #hintBtn.hint-btn--v', 'border-radius');
check('（尺子）读到了 .controls .icon-btn 的圆角', !!chipR, String(chipR));
check('② 左右分：#hintBtn 不是 border-radius: 0，右两角是牌的圆角', hr === `0 ${chipR} ${chipR} 0`, String(hr));
check('② 上下分：#hintBtn 下两角是牌的圆角', hrV === `0 0 ${chipR} ${chipR}`, String(hrV));

// ── ③ 电脑档：两半都不画圆盘 ────────────────────────────────────────────────────
const SOLO = '.app.app--game > .controls--solo';
const sd = last(`${SOLO} #stopBtn`, '--ctl-disc', DESK);
const hd = last(`${SOLO} #hintBtn`, '--ctl-disc', DESK);
check('③ 电脑档：灯泡和暂停的 --ctl-disc 一样（transparent）', !!sd && sd === hd && sd === 'transparent', `暂停 ${sd} · 灯泡 ${hd}`);
check('③ 电脑档：记号同色', last(`${SOLO} #stopBtn`, '--ctl-mark', DESK) === last(`${SOLO} #hintBtn`, '--ctl-mark', DESK),
  `${last(`${SOLO} #stopBtn`, '--ctl-mark', DESK)} / ${last(`${SOLO} #hintBtn`, '--ctl-mark', DESK)}`);
check('③ 电脑档：灯泡按下时记号换成按下的墨色', last(`${SOLO} #hintBtn.chip--press`, '--ctl-mark', DESK) === 'var(--play-chip-press-ink)',
  String(last(`${SOLO} #hintBtn.chip--press`, '--ctl-mark', DESK)));

// ── ④ 几何 ──────────────────────────────────────────────────────────────────────
// 各档 #stopBtn 的宽 × 高（check-hint-bulb ⑨ 在真浏览器里量到的那几档上下）：竖屏是半条宽、clamp(50,8.2vh,78) 高；
// 横屏是一条竖的；电脑 246×95。再扫一遍宽 120–300 × 高 44–100，免得只在这几个点上成立。
const PAD = 4;
const BAR = [35, 65]; // ctlIcons.ts CTL_PAUSE：两根条 x 35–46、54–65（viewBox 100）
function glyph(w, h, along) {
  // along = 'center'：推12 那样（图形在整颗正中）；'start'：推15B（图形在左 / 上 58% 里，从头排）。
  const tall = h > w;
  const cw = w - 2 * PAD;
  const ch = h - 2 * PAD;
  const bw = tall ? cw : 0.58 * cw; // 图形框
  const bh = tall ? 0.58 * ch : ch;
  const side = Math.min(bw, bh); // svg meet：正方形，居中
  const part = Math.round((tall ? h : w) * 0.42);
  if (!tall) {
    const boxLeft = along === 'center' ? (w - bw) / 2 : PAD;
    const sx = boxLeft + (bw - side) / 2;
    const cx = sx + ((BAR[0] + BAR[1]) / 200) * side;
    const right = sx + (BAR[1] / 100) * side;
    return { off: Math.abs(cx - 0.29 * w), gap: w - part - right };
  }
  const boxTop = along === 'center' ? (h - bh) / 2 : PAD;
  const sy = boxTop + (bh - side) / 2;
  const cy = sy + 0.5 * side; // 两根条 y 28–72：竖向居中
  const bottom = sy + 0.72 * side;
  return { off: Math.abs(cy - 0.29 * h), gap: h - part - bottom };
}
const SIZES = [];
for (const [w, h] of [[187, 69], [154, 50], [246, 95], [96, 172], [246, 72]]) SIZES.push([w, h]);
for (let w = 120; w <= 300; w += 10) for (let h = 44; h <= 100; h += 8) SIZES.push([w, h]);
for (let h = 120; h <= 260; h += 20) for (let w = 60; w <= 110; w += 10) SIZES.push([w, h]);
const bad = SIZES.filter(([w, h]) => { const g = glyph(w, h, 'start'); return !(g.off <= 4 && g.gap > 2); });
check(`④ ${SIZES.length} 种尺寸：两根条的并框中心离左（上）半正中 ≤ 4、离灯泡那一半 > 2`, bad.length === 0,
  bad.slice(0, 5).map(([w, h]) => `${w}×${h} ${JSON.stringify(glyph(w, h, 'start'))}`).join(' · ') || '全部');
const oldBad = [[187, 69], [154, 50], [246, 95]].filter(([w, h]) => { const g = glyph(w, h, 'center'); return !(g.off <= 4 && g.gap > 2); });
check('④（尺子）同样的数按 center 排（推12 那样）：竖屏 390 / 320、电脑三档都过不了', oldBad.length === 3,
  [[187, 69], [154, 50], [246, 95]].map(([w, h]) => `${w}×${h} 偏 ${glyph(w, h, 'center').off.toFixed(1)}`).join(' · '));

console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

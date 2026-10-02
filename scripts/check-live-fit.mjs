/**
 * 「消除之后剩下的部分整体放大」那一点算术（`src/engine/liveFit.ts`）。
 *
 *   npx esbuild src/engine/liveFit.ts --bundle --format=esm --outfile=/tmp/livefit.mjs
 *   node scripts/check-live-fit.mjs /tmp/livefit.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一道盯着的三件事，各自都是真会出的事故：
 *
 *   ① **开局不许动。** 玩家拍板时明说了这一条。而「放大」这件事最容易出的错就是把基准取
 *      成底板：小球那副开局横向占底板 99%、竖向 87%，照底板算开局就被放大 1.01 倍——每一
 *      枚球都挪了一两个像素，而屏幕上看不出是「放大」，只看出「和昨天不一样」。所以这儿
 *      拿**真的小球那套数**（R = S/14、boardLeft = S/2、boardTop = (S − totalH)/2）当对
 *      照，一个像素都不许差。
 *   ② **只增不减。** 格子只会离场，所以活格框只会缩，zoom 只该变大。反过来哪怕一次都不
 *      行：棋子突然缩回去，玩家会以为自己点错了什么。
 *   ③ **不许出界。** 放大之后活格框还得在底板里。出界的那一侧是看不见的棋子——而「看不见
 *      的棋子」玩家只会当成卡死。
 *
 * 外加两条不放大的情形（无限反转、空盘）和一条时长（两段加起来不许超过连锁那一拍的间隔，
 * 超了就是动画被打断，而动画一被打断就是「棋子吸附过去」那种跳）。
 *
 * 纯算术，不开浏览器，进得了 CI。
 */
const [src] = process.argv.slice(2);
if (!src) {
  console.error('用法: node scripts/check-live-fit.mjs <livefit.mjs>');
  console.error('  npx esbuild src/engine/liveFit.ts --bundle --format=esm --outfile=/tmp/livefit.mjs');
  process.exit(2);
}
const { fitLive, zoomFrom, ZOOM_HOLD_MS, ZOOM_BACK_MS } = await import(src);

let fail = 0;
const check = (n, ok, extra = '') => {
  if (!ok) fail++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (extra ? '  ' + extra : ''));
};
const head = (t) => console.log('\n' + t);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ── 真的小球那副棋盘 ────────────────────────────────────────────
//
// 7 行、第 r 行 r+1 颗。一颗球的中心（照 circle.ts 的 ballCenter）：
//   cx = boardLeft + R·(2c − r)      cy = boardTop + R·(1 + r√3)
// 球的直径是 1.86R，所以轮廓往外各 0.93R。
const ROWS = 7;
const HALF = 0.93;
const qx = (r, c) => 2 * c - r;
const qy = (r) => 1 + r * Math.sqrt(3);
const boxOf = (cells) => {
  if (!cells.length) return null;
  const xs = cells.map(([r, c]) => qx(r, c));
  const ys = cells.map(([r]) => qy(r));
  return {
    x: { min: Math.min(...xs) - HALF, max: Math.max(...xs) + HALF },
    y: { min: Math.min(...ys) - HALF, max: Math.max(...ys) + HALF },
  };
};
const ALL = [];
for (let r = 0; r < ROWS; r++) for (let c = 0; c <= r; c++) ALL.push([r, c]);
const FULL = boxOf(ALL);

/**
 * 小球那副棋盘**放大这件事落地之前**那两行锚点，一字不差：
 *
 *   boardLeft = S / 2
 *   boardTop  = (S − totalH) / 2,  totalH = (ROWS − 1)·R√3 + 2R,  R = S / 14
 *
 * `fitLive` 收的就是它——这一道门最要紧的一条「开局一个像素都不动」才有东西可对。
 */
const OLD = (S) => {
  const R = S / 14;
  const totalH = (ROWS - 1) * R * Math.sqrt(3) + 2 * R;
  return { originX0: S / 2, originY0: (S - totalH) / 2 };
};

head('【0】尺子：导出了四样，两段时长都在');
for (const [n, v] of Object.entries({ fitLive, zoomFrom })) {
  check(`导出了 ${n}`, typeof v === 'function');
}
check('ZOOM_HOLD_MS 是 700', ZOOM_HOLD_MS === 700, String(ZOOM_HOLD_MS));
check('ZOOM_BACK_MS 是 480', ZOOM_BACK_MS === 480, String(ZOOM_BACK_MS));

head('【1】开局：zoom 正好 1，锚点和放大落地之前**一个像素都不差**');
{
  const S = 420;
  const unit0 = S / 14;
  const fit = fitLive({ full: FULL, live: FULL, unit0, ...OLD(S) });
  check('zoom === 1（不是 1.01，也不是 0.99）', fit.zoom === 1, String(fit.zoom));
  check('unit 还是 S/14', near(fit.unit, unit0), `${fit.unit} / 要 ${unit0}`);
  // circle.ts 放大这件事落地之前那两行：
  //   boardLeft = S / 2
  //   boardTop  = (S − totalH) / 2,  totalH = (ROWS − 1)·rowH + 2R,  rowH = R√3
  const R = unit0;
  const totalH = (ROWS - 1) * R * Math.sqrt(3) + 2 * R;
  check('originX === S/2（旧式）', near(fit.originX, S / 2), `${fit.originX} / 要 ${S / 2}`);
  check('originY === (S − totalH)/2（旧式）', near(fit.originY, (S - totalH) / 2),
    `${fit.originY} / 要 ${(S - totalH) / 2}`);
  /*
   * 这一条是上面两条的意义所在：**每一颗球**的中心都落在旧式算出来的那个位置上。锚点对了
   * 而换算错了一样是全盘挪位，所以逐颗核一遍（28 颗）。
   */
  let worst = 0;
  for (const [r, c] of ALL) {
    const oldX = S / 2 + R * (2 * c - r);
    const oldY = (S - totalH) / 2 + R + r * R * Math.sqrt(3);
    const newX = fit.originX + fit.unit * qx(r, c);
    const newY = fit.originY + fit.unit * qy(r);
    worst = Math.max(worst, Math.abs(oldX - newX), Math.abs(oldY - newY));
  }
  check('28 颗球一颗都没挪（和旧式逐颗对）', worst < 1e-9, `最大差 ${worst}`);
}

/*
 * 【1】′ 这一节是补上来的，而且它补的正是一个**量不出来**的洞。
 *
 * 上面【1】拿的是小球那副棋盘，而它的老锚点恰好就是「整副棋盘在底板里居中」。于是「照老锚
 * 点算」和「照底板居中算」两种写法在它身上**答案一模一样**——把 fitLive 改成后者，上面每一
 * 条照旧全绿。可六边三角那一副的 `originY` 上挂着一个 `GLOBAL_ROW_OFFSET * H`（局部 7 行只
 * 占大三角的中间一截，玩家调过的半格），照底板居中会把那半格抹平。
 *
 * 所以这儿捏一副**有意偏着摆**的：老锚点竖向故意离底板正中 40px。两条：
 *
 *   · 开局：锚点原封不动（偏移还在）。
 *   · 放大之后：活格框的中心落在「整副棋盘的中心从前落的那一点」上——而不是底板正中。
 */
head('【1】′ 有意偏着摆的那一副：那点偏移要原样跟着走');
{
  const S = 420;
  const unit0 = S / 14;
  const OFF = { originX0: S / 2, originY0: OLD(S).originY0 - 40 };
  const atStart = fitLive({ full: FULL, live: FULL, unit0, ...OFF });
  check('开局：锚点原样照老的那一对（偏移没被抹掉）',
    near(atStart.originX, OFF.originX0) && near(atStart.originY, OFF.originY0),
    `${atStart.originY} / 要 ${OFF.originY0}`);
  const few = boxOf([[4, 4], [5, 5], [6, 6]]);
  const zoomed = fitLive({ full: FULL, live: few, unit0, ...OFF });
  check('（尺子）这一下真的放大了', zoomed.zoom > 1.5, zoomed.zoom.toFixed(2));
  // 整副棋盘的中心从前落在哪儿：老锚点 + unit0 × 整副框中心。
  const wantX = OFF.originX0 + unit0 * ((FULL.x.min + FULL.x.max) / 2);
  const wantY = OFF.originY0 + unit0 * ((FULL.y.min + FULL.y.max) / 2);
  const gotX = zoomed.originX + zoomed.unit * ((few.x.min + few.x.max) / 2);
  const gotY = zoomed.originY + zoomed.unit * ((few.y.min + few.y.max) / 2);
  check('放大之后：活格框的中心落在整副棋盘从前的中心上，不是底板正中',
    near(gotX, wantX) && near(gotY, wantY),
    `${gotY.toFixed(2)} / 要 ${wantY.toFixed(2)}（底板正中是 ${S / 2}）`);
  // 反过来说清楚：那两个点确实**不是**同一个（否则上一条又是空绿）。
  check('（尺子）整副棋盘从前的中心本来就不在底板正中', Math.abs(wantY - S / 2) > 10,
    `差 ${(wantY - S / 2).toFixed(1)}px`);
}

head('【2】只增不减：格子一批批离场，zoom 一路只涨');
{
  const S = 420;
  const unit0 = S / 14;
  // 照真的消除顺序削：外边族削的是最外边那一条（这儿按「最后一行 → 最长那条斜边 →
  // 再下一行」粗粗模拟，顺序不要紧，要紧的是**活格只少不多**）。
  const order = [...ALL].sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  let live = [...ALL];
  let prev = fitLive({ full: FULL, live: boxOf(live), unit0, ...OLD(S) });
  let drops = 0;
  let steps = 0;
  const zooms = [prev.zoom];
  for (const cell of order.slice(0, 24)) {
    live = live.filter(([r, c]) => !(r === cell[0] && c === cell[1]));
    const now = fitLive({ full: FULL, live: boxOf(live), unit0, ...OLD(S) });
    steps++;
    if (now.zoom < prev.zoom - 1e-12) drops++;
    zooms.push(now.zoom);
    prev = now;
  }
  check(`一路 ${steps} 步，zoom 一次都没变小`, drops === 0, `变小了 ${drops} 次`);
  check('（尺子）它真的涨过（否则上一条是空绿）', prev.zoom > 1.5,
    `最后 ${prev.zoom.toFixed(2)} 倍，一路：${zooms.filter((_, i) => i % 6 === 0).map((z) => z.toFixed(2)).join(' → ')}`);
}

head('【3】不许出界：放大之后活格框还在底板里');
{
  const S = 420;
  const unit0 = S / 14;
  // 挑一批形状各异的残局，连「只剩一枚」「只剩一行」「只剩一条斜边」都试。
  const cases = {
    '只剩一枚': [[3, 1]],
    '只剩两枚挨着': [[6, 2], [6, 3]],
    '只剩最后一整行': [[6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [6, 6]],
    '只剩最左那条斜边': [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0]],
    '只剩一条短斜边': [[4, 4], [5, 5], [6, 6]],
    '散开的三枚': [[0, 0], [3, 3], [6, 1]],
  };
  for (const [name, live] of Object.entries(cases)) {
    const box = boxOf(live);
    const fit = fitLive({ full: FULL, live: box, unit0, ...OLD(S) });
    const left = fit.originX + fit.unit * box.x.min;
    const right = fit.originX + fit.unit * box.x.max;
    const top = fit.originY + fit.unit * box.y.min;
    const bottom = fit.originY + fit.unit * box.y.max;
    // 容差 0.5px：这儿量的是「有没有整块挤出去」，不是像素级对齐。
    const inside = left >= -0.5 && top >= -0.5 && right <= S + 0.5 && bottom <= S + 0.5;
    check(`${name}：活格框在底板里（放大 ${fit.zoom.toFixed(2)} 倍）`, inside,
      `左${left.toFixed(1)} 上${top.toFixed(1)} 右${right.toFixed(1)} 下${bottom.toFixed(1)} / 底板 ${S}`);
    // 而且要真的居中——偏一边的话一侧贴边、另一侧一大片空地板。
    const dx = (left + right) / 2 - S / 2;
    const dy = (top + bottom) / 2 - S / 2;
    check(`${name}：而且居中`, Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6,
      `偏 ${dx.toFixed(3)} / ${dy.toFixed(3)}`);
  }
}

head('【4】两种不放大：无限反转、空盘');
{
  const S = 420;
  const unit0 = S / 14;
  const one = boxOf([[3, 1]]);
  const frozen = fitLive({ full: FULL, live: one, unit0, ...OLD(S), frozen: true });
  check('无限反转：zoom === 1', frozen.zoom === 1, String(frozen.zoom));
  const plain = fitLive({ full: FULL, live: FULL, unit0, ...OLD(S) });
  check('无限反转：锚点和开局一模一样（按整副棋盘居中）',
    near(frozen.originX, plain.originX) && near(frozen.originY, plain.originY),
    `${frozen.originX},${frozen.originY} / 要 ${plain.originX},${plain.originY}`);
  const empty = fitLive({ full: FULL, live: null, unit0, ...OLD(S) });
  check('空盘：zoom === 1，锚点也回整副棋盘', empty.zoom === 1 &&
    near(empty.originX, plain.originX) && near(empty.originY, plain.originY), String(empty.zoom));
  /*
   * 一条线上只剩一枚、横竖有一边占 0 的时候不许除出 Infinity。
   * （真棋盘上不会发生——球有轮廓，宽高都 > 0——可这个函数是公用的，七色圆球躺着摆的时候
   *  那把尺不一样。写死一条兜底比「相信它不会发生」便宜。）
   */
  const flat = fitLive({
    full: FULL, live: { x: { min: 0, max: 0 }, y: { min: 0, max: 0 } },
    unit0, ...OLD(S),
  });
  check('活格框是个点：不许除出 Infinity', Number.isFinite(flat.unit) && flat.zoom === 1,
    `zoom ${flat.zoom} unit ${flat.unit}`);
}

head('【5】zoomFrom：把新这一帧倒回旧的样子');
{
  const S = 420;
  const unit0 = S / 14;
  const before = [...ALL];
  const after = ALL.filter(([r]) => r < 5); // 削掉最后两行
  const prev = fitLive({ full: FULL, live: boxOf(before), unit0, ...OLD(S) });
  const next = fitLive({ full: FULL, live: boxOf(after), unit0, ...OLD(S) });
  check('（尺子）这一下真的放大了', next.zoom > prev.zoom, `${prev.zoom} → ${next.zoom.toFixed(3)}`);
  const t = zoomFrom(prev, next);
  /*
   * 要的就是这一条：**倒回去之后，还留在盘上的每一枚都落在它上一帧那个位置**。
   * 压上这个变换的那一帧玩家应该一点变化都看不出来，变化是接下来 480 毫秒里发生的。
   */
  let worst = 0;
  for (const [r, c] of after) {
    const nx = next.originX + next.unit * qx(r, c);
    const ny = next.originY + next.unit * qy(r);
    const px = prev.originX + prev.unit * qx(r, c);
    const py = prev.originY + prev.unit * qy(r);
    worst = Math.max(worst, Math.abs(t.ax + t.scale * nx - px), Math.abs(t.ay + t.scale * ny - py));
  }
  check('倒回去之后每一枚都落在上一帧那个位置', worst < 1e-9, `最大差 ${worst}`);
  check('scale < 1（新的大，所以要缩回去）', t.scale < 1, String(t.scale));
  // 没放大的那一下（zoom 没变）：变换该是恒等的，不然每一拍都白白动画一次。
  const same = zoomFrom(prev, prev);
  check('zoom 没变的那一拍：变换是恒等的',
    near(same.scale, 1) && near(same.ax, 0) && near(same.ay, 0),
    `${same.scale} / ${same.ax} / ${same.ay}`);
}

head('【6】时长：停 + 长回去 ≤ 连锁那一拍的间隔（1250）');
{
  // 1250 是 gameController 里 BONUS_GAP_MS 的字面值。抄一个数进来是为了钉住它——那儿改了
  // 这儿会红，而不是悄悄地让动画被下一拍打断。
  const BONUS_GAP_MS = 1250;
  check('700 + 480 ≤ 1250', ZOOM_HOLD_MS + ZOOM_BACK_MS <= BONUS_GAP_MS,
    `${ZOOM_HOLD_MS} + ${ZOOM_BACK_MS} = ${ZOOM_HOLD_MS + ZOOM_BACK_MS}`);
  const { readFileSync } = await import('node:fs');
  const gc = readFileSync(new URL('../src/engine/gameController.ts', import.meta.url), 'utf8');
  check('（尺子）gameController 里那个数还是 1250',
    /const BONUS_GAP_MS = reduceMotion \? 0 : 1250;/.test(gc));
}

// ══════════════════════════════════════════════════════════════════════════
// 【7】源码断言：那一下动画的四个坑（`src/ui/boardZoom.ts`）
// ══════════════════════════════════════════════════════════════════════════
//
// 上面六节量的是**算术**。可算术全对，动画照样可以是**死代码**——而且死得一声不响：盘面画
// 对、放大生效，只是跳着变，没有人会看出少了一段动画。这件事真的发生过（见下面第一条），是
// 逐帧量 transform 才看出来的。
//
// 逐帧量要开浏览器，进不了这一条 CI。所以这儿改成读源码，钉住那四处**一改就死**的地方。
head('【7】那一下动画：四个一改就死的地方都还在');
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/ui/boardZoom.ts', import.meta.url), 'utf8');
  const body = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .filter((l) => !l.trim().startsWith('//')).join('\n');

  /*
   * ① **`cancel()` 不许清掉 `seen`。**
   *
   * 一拍消除的次序是 `mark` → `render()` → `layoutBoard()`（里头 `cancel`）→ `play`。
   * `cancel` 一清，`play` 拿到的永远是 null，整段动画成了死代码。第一版就是这么写的。
   */
  // ⚠️ 锚点要写 `cancel() {`，不能只写 `cancel()`：接口里那一行是 `cancel(): ZoomSnapshot |
  // null;`，`indexOf('cancel()')` 先撞上它，于是这一条量的是**接口声明**而不是实现——空绿。
  // 第一版就是这样，打印出来的那一截是 `cancel(): ZoomSnapshot | null;`，一眼就看得出。
  const at = body.indexOf('cancel() {');
  check('（尺子）找到了 cancel() 的实现，不是接口里那一行', at > 0, String(at));
  const cancelBody = body.slice(at, body.indexOf('dispose() {'));
  check('① cancel() 里没有 seen = null（那会把动画变成死代码）',
    !/seen\s*=\s*null/.test(cancelBody), cancelBody.replace(/\s+/g, ' ').slice(0, 90));
  check('① mark / play 还是那一对（play 用掉就清）',
    /mark\(fit\) \{\s*seen = fit;/.test(body.replace(/\n/g, ' ').replace(/\s+/g, ' '))
    || /seen = fit;/.test(body), '');
  check('① play 里先取走再清',
    /const from = seen;\s*seen = null;/.test(body));

  /*
   * ② **只在真的长大了的那一拍动**（`scale < 1`）。
   *
   * 写成 `Math.abs(scale - 1) < 1e-4` 的话，最后一枚消掉那一拍会把一块**空底板**从 6.6 倍
   * 缩回来——没有任何东西可看，纯粹白花一次合成。
   */
  check('② 只在 scale < 1（真的长大了）那一拍动', /if \(t\.scale >= 1 - 1e-4\) return;/.test(body));

  /*
   * ③ **要逼一帧**。不读这一下，同一帧里设的两次 transform 会被合并成「什么都没发生」，
   * 过渡从来不会开始——又是一种「动画悄悄没了」。
   */
  check('③ 有 void el.offsetWidth 那一下（逼一帧）', /void el\.offsetWidth;/.test(body));
  check('③ 而且它排在「倒回去」之后、「长回来」之前',
    body.indexOf('void el.offsetWidth') > body.indexOf('scale(${t.scale})')
    && body.indexOf('void el.offsetWidth') < body.indexOf('scale(1)'));

  /*
   * ④ **Chrome 61**（小红书那一端）：不许用 `DOMMatrix`，也不许用单独的 `scale` /
   * `translate` CSS 属性。两样都是「本地好好的、真机上整块棋盘不动」那种坏法，而且不报错。
   */
  check('④ 没用 DOMMatrix / WebKitCSSMatrix', !/DOMMatrix|WebKitCSSMatrix/.test(body));
  check('④ 没用单独的 scale / translate 那两个 CSS 属性（要到 Chrome 104）',
    !/style\.scale|style\.translate/.test(body));
  check('④ 解析的是 matrix(...) 那个字符串', /\^matrix\\\(/.test(body) || /matrix\\\(/.test(body));
  // transform 是从右往左作用的：scale 要在右边才是「先缩放再平移」，而 transform-origin
  // 不是 0 0 的话浏览器会自己再补一对平移，zoomFrom 算的那两个数就不成立了。
  check('④ translate3d 在前、scale 在后', /translate3d\(\$\{t\.ax\}px, \$\{t\.ay\}px, 0\) scale\(\$\{t\.scale\}\)/.test(body));
  check("④ transform-origin 是 0 0", /transformOrigin = '0 0'/.test(body));

  // ⑤ 两段时长从 liveFit 来，不是在这儿又抄一遍数。
  check('⑤ 时长引的是 liveFit 那两个常量',
    /ZOOM_HOLD_MS/.test(body) && /ZOOM_BACK_MS/.test(body) && !/\b700\b|\b480\b/.test(body));
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);

/**
 * 滑一条线、炸弹连没连上：五副外边族棋盘共用的那两样（第 14 推）。
 *
 *   npx esbuild src/engine/slideLine.ts --bundle --format=esm --outfile=/tmp/slideline.mjs
 *   npx esbuild src/engine/bomb.ts      --bundle --format=esm --outfile=/tmp/bomb.mjs
 *   node scripts/check-slide-line.mjs /tmp/slideline.mjs /tmp/bomb.mjs
 *
 * ── 守的是哪几次事故 ──────────────────────────────────────────
 *
 *   · **拖空线白扣一步。** 外边族的格子会离场，一条线可能只剩一枚、甚至一枚不剩；从前
 *     applyDrag 照样往下走、照样记一步（n = 0 时连「转了整圈」那一句都拦不住：
 *     `shift % 0` 是 NaN）。另外四副棋盘的 onStart 也不拦「按在离场的格子上」。
 *   · **大三角长滑会复制或丢棋子。** 奇数长的线滑过 n − 1 格，fillerAwareSource 把同一
 *     枚分给两格、另一枚凭空消失。
 *   · **五份一样的代码。** 滑一条线和炸弹那三样（四连判爆、三连预警、发干净开局）五副
 *     棋盘各抄一遍，改一处漏四处。
 *
 * 所以：
 *
 *   ① 每副棋盘、每种线长（格子离场之后什么长度都有）、步数 −3n…3n：滑出来的要么是一个
 *      排列，要么是「这一下不算一步」（null）——从不复制、从不丢。n < 2 一律不算一步。
 *   ② 排列校验那一道真的拦得住：喂一个坏的来源函数，出来的是 null，不是一副坏盘。
 *   ③ 五副棋盘都接上了（读源码）：applyDrag 走 slideLine，大三角两处都夹紧，四副的
 *      onStart / onRegrab 拦离场的格子，炸弹那三样从 engine/bomb.ts 来、自己不再留一份。
 *   ④ 炸弹那三样本身：四连判爆、三连预警、邻接按参数走、发牌按原来的次序重发。
 */
import { readFileSync } from 'node:fs';

const [slideSrc, bombSrc] = process.argv.slice(2);
if (!slideSrc || !bombSrc) {
  console.error('用法: node scripts/check-slide-line.mjs <打包好的 slideLine.mjs> <打包好的 bomb.mjs>');
  process.exit(2);
}
const L = await import(slideSrc);
const B = await import(bombSrc);

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const head = (t) => console.log('\n' + t);
const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');

// ── ① 每副棋盘、每种线长、步数 −3n…3n ─────────────────────────────
head('① 每副棋盘、每种线长、步数 −3n…3n：要么是排列，要么不算一步');
/**
 * 每副棋盘最长的那条线、和它怎么换。线长取 0…最长：格子离场之后，一条线剩几枚都有可能。
 * 步数怎么从手指拖出来的距离算，照各自 applyDrag 写（大三角只停偶数步、再夹紧）。
 */
const BOARDS = [
  { name: '小球', max: 7, steps: (k) => k, source: L.rotateSource },
  { name: '六边小球', max: 7, steps: (k) => k, source: L.rotateSource },
  { name: '七色小球', max: 7, steps: (k) => k, source: L.rotateSource },
  { name: '菱形方块', max: 6, steps: (k) => k, source: L.rotateSource },
  // 方块：行和列都是普通循环（2026-10-08 方案 2-12 起也走 slideLine）。消掉整行整列之后盘子变小，
  // 线长同样什么都有可能。
  { name: '方块', max: 6, steps: (k) => k, source: L.rotateSource },
  { name: '大三角', max: 11, steps: (k, n) => L.clampOddShift(2 * Math.round(k / 2), n), source: L.fillerAwareSource },
];
for (const b of BOARDS) {
  const bad = [];
  const shortMoved = [];
  let moved = 0;
  let total = 0;
  for (let n = 0; n <= b.max; n++) {
    const vals = Array.from({ length: n }, (_, i) => `${b.name}${i}`);
    for (let k = -3 * n; k <= 3 * n; k++) {
      total++;
      const shift = b.steps(k, n);
      const out = L.slideLine(vals, shift, b.source);
      if (out === null) continue;
      if (n < 2) shortMoved.push(`n=${n} k=${k}`);
      const sorted = [...out].sort().join('|');
      if (out.length !== n || sorted !== [...vals].sort().join('|')) bad.push(`n=${n} 步数 ${shift}`);
      else moved++;
    }
  }
  check(`${b.name}：滑出来的每一副都是原来那几枚（不复制、不丢）`, bad.length === 0, bad.slice(0, 3).join(' · '));
  check(`${b.name}：活格不到两枚的线，怎么拖都不算一步`, shortMoved.length === 0, shortMoved.slice(0, 3).join(' · '));
  check(`${b.name}：（尺子）大多数真的滑动了`, moved > total / 2, `${moved} / ${total}`);
}
{
  // 四副普通循环：除了转整圈，每一下都滑，而且就是循环位移本身（不是别的什么排列）。
  let wrong = 0;
  for (let n = 2; n <= 7; n++) {
    const vals = Array.from({ length: n }, (_, i) => i);
    for (let s = -3 * n; s <= 3 * n; s++) {
      const out = L.slideLine(vals, s);
      const full = ((s % n) + n) % n === 0;
      if (full ? out !== null : !out || out.some((v, i) => v !== vals[(((i - s) % n) + n) % n])) wrong++;
    }
  }
  check('普通循环：转整圈不算一步，其余每一下都是循环位移本身', wrong === 0, `${wrong} 处不对`);
  check('n = 0：shift % 0 是 NaN 的那一下也拦住了', L.slideLine([], 3) === null && L.slideSources(0, 3) === null);
}

// ── ② 排列校验拦得住 ────────────────────────────────────────────
head('② 排列校验那一道真的拦得住');
{
  const broken = () => 0; // 每一格都从第 0 格来：复制了第 0 枚，丢了别的
  check('坏的来源函数：出来的是 null，不是一副坏盘', L.slideLine(['a', 'b', 'c'], 1, broken) === null);
  const outOfLine = (i, s, n) => i + n; // 来源落在线外
  check('来源落在线外：也是 null', L.slideLine(['a', 'b', 'c'], 1, outOfLine) === null);
  check('isPermutation：缺一个、多一个、越界、非整数都不算', !L.isPermutation([0, 0, 1], 3) &&
    !L.isPermutation([0, 1], 3) && !L.isPermutation([0, 1, 3], 3) && !L.isPermutation([0, 1.5, 2], 3) &&
    L.isPermutation([2, 0, 1], 3));
  // 尺子：不夹紧，大三角那一套真的会给出坏的来源——② 拦的是一件真会发生的事。
  const raw = Array.from({ length: 7 }, (_, i) => L.fillerAwareSource(i, 10, 7));
  check('（尺子）不夹紧的话，七枚的线拖 10 步，来源真的不是排列', !L.isPermutation(raw, 7), raw.join(','));
  check('同一下走 slideLine：拦成 null（不改盘面）', L.slideLine('ABCDEFG'.split(''), 10, L.fillerAwareSource) === null);
}

// ── ③ 五副棋盘都接上了 ─────────────────────────────────────────
head('③ 六副棋盘都接上了（读源码）');
/** 从 `function name(` 起，切出配对的那一段 `{ … }`。 */
const fnBody = (src, sig) => {
  const i = src.indexOf(sig);
  if (i < 0) return null;
  const open = src.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(open, j + 1);
  }
  return null;
};
const OUTER = ['circle', 'circleHex', 'circleSeven', 'squareDiamond', 'triangle'];
for (const f of OUTER) {
  const src = read(`../src/shapes/${f}.ts`);
  const body = fnBody(src, 'function applyDrag(): boolean {');
  check(`${f}：（尺子）切得出 applyDrag`, Boolean(body));
  if (!body) continue;
  check(`${f}：applyDrag 走 slideLine，不再自己转`, /slideLine\(/.test(body) && !/vals\.map\(\(_, i\) => vals\[/.test(body));
  check(`${f}：slideLine 回 null 就不算一步`, /if \(!shifted\) return false;/.test(body));
}
{
  // 方块（2026-10-08 方案 2-12）：行、列两支都走 slideLine，回 null 就不算一步。从前它自己转，
  // 只拦了「没动」——拖满一整圈盘面原样回来，照样记一步（步步为营里白扣一步余步）。
  const sq = read('../src/shapes/square.ts');
  const body = fnBody(sq, 'function applyDrag(): boolean {') || '';
  check('square：（尺子）切得出 applyDrag', Boolean(body));
  check('square：行、列两支都走 slideLine', (body.match(/slideLine\(/g) || []).length === 2, `${(body.match(/slideLine\(/g) || []).length} 处`);
  check('square：两支都是「slideLine 回 null 就不算一步」', (body.match(/if \(!shifted\) return false;/g) || []).length === 2);
  check('square：不再自己转（没有手写的循环位移）', !/% n\) \+ n\) % n\]/.test(body));
}
{
  const tri = read('../src/shapes/triangle.ts');
  const apply = fnBody(tri, 'function applyDrag(): boolean {') || '';
  const preview = fnBody(tri, 'function renderDragPreview() {') || '';
  check('大三角：applyDrag 夹紧了', /clampOddShift\(2 \* Math\.round\(/.test(apply));
  check('大三角：预览那一处也夹紧了（画出来的就是松手落定的那一副）', /clampOddShift\(2 \* Math\.round\(half\), n\)/.test(preview));
  check('大三角：applyDrag 把自己那套来源交给 slideLine', /slideLine\([^;]*fillerAwareSource\)/.test(apply));
}
for (const f of ['squareDiamond', 'circleHex', 'circleSeven', 'triangle', 'circle']) {
  const src = read(`../src/shapes/${f}.ts`);
  const start = fnBody(src, 'onStart(x, y) {') || '';
  const regrab = fnBody(src, 'onRegrab(x, y) {') || '';
  check(`${f}：按在离场的格子上不抓（onStart）`, /if \(isBlank\(grid\[r\]\[c\]\)\) \{\s*drag = null;\s*return;\s*\}/.test(start));
  check(`${f}：改抓到离场的格子上也不抓（onRegrab）`, /if \(isBlank\(grid\[r\]\[c\]\)\) return null;/.test(regrab));
}
for (const f of ['square', 'squareDiamond', 'circle', 'circleHex', 'triangle']) {
  const src = read(`../src/shapes/${f}.ts`);
  const own = ['redClusterKeys', 'hasRedCluster', 'generateCleanBombBoard'].filter((n) => new RegExp(`function ${n}\\(`).test(src));
  check(`${f}：炸弹那三样不再自己留一份`, own.length === 0, own.join(' / '));
  check(`${f}：从 engine/bomb.ts 拿，带着自己的邻接`,
    /import \{[^}]*\bredClusterKeys\b[^}]*\} from '\.\.\/engine\/bomb'/.test(src) &&
    /redClusterKeys\(grid, 3, BOMB_ADJ, liveBomb\)/.test(src) &&
    /hasRedCluster\(grid, BOMB_ADJ, liveBomb\)/.test(src) &&
    /generateCleanBombBoard\(\(\) => boardFromBombDeck\(shuffledDeck\(\)\), hasInitialClump, BOMB_ADJ, liveBomb\)/.test(src));
}

// ── ④ 炸弹那三样本身 ────────────────────────────────────────────
head('④ 炸弹那三样：四连判爆、三连预警、邻接按参数走、发牌按原来的次序重发');
{
  const R = 9; // 红
  const t = (color) => ({ color, face: 'front', dotColor: 0 });
  const live = (x) => B.isLiveBomb(x, R);
  // 一个 L 形的四连（上下左右相连），和一个斜着挨的两枚。
  const g = [
    [t(R), t(1), t(2), t(R)],
    [t(R), t(3), t(R), t(4)],
    [t(R), t(R), t(5), t(6)],
  ];
  const four = B.redClusterKeys(g, 4, B.GRID_ADJACENCY, live);
  check('四连那一团（L 形）认得出来', ['0,0', '1,0', '2,0', '2,1'].every((k) => four.has(k)) && four.size === 4, [...four].join(' '));
  check('斜着挨的不算连（方块的邻接是上下左右）', !four.has('1,2') && !four.has('0,3'));
  check('hasRedCluster：有四连就是 true', B.hasRedCluster(g, B.GRID_ADJACENCY, live));
  const three = [[t(R), t(R), t(R), t(1)]];
  check('三连：判爆不认，预警认', !B.hasRedCluster(three, B.GRID_ADJACENCY, live) && B.redClusterKeys(three, 3, B.GRID_ADJACENCY, live).size === 3);
  // 拆成星星的红（反面已经不是红）不算活炸弹，不连。
  const defused = [[t(R), t(R), t(R), { color: R, face: 'dot', dotColor: 2 }]];
  check('拆成星星的那一枚不连（只认活炸弹）', !B.hasRedCluster(defused, B.GRID_ADJACENCY, live));
  // 邻接按参数走：同一副盘，换一种「斜角也算挨着」的邻接，斜着那两枚就连上了。
  const diag = {
    cells: B.GRID_ADJACENCY.cells,
    *neighbors(r, c, gg) {
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const nr = r + dr, nc = c + dc;
        if ((dr || dc) && nr >= 0 && nr < gg.length && nc >= 0 && nc < gg[nr].length) yield [nr, nc];
      }
    },
  };
  const both = B.redClusterKeys(g, 2, diag, live);
  check('邻接是参数：换成「斜角也算」，斜着那两枚就连上了', both.has('1,2') && both.has('0,3'), [...both].join(' '));
  // 阶梯形的盘（小球、三角那几副每行长短不一样）：cells 只走真有的格。
  const stair = [[t(R)], [t(R), t(R)], [t(R), t(1), t(2)]];
  const stairAdj = {
    *cells(gg) { for (let r = 0; r < gg.length; r++) for (let c = 0; c <= r; c++) yield [r, c]; },
    *neighbors(r, c, gg) {
      for (const [nr, nc] of [[r, c - 1], [r, c + 1], [r - 1, c - 1], [r - 1, c], [r + 1, c], [r + 1, c + 1]]) {
        if (nr >= 0 && nr < gg.length && nc >= 0 && nc <= nr) yield [nr, nc];
      }
    },
  };
  check('阶梯形的盘：四枚连上也认得出', B.hasRedCluster(stair, stairAdj, live));

  // 发牌：脏的重发，干净的收下；次数用满就用最后那一副。
  const deals = [g, three, [[t(1), t(2)]]];
  let calls = 0;
  const got = B.generateCleanBombBoard(() => deals[Math.min(calls++, deals.length - 1)], () => false, B.GRID_ADJACENCY, live);
  check('发牌：开局就有四连的那一副重发', got === deals[1] && calls === 2, `发了 ${calls} 次`);
  calls = 0;
  const clumpy = B.generateCleanBombBoard(() => deals[Math.min(calls++, deals.length - 1)], (gg) => gg === deals[1], B.GRID_ADJACENCY, live);
  check('发牌：各副自己的「开局成团」也重发', clumpy === deals[2] && calls === 3, `发了 ${calls} 次`);
  calls = 0;
  const capped = B.generateCleanBombBoard(() => { calls++; return g; }, () => false, B.GRID_ADJACENCY, live, 5);
  check('发牌：次数用满就收下最后那一副（不卡死开局）', capped === g && calls === 5, `发了 ${calls} 次`);
  check('发牌：默认最多重发 500 次（和抽出来之前一样）', B.CLEAN_BOMB_DEAL_TRIES === 500);
}

console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

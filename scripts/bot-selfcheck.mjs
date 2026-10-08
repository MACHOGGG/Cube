/**
 * 自检机器人：真开局、真滑、一直打到这一局自己收场（《侵蚀阶梯》v1.2 PR-11）。
 *
 *   npm run build
 *   node scripts/dev-server.mjs 8971 dist
 *   node scripts/bot-selfcheck.mjs http://localhost:8971/            # 抽检（默认）
 *   node scripts/bot-selfcheck.mjs http://localhost:8971/ --soak     # 方案里那一档：每副 20 局
 *   node scripts/bot-selfcheck.mjs http://localhost:8971/ --boards=方块,圆球 --runs=5
 *
 * ── 它和别的门有什么不同 ─────────────────────────────────────
 *
 * `scripts/` 下的门大多喂函数：把某个纯模块打成包，塞几组输入，看输出。这一版的
 * 规则有六七个纯模块各自守着一道门（check-flip-score / check-erosion /
 * check-step-coef / check-line-clear / check-stalemate / check-targets），它们都
 * 绿着。**可这一局到底打不打得完，没有任何一道门问过。**
 *
 * 剩下那一截恰恰是拼起来才存在的：六副棋盘各自的滑法、连锁、终局判定，加上
 * gameController 里「谁先问」的次序。2026-09 玩家报过的那一局就死在这一截上——结算
 * 页写着「全部已变成星星」，盘面上还躺着四颗同色蓝星，而每一块单元件都是对的。
 *
 * 所以这个机器人从**玩家那一侧**问话：只读屏幕上有的东西（每一枚的位置、面、颜
 * 色，HUD 那一块画着几枚，分数，结算页写了什么），一个内部接口都不碰，也不往页面里
 * 塞任何测试口子。
 *
 * ── 它怎么走子 ───────────────────────────────────────────────
 *
 * 方案写的是一步贪心，局面分 = 已消格×1000 + 星星数×20 + 聚边度×300 + 得分×0.01。
 * 要贪心就得**先算出「这一步之后盘面长什么样」**，而那要一份「这条线怎么动」的模
 * 型。六副棋盘的线各不相同（方块是行列，小球是三个方向，菱形、六边、七色各有各的
 * 摆法），把它们抄一遍进这个文件，就等于在门里再实现一遍六副棋盘——这个仓库栽过一
 * 次同形状的跤（四处各按 id 前缀猜家族，猜错不报错），不能再来一次。
 *
 * 所以这儿**不抄几何，从棋盘上学**：每一枚都有一个稳定的 `data-id`，滑一下之后
 * 「哪个 id 跑到了哪个格子」就是这条线的置换。把它按（起手格, 方向）记下来，下次遇
 * 到同一手就能先在本地推一遍、评分、再决定滑不滑。没学过的手就去试——试出来的既是
 * 一步棋，也是一条新学到的线。于是：
 *
 *   · 模型全部来自这副棋盘自己的行为，一行几何都没写死；
 *   · 换一副新棋盘进来，这个机器人不用改一个字；
 *   · 「学到的置换」和棋盘真的做的事对不上（比如棋盘缩圈之后线变了），下一次观察
 *     会把它改过来，不会一直错着。
 *
 * ── 硬断言（对不上就红）────────────────────────────────────
 *
 * H1 **结束的那一刻，盘上不该还摆着一个得分组。** 按《怎么玩》写的那条规矩独立数一
 *    遍（同色一条线、长度 = HUD 那一块此刻画的枚数、里头至少还有一枚色块），数出来
 *    了就是「提前结束」——正是玩家报的那一幕。
 * H2 **不该卡死。** 盘清空了必须在宽限期内结算；预算用完、而且最后那些步棋连
 *    盘面 id 布局都一模一样、局还活着，就是卡住了。
 * H3 **阶梯要推得动。** 一局里 HUD 那一块的枚数必须真的降过；每副棋盘至少有一局降
 *    到 1 枚或者把盘清空。
 * H4 **炸弹局拆一枚就要熄一段。** 拆掉的那一步，分数至少 +2，而且亮着的段数比上一
 *    步少（拆除＝翻面，见 engine/bomb.ts）。
 *
 * ── 报告项（不挡合并）──────────────────────────────────────
 *
 * 各盘的清盘率、步数分布、降到第几级。方案第 E12 条写明：参数已定，**不据此改参**，
 * 这几个数只是摆出来存档。
 *
 * ── 为什么默认只抽检 ────────────────────────────────────────
 *
 * 一步棋在开着 reduced-motion 的浏览器里还要两三百毫秒（连锁、翻面、消行都真的在
 * 跑）。方案那一档是「每副棋盘 20 局」——六副打满要一个多小时，那是离线泡机的量，不
 * 是 CI 的量（CLAUDE.md：等得久的检查最后一定会被人跳过）。所以默认抽检两副各两局，
 * 方案那一档挂在 `--soak` 上。
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const BASE = args.find((a) => a.startsWith('http')) || 'http://localhost:8971/';
const flag = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? dflt : hit.slice(name.length + 3);
};
const SOAK = args.includes('--soak');
/**
 * 一局最多滑几步。滑不完也算数据，只是那一局不参与 H1。
 *
 * 260 不是随手写的：这个机器人大约每八步翻一枚，而图案要先翻掉一级的段数才降一枚。定
 * 这个数的时候是一版的表（方块第一级 31 段）：量过 120 步翻 24 枚、图案还是 4 枚；260
 * 步翻 33 枚，图案一路降到 1 枚。2026-10 二版换表之后（engine/erosion.ts，方块第 15 枚
 * 到 1×3、第 32 枚到 1×1）同样的 260 步更宽裕：走到 1×1 要的枚数没多，第一次降级提前了
 * 一半。一步约 0.48 秒（开着 reduced-motion）。
 */
const BUDGET = Number(flag('budget', SOAK ? 600 : 260));
const RUNS = Number(flag('runs', SOAK ? 20 : 2));
/** 主菜单上那几张卡的名字。--soak 默认六副全打（《侵蚀阶梯》v1.2 PR-6 之前是八副）。 */
const ALL_BOARDS = ['方块', '菱形方块', '圆球', '六边圆球', '七色圆球', '大三角'];
const BOARDS = (flag('boards', SOAK ? ALL_BOARDS.join(',') : '方块,圆球') || '').split(',').filter(Boolean);
/** 炸弹那一局单独走一遍（H4 只有它有意义）。 */
const BOMB_RUNS = Number(flag('bombRuns', SOAK ? 6 : 1));

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const note = (t) => console.log(`      ${t}`);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/**
 * 页面里那一套「只看屏幕」的探针。
 *
 * 装成 addInitScript：page.evaluate 传进去的函数是序列化过去的，引用不到这个文件里
 * 的任何东西。
 */
const installProbe = () => {
  const PIECES = '#boardWrap [data-r][data-c]';
  /**
   * 把任何写法的颜色折成同一种写法。
   *
   * **这一条是这个机器人成立的前提。** 正面那一枚的颜色读的是 backgroundColor，浏览
   * 器给的是 `rgb(a, b, c)`；星星那一面底色透明，颜色在那三笔的 stroke 上，写的是调
   * 色板里的十六进制。两种写法一比永远不相等，于是「一枚正面 + 三枚同色星星」这种组
   * 在机器人眼里根本不存在——而那正是引擎最主要的得分路（《怎么玩》第 1 条：同色连成
   * 一线、里面至少有一枚色块）。
   *
   * 量过：不折的那一版，机器人翻到二十七枚就再也得不了分了（盘上星星一多，全是正面
   * 的四连就凑不出来了），看起来像「这一局到这儿就该卡住」，其实是尺子瞎了。
   *
   * 折的办法是交给浏览器自己：把颜色塞进一个临时元素的 color，再读回计算值——任何
   * CSS 颜色写法都会被折成 `rgb(...)`，不用在这儿写一套解析器。
   */
  // **现挂，不在这儿就挂上。** addInitScript 跑在页面脚本之前，那会儿 document.body
  // 还不存在——第一版在这儿 appendChild，整个探针当场抛异常，window.__bot 于是从来
  // 没被定义过，而报出来的错是「Cannot read properties of undefined (reading 'snap')」，
  // 看着像选择器写错了。
  let probeEl = null;
  const canon = (raw) => {
    if (!raw) return '';
    if (/^rgb\(/.test(raw)) return raw;
    if (!probeEl) {
      probeEl = document.createElement('span');
      probeEl.style.display = 'none';
      (document.body || document.documentElement).appendChild(probeEl);
    }
    probeEl.style.color = '';
    probeEl.style.color = raw;
    return getComputedStyle(probeEl).color || raw;
  };
  const CLEAR = (c) => !c || c === 'transparent' || /rgba\(0, 0, 0, 0\)/.test(c);
  /**
   * 这一枚露在外面的那一面是什么颜色。
   *
   * **不能只看这一枚自己的 backgroundColor。** 各副棋盘把颜色画在哪儿并不一致：方块和
   * 小球画在棋子元素自己的底色上，**三角画在里面那一层**（shapes/triangle.ts 的
   * `fill.style.background`），外面那层是透明的。只读外层的那一版在六边三角上**每一枚
   * 都是同一个透明色**——于是机器人看不出盘面动过没有：拖了十二下都判成「一个格子都没
   * 动」，H2 当场报「卡住了」。而那不是游戏卡住，是这把尺子瞎了（拿手拖过，189px 也
   * 「没动」；换成往里找一层，第一下就动了）。**这种假红比假绿更坏**：它会让人去查一个
   * 不存在的 bug。
   */
  const colorOf = (el) => {
    if (el.dataset.face === 'dot') {
      // dataset.dotColor 是方块那边写的，别的棋盘不一定有，所以两条路都走。
      //
      // 星星那一笔画在 asteriskGroup 的 <g stroke> 上（ui/dotFaceMark.ts），**先认它**。三角的星
      // 星外面还套着一圈灰边（triRingPath，stroke 是 var(--ink-faint)），排在那个 <g> 前面——从前
      // 这儿取的是「第一个带 stroke 的」，于是三角上每一颗星星读出来都是那圈灰边，全盘一个颜色：
      // 全是星星的线怎么滑都读成「一个格子都没动」，连着 12 手就判卡死（H2），而盘面其实一直在动。
      // 2026-10 侵蚀阶梯换成二版的表之后，机器人头一回在大三角上走到后半局，这才撞见。
      return canon(
        el.dataset.dotColor ||
        el.querySelector('svg g[stroke]')?.getAttribute('stroke') ||
        el.querySelector('svg [stroke]')?.getAttribute('stroke') ||
        el.querySelector('svg')?.getAttribute('stroke') ||
        '',
      );
    }
    const own = getComputedStyle(el).backgroundColor;
    if (!CLEAR(own)) return canon(own);
    for (const kid of el.querySelectorAll('*')) {
      const bg = getComputedStyle(kid).backgroundColor;
      if (!CLEAR(bg)) return canon(bg);
      const f = kid.getAttribute && kid.getAttribute('fill');
      if (f && f !== 'none' && !CLEAR(f)) return canon(f);
    }
    return '';
  };
  /**
   * 变级那一下的演出（v1.3.1 PR-14 §3）：棋盘上方那条「得分图案变成 N 枚」。
   *
   * 它只活一秒六，而且只在降级那一拍出现——手跑的时候十有八九错过。所以挂个
   * MutationObserver 记下每一次：出现过几回、当时那块牌子多大、有没有顶出屏幕。
   */
  const toasts = [];
  const watchToasts = () => new MutationObserver((recs) => {
    for (const rec of recs) {
      for (const n of rec.addedNodes) {
        if (!(n instanceof HTMLElement) || !n.classList.contains('pat-toast')) continue;
        const r = n.getBoundingClientRect();
        toasts.push({
          text: (n.textContent || '').trim(),
          w: Math.round(r.width), h: Math.round(r.height),
          x: Math.round(r.left), y: Math.round(r.top),
          // 顶出屏幕没有（两侧、上边）。它是 pointer-events: none，压住棋盘不要紧，
          // 但跑到屏幕外面就等于没说这句话。
          out: r.left < -0.5 || r.right > document.documentElement.clientWidth + 0.5 || r.top < -0.5,
        });
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  // **现挂，挂不上就等 DOM 起来再挂。** addInitScript 跑在页面脚本之前，那会儿
  // documentElement 可能还不存在——直接 observe 会抛，而抛出去的后果是 window.__bot 整个
  // 没被定义，报出来的错是「Cannot read properties of undefined (reading 'snap')」，看着
  // 像选择器写错了（这个文件里同一个坑踩过两次，见 canon 上面那段）。
  if (document.documentElement) watchToasts();
  else document.addEventListener('DOMContentLoaded', watchToasts, { once: true });

  window.__bot = {
    /** 这一局到此为止冒过几条「得分图案变成 N 枚」，以及它们的样子。 */
    toasts: () => toasts.slice(),
    /** 盘面此刻的样子。 */
    snap() {
      return [...document.querySelectorAll(PIECES)].map((e) => {
        const r = e.getBoundingClientRect();
        return {
          at: `${e.dataset.r},${e.dataset.c}`,
          id: e.dataset.id ?? '',
          face: e.dataset.face || '',
          color: colorOf(e),
          // 还没拆的炸弹身上有个「！」（shapes/*.ts 的 hazard-mark）。
          bomb: Boolean(e.querySelector('.hazard-mark')),
          x: Math.round(r.x + r.width / 2),
          y: Math.round(r.y + r.height / 2),
          w: Math.round(r.width),
        };
      });
    },
    /** 盘面上此刻有几颗星星、还活着几枚。算「累计翻了几枚」用（见 H5）。 */
    tally() {
      const all = [...document.querySelectorAll(PIECES)];
      const alive = all.filter((e) => e.dataset.face !== 'blank');
      return { alive: alive.length, stars: alive.filter((e) => e.dataset.face === 'dot').length };
    },
    /** 屏幕上的读数：分数、HUD 那一块画着几枚、亮着几段。 */
    hud() {
      const reel = document.querySelector('#scoreReel');
      const svg = document.querySelector('.hud-block--pattern .pat-icon > svg');
      const lit = document.querySelector('.pat-ring-lit');
      const dash = (lit?.getAttribute('stroke-dasharray') || '').trim().split(/\s+/);
      // 亮着的段数 = dasharray 里「实线那一段不为 0」的对数（见 patternBlock 的 tickDash）。
      let segs = 0;
      for (let i = 0; i + 1 < dash.length; i += 2) if (Number(dash[i]) > 0) segs++;
      return {
        // **分数读 dataset.score，不读文本。** 那一格里摆的是一排滚动的数字条，
        // textContent 是「0123456789」——读文本量到的是滚轮上的刻度，不是分数
        // （engine/scoreReel.ts 的 setValue 写 dataset.score，odometer 同时写
        // aria-label，读屏软件读的也是它）。
        score: reel?.dataset.score === undefined ? null : Number(reel.dataset.score),
        marks: svg ? [...svg.children].filter((e) => e.tagName !== 'defs').length : null,
        segs,
      };
    },
    /** 结算页出来了吗，写的是哪一句。 */
    ended() {
      const ov = document.querySelector('#endOverlay');
      if (!ov || !ov.classList.contains('show')) return null;
      return {
        title: (document.querySelector('#endTitle')?.textContent || '').trim(),
        score: (document.querySelector('#endScore')?.textContent || '').trim(),
      };
    },
  };
};

/**
 * H1 用的那把独立尺子：这副盘面上此刻有没有一个成立的得分组。
 *
 * 按《怎么玩》第 1 条写的那条规矩数（src/rules.ts）：**同色连成一线、长度等于 HUD
 * 那一块此刻画的枚数、里头至少还有一枚色块**。「一线」这儿不查几何，查的是**这一局
 * 已经学到的那些线**（见文件头）——机器人打了几十步之后，六副棋盘的线它都走过了。
 *
 * 老虎机那一局不用这把尺子：那一局认的是转出来那个图案的子形，不是 1×N（见
 * engine/targetMatch.ts 的 erodedShapes），这把尺子会把「没有 1×N」误判成「还有得
 * 分组」。所以那一局跳过 H1，并且说出来，不假装查过。
 */
function scoringGroupOnBoard(snap, lines, need) {
  const cell = new Map(snap.map((p) => [p.at, p]));
  for (const line of lines) {
    const seq = line.map((at) => cell.get(at)).filter(Boolean);
    if (seq.length < need) continue;
    // **不接首尾。** 棋盘滑起来是循环的（滑出去的从另一头补回来），可**得分的那条线
    // 不循环**：一条 N 连要的是 N 个挨着的格子，第一格和最后一格不算挨着（六副棋盘
    // 的 findMatches 都是 `for (c; c + n <= cols; c++)`）。
    //
    // 第一版把线当成环，于是「列 0 的第 5、0、1、2 行同色」被当成四连——机器人一口
    // 气挑了五十步同一手，每一步都以为要得分，棋盘一分都不给。那不是引擎的毛病，是
    // 这把尺子的毛病，而它看起来一模一样：屏幕上就是「机器人在原地打转」。
    for (let i = 0; i + need <= seq.length; i++) {
      const win = seq.slice(i, i + need);
      if (win.some((p) => p.face === 'blank' || !p.color)) continue;
      if (!win.every((p) => p.color === win[0].color)) continue;
      // 老规矩：一次得分总要翻掉点什么（engine/scoring.ts）。
      if (!win.some((p) => p.face === 'flavor')) continue;
      // 还没拆的炸弹不参与配对（engine/bomb.ts）。
      if (win.some((p) => p.bomb)) continue;
      return win.map((p) => p.at);
    }
  }
  return null;
}

/**
 * 「这一步滑完之后，棋盘自己会把它结算掉」——在本地也把那一下算上。
 *
 * 少了这一步，整个贪心是**瞎的**。方案那个局面分里唯一奖励「凑出一个得分组」的项是
 * 星星数×20（凑成了，那几枚当场翻成星星），可 applyPerm 只把棋子挪了个位置，翻面那
 * 一下没算——于是开局盘上一颗星星都没有、一格都没消，每一手的局面分都是 0，贪心退化
 * 成乱滑。量过：八十步一次都没得分，图案还停在 4 枚。
 *
 * 所以这儿按《怎么玩》那条规矩把它翻了：找到一个得分组就当场翻成星星，再找一遍（连
 * 锁），最多三拍——和棋盘真的会做的事同一个形状，但**规矩是从书上抄的，不是从引擎里
 * 抄的**，这正是 H1 那把尺子的用意。
 */
function resolveSim(snap, lines, need) {
  const out = snap.map((p) => ({ ...p }));
  const seat = new Map(out.map((p) => [p.at, p]));
  let flipped = 0;
  for (let pass = 0; pass < 3; pass++) {
    const hit = scoringGroupOnBoard(out, lines, need);
    if (!hit) break;
    for (const at of hit) {
      const p = seat.get(at);
      if (p && p.face === 'flavor') { p.face = 'dot'; flipped++; }
    }
  }
  return { board: out, flipped };
}

/**
 * 侵蚀阶梯那张段数表的字面值，这道门自己抄一份（和 `scripts/check-pattern-level.mjs`
 * 同一份）。2026-10 二版（10-08 方案 3-A）：三级合计小于全盘，余下的是 1×1 那一段。
 *
 * 抄一份而不是 import：H5 要问的正是「屏幕上那一块画的级数对不对」，读同一个常量就成了
 * 「它说它是对的」。键是主菜单上那张卡的名字——这个机器人认的就是那个名字。
 */
const LADDER_BY_BOARD = {
  方块: [15, 11, 6],
  菱形方块: [15, 11, 6],
  圆球: [12, 8, 5],
  六边圆球: [15, 11, 6],
  七色圆球: [18, 14, 10],
  大三角: [20, 15, 11],
  // 基础炸弹那一档开的是方块或小球（BOMB_SHAPES），开哪一副由那一屏第一个 chip 定。
  // 两副的第一级不一样（15 vs 12），推错了会冤枉游戏，所以**炸弹局不做 H5**。
};

/** 翻了 n 枚之后，按 §2 那张表该是第几枚级。 */
function levelFromFlips(seg, n) {
  const [s4, s3, s2] = seg;
  if (n < s4) return 4;
  if (n < s4 + s3) return 3;
  if (n < s4 + s3 + s2) return 2;
  return 1;
}

/** 方案里那个局面分：已消格×1000 + 星星×20 + 聚边度×300 + 得分×0.01。 */
function positionScore(snap, startTiles, score, lines) {
  const alive = snap.filter((p) => p.face !== 'blank');
  const cleared = Math.max(0, startTiles - alive.length);
  const stars = alive.filter((p) => p.face === 'dot').length;
  // 聚边度：任一条线上某色星星占比 + 0.25 × 盘面同色可补数，取最大。
  // 「外边」这儿用「学到的那些线」当代理：这个机器人不认几何，而消除吃的正是
  // 一整条线（方块是整行整列，别的是最外那一条）——两者在「一条线上同色星星占比」
  // 这件事上是同一个量。
  const byColor = new Map();
  for (const p of alive) if (p.face === 'dot') byColor.set(p.color, (byColor.get(p.color) ?? 0) + 1);
  const cellAt = new Map(alive.map((p) => [p.at, p]));
  let affinity = 0;
  for (const line of lines) {
    const seq = line.map((at) => cellAt.get(at)).filter(Boolean);
    if (!seq.length) continue;
    const tally = new Map();
    for (const p of seq) if (p.face === 'dot') tally.set(p.color, (tally.get(p.color) ?? 0) + 1);
    for (const [c, n] of tally) {
      const share = n / seq.length;
      const spare = Math.max(0, (byColor.get(c) ?? 0) - n);
      affinity = Math.max(affinity, share + 0.25 * spare);
    }
  }
  return cleared * 1000 + stars * 20 + affinity * 300 + (score ?? 0) * 0.01;
}

/**
 * 一条线：从棋盘**画面上**取，不从行列号算，也不靠 id 去学。
 *
 * 收「抓住的那一枚」和「往哪个方向拖」，返回这条线上的格子，按拖动方向排好序。判据只
 * 有一条：这一枚的中心到那条直线的**垂距**在半个格子之内。
 *
 * 为什么是这一条，而不是别的两条路：
 *
 *   · **不按行列号算。** 六副棋盘的线各不相同（方块是行列，小球是三个方向，菱形、六
 *     边、七色各有各的摆法），照行列号算就等于在门里把六副棋盘再实现一遍——这个仓库
 *     栽过一次同形状的跤（四处各按 id 前缀猜家族，猜错不报错）。
 *   · **不靠 data-id 去学。** 第一版是滑一下、看「哪个 id 跑到了哪个格子」，把置换记
 *     下来。可 `data-id` **只有方块挂**（shapes/square.ts 那一处是给消行动画用的），
 *     别的五副一个都没有——于是在小球上每一枚的 id 都是空串，学到的置换是垃圾，贪心
 *     全程瞎走。量过：方块 400 步翻 32 枚、图案降到 1 枚；小球 400 步只翻 14 枚、图案
 *     一级都没降。而「为了让门看得见就往五副棋盘的 DOM 上挂个属性」正是 CLAUDE.md 说
 *     的「留测试口子」。
 *
 * 屏幕上的坐标本来就在快照里，而「同一条线上的棋子在画面上也连成一条线」是六副棋盘共
 * 同的事实——这一条不用任何一副棋盘配合。
 */
function lineThrough(snap, p, d) {
  const len = Math.hypot(d.dx, d.dy) || 1;
  const ux = d.dx / len;
  const uy = d.dy / len;
  const tol = Math.max(6, (p.w || 20) * 0.5);
  const on = [];
  for (const q of snap) {
    if (q.face === 'blank') continue;
    const vx = q.x - p.x;
    const vy = q.y - p.y;
    // 垂距：向量在法线上的投影。
    if (Math.abs(vx * uy - vy * ux) > tol) continue;
    on.push({ at: q.at, t: vx * ux + vy * uy });
  }
  on.sort((a, b) => a.t - b.t);
  return on.map((o) => o.at);
}

/**
 * 这一手的置换：整条线**循环挪一格**（《怎么玩》第 1 条：滑出去的从另一端补回来）。
 *
 * @param sign +1 = 内容顺着拖动方向挪一格，−1 = 反过来。哪一个对由第一手实测校准（见
 *   playOne 里的 calibrate）——猜错的后果是贪心永远挑到「以为会得分」的那一手，滑下去
 *   一分不得。
 */
function shiftPerm(seats, sign) {
  const n = seats.length;
  if (n < 2) return [];
  const out = [];
  for (let i = 0; i < n; i++) {
    const j = (((i + (sign > 0 ? 1 : -1)) % n) + n) % n;
    out.push([seats[i], seats[j]]);
  }
  return out;
}

/** 把一条置换套在当前盘面上，得到「滑完之后长什么样」。置换是「格子 → 格子」。 */
function applyPerm(snap, perm) {
  const src = new Map(snap.map((p) => [p.at, p]));
  const out = snap.map((p) => ({ ...p }));
  const seat = new Map(out.map((p) => [p.at, p]));
  let touched = 0;
  for (const [from, to] of perm) {
    const a = src.get(from);
    const b = seat.get(to);
    if (!a || !b) continue;
    b.face = a.face;
    b.color = a.color;
    b.bomb = a.bomb;
    b.id = a.id;
    touched++;
  }
  return touched ? out : null;
}

/**
 * 一局。
 *
 * @returns 这一局的账：走了几步、清了几枚、图案降到几枚、怎么收场的，以及硬断言
 *   各自的结论（由调用方汇总，这儿只报事实）。
 */
/**
 * H7 甲：此刻每一枚活棋子都**整个待在底板里**。
 *
 * 「消除之后剩下的部分整体放大」（第 6 推，engine/liveFit.ts）之后，这一条是最容易出事的
 * 那一条：放大倍数算错一点，剩下那几枚就会有一半垂在深褐色的空地板外面——而那种画面玩家只
 * 会当成「这游戏没做完」。
 *
 * `check-board-fit` 量的是**开局**那一帧 × 六副 × 两个方向；这儿量的是**一局里每隔几手**，
 * 也就是放大真的发生之后。两道合起来才覆盖得住。
 */
async function piecesInsideFloor(page) {
  await stillPieces(page);
  return page.evaluate(() => {
    const wrap = document.querySelector('.board-wrap');
    if (!wrap) return '';
    const f = wrap.getBoundingClientRect();
    for (const el of wrap.querySelectorAll('.tile, .ball, .tri')) {
      if (el.classList.contains('ghost')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (r.left < f.left - 0.5 || r.top < f.top - 0.5
        || r.right > f.right + 0.5 || r.bottom > f.bottom + 0.5) {
        return `(${el.dataset.r},${el.dataset.c}) 戳出底板`
          + ` ${Math.round(r.left - f.left)},${Math.round(r.top - f.top)}`
          + ` ${Math.round(r.width)}px / 底板 ${Math.round(f.width)}×${Math.round(f.height)}`;
      }
    }
    return '';
  });
}

/**
 * 等棋子停稳再量：每一枚的位置连着两拍一样（最多等一秒半）。
 *
 * settle() 只等「面和颜色」不再变，位置它不看——可一手松开之后，那一条线还在弹簧里往格子上
 * 落（engine/dragChain.ts），这几帧里棋子在格子之间。七色圆球开局时最外圈那几颗正好贴着底板
 * 边（量过：上、左 0px，右、下 0.02px），落位途中多走半个像素就被 H7 甲算成「戳出底板」——量
 * 到的是动画的一帧，不是放大算错。2026-10 侵蚀阶梯换成二版的表之后机器人得分更勤，撞上过一
 * 次：第 56 手、那一局一条边都没消过，根本还没放大。
 */
async function stillPieces(page, maxMs = 1500) {
  const t0 = Date.now();
  let prev = '';
  for (;;) {
    const now = await page.evaluate(() =>
      [...document.querySelectorAll('.board-wrap .tile, .board-wrap .ball, .board-wrap .tri')]
        .map((e) => {
          const r = e.getBoundingClientRect();
          return `${r.left.toFixed(1)},${r.top.toFixed(1)},${r.width.toFixed(1)}`;
        })
        .join('|'));
    if (now === prev || Date.now() - t0 > maxMs) return;
    prev = now;
    await page.waitForTimeout(60);
  }
}

/**
 * H7 乙：**按住一枚棋子的正中，抓到的就是它。**
 *
 * 按下去 `engine/drag.ts` 会给抓到的那一枚挂上 `piece-grabbed`，所以问一句「谁挂着这个类」
 * 就知道抓到了谁。按完原地松手——还在死区里，什么都不会发生（见 drag.ts 的 `up`）。
 *
 * 为什么非量这一条：放大是靠**算**的（不是 CSS transform 留在那儿），而拖拽那一头量的是
 * 「手指落点换算成行列」。两头有一处没跟上，屏幕上就是「这游戏点不准」——按哪儿都抓到隔
 * 壁那一枚，而没有任何报错。这种毛病在截图里看不出来，只能这么按一遍。
 */
async function grabHitsSelf(page, howMany = 3) {
  const spots = await page.evaluate((n) => {
    const wrap = document.querySelector('.board-wrap');
    if (!wrap) return [];
    const live = [...wrap.querySelectorAll('.tile, .ball, .tri')].filter((el) => {
      if (el.classList.contains('ghost')) return false;
      if (el.dataset.face === 'blank') return false;
      const r = el.getBoundingClientRect();
      return r.width >= 1 && el.dataset.r !== undefined;
    });
    // 头、中、尾各挑一枚：三枚够看出「整体错位」和「只有边上错位」两种。
    const pick = [];
    for (const i of [0, Math.floor(live.length / 2), live.length - 1]) {
      if (live[i] && !pick.includes(live[i])) pick.push(live[i]);
    }
    return pick.slice(0, n).map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, at: `${el.dataset.r},${el.dataset.c}` };
    });
  }, howMany);
  for (const sp of spots) {
    await page.mouse.move(sp.x, sp.y);
    await page.mouse.down();
    const got = await page.evaluate(() => {
      const el = document.querySelector('.piece-grabbed');
      return el ? `${el.dataset.r},${el.dataset.c}` : '(没抓到)';
    });
    await page.mouse.up();
    if (got !== sp.at) return `按 (${sp.at}) 的正中，抓到的是 ${got}`;
  }
  return '';
}

async function playOne(page, label, opts) {
  /**
   * 这一副棋盘的段数表。查不到（炸弹局、或者新加的棋盘）就**不做 H5**，并在汇总里说出
   * 来——不假装查过。
   */
  const ladder = opts.bomb ? null : LADDER_BY_BOARD[label.split(' #')[0]] ?? null;
  const probe = (fn, ...a) => page.evaluate(fn, ...a);
  const snap = () => probe(() => window.__bot.snap());
  const hud = () => probe(() => window.__bot.hud());
  const tally = () => probe(() => window.__bot.tally());
  const toasts = () => probe(() => window.__bot.toasts());
  const ended = () => probe(() => window.__bot.ended());

  /** 等这一步真的走完：枚数和 id 布局连着两次一样为止（连锁、消行都算完）。 */
  async function settle(maxMs = 5000) {
    const t0 = Date.now();
    let prev = '';
    for (;;) {
      await page.waitForTimeout(120);
      const now = await snap();
      // 指纹不含 id：只有方块挂 data-id（见 lineThrough 上面那段）。面和颜色就够——
      // 连锁、翻面、消行每一拍都会改它们。
      const key = now.map((q) => `${q.at}:${q.face}:${q.color}`).join('|');
      if (key === prev) return now;
      prev = key;
      if (Date.now() - t0 > maxMs) return now;
    }
  }

  let board = await settle();
  const startTiles = board.filter((p) => p.face !== 'blank').length;
  /**
   * 每个方向上「内容顺着拖还是反着拖」：+1 / −1 / 0（这副棋盘不认这个方向）/
   * undefined（还没校准）。校准一个方向只做一次，见下面 calibrate。
   */
  const dirSign = new Map();
  /** 这一局见过的线（去重之后的格子序列），H1 和聚边度都用它。 */
  const lineSet = new Map();
  let moves = 0;
  let card = null;
  let levelLow = 4;
  let ladderMoved = false;
  /** 这一局一共翻了几枚：段数每熄一段就是翻了一枚（engine/erosion.ts）。 */
  let flips = 0;
  /** 段数变多、而枚数没少的次数（不该发生，见下面那一段）。 */
  let segsGrewOddly = 0;
  /**
   * H5：画的枚数和**累计翻面数推出来的级数**对不上的次数（v1.3.1 的 E25）。
   *
   * 玩家实测报过「这一块显示的是解锁之后那一级，不是当前这一级」。纯函数那一头有
   * check-pattern-level.mjs 逐级逐枚验过（erosion 的级数、runPatternDef 的图形数、老虎机
   * 那一路的 sizeAtLevel/erodedFace 全对），剩下唯一验不到的是**时序**：屏幕上那一拍画
   * 的是扣段前还是扣段后的视图。那一条只有真打一局才看得见，所以在这儿。
   *
   * 「当前该是第几级」这道门自己从盘面推，不问游戏：
   *
   *     累计翻面枚数 = 此刻的星星数 + 已经离场的枚数
   *
   * 每翻一枚就多一颗星星，而消掉的那些格子带着星星一起离场（§3）——两项加起来就是这一
   * 局一共翻了多少枚。再按 §2 那张段数表折成级数。**这一路和 erosion 一个字都不共用。**
   */
  let levelMismatch = 0;
  let levelMismatchNote = '';
  /** H7：这一局里量到几次「棋子戳出底板」「按哪一枚抓到的是另一枚」。 */
  let fitOut = 0;
  let fitNote = '';
  let grabMiss = 0;
  let grabNote = '';
  /** H7 真的被问过几次（量了 0 次的话那两条是空绿，要说出来）。 */
  let fitChecks = 0;
  let bombDefuseChecked = 0;
  let bombDefuseBad = 0;
  /** 连着几步盘面一个字都没变。 */
  let frozen = 0;
  /**
   * 「这一手试过了，什么也没换来」——分数没涨、段数没熄。
   *
   * 没有这一条，机器人会**一手棋打到预算用完**。量到的原话：小球那一局第 12 步之后，
   * 同一手 `3,3 / 右上` 连着走了两百多次，每次局面分都说「比现在好 15 分」（那 15 分
   * 来自聚边度），可滑完之后真实局面分一个字没变——于是下一拍它又是最好的一手。贪心
   * 只看「下一步比现在好不好」，看不出「这一步走完还是原地」。
   *
   * 记的是「走过而且白走」的那几手，等屏幕上真的有东西变了（分数涨了或者段数熄了）就
   * 整份清掉。所以铺垫那一类不得分的手照样走得通——它只挡「走完什么都没发生」的手。
   */
  const barren = new Set();
  let lastHud = await hud();

  // 八个方向都试：方块只认横竖，别的棋盘还认两条斜线，而这个机器人**不写死几何**
  // ——哪几个方向这副棋盘认，是滑过之后才知道的。
  const DIRS = [
    { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
    { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
    { dx: 0.7, dy: 0.7 }, { dx: -0.7, dy: -0.7 },
    { dx: 0.7, dy: -0.7 }, { dx: -0.7, dy: 0.7 },
  ];
  const dirKey = (d) => `${d.dx},${d.dy}`;
  /** 每个方向试过几次、动过几次。连着试了这么多次一次都没动过，就不再试它。 */
  const dirTried = new Map();
  const dirWorked = new Map();
  const DEAD_AFTER = 6;
  const dirDead = (d) => {
    const k = dirKey(d);
    return (dirTried.get(k) ?? 0) >= DEAD_AFTER && (dirWorked.get(k) ?? 0) === 0;
  };
  /**
   * 校准这个方向的正负号：拿实测的盘面和两种预测各比一遍，对得上的格子多的那一个就是它。
   *
   * 比的是「格子里的面和颜色」，不是 id——所以颜色重复也不怕：一整条线上十几个格子里
   * 对得上的个数，两种预测之间差得很开；真的一样多（比如那一手同时还消了行）就不作
   * 数，留给下一手再校。
   */
  const calibrate = (d, seats, beforeSnap, afterSnap) => {
    const k = dirKey(d);
    if (dirSign.has(k) || seats.length < 3) return;
    const real = new Map(afterSnap.map((q) => [q.at, `${q.face}/${q.color}`]));
    const agree = (sign) => {
      const sim = applyPerm(beforeSnap, shiftPerm(seats, sign));
      if (!sim) return -1;
      let hit = 0;
      for (const q of sim) if (real.get(q.at) === `${q.face}/${q.color}`) hit++;
      return hit;
    };
    const plus = agree(1);
    const minus = agree(-1);
    if (plus === minus) return;
    dirSign.set(k, plus > minus ? 1 : -1);
  };

  while (moves < BUDGET) {
    card = await ended();
    if (card) break;
    const alive = board.filter((p) => p.face !== 'blank');
    if (!alive.length) {
      // 盘清空了：结算该自己来。等一等再看（H2 的一半）。
      await page.waitForTimeout(2500);
      card = await ended();
      break;
    }
    const lines = [...lineSet.values()];
    /** 此刻要凑几枚（HUD 那一块画着几枚就是几枚）。读不到就按开局那一级算。 */
    const need = lastHud.marks ?? 4;
    // ── 挑这一步 ─────────────────────────────────────────────
    // 学过的手先在本地推一遍、按局面分排个序；没学过的手是「探索」，也得留位置
    // ——不探索就永远学不到新的线，尤其是棋盘缩圈之后。
    const known = [];
    const unknown = [];
    // 八个方向里有几个在这副棋盘上是同一手（方块把斜拖当成横或竖），按置换本身去重
    // ——不然同一手要评八遍，看第二层的时候前 8 个候选全是它自己。
    const seenPerm = new Set();
    const permOf = new Map();
    for (const p of alive) {
      for (const d of DIRS) {
        if (dirDead(d)) continue;
        const sign = dirSign.get(dirKey(d));
        // 还没校准过这个方向：去试一手，那一手既是一步棋也是一次校准。
        if (sign === undefined) { unknown.push({ p, d }); continue; }
        // 0 = 试过好几次一次都没动，这副棋盘不认这个方向。
        if (sign === 0) continue;
        if (barren.has(`${p.at}|${dirKey(d)}`)) continue;
        const seats = lineThrough(board, p, d);
        if (seats.length < 2) continue;
        const perm = shiftPerm(seats, sign);
        permOf.set(`${p.at}|${dirKey(d)}`, perm);
        const sig = perm.map(([a, b2]) => `${a}>${b2}`).sort().join('|');
        if (seenPerm.has(sig)) continue;
        seenPerm.add(sig);
        const moved = applyPerm(board, perm);
        if (!moved) continue;
        // 滑完之后棋盘自己会结算：本地也算上那一下（见 resolveSim 上面那段）。
        const sim = resolveSim(moved, lines, need);
        known.push({
          p, d,
          value: positionScore(sim.board, startTiles, (lastHud.score ?? 0) + 2 * sim.flipped, lines),
          // 只留「以为会在哪几格得分」，不留整块盘面：候选有几百个，各挂一份盘面
          // 光是复制就比推演本身贵。BOT_DEBUG2 靠它把「以为要得分、实际没得」印出来
          // ——线当成环那个 bug 就是这么找出来的。
          expect: sim.flipped ? scoringGroupOnBoard(moved, lines, need) : null,
        });
      }
    }
    known.sort((a, b) => b.value - a.value);
    const base = positionScore(board, startTiles, lastHud.score ?? 0, lines);
    let pick = known.length && known[0].value > base + 1e-9 ? known[0] : null;
    // **一步之内无分可得时，对前 8 个候选再看一层**（方案里那一条）。
    //
    // 这一层不是锦上添花，是这个机器人**能不能凑出第一条线**的关键：盘上六种颜色各
    // 六枚，四连很少自己撞出来，一步棋看不到的路两步棋看得到。没有它，机器人前十几
    // 步靠碰运气得一次分，之后就一直在「谁也不比谁好」的平地上乱走，图案一级都降不
    // 下来——量过：四十步只得过一次分。
    if (!pick && known.length) {
      let best = null;
      for (const cand of known.slice(0, 8)) {
        const moved = applyPerm(board, permOf.get(`${cand.p.at}|${dirKey(cand.d)}`) ?? []);
        if (!moved) continue;
        const sim1 = resolveSim(moved, lines, need);
        let deep = sim1.flipped ? cand.value : -Infinity;
        for (const [, perm2] of permOf) {
          // 第二手只从这一拍已经算出来的那些线里挑。
          const moved2 = applyPerm(sim1.board, perm2);
          if (!moved2) continue;
          const sim2 = resolveSim(moved2, lines, need);
          if (!sim2.flipped) continue;
          const v = positionScore(sim2.board, startTiles, (lastHud.score ?? 0) + 2 * (sim1.flipped + sim2.flipped), lines);
          if (v > deep) deep = v;
        }
        if (deep > -Infinity && (!best || deep > best.deep)) best = { ...cand, deep };
      }
      if (best && best.deep > base + 1e-9) pick = best;
    }
    // 还是不行就去探索（没试过的手），试出来的既是一步棋也是一条新学到的线。
    if (!pick && unknown.length) pick = unknown[Math.floor(Math.random() * unknown.length)];
    if (!pick && known.length) pick = known[Math.floor(Math.random() * Math.min(8, known.length))];
    if (!pick) break;

    const beforeBoard = board;
    const beforeBombs = board.filter((p) => p.bomb).length;
    const beforeHud = lastHud;
    const { p, d } = pick;
    // **一小段一小段地送 pointermove，中间留一两毫秒。** 一次 `mouse.move(..., {steps})`
    // 的那几下落在同一拍里，拖动那一层（engine/drag.ts）认不出这是一次拖——量过：
    // 那种写法六十步一个格子都没动过，而这一版第一步就动了六个。
    const reach = Math.max(18, p.w * 1.15);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    for (let k = 1; k <= 8; k++) {
      await page.mouse.move(p.x + (d.dx * reach * k) / 8, p.y + (d.dy * reach * k) / 8);
      await page.waitForTimeout(8);
    }
    await page.mouse.up();
    board = await settle();
    moves++;
    const after = await hud();

    // ── 这一手动了没有、这个方向的正负号是哪一个 ─────────────
    //
    // 「动了没有」只看格子里的面和颜色有没有变（不看 id——只有方块挂 id，见
    // lineThrough 上面那段）。同色同面的两枚换个位置看不出来，所以这个判断偏保守：宁
    // 可把一手真动过的算成没动，也不会把没动的算成动了。下面只有两处用它——「这个方向
    // 这副棋盘认不认」和「是不是卡住了」——两处都容得下偏保守。
    const seats = lineThrough(beforeBoard, p, d);
    const beforeFace = new Map(beforeBoard.map((q) => [q.at, `${q.face}/${q.color}`]));
    let changed = 0;
    for (const q of board) if (beforeFace.get(q.at) !== `${q.face}/${q.color}`) changed++;
    calibrate(d, seats, beforeBoard, board);
    // 这一手动过的那条线记下来：H1 那把尺子和聚边度都顺着线找。lineThrough 给的已经
    // 是按方向排好的顺序，头尾就是线的两端——得分那条线**不循环**（见
    // scoringGroupOnBoard），所以顺序要的就是这个。
    if (changed && seats.length >= 2) lineSet.set(seats.slice().sort().join('>'), seats);
    if (!changed) frozen++;
    else frozen = 0;
    {
      const dk = dirKey(d);
      dirTried.set(dk, (dirTried.get(dk) ?? 0) + 1);
      if (changed) dirWorked.set(dk, (dirWorked.get(dk) ?? 0) + 1);
      // 试了好几次一次都没动过：这副棋盘不认这个方向，别再评它，也别再等它校准。
      if (!dirSign.has(dk) && dirDead(d)) dirSign.set(dk, 0);
    }

    // ── H7：放大之后棋子还在底板里，而且按哪一枚就抓到哪一枚 ──
    //
    // 每 8 手量一次，不是每一手：两条都要问 DOM，每手问一遍会把一局从 2 分钟拖到 4 分钟
    // 多，而这一条要抓的毛病（放大算错）一旦出现就会一直在，隔几手也一定撞上。
    if (moves % 8 === 0) {
      fitChecks++;
      const out = await piecesInsideFloor(page);
      if (out) {
        fitOut++;
        if (!fitNote) fitNote = `第 ${moves} 手：${out}`;
      }
      const miss = await grabHitsSelf(page);
      if (miss) {
        grabMiss++;
        if (!grabNote) grabNote = `第 ${moves} 手：${miss}`;
      }
    }

    // ── H3：阶梯推得动 ──────────────────────────────────────
    if (after.marks !== null) {
      levelLow = Math.min(levelLow, after.marks);
      if (after.marks < 4) ladderMoved = true;
    }
    // 同一级里段数少了几段就是翻了几枚；跨级那一下段数会跳回满格，那一拍按「这一级
    // 本来剩几段」算不准，所以只数同级的减量，宁可少算不多算。
    if (after.segs < beforeHud.segs) flips += beforeHud.segs - after.segs;
    // ── H5：画的枚数 == 按累计翻面推出来的级数 ──────────────
    if (ladder && after.marks !== null) {
      const t = await tally();
      const cum = t.stars + (startTiles - t.alive);
      const want = levelFromFlips(ladder, cum);
      if (after.marks !== want) {
        levelMismatch++;
        if (!levelMismatchNote) {
          levelMismatchNote = `第 ${moves} 手：累计翻 ${cum} 枚（星 ${t.stars} + 离场 ${startTiles - t.alive}）`
            + ` → 该画 ${want} 枚，实际画了 ${after.marks} 枚`;
        }
      }
    }
    // **段数只减不增，除了降级那一拍。** 这是侵蚀阶梯的不变式，而且和预算无关：段变多
    // 只该发生在「这一级扣光了、换下一级的满格」那一下，那一下枚数必定同时少一枚。
    // 段凭空长回去的话，屏幕上是「刚才快扣完了，怎么又满了」——玩家读不出规则，而不是
    // 读到一条错的规则。
    if (after.segs > beforeHud.segs && !(after.marks !== null && beforeHud.marks !== null && after.marks < beforeHud.marks)) {
      segsGrewOddly++;
      note(`${label}：第 ${moves} 手段数从 ${beforeHud.segs} 涨到 ${after.segs}，而枚数还是 ${after.marks}`);
    }
    // ── H4：炸弹拆一枚就要熄一段 ────────────────────────────
    if (opts.bomb) {
      const nowBombs = board.filter((q) => q.bomb).length;
      const defused = beforeBombs - nowBombs;
      if (defused > 0 && beforeHud.score !== null && after.score !== null) {
        bombDefuseChecked++;
        const gained = after.score - beforeHud.score;
        const burnt = beforeHud.segs - after.segs || after.marks < beforeHud.marks;
        if (gained < 2 * defused || !burnt) {
          bombDefuseBad++;
          note(`${label}：拆了 ${defused} 枚，分 +${gained}，段 ${beforeHud.segs}→${after.segs}`);
        }
      }
    }
    // 白走的手记下来，换来了东西就把那一份清掉（见 barren 上面那段）。
    if (after.score === beforeHud.score && after.segs === beforeHud.segs) {
      barren.add(`${p.at}|${dirKey(d)}`);
      // 万一整副盘都被记成白走（残局上真有可能），清掉重来，别把自己饿死。
      if (barren.size > alive.length * DIRS.length * 0.8) barren.clear();
    } else {
      barren.clear();
    }
    lastHud = after;
    if (process.env.BOT_DEBUG2 && pick.expect) {
      const dropped = beforeHud.segs - after.segs;
      if (!dropped) {
        const cell = new Map(board.map((q) => [q.at, q]));
        console.log(`      [why] 以为会得分：${pick.expect.join(' ')}`);
        console.log(`            滑完之后那几格：` + pick.expect.map((at) => {
          const q = cell.get(at);
          return q ? `${at}=${q.face}/${q.color}` : `${at}=?`;
        }).join('  '));
      }
    }
    if (process.env.BOT_DEBUG) {
      console.log(`      [dbg] ${moves} 手 ${p.at} d=${d.dx},${d.dy} 动${changed} 线${lineSet.size} need=${need} 分=${after.score} 枚=${after.marks} 段=${after.segs} known=${known.length} base=${base.toFixed(1)} top=${known[0]?.value.toFixed(1) ?? '-'}`);
    }
    // 卡死：连着这么多步一个格子都没动过，而局还活着。
    if (frozen >= 12) break;
  }

  const seenToasts = await toasts();
  const finalBoard = board;
  const finalHud = lastHud;
  const alive = finalBoard.filter((p) => p.face !== 'blank');
  return {
    label,
    moves,
    startTiles,
    aliveLeft: alive.length,
    swept: alive.length === 0,
    levelLow,
    ladderMoved,
    flips,
    segsGrewOddly,
    levelMismatch,
    levelMismatchNote,
    fitOut,
    fitNote,
    grabMiss,
    grabNote,
    fitChecks,
    ladderKnown: Boolean(ladder),
    toasts: seenToasts,
    card,
    frozen,
    budgetOut: moves >= BUDGET,
    lines: [...lineSet.values()],
    board: finalBoard,
    need: finalHud.marks,
    bombDefuseChecked,
    bombDefuseBad,
  };
}

/** 开一局：主菜单点那张卡（或炸弹那一档），等棋盘出来。 */
async function openRun(page, board, bomb) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.home-icon-btn', { timeout: 20000 });
  await page.waitForTimeout(250);
  if (bomb) {
    // 基础炸弹：主菜单那一排里「基础炸弹 · <形状>」。窄屏是居中弹窗，宽屏原地摊开
    // ——两种都认（和 check-board-fit 同一条路）。
    const hit = await page.$$eval('.home-icon-btn', (els, want) => {
      const el = els.find((e) => (e.getAttribute('aria-label') || '').startsWith(want));
      if (!el) return false;
      el.click();
      return true;
    }, '基础炸弹');
    // eslint 之类的东西这儿没有，所以把「找不到就说清楚」留在调用方（openRun 回
    // false，上面那一层报「棋盘没出现」）。
    if (!hit) return false;
    // 档位是一整页（10-08 方案 3-G，从前是一扇居中的窗）：换页那一下要等它摆出来。
    await page.waitForSelector('.bomb-page .bomb-chip, .center-pick .center-pick-opt', { timeout: 5000 }).catch(() => {});
    // **用 el.click()，不用 page.click()/elementHandle.click()。** 手机竖屏的主菜单是
    // 一条鱼眼轴（ui/modeAxis.ts），远处的卡在视口外面，Playwright 会一直「滚动到可见
    // 位置」然后报 element is outside of the viewport，三十秒后超时——CLAUDE.md 里记着
    // 这一条。真玩家是先把轴滑过去再点的；这道门量的不是主菜单点不点得着。
    const picked = await page.$$eval(
      '.bomb-chip, .center-pick .center-pick-opt:not(.center-pick-opt--locked)',
      (els) => { if (!els.length) return false; els[0].click(); return true; },
    );
    if (picked) await page.waitForTimeout(400);
  } else {
    const hit = await page.$$eval('.home-icon-btn', (els, want) => {
      const el = els.find((e) => (e.getAttribute('aria-label') || '').trim() === want);
      if (!el) return false;
      el.click();
      return true;
    }, board);
    if (!hit) return false;
  }
  await page.waitForTimeout(400);
  if (await page.$('#startBtn')) await page.$eval('#startBtn', (e) => e.click());
  const up = await page
    .waitForFunction(() => document.querySelectorAll('#boardWrap [data-r][data-c]').length > 0, { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  if (up) await page.waitForTimeout(500);
  return up;
}

// ---------------------------------------------------------------------------

const ctx = await browser.newContext({
  viewport: { width: 430, height: 900 },
  // 动画全关：一步棋从一秒多压到两三百毫秒。关掉的是演出，不是规则——连锁、翻面、
  // 消行照旧一拍一拍走完（settle 等的就是它们）。
  reducedMotion: 'reduce',
});
await ctx.addInitScript(() => {
  localStorage.setItem('slides_lang', 'zhHans');
  localStorage.setItem('slides_intro_seen', '1');
  // 头一回那套引导会把主菜单锁住、棋盘底下摆一块教学条，量的不是它。
  for (const k of [
    'slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle',
    'slides_played_square', 'slides_played_circle', 'slides_know_how',
  ]) localStorage.setItem(k, '1');
  // 天才特供那几副（七色圆球、六边三角）要开通才进得去。照「兑过一张长期内部码的
  // 玩家」原样摆一份：channel 必须是 'code'（别的柜台会被 read() 丢成 NOBODY），
  // 而内部码没过期时 refreshEntitlement 原地掉头，一个请求都不发。
  localStorage.setItem('slides_genius', JSON.stringify({
    active: true, channel: 'code', until: Date.now() + 365 * 864e5,
  }));
});
await ctx.addInitScript(installProbe);
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

const runs = [];
const jobs = [
  ...BOARDS.flatMap((b) => Array.from({ length: RUNS }, () => ({ board: b, bomb: false }))),
  ...Array.from({ length: BOMB_RUNS }, () => ({ board: '基础炸弹', bomb: true })),
];
console.log(`共 ${jobs.length} 局（${SOAK ? '泡机档' : '抽检档'}，每局最多 ${BUDGET} 步）\n`);

for (const [i, job] of jobs.entries()) {
  const label = `${job.board} #${i + 1}`;
  const up = await openRun(page, job.board, job.bomb);
  if (!up) { check(`${label}：开得起来`, false, '棋盘没出现'); continue; }
  const r = await playOne(page, label, { bomb: job.bomb });
  runs.push({ ...r, bomb: job.bomb });
  const how = r.card ? r.card.title : r.budgetOut ? '预算用完，局还活着' : r.frozen >= 12 ? '卡住了' : '（没收场）';
  note(`${label}：${r.moves} 步 · 剩 ${r.aliveLeft}/${r.startTiles} 枚 · 图案最低 ${r.levelLow} 枚 · ${how}`);

  // ── H1：结束的那一刻，盘上不该还摆着一个得分组 ──────────────
  if (r.card) {
    const need = r.need ?? 4;
    const hit = r.lines.length ? scoringGroupOnBoard(r.board, r.lines, need) : null;
    if (!r.lines.length) {
      check(`${label} · H1：这一局没学到任何一条线，这一条无从判断（不假装查过）`, true, `${r.moves} 步`);
    } else {
      check(`${label} · H1：结束时盘上没有成立的得分组`, hit === null,
        hit ? `还摆着 ${need} 枚同色：${hit.join(' ')}（结算页写的是「${r.card.title}」）` : `按 ${need} 枚同色数过 ${r.lines.length} 条线`);
    }
    // 报「全部消完了」就一枚都不该剩。
    if (/全部|消完|翻成/.test(r.card.title)) {
      check(`${label} · H1：报「${r.card.title}」时盘上真的空了`, r.aliveLeft === 0, `还剩 ${r.aliveLeft} 枚`);
    }
  }
  // ── H2：不该卡死 ────────────────────────────────────────
  check(`${label} · H2：没有卡死（盘空了就该结算，盘不动了不该还挂着）`,
    !(r.frozen >= 12 && !r.card) && !(r.aliveLeft === 0 && !r.card),
    r.frozen >= 12 && !r.card ? `连着 ${r.frozen} 步一个格子都没动，局还活着`
      : r.aliveLeft === 0 && !r.card ? '盘已经空了，结算页没出来' : '');
  // ── H5：图案块画的级数 ──────────────────────────────────
  if (r.ladderKnown) {
    check(`${label} · H5：这一块画的枚数 == 按累计翻面推出来的级数`, r.levelMismatch === 0,
      r.levelMismatchNote || `核了 ${r.moves} 手`);
  } else {
    note(`${label} · H5：这一副的段数表不在门里那张表上，这一条跳过（不假装查过）`);
  }
  // ── H6：变级那一下真的说了一句话，而且摆得下 ───────────
  //
  // 降级是一局里最重要的一次规则变化（要凑的东西少了一枚）。PR-14 给它补了棋盘上方那条
  // 「得分图案变成 N 枚」——它只活一秒六，手跑十有八九错过，所以在这儿钉住。
  if (r.ladderMoved) {
    check(`${label} · H6：降级那一下冒了「得分图案变成 N 枚」`, r.toasts.length > 0,
      `降到过 ${r.levelLow} 枚，冒了 ${r.toasts.length} 条`);
    const outside = r.toasts.filter((t) => t.out);
    check(`${label} · H6：那句话没顶出屏幕`, outside.length === 0,
      outside.length ? JSON.stringify(outside[0]) : r.toasts.map((t) => `${t.text}(${t.w}×${t.h})`).join(' '));
  } else {
    note(`${label} · H6：这一局没降过级，那句话无从判断（不假装查过）`);
  }
  // ── H7：放大之后棋子还在底板里，而且按哪一枚就抓到哪一枚 ──────
  //
  // 第 6 推（「消除之后剩下的部分整体放大」）带来的两件最容易出事的事。两条都量不到的局
  // （一手都没走满 8 手）要说出来，不假装查过。
  if (r.fitChecks > 0) {
    check(`${label} · H7：每一枚都还在底板里（量了 ${r.fitChecks} 次）`, r.fitOut === 0,
      r.fitNote || `${r.fitOut} 次`);
    check(`${label} · H7：按哪一枚就抓到哪一枚`, r.grabMiss === 0, r.grabNote || `${r.grabMiss} 次`);
  } else {
    note(`${label} · H7：这一局没走满 8 手，这两条无从判断（不假装查过）`);
  }
  // ── H4：炸弹 ────────────────────────────────────────────
  if (job.bomb && r.bombDefuseChecked) {
    check(`${label} · H4：拆一枚就 +2 分、熄一段`, r.bombDefuseBad === 0,
      `拆除 ${r.bombDefuseChecked} 次，${r.bombDefuseBad} 次对不上`);
  }
}

// ── H3：阶梯要推得动 ────────────────────────────────────────
//
// 三层，各自和预算相称——一副棋盘的第一级有三十几段（方块是 31，见
// engine/erosion.ts 的表），也就是说「图案降一级」要先翻掉三十几枚棋子。抽检档一局
// 一百六十步，够降一级；「降到 1 枚」几乎等于清盘，那是泡机档的量。写一条跨不过去的
// 断言，等于天天红——而天天红的门最后一定会被人关掉。
for (const b of [...BOARDS, ...(BOMB_RUNS ? ['基础炸弹'] : [])]) {
  const mine = runs.filter((r) => r.label.startsWith(b + ' '));
  if (!mine.length) continue;
  // ① 非空的尺子：每一局都得真的熄过段（= 真的翻到过棋子）。一局一枚都没翻，下面
  //    两条就是空的——而「机器人其实一分没得」看起来和「规则没问题」一模一样。
  check(`${b} · H3：每一局都真的熄过段（尺子）`, mine.every((r) => r.flips > 0),
    mine.map((r) => `${r.flips}段`).join(' '));
  // ② **段数只减不增，除了降级那一拍。** 这一条和预算无关，所以它才是这道门在阶梯
  //    上真正的硬断言（见 playOne 里那一段）。
  check(`${b} · H3：段数只减不增（降级那一拍除外）`,
    mine.every((r) => r.segsGrewOddly === 0),
    mine.map((r) => r.segsGrewOddly).join(','));
  // ③ 「真的降过级 / 推到底」只在泡机档断言。
  //
  //    为什么不在抽检档也断言：阶梯第一级就有三十几段（方块 31、小球 25，见
  //    engine/erosion.ts 的表），也就是说图案降一级要先翻掉三十几枚棋子，而这个机器
  //    人每十步左右才翻一枚、还很看开局那副牌。量过同一副棋盘同样 260–300 步，有一
  //    局一路降到 1 枚，另一局一级都没降。**写死一条骑在边界上的断言，就是给自己造
  //    一道偶发红**，而偶发红最后一定会被人加 continue-on-error。
  //    「降级那一下算得对不对」本来也不缺门看着：check-erosion 逐行复算那张段数表，
  //    而且在 CI 里。这道门该管的是「段真的会随着翻面熄下去」（① 和 ②），那是只有
  //    真打一局才看得见的。
  if (SOAK) {
    check(`${b} · H3：至少有一局降到 1 枚或者把盘清空`,
      mine.some((r) => r.levelLow <= 1 || r.swept),
      mine.map((r) => `${r.levelLow}枚/剩${r.aliveLeft}`).join(' '));
  } else {
    note(`${b} · H3：图案最低降到 ${Math.min(...mine.map((r) => r.levelLow))} 枚（「推到底」这一条留给 --soak）`);
  }
}
// ── H1 到底跑过几次 ────────────────────────────────────────
//
// **H1 只在一局真的收场时才有东西可量**（结算页出来了，才谈得上「结束的那一刻盘上还
// 摆着没摆着一个得分组」）。预算用完那种局它一条都不跑——而屏幕上照样一片 PASS。这是
// 这道门最容易变成假绿的地方，所以把次数摆出来：一局都没收场就说清楚，不假装查过。
{
  const ended = runs.filter((r) => r.card).length;
  if (ended === 0) {
    note(`H1：这一批 ${runs.length} 局没有一局走到结算页（预算 ${BUDGET} 步都用完了），`
      + `所以 H1 一条都没跑过——不假装查过。要量它就把预算加大（--budget）或者用 --soak。`);
  } else {
    check(`H1 真的量到了（${ended} / ${runs.length} 局走到了结算页）`, true,
      runs.filter((r) => r.card).map((r) => r.card.title).join(' / '));
  }
}

// 炸弹那几局至少要真的拆到过一枚，不然 H4 是空的。
if (BOMB_RUNS) {
  const tried = runs.filter((r) => r.bomb).reduce((a, r) => a + r.bombDefuseChecked, 0);
  check('炸弹局真的拆到过炸弹（不然 H4 是空的）', tried > 0, `${tried} 次`);
}
check('一路没报错', errs.length === 0, errs[0] || '');

// ── 报告项：只摆数字，不挡合并（方案 E12：参数已定，不据此改参）────────
console.log('\n── 报告（不挡合并）──────────────────────────────');
for (const b of [...BOARDS, ...(BOMB_RUNS ? ['基础炸弹'] : [])]) {
  const mine = runs.filter((r) => r.label.startsWith(b + ' '));
  if (!mine.length) continue;
  const swept = mine.filter((r) => r.swept).length;
  const mv = mine.map((r) => r.moves).sort((a, c) => a - c);
  const mid = mv[Math.floor(mv.length / 2)];
  const left = mine.map((r) => r.aliveLeft);
  console.log(
    `${b.padEnd(6)} ${mine.length} 局 · 清盘 ${swept}/${mine.length} · ` +
    `步数 ${mv[0]}–${mv[mv.length - 1]}（中位 ${mid}）· ` +
    `终局剩 ${Math.min(...left)}–${Math.max(...left)} 枚 · ` +
    `图案最低 ${Math.min(...mine.map((r) => r.levelLow))} 枚`,
  );
}

await browser.close();
console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项没过`);
process.exit(fail ? 1 : 0);

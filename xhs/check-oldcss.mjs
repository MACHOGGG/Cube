/**
 * 样式降级层的对照台——每一屏量两遍，比给出来的排版一不一样。
 *
 *   node xhs/check-oldcss.mjs            # 全部屏
 *   node xhs/check-oldcss.mjs 主菜单     # 只跑一屏（名字见 SCREENS）
 *
 * CSS 这一层没法像 JS 那样「把接口删掉」来模拟老内核：删不掉浏览器认得 gap
 * 这件事。所以反过来——xhs/src/oldKernel.ts 留了个后门
 * （window.__SLIDES_OLD_KERNEL__），设成 true 就当所有能力都缺，整条降级路径
 * 在新浏览器上完整跑一遍。
 *
 * 于是可以这么比：
 *
 *   甲：正常渲染（浏览器自己认 gap / clamp / aspect-ratio）
 *   乙：强制走降级层（换算成 px、外边距、内边距百分比）
 *
 * 两边量同一批盒子，差得超过阈值就是降级层没给对。这不是「看着差不多」，
 * 是逐个盒子的坐标和尺寸。
 *
 * 每一屏还会顺手做两件事：
 *   · 扫一遍降级之后**还剩多少没算掉的** clamp / min / max。带百分比的算不
 *     出来（百分比要看容器多宽，那是排版排到一半才知道的事），而算不掉就等
 *     于在 Chrome 61 上被整条丢掉——这些必须一条条看过，不能让它们躲着。
 *   · 查有没有东西横着顶出屏幕。
 *
 * 量不到的：真机上的字体度量和性能。那两样只有真机说了算。
 *
 * 跑之前要先出一次包和预览页（这两个脚本读的是 xhs/preview.html，
 * 那是构建产物，不在仓库里）：
 *
 *   npm run check:xhs        ← 三步一起跑，平时用这个
 *
 * 只想单独跑这一个的话，先手动来两步：
 *
 *   npm run build:xhs && node xhs/preview.mjs
 *   node xhs/check-oldcss.mjs
 *
 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensurePreview } from './ensurePreview.mjs';


// 读的是产物 preview.html，它不提交、也不会自己重出——过期了就在这儿重出一次
// （理由在 ensurePreview.mjs 的文件头：不这么做，这道门会在旧样式上全绿）。
ensurePreview();
const here = dirname(fileURLToPath(import.meta.url));
const PAGE = pathToFileURL(join(here, 'preview.html')).href;

let fails = 0;
const say = (ok, text, extra = '') => {
  if (!ok) fails++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + text + (extra ? '  ' + extra : ''));
};

/** 量一批盒子：选择器 → [{x,y,w,h}, ...]，全部四舍五入到整像素。 */
const MEASURE = (sels) => {
  const out = {};
  for (const sel of sels) {
    out[sel] = [].slice.call(document.querySelectorAll(sel)).map((e) => {
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    });
  }
  return out;
};

/**
 * 会折行那种容器，它自己那个框在降级层里会宽出一整道缝——这是负外边距那套
 * 补法的必然结果（子项四周各加半道，容器四周各减半道，子项落回原位，容器的
 * 框比原来大一道）。这几个框都是透明的排版壳，没有底色也没有描边，看不见；
 * 真正要对上的是它们**里面**那些看得见的东西，那些照旧按 2px 卡。
 * 所以只放宽这几个壳自己的宽高，位置（x / y）仍然严格。
 */
const WRAP_HOSTS = [
  // 这儿原先第一个是 `.app--game .pattern-hint`——棋盘上方那条得分图示带。《侵蚀阶梯》
  // v1.2 PR-7 把它退役了（现在是顶排两块 HUD，一个两列的 grid，不折行），所以这一行
  // 连着放宽都不需要了。
  '.app--game .controls',
  '.xhs-share-bar',
  '.slot-pick-row',
  '.shape-pick-row',
  '.btn-row',
  '.end-breakdown',
];
const isHost = (sel) => WRAP_HOSTS.some((h) => sel === h || sel.indexOf(h) >= 0);

/**
 * 「这一格是被**这一局的分数**推出来的」——那就别比它。
 *
 * 只有横屏的结算页有这个毛病，而且是 2026-09「结算页整合分享图」之后才有
 * 的：那一屏从此劈成两栏，左边一列文字、右边一张战绩图，左边这一列是 auto
 * 宽，宽度由最长那一行决定。两遍体检各打各的一局，分数本来就不一样——
 * 「有效得分率加成（0%）」和「（14%）」差一个字，这一列就宽出十来像素，底下
 * 那道分隔线跟着变宽，《主页 / 分享 / 再来》整排跟着右移。
 *
 * 这十来像素每次都在，和降级层没有半点关系：两张截图叠起来一模一样（跑完
 * 看 .tmp-oldcss/844-结算页-new.png 和 -old.png）。文件开头就写着「刻意避开
 * 纯文字的盒子」，这里是同一条规矩的下游——盒子自己不是文字，可它的位置和
 * 宽度是文字推出来的。
 *
 * 放的只是列出来的那几格，其余每一格、别的每一屏，全都照旧按 2px 卡。
 */
const LOOSE = {
  结算页: {
    // 分隔线：宽度跟着上面那块分数走。
    '.end-rule': ['x', 'w'],
    // 三颗键：整排被左边那一列推着走，宽高本来就归 WRAP_HOSTS 管。
    '.btn-row': ['x'],
    '.btn-row button': ['x'],
  },
};

/** 两批量测比一比。 */
function compare(label, a, b, tol) {
  const loose = LOOSE[label] || {};
  let worst = 0;
  let where = '';
  let seen = 0;
  const all = [];
  for (const k of Object.keys(a)) {
    if (a[k].length !== b[k].length) {
      say(false, `${label} · ${k} 个数对不上`, `新 ${a[k].length} / 降级 ${b[k].length}`);
      continue;
    }
    seen += a[k].length;
    const host = isHost(k);
    for (let i = 0; i < a[k].length; i++) {
      for (const f of ['x', 'y', 'w', 'h']) {
        if ((loose[k] || []).indexOf(f) >= 0) continue;
        const limit = host && (f === 'w' || f === 'h') ? 70 : tol;
        const d = Math.abs(a[k][i][f] - b[k][i][f]);
        if (d <= limit) continue;
        all.push(`${k}[${i}].${f}  新 ${a[k][i][f]} / 降级 ${b[k][i][f]}  (差 ${d})`);
        if (d > worst) {
          worst = d;
          where = `${k}[${i}].${f} 新 ${a[k][i][f]} / 降级 ${b[k][i][f]}`;
        }
      }
    }
  }
  // 一个盒子都没量到，多半是选择器没匹配上或者根本没走到这一屏——那不是
  // 「一致」，是「什么都没比」。这种假通过比报错更糟，所以单独判掉。
  if (seen === 0) {
    say(false, `${label}：一个盒子都没量到（选择器没匹配上，或者没走到这一屏）`);
    return;
  }
  // **逐条也要量到。** 上面那一条只管「整屏一个盒子都没量到」，管不住「九个受测元素
  // 里有三个是空的」——那三个照旧算「一致」，而屏幕上它们根本不存在。PR-7 换掉顶排
  // 那几个选择器之后，这一屏就是这么绿了一整个版本的。
  const dead = Object.keys(a).filter((k) => a[k].length === 0 && (b[k] ?? []).length === 0);
  if (dead.length) say(false, `${label}：这几个选择器两边都一个也没匹配到（过期了？）`, dead.join(' '));
  say(worst === 0, `${label}：两边排版一致（量了 ${seen} 个盒子）`, worst ? `最大差 ${worst}px @ ${where}` : '');
  if (worst) all.slice(0, 12).forEach((l) => console.log('           ' + l));
}

// ---- 各屏怎么走到 -----------------------------------------------------------

const board = () =>
  ({ sel: '#boardWrap .tile, #boardWrap .ball' });

async function toBoard(p, cardIndex, opts = {}) {
  await p.$$eval('.home-icon-btn', (e, i) => e[i].click(), cardIndex);
  await p.waitForTimeout(800);
  if (opts.pick) {
    const shape = await p.$('[data-family="square"]');
    if (shape) await shape.click();
    await p.waitForTimeout(700);
  }
  if (opts.slot) await p.waitForTimeout(9000);
  const start = await p.$('#startBtn');
  if (start) await p.$eval('#startBtn', (e) => e.click());
  await p.waitForFunction(
    () => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball').length > 0,
    { timeout: 25000 },
  );
  await p.waitForTimeout(1400);
}

/** 真拖十下再按《完成》——结算页和分享窗口只有这样才到得了。 */
async function playAndFinish(p) {
  const box = await p.$eval('.board', (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  for (let i = 0; i < 8; i++) {
    const row = 0.12 + (i % 6) * 0.15;
    await p.mouse.move(box.x + box.w * 0.5, box.y + box.h * row);
    await p.mouse.down();
    await p.mouse.move(box.x + box.w * 0.5 + (i % 2 ? 62 : -62), box.y + box.h * row, { steps: 6 });
    await p.mouse.up();
    await p.waitForTimeout(260);
  }
  // 有可能这一局已经自己结束了（结算页盖上来，暂停键就点不着了）。
  // 那是一局正常走完，不是毛病——尤其老虎机：只认转出来的那两个图案，瞎拖
  // 十下很容易把场面拖到「再也凑不出来」。
  const ended = await p.$eval('#endOverlay', (e) => e.classList.contains('show')).catch(() => false);
  // 收尾是两步：《完成》搬进了暂停面板，现在叫《结束游戏》。
  if (!ended) {
    await p.click('#stopBtn');
    await p.waitForSelector('#pauseOverlay.show', { timeout: 8000 });
    await p.click('#pauseFinishBtn');
  }
  await p.waitForTimeout(2600);
}

/**
 * 每一屏：怎么走到、量哪些盒子。
 * 选的都是**排版骨架**——版心、行、卡、按钮、图。刻意避开纯文字的盒子：
 * 两次跑的分数是随机的，字一多一少宽度就不一样，那不是降级层的错。
 */
const SCREENS = [
  {
    name: '主菜单',
    async go() {},
    sels: [
      '.home-page', '.home-grid', '.home-row', '.home-icon-btn',
      '.home-icon-art', '.home-icon-tag', '.home-head-glass', '.home-nav-dock',
    ],
  },
  {
    name: '形状选择（炸弹）',
    async go(p) {
      await p.$$eval('.home-icon-btn', (e) => e[2].click());
      await p.waitForTimeout(900);
    },
    sels: ['.app', '.start-stage', '.slot-pick-area', '.slot-pick-row', '.slot-pick-opt', '.slot-pick-opt > svg', '.start-actions', '.icon-btn.start-act'],
  },
  {
    name: '老虎机转前',
    async go(p) {
      await p.$$eval('.home-icon-btn', (e) => e[3].click());
      await p.waitForTimeout(900);
    },
    // `.home-head-glass` 撤了：这一屏上没有招牌（挑图形那一页只有图和一句标语，
    // 见 src/ui/slotMachine.ts），那个选择器两边都一个也匹配不到——量的是空气。
    // 换成这一屏真有的那一句标语和底下那颗《退出》。
    sels: ['.slot-page', '.slot-pick-area', '.slot-pick-row', '.slot-pick-opt', '.slot-pick-opt > svg', '.slot-tagline', '.icon-btn.start-act'],
  },
  {
    name: '无限反转开局页',
    async go(p) {
      await p.$$eval('.home-icon-btn', (e) => e[4].click());
      await p.waitForTimeout(900);
    },
    sels: ['.app', '.start-stage', '.slot-pick-area', '.slot-pick-row', '.slot-pick-opt', '.slot-pick-opt > svg', '.start-actions', '.icon-btn.start-act'],
  },
  {
    name: '开局倒数页',
    async go(p) {
      await p.$$eval('.home-icon-btn', (e) => e[0].click());
      await p.waitForTimeout(900);
    },
    // ⚠️ `.cd-window` / `.cd-digit` 2026-10-03 才加进来——在那之前这一屏**从没量过倒数窗**，
    // 而它在 Chrome 61 上是个 0×0 的盒子（`aspect-ratio` 撑的高度，见 baseline.css 第 4 条）：
    // 那一端的开局页上压根没有倒数，牌桌自己就开了，门却一直全绿。
    sels: ['.start-stage', '.start-marks', '.start-mark', '.start-actions', '.icon-btn.start-act', '.cd-window'],
    // ⚠️ `.cd-digit` **不进 sels**，只进 nonzero：那个数字是荡进荡出的（`cd-swing` 带
    // `translateY(±118%)` ＋ `rotate(±15deg)`），而 `getBoundingClientRect` 量的是变换**之
    // 后**的盒子——两遍各自采到动画的哪一拍全看运气，差值能差两百多像素。那是偶发红，而
    // 偶发红最后一定会被人加 `continue-on-error`。它该被量的事情是「它到底画出来了没有」，
    // nonzero 正好量这个。
    //
    // 同理这儿**不钉「数字在窗口里」**：那个窗口是 `overflow: hidden` 的，数字从上面荡进
    // 来、从下面荡出去，越界的那一拍正是设计本身（见 style.css 的 .cd-window 那段注释）。
    nonzero: ['.cd-window', '.cd-digit'],
  },
  {
    name: '游戏页',
    async go(p) {
      await toBoard(p, 0);
    },
    /*
     * 「+N」冒出来的那一刻，分数要让一让。
     *
     * 这颗「+N」是**落在分数那块牌里面**的（`.app--game .gain-badge` 整块铺满、居中），所
     * 以同一个小盒子里两个数会原地叠在一起。让路那一句从前写的是
     * `.hud-block--score:has(.gain-pop) .v { opacity: 0 }`——而 `:has()` 是 Chrome 105 才
     * 有的，**小红书这一端跑在 Chrome 61 上**：整条规则被丢掉，于是那边每得一次分，
     * 「+8」就压在分数上糊成一团。现在改成由塞「+N」的那一头挂一个类
     * （engine/scoreReel.ts 的 syncGainState），新旧内核同一个写法。
     *
     * 这一条必须在**两遍**里都量：降级那一遍才是 Chrome 61 的样子（这台对照台会把
     * `:has()` 的规则整块剥掉，见 stripModernCss）。
     *
     * ⚠️ **「+N」是手摆进去的，不是打出来的。** 这个游戏里得一次分要么拼出图案、要么翻一
     * 枚，而随机拖十下常常一分不得（实测拖 30 下还是 0 分——机器人要用一步贪心才打得出
     * 分，见 bot-selfcheck）。等运气的门就是偶发红，而偶发红最后一定会被人加
     * `continue-on-error`。所以这儿把那两件事分开量：
     *
     *   · **样式**（这一句）：真的往那块牌里塞一个 `.gain-pop`，照 syncGainState 的做法挂
     *     上类，然后量分数那个读数的透明度——那正是 `:has()` 砸掉的那一半。
     *   · **接线**（下一句）：读源码，钉住「每一处塞 `.gain-pop` 的地方旁边都调了
     *     syncGainState」。两处在塞（scoreReel 的 showGain、gameController 的 bumpSteps）。
     *
     * 读完要等一拍：那个读数上有 `transition: opacity 140ms`，马上去问拿到的是 0.05 这种
     * 过渡中的值（第一版就这么红过一次）。
     */
    async probe(p, tag) {
      const r = await p.evaluate(async () => {
        const cell = document.querySelector('.app--game .hud-block--score');
        const badge = cell && cell.querySelector('.gain-badge');
        const v = cell && cell.querySelector('.v');
        if (!cell || !badge || !v) return null;
        const pop = document.createElement('span');
        pop.className = 'gain-pop';
        pop.textContent = '+8';
        badge.appendChild(pop);
        // 和 engine/scoreReel.ts 的 syncGainState 一个字一样：照 DOM 现数。
        cell.classList.toggle('has-gain', Boolean(cell.querySelector('.gain-pop')));
        await new Promise((done) => setTimeout(done, 260));
        const vb = v.getBoundingClientRect();
        const pb = pop.getBoundingClientRect();
        const 叠 = !(pb.right < vb.left || pb.left > vb.right || pb.bottom < vb.top || pb.top > vb.bottom);
        return { 透明度: getComputedStyle(v).opacity, 叠在一起: 叠, 牌: [Math.round(cell.getBoundingClientRect().width), Math.round(cell.getBoundingClientRect().height)] };
      });
      say(Boolean(r), `${tag}：游戏页上找得到分数那块牌和它的 .gain-badge（尺子）`, r ? JSON.stringify(r.牌) : '(找不到)');
      if (!r) return;
      // 量程：这颗「+N」确实落在读数**身上**。哪天它被挪到牌外面去，让路这件事就不必要
      // 了，而这一条会提醒人回来重新想一遍，而不是留着一句没用的规则。
      say(r.叠在一起, `${tag}：「+N」确实压在读数那块地方（所以才要让路）`, String(r.叠在一起));
      say(r.透明度 === '0', `${tag}：「+N」在的时候分数的透明度是 0（不叠在一起）`, r.透明度);
      if (tag !== '正常') return;
      // 接线（只读一遍源码，两遍跑没有区别）
      const { readFileSync } = await import('node:fs');
      const src = (f) => readFileSync(new URL('../src/engine/' + f, import.meta.url), 'utf8');
      const 两处 = [
        ['scoreReel.ts', src('scoreReel.ts')],
        ['gameController.ts', src('gameController.ts')],
      ];
      for (const [name, text] of 两处) {
        const 塞 = (text.match(/className = 'gain-pop'/g) || []).length;
        const 同步 = (text.match(/syncGainState\(/g) || []).length;
        say(塞 > 0, `接线：${name} 里真的有往牌里塞 .gain-pop 的地方（尺子）`, `${塞} 处`);
        say(同步 >= 2, `接线：${name} 里塞和清都调了 syncGainState`, `${同步} 次`);
      }
    },
    // 顶排那几个选择器 2026-09 全换了（《侵蚀阶梯》v1.2 PR-7）：三格 HUD（`.hud-cell`）
    // 变成两块（`.hud-block`），棋盘上方那条图示带（`.pattern-hint` / `.pattern-icon`）
    // 退役、图案挪进右边那一块（`.hud-block--pattern` 里的 `.pat-icon`）。旧选择器一个
    // 都匹配不到，于是这一屏九个受测元素里有三个在**量空气**——而量空气看起来和「两边
    // 完全一致」一模一样。
    sels: [
      '.app--game', '.app--game .hud', '.app--game .hud-block',
      '.app--game .hud-block--score', '.app--game .hud-block--pattern',
      '.app--game .controls', '.app--game .controls .icon-btn',
      '.app--game .pat-icon', '.board-wrap', '.board',
    ],
  },
  {
    name: '暂停面板',
    async go(p) {
      await toBoard(p, 0);
      await p.click('#stopBtn');
      await p.waitForTimeout(900);
    },
    sels: ['#pauseOverlay', '#pauseOverlay .modal', '#pauseOverlay .btn-row', '#pauseOverlay .modal button'],
  },
  {
    name: '结算页',
    async go(p) {
      await toBoard(p, 0);
      await playAndFinish(p);
    },
    // ⚠️ `.end-share` 同理，2026-10-03 才量：横屏那一版把战绩图绝对定位到窗子右半边
    // （`top: 50%` ＋ `translateY(-50%)` ＋ `width: 32vw`），而这一块从前一个选择器都没进
    // 来——图被裁掉半截也没人看得见。
    sels: ['.overlay--end', '.overlay--end .modal', '.end-rule', '.end-breakdown', '.btn-row', '.btn-row button', '.end-share', '.end-share img'],
    nonzero: ['.end-share img'],
    /*
     * 「整块在窗里」只在**横屏**量（第 14 推起）。
     *
     * 这一条是为横屏那一版加的：那儿战绩图是绝对定位到窗子右半边的，参照是 .modal，滚动段
     * 的 overflow 管不到它——出了窗框就是被裁掉，没有别的办法看见。竖屏不一样：图在滚动段
     * 里（gameShell.ts 那段注释：「这一页本来就非滚不可，而该滚的正是『明细 + 图』这一
     * 段」），滚动段里的东西超出窗框是设计本身，滚就看得到。
     *
     * 第 14 推这一端接上了「综合得分怎么算」那一句（头一回的结算页多一行，34px），竖屏上
     * 「图 + 发笔记 / 存相册两颗键」那一整块的下沿于是超出窗框 20px——那两颗键本来就在折叠
     * 线下面要滚才看得到，网页端头一回的结算页也是同样的几何（图的下沿同样在滚动段下面
     * 24px）。所以竖屏改量**图本身**没被窗框裁掉：图要是被顶出了窗框，那才是滚也滚不全。
     */
    inside: [
      ['.end-share', '.overlay--end .modal', 'landscape'],
      ['.end-share img', '.overlay--end .modal', 'portrait'],
    ],
  },
  {
    name: '分享窗口',
    async go(p) {
      await toBoard(p, 0);
      await playAndFinish(p);
      await p.click('#shareBtn');
      await p.waitForTimeout(2000);
    },
    sels: ['.overlay--wide', '.share-modal', '.share-modal img', '.xhs-share-host', '.xhs-share-bar', '.xhs-share-btn'],
  },
  {
    name: '成绩与说明页',
    async go(p) {
      await toBoard(p, 0);
      await playAndFinish(p);
      for (const btn of await p.$$('.endcard button, .modal button')) {
        const t = (await btn.textContent())?.trim() || '';
        if (/菜单|返回|主页/.test(t)) {
          await btn.click();
          break;
        }
      }
      await p.waitForTimeout(1400);
      if (await p.$('#xhsProfile')) await p.click('#xhsProfile');
      await p.waitForTimeout(1000);
    },
    sels: [
      '.xhs-profile', '.total-card', '.xhs-setting-row', '.xhs-cvd',
      '.records-panel--records', '.records-row', '.xhs-about', '.xhs-profile-nav',
    ],
  },
  {
    name: '怎么玩',
    async go(p) {
      if (await p.$('#xhsProfile')) await p.click('#xhsProfile');
      await p.waitForTimeout(900);
      await p.click('.xhs-how');
      await p.waitForTimeout(700);
    },
    sels: ['.howto-modal', '.howto-list', '.howto-ov .tut-rule', '.howto-ov .tut-rule-art', '.howto-ov .btn-row', '#howtoOkBtn'],
  },
  // 「方块分镜动画」那一屏从这张表里撤了（第 14 推）：那两段分镜还在教旧规则，入口
  // 下线了，这一屏已经走不到。《怎么玩》那一屏本身（五条规则 + 配图）照旧在表里。
  {
    name: '战绩详情页',
    async go(p) {
      await toBoard(p, 0);
      await playAndFinish(p);
      for (const btn of await p.$$('.endcard button, .modal button')) {
        const t = (await btn.textContent())?.trim() || '';
        if (/菜单|返回|主页/.test(t)) {
          await btn.click();
          break;
        }
      }
      await p.waitForTimeout(1400);
      if (await p.$('#xhsProfile')) await p.click('#xhsProfile');
      await p.waitForTimeout(900);
      const rows = await p.$$('.records-row');
      if (rows.length) await rows[0].click();
      await p.waitForTimeout(1800);
    },
    sels: ['.xhs-run-sheet', '.xhs-run-body', '.xhs-run-img', '.xhs-share-bar', '.xhs-share-btn', '.page-back-row'],
  },
];

// ---- 跑 ---------------------------------------------------------------------

/**
 * 降级那一遍，把三样**这台浏览器认得、而 Chrome 61 不认**的东西从样式表里真的剥掉。
 *
 * ── 为什么非剥不可 ──────────────────────────────────────────────
 *
 * 这台对照台的办法是「假装所有能力都缺」（`window.__SLIDES_OLD_KERNEL__`），而那个后门
 * 管得住的只有**我们自己写的那条降级路径**：它让 oldKernel.ts 去挂 `no-ratio` / `no-inset`
 * / `no-has` 那几个类、去把算得出来的 clamp/min 换成 px。管不住的是浏览器自己——这台
 * Chromium 照旧认 `aspect-ratio`、`inset`、`:has()`。
 *
 * 于是降级那一遍跑出来的其实是「降级层 ＋ 新内核」：源样式里那几条新写法照样生效，**正好
 * 把降级层漏掉的地方盖住了**。两遍量出来一模一样，门全绿，而真机上是坏的。两件真事就是这
 * 么躲过去的：
 *
 *   · 倒数那个窗口（`.cd-window`）全靠 `aspect-ratio: 4/5` 撑高度，Chrome 61 上高度是 0
 *     ——整个倒数在那一端从来没出现过；
 *   · 游戏页那句「+N 出来的时候分数让一让」写的是 `:has(.gain-pop)`，Chrome 61 上整条丢
 *     掉，于是「+8」原地压在分数上。
 *
 * 剥的办法是直接改那两份内联样式的文本（`#slides-styles` / `#xhs-styles` 就是整个样式
 * 表）：`aspect-ratio` 和 `inset` 的声明整条删掉（连降级层自己写的 `: auto` 一起删——那两
 * 句本来就只在新内核上才有意义），带 `:has(` 的规则整块删掉。
 *
 * ⚠️ 只删 `inset:` 这个**简写**，`inset-inline` 之类不碰（现在一条都没有，但别让这把刀越
 * 切越宽）。
 */
/**
 * 两张表里还有几条 `inset` 声明（注释里抄的不算）。
 *
 * 降级那一遍在剥之前数，数的是降级层留下来的——第 14 推起降级层把每一条都展开成四个方
 * 向，所以应该是 0：剩一条，就是 Chrome 61 上整条丢掉的一条。
 *
 * 出好的包里本来就剩得不多：出包目标是 chrome61，esbuild 已经把 `inset: 0` 那些拆成了四
 * 条边，没拆的只有 `inset: auto`（正常那一遍数出来是 2）。源样式表里有多少条、展开得对不
 * 对，由 scripts/check-downlevel.mjs 第 8 节拿源文件量。
 */
const COUNT_INSET = () => {
  let n = 0;
  for (const id of ['slides-styles', 'xhs-styles']) {
    const el = document.getElementById(id);
    if (!el) continue;
    const css = (el.textContent || '').replace(/\/\*[\s\S]*?\*\//g, ' ');
    n += (css.match(/(^|[;{])\s*inset\s*:/g) || []).length;
  }
  return n;
};

async function stripModernCss(p) {
  const insetLeft = await p.evaluate(COUNT_INSET);
  const got = await p.evaluate(() => {
    const out = { ratio: 0, inset: 0, has: 0 };
    for (const id of ['slides-styles', 'xhs-styles']) {
      const el = document.getElementById(id);
      if (!el) continue;
      let css = el.textContent || '';
      css = css.replace(/(^|[;{\s])aspect-ratio\s*:[^;}]*;?/g, (m, lead) => {
        out.ratio++;
        return lead;
      });
      css = css.replace(/(^|[;{\s])inset\s*:[^;}]*;?/g, (m, lead) => {
        out.inset++;
        return lead;
      });
      // 带 `:has(` 的规则整块删掉。按「选择器 { 声明 }」切——这份样式表里没有嵌套规则，
      // 只有 @media 那一层，而 @media 的头里不会出现 `:has(`。
      css = css.replace(/([^{}]*:has\([^{}]*\{[^{}]*\})/g, (m) => {
        out.has++;
        return '';
      });
      el.textContent = css;
    }
    return out;
  });
  // 量程：三样都要真的剥到了。哪一样数成 0，就说明正则和源样式对不上了（比如有人把
  // `aspect-ratio` 写成了别的形式）——那时候这一遍又变回「降级层 ＋ 新内核」，而门会全绿。
  return { ...got, insetLeft };
}

/**
 * 翻面那一层（`.plank-turn` 和它的两面，engine/plankFlip.ts）塞进一个 50×40 的盒子里量。
 *
 * 它们全靠 `position: absolute; inset: 0` 撑开，而翻面只在得分那一下才出现——这台对照台
 * 拖十下常常一分不得，等运气的门就是偶发红。所以不等它自己出现：照它的类名造一个，量它
 * 铺不铺满。降级那一遍 inset 已经剥掉了，铺得满全靠降级层展开的那四条边。
 */
const PROBE_PLANK = () => {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:7px;top:7px;width:50px;height:40px;pointer-events:none;';
  const turn = document.createElement('div');
  turn.className = 'plank-turn';
  const face = document.createElement('div');
  face.className = 'plank-turn-face';
  turn.appendChild(face);
  box.appendChild(turn);
  document.body.appendChild(box);
  // 尺子：同样摆法、但没有任何规则撑它的一层——量得出塌（0×0），上面那两个数才有意义。
  const bare = document.createElement('div');
  bare.style.position = 'absolute';
  box.appendChild(bare);
  const t = turn.getBoundingClientRect();
  const f = face.getBoundingClientRect();
  const z = bare.getBoundingClientRect();
  box.remove();
  return {
    turn: [Math.round(t.width), Math.round(t.height)],
    face: [Math.round(f.width), Math.round(f.height)],
    bare: [Math.round(z.width), Math.round(z.height)],
  };
};

async function run(browser, view, screen, old) {
  const ctx = await browser.newContext({
    viewport: { width: view.w, height: view.h },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  if (old) await ctx.addInitScript('window.__SLIDES_OLD_KERNEL__ = true;');
  // 两台体检台都先把「教学看过了」这一格填上：第一次进游戏会自动弹那五条
  // 规则（xhs/src/tutorial.ts），弹出来就挡住棋盘，后面的拖动和量尺寸全做
  // 不了。这一屏本身单独测（check-oldcss 的「怎么玩」那一屏，和
  // 教学那支专门的脚本），不靠这里顺带。
  await ctx.addInitScript(`try {
  // 教学那两处都先填上「看过了」，否则体检台点开方块 / 小球会落在分镜动画上，
  // 等不到棋盘。教学本身另有专门的脚本测（check-story）和 check-oldcss 的
  // 「方块分镜动画」那一屏。
  localStorage.setItem('slides.xhs.story.square', '1');
  localStorage.setItem('slides.xhs.story.circle', '1');
} catch (e) {}`);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(PAGE);
  await p.waitForSelector('.home-icon-btn', { timeout: 30000 });
  const insetSrc = old ? null : await p.evaluate(COUNT_INSET);
  const stripped = old ? await stripModernCss(p) : null;
  const plank = await p.evaluate(PROBE_PLANK);
  await p.waitForTimeout(700);
  await screen.go(p);

  const tag = old ? '降级' : '正常';
  /*
   * `nonzero`：这几个盒子**必须真的画出来了**。
   *
   * 为什么不靠上面那套「两遍比几何」：比的是差值，而两遍**都是 0** 的时候差值也是 0
   * ——门全绿，屏幕上那样东西却压根不存在。倒数那个窗口就是这么躲过去的：它从前连
   * `sels` 都不在里头（谁都没量它），而 Chrome 61 上它是个 0×0 的盒子。
   */
  for (const sel of screen.nonzero || []) {
    const r = await p
      .$eval(sel, (el) => {
        const b = el.getBoundingClientRect();
        return { w: Math.round(b.width), h: Math.round(b.height) };
      })
      .catch(() => null);
    say(Boolean(r && r.w > 0 && r.h > 0), `${tag}：${sel} 真的画出来了（宽高都 > 0）`, r ? `${r.w}×${r.h}` : '(这一屏上找不到它)');
  }
  /**
   * `inside`：这个盒子要整个待在那个盒子里面（四边都不许出去）。第三项给了就只在那一种
   * 朝向上量（'portrait' / 'landscape'）。
   */
  for (const [child, parent, only] of screen.inside || []) {
    if (only && only !== (view.w > view.h ? 'landscape' : 'portrait')) continue;
    const r = await p
      .evaluate(([c, pa]) => {
        const ce = document.querySelector(c);
        const pe = document.querySelector(pa);
        if (!ce || !pe) return null;
        const cb = ce.getBoundingClientRect();
        const pb = pe.getBoundingClientRect();
        return {
          上: Math.round(pb.top - cb.top),
          下: Math.round(cb.bottom - pb.bottom),
          左: Math.round(pb.left - cb.left),
          右: Math.round(cb.right - pb.right),
          子: [Math.round(cb.width), Math.round(cb.height)],
        };
      }, [child, parent])
      .catch(() => null);
    const 出去了 = r && Math.max(r.上, r.下, r.左, r.右) > 1;
    say(Boolean(r) && !出去了, `${tag}：${child} 整个在 ${parent} 里面`,
      r ? `出界 上${r.上} 下${r.下} 左${r.左} 右${r.右}（子 ${r.子.join('×')}）` : '(找不到其中一个)');
  }

  /** `probe`：这一屏自己的额外几条（要操作页面才量得到的那种）。两遍各跑一次。 */
  if (screen.probe) await screen.probe(p, tag);

  const boxes = await p.evaluate(MEASURE, screen.sels);

  // 还剩多少没算掉的新写法（只在降级那一遍看）
  let left = [];
  if (old) {
    left = await p.evaluate(() => {
      const text = ['slides-styles', 'xhs-styles']
        .map((id) => (document.getElementById(id) || {}).textContent || '')
        .join('\n');
      const hits = text.match(/[^A-Za-z0-9_-](clamp|min|max)\([^;{}]*/g) || [];
      const uniq = {};
      for (const h of hits) uniq[h.trim().slice(0, 70)] = 1;
      return Object.keys(uniq);
    });
  }

  // 有没有东西横着顶出屏幕
  const spill = await p.evaluate(() => {
    const bad = [];
    const all = document.querySelectorAll('.app *, .modal *');
    for (let i = 0; i < all.length; i++) {
      const cs = getComputedStyle(all[i]);
      if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = all[i].getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.left < -1 || r.right > window.innerWidth + 1) {
        bad.push(
          (all[i].className.toString().split(' ')[0] || all[i].tagName) +
            ` [${Math.round(r.left)},${Math.round(r.right)}]`,
        );
      }
    }
    return bad.slice(0, 4);
  });

  await p.screenshot({
    path: join(here, '..', '.tmp-oldcss', `${view.w}-${screen.name}-${old ? 'old' : 'new'}.png`),
  }).catch(() => {});
  await ctx.close();
  return { boxes, errs, spill, left, stripped, insetSrc, plank };
}

const only = process.argv[2];
const list = only ? SCREENS.filter((s) => s.name.indexOf(only) >= 0) : SCREENS;
if (!list.length) {
  console.log('没有这一屏：' + only);
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const leftovers = {};
for (const view of [
  { name: '竖屏 390×844', w: 390, h: 844 },
  { name: '横屏 844×390', w: 844, h: 390 },
]) {
  console.log('\n########  ' + view.name + '  ########');
  for (const screen of list) {
    console.log('\n---- ' + screen.name + ' ----');
    const fresh = await run(browser, view, screen, false);
    const old = await run(browser, view, screen, true);
    say(old.errs.length === 0, '降级层跑起来零报错', old.errs.slice(0, 2).join(' | '));
    // 量程：那三样真的从样式表里剥掉了（见 stripModernCss）。有一样数成 0，这一遍就又
    // 变回「降级层 ＋ 新内核」——而那时候下面每一条都会全绿，正是最难发现的那种假绿。
    //
    // inset 不在这一条里了：第 14 推起降级层自己把它展开成四个方向，剥的时候已经一条不
    // 剩（剩下的那几个数是注释里的字，不算数）。它改由下面那一条量。
    say(
      old.stripped.ratio > 0 && old.stripped.has > 0,
      '量程：aspect-ratio / :has() 真的剥掉了',
      `ratio ${old.stripped.ratio} · has ${old.stripped.has}`,
    );
    // inset（第 14 推）：降级层一条不留地展开了，翻面那一层在剥掉 inset 之后照样铺满。
    const full = (r) => r.turn[0] === 50 && r.turn[1] === 40 && r.face[0] === 50 && r.face[1] === 40;
    say(old.plank.bare[0] === 0 && old.plank.bare[1] === 0,
      '（尺子）没有规则撑着的一层量出来是 0×0（量得出塌）', JSON.stringify(old.plank.bare));
    say(
      old.stripped.insetLeft === 0 && full(fresh.plank) && full(old.plank),
      'inset 降级层全部展开了，翻面那一层（.plank-turn）照样铺满',
      `包里 ${fresh.insetSrc} 条 → 降级后剩 ${old.stripped.insetLeft} 条 · 翻面层 正常 ${JSON.stringify(fresh.plank)} / 降级 ${JSON.stringify(old.plank)}`,
    );
    compare(screen.name, fresh.boxes, old.boxes, 2);
    const newSpill = fresh.spill.join(' | ');
  say(
    old.spill.length === 0 || newSpill === old.spill.join(' | '),
    '没有东西横着顶出屏幕（降级层造成的）',
    old.spill.length ? `降级 ${old.spill.join(' | ')} ／ 正常 ${newSpill || '(无)'}` : '',
  );
    for (const l of old.left) leftovers[l] = (leftovers[l] || 0) + 1;
  }
}
await browser.close();

const leftList = Object.keys(leftovers);
console.log('\n########  降级之后还没算掉的式子  ########');
if (!leftList.length) console.log('  （没有）');
else {
  console.log('  这些带百分比或 var()，运行时算不出来，在 Chrome 61 上会被整条丢掉。');
  console.log('  用不到的屏可以不管；用得到的必须在 baseline.css 里手写一条等价的。\n');
  leftList.sort().forEach((l) => console.log('    ' + l));
}

console.log(fails ? `\n${fails} 项没过` : '\n全部通过');
process.exit(fails ? 1 : 0);

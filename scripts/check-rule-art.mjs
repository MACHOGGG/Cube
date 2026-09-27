/**
 * 五条规则那五幅配图（ui/ruleArt.ts）：会滑的那一条必须是**整条线**，会变的那两
 * 条必须真的变。
 *
 *   npx esbuild src/ui/ruleArt.ts --bundle --format=esm --outfile=/tmp/ruleart.mjs
 *   node scripts/check-rule-art.mjs /tmp/ruleart.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一台在守什么
 *
 * 这六幅图是玩家学规矩的地方（《怎么玩》那一屏、棋盘底下那块教学条都是它）。
 * 图里画错一笔，教出来的就是错的规矩，而且没有任何报错——它是一段 CSS 动画，
 * 跑得好好的。
 *
 * 真出过的事故：小球那一版第 2、3 条的滑动窗口只盖住两格，可那一行有六颗。
 * 于是一放动画，中间两颗自己滑走、另外四颗一动不动，紧接着四颗打上勾得分。
 * 玩家的原话：「一行里的几颗小球自己滑动了剩下的不滑动就得分了」。棋盘上从
 * 来不是这样——滑的永远是整条线，挤出去的从另一头补回来。方块那一版没踩到：
 * 它的窗口竖着盖两格，而那块小棋盘本来就只有两行，两格正好是整整一列。
 *
 * 所以这一台量的不是「像不像」，是几条能判真假的性质：
 *
 *   ① **一幅图里动过的那些棋子，凑起来必须正好是一整行或一整列。**
 *      少一颗就是上面那场事故，多一颗就是滑错了东西。
 *   ② **第 3 条（得分图案 4 → 3 → 2 → 1）四个取样点上必须正好剩 4 / 3 / 2 / 1 枚。**
 *   ③ **第 4 条（外边消除）和第 5 条（全部消除）末尾必须一枚不剩**，而第 5 条那个
 *      「完成」记号必须等到清空之后才冒出来。
 *
 * ①②③ 之外还有一条不讲道理但必须有的：**每一族正好 2 幅图有滑动**（第 1、2 条）。
 * 没有它，①「这一条没有滑动就不归这一台管」那一行会把「所有图都不动了」也放过去
 * ——那正是 2026-09 改配图时差点发生的事：五幅图整体重排，下标一错，①还是全绿。
 *
 * 时间不靠等：这几幅图是 CSS 动画，用 document.getAnimations() 把时间轴拨到
 * 指定的那一刻再量，所以既快又不会抖。
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ART = process.argv[2];
if (!ART) {
  console.error('用法：node scripts/check-rule-art.mjs <esbuild 打好的 ruleArt.mjs>');
  process.exit(2);
}
const { buildRuleArt } = await import(pathToFileURL(ART).href);
const CSS = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

let fails = 0;
const say = (ok, t, x = '') => { if (!ok) fails++; console.log((ok ? '  PASS  ' : '  FAIL  ') + t + (x ? '  ' + x : '')); };

/** 一个周期里的两个取样点：滑之前、滑完之后翻面之前（ra-hslide 18%→30%，
 *  ra-flip 从 66% 起）。 */
const BEFORE = 0.10;
const AFTER = 0.45;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });

for (const [name, art] of [
  ['方块', buildRuleArt()],
  ['小球', buildRuleArt({ shape: 'circle' })],
]) {
  await page.setContent(
    `<style>${CSS}</style><body style="background:#F6F1E7">` +
      art.map((a, i) => `<div class="tut-rule-art" data-i="${i}" style="font-size:34px;margin:24px">${a}</div>`).join('') +
      '</body>',
  );
  await page.waitForTimeout(200);

  /** 把所有 CSS 动画的时间轴拨到周期的 p 处，再量每一枚棋子在哪。 */
  const sample = (p) =>
    page.evaluate((frac) => {
      for (const a of document.getAnimations()) {
        const dur = a.effect?.getComputedTiming?.().duration;
        if (typeof dur === 'number' && dur > 0) {
          a.pause();
          a.currentTime = dur * frac;
        }
      }
      return Array.from(document.querySelectorAll('.tut-rule-art')).map((wrap) => {
        const board = wrap.querySelector('.ra-board');
        if (!board) return { pitch: 0, pieces: [] };
        const bb = board.getBoundingClientRect();
        // 一格有多宽：网格列宽 1em + 缝隙。
        const cs = getComputedStyle(board);
        const em = parseFloat(cs.fontSize);
        const gap = parseFloat(cs.columnGap) || 0;
        const pitch = em + gap;
        return {
          pitch,
          pieces: Array.from(wrap.querySelectorAll('.ra-tile')).map((el) => {
            const r = el.getBoundingClientRect();
            // 「这一刻看得见吗」：会滑的那一条比窗口多一枚（绕回来的那一
            // 枚），这会儿正被窗口的 overflow 裁在外头。算进去就把「一整行
            // 有几颗」数多了，于是这一台会拿一个虚高的总数去比。所以每一枚
            // 都对着**它自己那一层**量：在窗口里的对窗口，其余的对板子。
            const win = el.closest('.ra-hwin, .ra-win');
            const cb = win ? win.getBoundingClientRect() : bb;
            return {
              x: r.left + r.width / 2,
              y: r.top + r.height / 2,
              inside:
                r.left >= cb.left - 1 && r.right <= cb.right + 1 &&
                r.top >= cb.top - 1 && r.bottom <= cb.bottom + 1,
              blank: el.classList.contains('ra-blank'),
            };
          }),
        };
      });
    }, p);

  const a = await sample(BEFORE);
  const b = await sample(AFTER);

  // ── ②③ 会变的那几条：把整个周期扫一遍，看「还剩几枚」怎么走。 ─────────
  //
  // 为什么是扫一遍、而不是在三四个时刻各量一次：淡出是有过程的，`ease-in` 又
  // 把它压得很不均匀。头一版这一台就是在 10/40/65/92 四个点上数「不透明度 > 0.5
  // 的有几枚」——把 ra-lad2 的起点从 48% 挪到 22%（也就是让第 3 级根本不存在）之
  // 后，40% 那一刻它算出来是 0.615，照样 > 0.5，四个点量到的还是 4/3/2/1，**门是
  // 绿的**。一条量不出破绽的门比没有门更糟：它会让人以为这件事有人守着。
  //
  // 现在数的是「彻底在场」（不透明度 ≥ 0.99），而且要求每一级**稳稳停住一段**。
  // 淡出中途那几帧两头都不算，于是「第 3 级压根没停过」这种事就露出来了。
  const STEP = 0.01;
  const LAST = 0.93; // 94% 起整幅图自己淡出（ra-cycle），扫到这儿为止
  const curves = await page.evaluate(({ step, last }) => {
    const wraps = Array.from(document.querySelectorAll('.tut-rule-art'));
    const eff = (el, root) => {
      let o = 1;
      for (let n = el; n && n !== root.parentElement; n = n.parentElement) {
        const v = parseFloat(getComputedStyle(n).opacity);
        if (!Number.isNaN(v)) o *= v;
      }
      return o;
    };
    const out = wraps.map(() => ({ live: [], end: [] }));
    for (let f = 0; f <= last + 1e-9; f += step) {
      for (const a of document.getAnimations()) {
        const d = a.effect?.getComputedTiming?.().duration;
        if (typeof d === 'number' && d > 0) { a.pause(); a.currentTime = d * f; }
      }
      wraps.forEach((wrap, i) => {
        const tiles = Array.from(wrap.querySelectorAll('.ra-tile'))
          .filter((el) => !el.classList.contains('ra-blank') && eff(el, wrap) >= 0.99);
        out[i].live.push(tiles.length);
        const end = wrap.querySelector('.ra-end');
        out[i].end.push(end ? end.getBoundingClientRect().width : 0);
      });
    }
    return out;
  }, { step: STEP, last: LAST });

  /** 一条曲线上「稳稳停住」的那些台阶：[值, 停了几帧]，按先后排。 */
  const plateaus = (xs, minRun) => {
    const runs = [];
    for (const v of xs) {
      if (runs.length && runs[runs.length - 1][0] === v) runs[runs.length - 1][1]++;
      else runs.push([v, 1]);
    }
    return runs.filter(([, n]) => n >= minRun);
  };

  const LADDER = 2, CLEAR = 3, SWEEP = 4;
  // 每一级至少停 10 帧 = 周期的 10%。四级（22/20/20/12 帧）都够得到，而「某一级
  // 没停过」一定够不到。
  const lad = plateaus(curves[LADDER].live, 10).map(([v]) => v);
  say(
    lad.join(',') === '4,3,2,1',
    `${name} 第 3 条：得分图案 4 → 3 → 2 → 1，每一级都停得住`,
    `量到 ${lad.join(' → ') || '(一级都没停住)'}`,
  );

  const clr = curves[CLEAR].live;
  say(
    clr[0] > clr[clr.length - 1] && clr[clr.length - 1] > 0,
    `${name} 第 4 条：外边那一条消掉了，别的还在`,
    `${clr[0]} → ${clr[clr.length - 1]} 枚`,
  );

  const sw = curves[SWEEP].live;
  const steps = new Set(sw).size;
  say(sw[0] >= 8 && sw[sw.length - 1] === 0, `${name} 第 5 条：一枚不剩`, `${sw[0]} → ${sw[sw.length - 1]} 枚`);
  say(
    sw.every((v, k) => k === 0 || v <= sw[k - 1]),
    `${name} 第 5 条：只减不增（没有消掉又冒回来的）`,
  );
  // 「一枚接一枚」不是「一起没」：整条曲线要踩过至少 7 个不同的数。把那八条
  // `.ra-wN { animation-name }` 删掉，八枚就会一起回落到 .ra-gone 自带的 ra-clear，
  // 曲线只剩 8 和 0 两个数——上一版量不出这件事。
  say(steps >= 7, `${name} 第 5 条：一枚接一枚，不是一起没`, `曲线踩过 ${steps} 个不同的数`);
  // 「完成」不能提前冒出来：棋盘还没空的时候它得是 0 宽（scale(0)）。
  const endAt = (f) => curves[SWEEP].end[Math.round(f / STEP)];
  say(
    endAt(0.4) < 1 && endAt(0.92) > 1,
    `${name} 第 5 条：「完成」等清空了才出来`,
    `40% 时宽 ${endAt(0.4).toFixed(1)}px，92% 时宽 ${endAt(0.92).toFixed(1)}px`,
  );

  // ── ① 滑的那一条必须是整条线 ───────────────────────────────────────
  let slid = 0;
  art.forEach((_, i) => {
    const A = a[i];
    const B = b[i];
    if (!A || !A.pieces.length) return;
    const pitch = A.pitch;
    // 滑之前看得见、又不是占位的那些棋子，按行分桶。
    const live = A.pieces.map((p, k) => ({ ...p, k })).filter((p) => p.inside && !p.blank);
    const rowOf = (p) => Math.round((p.y - live[0].y) / pitch);
    const colOf = (p) => Math.round((p.x - live[0].x) / pitch);
    const moved = live.filter((p) => {
      const q = B.pieces[p.k];
      return q && Math.hypot(q.x - p.x, q.y - p.y) > pitch * 0.4;
    });
    const label = `${name} 第 ${i + 1} 条`;
    if (!moved.length) return; // 这一条没有滑动，不归这一条量
    slid++;

    const rows = new Set(moved.map(rowOf));
    const cols = new Set(moved.map(colOf));
    if (rows.size === 1) {
      const r = [...rows][0];
      const whole = live.filter((p) => rowOf(p) === r);
      say(
        moved.length === whole.length,
        `${label}：滑的是整整一行`,
        `这一行 ${whole.length} 颗，动了 ${moved.length} 颗`,
      );
    } else if (cols.size === 1) {
      const c = [...cols][0];
      const whole = live.filter((p) => colOf(p) === c);
      say(
        moved.length === whole.length,
        `${label}：滑的是整整一列`,
        `这一列 ${whole.length} 枚，动了 ${moved.length} 枚`,
      );
    } else {
      say(false, `${label}：动过的棋子既不在同一行也不在同一列`, `行 ${[...rows]} 列 ${[...cols]}`);
    }
  });
  // 没有这一条，上面那句 `if (!moved.length) return` 会把「一幅都不滑了」当成
  // 全绿。会滑的正好是第 1、2 条（拼出图案、星星再拼一次）。
  say(slid === 2, `${name}：正好 2 幅图有滑动（不然上面那几条是空的）`, `量到 ${slid} 幅`);
}

await browser.close();
console.log(fails ? `\n${fails} 项没过` : '\n全部通过');
process.exit(fails ? 1 : 0);

/**
 * 六条规则那六幅配图（ui/ruleArt.ts）：会滑的那一条，必须是**整条线**。
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
 * 所以这一台量的不是「像不像」，是一条能判真假的性质：
 *
 *   **一幅图里动过的那些棋子，凑起来必须正好是一整行或一整列。**
 *
 * 少一颗就是上面那场事故，多一颗就是滑错了东西。两套画法（方块 / 小球）、
 * 六条规则，一条条量过去。
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
  ['小球', buildRuleArt({ triangle: false, shape: 'circle' })],
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
        // 第 6 条是几个符号，没有小棋盘——这一台管不着它。
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
          pieces: Array.from(wrap.querySelectorAll('.ra-tile, .ra-cell')).map((el) => {
            // .ra-cell 里头还套着一枚 .ra-tile，只算外面那一层。
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

  art.forEach((_, i) => {
    const A = a[i];
    const B = b[i];
    if (!A || !A.pieces.length) return; // 第 6 条是几个符号，没有棋盘
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
    if (!moved.length) return; // 这一条没有滑动，不归这一台管

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
}

await browser.close();
console.log(fails ? `\n${fails} 项没过` : '\n全部通过');
process.exit(fails ? 1 : 0);

/**
 * 微信小游戏原型：规则和网页版一致，浏览器里能画、能拖。
 *
 *   npm run build:wxgame
 *   node scripts/check-wxgame.mjs
 *
 * 前一半不起浏览器：把 wxgame/src/squareBoard.ts 打成 ESM 直接问它——发牌
 * 合不合规矩、滑动是不是循环的、四连得分翻面、整行同色反面消掉。后一半用
 * Chromium 跑同一份 game.js（platform.ts 在浏览器里给它一块画布），真拖一
 * 下、看棋盘真的转了一格，再截一张图。
 */
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// ---- 规则 ---------------------------------------------------------------------
const tmp = mkdtempSync(join(tmpdir(), 'wxgame-'));
const modelPath = join(tmp, 'squareBoard.mjs');
await build({ entryPoints: ['wxgame/src/squareBoard.ts'], bundle: true, format: 'esm', outfile: modelPath, logLevel: 'silent' });
const { createSquareBoard, BOARD_DIM } = await import(modelPath);
const labels = { block22: '2×2', run4: '1×4', line: '整线', pattern: '图案' };

{
  const b = createSquareBoard(labels);
  b.deal();
  const tiles = [];
  for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.cols; c++) tiles.push(b.tileAt(r, c));
  check('发牌：6×6 共 36 枚', b.rows === BOARD_DIM && b.cols === BOARD_DIM && tiles.length === 36);
  const perColor = new Map();
  for (const t of tiles) perColor.set(t.color, (perColor.get(t.color) ?? 0) + 1);
  check('发牌：六色各六枚', perColor.size === 6 && [...perColor.values()].every((n) => n === 6));
  let dotRuleOk = true;
  for (let color = 0; color < 6; color++) {
    const dots = tiles.filter((t) => t.color === color).map((t) => t.dotColor).sort();
    // 五枚各拿其余五色（互不重复）+ 一枚自配：排好序正好是 0..5 每个一次。
    if (dots.join() !== [0, 1, 2, 3, 4, 5].join()) dotRuleOk = false;
  }
  check('发牌：每色六枚的反面 = 其余五色各一 + 一枚自配', dotRuleOk);
  let clump = false;
  const col = (r, c) => b.tileAt(r, c).color;
  for (let r = 0; r < 6; r++)
    for (let c = 0; c < 6; c++) {
      if (c <= 3 && col(r, c) === col(r, c + 1) && col(r, c) === col(r, c + 2)) clump = true;
      if (r <= 3 && col(r, c) === col(r + 1, c) && col(r, c) === col(r + 2, c)) clump = true;
      if (r <= 4 && c <= 4 && col(r, c) === col(r, c + 1) && col(r, c) === col(r + 1, c) && col(r, c) === col(r + 1, c + 1)) clump = true;
    }
  check('发牌：开局没有现成的三连 / 2×2', !clump);
  check('开局不算结束', !b.isGameOver());
  check('开局不是死局', b.stuckGroups().length === 0);

  const before = Array.from({ length: 6 }, (_, c) => b.tileAt(0, c).id);
  const mask = b.shift('row', 0, 1);
  const after = Array.from({ length: 6 }, (_, c) => b.tileAt(0, c).id);
  check('整行向右滑一格：最右那枚绕到最左', after.join() === [before[5], ...before.slice(0, 5)].join(), `${before} → ${after}`);
  check('滑动返回这一线的六格', mask.size === 6 && mask.has('0,0') && mask.has('0,5'));
  b.shift('row', 0, -1);
  check('再向左滑一格：回到原样', Array.from({ length: 6 }, (_, c) => b.tileAt(0, c).id).join() === before.join());
  const colBefore = Array.from({ length: 6 }, (_, r) => b.tileAt(r, 2).id);
  b.shift('col', 2, 2);
  const colAfter = Array.from({ length: 6 }, (_, r) => b.tileAt(r, 2).id);
  check('整列向下滑两格：底下两枚绕到顶上', colAfter.join() === [colBefore[4], colBefore[5], ...colBefore.slice(0, 4)].join());
}

{
  // 摆一个 1×4：第 0 行前四枚正面同色。
  const b = createSquareBoard(labels);
  b.deal();
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) b.tileAt(r, c).color = (r + c) % 6; // 先打散：横竖都不连（(r*6+c)%6 会让整列同色）
  for (let c = 0; c < 4; c++) b.tileAt(0, c).color = 3;
  b.tileAt(0, 4).color = 1;
  const mask = new Set(['0,0', '0,1', '0,2', '0,3', '0,4', '0,5']);
  const stepper = b.cascade(mask);
  const s1 = stepper.next();
  check('四枚同色正面连成一行：一拍 4 分、一组', s1 && s1.points === 4 && s1.matchGroups.length === 1 && s1.lineBonusGroups.length === 0, JSON.stringify(s1 && { points: s1.points, groups: s1.matchGroups.length }));
  s1.commit();
  check('提交之后那四枚翻到反面', [0, 1, 2, 3].every((c) => b.tileAt(0, c).face === 'dot'));
  check('第五枚没翻', b.tileAt(0, 4).face === 'flavor');
}

{
  // 整行全是同色反面：这一行消掉，棋盘剩五行。
  const b = createSquareBoard(labels);
  b.deal();
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) b.tileAt(r, c).color = (r + c) % 6;
  for (let c = 0; c < 6; c++) {
    const t = b.tileAt(2, c);
    t.face = 'dot';
    t.dotColor = 4;
  }
  const stepper = b.cascade(new Set(['2,0']));
  const s1 = stepper.next();
  check('整行同色反面：一拍整线奖励 36 分', s1 && s1.lineBonusGroups.length === 1 && s1.points === 36, JSON.stringify(s1 && { points: s1.points, lines: s1.lineBonusGroups.length }));
  check('那一行拿掉了，剩五行', b.rows === 5 && b.cols === 6);
  check('死局门槛跟着变短的边长走：五行 × 六列还活着', b.stuckGroups().length === 0);
}

{
  // 全翻完即结束。
  const b = createSquareBoard(labels);
  b.deal();
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) b.tileAt(r, c).face = 'dot';
  check('全部翻到反面：结束', b.isGameOver());
}

// ---- 小球那副棋盘（28 颗堆成的三角）------------------------------------------
const circlePath = join(tmp, 'circleBoard.mjs');
await build({ entryPoints: ['wxgame/src/circleBoard.ts'], bundle: true, format: 'esm', outfile: circlePath, logLevel: 'silent' });
const { createCircleBoard, CIRCLE_ROWS, CIRCLE_PALETTE } = await import(circlePath);
const clabels = { ...labels, diamond121: '1-2-1' };
{
  const b = createCircleBoard(clabels);
  b.deal();
  let n = 0;
  const perColor = new Map();
  for (let r = 0; r < b.rows; r++)
    for (let c = 0; c < b.cellsInRow(r); c++) {
      const t = b.tileAt(r, c);
      n++;
      perColor.set(t.color, (perColor.get(t.color) ?? 0) + 1);
    }
  check('小球：7 排共 28 颗，第 r 排 r+1 颗', b.rows === CIRCLE_ROWS && n === 28 && b.cellsInRow(0) === 1 && b.cellsInRow(6) === 7, String(n));
  check('小球：四色各七颗', perColor.size === 4 && [...perColor.values()].every((x) => x === 7), JSON.stringify([...perColor]));
  check('小球：配色是四种', CIRCLE_PALETTE.length === 4);
  // 反面颜色：同一正面色的七颗里，其余三色各两颗 + 自己一颗。
  let dotsOk = true;
  for (let color = 0; color < 4; color++) {
    const dots = [];
    for (let r = 0; r < b.rows; r++)
      for (let c = 0; c < b.cellsInRow(r); c++) if (b.tileAt(r, c).color === color) dots.push(b.tileAt(r, c).dotColor);
    const tally = new Map();
    for (const d of dots) tally.set(d, (tally.get(d) ?? 0) + 1);
    if (dots.length !== 7 || tally.get(color) !== 1) dotsOk = false;
    for (let k = 0; k < 4; k++) if (k !== color && tally.get(k) !== 2) dotsOk = false;
  }
  check('小球：反面色按「其余三色各两颗 + 自己一颗」发', dotsOk);
}
{
  // 三个滑动方向：横排、左斜（c 固定）、右斜（r-c 固定）。中间那一颗应该三条线都穿过。
  const b = createCircleBoard(clabels);
  b.deal();
  const lines = b.linesThrough(4, 2);
  check('小球：一颗上穿过三条线（一横两斜）', lines.length === 3, lines.map((l) => l.id).join(','));
  // 最长那一排（第 7 排 7 颗）循环滑一格，真的转了一格。
  const before = Array.from({ length: 7 }, (_, c) => b.tileAt(6, c).id);
  b.shiftLine('R6', 1);
  const after = Array.from({ length: 7 }, (_, c) => b.tileAt(6, c).id);
  check('小球：整排循环滑一格', after.join() === [before[6], ...before.slice(0, 6)].join(), `${before} → ${after}`);
}
{
  // 摆一条四连出来：第 7 排前四颗同色，滑动的 mask 覆盖到它，应该算一次 1×4。
  const b = createCircleBoard(clabels);
  b.deal();
  for (let c = 0; c < 4; c++) {
    b.tileAt(6, c).color = 0;
    b.tileAt(6, c).face = 'flavor';
  }
  const mask = new Set(['6,0', '6,1', '6,2', '6,3']);
  const step = b.cascade(mask).next();
  check('小球：一条四连算一次得分', Boolean(step) && step.points >= 4, step ? `${step.points} 分 · ${step.matchGroups.length} 组` : '没算出来');
}
{
  // 整线奖励：最短的整线是 3 颗（第 3 排）。全翻到反面、反面同色，才算。
  const b = createCircleBoard(clabels);
  b.deal();
  const line = [[2, 0], [2, 1], [2, 2]];
  for (const [r, c] of line) {
    const t = b.tileAt(r, c);
    t.face = 'dot';
    t.dotColor = 1;
  }
  // 先把别处可能凑巧成立的整线排除掉：只看这三颗有没有变空。
  let sawBonus = false;
  const stepper = b.cascade(new Set(line.map(([r, c]) => `${r},${c}`)));
  for (let i = 0; i < 8; i++) {
    const s = stepper.next();
    if (!s) break;
    if (s.lineBonusGroups.length) sawBonus = true;
    s.commit();
  }
  check('小球：三颗的整线（全反面同色）给整线奖励', sawBonus);
  check('小球：拿过奖励的那几颗变成空球留在原地，棋盘形状不变',
    line.every(([r, c]) => b.isBlankAt(r, c)) && b.rows === CIRCLE_ROWS && b.cellsInRow(6) === 7);
}
{
  // 全翻到反面就结束。
  const b = createCircleBoard(clabels);
  b.deal();
  for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.cellsInRow(r); c++) b.tileAt(r, c).face = 'dot';
  check('小球：全部翻到反面即结束', b.isGameOver());
}

// ---- 浏览器里跑同一份 game.js ------------------------------------------------
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body></body></html>');
await page.addScriptTag({ path: resolve('wxgame/game.js') });
await page.waitForTimeout(400);
check('game.js 在浏览器里跑起来没有报错', errors.length === 0, errors.join(' | ').slice(0, 200));
check('画布铺满一屏', await page.evaluate(() => {
  const c = document.querySelector('#wxgame');
  return Boolean(c) && c.getBoundingClientRect().width === innerWidth && c.getBoundingClientRect().height === innerHeight;
}));

// ---- 主菜单 → 倒数 → 玩 -------------------------------------------------------
check('开门见山是主菜单，不是直接开局',
  (await page.evaluate(() => globalThis.__slidesWx.screen)) === 'menu');
const cards = await page.evaluate(() => globalThis.__slidesWx.menuHits.map((h) => ({ id: h.id, rect: h.rect })));
check('菜单上摆着做好了的玩法，每张都有自己的方框',
  cards.length === (await page.evaluate(() => globalThis.__slidesWx.games.length)) &&
    cards.every((c) => c.rect[2] > 40 && c.rect[3] > 40),
  JSON.stringify(cards));
{
  // 卡片横向居中：左边到屏幕的距离和右边一样。
  const first = cards[0].rect;
  const last = cards[cards.length - 1].rect;
  const leftGap = first[0];
  const rightGap = 390 - (last[0] + last[2]);
  check('菜单卡片整体居中', Math.abs(leftGap - rightGap) <= 1, `${leftGap} / ${rightGap}`);
}
// 按一张卡片：进倒数，不是直接进棋盘。
await page.mouse.click(cards[0].rect[0] + cards[0].rect[2] / 2, cards[0].rect[1] + cards[0].rect[3] / 2);
await page.waitForTimeout(200);
check('按下一张卡片，先数 4-3-2-1', (await page.evaluate(() => globalThis.__slidesWx.screen)) === 'count');
// 数完自己开局（4 秒）。
await page.waitForTimeout(4200);
check('数完自动开局', (await page.evaluate(() => globalThis.__slidesWx.screen)) === 'play');

const state0 = await page.evaluate(() => {
  const g = globalThis.__slidesWx;
  const L = g.layout();
  const ids = Array.from({ length: g.board.cols }, (_, c) => g.board.tileAt(2, c).id);
  return { L, ids, rows: g.board.rows, cols: g.board.cols };
});
check('棋盘 6×6 摆好了', state0.rows === 6 && state0.cols === 6);
check('画布不是空白（版图画上去了）', await page.evaluate(() => {
  const c = document.querySelector('#wxgame');
  const g = c.getContext('2d');
  const d = g.getImageData(c.width / 2, c.height / 2, 1, 1).data;
  return !(d[0] === 250 && d[1] === 246 && d[2] === 236);
}));
// 真拖：第 2 行，向右一格。
const cx = state0.L.x + state0.L.cell * 1.5;
const cy = state0.L.y + state0.L.cell * 2.5;
await page.mouse.move(cx, cy);
await page.mouse.down();
for (let i = 1; i <= 8; i++) {
  await page.mouse.move(cx + (state0.L.cell * i) / 8, cy);
  await page.waitForTimeout(16);
}
await page.mouse.up();
await page.waitForTimeout(150);
const ids1 = await page.evaluate(() => {
  const g = globalThis.__slidesWx;
  return Array.from({ length: g.board.cols }, (_, c) => g.board.tileAt(2, c).id);
});
check('手指把第 2 行向右拖一格，棋盘真的转了一格', ids1.join() === [state0.ids[5], ...state0.ids.slice(0, 5)].join(), `${state0.ids} → ${ids1}`);
await page.waitForTimeout(1600);
const shot = process.argv[2] || join(tmp, 'wxgame.png');
await page.screenshot({ path: shot });
console.log('截图：' + shot);
// 回主菜单这条退路。
await page.evaluate(() => globalThis.__slidesWx.goHome());
await page.waitForTimeout(200);
check('回得了主菜单', (await page.evaluate(() => globalThis.__slidesWx.screen)) === 'menu');
const menuShot = shot.replace(/\.png$/, '-menu.png');
await page.screenshot({ path: menuShot });
console.log('主菜单截图：' + menuShot);
await browser.close();

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);

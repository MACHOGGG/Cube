/**
 * 炸弹玩法这一套新规则的门。
 *
 *   npx esbuild src/engine/bomb.ts --bundle --format=esm --outfile=/tmp/bomb.mjs
 *   npx esbuild src/engine/scoring.ts --bundle --format=esm --outfile=/tmp/scoring.mjs
 *   node scripts/check-bomb-rules.mjs /tmp/bomb.mjs /tmp/scoring.mjs
 *
 * 2026-09 炸弹从「每一枚红块都是永不翻面的障碍」改成「挨着得分图案就被连带拆
 * 成星星，整局只留一枚永久炸弹」。这一改牵着五个地方一起动，每一个单独错了都
 * 不会崩，只会让玩家莫名其妙输掉一局或者少拿一次分：
 *
 *   ① 发牌时炸弹的反面要配平（一枚红 + 其余按基础色摊开），不是每枚独立抽；
 *   ② 四连爆炸挪到一步的连锁全部走完之后，只查一次；
 *   ③ 判四连、数活棋子、闪三连预警都只认**活**炸弹（露在外面那一面是红）；
 *   ④ 被拆掉的格子要并进下一拍的连锁遮罩，不然图案拼好了却不给分；
 *   ⑤ 存档键和排行榜换新版本，六枚炸弹的老局不和一枚炸弹的新局混在一起比；
 *   ⑥ **两下才拆**：第一下只留裂纹。数出来这是三档里最均衡的——方块上不谨慎
 *      的玩家炸死率 66% → 16%（不归零），谨慎的仍零死亡，炸弹存在率八成，分
 *      数 126 最接近基础方块的 139。差一下就是另一个游戏，所以它有自己的门。
 *
 * ①③④ 能直接喂函数验（下面第 1–3 段），②⑤ 落在六副棋盘和两个引擎文件的接线
 * 上，只能对着源码验这几处接对了没有（第 4 段）——接线断了不会崩，只会静悄悄
 * 回到老行为。真的在浏览器里打一局炸弹是 check-board-fit / check-start-page
 * 那几道门的事，它们要开 Chromium，本地手跑。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const bombSrc = process.argv[2];
const scoringSrc = process.argv[3];
if (!bombSrc || !scoringSrc) {
  console.error('用法: node scripts/check-bomb-rules.mjs <打包好的 bomb.mjs> <打包好的 scoring.mjs>');
  process.exit(2);
}
const { dealBombBacks, isLiveBomb, hitBomb, isCrackedBomb, BOMB_HITS_TO_DEFUSE, BOMB_RULES_VERSION } =
  await import(bombSrc);
const { createCascadeStepper } = await import(scoringSrc);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/** 带种子的洗牌，和棋盘里那个同一个契约：原地洗，返回同一个数组。 */
function seededShuffle(seed) {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  return (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
}

const tally = (arr) => {
  const m = new Map();
  for (const v of arr) m.set(v, (m.get(v) || 0) + 1);
  return m;
};

// ---------------------------------------------------------------------------
// 1. 发牌：一枚永久炸弹 + 其余按基础色配平
// ---------------------------------------------------------------------------
{
  const RED = 0;
  // 六副棋盘各自的枚数与基础色数（方块/菱形 6 枚 5 色、小球 7 枚 3 色、
  // 六边小球 6 枚 5 色、三角 9 枚 5 色、大三角 5 枚 4 色）。
  const BOARDS = [
    { name: '方块 / 菱形方块 / 六边小球', count: 6, colors: 5 },
    { name: '小球', count: 7, colors: 3 },
    { name: '三角', count: 9, colors: 5 },
    { name: '大三角', count: 5, colors: 4 },
  ];

  for (const b of BOARDS) {
    const pool = Array.from({ length: b.colors }, (_, i) => i + 1); // 1..colors，红是 0
    let worstSpread = 0;
    let redCounts = new Set();
    let missingColorRuns = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const backs = dealBombBacks(b.count, pool, RED, seededShuffle(seed));
      if (backs.length !== b.count) {
        check(`${b.name}：发出来的枚数对得上`, false, `${backs.length} ≠ ${b.count}`);
        break;
      }
      const t = tally(backs);
      redCounts.add(t.get(RED) || 0);
      const normals = backs.filter((c) => c !== RED);
      const nt = tally(normals);
      // 摊到每种基础色上，最多的和最少的差几枚。配平法里这个数只能是 0 或 1。
      const counts = pool.map((c) => nt.get(c) || 0);
      worstSpread = Math.max(worstSpread, Math.max(...counts) - Math.min(...counts));
      if (normals.length >= pool.length && counts.some((n) => n === 0)) missingColorRuns++;
    }
    check(`${b.name}：每一副牌都正好一枚永久炸弹`,
      redCounts.size === 1 && redCounts.has(1), JSON.stringify([...redCounts]));
    check(`${b.name}：其余按基础色摊开，任意两色最多差 1 枚`,
      worstSpread <= 1, `最大差 ${worstSpread}`);
    check(`${b.name}：够摊的时候没有哪一色缺席`, missingColorRuns === 0, `${missingColorRuns} 副缺色`);
  }

  // 同一个种子两次发出来必须一模一样——种子码、加入指定小屋、分享卡回放、以及
  // 门自己的确定性都建立在「给定种子整局可复现」上。
  const a = dealBombBacks(6, [1, 2, 3, 4, 5], 0, seededShuffle(7));
  const b2 = dealBombBacks(6, [1, 2, 3, 4, 5], 0, seededShuffle(7));
  check('同一个种子发两次，结果相同', JSON.stringify(a) === JSON.stringify(b2), JSON.stringify(a));

  // 永久炸弹落在第几枚上也要跟着种子走，不能永远是牌堆里第一颗（那样玩家一眼
  // 就知道哪一枚拆不掉）。
  const spots = new Set();
  for (let seed = 1; seed <= 200; seed++) spots.add(dealBombBacks(6, [1, 2, 3, 4, 5], 0, seededShuffle(seed)).indexOf(0));
  check('永久炸弹的位置也洗过（不是永远第一枚）', spots.size > 1, `落过 ${spots.size} 个位置`);

  check('没有炸弹的时候发空牌', dealBombBacks(0, [1, 2, 3], 0, seededShuffle(1)).length === 0);
}

// ---------------------------------------------------------------------------
// 2. 认活炸弹认的是「露在外面那一面」
// ---------------------------------------------------------------------------
{
  const RED = 0;
  const t = (color, face, dotColor) => ({ color, face, dotColor });
  check('正面朝上的红块是活炸弹', isLiveBomb(t(RED, 'flavor', 3), RED) === true);
  check('拆成基础色星星的不再是炸弹', isLiveBomb(t(RED, 'dot', 3), RED) === false);
  check('反面也是红的那一枚（永久炸弹）仍然算', isLiveBomb(t(RED, 'dot', RED), RED) === true);
  check('普通正面色块不是炸弹', isLiveBomb(t(2, 'flavor', 3), RED) === false);
  check('普通星星不是炸弹', isLiveBomb(t(2, 'dot', 3), RED) === false);
}

// ---------------------------------------------------------------------------
// 2b. 两下才拆，第一下只裂
// ---------------------------------------------------------------------------
{
  check('规则就是两下', BOMB_HITS_TO_DEFUSE === 2, String(BOMB_HITS_TO_DEFUSE));

  const bomb = {};
  check('没挨过打的炸弹身上不画裂纹', isCrackedBomb(bomb) === false);
  check('第一下不拆', hitBomb(bomb) === false);
  check('第一下之后要画裂纹', isCrackedBomb(bomb) === true, JSON.stringify(bomb));
  check('第二下才拆', hitBomb(bomb) === true, JSON.stringify(bomb));
  check('拆掉之后不再画裂纹（它已经是星星了）', isCrackedBomb(bomb) === false);

  // 老档 / 刚发出来的牌没有这一项，读出来是 undefined——当 0 用，不能当 NaN。
  check('bombHits 缺省当 0 用', hitBomb({ bombHits: undefined }) === false);
  // 万一同一枚被多打了一下（不该发生，但别让它把状态搅坏）。
  const over = { bombHits: 5 };
  check('已经拆过的再打一下仍然是「拆了」', hitBomb(over) === true);
  check('打过头也不会又变回裂纹', isCrackedBomb(over) === false);
}

// ---------------------------------------------------------------------------
// 3. 拆掉的格子并进下一拍的遮罩
// ---------------------------------------------------------------------------
{
  // 一块只有两组棋子的假棋盘：
  //   · 0,0–0,3 是这一拍得分的那一组；
  //   · 9,0–9,3 是「拆弹之后才成形」的那一组——它一格都不在初始遮罩里，
  //     只有 afterCommit 把 9,0 并进去，下一拍才找得到它。
  const key = (r, c) => `${r},${c}`;
  const first = [[0, 0], [0, 1], [0, 2], [0, 3]];
  const second = [[9, 0], [9, 1], [9, 2], [9, 3]];
  const faces = new Map();
  for (const [r, c] of [...first, ...second]) faces.set(key(r, c), 'flavor');

  const mkConfig = (withAfterCommit) => ({
    tileAt: (r, c) => {
      const k = key(r, c);
      if (!faces.has(k)) faces.set(k, 'dot');
      return { id: k, get face() { return faces.get(k); }, set face(v) { faces.set(k, v); } };
    },
    findLineBonuses: () => [],
    onLineBonus() {},
    resetMaskOnLineBonus: false,
    findMatches: (mask) =>
      [first, second]
        .filter((cells) => !mask || cells.some(([r, c]) => mask.has(key(r, c))))
        .filter((cells) => cells.some(([r, c]) => faces.get(key(r, c)) === 'flavor'))
        .map((cells) => ({ cells, points: 4 })),
    // 得分的是第一组，棋盘顺手把 9,0 那一格也动了（现实里就是那一格的炸弹被
    // 拆掉、翻成了一颗基础色星星）。
    afterCommit: withAfterCommit ? () => [[9, 0]] : undefined,
  });

  const run = (withAfterCommit) => {
    for (const [r, c] of [...first, ...second]) faces.set(key(r, c), 'flavor');
    const mask = new Set(first.map(([r, c]) => key(r, c)));
    const stepper = createCascadeStepper(mkConfig(withAfterCommit), mask, { line: '整行', pattern: '图案' });
    const beats = [];
    for (let i = 0; i < 6; i++) {
      const step = stepper.next();
      if (!step) break;
      beats.push(step.points);
      step.commit();
    }
    return beats;
  };

  check('并进遮罩之后，拆弹旁边新成的图案当场就给分', JSON.stringify(run(true)) === '[4,4]', JSON.stringify(run(true)));
  check('不并的话它就漏掉了（这正是要防的那一幕）', JSON.stringify(run(false)) === '[4]', JSON.stringify(run(false)));
}

// ---------------------------------------------------------------------------
// 4. 接线：六副棋盘 + 两个引擎文件
// ---------------------------------------------------------------------------
{
  const SHAPES = ['square', 'circle', 'triangle', 'squareDiamond', 'circleHex', 'triangleBig'];
  for (const name of SHAPES) {
    const s = read(`src/shapes/${name}.ts`);
    check(`${name}：炸弹反面走 dealBombBacks`, s.includes('dealBombBacks('));
    check(`${name}：挂上了 afterCommit（拆弹并进遮罩）`,
      s.includes('afterCommit: isBomb ? defuseAround : undefined'));
    check(`${name}：爆炸检查挂在 checkHazard 上`,
      s.includes('checkHazard: isBomb ? checkBombHazard : undefined'));
    // 只剩「定义」和「挂上去」两处提及——多一处就说明拖拽落地那条老路还在，
    // 同一步会查两次：先按落地时的盘面误判，再按连锁完的盘面判一次。
    check(`${name}：checkBombHazard 不再在别处被调`,
      (s.match(/checkBombHazard/g) || []).length === 2,
      `${(s.match(/checkBombHazard/g) || []).length} 处`);
    // 判四连 / 活棋子表 / 三连预警一律走 liveBomb（= isLiveBomb），不再看颜色。
    check(`${name}：活炸弹认的是 isLiveBomb`, s.includes('isLiveBomb(t, RED_IDX)'));
    // 两层：拆弹走 hitBomb（它记账、它说什么时候拆），裂纹走 isCrackedBomb +
    // crackLayer。少了 hitBomb 就退回一下就拆；少了 crackLayer，规则还在、屏幕
    // 上却看不出来，玩家只会觉得「贴着打了一次怎么没掉」。
    check(`${name}：拆弹走 hitBomb（两下才拆）`, s.includes('if (!hitBomb(t)) continue;'));
    check(`${name}：挨过一下的画裂纹`,
      s.includes('if (isCrackedBomb(tile)) el.appendChild(crackLayer('));
    check(`${name}：存档键换到新版本`, s.includes("bestKey + '_bomb2'"));
  }

  const gc = read('src/engine/gameController.ts');
  const callSites = (gc.match(/hooks\.checkHazard\?\.\(\)/g) || []).length;
  check('gameController 里只查一次爆炸', callSites === 1, `${callSites} 处`);
  const atHazard = gc.indexOf('hooks.checkHazard?.()');
  const atOver = gc.indexOf('hooks.isGameOver()');
  check('爆炸排在「全部翻成点面」前面（被炸掉的一局不该同时报翻完了）',
    atHazard > 0 && atOver > atHazard);
  check('每一局炸弹都盖上规则版本号',
    gc.includes('BOMB_RULES_VERSION') && gc.includes("hooks.modeKey === 'bomb'"));

  const scores = read('api/scores.js');
  check('服务器炸弹榜换了新版本键', scores.includes("const BOMB_KIND = 'bomb2'"));
  check('老局仍然算回老榜（bombRules 缺省 = 第一版）',
    scores.includes("Number(data?.bombRules) >= 2 ? BOMB_KIND : 'bomb'"));
  // 老的 square:bomb 等是归档榜：它不在 ALL_BOARDS / LEGACY_BOARDS 里，重建时
  // 不会被撤人。KINDS 里要是还留着 'bomb'，新旧两版就又混回一张榜上了。
  //
  // ⚠️ 这一条从前抠的是**整个数组的字面量**：
  //     /const KINDS = \['base', 'timed', BOMB_KIND, 'slot', 'flip'\]/
  //   于是步步为营（5cad428）往 KINDS 里合法地加了一档 PUZZLE_KIND，它就红了
  //   ——要守的东西一点没坏（'bomb' 本来就不在里面），门自己先倒了。而 CI 是遇
  //   错即停，这一条把它**后面那 23 步挡了五次推送**，那几步一次都没跑过。
  //
  //   所以现在只查它真正在意的两件事：数组内容里有没有老的 'bomb'、走的是不是
  //   版本化的 BOMB_KIND。往 KINDS 里加新玩法不会再误伤；真有人把 'bomb' 加回
  //   去，照样当场红。
  //
  //   **这是同一个病的第三例**（前两例：check-perk-pages 抠按钮里第一个 svg 的
  //   位置、check-outer-edges 守一个没人调用的函数）。门要抠的是「它做到了什
  //   么」，不是「代码长什么样」——写新断言时回来读这一段。
  const kinds = (scores.match(/const KINDS = \[([^\]]*)\]/) || [, ''])[1];
  check('KINDS 里没有老版本那一档', kinds.length > 0 && !/'bomb'/.test(kinds), kinds);
  check('KINDS 里走的是版本化的那一档', kinds.includes('BOMB_KIND'));

  const board = read('src/ui/leaderboard.ts');
  check('客户端点开的也是新榜', board.includes("named(BASE_THREE, 'bomb2')"));

  check('版本号本身是 2', BOMB_RULES_VERSION === 2, String(BOMB_RULES_VERSION));
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

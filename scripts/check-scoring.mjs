/**
 * 计分连锁的单元测试。
 *
 *   npx esbuild src/engine/scoring.ts --bundle --format=esm --outfile=/tmp/scoring.mjs
 *   node scripts/check-scoring.mjs /tmp/scoring.mjs
 *
 * 这里不碰 DOM，也不碰八个玩法：喂给 createCascadeStepper 一份假的
 * CascadeConfig，就能把「同一片区域被重复计分」和「同时得分 → 一起翻面 →
 * 再判定」这两件事单独拿出来验证。八个玩法的 findMatches 都会为同一片区域
 * 吐出多条 Match（每个起始格子探测一次），所以这正是它们共同踩到的那个坑。
 */

const src = process.argv[2];
if (!src) {
  console.error('用法: node scripts/check-scoring.mjs <打包好的 scoring.mjs>');
  process.exit(2);
}
const { createCascadeStepper, flipStreakDelta } = await import(src);

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const key = (r, c) => `${r},${c}`;

/** 一块方便摆弄的棋盘：cells 是 'r,c' -> face。 */
function board(faces) {
  const tiles = new Map();
  for (const k of faces) tiles.set(k, { face: 'flavor', dotColor: 1 });
  return {
    tileAt: (r, c) => {
      const k = key(r, c);
      if (!tiles.has(k)) tiles.set(k, { face: 'dot', dotColor: 1 });
      return tiles.get(k);
    },
    faceOf: (r, c) => tiles.get(key(r, c))?.face ?? 'dot',
  };
}

// ---------------------------------------------------------------------------
// 1. 同一片区域被多条 Match 报上来，只能计一次分
// ---------------------------------------------------------------------------
{
  // 一条 5 连：玩法里 c=0 和 c=1 两个起点都会扩展成同样这 5 格。
  const five = [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]];
  const b = board(five.map(([r, c]) => key(r, c)));
  const stepper = createCascadeStepper(
    {
      tileAt: b.tileAt,
      findLineBonuses: () => [],
      onLineBonus: () => {},
      resetMaskOnLineBonus: false,
      findMatches: () => [
        { cells: five, points: 5, label: '4连' },
        { cells: five, points: 5, label: '4连' },
      ],
    },
    null,
    { pattern: '图案', line: '整线' },
  );
  const step = stepper.next();
  check('一条 5 连只计一次分（不是两次）', step.points === 5, `实得 ${step.points} 分`);
  check('5 连只算一组图案', step.matchGroups.length === 1, `${step.matchGroups.length} 组`);
}

// ---------------------------------------------------------------------------
// 2. 顺序：同时完成的图案一起计分 → 一起翻面 → 再判定翻面后有没有新图案
// ---------------------------------------------------------------------------
{
  // 玩家这一步同时凑成两组：A 是 [0,0]-[0,3]，B 是 [0,3]、[1,3]、[2,3]、[3,3]，
  // 两组共用 [0,3] 这一格。翻面之后，[1,3] 附近才凑出第三组 C。
  const A = [[0, 0], [0, 1], [0, 2], [0, 3]];
  const B = [[0, 3], [1, 3], [2, 3], [3, 3]];
  const C = [[1, 3], [1, 4], [1, 5], [1, 6]];
  const b = board([...A, ...B, ...C].map(([r, c]) => key(r, c)));

  let wave = 0;
  const stepper = createCascadeStepper(
    {
      tileAt: b.tileAt,
      findLineBonuses: () => [],
      onLineBonus: () => {},
      resetMaskOnLineBonus: false,
      findMatches: () => {
        wave++;
        // 第一波：A 和 B 同时成立（各自还被重复报了一次，跟真实玩法一样）。
        if (wave === 1) {
          return [
            { cells: A, points: 4, label: 'A' },
            { cells: A, points: 4, label: 'A' },
            { cells: B, points: 4, label: 'B' },
          ];
        }
        // 第二波：翻面之后才出现的 C。
        if (wave === 2) return [{ cells: C, points: 4, label: 'C' }];
        return [];
      },
    },
    null,
    { pattern: '图案', line: '整线' },
  );

  const first = stepper.next();
  check('第一波把同时完成的两组一起结算', first.points === 8, `${first.points} 分`);
  check('第一波是两组，不是三条', first.matchGroups.length === 2, `${first.matchGroups.length} 组`);
  check('计分时还没翻面（高亮打在正面上）',
    b.faceOf(0, 0) === 'flavor' && b.faceOf(3, 3) === 'flavor');

  first.commit();
  const flipped = [...A, ...B].every(([r, c]) => b.faceOf(r, c) === 'dot');
  check('两组一起翻面', flipped);

  const second = stepper.next();
  check('翻面之后才判定新图案', second !== null && second.points === 4,
    second ? `${second.points} 分` : '没有第二波');
  check('新图案就是翻面后才成立的那一组',
    second && second.matchGroups.length === 1 && second.matchGroups[0] === C);
}

// ---------------------------------------------------------------------------
// 3. 一组里一张正面都没有，就不该再计分（防刷分那条规则不能被去重弄坏）
// ---------------------------------------------------------------------------
{
  const cells = [[0, 0], [0, 1], [0, 2], [0, 3]];
  const b = board([]); // 全是 dot 面
  const stepper = createCascadeStepper(
    {
      tileAt: b.tileAt,
      findLineBonuses: () => [],
      onLineBonus: () => {},
      resetMaskOnLineBonus: false,
      findMatches: () => [{ cells, points: 4, label: 'X' }],
    },
    null,
    { pattern: '图案', line: '整线' },
  );
  check('全是反面的一组不再计分', stepper.next() === null);
}

// ---- 无限反转：得分之后一组里正面翻反面、反面翻正面 -----------------------
{
  const b = board(['0,0', '0,1']);               // 两枚正面；(0,2)(0,3) 一碰就是反面
  b.tileAt(0, 2); b.tileAt(0, 3);
  const group = [[0, 0], [0, 1], [0, 2], [0, 3]];
  const cfg = {
    tileAt: b.tileAt, findLineBonuses: () => [], onLineBonus() {}, resetMaskOnLineBonus: false,
    findMatches: () => [{ cells: group, points: 4 }],
    toggleOnMatch: true,
  };
  const stepper = createCascadeStepper(cfg, null, { line: '整线', pattern: '图案' });
  const step = stepper.next();
  check('无限反转：两正两反的 1×4 照样得分', step !== null && step.points === 4, JSON.stringify(step?.points));
  step?.commit();
  check('无限反转：得分后正面翻成反面、反面翻回正面',
    group.map(([r, c]) => b.faceOf(r, c)).join() === 'dot,dot,flavor,flavor',
    group.map(([r, c]) => b.faceOf(r, c)).join());
  // 这份假的 findMatches 永远说「那一组还在」——翻回来的两枚是正面，于是又
  // 得分、又翻回去……真棋盘上几乎不会绕回来，这里逼它绕，看上限拦不拦得住。
  let beats = 0;
  for (let step2 = stepper.next(); step2; step2 = stepper.next()) { step2.commit(); if (++beats > 40) break; }
  check('无限反转：一次连锁有上限，不会转到天荒地老', beats > 0 && beats <= 12, `${beats} 拍`);
  // 普通规则对照：同一副牌不开 toggleOnMatch，反面的两枚不动，正面翻过去就完了。
  const b2 = board(['0,0', '0,1']); b2.tileAt(0, 2); b2.tileAt(0, 3);
  const plain = createCascadeStepper({ ...cfg, tileAt: b2.tileAt, toggleOnMatch: false }, null, { line: '整线', pattern: '图案' });
  plain.next()?.commit();
  check('普通规则：只把正面翻到反面', group.map(([r, c]) => b2.faceOf(r, c)).join() === 'dot,dot,dot,dot');
  check('普通规则：翻完全是反面，同一组不再给分', plain.next() === null);
}

// ---------------------------------------------------------------------------
// 4. 无限反转的连击：连续第 n 次 = 单次 × 1.2^(n−1)，每次四舍五入
// ---------------------------------------------------------------------------
{
  const seq = [0, 1, 2, 3, 4, 9].map((chain) => flipStreakDelta(4, chain));
  check('无限反转：4 分连着来 4、5、6、7、8，第十次 21', seq.join(',') === '4,5,6,7,8,21', seq.join(','));
  check('无限反转：第一次不加成', flipStreakDelta(36, 0) === 36);
  check('无限反转：负数当 0', flipStreakDelta(4, -3) === 4);
  check('无限反转：整数，不带小数', Number.isInteger(flipStreakDelta(5, 2)), String(flipStreakDelta(5, 2)));
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);

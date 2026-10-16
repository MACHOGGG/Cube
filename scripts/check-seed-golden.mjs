/**
 * 发牌金标（10-15 补充 S1）：同一串码发出来的那一副牌——**连反面颜色在内**——一枚都不许变。
 *
 *   node scripts/check-seed-golden.mjs             # CI check 那一条跑的就是这一句（纯 node，几秒）
 *   node scripts/check-seed-golden.mjs --mutants   # 门自己的验证：故意改坏发牌四处，每一处都得红
 *
 * 为什么要这一道（10-15 补充 L-11 ①，已复现）：`check-seed-code` 只钉了码本身和 `s1:5DG9G1PQ` 那条随机数流
 * 的开头六个数，不发牌；`check-seed-deal`（浏览器）每一行用同一串码开两次比——比的是同一个构建自己和自己，
 * 没有写死的牌，而且读的是屏幕、开局全是正面，**看不到反面颜色**。故意改坏发牌四处（方块多洗一次、小球只改
 * 反面配法、控制器在种子和发牌之间多取一个数、炸弹发反面多取一个数），那两道全绿——可每一处都意味着分享
 * 出去的每一串码、每一天的每日挑战，换了一台设备发出来的是另一副牌。
 *
 * 怎么取盘面：纯 node，走真的发牌路径，不读屏。esbuild 把 `src` 打成一包（scripts/lib/seedGoldenBundle.mjs，
 * 只在那一包里插几个只读的口子，源码和产物一字不动），装一份假 DOM（scripts/lib/fakeDom.mjs）；照每日挑战那
 * 一页的做法 `seedGameOf(码)` → `game.mount(…, { ...opts, noCountdown })` → 开局键被按下 → 控制器 newGame
 * （种 `'s1:' + 码`，老虎机先抽目标）→ 棋盘发牌 → 读整副盘面。
 *
 * 哈希（写法定死，改了金标就全废）：每格写成「种类、正反面、颜色下标 / 反面颜色下标、炸弹挨过几下」——
 * 种类 T 棋子 / X 炸弹 / . 空位或洞 / _ 没有这一格；正反面 f / d；炸弹挨过几下只在挨过时写（`*n`，开局都没挨过）。
 * 一行里格与格隔一个空格，行与行隔一个换行；老虎机那一局最前面多一行 `target=<图案 id>`。取 sha256 前 16 位。
 * 颜色记的是下标，所以色盲、深色不影响（⑥ 量这一条）。
 *
 * 金标值是在 481d28c 上算的（10-15 补充那一张表，方案作者另用 Playwright 在那一版的 dist 上用代号开这 67 局
 * 逐枚核对过）。**以后哪一推让这儿红了**：
 *   · 「门要跟着改」（认不出 let grid、createGameController、rng.ts 那几处写法）——改 seedGoldenBundle.mjs 的
 *     正则，金标一字不改；
 *   · 「② 六十局都发得出来」附一句 fakeDom 没有什么——界面在发牌之前用上了假 DOM 没有的接口，补 fakeDom.mjs；
 *   · 哈希对不上——发牌真的变了。不是有意为之就是 bug；是有意的（换发牌规矩），那得先加 DEAL_VERSION
 *     （seedCode.ts），让旧码说「已过期」，而不是悄悄发出另一副牌。
 */
import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleSeedGolden } from './lib/seedGoldenBundle.mjs';
import { installFakeDom } from './lib/fakeDom.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MUTANTS = process.argv.includes('--mutants');

/** 编号表二十行 × 三个随机数（0、20261014、2²⁷−1）：每格「码 哈希」。 */
const RANDS = [0, 20261014, 134217727];
const GOLDEN = `
 0 base/square        4000000A dd96913ce3ebed27 | 40KAA4P8 b8bacb0a1582a2b4 | 43ZZZZZM 253fa383cbfdb954
 1 base/circle        44000008 da5f41b8a55042f6 | 44KAA4PA 2cb87411f8b94534 | 47ZZZZZP 96d0687cd254aa1c
 2 base/squareDiamond 4800000E cf76cf191178caee | 48KAA4PC 5961e3a713791c56 | 4BZZZZZG f0a6910e21c6b69e
 3 base/circleHex     4C00000C 6c853ca14b8b840b | 4CKAA4PE 43264d28eba8a748 | 4FZZZZZJ ee4ef370d0fdc5f9
 4 base/circleSeven   4G000002 50768f224f4ae871 | 4GKAA4P0 7cfd76fc167b45f7 | 4KZZZZZW abff59c8f3adb9ee
 5 base/triangleBig   4M000000 44993a96d4177200 | 4MKAA4P2 0427f2fd08bc001c | 4QZZZZZY 9b33e6e8c693b0c4
 6 timed/square       4R000006 cd4f6c446e83ffe7 | 4RKAA4P4 aacb4f0e14ec3744 | 4VZZZZZR 3ccc733ead6fc12c
 7 timed/circle       4W000004 75ccce2f26b3c538 | 4WKAA4P6 d0203a2f62a4abe6 | 4ZZZZZZT 9d43fd52f3376f44
 8 bomb/square        5000000T 3367afd82db01eb3 | 50KAA4PR 1bdefbfa76edc49d | 53ZZZZZ4 c75a1fc2ca14515a
 9 bomb/circle        5400000R f63d830355e0b08e | 54KAA4PT fbcd31332f87dc3d | 57ZZZZZ6 337a0fa51a101d29
10 bombTimed/square   5800000Y b11e7e248c600280 | 58KAA4PW 9f6493876328688c | 5BZZZZZ0 fb464b8e00df47d9
11 bombTimed/circle   5C00000W 493275e9911c3a55 | 5CKAA4PY c833f883433eba05 | 5FZZZZZ2 dc0aacceb392ce08
12 bombAdv/sqDiamond  5G00000J 6b184b1afaab0502 | 5GKAA4PG e61fbf10336da36e | 5KZZZZZC 326b5685cdb049b0
13 bombAdv/circleHex  5M00000G 8be3fd0dcedf8894 | 5MKAA4PJ 385be4e09fac5acb | 5QZZZZZE 0891dd2235509fe3
14 slot/square        5R00000P 9008c91159c6b66c | 5RKAA4PM 6e687f090641c1e4 | 5VZZZZZ8 e3ed84efe1145083
15 slot/circle        5W00000M a65048f6b01e3952 | 5WKAA4PP d6023cee44669d7f | 5ZZZZZZA 4fb4108f5219fc4a
16 flip/square        6000000F 8716fc382e251f0f | 60KAA4PD 53e8c8600ab7b7dc | 63ZZZZZH a5572ff6611a5d2f
17 flip/circle        6400000D 4b5f53607fd28ded | 64KAA4PF 318ed99e1b53a39b | 67ZZZZZK 3146175186f7da58
18 puzzle/square      6800000B 8867d26034ffd030 | 68KAA4P9 ff5b34d19a46b79c | 6BZZZZZN 5a6c62994ee735f1
19 puzzle/circle      6C000009 0df2f47e225e1134 | 6CKAA4PB 0b14b244b9128f56 | 6FZZZZZQ 6b49db0051f14823
`;
/** 2026-10-14 到 10-20 一周的每日挑战（含 10-17 七色小球）：日子、码、哈希、哪一局。 */
const DAILY = `
20261014 43VZ0M21 1645b808dd77c28b base/square
20261015 66K55P35 b3a85a3116fa31ba flip/circle
20261016 5095JZ7K ebcc446c3b7b026c bomb/square
20261017 4K264JW1 c4741fa10c49f352 base/circleSeven
20261018 5A4NRSQ7 ff9514260a633588 bombTimed/square
20261019 4EQGKF58 5a868a1935ca8fbe base/circleHex
20261020 6ABK40FX 610d272f12226ba5 puzzle/square
`;
/**
 * 旁证：每一局「发完取了几个数」（种下那一刻清零，到发完为止；老虎机含先抽目标那几下）。只印不判——
 * 取数的个数可以在牌不变的情况下变（比如换一种等价的洗法），真正钉着的是上面那张哈希表。
 */
const DRAWS = {
  'base/square': [455, 65, 195], 'base/circle': [51, 51, 153], 'base/squareDiamond': [65, 65, 65],
  'base/circleHex': [65, 130, 65], 'base/circleSeven': [90, 90, 90], 'base/triangleBig': [210, 105, 105],
  'timed/square': [455, 845, 65], 'timed/circle': [153, 51, 51], 'bomb/square': [207, 483, 207],
  'bomb/circle': [53, 159, 371], 'bombTimed/square': [276, 69, 207], 'bombTimed/circle': [53, 106, 53],
  'bombAdv/squareDiamond': [69, 69, 138], 'bombAdv/circleHex': [138, 138, 69], 'slot/square': [261, 326, 131],
  'slot/circle': [103, 52, 52], 'flip/square': [65, 520, 325], 'flip/circle': [51, 51, 51],
  'puzzle/square': [520, 130, 195], 'puzzle/circle': [102, 51, 51],
};

const goldRows = GOLDEN.trim()
  .split('\n')
  .map((line) => {
    const row = Number(line.trim().split(/\s+/)[0]);
    const cells = [...line.matchAll(/([0-9A-Z]{8}) ([0-9a-f]{16})/g)].map((m) => ({ code: m[1], hash: m[2] }));
    return { row, cells };
  });
const goldDaily = DAILY.trim()
  .split('\n')
  .map((l) => {
    const [day, code, hash, game] = l.trim().split(/\s+/);
    return { day, code, hash, game };
  });

const sha16 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** 一副盘面写成上面那种文字。 */
export function boardText(grid, { isBlank, liveBomb }, target) {
  const cell = (t) => {
    if (t == null) return '_';
    const kind = isBlank(t) ? '.' : liveBomb && liveBomb(t) ? 'X' : 'T';
    const hits = t.bombHits ? '*' + t.bombHits : '';
    return kind + (t.face === 'dot' ? 'd' : 'f') + t.color + '/' + t.dotColor + hits;
  };
  const body = grid.map((row) => row.map(cell).join(' ')).join('\n');
  return target ? `target=${target.id}\n${body}` : body;
}

const PLAYED = { slides_lang: 'zhHans', slides_intro_seen: '1' };
for (const k of ['square', 'circle', 'finished', 'bomb', 'slot', 'flip', 'puzzle', 'timed', 'layout']) PLAYED['slides_played_' + k] = '1';

/**
 * 打一包、装上假 DOM，交回一个「拿一串码开一局、读发完的那一副」的函数。`mutate` 给 --mutants 用。
 */
async function makeDealer(mutate) {
  const file = await bundleSeedGolden(ROOT, { mutate });
  const dom = installFakeDom({ storage: PLAYED });
  const SG = {
    boards: [],
    ctl: null,
    draws: 0,
    inScratch: 0,
    scratchRuns: 0,
    board(b) {
      this.boards.push(b);
    },
    controller(refs, hooks) {
      this.ctl = { refs, hooks };
    },
  };
  globalThis.__SG = SG;
  const B = await import(pathToFileURL(file).href);
  rmSync(dirname(file), { recursive: true, force: true }); // 每一包一个临时目录，读进来就删
  /**
   * `extra` 盖在这一局的选项上（⑦ 头一回玩那一局给 coach）；`warm` 为真时开局前先把排着的定时器跑掉
   * （教学预热那一下：开局页一露面排的 setTimeout(0)，和它拆成的几段搜索）。
   */
  const deal = (code, source = 'entered', daily, { extra = {}, warm = false } = {}) => {
    const g = B.seedGameOf(code, source, daily);
    if (!g) throw new Error(`码 ${code} 解不出一局`);
    const game = B.games.find((x) => x.card.id === g.board);
    if (!game) throw new Error(`码 ${code} 要的棋盘 ${g.board} 不在六副里`);
    const host = document.createElement('div');
    document.body.appendChild(host);
    SG.boards = [];
    SG.ctl = null;
    SG.scratchRuns = 0;
    let destroy = null;
    try {
      destroy = game.mount(host, () => {}, { ...g.opts, lang: 'zhHans', noCountdown: true, ...extra });
      if (warm) for (let i = 0; i < 400 && dom.pendingTimers(); i++) dom.runTimers(0);
      dom.flushFrames(1); // gameShell：noCountdown 时下一帧替他按下那颗藏起来的开局键
      const tap = SG.boards[SG.boards.length - 1];
      if (!tap) throw new Error('门要跟着改：这一副棋盘 mount 之后没有露出盘面（seedGoldenBundle 的口子没插上）');
      if (!SG.ctl) throw new Error('门要跟着改：mount 之后没见到 createGameController');
      const grid = tap.grid();
      const target = SG.ctl.hooks.slotTarget ?? null;
      const tiles = grid.reduce((n, r) => n + r.filter(Boolean).length, 0);
      return {
        game: `${g.variant.mode}/${g.board}`,
        grid,
        tap,
        target,
        tiles,
        draws: SG.draws,
        scratchRuns: SG.scratchRuns,
        hash: sha16(boardText(grid, tap, target)),
      };
    } finally {
      try {
        destroy?.();
      } catch {
        /* 拆的时候碰到假 DOM 没有的东西不要紧：牌已经读完了 */
      }
      host.remove();
      dom.dropPending();
    }
  };
  return { B, dom, deal };
}

let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

/** 跑一遍整张表；返回红了几格（--mutants 用它判「改坏之后红没红」）。 */
async function runTables(dealer, { quiet = false } = {}) {
  const { B, deal } = dealer;
  const SC = B.SC;
  const say = quiet ? () => {} : check;
  let red = 0;
  const redRows = new Set();
  const redDays = [];
  // ② 六十局
  const errors = [];
  const results = [];
  for (const { row, cells } of goldRows) {
    const v = SC.VARIANTS[row];
    const name = `${v.mode}/${v.board}`;
    cells.forEach(({ code, hash }, k) => {
      let got;
      try {
        got = deal(code);
      } catch (e) {
        errors.push(`${code}（${name}）：${e.message}`);
        red++;
        redRows.add(row);
        return;
      }
      results.push({ row, k, code, name, got });
      if (got.hash !== hash) {
        red++;
        redRows.add(row);
      }
      if (!quiet && got.draws !== DRAWS[name]?.[k]) console.log(`INFO  旁证：${code}（${name}）发完取了 ${got.draws} 个数，表里记的是 ${DRAWS[name]?.[k]}`);
    });
  }
  say('② 六十局都发得出来（每一局都读到了整副盘面）', errors.length === 0 && results.length === 60, errors.slice(0, 3).join(' | '));
  for (const { row, cells } of goldRows) {
    const v = SC.VARIANTS[row];
    const mine = results.filter((r) => r.row === row);
    const bad = mine.filter((r) => r.got.hash !== cells[r.k].hash).map((r) => `${r.code} 算出 ${r.got.hash}，金标 ${cells[r.k].hash}`);
    say(`② 第 ${String(row).padStart(2)} 行 ${v.mode}/${v.board}：三串码发的牌和金标一字不差`, mine.length === 3 && bad.length === 0, bad.join(' | '));
  }
  // ③ 一周的每日挑战
  for (const d of goldDaily) {
    const idx = SC.dayIndexOfKey(d.day);
    const code = SC.dailySeed(idx);
    let got = null;
    let err = '';
    try {
      got = deal(code, 'daily', d.day);
    } catch (e) {
      err = e.message;
    }
    const ok = code === d.code && got && got.hash === d.hash && got.game === d.game;
    if (!ok) {
      red++;
      redDays.push(d.day);
    }
    say(
      `③ 每日挑战 ${d.day}（${d.game}）：那一天的码是 ${d.code}，发的牌和金标一字不差`,
      ok,
      ok ? '' : `码 ${code}、${got ? `${got.game} 哈希 ${got.hash}` : '发不出来：' + err}`,
    );
  }
  return { red, redRows: [...redRows].sort((a, b) => a - b), redDays, results };
}

if (!MUTANTS) {
  const t0 = Date.now();
  const dealer = await makeDealer();
  const { B, deal } = dealer;
  const SC = B.SC;
  // 默认状态写明：Pro 关、色盲关、浅色（②③ 两张表都是在这个状态下算的）。
  B.setPro(false);
  B.setColorblind(false);

  // ① 尺子：表里的码就是编码表那一行、那个随机数编出来的；编码表还是二十行
  const codeBad = [];
  for (const { row, cells } of goldRows) cells.forEach(({ code }, k) => {
    const want = SC.encodeSeed(SC.DEAL_VERSION, row, RANDS[k]);
    if (want !== code) codeBad.push(`${row}/${RANDS[k]}：${want} ≠ ${code}`);
  });
  check('① 尺子：编号表二十行、每行三个随机数编出来的码和金标表上的一致', SC.VARIANTS.length === 20 && goldRows.length === 20 && codeBad.length === 0, codeBad.slice(0, 3).join(' | '));

  const { results } = await runTables(dealer);

  // ④ 同一行换随机数，牌就不同（种子真的用上了，不是每一行发同一副）
  const same = [];
  for (const { row } of goldRows) {
    const hs = results.filter((r) => r.row === row).map((r) => r.got.hash);
    if (new Set(hs).size !== hs.length) same.push(row);
  }
  check('④ 同一行三个随机数发出三副不同的牌', same.length === 0, same.join(','));

  // ⑤ 反面颜色真的进了哈希：改一枚的 dotColor，哈希就变
  {
    const r = results[0].got;
    const before = sha16(boardText(r.grid, r.tap, r.target));
    const g2 = r.grid.map((row) => row.map((t) => (t ? { ...t } : t)));
    const t = g2[0][0];
    t.dotColor = (t.dotColor + 1) % 6;
    const after = sha16(boardText(g2, r.tap, r.target));
    check('⑤ 只改一枚的反面颜色，哈希就变（dotColor 真的进了哈希）', before === r.hash && after !== before, `${before} → ${after}`);
  }

  // ⑥ 色盲、深色发同一副（颜色记下标）
  {
    const pick = goldRows.map(({ row, cells }) => ({ row, code: cells[0].code, hash: cells[0].hash }));
    B.setColorblind(true);
    const cb = pick.filter((p) => deal(p.code).hash !== p.hash).map((p) => p.code);
    B.setColorblind(false);
    B.setTheme('dark');
    const dk = pick.filter((p) => deal(p.code).hash !== p.hash).map((p) => p.code);
    B.setTheme('light');
    check('⑥ 色盲友好开着，二十行发的牌和金标一样', cb.length === 0, cb.join(','));
    check('⑥ 深色主题，二十行发的牌和金标一样', dk.length === 0, dk.join(','));
  }

  // ⑦ 头一回玩方块 / 小球：带五条教学、开局前在临时盘面上预热一遍（withScratchRandom），发的还是同一副
  {
    const bad = [];
    const cold = [];
    for (const row of [0, 1]) {
      for (const { code, hash } of goldRows[row].cells) {
        const got = deal(code, 'entered', undefined, { extra: { coach: true, coachPlan: 'first' }, warm: true });
        if (got.hash !== hash) bad.push(`${code} ${got.hash}`);
        if (!got.scratchRuns) cold.push(code);
      }
    }
    // 尺子：预热真的跑了（借过那一串临时的随机数），不然下面那一条什么也没量
    check('⑦ （尺子）六局开局前都在临时盘面上预热过', cold.length === 0, cold.join(','));
    check('⑦ 头一回玩方块 / 小球（教学条＋开局前预热）：六局发的牌和金标一样', bad.length === 0, bad.join(' | '));
  }

  // ⑧ Pro 开着（10-15 补充 S10：K-4，从「只报」改成断言）。
  //
  // 按新设计，代号局（seedGameOf(码,'entered')）永远不用 Pro——原来那样开，这一条永远看不到 Pro。所以照单人 Pro 局
  // 那条路开：同一串码当成「随手抽的」（seed.source = 'random'）、proAllowed: true。断言五件事：
  //   · 六十局的哈希都和 Pro 关时不一样（反面确实换了）；
  //   · 挖掉反面颜色之后，正面六十局逐枚一样（改写只碰 dotColor）；
  //   · 发完牌取的随机数个数六十局一样（改写一个数都不取——取了的话，下一局、老虎机、教学全都跟着错位）；
  //   · 每一枚不在圈外的色块，反面 = 这一圈里的下一色；
  //   · 红块（炸弹局里不在圈里的那一色）反面一枚没动。
  // ②③ 两张金标表（Pro 关）一字不改，上面已经全绿过。
  {
    const COLORS = { square: 6, squareDiamond: 6, circle: 4, circleHex: 6, circleSeven: 7, triangleBig: 6 };
    const RED = { square: 0, squareDiamond: 0, circle: 0, circleHex: 1, triangleBig: 1 };
    const fronts = (grid) => grid.map((row) => row.map((t) => (t == null ? '_' : t.face + t.color)).join(' ')).join('\n');
    const proOpts = (code) => {
      const g = B.seedGameOf(code, 'entered');
      return { seed: { ...g.opts.seed, source: 'random' }, proAllowed: true };
    };
    const same = [];
    const frontBad = [];
    const drawBad = [];
    const backBad = [];
    const redBad = [];
    let redSeen = 0;
    let checked = 0;
    for (const r of results) {
      const off = r.got;
      B.setPro(true);
      let on;
      try {
        on = deal(r.code, 'entered', undefined, { extra: proOpts(r.code) });
      } finally {
        B.setPro(false);
      }
      if (on.hash === goldRows.find((x) => x.row === r.row).cells[r.k].hash) same.push(r.code);
      if (fronts(on.grid) !== fronts(off.grid)) frontBad.push(r.code);
      if (on.draws !== off.draws) drawBad.push(`${r.code} ${on.draws}≠${off.draws}`);
      const board = r.name.split('/')[1];
      const bomb = /^bomb/.test(r.name.split('/')[0]);
      const red = bomb ? RED[board] ?? -1 : -1;
      const cycle = B.proCycle(COLORS[board], red);
      on.grid.forEach((row, i) =>
        row.forEach((t, j) => {
          if (t == null || on.tap.isBlank(t) || t.color < 0) return;
          const was = off.grid[i][j];
          if (t.color === red) {
            redSeen++;
            if (t.dotColor !== was.dotColor) redBad.push(`${r.code}@${i},${j}`);
            return;
          }
          checked++;
          if (t.dotColor !== B.proNext(cycle, t.color)) backBad.push(`${r.code}@${i},${j} ${t.color}→${t.dotColor}`);
        }),
      );
    }
    check('⑧ Pro 开着：六十局的牌（连反面）都和 Pro 关时不一样', same.length === 0 && results.length === 60, same.join(',') || `${results.length} 局`);
    check('⑧ Pro 开着：挖掉反面颜色之后，正面六十局逐枚一样', frontBad.length === 0, frontBad.join(','));
    check('⑧ Pro 开着：发完牌取的随机数个数六十局一样（改写一个数都没取）', drawBad.length === 0, drawBad.slice(0, 4).join(' | '));
    check('⑧ Pro 开着：每一枚色块的反面 = 这一圈里的下一色', backBad.length === 0 && checked > 0, backBad.slice(0, 4).join(' | ') || `${checked} 枚`);
    check('⑧ Pro 开着：红块（不在圈里）反面一枚没动', redBad.length === 0 && redSeen > 0, redBad.slice(0, 4).join(' | ') || `${redSeen} 枚`);
    // 两道闸各自挡得住：开着 Pro 输代号（没给 proAllowed）、以及给了 proAllowed 但种子是输进来的——都照普通规则发牌。
    const gate1 = [];
    const gate2 = [];
    B.setPro(true);
    try {
      for (const { row, cells } of goldRows) {
        for (const { code, hash } of cells) {
          if (deal(code).hash !== hash) gate1.push(`${row}:${code}`);
          if (deal(code, 'entered', undefined, { extra: { proAllowed: true } }).hash !== hash) gate2.push(`${row}:${code}`);
        }
      }
    } finally {
      B.setPro(false);
    }
    check('⑧ 开着 Pro 输代号开局（没给 proAllowed）：六十局都和金标一样', gate1.length === 0, gate1.slice(0, 6).join(' '));
    check('⑧ 给了 proAllowed、种子却是输进来的：六十局都和金标一样（第二道闸）', gate2.length === 0, gate2.slice(0, 6).join(' '));
  }

  // ⑨ 老虎机都抽到了目标（目标进了哈希的第一行）
  {
    const slots = results.filter((r) => r.name.startsWith('slot/'));
    check('⑨ 老虎机那六局都从种子里抽到了目标', slots.length === 6 && slots.every((r) => r.got.target && r.got.target.id != null), slots.map((r) => r.got.target?.id).join(','));
  }
  console.log(`\n${fail ? `红了 ${fail} 条` : '全部通过'}（${pass} 条过，用时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒）`);
  process.exit(fail ? 1 : 0);
}

// ── --mutants：故意改坏发牌四处，每一处都必须红（门自己的验证，不进 CI）──────────────────────────────
const MUTATIONS = [
  {
    name: '方块多洗一次',
    file: 'src/shapes/square.ts',
    from: '        return shuffle(deck);\n      }\n\n      // Pre-assigns',
    to: '        return shuffle(shuffle(deck));\n      }\n\n      // Pre-assigns',
  },
  {
    name: '小球只改反面配法',
    file: 'src/shapes/circle.ts',
    from: '          others.push(color);\n          shuffle(others);',
    to: '          others.unshift(color);\n          shuffle(others);',
  },
  {
    name: '控制器在种子和发牌之间多取一个数',
    file: 'src/engine/gameController.ts',
    from: "import { clearSeed, seedRandom } from './rng';",
    to: "import { clearSeed, seedRandom, random as __mutRandom } from './rng';",
    also: ['    plantSeed();\n    dealt++;', '    plantSeed();\n    __mutRandom();\n    dealt++;'],
  },
  {
    name: '炸弹发反面多取一个数',
    file: 'src/engine/bomb.ts',
    from: '  const order = shuffle(usable.length ? usable : [...normalColors]);',
    to: '  shuffle([0, 1]);\n  const order = shuffle(usable.length ? usable : [...normalColors]);',
  },
];
let allRed = true;
for (const m of MUTATIONS) {
  let applied = 0;
  const mutate = (rel, src) => {
    if (rel !== m.file) return src;
    for (const [from, to] of [[m.from, m.to], ...(m.also ? [m.also] : [])]) {
      if (src.split(from).length !== 2) throw new Error(`--mutants 要跟着改：${m.file} 里认不出「${from.trim().split('\n')[0]}」`);
      src = src.replace(from, to);
      applied++;
    }
    return src;
  };
  const dealer = await makeDealer(mutate);
  dealer.B.setPro(false);
  const { red, redRows, redDays } = await runTables(dealer, { quiet: true });
  const ok = applied > 0 && red > 0;
  if (!ok) allRed = false;
  console.log(`${ok ? 'PASS' : 'FAIL'}  故意改坏「${m.name}」→ 门红了 ${red} 格（编号表第 ${redRows.join('、') || '—'} 行；每日 ${redDays.join('、') || '—'}）`);
}
console.log(allRed ? '\n四处改坏各自都红了' : '\n有一处改坏了门却没红');
process.exit(allRed ? 0 : 1);

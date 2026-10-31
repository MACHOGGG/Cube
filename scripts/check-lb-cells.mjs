/**
 * 排行榜三行筛选的那张表和点击规则（10-31 方案推14 Z-B14、Z-B15；纯 node，进 ci.yml check）。
 *
 *   node scripts/check-lb-cells.mjs
 *
 * 量的是：
 *   ① 客户端 src/engine/lbCells.ts 的 LB_CELLS = 服务端 api/scores.js 的 LB_CELLS = 从两份 VARIANTS（src/engine/seedCode.ts、
 *      api/_seedcode.js）推出来的那张「族 × 玩法 → 棋盘」表；ALL_BOARDS 正好 36 张，Pro 格子 = 普通格子；
 *   ② 穷举所有选择（族 8 种 × 普通/Pro 3 种 × 玩法 64 种）× 每颗药丸点一下（含「全部」）：点完结果永远非空；greyed 正好等于
 *      方案的定义；点灰的不改变选择；一行全选上必收回 ∗、有灰的行不会因此收回；「只剩三角且无基础」那一步把玩法行回 ∗；
 *   ③ 站长两个例子：三角 → 只有「全部」「基础」可点；三角＋方块＋炸弹 → 只有方块的两张炸弹榜（及其 :pro）；
 *   ④ 客户端 selectionKey 和服务端 parseSelection 对同一份选择得出同一组榜（[]、全集、乱序三种写法同一个键）。
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.ALLOW_MEMORY_STORE = '1';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0;
let passes = 0;
const check = (n, ok, extra = '') => {
  if (ok) passes++;
  if (!ok || !n.startsWith('·')) console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const dir = mkdtempSync(join(tmpdir(), 'lb-cells-'));
await build({
  stdin: {
    contents: `export * from './src/engine/lbCells'; export { VARIANTS as CLIENT_VARIANTS } from './src/engine/seedCode';`,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'neutral', outfile: join(dir, 'c.mjs'), logLevel: 'silent',
});
const C = await import(pathToFileURL(join(dir, 'c.mjs')).href);
rmSync(dir, { recursive: true, force: true });
const S = await import(pathToFileURL(join(ROOT, 'api/scores.js')).href);
const SC = await import(pathToFileURL(join(ROOT, 'api/_seedcode.js')).href);

// ── ① 那张表 ─────────────────────────────────────────────────────────────────────
const FAMILY_OF = { square: 'square', squareDiamond: 'square', circle: 'circle', circleHex: 'circle', circleSeven: 'circle', triangleBig: 'triangle' };
const MODE_OF = { base: 'base', timed: 'timed', bomb: 'bomb', bombTimed: 'bomb', bombAdv: 'bomb', slot: 'slot', flip: 'flip', puzzle: 'puzzle' };
const derive = (variants) => {
  const out = {};
  for (const v of variants) {
    const f = FAMILY_OF[v.board];
    const m = MODE_OF[v.mode];
    out[f] ??= {};
    out[f][m] ??= [];
    if (!out[f][m].includes(v.board)) out[f][m].push(v.board);
  }
  return out;
};
const norm = (t) => JSON.stringify(Object.fromEntries(Object.keys(t).sort().map((f) => [f, Object.fromEntries(Object.keys(t[f]).sort().map((m) => [m, [...t[f][m]].sort()]))])));
const fromServerVariants = derive(SC.VARIANTS);
const fromClientVariants = derive(C.CLIENT_VARIANTS);
check('① 两份 VARIANTS 推出来的表一样', norm(fromServerVariants) === norm(fromClientVariants));
check('① 客户端 lbCells 的 LB_CELLS = VARIANTS 推出来的表', norm(C.LB_CELLS) === norm(fromClientVariants), norm(C.LB_CELLS));
check('① 服务端 scores.js 的 LB_CELLS = VARIANTS 推出来的表', norm(S.LB_CELLS) === norm(fromServerVariants), norm(S.LB_CELLS));
check('① 方块 × 炸弹 = 经典方块、菱形方块；小球 × 炸弹 = 经典小球、六边圆球；三角只有基础',
  norm({ a: { b: C.LB_CELLS.square.bomb } }) === norm({ a: { b: ['square', 'squareDiamond'] } }) &&
  norm({ a: { b: C.LB_CELLS.circle.bomb } }) === norm({ a: { b: ['circle', 'circleHex'] } }) &&
  Object.keys(C.LB_CELLS.triangle).join() === 'base');
const normal = S.ALL_BOARDS.filter((id) => !id.endsWith(':pro'));
const pro = S.ALL_BOARDS.filter((id) => id.endsWith(':pro'));
check('① ALL_BOARDS 正好 36 张：18 张普通 ＋ 同名加 :pro 的 18 张', S.ALL_BOARDS.length === 36 && normal.length === 18 && pro.length === 18 &&
  pro.every((id) => normal.includes(id.slice(0, -4))), `${S.ALL_BOARDS.length}`);
check('① 伪造的布局玩法（squareDiamond:timed）不在里面', !S.ALL_BOARDS.includes('squareDiamond:timed') && !S.ALL_BOARDS.includes('triangleBig:bomb3'));

// ── ② 穷举 ───────────────────────────────────────────────────────────────────────
const subsets = (all) => {
  const out = [];
  for (let m = 0; m < 1 << all.length; m++) {
    const s = all.filter((_, i) => m & (1 << i));
    if (s.length === all.length) continue; // 全选就是 ∗（[]），规范化之后不会出现
    out.push(s);
  }
  return out;
};
const Fs = subsets(C.LB_FAMILIES);
const Ts = subsets(C.LB_TIERS);
const Ms = subsets(C.LB_MODES);
const modesOf = (f) => C.LB_MODES.filter((m) => (C.LB_CELLS[f][m]?.length ?? 0) > 0);
const ROWS = { families: C.LB_FAMILIES, tiers: C.LB_TIERS, modes: C.LB_MODES };
let states = 0;
let taps = 0;
const bad = { empty: 0, grey: 0, greyTap: 0, collapse: 0, reset: 0 };
const examples = {};
for (const F of Fs) for (const T of Ts) for (const M of Ms) {
  const sel = { families: F, tiers: T, modes: M };
  if (!C.expand(sel).length) continue; // 走不到的状态（规则保证不会停在这儿）
  states++;
  // greyed 正好等于定义
  const g = C.greyed(sel);
  for (const f of C.LB_FAMILIES) {
    const want = !F.includes(f) && M.length > 0 && !M.some((m) => modesOf(f).includes(m));
    if (g.families[f] !== want) bad.grey++;
  }
  for (const m of C.LB_MODES) {
    const want = !M.includes(m) && F.length > 0 && !F.some((f) => modesOf(f).includes(m));
    if (g.modes[m] !== want) bad.grey++;
  }
  if (g.tiers.normal || g.tiers.pro) bad.grey++;
  for (const [row, all] of Object.entries(ROWS)) {
    for (const chip of ['all', ...all]) {
      taps++;
      const r = C.tap(sel, row, chip);
      if (!C.expand(r.sel).length) bad.empty++;
      const wasGrey = chip !== 'all' && (g[row] ?? {})[chip] && !sel[row].includes(chip);
      if (wasGrey && (C.selectionKey(r.sel) !== C.selectionKey(sel) || !r.note)) bad.greyTap++;
      // 一行全选上必收回 ∗（规范化之后不会是全集）
      for (const k of Object.keys(ROWS)) if (r.sel[k].length === ROWS[k].length) bad.collapse++;
      // 「只剩三角且无基础」：玩法行回 ∗、说 rankResetNote
      const naive = chip === 'all' ? [] : sel[row].includes(chip) ? sel[row].filter((x) => x !== chip) : [...sel[row], chip];
      const naiveSel = { ...sel, [row]: naive.length === ROWS[row].length ? [] : naive };
      if (!wasGrey && !C.expand(naiveSel).length) {
        if (r.sel.modes.length !== 0 || r.note?.key !== 'rankResetNote') bad.reset++;
        examples.reset ??= { sel, row, chip, out: r.sel };
      }
    }
  }
}
check(`② 穷举 ${states} 种状态 × 每颗药丸点一下（${taps} 次）：点完结果永远非空`, bad.empty === 0, `${bad.empty} 次空`);
check('② greyed 正好等于定义（族灰 ⟺ M≠∗ 且这一族的玩法和 M 没交集；玩法灰 ⟺ F≠∗ 且 F 里没有一族有它；第二行永远不灰；已选的不灰）', bad.grey === 0, `${bad.grey} 处不对`);
check('② 点灰的那颗：选择不变，而且说一句', bad.greyTap === 0, `${bad.greyTap} 次`);
check('② 一行每一颗都选上就收回「全部」（规范化之后不会停在全集）', bad.collapse === 0, `${bad.collapse} 次`);
check('② 唯一会变空的那一步（只剩三角、玩法里没有基础）：照常去掉，玩法行回「全部」，说 rankResetNote', bad.reset === 0 && Boolean(examples.reset),
  examples.reset ? JSON.stringify(examples.reset) : '一次都没走到（尺子）');
// 有灰的行不会因此收回：族行有灰（例 M={计时}）时，点上方块、小球之后，三角还是灰的，没法点上，所以这一行永远收不回 ∗。
{
  let s = { families: [], tiers: [], modes: ['timed'] };
  s = C.tap(s, 'families', 'square').sel;
  s = C.tap(s, 'families', 'circle').sel;
  const t = C.tap(s, 'families', 'triangle');
  check('② 有灰的行不会因此收回：玩法选计时、族点上方块和小球，三角仍灰、点不上，族行停在 {方块, 小球}',
    t.sel.families.join() === 'square,circle' && t.note?.key === 'rankGreyFamily' && C.greyed(s).families.triangle === true, JSON.stringify(t.sel));
}

// ── ③ 站长两个例子 ───────────────────────────────────────────────────────────────
{
  const s = C.tap(C.DEFAULT_SELECTION, 'families', 'triangle').sel;
  const g = C.greyed(s);
  const can = C.LB_MODES.filter((m) => !g.modes[m]);
  check('③ 点三角 → 玩法行只剩「全部」「基础」可点', can.join() === 'base', can.join());
  const t = C.tap(s, 'modes', 'timed');
  check('③ 再点灰的计时：不选中，说「三角没有计时玩法」那一句（rankGreyMode）', t.sel.modes.length === 0 && t.note?.key === 'rankGreyMode' && t.note.mode === 'timed');
}
{
  let s = C.DEFAULT_SELECTION;
  s = C.tap(s, 'families', 'triangle').sel;
  s = C.tap(s, 'families', 'square').sel;
  s = C.tap(s, 'modes', 'bomb').sel;
  const ids = C.expand(s).map((c) => `${c.board}:${c.mode}:${c.tier}`).sort();
  check('③ 三角＋方块＋炸弹 → 只有方块的两张炸弹榜（各含普通、Pro）', ids.join() === ['square:bomb:normal', 'square:bomb:pro', 'squareDiamond:bomb:normal', 'squareDiamond:bomb:pro'].sort().join(), ids.join());
  const p = C.partialNote(s);
  check('③ 那一页表头说「三角没有炸弹玩法，只算方块」（rankPartialNote：三角没贡献、保留选中）', p && p.idle.join() === 'triangle' && p.others.join() === 'square' && s.families.includes('triangle'));
  const srv = S.parseSelection({ families: ['triangle', 'square'], modes: ['bomb'] });
  check('③ 服务端同一份选择展开成同样四张', srv.ids && srv.ids.slice().sort().join() === ['square:bomb3', 'square:bomb3:pro', 'squareDiamond:bomb3', 'squareDiamond:bomb3:pro'].sort().join(), JSON.stringify(srv));
}

// ── ④ 缓存键 ─────────────────────────────────────────────────────────────────────
{
  const k1 = C.selectionKey({ families: [], tiers: [], modes: [] });
  const k2 = C.selectionKey({ families: ['triangle', 'square', 'circle'], tiers: ['pro', 'normal'], modes: [...C.LB_MODES].reverse() });
  const k3 = C.selectionKey({ families: ['circle', 'square'], tiers: [], modes: ['flip', 'base'] });
  const k4 = C.selectionKey({ families: ['square', 'circle'], tiers: [], modes: ['base', 'flip'] });
  check('④ []、全集、乱序：同一个缓存键', k1 === k2 && k3 === k4, `${k1} / ${k2} · ${k3} / ${k4}`);
  const a = S.parseSelection({ families: ['circle', 'square'], modes: ['flip', 'base'] });
  const b = S.parseSelection({ families: ['square', 'circle'], modes: ['base', 'flip'], tiers: ['normal', 'pro'] });
  check('④ 服务端规范化之后同一个键、同一组榜', a.key === b.key && a.ids.join() === b.ids.join() && a.key === k3, `${a.key} / ${b.key} / ${k3}`);
  check('④ 服务端：空交集回 empty，不认识的值、太长、不是数组回 mode',
    S.parseSelection({ families: ['triangle'], modes: ['timed'] }).error === 'empty' &&
    S.parseSelection({ families: ['hex'] }).error === 'mode' &&
    S.parseSelection({ tiers: ['normal', 'pro', 'pro'] }).error === 'mode' &&
    S.parseSelection({ modes: 'base' }).error === 'mode');
}

console.log(`\n${passes} 条过（穷举 ${states} 种状态、${taps} 次点击）`);
console.log(fail ? `${fail} 项没过` : '全部通过');
process.exit(fail ? 1 : 0);

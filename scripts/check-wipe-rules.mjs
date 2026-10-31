/**
 * 换计分规则时的开机清档：每一个退下来的版本都清，老虎机那一本、步步为营那一本一起（10-15 补充 S8，L-8 ③）。
 *
 *   node scripts/check-wipe-rules.mjs
 *
 * 纯 node：esbuild 打包 src/engine/wipeOldRules.ts（连 runKey / persistence / scoring），给一个假的 localStorage。
 *
 * 为什么要它（已复现）：模拟把 SCORING_RULES_VERSION 改成 ero2、本机放 7 本 `_ero1` 存档（含 `_slot_ero1`、步步为营
 * 那一本），跑一遍开机清档——一本都没清，哨兵还记成「本来就没东西可清」，记录页不会说「战绩从这里重新开始」。原因：
 * wipeOldRules 只枚举《侵蚀阶梯》之前那一套不带版本号的键，也没传步步为营的版本号。
 *
 * 量的是：history = ['ero1', 'ero2']（ero2 是现行的）跑一遍——ero1 那 7 本全清、ero2 那 7 本一本不碰、哨兵记「清过」
 * （wiped）；现行那 7 本单独再跑一遍——一本不动（现行版本的键不许误删）。撤掉改法，第一节红。
 *
 * 10-31 方案推14 Z-B01：ero2 真的上线了。尺子不再写死「现行是 ero1」，改成「现行 = SCORING_RULES_HISTORY 的最后一个」；
 * 旧那 7 本用 suffixAt('ero1', …) 拼。③（新）：小红书那一端清档要传它建了的全部棋盘（ALL_GAMES）——原先只传方块、小球
 * 两副，升 ero2 时另外四副的 _ero1 旧局清不掉；反面尺子把那一句换回两副的写法，③ 要红。
 */
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const dir = mkdtempSync(join(tmpdir(), 'wipe-rules-'));
const entry = join(dir, 'entry.ts');
writeFileSync(entry, `
  export { wipeOldRules } from '${join(ROOT, 'src/engine/wipeOldRules.ts')}';
  export { suffixFor, suffixAt } from '${join(ROOT, 'src/engine/runKey.ts')}';
  export { wasWiped, wipeKeyFor } from '${join(ROOT, 'src/engine/persistence.ts')}';
  export { SCORING_RULES_VERSION, SCORING_RULES_HISTORY } from '${join(ROOT, 'src/engine/scoring.ts')}';
`);
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'neutral', outfile: join(dir, 'w.mjs'), logLevel: 'silent' });

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
const W = await import(pathToFileURL(join(dir, 'w.mjs')).href);
rmSync(dir, { recursive: true, force: true });

const BEST = 'sugarcube_best';
const CUR = W.SCORING_RULES_VERSION;
/**
 * 一副棋盘一个版本下的 7 本：基础、计时、炸弹（炸弹计时和它同一本）、无限反转、步步为营、老虎机，外加一本上一版炸弹
 * 规则的归档（_bomb2_<版本>：从云上取回的旧局按它自己那一版落键，见 runKey.ts 的 suffixFor）。
 */
const booksAt = (v) => [
  W.suffixAt(v, 'base'), W.suffixAt(v, 'timed'), W.suffixAt(v, 'bomb'), W.suffixAt(v, 'bomb', { bomb: 2 }),
  W.suffixAt(v, 'flip'), W.suffixAt(v, 'puzzle'), W.suffixAt(v, 'base', { slot: true }),
].map((sfx) => BEST + sfx);
const old = booksAt('ero1');
const cur = [
  W.suffixFor('base'), W.suffixFor('timed'), W.suffixFor('bomb'), W.suffixFor('bomb', { bomb: 2 }),
  W.suffixFor('flip'), W.suffixFor('puzzle'), W.suffixFor('base', { slot: true }),
].map((sfx) => BEST + sfx);
const lay = (keys) => {
  for (const k of keys) {
    store.set(k, '120');
    store.set(k + '::runs', '[{"at":1}]');
  }
};
check('（尺子）现行版本是 SCORING_RULES_HISTORY 的最后一个，而且不是 ero1', CUR === W.SCORING_RULES_HISTORY.at(-1) && CUR !== 'ero1',
  `${CUR} / ${W.SCORING_RULES_HISTORY.join(',')}`);
check('（尺子）旧那七本都带 _ero1、现行那七本都带 _' + CUR + '，各不相同，有老虎机、步步为营、上一版炸弹那三本',
  new Set(old).size === 7 && old.every((k) => k.endsWith('_ero1')) && new Set(cur).size === 7 && cur.every((k) => k.endsWith('_' + CUR))
    && old.some((k) => k.includes('_slot')) && old.some((k) => k.includes('_puzzle')) && old.some((k) => k.includes('_bomb2_')),
  old.map((k) => k.slice(BEST.length)).join(' ') + ' ｜ ' + cur.map((k) => k.slice(BEST.length)).join(' '));

// ① 升版本：ero1 退下来，现行版本不碰
store.clear();
lay(old);
lay(cur);
W.wipeOldRules([BEST], ['ero1', CUR]);
const left = old.filter((k) => store.has(k) || store.has(k + '::runs'));
check('① 升到 ' + CUR + '：ero1 那七本（含老虎机、步步为营）全清', left.length === 0, left.join(' '));
const curKept = cur.filter((k) => store.has(k) && store.has(k + '::runs'));
check('① 现行那七本一本不碰', curKept.length === 7, `${curKept.length} / 7`);
check('① 哨兵记的是「真的清过」（记录页据此说「战绩从这里重新开始」）', W.wasWiped(CUR) && store.get(W.wipeKeyFor(CUR)) === 'wiped',
  String(store.get(W.wipeKeyFor(CUR))));

// ② 只有现行那七本：一本不许动
store.clear();
lay(cur);
W.wipeOldRules([BEST], [CUR]);
const kept = cur.filter((k) => store.has(k) && store.has(k + '::runs'));
check('② 现行版本的七本一本不动', kept.length === 7, `${kept.length} / 7`);
check('② 没东西可清：哨兵记「跑过了」，不记「清过」', store.get(W.wipeKeyFor(CUR)) === '1', String(store.get(W.wipeKeyFor(CUR))));

// ③ 小红书那一端：清档传的是它建了的全部棋盘（ALL_GAMES），不是方块、小球两副
const xhsMain = readFileSync(join(ROOT, 'xhs/src/main.ts'), 'utf8');
const wipeArg = (src) => {
  const m = /\nwipeOldRules\(([^;]*)\);/.exec(src);
  return m ? m[1] : null;
};
const argOk = (src) => {
  const a = wipeArg(src);
  return a !== null && /\bALL_GAMES\b/.test(a);
};
check('③ 小红书 wipeOldRules( 那一句的参数里有 ALL_GAMES', argOk(xhsMain), String(wipeArg(xhsMain)));
const twoBoards = xhsMain.replace(/\nwipeOldRules\([^;]*\);/, '\nwipeOldRules([squareGame.card.bestKey, circleGame.card.bestKey]);');
check('③（反面尺子）换回两副棋盘的写法，③ 红', twoBoards !== xhsMain && !argOk(twoBoards));

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

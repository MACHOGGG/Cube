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
 * 量的是：history = ['ero1', 'ero2']（ero2 是现行的）跑一遍——7 本全清、哨兵记「清过」（wiped）；history = ['ero1']
 * 跑一遍——一本不动（现行版本的键不许误删）。撤掉改法，第一节红。
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  export { suffixFor } from '${join(ROOT, 'src/engine/runKey.ts')}';
  export { wasWiped, wipeKeyFor } from '${join(ROOT, 'src/engine/persistence.ts')}';
  export { SCORING_RULES_VERSION } from '${join(ROOT, 'src/engine/scoring.ts')}';
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
/**
 * ero1 下一副棋盘的 7 本：基础、计时、炸弹（炸弹计时和它同一本）、无限反转、步步为营、老虎机，外加一本上一版炸弹
 * 规则的归档（_bomb2_ero1：从云上取回的旧局按它自己那一版落键，见 runKey.ts 的 suffixFor）。
 */
const books = [
  W.suffixFor('base'), W.suffixFor('timed'), W.suffixFor('bomb'), W.suffixFor('bomb', { bomb: 2 }),
  W.suffixFor('flip'), W.suffixFor('puzzle'), W.suffixFor('base', { slot: true }),
].map((sfx) => BEST + sfx);
const lay = () => {
  store.clear();
  for (const k of books) {
    store.set(k, '120');
    store.set(k + '::runs', '[{"at":1}]');
  }
};
check('（尺子）现行版本是 ero1，七本键都带 _ero1、各不相同，有老虎机、步步为营、上一版炸弹那三本',
  W.SCORING_RULES_VERSION === 'ero1' && new Set(books).size === 7 && books.every((k) => k.endsWith('_ero1'))
    && books.some((k) => k.includes('_slot')) && books.some((k) => k.includes('_puzzle')) && books.some((k) => k.includes('_bomb2_')),
  books.map((k) => k.slice(BEST.length)).join(' '));

// ① 下一次升版本：ero1 退下来，ero2 现行
lay();
W.wipeOldRules([BEST], ['ero1', 'ero2']);
const left = books.filter((k) => store.has(k) || store.has(k + '::runs'));
check('① 升到 ero2：ero1 那七本（含老虎机、步步为营）全清', left.length === 0, left.join(' '));
check('① 哨兵记的是「真的清过」（记录页据此说「战绩从这里重新开始」）', W.wasWiped('ero2') && store.get(W.wipeKeyFor('ero2')) === 'wiped',
  String(store.get(W.wipeKeyFor('ero2'))));

// ② 现行就是 ero1：一本不许动
lay();
W.wipeOldRules([BEST], ['ero1']);
const kept = books.filter((k) => store.has(k) && store.has(k + '::runs'));
check('② 现行版本的七本一本不动', kept.length === 7, `${kept.length} / 7`);
check('② 没东西可清：哨兵记「跑过了」，不记「清过」', store.get(W.wipeKeyFor('ero1')) === '1', String(store.get(W.wipeKeyFor('ero1'))));

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

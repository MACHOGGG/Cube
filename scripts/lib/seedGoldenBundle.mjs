/**
 * check-seed-golden 的那一包（10-15 补充 S1）：把 `src` 里发牌那条路打成一份 node 能跑的东西，**只在这一包里**
 * 插几个只读的口子（源码和产物一个字不动）：
 *
 *   · 六个棋盘文件：`let grid: Tile[][] = [];` 后面露出 grid / isBlank / liveBomb（发完牌读整副盘面）；
 *   · engine/gameController.ts：`createGameController` 外面包一层，记下 refs 和 hooks（老虎机的目标、种子）；
 *   · engine/rng.ts：数发牌那一串取了几个数（种一次清零；教学预热借的那一串不算，另数它借过几回）。
 *
 * **认不出这些写法时当场抛错「门要跟着改」**，不静默少量一副：以后 P6、S10、P19 改到这几处时，改这儿的正则，
 * **金标值一字不改**。
 *
 * 另外两件 vite 会做、esbuild 不会做的事也在这儿补上：`?raw` / `?inline` 的导入读成字符串；
 * ui/customIcons.ts 的 `import.meta.glob` 在打包时读成一张表（和 vite 产物里那张一样）。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';

export const BOARD_FILES = ['square', 'circle', 'circleHex', 'circleSeven', 'squareDiamond', 'triangle'];

const must = (file, ok, what) => {
  if (!ok) throw new Error(`门要跟着改：${file} 里认不出「${what}」（check-seed-golden 只在自己那一包里插口子，见 scripts/lib/seedGoldenBundle.mjs）`);
};

function tapBoard(file, src) {
  const anchor = 'let grid: Tile[][] = [];';
  must(file, src.split(anchor).length === 2, anchor);
  must(file, /function isBlank\(t: Tile\): boolean \{/.test(src), 'function isBlank(t: Tile): boolean');
  const hasBomb = /const liveBomb = \(t: Tile\) =>/.test(src);
  const id = /\n\s+id: '([A-Za-z]+)',\n/.exec(src)?.[1];
  must(file, !!id, "card 里的 id: '…'");
  const tap =
    `\n      (globalThis as any).__SG?.board({ id: '${id}', grid: () => grid, isBlank: (t: Tile) => isBlank(t), ` +
    `liveBomb: ${hasBomb ? '(t: Tile) => liveBomb(t)' : 'null'} });`;
  return src.replace(anchor, anchor + tap);
}

function tapController(file, src) {
  const sig = 'export function createGameController(refs: ShellRefs, hooks: GameControllerHooks): GameController {';
  must(file, src.split(sig).length === 2, sig);
  return (
    src.replace(sig, 'function __sgInnerController(refs: ShellRefs, hooks: GameControllerHooks): GameController {') +
    '\nexport function createGameController(refs: ShellRefs, hooks: GameControllerHooks): GameController {\n' +
    '  (globalThis as any).__SG?.controller(refs, hooks);\n  return __sgInnerController(refs, hooks);\n}\n'
  );
}

function tapRng(file, src) {
  const gen = 'function mulberry32(a: number): () => number {\n  return () => {';
  const seed = 'export function seedRandom(seed: string): void {\n  source = mulberry32(hash32(seed));';
  const save = '  const saved = source;\n';
  const back = '    source = saved;\n';
  for (const w of [gen, seed, save, back]) must(file, src.split(w).length === 2, w.trim().split('\n')[0]);
  const G = '(globalThis as any).__SG';
  return src
    .replace(gen, gen + `\n    if (${G} && !${G}.inScratch) ${G}.draws++;`)
    .replace(seed, seed + `\n  if (${G}) ${G}.draws = 0;`)
    .replace(save, save + `  if (${G}) { ${G}.inScratch++; ${G}.scratchRuns++; }\n`)
    .replace(back, back + `    if (${G}) ${G}.inScratch--;\n`);
}

function globTable(file, src) {
  const re = /import\.meta\.glob\(\s*'([^']+)'\s*,\s*\{[^}]*\}\s*\)/g;
  let n = 0;
  const out = src.replace(re, (_, pattern) => {
    n++;
    const dir = resolve(dirname(file), dirname(pattern));
    const ext = pattern.slice(pattern.lastIndexOf('*') + 1);
    const table = {};
    for (const f of readdirSync(dir).filter((x) => x.endsWith(ext)).sort()) {
      table['./' + relative(dirname(file), join(dir, f)).replace(/\\/g, '/').replace(/^\.\//, '')] = readFileSync(join(dir, f), 'utf8');
    }
    // vite 的键是写在 glob 里的那种相对路径（'../assets/icons/x.svg'）
    const fixed = {};
    for (const [k, v] of Object.entries(table)) fixed[k.replace(/^\.\/(\.\.\/)/, '$1')] = v;
    return JSON.stringify(fixed);
  });
  must(file, n > 0, 'import.meta.glob(…)');
  return out;
}

/**
 * 打一包，返回它的路径。`root` 是仓库根（门在 scripts/ 下，传 resolve(here, '..')）。
 * `mutate(file, src)`（可选）给门自己验证「故意改坏发牌，门要红」用：在插口子之前改一遍源码。
 */
export async function bundleSeedGolden(root, { mutate } = {}) {
  const outdir = mkdtempSync(join(tmpdir(), 'seed-golden-'));
  const outfile = join(outdir, 'bundle.mjs');
  const entry = `
    import { createSquareGame } from './src/shapes/square';
    import { createCircleGame } from './src/shapes/circle';
    import { createCircleHexGame } from './src/shapes/circleHex';
    import { createSquareDiamondGame } from './src/shapes/squareDiamond';
    import { createTriangleGame } from './src/shapes/triangle';
    import { createCircleSevenGame } from './src/shapes/circleSeven';
    import { registerCards } from './src/shapes/registry';
    import { seedGameOf } from './src/engine/seedDeal';
    import * as SC from './src/engine/seedCode';
    // ⑥⑧ 拨这几个设置看发牌变不变（都是「这个人要不要」的全站设置，开局前拨好）
    import { setPro } from './src/engine/proMode';
    // ⑧ 照这一圈核 Pro 局每一枚的反面（10-15 补充 S10）
    import { proCycle, proNext } from './src/engine/proCycle';
    import { setColorblind } from './src/engine/palettePref';
    import { setTheme } from './src/engine/themePref';
    // 和 main.ts 一样：先建六副、再把名片交给那张表（registry.ts 文件头说了为什么注册在外面）。
    export const games = [
      createSquareGame(), createCircleGame(), createCircleHexGame(),
      createSquareDiamondGame(), createTriangleGame(), createCircleSevenGame(),
    ];
    registerCards(games.map((g) => g.card));
    export { seedGameOf, SC, setPro, setColorblind, setTheme, proCycle, proNext };
  `;
  const srcDir = join(root, 'src');
  await build({
    stdin: { contents: entry, resolveDir: root, loader: 'ts', sourcefile: 'seed-golden-entry.ts' },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    outfile,
    logLevel: 'silent',
    define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true', 'import.meta.env.VITE_GA_ID': '""', 'import.meta.env.MODE': '"production"' },
    plugins: [
      {
        name: 'seed-golden',
        setup(b) {
          b.onResolve({ filter: /\?(raw|inline)$/ }, (a) => ({ path: resolve(a.resolveDir, a.path.replace(/\?(raw|inline)$/, '')), namespace: 'sg-text' }));
          b.onLoad({ filter: /.*/, namespace: 'sg-text' }, (a) => ({ contents: readFileSync(a.path, 'utf8'), loader: 'text' }));
          b.onLoad({ filter: /\.ts$/ }, (a) => {
            if (!a.path.startsWith(srcDir)) return undefined;
            const rel = relative(root, a.path).replace(/\\/g, '/');
            let src = readFileSync(a.path, 'utf8');
            if (mutate) src = mutate(rel, src);
            const name = rel.replace(/^src\/shapes\//, '').replace(/\.ts$/, '');
            if (rel.startsWith('src/shapes/') && BOARD_FILES.includes(name)) src = tapBoard(rel, src);
            else if (rel === 'src/engine/gameController.ts') src = tapController(rel, src);
            else if (rel === 'src/engine/rng.ts') src = tapRng(rel, src);
            if (/import\.meta\.glob\(/.test(src.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, ''))) src = globTable(a.path, src);
            return { contents: src, loader: 'ts' };
          });
        },
      },
    ],
  });
  return outfile;
}

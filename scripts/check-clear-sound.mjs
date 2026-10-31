/**
 * 整线星星消除那一声（10-31 方案推14 Z-B26，站长 10-29 晚；纯 node，进 ci.yml check）。
 *
 *   node scripts/check-clear-sound.mjs
 *
 * 量的是：
 *   ① package.json：cuelume 是 ^0.2.2、cuelume-next 正好是 npm:cuelume@0.2.8；锁文件里 node_modules/cuelume 是 0.2.x 且
 *      < 0.2.8，node_modules/cuelume-next 是 0.2.8；
 *   ② src/、xhs/src/ 里只有 src/engine/juice.ts import cuelume-next；
 *   ③ esbuild 打包 juice.ts，把 cuelume、cuelume-next 换成记账替身：playLineClear() 只记到 next 的 play('ready', {volume})、
 *      volume 等于源码里 LINE_CLEAR.vol（现读，不写死 0.8）且在 0–1 之间、不碰 0.2.2；playClear() 只记到 0.2.2 的 droplet；
 *      setSoundOn(false) 之后两者都不记、且 next 的 setEnabled(false) 被叫过；unlockAudio() 两套各叫一次；
 *   ④ 读 gameController.ts：bigMoment 里 'line' 那一支 playLineClear() 恰好 1 处、'celebrate' 那一支 playClear() 恰好 1 处；
 *      整线消除那一行传 'line'、老虎机降到底那一行传 'celebrate'；
 *   ⑤ 反面尺子：把替身里的开关闸（playLineClear 的 if (!sound) return）去掉、把 'line' 那一支换回 playClear()，各自要红。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installFakeDom } from './lib/fakeDom.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// ── ① 依赖 ───────────────────────────────────────────────────────────────────────
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const dep = pkg.dependencies || {};
check('① package.json：cuelume 是 ^0.2.2', dep.cuelume === '^0.2.2', String(dep.cuelume));
check('① package.json：cuelume-next 正好是 npm:cuelume@0.2.8（不带 ^）', dep['cuelume-next'] === 'npm:cuelume@0.2.8', String(dep['cuelume-next']));
const lv = (k) => lock.packages?.[k]?.version ?? '';
const old = lv('node_modules/cuelume');
const [, , patch] = old.split('.').map(Number);
check('① 锁文件：node_modules/cuelume 是 0.2.x、比 0.2.8 旧', old.startsWith('0.2.') && patch < 8, old);
check('① 锁文件：node_modules/cuelume-next 是 0.2.8（别名指向 cuelume）', lv('node_modules/cuelume-next') === '0.2.8' && lock.packages['node_modules/cuelume-next']?.name === 'cuelume', lv('node_modules/cuelume-next'));

// ── ② 只有 juice.ts 能 import cuelume-next ───────────────────────────────────────
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : /\.(ts|js|mjs)$/.test(f) ? [p] : [];
});
const importers = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'xhs/src'))]
  .filter((p) => /from\s+['"]cuelume-next['"]|import\(\s*['"]cuelume-next['"]\s*\)/.test(readFileSync(p, 'utf8')))
  .map((p) => relative(ROOT, p).replace(/\\/g, '/'));
check('② src/、xhs/src/ 里只有 src/engine/juice.ts import cuelume-next', importers.join() === 'src/engine/juice.ts', importers.join() || '一个都没有');

// ── ③ 打包 juice.ts，两套都换成记账替身 ──────────────────────────────────────────
installFakeDom({ storage: {} });
const juiceSrc = read('src/engine/juice.ts');
const volMatch = /export const LINE_CLEAR = \{ name: 'ready', vol: ([0-9.]+) \} as const;/.exec(juiceSrc);
check('（尺子）读到了 LINE_CLEAR 那一行（名字 ready、音量是一个数）', Boolean(volMatch), volMatch ? volMatch[1] : '没找到');
const VOL = volMatch ? Number(volMatch[1]) : NaN;

const STUB = (tag) => `
  const log = (globalThis.__CUE ??= []);
  export function play(name, opts) { log.push({ lib: '${tag}', fn: 'play', name, volume: opts?.volume }); }
  export function setEnabled(v) { log.push({ lib: '${tag}', fn: 'setEnabled', v }); }
  export function unlock() { log.push({ lib: '${tag}', fn: 'unlock' }); return Promise.resolve(true); }
  export function setVolume() {} export function setTheme() {} export function press() {} export function release() {} export function bind() {}
`;
async function bundleJuice(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'clear-sound-'));
  const out = join(dir, 'j.mjs');
  await build({
    stdin: { contents: `export * from './src/engine/juice';`, resolveDir: ROOT, loader: 'ts' },
    bundle: true, format: 'esm', platform: 'browser', outfile: out, logLevel: 'silent',
    plugins: [{
      name: 'cue-stubs',
      setup(b) {
        b.onResolve({ filter: /^cuelume(-next)?$/ }, (a) => ({ path: a.path, namespace: 'cue-stub' }));
        b.onLoad({ filter: /.*/, namespace: 'cue-stub' }, (a) => ({ contents: STUB(a.path === 'cuelume' ? 'v022' : 'v028'), loader: 'js' }));
        b.onLoad({ filter: /src\/engine\/juice\.ts$/ }, (a) => ({ contents: mutate ? mutate(readFileSync(a.path, 'utf8')) : readFileSync(a.path, 'utf8'), loader: 'ts' }));
      },
    }],
  });
  const mod = await import(pathToFileURL(out).href + '?v=' + Math.random());
  rmSync(dir, { recursive: true, force: true });
  return mod;
}

/** 一包跑一遍：回四条结论（门和尺子共用）。 */
async function behave(J) {
  const log = (globalThis.__CUE ??= []);
  log.length = 0;
  J.setSoundOn(true);
  log.length = 0;
  J.playLineClear();
  const line = [...log];
  log.length = 0;
  J.playClear();
  const drop = [...log];
  log.length = 0;
  J.setSoundOn(false);
  const disable = [...log];
  log.length = 0;
  J.playLineClear();
  J.playClear();
  const muted = [...log];
  J.setSoundOn(true);
  log.length = 0;
  J.unlockAudio();
  await Promise.resolve();
  const unlocks = [...log];
  return {
    lineOk: line.length === 1 && line[0].lib === 'v028' && line[0].fn === 'play' && line[0].name === 'ready' && line[0].volume === VOL && VOL >= 0 && VOL <= 1,
    dropOk: drop.length === 1 && drop[0].lib === 'v022' && drop[0].name === 'droplet',
    muteOk: muted.length === 0 && disable.some((e) => e.lib === 'v028' && e.fn === 'setEnabled' && e.v === false),
    unlockOk: unlocks.filter((e) => e.lib === 'v022' && e.fn === 'play' && e.name === 'tick').length === 1 && unlocks.filter((e) => e.lib === 'v028' && e.fn === 'unlock').length === 1,
    dump: { line, drop, disable, muted, unlocks },
  };
}
const J = await bundleJuice();
const r = await behave(J);
check(`③ playLineClear()：只记到 0.2.8 的 play('ready', { volume: ${VOL} })，不碰 0.2.2`, r.lineOk, JSON.stringify(r.dump.line));
check('③ playClear()：只记到 0.2.2 的 droplet（老虎机降到底那一下）', r.dropOk, JSON.stringify(r.dump.drop));
check('③ setSoundOn(false)：0.2.8 的 setEnabled(false) 被叫过，之后两套一声都不出', r.muteOk, JSON.stringify({ disable: r.dump.disable, muted: r.dump.muted }));
check('③ unlockAudio()：两套各解一次（0.2.2 的 tick、0.2.8 的 unlock）', r.unlockOk, JSON.stringify(r.dump.unlocks));

// ── ④ 控制器那两支 ───────────────────────────────────────────────────────────────
const gc = read('src/engine/gameController.ts');
const big = /function bigMoment\(originCell: Cell \| undefined, kind: 'line' \| 'celebrate'\): void \{[\s\S]*?\n  \}/.exec(gc)?.[0] ?? '';
check('（尺子）切出了 bigMoment(originCell, kind)', big.length > 100, `${big.length} 字`);
const branchOk = (src) => /if \(kind === 'line'\) playLineClear\(\);\s*else playClear\(\);/.test(src) &&
  (src.match(/playLineClear\(\)/g) || []).length === 1 && (src.match(/playClear\(\)/g) || []).length === 1;
check("④ bigMoment：'line' 那一支 playLineClear() 恰好 1 处、'celebrate' 那一支 playClear() 恰好 1 处", branchOk(big));
check("④ 整线消除那一行传 'line'、老虎机降到底那一行传 'celebrate'",
  /if \(isBonus\) bigMoment\(s\.lineBonusGroups\[0\]\?\.\[0\], 'line'\);/.test(gc) && /if \(celebrate\(step\.level\)\) bigMoment\(s\.matchGroups\[0\]\?\.\[0\], 'celebrate'\);/.test(gc));
check('④ bigMoment( 一共 3 处（定义＋两处调用）', (gc.match(/bigMoment\(/g) || []).length === 3, String((gc.match(/bigMoment\(/g) || []).length));

// ── ⑤ 反面尺子 ───────────────────────────────────────────────────────────────────
{
  const gate = 'if (!sound) return; // 和 cue() 同一个开关';
  check('（尺子）juice.ts 里那一句开关闸认得出', juiceSrc.split(gate).length === 2);
  const J2 = await bundleJuice((s) => s.replace(gate, ''));
  const r2 = await behave(J2);
  check('⑤ 尺子：去掉 playLineClear 的开关闸，③「关掉之后一声不出」那一条红', !r2.muteOk);
  const swapped = big.replace("if (kind === 'line') playLineClear();", "if (kind === 'line') playClear();");
  check("⑤ 尺子：'line' 那一支换回 playClear()，④ 那一条红", swapped !== big && !branchOk(swapped));
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

/**
 * iOS 包里不装只属于网站的两样：mint.html、xhs/（10-08 方案第五批第 11 条）。
 *
 *   node scripts/check-ios-web.mjs
 *
 * 不开浏览器、不用先构建：在临时目录里搭一份假的 dist/（该有的几样都摆上），交给
 * scripts/build-ios-web.mjs 的 buildIosWeb，看出来的那一份对不对。再读三处接线。零点几秒。
 *
 *   ① 出来的那一份里没有 mint.html、没有 xhs/；
 *   ② 该在的都在：index.html、assets/、icons/、version.json、法务页——少了哪一样，App 里就是白屏或断链；
 *   ③ 网站那一份（假 dist/）一个文件都没少：过滤只发生在复制出来的那一份上；
 *   ④ capacitor.config.ts 的 webDir 是 dist-ios，`npm run ios:sync` 先 build、再出 dist-ios、最后
 *      cap sync（顺序反了，cap sync 拿到的是上一次的那一份）；
 *   ⑤ dist-ios 在 .gitignore 里（构建产物，不进仓库）。
 */
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildIosWeb, IOS_EXCLUDE } from './build-ios-web.mjs';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// ── 一份假的 dist/ ─────────────────────────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'ios-web-'));
const dist = join(tmp, 'dist');
const out = join(tmp, 'dist-ios');
const FILES = [
  'index.html', 'favicon.svg', 'version.json', 'privacy.html', 'mint.html',
  'assets/index-abc.js', 'assets/index-abc.css', 'icons/app/tower-rgb-192.png', 'icons/app/tower-rgb.webmanifest',
  'xhs/app.js', 'xhs/index.html',
];
for (const f of FILES) {
  mkdirSync(join(dist, f, '..'), { recursive: true });
  writeFileSync(join(dist, f), f);
}
const list = (dir) => {
  const walk = (d, pre = '') => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name), `${pre}${e.name}/`) : [`${pre}${e.name}`]);
  return existsSync(dir) ? walk(dir).sort() : [];
};

const removed = buildIosWeb(dist, out);
const got = list(out);
check('（尺子）出来了一份 dist-ios', got.length > 0, `${got.length} 个文件`);
check('① 没有 mint.html、没有 xhs/', !got.includes('mint.html') && !got.some((f) => f.startsWith('xhs/')),
  got.filter((f) => f === 'mint.html' || f.startsWith('xhs/')).join(' ') || `去掉了 ${removed.join('、')}`);
const need = FILES.filter((f) => f !== 'mint.html' && !f.startsWith('xhs/'));
const missing = need.filter((f) => !got.includes(f));
check('② 该在的都在（index.html、assets、icons、version.json、法务页）', missing.length === 0, missing.join(' ') || `${need.length} 个`);
check('③ 网站那一份一个文件都没少', list(dist).join() === [...FILES].sort().join(), `${list(dist).length}/${FILES.length}`);
check('（尺子）要去掉的就是方案说的那两样', IOS_EXCLUDE.slice().sort().join() === 'mint.html,xhs', IOS_EXCLUDE.join(' '));
rmSync(tmp, { recursive: true, force: true });

// ── 接线 ───────────────────────────────────────────────────────────────────
const cap = read('capacitor.config.ts');
check('④ capacitor.config.ts 的 webDir 是 dist-ios', /webDir: 'dist-ios'/.test(cap), (cap.match(/webDir: '[^']*'/) || ['没有 webDir'])[0]);
const pkg = JSON.parse(read('package.json'));
const sync = String(pkg.scripts?.['ios:sync'] || '');
const order = ['npm run build', 'node scripts/build-ios-web.mjs', 'cap sync ios'].map((s) => sync.indexOf(s));
check('④ npm run ios:sync：先 build、再出 dist-ios、最后 cap sync', order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2], sync);
check('⑤ dist-ios 在 .gitignore 里', /^dist-ios\/?$/m.test(read('.gitignore')));

console.log(fail ? `\n${fail} 条红` : '\n全绿');
process.exit(fail ? 1 : 0);

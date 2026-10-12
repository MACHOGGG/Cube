/**
 * 出一张 `/version.json`：这一份构建的「构建哈希」，加上更新说明的编号和那一句。
 *
 *   node scripts/build-version.mjs          （跟在 npm run build 后面自动跑）
 *   node scripts/build-version.mjs <目录>    （门用：对别的目录算、写进那个目录）
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 它解决的是哪个毛病
 *
 * 这是个单页应用：进来之后就不再整页跳转（换语言、换页面全是原地重画）。所以一台开着不
 * 关的手机——锁屏放进口袋、第二天再划开——跑的还是**上一次打开时下载的那一份**，而那一份
 * 可能已经是好几版之前的了。症状不是白屏：是他手里那一版和服务端已经对不上（接口回的字
 * 段换了、法务文本改了、存档键跟着规则版本走了），而屏幕上什么都不说。
 *
 * 所以要有一个「现在线上是哪一版」的地方可以问：
 *
 *     { "sha": "<构建哈希>", "release": 3, "note": { "zhHans": "新增：每日挑战排名", … } }
 *
 * ── sha 为什么是构建哈希，不是提交号（10-11 方案 B-9） ─────────────────────
 *
 * 原先写的是提交号（VERCEL_GIT_COMMIT_SHA）。可提交号每一推都变，哪怕那一推只改了 CLAUDE.md、一个字
 * 节都没进 dist——a2252da、da9c2b0、68c1f9a 三推都是这样，玩家照样被叫去「刷新」，刷出来的是同一份。
 * 现在对 dist 里**除 version.json 以外的每一个文件**（相对路径 + 内容）算一个 sha256：只改文档、只改
 * 门的那一推，dist 一个字节不变，这个数也不变，就不提示。
 *
 * 字段名照旧叫 `sha`：还开着的旧页面（10-11 之前那几版）只认这一个字段、只比「变没变」，名字一换它们就
 * 永远问不出新版本了。
 *
 * 只认路径和内容，不认修改时间、不认 dist 放在哪个目录：同一份源码在 Vercel 上、在本地各构建一次，算出来
 * 是同一个数（门 check-new-version ⑨ 拿一份拷贝换个目录、改个时间再算一遍）。
 *
 * ── release / note ────────────────────────────────────────────────────────
 *
 * 从 src/changelog.ts 读（它是 TypeScript，照 build-legal.mjs 的办法用 esbuild 打成一份临时的 .mjs 再
 * import）。`release` 是人手递增的编号；`note` 是这一号那一句的四种语言——没写那一条就不带 `note`，卡上
 * 说通用那一句。说明是写给**旧页面**看的：它比较的是线上的 `release` 和自己构建时的那一号。
 */
import esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = process.argv[2] ? resolve(process.argv[2]) : join(root, 'dist');
const OUT_NAME = 'version.json';

/** dist 下每一个文件（不含 version.json 自己），相对路径用 `/` 分隔、按字典序排好——换台机器顺序也一样。 */
function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile()) out.push(relative(dir, p).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.filter((f) => f !== OUT_NAME).sort();
}

/** 构建哈希：每个文件「路径 \0 长度 \0 内容」依次喂进去。长度隔开，两个文件的边界就不会被内容蒙混。 */
function buildHash(dir) {
  const h = createHash('sha256');
  for (const f of listFiles(dir)) {
    const body = readFileSync(join(dir, f));
    h.update(f);
    h.update('\0');
    h.update(String(body.length));
    h.update('\0');
    h.update(body);
  }
  return h.digest('hex');
}

async function readChangelog() {
  const tmp = mkdtempSync(join(tmpdir(), 'slides-changelog-'));
  const bundled = join(tmp, 'changelog.mjs');
  try {
    esbuild.buildSync({
      entryPoints: [join(root, 'src', 'changelog.ts')],
      bundle: true,
      format: 'esm',
      platform: 'node',
      outfile: bundled,
      logLevel: 'silent',
    });
    return await import(pathToFileURL(bundled).href);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (!existsSync(dist)) mkdirSync(dist, { recursive: true });
const { RELEASE, CHANGELOG } = await readChangelog();
const sha = buildHash(dist);
const doc = { sha, release: RELEASE };
if (CHANGELOG[RELEASE]) doc.note = CHANGELOG[RELEASE];
writeFileSync(join(dist, OUT_NAME), JSON.stringify(doc) + '\n');
console.log(`版本号写好了：/version.json ← 构建 ${sha.slice(0, 12)} · 更新说明第 ${RELEASE} 号${doc.note ? '' : '（没有说明，卡上说通用那一句）'}`);

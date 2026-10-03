/**
 * 出一张 `/version.json`，里头只有这一次构建的提交号。
 *
 *   node scripts/build-version.mjs        （跟在 npm run build 后面自动跑）
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 它解决的是哪个毛病
 *
 * 这是个单页应用：进来之后就不再整页跳转（换语言、换页面全是原地重画）。所以一台开着不
 * 关的手机——锁屏放进口袋、第二天再划开——跑的还是**上一次打开时下载的那一份**，而那一份
 * 可能已经是好几版之前的了。症状不是白屏：是他手里那一版和服务端已经对不上（接口回的字
 * 段换了、法务文本改了、存档键跟着规则版本走了），而屏幕上什么都不说。
 *
 * 所以要有一个「现在线上是哪一版」的地方可以问。一张小 JSON，一个字段：
 *
 *     { "sha": "9f3c…" }
 *
 * 为什么是提交号而不是版本号：这个仓库没有版本号（没有 semver、不发 tag），而 Vercel 每
 * 次部署都把提交号放进 `VERCEL_GIT_COMMIT_SHA`——那正是「线上这一份是哪一份」最准的答案，
 * 而且不用任何人记得去改。
 *
 * ⚠️ **本地构建拿不到那个环境变量**，所以退到 `git rev-parse HEAD`；连 git 都没有（打包
 * 进别的壳里）就写 `dev`。三种都写得出一个确定的串——写不出来才是麻烦：客户端那头会把
 * 「读不到」当成「没有新版本」（见 engine/newVersion.ts），于是这一整条悄悄失效。
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

function sha() {
  const fromVercel = String(process.env.VERCEL_GIT_COMMIT_SHA || '').trim();
  if (fromVercel) return fromVercel;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
  } catch {
    return 'dev';
  }
}

if (!existsSync(dist)) mkdirSync(dist, { recursive: true });
const out = join(dist, 'version.json');
writeFileSync(out, JSON.stringify({ sha: sha() }) + '\n');
console.log('版本号写好了：/version.json ←', sha().slice(0, 12));

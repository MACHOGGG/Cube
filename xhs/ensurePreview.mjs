/**
 * 「我读的这份 `xhs/preview.html` 是新的吗？」——读它的那四道门各自在开头调一次。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么非有这个不可
 *
 * `xhs/preview.html` 是**产物**，而且在 .gitignore 里，从来不提交。生成它的是
 * `node xhs/preview.mjs`（前面还要 `npm run build:xhs` 出包）——而读它的四道门
 * （check-oldcss / check-oldkernel / check-story / check-vsweb）**一道都不会自己
 * 重出，也不检查它是不是过期**。
 *
 * 于是最容易发生的一幕（CLAUDE.md 里把它记成「跑门时的四个坑」之一）：改完
 * `xhs/src/baseline.css` 只跑了 `npm run build:xhs`，工作区里躺着的 preview.html
 * 还是**上一次**那一份。打开一看「改动没生效」，其实 `dist/app.js` 里早就有了；
 * 更糟的是那四道门于是全在量**旧样式**——全绿，而且是假绿。
 *
 * 为什么是自动重出，而不是报错退出：这个文件从不提交，门自己保证它是新的**没有
 * 任何副作用**（不会掩盖「忘了提交」这类问题）；报错退出只会让人多敲一条命令，
 * 而那条命令本来就该由门自己来敲。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const PAGE = join(here, 'preview.html');

/**
 * 预览页是从这些东西生出来的。少列一样，就是给「改了它却没重出」留一个洞。
 *
 * `xhs/src/` 和 `src/` 都要走：小红书那一版复用 `src/`，只是外面套了一层降级
 * （xhs/vite.config.ts 的 SWAP）。两个生成脚本本身也算——改了出包或出预览的做法，
 * 旧的那一份同样过期了。
 */
const INPUTS = ['src', 'xhs/src', 'xhs/polyfills.js', 'xhs/build.mjs', 'xhs/preview.mjs', 'xhs/vite.config.ts'];

/** 一棵树里最新的那个改动时刻（目录本身的 mtime 不算数——它只记「加没加文件」）。 */
function newest(path) {
  if (!existsSync(path)) return 0;
  const st = statSync(path);
  if (!st.isDirectory()) return st.mtimeMs;
  let max = 0;
  for (const name of readdirSync(path)) {
    max = Math.max(max, newest(join(path, name)));
  }
  return max;
}

/**
 * 预览页不是最新的就重出一次（出包和出预览两步串在 `npm run preview:xhs` 里）。
 *
 * 回 true 表示真的重出过——调用方不用管，它只是让那一行输出说得清楚。
 */
export function ensurePreview() {
  const src = Math.max(...INPUTS.map((p) => newest(join(root, p))));
  const page = existsSync(PAGE) ? statSync(PAGE).mtimeMs : 0;
  if (page > src) return false;
  const why = page === 0 ? 'xhs/preview.html 还没生成过' : 'xhs/preview.html 比源码旧';
  const t0 = Date.now();
  // stdio 'inherit'：出包那两步自己会打印体积和门禁结果，那些话该照常露出来。
  // npm 在 Windows 上是 .cmd，所以走 shell——这个仓库只在 mac/Linux 上跑，
  // 但写死 'npm' 不带 shell 在别处会莫名其妙地「找不到命令」。
  execFileSync('npm', ['run', 'preview:xhs'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  console.log(`（${why}，已重出，用了 ${((Date.now() - t0) / 1000).toFixed(1)} 秒）\n`);
  return true;
}

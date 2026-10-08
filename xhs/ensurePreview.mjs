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
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 两道门同时起跑：一把锁（xhs/.preview.lock）
 *
 * 2026-10-08 撞到过一次：预览页是旧的，并行起跑 check-oldkernel 和 check-vsweb，两个
 * 进程同时跑 `npm run preview:xhs`，往同一个 xhs/dist/ 里写。xhs/build.mjs 第 2 步读
 * index.html 时，后到的那个读到的是先到的那个**已经改过**的一份，于是又补了一行
 * `<script src="./app.js">`——两行；第 2.5 步把补丁头拼到 app.js 前面，也拼了两遍。这两
 * 份坏掉的产物随后被复制进 public/xhs/（网站上的 /xhs/）、打进 slides-minitool.zip（传
 * Builder Hub 的就是它）。两道门照样全绿，没有任何东西报错——是看到 git status 里
 * public/xhs/index.html 莫名变了才发现的。
 *
 * 所以重出那一段先拿锁：拿不到就等（另一道门正在重出），拿到之后**再判一次**还过不过期
 * ——等锁的那几秒里，先到的那一道多半已经重出完了，这时候直接用它那一份，不再出第二遍。
 * 不过期的门压根不碰锁（绝大多数时候是这样）。
 *
 * 出包那一头另有一道闸（xhs/build.mjs 第 2、2.5 步）：不经过这儿、直接并行跑两次
 * `npm run build:xhs` 的，后到的那一个当场报错退出，不再悄悄出一个坏包。
 */
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readdirSync, readFileSync, statSync, unlinkSync, writeSync } from 'node:fs';
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

/** 预览页为什么要重出；不用重出就是 null。 */
function staleReason() {
  const src = Math.max(...INPUTS.map((p) => newest(join(root, p))));
  const page = existsSync(PAGE) ? statSync(PAGE).mtimeMs : 0;
  if (page > src) return null;
  return page === 0 ? 'xhs/preview.html 还没生成过' : 'xhs/preview.html 比源码旧';
}

const LOCK = join(here, '.preview.lock');
/** 等锁最多等多久。重出一次是五到十秒（类型检查 + vite + 出预览），十分钟就是「那边卡死了」。 */
const LOCK_WAIT_MS = 10 * 60 * 1000;

/** 同步地睡一会儿：门都是同步调 ensurePreview 的（顶层一行 `ensurePreview();`），这儿不能 await。 */
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** 锁里记的是谁（拿锁的进程号）。锁不在就是 null。 */
function holder() {
  try {
    return readFileSync(LOCK, 'utf8').trim();
  } catch {
    return null;
  }
}

/** 那个进程还在不在。EPERM 是「在，只是不归我们管」。 */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/**
 * 拿锁。拿不到就等；锁是一个已经不在了的进程留下的（重出到一半按了 Ctrl-C、被 kill 掉——
 * 那时候 finally 来不及跑），就把它清掉再拿。
 *
 * 拿到之后隔 50ms 再看一眼锁里是不是自己的号：两个等锁的人同时清同一把死锁，后清的那一个
 * 可能把先到的人刚建的新锁删掉——那样两边都以为自己拿着锁，正是这把锁要防的那一幕。
 */
function acquire() {
  const t0 = Date.now();
  let told = false;
  for (;;) {
    let fd = -1;
    try {
      fd = openSync(LOCK, 'wx');
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    if (fd >= 0) {
      writeSync(fd, String(process.pid));
      closeSync(fd);
      sleep(50);
      if (holder() === String(process.pid)) return;
      continue;
    }
    const h = holder();
    const pid = Number(h);
    // 空的（另一个进程刚建出来、还没写进号）不算死锁。清之前再读一遍：号没变才清。
    if (pid > 0 && !alive(pid) && holder() === h) {
      try {
        unlinkSync(LOCK);
      } catch {
        // 别人先清掉了，照样再去拿。
      }
      continue;
    }
    if (Date.now() - t0 > LOCK_WAIT_MS) {
      throw new Error(`等 xhs/.preview.lock 等了十分钟（拿着它的是进程 ${h}）。那边多半卡死了：确认它不在跑了，删掉这个文件再来。`);
    }
    if (!told) {
      console.log('（另一道门正在重出 xhs 预览页，等它出完……）');
      told = true;
    }
    sleep(200);
  }
}

/** 放锁：只放自己的（锁里是别人的号就不动）。 */
function release() {
  if (holder() !== String(process.pid)) return;
  try {
    unlinkSync(LOCK);
  } catch {
    // 已经没了。
  }
}

/**
 * 预览页不是最新的就重出一次（出包和出预览两步串在 `npm run preview:xhs` 里）。
 *
 * 回 true 表示真的重出过——调用方不用管，它只是让那一行输出说得清楚。
 */
export function ensurePreview() {
  if (!staleReason()) return false;
  acquire();
  try {
    // 拿到锁之后再判一次：等锁的时候，先到的那一道门多半已经重出完了。
    const why = staleReason();
    if (!why) {
      console.log('（xhs/preview.html 刚被另一道门重出过，直接用它那一份）\n');
      return false;
    }
    const t0 = Date.now();
    // stdio 'inherit'：出包那两步自己会打印体积和门禁结果，那些话该照常露出来。
    // npm 在 Windows 上是 .cmd，所以走 shell——这个仓库只在 mac/Linux 上跑，
    // 但写死 'npm' 不带 shell 在别处会莫名其妙地「找不到命令」。
    execFileSync('npm', ['run', 'preview:xhs'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
    console.log(`（${why}，已重出，用了 ${((Date.now() - t0) / 1000).toFixed(1)} 秒）\n`);
    return true;
  } finally {
    release();
  }
}

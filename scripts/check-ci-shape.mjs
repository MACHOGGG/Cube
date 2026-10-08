/**
 * CI 自己的两条底线：默认只给读权限，每个 job 都有超时（10-08 方案第五批第 9 条）。
 *
 *   node scripts/check-ci-shape.mjs
 *
 * 读 .github/workflows/ci.yml 的原文，不装 YAML 解析器（不为一道门多一个依赖），零点几秒。
 *
 * 方案原话：「CI：顶层最小 permissions + 各 job timeout-minutes。」
 *
 * ── 为什么 ───────────────────────────────────────────────────────────────
 *
 * · 权限：不写 permissions 的话，GITHUB_TOKEN 拿到的是仓库设置里的默认值——可能就是读写。
 *   check、browser 两条只读代码、跑门，一行都不写回仓库；真要写的只有 promote（把这一版快进到
 *   production）。所以顶层给 `contents: read`，promote 自己再要 `contents: write`。哪天有人在门
 *   里不小心跑了一句会改仓库的命令，它会被拒，而不是悄悄改成了。
 * · 超时：不写的话一个 job 最多挂六小时。browser 那一条起几十台 dev-server、开几十次浏览器，
 *   哪一道门卡在一个永远等不到的 waitForSelector 上、或者 dev-server 没退出，它就挂满六小时才红
 *   ——这六小时里 promote 也一直等着，上线就跟着卡住。
 *
 * 量的是：
 *   ① 顶层有 permissions，而且只有 contents: read（不许 write-all、不许顶层就给写）；
 *   ② jobs 底下每一个 job 都写了 timeout-minutes，而且是个正整数；
 *   ③ 要写权限的只有 promote 一个 job，它要的是 contents: write。
 */
import { readFileSync } from 'node:fs';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const yml = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const lines = yml.split('\n');

// ── 顶层：permissions 那一块（行首没有缩进的键）────────────────────────────
const top = (key) => lines.findIndex((l) => l === `${key}:` || l.startsWith(`${key}: `));
const jobsAt = top('jobs');
const permAt = top('permissions');
check('（尺子）读到了 ci.yml，找得到 jobs:', jobsAt > 0, `第 ${jobsAt + 1} 行`);
check('① 顶层写了 permissions（不写就是仓库设置里的默认值，可能是读写）', permAt >= 0 && permAt < jobsAt,
  permAt >= 0 ? `第 ${permAt + 1} 行` : '没有');
if (permAt >= 0) {
  const block = [];
  for (let i = permAt + 1; i < lines.length && /^\s+\S/.test(lines[i]); i++) block.push(lines[i].trim());
  const inline = lines[permAt].slice('permissions:'.length).trim();
  check('① 顶层权限只有 contents: read', inline === '' && block.length === 1 && block[0] === 'contents: read',
    inline ? `permissions: ${inline}` : block.join(' | '));
}

// ── 每个 job ─────────────────────────────────────────────────────────────
// jobs: 底下两格缩进的键就是 job 名；它的块到下一个两格缩进的键为止。
const jobs = [];
for (let i = jobsAt + 1; i < lines.length; i++) {
  const m = lines[i].match(/^ {2}([A-Za-z_][\w-]*):\s*$/);
  if (m) jobs.push({ name: m[1], start: i });
}
jobs.forEach((j, k) => { j.end = k + 1 < jobs.length ? jobs[k + 1].start : lines.length; });
check('（尺子）jobs 底下读到了 check、browser、promote', ['check', 'browser', 'promote'].every((n) => jobs.some((j) => j.name === n)),
  jobs.map((j) => j.name).join(' '));
const writers = [];
for (const j of jobs) {
  const body = lines.slice(j.start + 1, j.end);
  // job 自己那一层的键是四格缩进
  const t = body.find((l) => /^ {4}timeout-minutes:/.test(l));
  const minutes = t ? Number(t.split(':')[1].trim()) : NaN;
  check(`② ${j.name} 写了 timeout-minutes`, Number.isInteger(minutes) && minutes > 0, t ? t.trim() : '没有');
  const p = body.findIndex((l) => /^ {4}permissions:/.test(l));
  if (p >= 0) {
    const perm = [];
    for (let i = p + 1; i < body.length && /^ {6}\S/.test(body[i]); i++) perm.push(body[i].trim());
    if (perm.some((x) => /:\s*write/.test(x)) || /write/.test(body[p])) writers.push(`${j.name}(${perm.join(', ') || body[p].trim()})`);
  }
}
check('③ 要写权限的只有 promote，要的是 contents: write', writers.length === 1 && writers[0] === 'promote(contents: write)',
  writers.join(' / ') || '（一个都没有）');

console.log(fail ? `\n${fail} 条红` : '\n全绿');
process.exit(fail ? 1 : 0);

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
 *   ③ 没有一个 job 要写权限（10-09 方案 7-0 起 promote 推 production 用的是 PROMOTE_TOKEN，原先它要
 *      contents: write）。
 *
 * 10-09 方案 7-0 起还量上线流程那几条规矩（都是改了不报错、出了事才知道的）：
 *   ④ push 排除 production——PROMOTE_TOKEN 是个人令牌，它推的提交会触发工作流，不排除的话每上线一次
 *      就在 production 上把同一个提交整轮再跑一遍；
 *   ⑤ promote 先查 PROMOTE_TOKEN 填了没有，空值当场红、写明「玩家尚未设置 PROMOTE_TOKEN」；checkout
 *      拿的是它；一处都不退回 GITHUB_TOKEN（退回去的话改过 ci.yml 的那一推照样推不上去，只是红得更晚、
 *      话说得更含糊）；
 *   ⑥ 紧急上线：workflow_dispatch 带一个布尔的 skip_browser（默认不勾）；勾了 browser 整条不跑；promote
 *      的条件里 check 必须 success、browser 要么 success 要么正是这一种 skipped、只在开发分支。
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
check('③ 没有一个 job 要 GITHUB_TOKEN 的写权限（promote 推 production 用的是 PROMOTE_TOKEN）', writers.length === 0,
  writers.join(' / ') || '一个都没有');

// ── 上线流程（10-09 方案 7-0）───────────────────────────────────────────────
const job = (name) => {
  const j = jobs.find((x) => x.name === name);
  return j ? lines.slice(j.start, j.end).join('\n') : '';
};
const head = lines.slice(0, jobsAt).join('\n');
const promote = job('promote');
const browser = job('browser');
// ④ production 只由 promote 推，而 PROMOTE_TOKEN 推的提交会触发工作流——不排除就每上线一次再整轮跑一遍
check('④ push 排除 production（branches-ignore）', /\n {2}push:\n {4}branches-ignore: \[production\]\n/.test(head),
  (head.match(/\n {2}push:\n(?: {4}.*\n)+/) || ['没有 push'])[0].trim().replace(/\n\s*/g, ' '));
// ⑤ 推用 PROMOTE_TOKEN；空值当场红、写明是哪件事；不退回 GITHUB_TOKEN
const tokStep = promote.indexOf('PROMOTE_TOKEN 填了没有');
const checkout = promote.indexOf('uses: actions/checkout');
check('⑤ promote 先查 PROMOTE_TOKEN 填了没有，空值就红、写明「玩家尚未设置 PROMOTE_TOKEN」',
  tokStep >= 0 && tokStep < checkout && /-z "\$PROMOTE_TOKEN"/.test(promote) && /::error::玩家尚未设置 PROMOTE_TOKEN/.test(promote));
check('⑤ checkout 拿的是 secrets.PROMOTE_TOKEN（push 用它）', /token: \$\{\{ secrets\.PROMOTE_TOKEN \}\}/.test(promote));
check('⑤ promote 里一处都不退回 GITHUB_TOKEN', !/github\.token|GITHUB_TOKEN\s*\}/.test(promote.replace(/^\s*#.*$/gm, '')));
// ⑥ 紧急上线：workflow_dispatch 带 skip_browser；勾上时 browser 整条跳过，promote 仍要 check 绿
check('⑥ 有 workflow_dispatch，输入 skip_browser 是布尔、默认不勾',
  /\n {2}workflow_dispatch:\n {4}inputs:\n {6}skip_browser:\n(?: {8}.*\n)*? {8}type: boolean\n {8}default: false\n/.test(head));
check('⑥ 勾了 skip_browser，browser 整条不跑', /\n {4}if: \$\{\{ github\.event_name != 'workflow_dispatch' \|\| !inputs\.skip_browser \}\}/.test(browser));
const cond = (promote.match(/\n {4}if: >-\n((?: {6}.*\n)+)/) || [, ''])[1].replace(/\s+/g, ' ');
check('⑥ promote 的条件：check 必须 success；browser 要么 success、要么是紧急上线那一种 skipped；只在开发分支',
  /needs\.check\.result == 'success'/.test(cond) && /needs\.browser\.result == 'success'/.test(cond) &&
  /inputs\.skip_browser && needs\.browser\.result == 'skipped'/.test(cond) && /!cancelled\(\)/.test(cond) &&
  /github\.ref == 'refs\/heads\/claude\/fangtang-game-web-app-xbecza'/.test(cond), cond.trim().slice(0, 160));

console.log(fail ? `\n${fail} 条红` : '\n全绿');
process.exit(fail ? 1 : 0);

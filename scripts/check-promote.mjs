/**
 * promote 那一步（ci.yml 里「推到 production（只快进）」）自己的门（2026-10-08）。
 *
 *   node scripts/check-promote.mjs [ci.yml 的路径，默认仓库里那一份]
 *
 * 不开浏览器、不联网、一两秒：把那一步 `run: |` 的原文从 ci.yml 里拿出来，在临时目录里搭一个本机
 * 的「GitHub」——一个 bare 仓库，pre-receive 钩子按开关拒掉推 production 的那一下（学 GitHub 拒
 * GITHUB_TOKEN 时那样）——再照 actions/checkout 的样子摆一份「runner 上的检出」，七种情形各跑一遍，
 * 用 GitHub 一样的 `bash -e`，看退出码、看 production 最后指到哪儿。
 *
 * 为什么要有它：这一步只在 GitHub 上跑，而且排在 check、browser 两条后面——写错了，要等一个多小时才
 * 看得见。2026-10-08 5f5dfcc 那一次：它的 browser 跑了七十分钟，跑完时分支上已经是 f54c738，两版之间
 * ci.yml 改过，GitHub 拒了这一推（GITHUB_TOKEN 没有 workflows 权限），于是一个什么事都没有的旧运行
 * 挂了一个红叉。这种红每逢「连着推两回、后一回改了 ci.yml」就会再来一次，而偶发红最后一定会被人加
 * continue-on-error。
 *
 *   ① 平常：这一版就是分支最新、production 落后 → 推上去，production 指到它；
 *   ② 一次更晚的推送先跑完、先推过了 → 什么都不推，算过（不许把 production 往回拨）；
 *   ③ production 上有开发分支没有的提交（有人手推过）→ 报红，不推，更不 --force；
 *   ④ 推不上去，可这一版已经被更新的一推顶替了（5f5dfcc 那一次）→ 只留一条 warning，算过；
 *   ⑤ 推不上去，而这一版还是分支最新 → 报红（这才是真出事：线上停在旧版上）；
 *   ⑥ production 还不存在 → 新建；
 *   ⑦ 被顶替了、可推得上去 → 照推（线上是「最近一次全绿」那一版，能往前挪一步就挪）。
 *
 * ④ 的「分支最新」得问远端（git ls-remote），不能读本地的 origin/<分支>：actions/checkout 把那个
 * 远端跟踪分支强行拨到了这一次运行的提交上（5f5dfcc 那一次的日志里写着「forced update」），读它永远
 * 等于 HEAD。这里的检出照那样摆，所以图省事改成读本地的那一版，④ 会红。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// ── 那一步的 run: 原文 ─────────────────────────────────────────────────────
const lines = readFileSync(process.argv[2] || new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8').split('\n');
const stepAt = lines.findIndex((l) => /^\s*- name: 推到 production/.test(l));
let runAt = -1;
for (let i = stepAt + 1; stepAt >= 0 && i < lines.length; i++) {
  if (/^\s*run: \|\s*$/.test(lines[i])) { runAt = i; break; }
  if (/^\s*- name:/.test(lines[i])) break;
}
const indentOf = (l) => l.match(/^ */)[0].length;
const body = [];
for (let i = runAt + 1; runAt >= 0 && i < lines.length; i++) {
  if (lines[i].trim() && indentOf(lines[i]) <= indentOf(lines[runAt])) break;
  body.push(lines[i]);
}
const cut = Math.min(...body.filter((l) => l.trim()).map(indentOf));
const script = body.map((l) => l.slice(cut)).join('\n').trimEnd() + '\n';
check('（尺子）ci.yml 里找得到「推到 production」那一步和它的 run:', runAt > 0 && /git push origin HEAD:refs\/heads\/production/.test(script),
  `第 ${stepAt + 1} 行，${body.length} 行脚本`);

// ── 本机的「GitHub」 ───────────────────────────────────────────────────────
const BRANCH = 'claude/fangtang-game-web-app-xbecza';
const tmp = mkdtempSync(join(tmpdir(), 'promote-'));
const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'gate', GIT_AUTHOR_EMAIL: 'gate@example.invalid',
  GIT_COMMITTER_NAME: 'gate', GIT_COMMITTER_EMAIL: 'gate@example.invalid',
  // 不吃本机的全局配置（钩子目录、签名、默认分支名……），每台机器上跑出来一样
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
};
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (cwd, ...args) => spawnSync('git', args, { cwd, env, encoding: 'utf8' });

const origin = join(tmp, 'origin.git');
git(tmp, 'init', '-q', '--bare', origin);
const REJECT = join(tmp, 'reject');
writeFileSync(join(origin, 'hooks', 'pre-receive'), `#!/bin/sh
while read old new ref; do
  if [ "$ref" = "refs/heads/production" ] && [ -e '${REJECT}' ]; then
    echo "refusing to allow a GitHub App to create or update workflow \\\`.github/workflows/ci.yml\\\` without \\\`workflows\\\` permission" >&2
    exit 1
  fi
done
`);
chmodSync(join(origin, 'hooks', 'pre-receive'), 0o755);

// A ← B ← C 是开发分支；D 是从 A 岔出去的一个「有人手推进 production」的提交
const dev = join(tmp, 'dev');
git(tmp, 'init', '-q', dev);
const commit = (msg) => {
  writeFileSync(join(dev, 'f.txt'), msg);
  git(dev, 'add', 'f.txt');
  git(dev, 'commit', '-q', '-m', msg);
  return git(dev, 'rev-parse', 'HEAD');
};
const A = commit('A');
const B = commit('B');
const C = commit('C');
git(dev, 'checkout', '-q', '-b', 'side', A);
const D = commit('D');
git(dev, 'push', '-q', origin, `${C}:refs/heads/${BRANCH}`, `${D}:refs/heads/side`);
const name = { [A]: 'A', [B]: 'B', [C]: 'C', [D]: 'D' };
const scriptFile = join(tmp, 'step.sh');
writeFileSync(scriptFile, script);

/** 摆好远端和检出，跑那一步。head＝这一次运行的提交，tip＝开发分支在远端的最新提交。 */
function run({ head, tip, production, reject }) {
  git(origin, 'update-ref', `refs/heads/${BRANCH}`, tip);
  if (production) git(origin, 'update-ref', 'refs/heads/production', production);
  else tryGit(origin, 'update-ref', '-d', 'refs/heads/production');
  if (reject) writeFileSync(REJECT, '');
  else rmSync(REJECT, { force: true });
  // 照 actions/checkout（fetch-depth: 0）：先整份取下来，再把远端跟踪分支强行拨到这一次的提交上、检出它
  const work = mkdtempSync(join(tmp, 'work-'));
  git(tmp, 'clone', '-q', origin, work);
  git(work, 'update-ref', `refs/remotes/origin/${BRANCH}`, head);
  git(work, 'checkout', '-q', '-B', BRANCH, `refs/remotes/origin/${BRANCH}`);
  const r = spawnSync('bash', ['-e', scriptFile], { cwd: work, env: { ...env, GITHUB_REF_NAME: BRANCH }, encoding: 'utf8' });
  const prod = tryGit(origin, 'rev-parse', '--verify', '-q', 'refs/heads/production').stdout.trim();
  const out = `${r.stdout}${r.stderr}`;
  const note = out.split('\n').find((l) => /^::(warning|error)::/.test(l)) || out.trim().split('\n').pop();
  return { code: r.status, prod: name[prod] || prod || '（没有）', out, last: note };
}

let r = run({ head: C, tip: C, production: A, reject: false });
check('① 这一版是分支最新、production 落后 → 推上去', r.code === 0 && r.prod === 'C', `退出 ${r.code}，production → ${r.prod}`);

r = run({ head: B, tip: C, production: C, reject: false });
check('② production 已经含这一版（更晚的那次先推过了）→ 不推、不往回拨，算过', r.code === 0 && r.prod === 'C' && /已经在 production 里/.test(r.out),
  `退出 ${r.code}，production → ${r.prod}`);

r = run({ head: C, tip: C, production: D, reject: false });
check('③ production 上有开发分支没有的提交 → 报红、不推', r.code !== 0 && r.prod === 'D' && /::error::/.test(r.out), `退出 ${r.code}，production → ${r.prod}`);

r = run({ head: B, tip: C, production: A, reject: true });
check('④ 推不上去，可这一版已经被更新的一推顶替了（5f5dfcc 那一次）→ warning，算过', r.code === 0 && r.prod === 'A' && /::warning::/.test(r.out),
  `退出 ${r.code}，production → ${r.prod}；${r.last}`);

r = run({ head: C, tip: C, production: A, reject: true });
check('⑤ 推不上去，而这一版还是分支最新 → 报红', r.code !== 0 && r.prod === 'A', `退出 ${r.code}，production → ${r.prod}`);

r = run({ head: C, tip: C, production: null, reject: false });
check('⑥ production 还不存在 → 新建', r.code === 0 && r.prod === 'C', `退出 ${r.code}，production → ${r.prod}`);

r = run({ head: B, tip: C, production: A, reject: false });
check('⑦ 被顶替了、可推得上去 → 照推（往前挪一步）', r.code === 0 && r.prod === 'B', `退出 ${r.code}，production → ${r.prod}`);

rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `\n${fail} 条红` : '\n全绿');
process.exit(fail ? 1 : 0);

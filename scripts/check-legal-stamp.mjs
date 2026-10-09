/**
 * 法务文本一改，「最后更新」的日期就得跟着改（10-09 补充方案 7-14）。
 *
 *   npx esbuild src/legal.ts --bundle --format=esm --outfile=/tmp/legal.mjs
 *   node scripts/check-legal-stamp.mjs /tmp/legal.mjs
 *   node scripts/check-legal-stamp.mjs /tmp/legal.mjs --write    ← 改完条款、也改了日期之后，记下新的那一对
 *
 * 纯算术，不开浏览器，进得了 CI。
 *
 * ── 守的是什么 ────────────────────────────────────────────────
 *
 * 五份法务文档（src/legal.ts 的 LEGAL，四种语言）开头都印着「最后更新：LEGAL_UPDATED」。这个日期是手写的，
 * 而条款本身是一句一句改的——改了条款忘了改日期，页面上就写着一个比实际早的「最后更新」。支付审核把「网站
 * 陈述与实际不符」归为 false information（CLAUDE.md），而「这份文档什么时候改过」正是一句陈述。从前它停在
 * 2026-10-03，之后 10-08、10-09 两批都改过条款。
 *
 * 所以把**法务文本的哈希和日期存在一起**（scripts/legal-stamp.json）：
 *
 *   · 文本的哈希变了、日期还是 stamp 里那一天 → 红：「文本变了，LEGAL_UPDATED 没跟着改」。
 *   · 日期改了、stamp 还是旧的那一对 → 红：「跑一次 --write 记下新的一对」（CI 里写不了文件，这一步要提交）。
 *   · --write 只在日期已经改过的时候才肯写：文本变了日期没变，它拒绝——不然这道门就成了「跑一下就绿」。
 *     例外是**同一天里第二次改**：日期已经是今天（北京时间或 UTC 的今天），没有更晚的一天可改，照写。
 *
 * 哈希的是 LEGAL 整个对象（JSON），**日期本身先换成占位符**：开头那句「最后更新：…」里嵌着它，不挖掉的话光改
 * 日期哈希也会变，「文本没变、只改了日期」就分不出来。
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const src = process.argv[2];
const write = process.argv.includes('--write');
if (!src) {
  console.error('用法: node scripts/check-legal-stamp.mjs <打包好的 legal.mjs> [--write]');
  console.error('  npx esbuild src/legal.ts --bundle --format=esm --outfile=/tmp/legal.mjs');
  process.exit(2);
}
const { LEGAL, LEGAL_UPDATED } = await import(src);
const STAMP = new URL('./legal-stamp.json', import.meta.url);

let fail = 0;
const check = (n, ok, extra = '') => {
  if (!ok) fail++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (extra ? '  ' + extra : ''));
};

/** 文本的哈希：日期挖成占位符之后的 LEGAL。 */
const digest = (legal, date) =>
  createHash('sha256').update(JSON.stringify(legal).split(String(date)).join('{LEGAL_UPDATED}')).digest('hex');

const text = JSON.stringify(LEGAL);
check('（尺子）读到了四种语言的法务文本，而且不是空的', Object.keys(LEGAL || {}).length === 4 && text.length > 20000,
  `${Object.keys(LEGAL || {}).length} 种语言，${text.length} 个字符`);
check('（尺子）LEGAL_UPDATED 是一个日期', /^\d{4}-\d{2}-\d{2}$/.test(String(LEGAL_UPDATED)), String(LEGAL_UPDATED));
check('（尺子）日期真的嵌在文本里（挖成占位符这一步有东西可挖）', text.includes(String(LEGAL_UPDATED)));

const now = digest(LEGAL, LEGAL_UPDATED);
/** 今天（UTC 和北京时间各算一个——跨零点那几个小时两边不是同一天）。 */
const todays = [0, 8].map((h) => new Date(Date.now() + h * 3600e3).toISOString().slice(0, 10));
const isToday = todays.includes(String(LEGAL_UPDATED));
let stamp = null;
try {
  stamp = JSON.parse(readFileSync(STAMP, 'utf8'));
} catch {
  // 没有 stamp：下面那两条会红，并说怎么补。
}

if (write) {
  if (stamp && stamp.sha256 !== now && stamp.updated === LEGAL_UPDATED && !isToday) {
    console.error(`不写：法务文本变了，可 LEGAL_UPDATED 还是 ${LEGAL_UPDATED}（stamp 里那一天）。先把 src/legal.ts 的 LEGAL_UPDATED 改成今天。`);
    process.exit(1);
  }
  writeFileSync(STAMP, JSON.stringify({ updated: LEGAL_UPDATED, sha256: now }, null, 2) + '\n');
  console.log(`记下了：${LEGAL_UPDATED} ${now}`);
  process.exit(0);
}

check('（尺子）scripts/legal-stamp.json 在、读得出来', Boolean(stamp && stamp.updated && stamp.sha256), String(stamp && JSON.stringify(stamp)));
if (stamp) {
  const textChanged = stamp.sha256 !== now;
  const dateChanged = stamp.updated !== LEGAL_UPDATED;
  check('法务文本变了，LEGAL_UPDATED 就得跟着改（同一天里第二次改除外）', !(textChanged && !dateChanged && !isToday),
    textChanged && !dateChanged && !isToday ? `文本的哈希变了（${stamp.sha256.slice(0, 12)} → ${now.slice(0, 12)}），日期还是 ${LEGAL_UPDATED}` : '');
  check('stamp 记的就是现在这一对（改了日期之后跑过 --write、提交了）', !textChanged && !dateChanged,
    dateChanged || textChanged ? `stamp：${stamp.updated} ${stamp.sha256.slice(0, 12)}；现在：${LEGAL_UPDATED} ${now.slice(0, 12)}——改完条款、改完日期，跑 --write 记下新的一对再提交` : '');
}

// 反向对照：在内存里改一个字（日期不动），哈希必须变；只改日期（文本不动），哈希必须不变。
{
  const edited = JSON.parse(text);
  const lang = Object.keys(edited)[0];
  const doc = Object.keys(edited[lang])[0];
  edited[lang][doc].intro = String(edited[lang][doc].intro) + '。';
  check('（反向对照）文本改一个字，哈希就变', digest(edited, LEGAL_UPDATED) !== now);
  const redated = JSON.parse(text.split(String(LEGAL_UPDATED)).join('2099-01-01'));
  check('（反向对照）只改日期、文本不动，哈希不变（日期挖成了占位符）', digest(redated, '2099-01-01') === now);
}

console.log(fail ? `\n${fail} 条红` : '\nALL PASS');
process.exit(fail ? 1 : 0);

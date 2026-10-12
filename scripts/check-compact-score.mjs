/**
 * 分数缩写（src/engine/compactScore.ts）：四舍五入之后满了这一档就进一位单位（10-11 方案 B-13 第 1 条）。
 *
 *   npx esbuild src/engine/compactScore.ts --bundle --format=esm --outfile=/tmp/compactscore.mjs
 *   node scripts/check-compact-score.mjs /tmp/compactscore.mjs
 *
 * 纯算术，几毫秒。原先 999,999,999 → 「1000M」、999,500 → 「1000K」、中文 99,995,000 → 「10000万」：
 * 数是对的，可没人这么念，而且比进位之后的写法长一截——这个函数要守的正是「放得进那个小格子」。
 */
const src = process.argv[2];
if (!src) {
  console.error('用法: node scripts/check-compact-score.mjs <打包好的 compactScore.mjs>');
  process.exit(2);
}
const { compactScore } = await import(src);
let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const CASES = [
  // [分数, 语言, 应该写成]
  [99_999, 'en', '99999'],
  [100_000, 'en', '100K'],
  [123_456, 'en', '123K'],
  [999_499, 'en', '999K'],
  [999_500, 'en', '1M'],
  [1_000_000, 'en', '1M'],
  [1_250_000, 'fr', '1.3M'],
  [999_499_999, 'en', '999M'],
  [999_500_000, 'en', '1B'],
  [999_999_999, 'en', '1B'],
  [1_000_000_000, 'fr', '1B'],
  [12_345_678_901, 'en', '12.3B'],
  [99_999, 'zhHans', '99999'],
  [100_000, 'zhHans', '10万'],
  [123_456, 'zhHans', '12.3万'],
  [99_994_999, 'zhHans', '9999万'],
  [99_995_000, 'zhHans', '1亿'],
  [99_995_000, 'zhHant', '1億'],
  [100_000_000, 'zhHans', '1亿'],
  [123_456_789, 'zhHant', '1.2億'],
  [Number.MAX_SAFE_INTEGER, 'zhHans', '90071993亿'],
];
for (const [n, lang, want] of CASES) {
  const got = compactScore(n, lang);
  check(`${n.toLocaleString('en')}（${lang}）→ ${want}`, got === want, got);
}
// 扫一遍：任何一个分数缩出来的数字部分，都不会是「1000」打头的那种没进位的写法。
let bad = '';
for (let k = 5; k <= 15 && !bad; k++) {
  for (const base of [1, 9.995, 9.9995, 9.99995, 9.999995]) {
    const n = Math.round(base * 10 ** k);
    for (const lang of ['en', 'fr', 'zhHans', 'zhHant']) {
      const got = compactScore(n, lang);
      const num = parseFloat(got);
      const unit = got.replace(/^[\d.]+/, '');
      const cap = { K: 1000, M: 1000, 万: 1e4, 萬: 1e4 }[unit];
      if (cap && num >= cap) bad = `${n} ${lang} → ${got}`;
    }
  }
}
check('扫 10^5–10^15 的边缘：K / M / 万一档从不写到满（满了就进位）', bad === '', bad);
console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

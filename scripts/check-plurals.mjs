/**
 * 英法文单复数：结算页、HUD 上那几句带数字的话，1 的时候不念成复数（第 14 推）。
 *
 *   npx esbuild src/i18n.ts --bundle --format=esm --outfile=/tmp/i18n.mjs
 *   npx esbuild src/engine/runRecord.ts --bundle --format=esm --outfile=/tmp/runrecord.mjs
 *   node scripts/check-plurals.mjs /tmp/i18n.mjs /tmp/runrecord.mjs
 *
 * ── 原先是什么样 ──────────────────────────────────────────────
 *
 * 这几句每种语言只写了一份复数形，调用处直接 `replace('{n}', …)`：
 *
 *   · 步步为营走了一步：「1 moves (1 scored)」「1 coups (1 ont marqué)」
 *   · 降到 1 枚那一下，HUD 上冒「Pattern is now 1 tiles」「Le motif passe à 1 pièces」
 *   · 翻了一枚、拆了一枚：「1 retournées ×2 (dont 1 désamorcées)」
 *   · 削了一条线：「1 lignes effacées (étoiles²)」
 *
 * 规矩早就有了（i18n.ts 的 countPhrase：模板用 `|` 分开单数形和复数形；英文只有 1 用单数，
 * 法文 0 和 1 都用单数），只是这几句没走它。
 *
 * ── 要守的 ────────────────────────────────────────────────────
 *
 *   ① 五句模板在英法文 n = 0 / 1 / 2 时念对（逐字比对），中文两份没有 `|`、占位符都填上了。
 *   ② 结算页真的走了 countPhrase：runBreakdown 喂 1 和 2 两份，那一行分别是单数和复数。
 *   ③ HUD 那三处（patternBlock.ts）都走 countPhrase，不再有人直接 replace('{n}')。
 *
 * ①② 各带一把尺子：同一套断言喂给**原先那几份模板**，必须当场红——不然「念对了」在
 * 「断言根本分不出单复数」的时候也会绿。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [i18nSrc, recSrc] = process.argv.slice(2);
if (!i18nSrc || !recSrc) {
  console.error('用法: node scripts/check-plurals.mjs <打包好的 i18n.mjs> <打包好的 runRecord.mjs>');
  process.exit(2);
}
const { STRINGS, countPhrase } = await import(i18nSrc);
const { runBreakdown } = await import(recSrc);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/** 一句话按 countPhrase 念出来；步步为营那一句另有一个 {k}（它不分单复数）。 */
const say = (tpl, n, lang, k) => {
  const out = countPhrase(tpl, n, lang);
  return k === undefined ? out : out.replace('{k}', String(k));
};

// ── ① 五句模板 ──────────────────────────────────────────────────────
//
// 逐字写出来，不用「不含 1 …s」那种正则：法文那一句原先错的是 « 1 ont marqué »，它的
// 「ont」不以 s 结尾，正则一条都抓不住。
const WANT = {
  en: [
    ['puzzleStepsLabel', 1, 1, '1 move (1 scored)'],
    ['puzzleStepsLabel', 2, 0, '2 moves (0 scored)'],
    ['patternNowLabel', 1, undefined, 'Pattern is now 1 tile'],
    ['patternNowLabel', 2, undefined, 'Pattern is now 2 tiles'],
    ['flipRowLabel', 1, undefined, 'Flipped 1 ×2'],
    ['flipRowDefused', 1, undefined, '(incl. 1 defused)'],
    ['lineRowLabel', 1, undefined, '1 line cleared (stars²)'],
    ['lineRowLabel', 2, undefined, '2 lines cleared (stars²)'],
    ['lineRowLabel', 0, undefined, '0 lines cleared (stars²)'],
  ],
  fr: [
    ['puzzleStepsLabel', 1, 1, '1 coup (1 avec points)'],
    ['puzzleStepsLabel', 2, 1, '2 coups (1 avec points)'],
    ['patternNowLabel', 1, undefined, 'Le motif passe à 1 pièce'],
    ['patternNowLabel', 2, undefined, 'Le motif passe à 2 pièces'],
    ['flipRowLabel', 0, undefined, '0 retournée ×2'],
    ['flipRowLabel', 1, undefined, '1 retournée ×2'],
    ['flipRowLabel', 2, undefined, '2 retournées ×2'],
    ['flipRowDefused', 1, undefined, '(dont 1 désamorcée)'],
    ['flipRowDefused', 3, undefined, '(dont 3 désamorcées)'],
    ['lineRowLabel', 1, undefined, '1 ligne effacée (étoiles²)'],
    ['lineRowLabel', 2, undefined, '2 lignes effacées (étoiles²)'],
  ],
};
const KEYS = ['puzzleStepsLabel', 'patternNowLabel', 'flipRowLabel', 'flipRowDefused', 'lineRowLabel'];

/** 原先那几份模板（第 14 推之前），只给尺子用。 */
const OLD = {
  en: {
    puzzleStepsLabel: '{n} moves ({k} scored)',
    patternNowLabel: 'Pattern is now {n} tiles',
    flipRowLabel: 'Flipped {n} ×2',
    flipRowDefused: '(incl. {k} defused)',
    lineRowLabel: 'Lines cleared {m} (stars²)',
  },
  fr: {
    puzzleStepsLabel: '{n} coups ({k} ont marqué)',
    patternNowLabel: 'Le motif passe à {n} pièces',
    flipRowLabel: '{n} retournées ×2',
    flipRowDefused: '(dont {k} désamorcées)',
    lineRowLabel: '{m} lignes effacées (étoiles²)',
  },
};

/** 一套模板逐字比对，回没对上的那几条。 */
const wrongOnes = (lang, table) =>
  WANT[lang]
    .map(([key, n, k, want]) => {
      // 原先的写法：照 {n}（以及那两句的 {k}、{m}）硬填，不分单复数。
      const got = table === STRINGS[lang]
        ? say(table[key], n, lang, k)
        : table[key].replace('{n}', String(n)).replace('{k}', String(key === 'flipRowDefused' ? n : k)).replace('{m}', String(n));
      return got === want ? null : `${key}(${n}) → 「${got}」，该是「${want}」`;
    })
    .filter(Boolean);

for (const lang of ['en', 'fr']) {
  const bad = wrongOnes(lang, STRINGS[lang]);
  check(`① ${lang}：${WANT[lang].length} 句逐字念对`, bad.length === 0, bad.join(' · '));
  const old = wrongOnes(lang, OLD[lang]);
  check(`① （尺子）${lang}：同一套比对喂原先那几份模板，当场红`, old.length >= 4, `${old.length} 条没对上，例：${old[0] ?? '（无）'}`);
}

// 中文两份：不分单复数（没有 `|`），每个占位符都填上了。
for (const lang of ['zhHans', 'zhHant']) {
  const s = STRINGS[lang];
  const leftover = [];
  for (const key of KEYS) {
    if (s[key].includes('|')) leftover.push(`${key} 里有 |`);
    const out = say(s[key], 2, lang, 1);
    if (/[{}]/.test(out)) leftover.push(`${key} → 「${out}」`);
  }
  check(`① ${lang}：五句都没有 |、占位符都填上了`, leftover.length === 0, leftover.join(' · '));
}
// 四种语言，每一句的占位符名对得上调用处（countPhrase 只认 {n}；原先削线那句是 {m}）。
{
  const bad = [];
  for (const lang of ['en', 'fr', 'zhHans', 'zhHant']) {
    for (const key of KEYS) {
      for (const n of [0, 1, 2, 7]) {
        const out = say(STRINGS[lang][key], n, lang, 3);
        if (/[{}|]/.test(out) || !out.includes(String(n))) bad.push(`${lang}.${key}(${n}) → 「${out}」`);
      }
    }
  }
  check('① 四种语言 × 五句 × n=0/1/2/7：数填进去了，没剩 { } |', bad.length === 0, bad.slice(0, 3).join(' · '));
  const oldLine = OLD.fr.lineRowLabel;
  check('① （尺子）原先削线那句的 {m} 走 countPhrase 会原样剩下来（上面那条抓得住）',
    /\{m\}/.test(countPhrase(oldLine, 2, 'fr')), countPhrase(oldLine, 2, 'fr'));
}

// ── ② 结算页真的走了 countPhrase ────────────────────────────────────
const base = (over = {}) => ({
  shapeId: 'square',
  shapeFallback: '方块',
  modeKey: '',
  totalScore: 0,
  score: 0,
  ratePercent: 50,
  bonusMult: 1.5,
  elapsedSec: 90,
  moves: 20,
  best: 100,
  reason: 'manual',
  neverFlipped: 0,
  unflippedScale: 1,
  timeMult: 1,
  patternPoints: 0,
  comboBonusPoints: 0,
  linePoints: 0,
  extraPenalty: 0,
  extraPenaltyReason: '',
  hazardEnd: false,
  at: 0,
  ...over,
});
const erosion = (flips, defused, lines) =>
  base({ modeKey: 'bomb', flips, defused, lines, linePoints: lines * 9, patternPoints: flips * 2, score: flips * 2 + lines * 9, totalScore: 10, par: 30, stepCoef: 1 });
const puzzle = (spent, scoredMoves) =>
  base({
    modeKey: 'puzzle',
    puzzleRules: 2,
    totalScore: 90,
    puzzle: { cleared: 7, stars: 4, spent, scoredMoves, streakRefunds: 2, edgeRefunds: 4, left: 3, peak: 9 },
  });
const labels = (d, lang) => runBreakdown(d, lang).map(([l]) => l);
{
  const rows = [
    ['en', erosion(1, 1, 1), ['Flipped 1 ×2 (incl. 1 defused)', '1 line cleared (stars²)']],
    ['en', erosion(2, 2, 2), ['Flipped 2 ×2 (incl. 2 defused)', '2 lines cleared (stars²)']],
    ['fr', erosion(1, 1, 1), ['1 retournée ×2 (dont 1 désamorcée)', '1 ligne effacée (étoiles²)']],
    ['fr', erosion(2, 2, 2), ['2 retournées ×2 (dont 2 désamorcées)', '2 lignes effacées (étoiles²)']],
    ['en', puzzle(1, 1), ['1 move (1 scored)']],
    ['en', puzzle(12, 5), ['12 moves (5 scored)']],
    ['fr', puzzle(1, 1), ['1 coup (1 avec points)']],
    ['fr', puzzle(12, 5), ['12 coups (5 avec points)']],
    ['zhHans', erosion(1, 1, 1), ['翻面 1 枚 ×2 （含拆除 1 枚）', '削线 1 条（星星数²）']],
    ['zhHant', puzzle(1, 1), ['走了 1 步（得分 1 步）']],
  ];
  for (const [lang, d, want] of rows) {
    const got = labels(d, lang);
    const miss = want.filter((w) => !got.includes(w));
    const what = d.puzzle ? `步步为营走了 ${d.puzzle.spent} 步` : `翻 ${d.flips} 拆 ${d.defused} 削 ${d.lines}`;
    check(`② ${lang}：${what}，结算页那几行念对`, miss.length === 0, miss.length ? `缺 ${miss.join(' / ')}；实际 ${got.join(' | ')}` : want.join(' | '));
  }
  // 数字抹掉之后，1 和 2 那两行仍然不一样——单复数真的分开了，不是同一句换了个数。
  const shape = (d, lang) => labels(d, lang).slice(0, 2).map((l) => l.replace(/\d+/g, '#')).join(' | ');
  for (const lang of ['en', 'fr']) {
    const one = shape(erosion(1, 1, 1), lang);
    const two = shape(erosion(2, 2, 2), lang);
    check(`② ${lang}：数字抹掉之后 1 和 2 仍然是两句话`, one !== two, `${one}  ／  ${two}`);
  }
}

// ── ③ HUD 那三处 ────────────────────────────────────────────────────
{
  const src = readFileSync(join(ROOT, 'src/ui/patternBlock.ts'), 'utf8');
  const via = (src.match(/countPhrase\(s\.patternNowLabel, /g) ?? []).length;
  check('③ patternBlock：toast / 降级 aria-label / 头一次 aria-label 三处都走 countPhrase', via === 3, `${via} 处`);
  check('③ patternBlock：再没有人直接 replace 那句话', !/patternNowLabel\.replace\(/.test(src));
  const rec = readFileSync(join(ROOT, 'src/engine/runRecord.ts'), 'utf8');
  const direct = ['puzzleStepsLabel', 'lineRowLabel', 'flipRowLabel', 'flipRowDefused'].filter((k) =>
    new RegExp(`s\\.${k}\\.replace\\(`).test(rec),
  );
  check('③ runRecord：那四句没有一句还在直接 replace', direct.length === 0, direct.join(' / '));
}

console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

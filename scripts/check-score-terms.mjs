/**
 * 「综合得分」这一个数，四种语言各只有一个叫法（10-08 方案第四批第 1 条）；「拼出得分」也是（10-11 方案 B-13.3）。
 *
 *   npx esbuild src/i18n.ts --bundle --format=esm --outfile=/tmp/i18n.mjs
 *   node scripts/check-score-terms.mjs /tmp/i18n.mjs
 *
 * 纯算术，不开浏览器，进得了 CI。
 *
 * 同一个数在界面上有三处叫它：
 *   · compositeScoreLabel —— 结算弹窗的标题（3-I 起），小屋那张战绩卡上那一行；
 *   · compositeLabel      —— 结算页明细里粗的那一行；
 *   · endTipComposite     —— 头一局结算页底下那句说明，打头就是这个词（「X = 拼出得分 × 步数系数」）。
 * 原先英文标题写「Composite score」、明细和说明写「Final score」；法文「Score composite」对「Score final」。
 * 同一屏上一个数两个名字，玩家读到的是「这是两个分数」。方案：英法统一成后者，繁简核对。
 *
 * 钉的是四件事：
 *   ① 英法：标题和明细那一行一字不差；
 *   ② 中文：也一字不差（「综合得分」）；繁体是简体逐字转的。从前中文标题是明细那一行多一个「得」（综合得分 /
 *      综合分），门钉的也是「多一个得」——玩家 10-11 定了 Q5：中文统一叫「拼出得分」「综合得分」（B-13.3）；
 *   ③ 四种语言：说明那句打头就是明细那一行的叫法，后面紧跟「=」；
 *   ④ 四种语言：明细里「拼出得分」那一行和 HUD 左边那一块的标题一字不差，说明那句「X = Y × …」里的 Y
 *      就是它（英法的说明写小写，不分大小写比）。从前中文明细写「拼出分」、HUD 写「拼出得分」。
 */
const src = process.argv[2];
if (!src) {
  console.error('用法: node scripts/check-score-terms.mjs <打包好的 i18n.mjs>');
  console.error('  npx esbuild src/i18n.ts --bundle --format=esm --outfile=/tmp/i18n.mjs');
  process.exit(2);
}
const { STRINGS } = await import(src);

let fail = 0;
const check = (n, ok, extra = '') => {
  if (!ok) fail++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (extra ? '  ' + extra : ''));
};

const LANGS = ['zhHans', 'zhHant', 'en', 'fr'];
for (const lang of LANGS) {
  const s = STRINGS[lang] || {};
  const title = s.compositeScoreLabel;
  const row = s.compositeLabel;
  const tip = s.endTipComposite;
  // 尺子：三句都读到了，不是空串——空串和空串「一字不差」
  check(`${lang}（尺子）三句都读到了`, [title, row, tip].every((x) => typeof x === 'string' && x.length >= 2),
    JSON.stringify([title, row, (tip || '').slice(0, 24)]));
  if (![title, row, tip].every((x) => typeof x === 'string' && x.length >= 2)) continue;

  check(`${lang}：结算弹窗的标题就是明细那一行的叫法（一字不差）`, title === row, `标题「${title}」/ 明细「${row}」`);
  // 说明那句：打头就是明细那一行的叫法，紧跟「=」（中英法的等号前都有一个空格）
  check(`${lang}：底下那句说明打头就是这个叫法`, tip.startsWith(row + ' ='), `「${tip.slice(0, 30)}…」`);
  // ④ 拼出得分：明细那一行 = HUD 左边那一块的标题 = 说明那句等号后面那个词
  const built = s.builtScoreLabel;
  const hud = s.builtScoreHudLabel;
  check(`${lang}：明细里「拼出得分」那一行和 HUD 那一块的标题一字不差`, typeof built === 'string' && built.length >= 2 && built === hud,
    `明细「${built}」/ HUD「${hud}」`);
  check(`${lang}：说明那句「${row} = …」等号后面就是这个叫法`,
    typeof built === 'string' && tip.toLowerCase().startsWith(`${row} = ${built}`.toLowerCase()), `「${tip.slice(0, 30)}…」`);
}

// 繁简核对：繁体是简体逐字转的（这几个字里只有「综」繁简不同）
{
  const toHant = (x) => x.replace(/综/g, '綜');
  const a = STRINGS.zhHans || {};
  const b = STRINGS.zhHant || {};
  check('繁简核对：标题', toHant(a.compositeScoreLabel || '') === b.compositeScoreLabel, `${a.compositeScoreLabel} / ${b.compositeScoreLabel}`);
  check('繁简核对：明细那一行', toHant(a.compositeLabel || '') === b.compositeLabel, `${a.compositeLabel} / ${b.compositeLabel}`);
  check('繁简核对：拼出得分', a.builtScoreLabel === b.builtScoreLabel && a.builtScoreLabel === '拼出得分', `${a.builtScoreLabel} / ${b.builtScoreLabel}`);
}

// 反向对照：把英文标题改回「Composite score」，①会红；中文明细改回从前的「综合分」「拼出分」，②④会红
check('（反向对照）英文标题改回「Composite score」，① 会红', 'Composite score' !== STRINGS.en?.compositeLabel);
{
  // 同一句判断喂一份改坏的：明细那一行改回从前的叫法，标题 / HUD 照旧——两条都得判成「不一样」。
  const zh = STRINGS.zhHans || {};
  check('（反向对照）中文明细改回从前的「综合分」，② 那一条会红', zh.compositeScoreLabel !== '综合分');
  check('（反向对照）中文明细改回从前的「拼出分」，④ 那一条会红', zh.builtScoreHudLabel !== '拼出分');
}

console.log(fail ? `\n${fail} 条红` : '\nALL PASS');
process.exit(fail ? 1 : 0);

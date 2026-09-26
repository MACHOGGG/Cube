/**
 * 《开小屋》拨成《开竞赛》的时候，**只换中间那一段字**。
 *
 *   node scripts/check-room-word.mjs
 *
 * 不起服务器、不开浏览器、不打包：读的是 src/i18n.ts 和 src/ui/multiplayer.ts 的源码
 * ——这件事的要害全在那两处的字面上。
 *
 * 玩家 2026-09：「在打开 pro 的开关后，Open a room 中只有 room 一词动态被替换成了
 * contest」。所以那颗键上的字拆成三截（`Open a ` ＋ `room` ＋ ``），拨开关只换中间那
 * 一截。i18n 里因此多了一对 `mpCreateNoun` / `mpContestNoun`，而它们和原来那两整句之
 * 间有两条**咬死的**关系：
 *
 *   ① `mpCreate` 里找得到 `mpCreateNoun`；
 *   ② 把它换成 `mpContestNoun` 之后，一字不差等于 `mpContest`。
 *
 * 这两条断掉不会崩、不会红、也不报错：找不到那一段就悄悄退回「整句换」（那是有意留
 * 的退路），换出来对不上则是**屏幕上多出一句谁也没写过的话**——比如法文如果只换名词
 * 不换冠词，拨开之后键上会写「Ouvrir une concours」（阴阳性不对）。四种语言各写各的，
 * 而翻译往往一次只改一处，所以这道门每种语言都量。
 *
 * 顺带钉住页面那一头：那颗键的字必须是**拆开渲染**的（有 #mpCreateWord 这一截），而
 * 不是整句塞进去——不然上面两条成立也没用，屏幕上照样是一整行字跳一下。
 */
import { readFileSync } from 'node:fs';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const i18n = read('src/i18n.ts');
const LANGS = ['en', 'fr', 'zhHant', 'zhHans'];

/** 从 STRINGS 那张表里把四种语言各自的块切出来（按 `  en: {` 这样的行分段）。 */
const table = i18n.slice(i18n.indexOf('export const STRINGS'));
const blocks = {};
for (const lang of LANGS) {
  const start = table.indexOf(`\n  ${lang}: {`);
  if (start < 0) continue;
  const ends = LANGS.map((l) => table.indexOf(`\n  ${l}: {`)).filter((i) => i > start);
  blocks[lang] = table.slice(start, ends.length ? Math.min(...ends) : table.indexOf('\n};', start));
}
check('四种语言的文案块都找得到', Object.keys(blocks).length === 4, Object.keys(blocks).join(' '));

/** 一个键的值。只认单引号那一种写法（这张表从头到尾都是），带转义的撇号照原样还原。 */
const valueOf = (block, key) => {
  const m = new RegExp(`\\n    ${key}: '((?:[^'\\\\]|\\\\.)*)',`).exec(block);
  return m ? m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\') : null;
};

for (const lang of LANGS) {
  const b = blocks[lang] ?? '';
  const create = valueOf(b, 'mpCreate');
  const contest = valueOf(b, 'mpContest');
  const noun = valueOf(b, 'mpCreateNoun');
  const noun2 = valueOf(b, 'mpContestNoun');
  const got = [create, contest, noun, noun2];
  if (got.some((v) => v === null)) {
    check(`[${lang}] 四条都写了`, false, JSON.stringify(got));
    continue;
  }
  // 尺子：这四条都不是空的。少了这一句，下面两条在「全是空串」时会一路真下去。
  check(`[${lang}] 四条都不是空的`, got.every((v) => v.length > 0), got.join(' / '));
  check(`[${lang}] 《开小屋》里找得到要换的那一段`,
    create.includes(noun), `「${create}」里找「${noun}」`);
  check(`[${lang}] 换完一字不差等于《开竞赛》`,
    create.replace(noun, noun2) === contest,
    `「${create}」→「${create.replace(noun, noun2)}」 应当是「${contest}」`);
  // 「只换一段」才算数：整句都当成那一段的话，上面两条照样成立，而屏幕上是整行在跳。
  check(`[${lang}] 换的是其中一段，不是整句`,
    noun.length < create.length, `「${noun}」 / 「${create}」`);
}

// ---- 页面那一头：字是拆开渲染的，拨开关只动中间那一截 --------------------
const mp = read('src/ui/multiplayer.ts');
check('那颗键的字是拆开渲染的（有 #mpCreateWord 这一截）',
  /id="mpCreateWord"/.test(mp) && /createLabelHtml/.test(mp));
check('拨开关换的是那一截的字，不是整句',
  /createWord\.textContent\s*=\s*next\s*\?\s*s\.mpContestNoun\s*:\s*s\.mpCreateNoun/.test(mp));
// 那一格的宽度按「两个词里较宽的那个」预留（CSS 那头用 ::after 把 data-alt 排一遍再藏
// 掉），所以换词的时候《Open a》和右边那枚招牌一个像素都不挪。data-alt 上挂的必须一直
// 是**另一个**词：不换的话预留宽度就变成当前这个词自己的宽度，格子会缩——两个词哪个更
// 宽各语言不一样，缩起来照样是左右迁移。
check('那一格按另一个词预留宽度（data-alt 挂着它）',
  /data-alt="\$\{esc\(s\.mpContestNoun\)\}"/.test(mp));
check('拨开关时 data-alt 跟着换成刚换下来的那个词',
  /setAttribute\('data-alt', next \? s\.mpCreateNoun : s\.mpContestNoun\)/.test(mp));
const css = read('src/style.css');
check('CSS 那头真的用 data-alt 排了一遍再藏掉',
  /\.mp-swap::before\s*\{[^}]*content:\s*attr\(data-alt\)[^}]*\}/.test(css) &&
  /\.mp-swap::before\s*\{[^}]*visibility:\s*hidden[^}]*\}/.test(css));
// 退路还在：找不到那一段就整句换（翻译改了一半的时候这颗键不能变哑）。
check('找不到那一段时退回整句换（这颗键不会变哑）',
  /if \(!createWord\)/.test(mp) && /createLabel\.textContent = next \? s\.mpContest : s\.mpCreate/.test(mp));

console.log(fail ? `\n${fail} 条没过` : '\n全过');
process.exit(fail ? 1 : 0);

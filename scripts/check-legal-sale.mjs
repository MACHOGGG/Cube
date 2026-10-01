/**
 * 法务文本有没有在说「订阅还在卖」。
 *
 *   npx esbuild src/legal.ts --bundle --format=esm --outfile=/tmp/legal.mjs
 *   node scripts/check-legal-sale.mjs /tmp/legal.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么单开一道
 *
 * CLAUDE.md 那条：「法务文本里的每一句都是**对代码实际行为的陈述**。支付审核把『网站
 * 陈述与实际不符』直接归为 false information，比缺一份文档严重。」这件事已经咬过一次
 * ——《价格与订阅》里那句「**订阅开放后**，由 Creem 作为记录商户……」在订阅早就在卖
 * 之后成了假话，Creem 的审核原样把它引了回来。
 *
 * 2026-10 是反过来的同一件事：玩家在 Creem 后台把两个商品 archive 了、在续的订阅也一并
 * 取消（E11 / PR-12），而《价格与订阅》还写着「目前是 1.99 美元／月」「每期结束时会自
 * 动续期……直到你取消为止」。**四种语言、四份文档，没有任何一道门看着它们。**
 *
 * 所以这一道只管一件事：**这四份文档对「现在卖不卖」说的话，和代码此刻的行为对不对得
 * 上。** 它不判文笔，只判这一个事实。
 *
 * ⚠️ 这道门是**跟着状态翻面**的（下面 `SELLING`）。哪天重开订阅，把那个常量改成 true，
 * 它钉的就是反过来那一套——而不是把这道门删掉。删掉就等于又一次没人看着。
 *
 * 纯算术，不开浏览器，进得了 CI。
 */
const src = process.argv[2];
if (!src) {
  console.error('用法: node scripts/check-legal-sale.mjs <打包好的 legal.mjs>');
  console.error('  npx esbuild src/legal.ts --bundle --format=esm --outfile=/tmp/legal.mjs');
  process.exit(2);
}
const { LEGAL, LEGAL_UPDATED } = await import(src);

let fail = 0;
const check = (n, ok, extra = '') => {
  if (!ok) fail++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (extra ? '  ' + extra : ''));
};

/** 此刻卖不卖。2026-10 起：不卖（E11 / PR-12）。重开订阅时把它改成 true。 */
const SELLING = false;

const LANGS = ['zhHans', 'zhHant', 'en', 'fr'];

/** 「现在就是这个价」那种现在时的说法——卖的时候该有，不卖的时候一句都不许有。 */
const PRESENT_PRICE = [
  /目前是\s*1\.99/, /目前是\s*4\.99/,
  /Currently US\$1\.99/i, /Currently US\$4\.99/i,
  /Actuellement\s*1,99/i, /Actuellement\s*4,99/i,
];
/** 「停了」那种说法。四种语言各一组。 */
const SAYS_STOPPED = {
  zhHans: [/停止销售/, /不再接受新的订阅/, /现在不出售/],
  zhHant: [/停止銷售/, /不再接受新的訂閱/, /現在不出售/],
  en: [/withdrawn from sale/i, /no new subscriptions are taken/i, /Not on sale/i],
  fr: [/retiré de la vente/i, /aucun nouvel abonnement/i, /Plus en vente/i],
};
/** 「还会自动续期扣款」那种说法——在续的都取消了，一句都不许留。 */
const SAYS_RENEWS = {
  zhHans: [/会自动续期并按当时的价格扣款/],
  zhHant: [/會自動續期並按當時的價格扣款/],
  en: [/renews automatically at the end of each period/i],
  fr: [/se renouvelle automatiquement à la fin de chaque période/i],
};

console.log(`此刻的状态：${SELLING ? '在卖' : '停售'}（最后更新 ${LEGAL_UPDATED}）\n`);

for (const lang of LANGS) {
  const book = LEGAL[lang];
  // 尺子先行：这一语的《价格与订阅》真的解析出来了、而且不是空的。少了这一条，
  // 下面每一句「里头没有 X」在 `text` 是空串的时候全都恒真。
  const pricing = book && book.pricing;
  const text = pricing ? [pricing.intro, ...pricing.items.map((i) => `${i.term} ${i.body}`)].join('\n') : '';
  check(`${lang}（尺子）《价格与订阅》读到了，而且不短`, text.length > 300, `${text.length} 字`);
  if (!text) continue;

  if (SELLING) {
    check(`${lang}：在卖，就要印出现在的价钱`, PRESENT_PRICE.some((re) => re.test(text)));
  } else {
    const hit = PRESENT_PRICE.filter((re) => re.test(text));
    check(`${lang}：停售了，一句「目前是 X 美元」都不许有`, hit.length === 0, hit.join(' '));
    const said = (SAYS_STOPPED[lang] || []).filter((re) => re.test(text));
    check(`${lang}：而且要明说停了`, said.length > 0, `命中 ${said.length} 条说法`);
    /*
     * **开头那一句自己就要说。**
     *
     * 上面那条「文档里某处说了」偏松：各条款里到处都有「现在不出售」「停售之前」，删
     * 掉开头那一句它照样绿（反面对照当场逮到了这个空绿）。可收单方的审核员先读的就是
     * intro——他从那一句就该知道这东西还卖不卖，而不用往下翻。
     */
    const introSaid = (SAYS_STOPPED[lang] || []).some((re) => re.test(pricing.intro || ''));
    check(`${lang}：开头那一句就说清了停售`, introSaid, pricing.intro ? pricing.intro.slice(0, 70) : '（空）');
    const renew = (SAYS_RENEWS[lang] || []).filter((re) => re.test(text));
    check(`${lang}：不许再写「每期结束自动续期扣款」`, renew.length === 0, renew.join(' '));
  }

  // 《服务条款》里那句「是可选订阅」同理：现在时的那一半要跟着改。
  const terms = book && book.terms;
  const tText = terms ? terms.items.map((i) => `${i.term} ${i.body}`).join('\n') : '';
  check(`${lang}（尺子）《服务条款》读到了`, tText.length > 300, `${tText.length} 字`);
  if (!SELLING && tText) {
    const present = [/「Slides 天才」是可选订阅/, /「Slides 天才」是選配訂閱/,
                     /"Slides Genius" is an optional subscription/i,
                     /« Slides Génie » est un abonnement facultatif/i].filter((re) => re.test(tText));
    check(`${lang}：《服务条款》里不再说「是可选订阅」（现在时）`, present.length === 0, present.join(' '));
  }
}

// 停售这件事发生在 2026-10，文档的「最后更新」不许还停在那之前。
check('最后更新日期跟上了（不早于 2026-10-01）', String(LEGAL_UPDATED) >= '2026-10-01', String(LEGAL_UPDATED));

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);

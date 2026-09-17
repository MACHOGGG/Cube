/**
 * 法务文本里的商店订阅条款，和「这个构建真的能在商店里结账吗」必须是同一件事。
 *
 *   node scripts/check-iap-copy.mjs
 *
 * 守的是「文案先于实现」这一类事故——这个仓库已经被它咬过一次了。上一次是
 * 《价格与订阅》里那句「**订阅开放后**，由 Creem 作为记录商户……」：订阅早就
 * 在卖了，这句条件句于是成了假话，Creem 的审核原样把它引了回来，拒审理由写着
 * 「still described as not on sale yet」（见 CLAUDE.md 里《还要留意「将来时」》
 * 那一段）。那一次是文案落在实现后面；这里量的是反过来的同一件事——**文案跑在
 * 实现前面**。
 *
 * 现在的情形：
 *
 *   · src/legal.ts 里有一批 `only: 'store'` 的条款，讲的是 App Store /
 *     Google Play 怎么收款、怎么自动续期、怎么退款、怎么「恢复购买」。
 *   · src/engine/iap.ts 的 billing() 去 window.Capacitor.Plugins 里找一个
 *     满足 BillingPlugin 的插件。package.json 里一个都没有，所以每一次调用都
 *     回 'unavailable'，付费墙说的是「订阅尚未开放」。
 *
 * 网站这一头没有问题：legalDoc() 按柜台过滤，scripts/build-legal.mjs 把柜台
 * 写死成 'web'，所以 play-slides.com 上那五张静态页里一条商店条款都没有。
 *
 * 有问题的是**商店构建**：`isStoreChannel()` 只问「有没有 window.Capacitor」，
 * 所以一个 Capacitor 的 iOS 包会把那批条款原样摆出来——「由 App Store 销售、
 * 收款并开具收据」「每期结束时自动续期并扣款」「换设备用『恢复购买』取回」——
 * 而同一个包里 iap.ts 的三个操作全都答 'unavailable'。审核的人读得到这些条
 * 款，也点得到那颗按钮；这正是上一次被拒的那个形状：**文档承诺的事，点下去
 * 做不到**。
 *
 * 所以断言只有一条，双向：
 *
 *   legal.ts 里有 `only: 'store'` 的条款  ⇔  package.json 里装了能结账的插件
 *
 * 「能结账的插件」怎么认：iap.ts 的 PLUGIN_NAMES 是**运行时注册表里的名字**
 * （InAppPurchase / Purchases / …），不是 npm 包名，没法拿来查 package.json。
 * 所以这里按包名认：依赖里有没有哪个名字像内购插件（purchase / billing /
 * iap / revenuecat）。认得宽一点是故意的——这道门要答的是「有没有任何一个东西
 * 可能在收钱」，宁可多认，不可漏认。
 *
 * ── 现在的状态：条款收起来了，所以两边都是「没有」 ──────────────────────
 *
 * 2026-09：那 48 条（四种语言各 12 条）已经从 LEGAL 表里搬进
 * src/legal.store.ts——那个文件谁都不 import，是一份存放，不是代码。于是
 * 「有条款」和「有插件」两边都是「没有」，对得上，这道门是绿的。
 *
 * 插件装上的那一天，把归档里的条款粘回 legal.ts、删掉那个文件，两边就又都是
 * 「有」，仍然对得上。**只做一半**它才红：装了插件不写条款（卖东西没有条
 * 款），或者写了条款没装插件（承诺一套做不到的流程）。
 *
 * 网页版从头到尾不受影响：静态页和网页端的柜台是 'web'，本来就看不到这些条款
 * （build-legal.mjs 把柜台写死成 'web'，legalDoc() 按柜台过滤）。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// ---------------------------------------------------------------------------
// 一、法务文本里有没有商店条款
// ---------------------------------------------------------------------------
const legal = readFileSync(join(root, 'src/legal.ts'), 'utf8');
const storeClauses = legal.match(/only:\s*'store'/g) ?? [];
// 顺便把它们讲的是哪几件事捞出来，红的时候直接告诉人去看哪里。
const terms = [
  ...new Set(
    [...legal.matchAll(/\{\s*term:\s*'([^']+)'[\s\S]{0,600}?only:\s*'store'\s*\}/g)].map((m) => m[1]),
  ),
];

// ---------------------------------------------------------------------------
// 二、有没有装得上的内购插件
// ---------------------------------------------------------------------------
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
// 认得宽：任何名字里带这几个词的包都当作「可能在收钱」。@capacitor/core 本身
// 不算——它没有 billing API，iap.ts 开头那段注释说的就是这件事。
const BILLING_RE = /(in-?app-?purchase|purchases?|billing|\biap\b|revenuecat)/i;
const billingPkgs = deps.filter((d) => BILLING_RE.test(d));

// ---------------------------------------------------------------------------
// 三、两边必须一致
// ---------------------------------------------------------------------------
const hasCopy = storeClauses.length > 0;
const hasPlugin = billingPkgs.length > 0;

console.log(
  `legal.ts 里的商店条款：${storeClauses.length} 条` +
    (terms.length ? `（${terms.slice(0, 8).join(' / ')}${terms.length > 8 ? ' …' : ''}）` : ''),
);
console.log(`package.json 里像内购插件的依赖：${hasPlugin ? billingPkgs.join(', ') : '一个也没有'}`);
console.log('');

check(
  '法务里的商店条款，和能不能真的在商店里结账，说的是同一件事',
  hasCopy === hasPlugin,
  hasCopy && !hasPlugin
    ? '条款已经把一套商店购买流程整个承诺出去了，可是没有任何插件能执行它——' +
        'iap.ts 的三个操作现在一律回 unavailable。商店包出去之前要么把插件装上，' +
        '要么把这些条款收起来（现在收在 src/legal.store.ts）。'
    : !hasCopy && hasPlugin
      ? '插件装上了，法务文本里却没有对应的商店条款——卖东西不能没有条款。' +
          '归档在 src/legal.store.ts，粘回 legal.ts 之前逐条对一遍真实实现。'
      : hasPlugin
        ? '两边都有'
        : '两边都没有：条款收在 src/legal.store.ts，插件也还没装',
);

// 附带一条：iap.ts 那段「还没装插件」的说明不能和实际情况打架。它是这件事在
// 代码里的唯一一处交代，说反了比没有更糟。
const iap = readFileSync(join(root, 'src/engine/iap.ts'), 'utf8');
const saysMissing = /no such plugin is in package\.json yet/.test(iap);
check(
  'iap.ts 头上那句「插件还没装」和 package.json 对得上',
  saysMissing === !hasPlugin,
  saysMissing && hasPlugin
    ? '插件装上了，注释还写着没装——顺手把那段改掉'
    : !saysMissing && !hasPlugin
      ? '注释不再说「还没装」，可 package.json 里确实还没有'
      : '',
);

// 收起来的那一份还在不在。删掉它不会让这道门红（它不是代码），但那 48 条
// 四种语言的文本就只剩 git 历史里有了——装上插件那天要从头写。
if (!hasCopy && !hasPlugin) {
  const { existsSync } = await import('node:fs');
  const archive = join(root, 'src/legal.store.ts');
  check(
    '收起来的那 48 条还在归档里（装上插件那天粘回去）',
    existsSync(archive),
    existsSync(archive) ? 'src/legal.store.ts' : '归档不见了——去 git 历史里找回来',
  );
}

console.log(fail ? `\n${fail} 项没过` : '\n全部通过');
process.exit(fail ? 1 : 0);

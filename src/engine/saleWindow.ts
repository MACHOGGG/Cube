/**
 * 网页端的订阅此刻开不开——**全站只有这一个开关**。
 *
 * 玩家 2026-10：在 Creem 后台把两个订阅商品**暂时**关掉了（原话「暂时关掉」，不是永久
 * 下架），改成「注册即解锁全部功能」。
 *
 * ── 为什么是一个布尔，而不是把那套代码删掉 ──────────────────────────
 *
 * 玩家点名要的：「完整保留现在已有的这套跟 creem 之间的联络机制，无论是页面的还是代码
 * 的部分，这样有一天可以改回来的时候会比较方便。」
 *
 * 所以这一轮**一行 Creem 的代码都没有删**：`engine/creem.ts` 的结账调用、
 * `engine/pricing.ts` 的两档价目、`api/checkout.js` / `api/portal.js`、订阅窗里渲染价钱
 * 那一段，全都原样留着，只是这个开关为假的时候走不到。改回去就是把下面这一行改成
 * `true`，别的什么都不用动。
 *
 * ⚠️ **法务文本不跟着这个开关自动翻面。** `src/legal.ts` 里《价格与订阅》那几条是写死的
 * 散文，改回开售时要**人手**把它们一起改回来——那几条上面有注释点名这件事。不做成条件
 * 文本是有意的：四种语言 × 五条 × 两套写法，维护成本远超它省下的那一下，而且两套文本放
 * 在一起最容易出现的就是「改了一套忘了另一套」。
 * `scripts/check-legal-sale.mjs` 里那个 `SELLING` 常量就是替人盯这件事的——它和这儿这一
 * 行必须同时翻面，不然门当场红。
 *
 * ── 重开售卖之前要先做完的（10-14 方案 G-8 那份清单）──────────────────────────
 *
 * 第 1–8 条在 10-14 方案 G-8 原文里（那一推是 P15）；下面第 9–13 条是 10-15 补充 L-13 核实之后补进来的，都是**今天
 * 关着卖就碰不到、一开卖就是真问题**的事。行号会走样，认文件和函数名。
 *
 *   9. **没有服务端停售开关**：`api/checkout.js` 只看 `CREEM_API_KEY` 和两个商品 id，三样都在，谁直接 POST 都能开出一张
 *      真单——这个文件这一行管不到服务端。重开前加 `CREEM_CHECKOUT_OPEN`（只有 `1` 才开单；在 POST 分支第一行判，回 503
 *      `notConfigured`；GET 诊断多一位 `open`，`sellable` 也算上它；portal 和 checkoutId 那一支不受它管），
 *      `.env.example` 和 `check-checkout-limit` 同推改。
 *  10. **库一出错，结账接口就整个摔掉**：`checkout.js` 里限速那一句 `tooMany('checkout', …)` 在 try 之外，库报错时整个
 *      函数抛出（实测抛的是 `store 503`），和旁边那句注释「不能因为数不了就挡人」正相反。改成 try/catch 放行并记一笔；
 *      `api/subscription.js` 里 `tooMany('sub', …)` 同样的写法一并改。
 *  11. **`checkout_id` 换得出买家邮箱**：`/api/subscription {checkoutId}` 不要令牌，回 `active/period/until/email`；别人
 *      打开一个带 `checkout_id` 的回站地址，客户端会把买家的邮箱记成本机的登录邮箱（`engine/creem.ts` 的
 *      `settleCheckout` → `engine/subscription.ts` 里的 `setEntitlement`）。重开前改成：这一支不回邮箱，邮箱和令牌由恢复
 *      后的 create 一起发。
 *  12. **邮箱大小写**：开单时把客户端给的邮箱原样交给 Creem（`checkout.js`），之后查订阅、开门户一律用小写
 *      （`_entitlement.js`、`portal.js`、`_creem.js`）。Creem 按邮箱查客户时区不区分大小写，要先问 Creem 或在沙箱实测；
 *      区分的话开单前先统一转小写。
 *  13. **商店版三处互相矛盾，上线 App 内购之前必须一起改**：① 商店买家在本机就被解锁（`engine/subscription.ts`：
 *      `storeRestore` → `setEntitlement`），服务端却不认商店收据（`_entitlement.js` 的 `void storeClaim`），开小屋、看排
 *      行榜都被拒；② 退了款也不撤（恢复购买答不出东西时什么都不做，本机那份一直挂到 `until` 再加一天）；③ 邀请窗抬头
 *      对原生版也写「仅需注册即可免费成为 Slides 天才」（`ui/subscribe.ts`、i18n `subscribeTitle`），紧接着又写「不必注
 *      册」（`storeNoAccountHint`），而右边那颗键在原生版上是《恢复购买》。要接上 App Store / Google Play 的收据校验、
 *      退款撤权益、抬头按柜台分开写。
 */
export const WEB_SALE_OPEN = false;

/**
 * 这一端此刻能不能买。
 *
 * 商店渠道（App Store / Google Play）走的是另一条路（`engine/iap.ts`），和 Creem 这一套
 * 无关，所以**不受这个开关管**——它还没上线，这一轮一个字都没动它。
 */
export function webSaleOpen(): boolean {
  return WEB_SALE_OPEN;
}

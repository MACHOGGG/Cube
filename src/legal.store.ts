/**
 * 商店柜台（App Store / Google Play）的法务条款——**收起来的那一份**。
 *
 * 这个文件谁都不 import，也不进任何一个构建产物。它是一份存放，不是代码。
 *
 * ── 为什么收起来 ────────────────────────────────────────────────────────
 *
 * 这 48 条原先住在 src/legal.ts 的 LEGAL 表里，挂着 `only: 'store'`，由
 * legalDoc() 按柜台过滤。网站那头从来看不到它们（build-legal.mjs 把柜台写死
 * 成 'web'），可**商店构建**看得到：isStoreChannel() 只问「有没有
 * window.Capacitor」，所以一个 Capacitor 的 iOS 包会把这一整套购买流程原样摆
 * 给玩家看——「由 App Store 销售、收款并开具收据」「每期结束时自动续期并扣
 * 款」「换设备用『恢复购买』取回」——而同一个包里 engine/iap.ts 的三个操作
 * （getProducts / purchase / restorePurchases）全都答 'unavailable'，因为
 * package.json 里根本没有能结账的插件。
 *
 * 文档承诺的事，点下去做不到。这正是上一次被 Creem 拒审的那个形状（当时是反
 * 过来：条款写着「订阅开放后……」，而订阅早就在卖了，审核原样引回来一句
 * 「still described as not on sale yet」——见 CLAUDE.md 里《还要留意「将来
 * 时」》那一段）。苹果的审核会读法务页，所以在商店真的能收钱之前，这些话一句
 * 都不该出现在玩家面前。
 *
 * ── 怎么放回去 ──────────────────────────────────────────────────────────
 *
 * 等内购插件装上了（Xcode / Gradle 的原生改动，加上在 App Store Connect 和
 * Play Console 里把 engine/pricing.ts 那两个商品 id 建出来）：
 *
 *   1. 把下面每一段按语言和文档粘回 src/legal.ts 对应的 items 数组里；
 *   2. 删掉这个文件；
 *   3. 跑 `node scripts/check-iap-copy.mjs`——它量的就是「条款在不在」和「插
 *      件在不在」这两件事对不对得上，两边都在了它就绿，少了一边它就红。
 *
 * 粘回去之前逐条对一遍：这些话是 2026-09 按当时的设想写的，真接上插件之后，
 * 续期提醒怎么发、退款走哪条路、「恢复购买」按在哪儿，都要按**真实实现**重新
 * 核一遍，不能照抄。法务文本里的每一句都是对代码实际行为的陈述。
 *
 * 排版和 legal.ts 一样：`{store}` 在 legalDoc() 里会被换成这台设备装的那家商
 * 店的名字（App Store / Google Play），见 engine/channel.ts 的 payeeName()。
 */

// ===========================================================================
// 简体中文（zhHans）
// ===========================================================================

// ---- 价格与订阅（pricing）----
// { term: '价格', body: '由 {store} 按你所在地区的价目档显示并收取，确认付款那一页上的金额就是最终金额。', only: 'store' },
// { term: '自动续费', body: '每期结束时由 {store} 自动续期并扣款，直到你取消为止。续期提醒按 {store} 自己的规则发出。', only: 'store' },
// { term: '怎么取消', body: '随时可以在 {store} 的账号设置里取消，取消后不再产生新的扣款。已经付过费的当期会用到期末，不会立刻中断。', only: 'store' },
// { term: '退款', body: '见《退款政策》：在 App 内购买的订阅，由 {store} 按它自己的退款规则受理。', only: 'store' },
// { term: '谁在收款', body: '由 {store} 销售、收款并开具收据。我们不接触、也不保存你的任何支付信息。', only: 'store' },

// ---- 服务条款（terms）----
// { term: '账号', body: 'App 里不需要注册。订阅挂在你自己的 {store} 账号下，换设备或重装之后用「恢复购买」取回。', only: 'store' },

// ---- 退款政策（refund）----
// { term: '由商店受理', body: '在 App 内购买的订阅，退款由 {store} 按它自己的退款规则处理——这笔钱没有经过我们，我们也就没有代为退款的权限。', only: 'store' },
// { term: '怎么申请', body: 'iPhone、iPad 上打开 reportaproblem.apple.com；Android 上在 Google Play 的「订单历史」里申请退款。', only: 'store' },
// { term: '欧盟撤回权', body: '如果你在欧盟／欧洲经济区，法律给你 14 天的撤回权。通过商店购买的，这项权利向商店主张。', only: 'store' },
// { term: '我们能帮什么', body: `商店拒绝之后，你仍然可以写信到 ${E}。我们没有替商店退款的权限，但会在力所能及的范围内帮你把情况说清楚。`, only: 'store' },

// ---- 隐私政策（privacy）----
// { term: '订阅', body: 'App 内订阅不需要注册，我们也拿不到你 {store} 账号的任何信息。订阅状态由设备上的商店收据证明，不经过我们的服务器。', only: 'store' },
// { term: '支付信息', body: '由 {store} 处理。我们看不到你用什么付的款，也不保存任何支付信息。', only: 'store' },

// ===========================================================================
// 繁體中文（zhHant）
// ===========================================================================

// ---- 价格与订阅（pricing）----
// { term: '價格', body: '由 {store} 按你所在地區的價目檔顯示並收取，確認付款那一頁上的金額就是最終金額。', only: 'store' },
// { term: '自動續費', body: '每期結束時由 {store} 自動續期並扣款，直到你取消為止。續期提醒按 {store} 自己的規則發出。', only: 'store' },
// { term: '怎麼取消', body: '隨時可以在 {store} 的帳號設定裡取消，取消後不再產生新的扣款。已經付過費的當期會用到期末，不會立刻中斷。', only: 'store' },
// { term: '退款', body: '見《退款政策》：在 App 內購買的訂閱，由 {store} 按它自己的退款規則受理。', only: 'store' },
// { term: '誰在收款', body: '由 {store} 銷售、收款並開立收據。我們不接觸、也不保存你的任何付款資訊。', only: 'store' },

// ---- 服务条款（terms）----
// { term: '帳號', body: 'App 裡不需要註冊。訂閱掛在你自己的 {store} 帳號下，換裝置或重裝之後用「恢復購買」取回。', only: 'store' },

// ---- 退款政策（refund）----
// { term: '由商店受理', body: '在 App 內購買的訂閱，退款由 {store} 按它自己的退款規則處理——這筆錢沒有經過我們，我們也就沒有代為退款的權限。', only: 'store' },
// { term: '怎麼申請', body: 'iPhone、iPad 上打開 reportaproblem.apple.com；Android 上在 Google Play 的「訂單記錄」裡申請退款。', only: 'store' },
// { term: '歐盟撤回權', body: '如果你在歐盟／歐洲經濟區，法律給你 14 天的撤回權。透過商店購買的，這項權利向商店主張。', only: 'store' },
// { term: '我們能幫什麼', body: `商店拒絕之後，你仍然可以寄信到 ${E}。我們沒有替商店退款的權限，但會在力所能及的範圍內幫你把情況說清楚。`, only: 'store' },

// ---- 隐私政策（privacy）----
// { term: '訂閱', body: 'App 內訂閱不需要註冊，我們也拿不到你 {store} 帳號的任何資訊。訂閱狀態由裝置上的商店收據證明，不經過我們的伺服器。', only: 'store' },
// { term: '付款資訊', body: '由 {store} 處理。我們看不到你用什麼付的款，也不保存任何付款資訊。', only: 'store' },

// ===========================================================================
// English（en）
// ===========================================================================

// ---- 价格与订阅（pricing）----
// { term: 'Price', body: 'Shown and charged by {store} at the price tier for your region; the amount on the confirmation sheet is the final one.', only: 'store' },
// { term: 'Automatic renewal', body: '{store} renews and charges it at the end of each period, until you cancel. Renewal notices go out under {store}’s own rules.', only: 'store' },
// { term: 'Cancelling', body: 'Cancel whenever you like, in your {store} account settings: no further charges are made. The period you have already paid for runs to its end — nothing is cut off early.', only: 'store' },
// { term: 'Refunds', body: 'See the refund policy: a subscription bought in the app is refunded by {store}, under its own rules.', only: 'store' },
// { term: 'Who takes the payment', body: '{store} sells it, takes the payment and issues the receipt. We never see or store anything about how you paid.', only: 'store' },

// ---- 服务条款（terms）----
// { term: 'Accounts', body: 'The app asks you to register for nothing. Your subscription belongs to your own {store} account; on a new device, or after reinstalling, Restore purchase brings it back.', only: 'store' },

// ---- 退款政策（refund）----
// { term: 'The store handles it', body: 'A subscription bought inside the app is refunded by {store} under its own rules — the money never passed through us, so refunding it is not ours to do.', only: 'store' },
// { term: 'How to ask', body: 'On iPhone and iPad, open reportaproblem.apple.com. On Android, request the refund from Order history in Google Play.', only: 'store' },
// { term: 'EU right of withdrawal', body: 'If you are in the EU or EEA the law gives you a 14-day right of withdrawal. For a purchase made through a store, you exercise it with that store.', only: 'store' },
// { term: 'What we can do', body: `If the store turns you down, write to ${E} anyway. We cannot refund on their behalf, but we will help put the case as clearly as we can.`, only: 'store' },

// ---- 隐私政策（privacy）----
// { term: 'Subscription', body: 'Subscribing in the app needs no sign-up, and we receive nothing at all about your {store} account. The store receipt held on the device is what proves the subscription; it never passes through a server of ours.', only: 'store' },
// { term: 'Payment details', body: 'Handled by {store}. We never see how you paid and store nothing about it.', only: 'store' },

// ===========================================================================
// Français（fr）
// ===========================================================================

// ---- 价格与订阅（pricing）----
// { term: 'Prix', body: 'Affiché et prélevé par {store} au palier tarifaire de votre région ; le montant de l’écran de confirmation est le montant final.', only: 'store' },
// { term: 'Renouvellement automatique', body: '{store} renouvelle et prélève à la fin de chaque période, jusqu’à ce que vous résiliiez. Les avis de renouvellement suivent les règles propres à {store}.', only: 'store' },
// { term: 'Résiliation', body: 'Vous pouvez résilier quand vous voulez, dans les réglages de votre compte {store} : aucun nouveau prélèvement n’a lieu. La période déjà payée va jusqu’à son terme, rien n’est coupé avant.', only: 'store' },
// { term: 'Remboursement', body: 'Voir la politique de remboursement : un abonnement acheté dans l’application est remboursé par {store}, selon ses propres règles.', only: 'store' },
// { term: 'Qui encaisse', body: '{store} vend l’abonnement, encaisse et émet le reçu. Nous ne voyons ni ne conservons rien de votre moyen de paiement.', only: 'store' },

// ---- 服务条款（terms）----
// { term: 'Comptes', body: 'L’application ne demande aucune inscription. Votre abonnement appartient à votre propre compte {store} ; sur un nouvel appareil, ou après réinstallation, « Restaurer l’achat » le récupère.', only: 'store' },

// ---- 退款政策（refund）----
// { term: 'C’est le magasin qui rembourse', body: 'Un abonnement acheté dans l’application est remboursé par {store}, selon ses propres règles — l’argent n’est jamais passé par nous, le remboursement ne nous appartient donc pas.', only: 'store' },
// { term: 'Comment demander', body: 'Sur iPhone et iPad, ouvrez reportaproblem.apple.com. Sur Android, demandez le remboursement depuis l’historique des commandes dans Google Play.', only: 'store' },
// { term: 'Droit de rétractation (UE)', body: 'Si vous êtes dans l’UE ou l’EEE, la loi vous accorde 14 jours de rétractation. Pour un achat passé par un magasin, ce droit s’exerce auprès de ce magasin.', only: 'store' },
// { term: 'Ce que nous pouvons faire', body: `Si le magasin refuse, écrivez tout de même à ${E}. Nous ne pouvons pas rembourser à leur place, mais nous aiderons à exposer la situation aussi clairement que possible.`, only: 'store' },

// ---- 隐私政策（privacy）----
// { term: 'Abonnement', body: 'S’abonner dans l’application ne demande aucune inscription, et nous ne recevons rien de votre compte {store}. C’est le reçu du magasin, conservé sur l’appareil, qui atteste l’abonnement ; il ne passe par aucun serveur à nous.', only: 'store' },
// { term: 'Données de paiement', body: 'Traitées par {store}. Nous ne voyons pas comment vous avez payé et n’en conservons rien.', only: 'store' },

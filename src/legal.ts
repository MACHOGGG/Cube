import type { Lang } from './i18n';
import { isStoreChannel, payeeName } from './engine/channel';

/**
 * The five documents a paid service has to publish: what it costs and on what
 * terms, how to get your money back, what it does with your data, and how to
 * reach a human. Written here rather than as separate pages so they carry the
 * app's own language switch — a French player should not be handed English
 * terms — and so they open in the same window 游戏规则 already uses.
 *
 * Everything in them is a statement about how this app actually behaves; the
 * storage list, for instance, is the real set of localStorage keys, and the
 * analytics paragraph names the two services the code actually loads. When
 * the app changes, these change with it.
 */

/** The single address every one of these documents points at. It is also the
 *  address a payment processor's review expects to find on the site itself,
 *  so it lives in one place and is quoted from there. */
export const CONTACT_EMAIL = 'ogmach0000@gmail.com';
export const LEGAL_UPDATED = '2026-09-01';

export interface LegalItem {
  term: string;
  body: string;
  /**
   * Restricts a clause to the channel it is true of. A price the other
   * counter cannot charge, a cancellation route it does not have, a company
   * that never touches its money — each of those is a statement about one
   * channel, and showing it to the other would simply be false.
   *
   * Absent means it holds either way, which is most of what is written here.
   */
  only?: 'web' | 'store';
}
export interface LegalDoc {
  title: string;
  intro: string;
  items: LegalItem[];
}
export type LegalKey = 'pricing' | 'terms' | 'refund' | 'privacy' | 'contact';
/** Row order in 个人主页. */
export const LEGAL_ORDER: LegalKey[] = ['pricing', 'terms', 'refund', 'privacy', 'contact'];

const E = CONTACT_EMAIL;

/**
 * The document as this build has to publish it.
 *
 * Slides is sold at two counters — Creem on the site, in US dollars; the App
 * Store and Google Play in the app, at each region's own tier — and a player
 * only ever stands at one of them. So the pricing document is not one text
 * with two price lists in it: the clauses that belong to the other channel
 * are dropped here, and never reach the page.
 *
 * That is the whole reason for the split. Someone subscribing through the
 * App Store in mainland China cannot pay a dollar price and cannot open
 * Creem's checkout, so a dollar figure in front of them would be a number
 * they have no way to be charged — and the same the other way round.
 *
 * `{store}` is written out as whichever store this build was installed
 * from, so a clause can name the company that will actually take the money.
 */
export function legalDoc(lang: Lang, key: LegalKey): LegalDoc {
  const doc = LEGAL[lang][key];
  const channel = isStoreChannel() ? 'store' : 'web';
  const store = payeeName();
  const name = (text: string) => text.replace(/\{store\}/g, store);
  return {
    title: doc.title,
    intro: name(doc.intro),
    items: doc.items
      .filter((item) => !item.only || item.only === channel)
      .map((item) => ({ term: name(item.term), body: name(item.body) })),
  };
}

export const LEGAL: Record<Lang, Record<LegalKey, LegalDoc>> = {
  zhHans: {
    pricing: {
      title: '价格与订阅',
      intro: 'Slides 的全部玩法都免费。「Slides 天才」是可选订阅，用来解锁额外内容。订阅尚未开放，以下是开放后的条款。',
      items: [
        { term: '免费的部分', body: '方块、圆球、三角三种基础玩法，以及计时挑战、炸弹挑战和更多布局，全部免费，无广告，不需要注册。' },
        { term: '价格', body: '1.99 美元／月，或 4.99 美元／年，全球统一价。最终金额以结账页为准，可能因当地税费不同。', only: 'web' },
        { term: '价格', body: '由 {store} 按你所在地区的价目档显示并收取，确认付款那一页上的金额就是最终金额。在亚洲、非洲、南美洲等欧美以外的地区，定价相当于 2 元／月、9.9 元／年，并按同等价值折算成当地货币。', only: 'store' },
        { term: '订阅周期', body: '按你选的周期计费：月订阅每 1 个月一期，年订阅每 12 个月一期，都从付款当天起算。' },
        { term: '自动续费', body: '每期结束时会自动续期并按当时的价格扣款，直到你取消为止。续期前会有邮件提醒。', only: 'web' },
        { term: '自动续费', body: '每期结束时由 {store} 自动续期并扣款，直到你取消为止。续期提醒按 {store} 自己的规则发出。', only: 'store' },
        { term: '怎么取消', body: '随时可以在「订阅状态」里打开管理页面取消，取消后不再产生新的扣款。已经付过费的当期会用到期末，不会立刻中断。', only: 'web' },
        { term: '怎么取消', body: '随时可以在 {store} 的账号设置里取消，取消后不再产生新的扣款。已经付过费的当期会用到期末，不会立刻中断。', only: 'store' },
        { term: '退款', body: '见《退款政策》：首次订阅 14 天内可以无理由全额退款。', only: 'web' },
        { term: '退款', body: '见《退款政策》：在 App 内购买的订阅，由 {store} 按它自己的退款规则受理。', only: 'store' },
        { term: '谁在收款', body: '订阅开放后，由 Creem 作为记录商户（Merchant of Record）代为销售、收款和开具收据。我们不接触、也不保存你的银行卡信息。', only: 'web' },
        { term: '谁在收款', body: '由 {store} 销售、收款并开具收据。我们不接触、也不保存你的任何支付信息。', only: 'store' },
      ],
    },
    terms: {
      title: '服务条款',
      intro: `这些条款适用于 play-slides.com 与 Slides 的相关应用。使用即表示你接受这些条款。最后更新：${LEGAL_UPDATED}。`,
      items: [
        { term: '谁在运营', body: `本站由一位居住在法国的独立开发者运营。联系邮箱：${E}。` },
        { term: '服务内容', body: 'Slides 是一款滑动益智游戏。基础玩法免费提供，「Slides 天才」是可选订阅。' },
        { term: '账号', body: '基础玩法不需要账号。用银行卡在网页版订阅的，订阅挂在你付款时用的那个邮箱下，不需要设密码，换台设备再填一次这个邮箱就能取回。' , only: 'web' },
        { term: '内部码开通的账号', body: '用内部码开通时会留下邮箱和一组 4～6 位数字密码，这是我们唯一保管的账号。密码请自己记好；连续输错 4 次会锁定几小时，错到 6 次要通过邮箱验证才能重新开启并设置新密码。' },
        { term: '账号', body: 'App 里不需要注册。订阅挂在你自己的 {store} 账号下，换设备或重装之后用「恢复购买」取回。', only: 'store' },
        { term: '年龄', body: '本服务面向 13 岁及以上用户。未满所在地法定年龄的，请在监护人同意下使用。' },
        { term: '可以做和不可以做', body: '请不要试图破坏、逆向或干扰本服务，也不要用自动化手段刷分或影响别人游玩。' },
        { term: '记录与排名', body: '发现作弊或明显异常的数据时，我们会清除相关记录。' },
        { term: '服务会变', body: '我们可能新增、修改或下线某些玩法和功能。如果变更实质性地减少了你已付费订阅的内容，你可以按《退款政策》申请按比例退款。' },
        { term: '免责', body: '本服务按「现状」提供。在法律允许的最大范围内，我们不对使用本服务造成的间接损失负责——这不影响你作为消费者依法享有的权利。' },
        { term: '适用法律', body: '适用法国法律。你仍然享有所在地强制性消费者保护法赋予的权利。' },
        { term: '条款更新', body: '条款如有变更会在本页更新；重大变更会通过邮件或站内提示告知。' },
      ],
    },
    refund: {
      title: '退款政策',
      intro: '我们希望你觉得值。下面是具体怎么退。',
      items: [
        { term: '14 天无理由', body: '首次订阅后 14 天内，你可以不说明理由申请全额退款。', only: 'web' },
        { term: '欧盟撤回权', body: '如果你在欧盟／欧洲经济区，法律给你 14 天的撤回权；上面这条已经覆盖并等同适用。', only: 'web' },
        { term: '续期的扣款', body: '自动续期产生的扣款，在扣款后 14 天内、且这一期基本没用过的情况下，同样可以全额退。', only: 'web' },
        { term: '怎么申请', body: `发邮件到 ${E}，写上你下单用的邮箱和订单号就行，不需要说明理由。`, only: 'web' },
        { term: '多久到账', body: '我们 3 个工作日内回复。退款由 Creem 原路退回，通常 5–10 个工作日到账，具体取决于你的发卡行。', only: 'web' },
        { term: '由商店受理', body: '在 App 内购买的订阅，退款由 {store} 按它自己的退款规则处理——这笔钱没有经过我们，我们也就没有代为退款的权限。', only: 'store' },
        { term: '怎么申请', body: 'iPhone、iPad 上打开 reportaproblem.apple.com；Android 上在 Google Play 的「订单历史」里申请退款。', only: 'store' },
        { term: '欧盟撤回权', body: '如果你在欧盟／欧洲经济区，法律给你 14 天的撤回权。通过商店购买的，这项权利向商店主张。', only: 'store' },
        { term: '我们能帮什么', body: `商店拒绝之后，你仍然可以写信到 ${E}。我们没有替商店退款的权限，但会在力所能及的范围内帮你把情况说清楚。`, only: 'store' },
        { term: '取消不等于退款', body: '取消订阅只是停掉未来的扣款。如果你还想要回已经付掉的这一期，请另外提一次退款申请。' },
        { term: '免费的部分', body: '基础玩法本来就免费，不涉及退款。' },
      ],
    },
    privacy: {
      title: '隐私政策',
      intro: `这里说明我们收集什么、为什么、以及你能做什么。先说结论：我们不出售你的任何数据。最后更新：${LEGAL_UPDATED}。`,
      items: [
        { term: '只存在你自己设备上的', body: '语言、教学是否看过、色盲友好开关、声音开关、标签页图标、订阅状态的本地缓存，以及你的最高分和每局记录（含棋盘截图）。这些放在浏览器的 localStorage 里，不会自动上传；清掉浏览器数据就一起没了。' },
        { term: '使用统计', body: '我们用 Vercel Analytics，以及（在配置了的情况下）Google Analytics 4，统计访问量、看了哪些页面、开始和结束了哪种玩法、用时与得分区间。这些是汇总数据，不用来识别你本人。Google Analytics 会使用 Cookie。' },
        { term: '订阅与邮箱', body: '用银行卡在网页版订阅时，Creem 会记下你的下单邮箱。这一份我们不保存——判断你是不是订阅用户，每次都是拿这个邮箱去问 Creem。', only: 'web' },
        { term: '内部码开通的账号', body: '这是我们唯一自建的账号数据：你的邮箱、密码经 scrypt 加盐后的哈希值（不是密码本身，我们无法还原出你的密码）、到期时间，以及一个登录令牌。因为这份权益是我们发的，只能由我们记住。' },
        { term: '邮件', body: '建账号时有一个勾选框：要不要收 Slides 的邮件。不勾就不会收到，功能上没有任何区别；勾了我们只用这个邮箱发新玩法、新版本和偶尔的优惠，不会把它给任何广告商或者第三方。每封信底部都有退订链接，点一下就不再发，也可以来信让我们改。你什么时候做的这个选择我们一并记下来，因为需要能说清楚同意是哪一刻给的。跟服务本身有关的信（收据、到期提醒、账号安全）不算营销邮件，不勾也会发。' },
        { term: '订阅', body: 'App 内订阅不需要注册，我们也拿不到你 {store} 账号的任何信息。订阅状态由设备上的商店收据证明，不经过我们的服务器。', only: 'store' },
        { term: '支付信息', body: '由 Creem 处理。我们收到的只有订单状态和你的下单邮箱，永远看不到、也不保存你的卡号。', only: 'web' },
        { term: '支付信息', body: '由 {store} 处理。我们看不到你用什么付的款，也不保存任何支付信息。', only: 'store' },
        { term: '数据放在哪', body: '网站由 Vercel 托管。内部码开通的账号，以及多人游玩的房间，存在我们的 Redis（Vercel KV／Upstash）里；银行卡订阅的记录在 Creem，商店订阅的记录在商店；其余设置都在你自己的设备上。这些服务都可能把数据存在欧盟以外，并依据标准合同条款进行跨境传输。' },
        { term: '保留多久', body: '统计数据按各平台的默认周期保留。多人房间在开房两小时后自动消失。内部码账号保留到期满后一年，你也可以随时来信要求提前删除。银行卡与商店订阅的记录由 Creem 或商店按各自的政策保留；设备上的缓存你随时可以自己清掉。' },
        { term: '你的权利', body: `你可以要求查看、更正、导出或删除我们持有的关于你的数据，也可以反对我们的处理。发邮件到 ${E} 就行，我们会在 30 天内答复。你也有权向所在地的数据保护机构投诉（法国是 CNIL）。` },
        { term: '儿童', body: '本服务不面向 13 岁以下儿童，我们也不会有意收集他们的数据。' },
        { term: '变更', body: '政策如有更新会发布在本页。' },
      ],
    },
    contact: {
      title: '联系方式',
      intro: '有问题、发现 bug、想退款，或者想删掉你的数据——都发这个邮箱，是同一个人在看。',
      items: [
        { term: '邮箱', body: E },
        { term: '回复时间', body: '通常 3 个工作日内。' },
        { term: '运营者', body: '一位居住在法国的独立开发者。（尚未注册企业；正式注册后会在这里补上法定名称与 SIRET 号。）' },
        { term: '网站托管', body: 'Vercel Inc.（美国）。' },
        { term: '可用语言', body: '中文、English、Français 都可以。' },
      ],
    },
  },
  zhHant: {
    pricing: {
      title: '價格與訂閱',
      intro: 'Slides 的全部玩法都免費。「Slides 天才」是選配訂閱，用來解鎖額外內容。訂閱尚未開放，以下是開放後的條款。',
      items: [
        { term: '免費的部分', body: '方塊、圓球、三角三種基礎玩法，以及計時挑戰、炸彈挑戰和更多版面，全部免費，無廣告，不需要註冊。' },
        { term: '價格', body: '1.99 美元／月，或 4.99 美元／年，全球統一價。最終金額以結帳頁為準，可能因當地稅費不同。', only: 'web' },
        { term: '價格', body: '由 {store} 按你所在地區的價目檔顯示並收取，確認付款那一頁上的金額就是最終金額。在亞洲、非洲、南美洲等歐美以外的地區，定價相當於 2 元／月、9.9 元／年，並按同等價值折算成當地貨幣。', only: 'store' },
        { term: '訂閱週期', body: '按你選的週期計費：月訂閱每 1 個月一期，年訂閱每 12 個月一期，都從付款當天起算。' },
        { term: '自動續費', body: '每期結束時會自動續期並按當時的價格扣款，直到你取消為止。續期前會有郵件提醒。', only: 'web' },
        { term: '自動續費', body: '每期結束時由 {store} 自動續期並扣款，直到你取消為止。續期提醒按 {store} 自己的規則發出。', only: 'store' },
        { term: '怎麼取消', body: '隨時可以在「訂閱狀態」裡打開管理頁面取消，取消後不再產生新的扣款。已經付過費的當期會用到期末，不會立刻中斷。', only: 'web' },
        { term: '怎麼取消', body: '隨時可以在 {store} 的帳號設定裡取消，取消後不再產生新的扣款。已經付過費的當期會用到期末，不會立刻中斷。', only: 'store' },
        { term: '退款', body: '見《退款政策》：首次訂閱 14 天內可以無理由全額退款。', only: 'web' },
        { term: '退款', body: '見《退款政策》：在 App 內購買的訂閱，由 {store} 按它自己的退款規則受理。', only: 'store' },
        { term: '誰在收款', body: '訂閱開放後，由 Creem 作為記錄商戶（Merchant of Record）代為銷售、收款和開立收據。我們不接觸、也不保存你的信用卡資訊。', only: 'web' },
        { term: '誰在收款', body: '由 {store} 銷售、收款並開立收據。我們不接觸、也不保存你的任何付款資訊。', only: 'store' },
      ],
    },
    terms: {
      title: '服務條款',
      intro: `這些條款適用於 play-slides.com 與 Slides 的相關應用。使用即表示你接受這些條款。最後更新：${LEGAL_UPDATED}。`,
      items: [
        { term: '誰在營運', body: `本站由一位居住在法國的獨立開發者營運。聯絡信箱：${E}。` },
        { term: '服務內容', body: 'Slides 是一款滑動益智遊戲。基礎玩法免費提供，「Slides 天才」是選配訂閱。' },
        { term: '帳號', body: '基礎玩法不需要帳號。用信用卡在網頁版訂閱的，訂閱掛在你付款時用的那個信箱下，不需要設密碼，換台裝置再填一次這個信箱就能取回。', only: 'web' },
        { term: '內部碼開通的帳號', body: '用內部碼開通時會留下信箱和一組 4～6 位數字密碼，這是我們唯一保管的帳號。密碼請自己記好；連續輸錯 4 次會鎖住幾小時，錯到 6 次要透過電子郵件驗證才能重新開啟並設定新密碼。' },
        { term: '帳號', body: 'App 裡不需要註冊。訂閱掛在你自己的 {store} 帳號下，換裝置或重裝之後用「恢復購買」取回。', only: 'store' },
        { term: '年齡', body: '本服務面向 13 歲以上使用者。未滿所在地法定年齡的，請在監護人同意下使用。' },
        { term: '可以與不可以', body: '請不要嘗試破壞、逆向或干擾本服務，也不要用自動化手段刷分或影響別人遊玩。' },
        { term: '紀錄與排名', body: '發現作弊或明顯異常的資料時，我們會清除相關紀錄。' },
        { term: '服務會變', body: '我們可能新增、修改或下架某些玩法和功能。如果變更實質減少了你已付費訂閱的內容，你可以依《退款政策》申請按比例退款。' },
        { term: '免責', body: '本服務按「現狀」提供。在法律允許的最大範圍內，我們不對使用本服務造成的間接損失負責——這不影響你作為消費者依法享有的權利。' },
        { term: '適用法律', body: '適用法國法律。你仍享有所在地強制性消費者保護法賦予的權利。' },
        { term: '條款更新', body: '條款如有變更會在本頁更新；重大變更會透過郵件或站內提示告知。' },
      ],
    },
    refund: {
      title: '退款政策',
      intro: '我們希望你覺得值。下面是具體怎麼退。',
      items: [
        { term: '14 天無理由', body: '首次訂閱後 14 天內，你可以不說明理由申請全額退款。', only: 'web' },
        { term: '歐盟撤回權', body: '如果你在歐盟／歐洲經濟區，法律給你 14 天的撤回權；上面這條已經涵蓋並等同適用。', only: 'web' },
        { term: '續期的扣款', body: '自動續期產生的扣款，在扣款後 14 天內、且這一期基本沒用過的情況下，同樣可以全額退。', only: 'web' },
        { term: '怎麼申請', body: `寄信到 ${E}，寫上你下單用的信箱和訂單編號就行，不需要說明理由。`, only: 'web' },
        { term: '多久入帳', body: '我們 3 個工作天內回覆。退款由 Creem 原路退回，通常 5–10 個工作天入帳，實際取決於你的發卡行。', only: 'web' },
        { term: '由商店受理', body: '在 App 內購買的訂閱，退款由 {store} 按它自己的退款規則處理——這筆錢沒有經過我們，我們也就沒有代為退款的權限。', only: 'store' },
        { term: '怎麼申請', body: 'iPhone、iPad 上打開 reportaproblem.apple.com；Android 上在 Google Play 的「訂單記錄」裡申請退款。', only: 'store' },
        { term: '歐盟撤回權', body: '如果你在歐盟／歐洲經濟區，法律給你 14 天的撤回權。透過商店購買的，這項權利向商店主張。', only: 'store' },
        { term: '我們能幫什麼', body: `商店拒絕之後，你仍然可以寄信到 ${E}。我們沒有替商店退款的權限，但會在力所能及的範圍內幫你把情況說清楚。`, only: 'store' },
        { term: '取消不等於退款', body: '取消訂閱只是停掉未來的扣款。如果你還想要回已經付掉的這一期，請另外提一次退款申請。' },
        { term: '免費的部分', body: '基礎玩法本來就免費，不涉及退款。' },
      ],
    },
    privacy: {
      title: '隱私政策',
      intro: `這裡說明我們收集什麼、為什麼、以及你能做什麼。先說結論：我們不販售你的任何資料。最後更新：${LEGAL_UPDATED}。`,
      items: [
        { term: '只存在你自己裝置上的', body: '語言、教學是否看過、色盲友善開關、聲音開關、分頁圖示、訂閱狀態的本機快取，以及你的最高分和每局紀錄（含棋盤截圖）。這些放在瀏覽器的 localStorage 裡，不會自動上傳；清掉瀏覽器資料就一起沒了。' },
        { term: '使用統計', body: '我們用 Vercel Analytics，以及（在有設定的情況下）Google Analytics 4，統計造訪量、看了哪些頁面、開始和結束了哪種玩法、用時與分數區間。這些是彙總資料，不用來識別你本人。Google Analytics 會使用 Cookie。' },
        { term: '訂閱與信箱', body: '用信用卡在網頁版訂閱時，Creem 會記下你的下單信箱。這一份我們不保存——判斷你是不是訂閱使用者，每次都是拿這個信箱去問 Creem。', only: 'web' },
        { term: '內部碼開通的帳號', body: '這是我們唯一自建的帳號資料：你的信箱、密碼經 scrypt 加鹽後的雜湊值（不是密碼本身，我們無法還原出你的密碼）、到期時間，以及一個登入權杖。因為這份權益是我們發的，只能由我們記住。' },
        { term: '郵件', body: '建帳號時有一個勾選框：要不要收 Slides 的郵件。不勾就不會收到，功能上沒有任何差別；勾了我們只用這個信箱寄新玩法、新版本和偶爾的優惠，不會把它交給任何廣告商或第三方。每封信底部都有退訂連結，點一下就不再寄，也可以來信要我們改。你是什麼時候做這個選擇的我們一併記下，因為需要說得清楚同意是哪一刻給的。跟服務本身有關的信（收據、到期提醒、帳號安全）不算行銷郵件，沒勾也會寄。' },
        { term: '訂閱', body: 'App 內訂閱不需要註冊，我們也拿不到你 {store} 帳號的任何資訊。訂閱狀態由裝置上的商店收據證明，不經過我們的伺服器。', only: 'store' },
        { term: '付款資訊', body: '由 Creem 處理。我們收到的只有訂單狀態和你的下單信箱，永遠看不到、也不保存你的卡號。', only: 'web' },
        { term: '付款資訊', body: '由 {store} 處理。我們看不到你用什麼付的款，也不保存任何付款資訊。', only: 'store' },
        { term: '資料放在哪', body: '網站由 Vercel 代管。內部碼開通的帳號，以及多人遊玩的房間，存在我們的 Redis（Vercel KV／Upstash）裡；信用卡訂閱的紀錄在 Creem，商店訂閱的紀錄在商店；其餘設定都在你自己的裝置上。這些服務都可能把資料存在歐盟以外，並依標準契約條款進行跨境傳輸。' },
        { term: '保留多久', body: '統計資料按各平台的預設週期保留。多人房間在開房兩小時後自動消失。內部碼帳號保留到期滿後一年，你也可以隨時來信要求提前刪除。信用卡與商店訂閱的紀錄由 Creem 或商店按各自的政策保留；裝置上的快取你隨時可以自己清掉。' },
        { term: '你的權利', body: `你可以要求查看、更正、匯出或刪除我們持有的關於你的資料，也可以反對我們的處理。寄信到 ${E} 就行，我們會在 30 天內回覆。你也有權向所在地的資料保護機關申訴（法國是 CNIL）。` },
        { term: '兒童', body: '本服務不面向 13 歲以下兒童，我們也不會有意收集他們的資料。' },
        { term: '變更', body: '政策如有更新會發布在本頁。' },
      ],
    },
    contact: {
      title: '聯絡方式',
      intro: '有問題、發現 bug、想退款，或者想刪掉你的資料——都寄這個信箱，是同一個人在看。',
      items: [
        { term: '信箱', body: E },
        { term: '回覆時間', body: '通常 3 個工作天內。' },
        { term: '營運者', body: '一位居住在法國的獨立開發者。（尚未註冊企業；正式註冊後會在這裡補上法定名稱與 SIRET 號。）' },
        { term: '網站代管', body: 'Vercel Inc.（美國）。' },
        { term: '可用語言', body: '中文、English、Français 都可以。' },
      ],
    },
  },
  en: {
    pricing: {
      title: 'Pricing & subscription',
      intro: 'Every game mode in Slides is free. "Slides Genius" is an optional subscription that unlocks extra content. It is not on sale yet; these are the terms it will be sold on.',
      items: [
        { term: "What's free", body: 'All three base games — squares, balls, triangles — plus the timed challenge, the bomb challenge and the extra layouts. No ads, no account needed.' },
        { term: 'Price', body: 'US$1.99 per month, or US$4.99 per year, the same the world over. The final amount is the one shown at checkout and may differ with local tax.', only: 'web' },
        { term: 'Price', body: 'Shown and charged by {store} at the price tier for your region; the amount on the confirmation sheet is the final one. Across Asia, Africa, South America and other regions outside Europe and the Americas the tier is the equivalent of ¥2 per month and ¥9.9 per year, converted to the local currency at comparable value.', only: 'store' },
        { term: 'Billing period', body: 'You are billed for the period you pick: a monthly subscription renews every 1 month, a yearly one every 12 months, counted from the day you pay.' },
        { term: 'Automatic renewal', body: 'The subscription renews automatically at the end of each period and is charged at the price current at that time, until you cancel. We email you before each renewal.', only: 'web' },
        { term: 'Automatic renewal', body: '{store} renews and charges it at the end of each period, until you cancel. Renewal notices go out under {store}’s own rules.', only: 'store' },
        { term: 'Cancelling', body: 'Cancel whenever you like, from the manage page behind Subscription: no further charges are made. The period you have already paid for runs to its end — nothing is cut off early.', only: 'web' },
        { term: 'Cancelling', body: 'Cancel whenever you like, in your {store} account settings: no further charges are made. The period you have already paid for runs to its end — nothing is cut off early.', only: 'store' },
        { term: 'Refunds', body: 'See the refund policy: a full, no-questions refund within 14 days of your first purchase.', only: 'web' },
        { term: 'Refunds', body: 'See the refund policy: a subscription bought in the app is refunded by {store}, under its own rules.', only: 'store' },
        { term: 'Who takes the payment', body: 'Once the subscription opens, Creem sells it as merchant of record and handles payment and receipts. We never see or store your card details.', only: 'web' },
        { term: 'Who takes the payment', body: '{store} sells it, takes the payment and issues the receipt. We never see or store anything about how you paid.', only: 'store' },
      ],
    },
    terms: {
      title: 'Terms of service',
      intro: `These terms cover play-slides.com and the Slides apps. Using the service means you accept them. Last updated ${LEGAL_UPDATED}.`,
      items: [
        { term: 'Who runs this', body: `Slides is run by an independent developer based in France. Contact: ${E}.` },
        { term: 'What the service is', body: 'Slides is a sliding puzzle game. The base games are free; "Slides Genius" is an optional subscription.' },
        { term: 'Accounts', body: 'The base games need no account. A subscription bought by card on the site is attached to the address you paid with — no password to set, and naming that address again on another device brings it back.', only: 'web' },
        { term: 'Accounts made by a code', body: 'Redeeming a code leaves an email address and a 4–6 digit passcode with us — the only account we keep. Remember the passcode: four wrong tries shut the account for a few hours, and six shut it until you verify by email and set a new one.' },
        { term: 'Accounts', body: 'The app asks you to register for nothing. Your subscription belongs to your own {store} account; on a new device, or after reinstalling, Restore purchase brings it back.', only: 'store' },
        { term: 'Age', body: 'The service is for people aged 13 and over. Below the age of majority where you live, use it with a guardian’s consent.' },
        { term: 'Fair use', body: 'Please do not try to break, reverse-engineer or interfere with the service, and do not automate play to inflate scores or affect other players.' },
        { term: 'Records and rankings', body: 'We remove records we find to be cheated or plainly impossible.' },
        { term: 'The service will change', body: 'Modes and features may be added, changed or retired. If a change materially reduces what you have already paid for, you can ask for a pro-rata refund under the refund policy.' },
        { term: 'No warranty', body: 'The service is provided as is. To the fullest extent the law allows we are not liable for indirect losses arising from its use — this does not affect your statutory rights as a consumer.' },
        { term: 'Governing law', body: 'French law applies. You keep any protection that the mandatory consumer law of your own country gives you.' },
        { term: 'Changes to these terms', body: 'Changes are published on this page; anything significant is announced by email or in the app.' },
      ],
    },
    refund: {
      title: 'Refund policy',
      intro: 'We would rather you were happy with it. Here is exactly how a refund works.',
      items: [
        { term: '14 days, no reason needed', body: 'Within 14 days of your first subscription payment you can ask for a full refund without giving a reason.', only: 'web' },
        { term: 'EU right of withdrawal', body: 'If you are in the EU or EEA the law gives you a 14-day right of withdrawal. The policy above covers it and applies on the same terms.', only: 'web' },
        { term: 'Renewal charges', body: 'A renewal charge is fully refundable within 14 days of the charge, provided that period has gone essentially unused.', only: 'web' },
        { term: 'How to ask', body: `Email ${E} with the address you ordered with and your order number. No reason required.`, only: 'web' },
        { term: 'How long it takes', body: 'We reply within 3 working days. The refund is returned by Creem to the original payment method and usually lands in 5–10 working days, depending on your bank.', only: 'web' },
        { term: 'The store handles it', body: 'A subscription bought inside the app is refunded by {store} under its own rules — the money never passed through us, so refunding it is not ours to do.', only: 'store' },
        { term: 'How to ask', body: 'On iPhone and iPad, open reportaproblem.apple.com. On Android, request the refund from Order history in Google Play.', only: 'store' },
        { term: 'EU right of withdrawal', body: 'If you are in the EU or EEA the law gives you a 14-day right of withdrawal. For a purchase made through a store, you exercise it with that store.', only: 'store' },
        { term: 'What we can do', body: `If the store turns you down, write to ${E} anyway. We cannot refund on their behalf, but we will help put the case as clearly as we can.`, only: 'store' },
        { term: 'Cancelling is not refunding', body: 'Cancelling only stops future charges. If you also want the current period back, ask for a refund separately.' },
        { term: 'The free part', body: 'The base games are free, so there is nothing to refund there.' },
      ],
    },
    privacy: {
      title: 'Privacy policy',
      intro: `What we collect, why, and what you can do about it. The short version: we do not sell any of your data. Last updated ${LEGAL_UPDATED}.`,
      items: [
        { term: 'Kept on your own device only', body: 'Your language, whether you have seen each tutorial, the colourblind and sound switches, your tab icon, the cached state of your subscription, and your best scores and per-run records (including the board snapshots). All of it lives in your browser’s localStorage and is never uploaded on its own; clearing your browser data deletes it.' },
        { term: 'Usage statistics', body: 'We use Vercel Analytics and, where it is configured, Google Analytics 4 to count visits, which screens are opened, which mode was started and finished, and the range of times and scores. This is aggregate data and is not used to identify you. Google Analytics sets cookies.' },
        { term: 'Subscription and email', body: 'Paying by card on the site records your address with Creem. We do not keep that copy — establishing whether you are a subscriber means asking Creem about the address, every time.', only: 'web' },
        { term: 'Accounts made by a code', body: 'This is the one account record we hold ourselves: your email address, a salted scrypt hash of your passcode (never the passcode, and it cannot be turned back into one), the date it runs to, and a sign-in token. The entitlement was granted by us, so only we can remember it.' },
        { term: 'Email from us', body: 'Creating an account puts one tick box in front of you: whether you want email from Slides. Leave it unticked and none is sent — nothing about the app works differently either way. Tick it and we use the address only for new boards, new versions and the occasional offer; we never hand it to an advertiser or anyone else. Every message carries an unsubscribe link that stops them at once, and you can write to us instead. We also record when you made that choice, because consent has to be traceable to a moment. Messages about the service itself — receipts, renewal reminders, account security — are not marketing and are sent either way.' },
        { term: 'Subscription', body: 'Subscribing in the app needs no sign-up, and we receive nothing at all about your {store} account. The store receipt held on the device is what proves the subscription; it never passes through a server of ours.', only: 'store' },
        { term: 'Payment details', body: 'Handled by Creem. All we receive is the order status and the email you ordered with. We never see or store your card number.', only: 'web' },
        { term: 'Payment details', body: 'Handled by {store}. We never see how you paid and store nothing about it.', only: 'store' },
        { term: 'Where the data sits', body: 'The site is hosted by Vercel. Accounts made by a redeem code, and multiplayer rooms, sit in our Redis (Vercel KV / Upstash); a card subscription’s record stays with Creem and a store subscription’s with the store; every other setting stays on your device. These services may store data outside the EU, transferred under standard contractual clauses.' },
        { term: 'How long we keep it', body: 'Statistics are kept for each platform’s default retention period. A multiplayer room disappears two hours after it is opened. An account made by a code is kept until a year after it runs out, and you can ask us to delete it sooner. Card and store subscription records are kept by Creem or the store under their own policies; the cache on your device is yours to clear at any time.' },
        { term: 'Your rights', body: `You can ask to see, correct, export or delete the data we hold about you, and object to our processing it. Email ${E} and we will answer within 30 days. You may also complain to your local data protection authority (in France, the CNIL).` },
        { term: 'Children', body: 'The service is not aimed at children under 13 and we do not knowingly collect their data.' },
        { term: 'Changes', body: 'Updates to this policy are published on this page.' },
      ],
    },
    contact: {
      title: 'Contact',
      intro: 'Questions, bugs, refunds, or deleting your data — all to the same address, and the same person reads it.',
      items: [
        { term: 'Email', body: E },
        { term: 'Response time', body: 'Usually within 3 working days.' },
        { term: 'Operator', body: 'An independent developer based in France. (Not yet registered as a business; the legal name and SIRET number will be added here once it is.)' },
        { term: 'Hosting', body: 'Vercel Inc. (United States).' },
        { term: 'Languages', body: 'English, Français, 中文.' },
      ],
    },
  },
  fr: {
    pricing: {
      title: 'Tarifs et abonnement',
      intro: 'Tous les modes de jeu de Slides sont gratuits. « Slides Génie » est un abonnement facultatif qui débloque du contenu supplémentaire. Il n’est pas encore en vente ; voici les conditions qui s’appliqueront.',
      items: [
        { term: 'Ce qui est gratuit', body: 'Les trois jeux de base — carrés, billes, triangles — ainsi que le défi chronométré, le défi bombe et les dispositions supplémentaires. Sans publicité et sans compte.' },
        { term: 'Prix', body: '1,99 $US par mois, ou 4,99 $US par an, partout dans le monde. Le montant final est celui affiché au paiement et peut varier selon la taxe locale.', only: 'web' },
        { term: 'Prix', body: 'Affiché et prélevé par {store} au palier tarifaire de votre région ; le montant de l’écran de confirmation est le montant final. En Asie, en Afrique, en Amérique du Sud et dans les autres régions hors Europe et Amériques, le palier équivaut à 2 ¥ par mois et 9,9 ¥ par an, converti en monnaie locale à valeur comparable.', only: 'store' },
        { term: 'Période de facturation', body: 'Vous êtes facturé pour la période choisie : un abonnement mensuel se renouvelle tous les mois, un abonnement annuel tous les 12 mois, à compter du jour du paiement.' },
        { term: 'Renouvellement automatique', body: 'L’abonnement se renouvelle automatiquement à la fin de chaque période, au tarif alors en vigueur, jusqu’à ce que vous résiliiez. Un courriel vous prévient avant chaque renouvellement.', only: 'web' },
        { term: 'Renouvellement automatique', body: '{store} renouvelle et prélève à la fin de chaque période, jusqu’à ce que vous résiliiez. Les avis de renouvellement suivent les règles propres à {store}.', only: 'store' },
        { term: 'Résiliation', body: 'Vous pouvez résilier quand vous voulez, depuis la page de gestion derrière « Abonnement » : aucun nouveau prélèvement n’a lieu. La période déjà payée va jusqu’à son terme, rien n’est coupé avant.', only: 'web' },
        { term: 'Résiliation', body: 'Vous pouvez résilier quand vous voulez, dans les réglages de votre compte {store} : aucun nouveau prélèvement n’a lieu. La période déjà payée va jusqu’à son terme, rien n’est coupé avant.', only: 'store' },
        { term: 'Remboursement', body: 'Voir la politique de remboursement : remboursement intégral et sans motif dans les 14 jours suivant le premier achat.', only: 'web' },
        { term: 'Remboursement', body: 'Voir la politique de remboursement : un abonnement acheté dans l’application est remboursé par {store}, selon ses propres règles.', only: 'store' },
        { term: 'Qui encaisse', body: 'Une fois l’abonnement ouvert, Creem le vend en tant que marchand officiel (merchant of record) et gère le paiement et les reçus. Nous ne voyons ni ne conservons jamais vos données bancaires.', only: 'web' },
        { term: 'Qui encaisse', body: '{store} vend l’abonnement, encaisse et émet le reçu. Nous ne voyons ni ne conservons rien de votre moyen de paiement.', only: 'store' },
      ],
    },
    terms: {
      title: 'Conditions d’utilisation',
      intro: `Ces conditions couvrent play-slides.com et les applications Slides. Utiliser le service vaut acceptation. Dernière mise à jour : ${LEGAL_UPDATED}.`,
      items: [
        { term: 'Qui édite ce site', body: `Slides est édité par un développeur indépendant résidant en France. Contact : ${E}.` },
        { term: 'Le service', body: 'Slides est un jeu de puzzle à glissement. Les jeux de base sont gratuits ; « Slides Génie » est un abonnement facultatif.' },
        { term: 'Comptes', body: 'Les jeux de base ne demandent aucun compte. Un abonnement payé par carte sur le site est rattaché à l’adresse utilisée — aucun mot de passe à créer, et il suffit de redonner cette adresse sur un autre appareil.', only: 'web' },
        { term: 'Comptes créés par un code', body: 'Utiliser un code laisse chez nous une adresse courriel et un code secret de 4 à 6 chiffres — le seul compte que nous conservions. Retenez-le : quatre erreurs ferment le compte quelques heures, six le ferment jusqu’à une vérification par courriel et la définition d’un nouveau code.' },
        { term: 'Comptes', body: 'L’application ne demande aucune inscription. Votre abonnement appartient à votre propre compte {store} ; sur un nouvel appareil, ou après réinstallation, « Restaurer l’achat » le récupère.', only: 'store' },
        { term: 'Âge', body: 'Le service s’adresse aux personnes de 13 ans et plus. En dessous de la majorité de votre pays, utilisez-le avec l’accord d’un responsable légal.' },
        { term: 'Usage loyal', body: 'Merci de ne pas tenter de casser, désosser ou perturber le service, et de ne pas automatiser le jeu pour gonfler des scores ou gêner d’autres joueurs.' },
        { term: 'Scores et classements', body: 'Nous supprimons les enregistrements manifestement trichés ou impossibles.' },
        { term: 'Le service évoluera', body: 'Des modes et des fonctions peuvent être ajoutés, modifiés ou retirés. Si un changement réduit sensiblement ce que vous avez déjà payé, vous pouvez demander un remboursement au prorata.' },
        { term: 'Absence de garantie', body: 'Le service est fourni « en l’état ». Dans la limite permise par la loi, nous ne répondons pas des dommages indirects liés à son usage — sans préjudice de vos droits légaux de consommateur.' },
        { term: 'Droit applicable', body: 'Droit français. Vous conservez la protection que vous accorde le droit impératif de la consommation de votre pays.' },
        { term: 'Modifications', body: 'Les modifications sont publiées sur cette page ; tout changement important est annoncé par courriel ou dans l’application.' },
      ],
    },
    refund: {
      title: 'Politique de remboursement',
      intro: 'Nous préférons que vous y trouviez votre compte. Voici exactement comment cela se passe.',
      items: [
        { term: '14 jours, sans motif', body: 'Dans les 14 jours suivant votre premier paiement d’abonnement, vous pouvez demander un remboursement intégral sans avoir à vous justifier.', only: 'web' },
        { term: 'Droit de rétractation (UE)', body: 'Si vous êtes dans l’UE ou l’EEE, la loi vous accorde 14 jours de rétractation. La règle ci-dessus le couvre et s’applique dans les mêmes termes.', only: 'web' },
        { term: 'Prélèvements de renouvellement', body: 'Un prélèvement de renouvellement est intégralement remboursable dans les 14 jours, à condition que la période concernée soit restée pour l’essentiel inutilisée.', only: 'web' },
        { term: 'Comment demander', body: `Écrivez à ${E} en indiquant l’adresse utilisée pour la commande et le numéro de commande. Aucun motif n’est demandé.`, only: 'web' },
        { term: 'Délais', body: 'Nous répondons sous 3 jours ouvrés. Le remboursement est effectué par Creem sur le moyen de paiement d’origine et arrive généralement sous 5 à 10 jours ouvrés selon votre banque.', only: 'web' },
        { term: 'C’est le magasin qui rembourse', body: 'Un abonnement acheté dans l’application est remboursé par {store}, selon ses propres règles — l’argent n’est jamais passé par nous, le remboursement ne nous appartient donc pas.', only: 'store' },
        { term: 'Comment demander', body: 'Sur iPhone et iPad, ouvrez reportaproblem.apple.com. Sur Android, demandez le remboursement depuis l’historique des commandes dans Google Play.', only: 'store' },
        { term: 'Droit de rétractation (UE)', body: 'Si vous êtes dans l’UE ou l’EEE, la loi vous accorde 14 jours de rétractation. Pour un achat passé par un magasin, ce droit s’exerce auprès de ce magasin.', only: 'store' },
        { term: 'Ce que nous pouvons faire', body: `Si le magasin refuse, écrivez tout de même à ${E}. Nous ne pouvons pas rembourser à leur place, mais nous aiderons à exposer la situation aussi clairement que possible.`, only: 'store' },
        { term: 'Résilier n’est pas rembourser', body: 'La résiliation arrête seulement les prélèvements à venir. Si vous voulez aussi récupérer la période en cours, faites une demande de remboursement séparée.' },
        { term: 'La partie gratuite', body: 'Les jeux de base sont gratuits : il n’y a rien à rembourser de ce côté.' },
      ],
    },
    privacy: {
      title: 'Politique de confidentialité',
      intro: `Ce que nous collectons, pourquoi, et ce que vous pouvez faire. En résumé : nous ne vendons aucune de vos données. Dernière mise à jour : ${LEGAL_UPDATED}.`,
      items: [
        { term: 'Conservé uniquement sur votre appareil', body: 'Votre langue, les tutoriels déjà vus, les interrupteurs daltonisme et son, votre icône d’onglet, l’état de votre abonnement mis en cache, ainsi que vos meilleurs scores et vos parties enregistrées (captures du plateau comprises). Tout cela vit dans le localStorage de votre navigateur et n’est jamais envoyé de lui-même ; effacer les données du navigateur le supprime.' },
        { term: 'Statistiques d’usage', body: 'Nous utilisons Vercel Analytics et, lorsqu’il est configuré, Google Analytics 4 pour compter les visites, les écrans ouverts, le mode commencé et terminé, et les plages de durée et de score. Ce sont des données agrégées, qui ne servent pas à vous identifier. Google Analytics dépose des cookies.' },
        { term: 'Abonnement et courriel', body: 'Payer par carte sur le site enregistre votre adresse chez Creem. Nous n’en gardons pas de copie : savoir si vous êtes abonné, c’est interroger Creem sur cette adresse, à chaque fois.', only: 'web' },
        { term: 'Comptes créés par un code', body: 'C’est le seul compte que nous conservions nous-mêmes : votre adresse, une empreinte scrypt salée de votre code secret (jamais le code, et l’empreinte ne permet pas de le retrouver), la date de fin, et un jeton de connexion. C’est nous qui avons accordé ce droit, nous seuls pouvons donc nous en souvenir.' },
        { term: 'Nos courriels', body: 'La création d’un compte pose une seule case à cocher : voulez-vous recevoir les courriels de Slides ? Laissée vide, nous n’écrivons jamais — rien ne fonctionne différemment pour autant. Cochée, l’adresse ne sert qu’aux nouveaux plateaux, aux nouvelles versions et à une offre de temps en temps ; elle n’est remise à aucun annonceur ni à personne d’autre. Chaque message porte un lien de désinscription qui les arrête aussitôt, et vous pouvez aussi simplement nous écrire. Nous notons également le moment de ce choix, un consentement devant pouvoir être rattaché à un instant précis. Les messages liés au service lui-même — reçus, rappels d’échéance, sécurité du compte — ne sont pas de la publicité et partent dans tous les cas.' },
        { term: 'Abonnement', body: 'S’abonner dans l’application ne demande aucune inscription, et nous ne recevons rien de votre compte {store}. C’est le reçu du magasin, conservé sur l’appareil, qui atteste l’abonnement ; il ne passe par aucun serveur à nous.', only: 'store' },
        { term: 'Données de paiement', body: 'Traitées par Creem. Nous ne recevons que l’état de la commande et l’adresse utilisée. Nous ne voyons ni ne conservons jamais votre numéro de carte.', only: 'web' },
        { term: 'Données de paiement', body: 'Traitées par {store}. Nous ne voyons pas comment vous avez payé et n’en conservons rien.', only: 'store' },
        { term: 'Où sont les données', body: 'Le site est hébergé par Vercel. Les comptes créés par un code, ainsi que les salles multijoueur, sont dans notre Redis (Vercel KV / Upstash) ; l’abonnement par carte reste chez Creem et l’abonnement de magasin chez le magasin ; tous les autres réglages restent sur votre appareil. Ces services peuvent stocker hors UE, avec transfert encadré par des clauses contractuelles types.' },
        { term: 'Durée de conservation', body: 'Les statistiques sont conservées selon la durée par défaut de chaque plateforme. Une salle multijoueur disparaît deux heures après son ouverture. Un compte créé par un code est conservé jusqu’à un an après sa fin, et vous pouvez demander sa suppression plus tôt. Les abonnements par carte ou par magasin sont conservés par Creem ou le magasin selon leurs politiques ; le cache de votre appareil, vous pouvez l’effacer quand vous voulez.' },
        { term: 'Vos droits', body: `Vous pouvez demander à consulter, corriger, exporter ou supprimer les données vous concernant, et vous opposer à leur traitement. Écrivez à ${E} : nous répondons sous 30 jours. Vous pouvez aussi saisir votre autorité de protection des données (en France, la CNIL).` },
        { term: 'Enfants', body: 'Le service ne s’adresse pas aux moins de 13 ans et nous ne collectons pas sciemment leurs données.' },
        { term: 'Modifications', body: 'Les mises à jour de cette politique sont publiées sur cette page.' },
      ],
    },
    contact: {
      title: 'Nous contacter',
      intro: 'Questions, bugs, remboursements, suppression de vos données — tout à la même adresse, et c’est la même personne qui lit.',
      items: [
        { term: 'Courriel', body: E },
        { term: 'Délai de réponse', body: 'Généralement sous 3 jours ouvrés.' },
        { term: 'Éditeur', body: 'Un développeur indépendant résidant en France. (Pas encore immatriculé ; la raison sociale et le numéro SIRET seront ajoutés ici une fois l’immatriculation faite.)' },
        { term: 'Hébergeur', body: 'Vercel Inc. (États-Unis).' },
        { term: 'Langues', body: 'Français, English, 中文.' },
      ],
    },
  },
};

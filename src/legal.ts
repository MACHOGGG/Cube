import type { Lang } from './i18n';

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
export const LEGAL_UPDATED = '2026-08-31';

export interface LegalItem {
  term: string;
  body: string;
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

export const LEGAL: Record<Lang, Record<LegalKey, LegalDoc>> = {
  zhHans: {
    pricing: {
      title: '价格与订阅',
      intro: 'Slides 的全部玩法都免费。「Slides 天才」是可选订阅，用来解锁额外内容。订阅尚未开放，以下是开放后的条款。',
      items: [
        { term: '免费的部分', body: '方块、圆球、三角三种基础玩法，以及计时挑战、炸弹挑战和更多布局，全部免费，无广告，不需要注册。' },
        { term: '价格（欧美）', body: '0.99 美元／月，或 4.99 美元／年。最终金额以结账页为准，可能因当地税费不同。' },
        { term: '价格（中国大陆及部分亚洲地区）', body: '2 元／月，或 9.9 元／年。' },
        { term: '订阅周期', body: '按你选的周期计费：月订阅每 1 个月一期，年订阅每 12 个月一期，都从付款当天起算。' },
        { term: '自动续费', body: '每期结束时会自动续期并按当时的价格扣款，直到你取消为止。续期前会有邮件提醒。' },
        { term: '怎么取消', body: '随时可以取消，取消后不再产生新的扣款。已经付过费的当期会用到期末，不会立刻中断。' },
        { term: '退款', body: '见《退款政策》：首次订阅 14 天内可以无理由全额退款。' },
        { term: '谁在收款', body: '订阅开放后，由 Creem 作为记录商户（Merchant of Record）代为销售、收款和开具收据。我们不接触、也不保存你的银行卡信息。' },
      ],
    },
    terms: {
      title: '服务条款',
      intro: `这些条款适用于 play-slides.com 与 Slides 的相关应用。使用即表示你接受这些条款。最后更新：${LEGAL_UPDATED}。`,
      items: [
        { term: '谁在运营', body: `本站由一位居住在法国的独立开发者运营。联系邮箱：${E}。` },
        { term: '服务内容', body: 'Slides 是一款滑动益智游戏。基础玩法免费提供，「Slides 天才」是可选订阅。' },
        { term: '账号', body: '订阅需要一个邮箱账号。请妥善保管你的登录信息；因你自己泄露而产生的使用后果由你承担。' },
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
        { term: '14 天无理由', body: '首次订阅后 14 天内，你可以不说明理由申请全额退款。' },
        { term: '欧盟撤回权', body: '如果你在欧盟／欧洲经济区，法律给你 14 天的撤回权；上面这条已经覆盖并等同适用。' },
        { term: '续期的扣款', body: '自动续期产生的扣款，在扣款后 14 天内、且这一期基本没用过的情况下，同样可以全额退。' },
        { term: '怎么申请', body: `发邮件到 ${E}，写上你下单用的邮箱和订单号就行，不需要说明理由。` },
        { term: '多久到账', body: '我们 3 个工作日内回复。退款由 Creem 原路退回，通常 5–10 个工作日到账，具体取决于你的发卡行。' },
        { term: '取消不等于退款', body: '取消订阅只是停掉未来的扣款。如果你还想要回已经付掉的这一期，请另外提一次退款申请。' },
        { term: '免费的部分', body: '基础玩法本来就免费，不涉及退款。' },
      ],
    },
    privacy: {
      title: '隐私政策',
      intro: `这里说明我们收集什么、为什么、以及你能做什么。先说结论：我们不出售你的任何数据。最后更新：${LEGAL_UPDATED}。`,
      items: [
        { term: '只存在你自己设备上的', body: '语言、教学是否看过、色盲友好开关、声音开关、标签页图标，以及你的最高分和每局记录（含棋盘截图）。这些放在浏览器的 localStorage 里，不会自动上传；清掉浏览器数据就一起没了。' },
        { term: '使用统计', body: '我们用 Vercel Analytics，以及（在配置了的情况下）Google Analytics 4，统计访问量、看了哪些页面、开始和结束了哪种玩法、用时与得分区间。这些是汇总数据，不用来识别你本人。Google Analytics 会使用 Cookie。' },
        { term: '账号（还没开放）', body: '订阅开放后需要邮箱注册。届时我们会保存你的邮箱、密码的哈希值（不是密码本身）和订阅状态，用于登录和同步记录。' },
        { term: '支付信息', body: '由 Creem 处理。我们收到的只有订单状态和你的下单邮箱，永远看不到、也不保存你的卡号。' },
        { term: '数据放在哪', body: '网站由 Vercel 托管；账号数据（开放后）放在 Supabase。两者都可能把数据存在欧盟以外，并依据标准合同条款进行跨境传输。' },
        { term: '保留多久', body: '统计数据按各平台的默认周期保留；账号数据在你删除账号后 30 天内清除。' },
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
        { term: '價格（歐美）', body: '0.99 美元／月，或 4.99 美元／年。最終金額以結帳頁為準，可能因當地稅費不同。' },
        { term: '價格（中國大陸及部分亞洲地區）', body: '2 元／月，或 9.9 元／年。' },
        { term: '訂閱週期', body: '按你選的週期計費：月訂閱每 1 個月一期，年訂閱每 12 個月一期，都從付款當天起算。' },
        { term: '自動續費', body: '每期結束時會自動續期並按當時的價格扣款，直到你取消為止。續期前會有郵件提醒。' },
        { term: '怎麼取消', body: '隨時可以取消，取消後不再產生新的扣款。已經付過費的當期會用到期末，不會立刻中斷。' },
        { term: '退款', body: '見《退款政策》：首次訂閱 14 天內可以無理由全額退款。' },
        { term: '誰在收款', body: '訂閱開放後，由 Creem 作為記錄商戶（Merchant of Record）代為銷售、收款和開立收據。我們不接觸、也不保存你的信用卡資訊。' },
      ],
    },
    terms: {
      title: '服務條款',
      intro: `這些條款適用於 play-slides.com 與 Slides 的相關應用。使用即表示你接受這些條款。最後更新：${LEGAL_UPDATED}。`,
      items: [
        { term: '誰在營運', body: `本站由一位居住在法國的獨立開發者營運。聯絡信箱：${E}。` },
        { term: '服務內容', body: 'Slides 是一款滑動益智遊戲。基礎玩法免費提供，「Slides 天才」是選配訂閱。' },
        { term: '帳號', body: '訂閱需要一個電子郵件帳號。請妥善保管登入資訊；因你自己外洩而產生的使用後果由你承擔。' },
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
        { term: '14 天無理由', body: '首次訂閱後 14 天內，你可以不說明理由申請全額退款。' },
        { term: '歐盟撤回權', body: '如果你在歐盟／歐洲經濟區，法律給你 14 天的撤回權；上面這條已經涵蓋並等同適用。' },
        { term: '續期的扣款', body: '自動續期產生的扣款，在扣款後 14 天內、且這一期基本沒用過的情況下，同樣可以全額退。' },
        { term: '怎麼申請', body: `寄信到 ${E}，寫上你下單用的信箱和訂單編號就行，不需要說明理由。` },
        { term: '多久入帳', body: '我們 3 個工作天內回覆。退款由 Creem 原路退回，通常 5–10 個工作天入帳，實際取決於你的發卡行。' },
        { term: '取消不等於退款', body: '取消訂閱只是停掉未來的扣款。如果你還想要回已經付掉的這一期，請另外提一次退款申請。' },
        { term: '免費的部分', body: '基礎玩法本來就免費，不涉及退款。' },
      ],
    },
    privacy: {
      title: '隱私政策',
      intro: `這裡說明我們收集什麼、為什麼、以及你能做什麼。先說結論：我們不販售你的任何資料。最後更新：${LEGAL_UPDATED}。`,
      items: [
        { term: '只存在你自己裝置上的', body: '語言、教學是否看過、色盲友善開關、聲音開關、分頁圖示，以及你的最高分和每局紀錄（含棋盤截圖）。這些放在瀏覽器的 localStorage 裡，不會自動上傳；清掉瀏覽器資料就一起沒了。' },
        { term: '使用統計', body: '我們用 Vercel Analytics，以及（在有設定的情況下）Google Analytics 4，統計造訪量、看了哪些頁面、開始和結束了哪種玩法、用時與分數區間。這些是彙總資料，不用來識別你本人。Google Analytics 會使用 Cookie。' },
        { term: '帳號（尚未開放）', body: '訂閱開放後需要電子郵件註冊。屆時我們會保存你的信箱、密碼的雜湊值（不是密碼本身）和訂閱狀態，用於登入和同步紀錄。' },
        { term: '付款資訊', body: '由 Creem 處理。我們收到的只有訂單狀態和你的下單信箱，永遠看不到、也不保存你的卡號。' },
        { term: '資料放在哪', body: '網站由 Vercel 代管；帳號資料（開放後）放在 Supabase。兩者都可能把資料存在歐盟以外，並依標準契約條款進行跨境傳輸。' },
        { term: '保留多久', body: '統計資料按各平台的預設週期保留；帳號資料在你刪除帳號後 30 天內清除。' },
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
        { term: 'Price (Europe & the Americas)', body: 'US$0.99 per month, or US$4.99 per year. The final amount is the one shown at checkout and may differ with local tax.' },
        { term: 'Price (mainland China and parts of Asia)', body: '¥2 per month, or ¥9.9 per year.' },
        { term: 'Billing period', body: 'You are billed for the period you pick: a monthly subscription renews every 1 month, a yearly one every 12 months, counted from the day you pay.' },
        { term: 'Automatic renewal', body: 'The subscription renews automatically at the end of each period and is charged at the price current at that time, until you cancel. We email you before each renewal.' },
        { term: 'Cancelling', body: 'Cancel whenever you like: no further charges are made. The period you have already paid for runs to its end — nothing is cut off early.' },
        { term: 'Refunds', body: 'See the refund policy: a full, no-questions refund within 14 days of your first purchase.' },
        { term: 'Who takes the payment', body: 'Once the subscription opens, Creem sells it as merchant of record and handles payment and receipts. We never see or store your card details.' },
      ],
    },
    terms: {
      title: 'Terms of service',
      intro: `These terms cover play-slides.com and the Slides apps. Using the service means you accept them. Last updated ${LEGAL_UPDATED}.`,
      items: [
        { term: 'Who runs this', body: `Slides is run by an independent developer based in France. Contact: ${E}.` },
        { term: 'What the service is', body: 'Slides is a sliding puzzle game. The base games are free; "Slides Genius" is an optional subscription.' },
        { term: 'Accounts', body: 'A subscription needs an email account. Keep your login details to yourself; you are responsible for what happens under your account if you do not.' },
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
        { term: '14 days, no reason needed', body: 'Within 14 days of your first subscription payment you can ask for a full refund without giving a reason.' },
        { term: 'EU right of withdrawal', body: 'If you are in the EU or EEA the law gives you a 14-day right of withdrawal. The policy above covers it and applies on the same terms.' },
        { term: 'Renewal charges', body: 'A renewal charge is fully refundable within 14 days of the charge, provided that period has gone essentially unused.' },
        { term: 'How to ask', body: `Email ${E} with the address you ordered with and your order number. No reason required.` },
        { term: 'How long it takes', body: 'We reply within 3 working days. The refund is returned by Creem to the original payment method and usually lands in 5–10 working days, depending on your bank.' },
        { term: 'Cancelling is not refunding', body: 'Cancelling only stops future charges. If you also want the current period back, ask for a refund separately.' },
        { term: 'The free part', body: 'The base games are free, so there is nothing to refund there.' },
      ],
    },
    privacy: {
      title: 'Privacy policy',
      intro: `What we collect, why, and what you can do about it. The short version: we do not sell any of your data. Last updated ${LEGAL_UPDATED}.`,
      items: [
        { term: 'Kept on your own device only', body: 'Your language, whether you have seen each tutorial, the colourblind and sound switches, your tab icon, and your best scores and per-run records (including the board snapshots). All of it lives in your browser’s localStorage and is never uploaded on its own; clearing your browser data deletes it.' },
        { term: 'Usage statistics', body: 'We use Vercel Analytics and, where it is configured, Google Analytics 4 to count visits, which screens are opened, which mode was started and finished, and the range of times and scores. This is aggregate data and is not used to identify you. Google Analytics sets cookies.' },
        { term: 'Accounts (not open yet)', body: 'The subscription will need an email sign-up. At that point we will store your email address, a hash of your password (never the password) and your subscription status, to sign you in and sync your records.' },
        { term: 'Payment details', body: 'Handled by Creem. All we receive is the order status and the email you ordered with. We never see or store your card number.' },
        { term: 'Where the data sits', body: 'The site is hosted by Vercel; account data (once it exists) will sit in Supabase. Both may store data outside the EU, transferred under standard contractual clauses.' },
        { term: 'How long we keep it', body: 'Statistics are kept for each platform’s default retention period. Account data is erased within 30 days of you deleting your account.' },
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
        { term: 'Prix (Europe et Amériques)', body: '0,99 $US par mois, ou 4,99 $US par an. Le montant final est celui affiché au paiement et peut varier selon la taxe locale.' },
        { term: 'Prix (Chine continentale et une partie de l’Asie)', body: '2 ¥ par mois, ou 9,9 ¥ par an.' },
        { term: 'Période de facturation', body: 'Vous êtes facturé pour la période choisie : un abonnement mensuel se renouvelle tous les mois, un abonnement annuel tous les 12 mois, à compter du jour du paiement.' },
        { term: 'Renouvellement automatique', body: 'L’abonnement se renouvelle automatiquement à la fin de chaque période, au tarif alors en vigueur, jusqu’à ce que vous résiliiez. Un courriel vous prévient avant chaque renouvellement.' },
        { term: 'Résiliation', body: 'Vous pouvez résilier quand vous voulez : aucun nouveau prélèvement n’a lieu. La période déjà payée va jusqu’à son terme, rien n’est coupé avant.' },
        { term: 'Remboursement', body: 'Voir la politique de remboursement : remboursement intégral et sans motif dans les 14 jours suivant le premier achat.' },
        { term: 'Qui encaisse', body: 'Une fois l’abonnement ouvert, Creem le vend en tant que marchand officiel (merchant of record) et gère le paiement et les reçus. Nous ne voyons ni ne conservons jamais vos données bancaires.' },
      ],
    },
    terms: {
      title: 'Conditions d’utilisation',
      intro: `Ces conditions couvrent play-slides.com et les applications Slides. Utiliser le service vaut acceptation. Dernière mise à jour : ${LEGAL_UPDATED}.`,
      items: [
        { term: 'Qui édite ce site', body: `Slides est édité par un développeur indépendant résidant en France. Contact : ${E}.` },
        { term: 'Le service', body: 'Slides est un jeu de puzzle à glissement. Les jeux de base sont gratuits ; « Slides Génie » est un abonnement facultatif.' },
        { term: 'Comptes', body: 'L’abonnement nécessite un compte par courriel. Gardez vos identifiants pour vous ; à défaut, ce qui se passe sous votre compte relève de votre responsabilité.' },
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
        { term: '14 jours, sans motif', body: 'Dans les 14 jours suivant votre premier paiement d’abonnement, vous pouvez demander un remboursement intégral sans avoir à vous justifier.' },
        { term: 'Droit de rétractation (UE)', body: 'Si vous êtes dans l’UE ou l’EEE, la loi vous accorde 14 jours de rétractation. La règle ci-dessus le couvre et s’applique dans les mêmes termes.' },
        { term: 'Prélèvements de renouvellement', body: 'Un prélèvement de renouvellement est intégralement remboursable dans les 14 jours, à condition que la période concernée soit restée pour l’essentiel inutilisée.' },
        { term: 'Comment demander', body: `Écrivez à ${E} en indiquant l’adresse utilisée pour la commande et le numéro de commande. Aucun motif n’est demandé.` },
        { term: 'Délais', body: 'Nous répondons sous 3 jours ouvrés. Le remboursement est effectué par Creem sur le moyen de paiement d’origine et arrive généralement sous 5 à 10 jours ouvrés selon votre banque.' },
        { term: 'Résilier n’est pas rembourser', body: 'La résiliation arrête seulement les prélèvements à venir. Si vous voulez aussi récupérer la période en cours, faites une demande de remboursement séparée.' },
        { term: 'La partie gratuite', body: 'Les jeux de base sont gratuits : il n’y a rien à rembourser de ce côté.' },
      ],
    },
    privacy: {
      title: 'Politique de confidentialité',
      intro: `Ce que nous collectons, pourquoi, et ce que vous pouvez faire. En résumé : nous ne vendons aucune de vos données. Dernière mise à jour : ${LEGAL_UPDATED}.`,
      items: [
        { term: 'Conservé uniquement sur votre appareil', body: 'Votre langue, les tutoriels déjà vus, les interrupteurs daltonisme et son, votre icône d’onglet, ainsi que vos meilleurs scores et vos parties enregistrées (captures du plateau comprises). Tout cela vit dans le localStorage de votre navigateur et n’est jamais envoyé de lui-même ; effacer les données du navigateur le supprime.' },
        { term: 'Statistiques d’usage', body: 'Nous utilisons Vercel Analytics et, lorsqu’il est configuré, Google Analytics 4 pour compter les visites, les écrans ouverts, le mode commencé et terminé, et les plages de durée et de score. Ce sont des données agrégées, qui ne servent pas à vous identifier. Google Analytics dépose des cookies.' },
        { term: 'Comptes (pas encore ouverts)', body: 'L’abonnement demandera une inscription par courriel. Nous conserverons alors votre adresse, une empreinte de votre mot de passe (jamais le mot de passe) et l’état de votre abonnement, pour vous connecter et synchroniser vos parties.' },
        { term: 'Données de paiement', body: 'Traitées par Creem. Nous ne recevons que l’état de la commande et l’adresse utilisée. Nous ne voyons ni ne conservons jamais votre numéro de carte.' },
        { term: 'Où sont les données', body: 'Le site est hébergé par Vercel ; les données de compte (une fois qu’elles existeront) seront chez Supabase. Les deux peuvent stocker hors UE, avec transfert encadré par des clauses contractuelles types.' },
        { term: 'Durée de conservation', body: 'Les statistiques sont conservées selon la durée par défaut de chaque plateforme. Les données de compte sont effacées dans les 30 jours suivant la suppression du compte.' },
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

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
 *  so it lives in one place and is quoted from there.
 *
 *  带域名的地址，不是随手一个免费邮箱——Creem 的审核清单点名要的就是这一条
 *  （「Use a branded support email … not a generic address」）。信箱本身是
 *  ImprovMX 转发到人在读的那个邮箱，域名这半边才是这里要的。 */
export const CONTACT_EMAIL = 'support@play-slides.com';
export const LEGAL_UPDATED = '2026-10-02';

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
/**
 * 个人主页底部摆哪几份，以及 `scripts/build-legal.mjs` 出哪几张静态页。
 *
 * **2026-10-02 只剩隐私政策**（E42）。价格 / 条款 / 退款三份是为「在卖东西」写的，而
 * 2026-10 的改制把付费整个撤了（注册即免费解锁），那三份于是没有对象。
 *
 * ⚠️ **`LEGAL` 那张表里三份条目原样留着**，只是不在这个数组里。两个理由：
 *   · `src/legal.store.ts`（商店渠道那一份）还引着它们，而 `check-iap-copy.mjs` 钉着它
 *     存在；
 *   · 哪天重开订阅，那三份文本还要用——重写一遍比留着更容易写出和代码不符的句子。
 *
 * ⚠️ **附带后果**：`build-legal.mjs` 按这个数组出静态页，所以重建之后 /pricing、
 * /terms、/refund 三个网址会 404。站外登记过这些网址的地方（比如 Creem 商户后台）要一并
 * 更新。
 */
export const LEGAL_ORDER: LegalKey[] = ['privacy'];

/**
 * 每份文档自己的网址。
 *
 * 从前这五份只活在个人主页底下那五行里——点开是个弹窗，地址栏一动不动。对
 * 玩家没问题，对收单方的审核就不行了：他们要能直接打开这几页，也要能把网址
 * 填进后台的表格里，而「先点底排的小人、再滚到最底下」不是一个能填进表格的
 * 东西。所以每份多给一个网址，内容还是这一份，没有第二套文案。
 */
export const LEGAL_PATH: Record<LegalKey, string> = {
  pricing: '/pricing',
  terms: '/terms',
  refund: '/refund',
  privacy: '/privacy',
  contact: '/contact',
};

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
      intro: 'Slides 的全部玩法都免费。「Slides 天才」是解锁额外内容的那一档。订阅目前不开放：我们暂时不出售它，现在也没有任何在续的订阅。下面写明这一档现在是什么状态。',
      items: [
        { term: '免费的部分', body: '方块、圆球两种基础玩法，以及计时挑战、炸弹挑战、多人游玩，全部免费，无广告，不需要注册。特殊布局里的菱形方块和六边圆球也是免费的；另外两副（七色圆球、大三角）属于订阅，在主菜单上挂着锁，点开看得到是什么。' },
        { term: '价格', body: '目前不出售，结账入口已经撤下。此前的价格是 1.99 美元／月、4.99 美元／年；哪天重新开放，会先在本页写明。', only: 'web' },
        { term: '订阅周期', body: '按你选的周期计费：月订阅每 1 个月一期，年订阅每 12 个月一期，都从付款当天起算。' },
        { term: '自动续费', body: '不适用：目前没有任何在续的订阅，也不会产生任何扣款。', only: 'web' },
        { term: '要不要取消', body: '没有要取消的东西：目前没有在续的订阅。', only: 'web' },
        { term: '退款', body: '见《退款政策》：首次订阅 14 天内可以无理由全额退款。', only: 'web' },
        { term: '谁收的款', body: '目前没有在收的款。订阅开放时由 Creem 作为记录商户（Merchant of Record）销售、收款并开具收据；我们不接触、也不保存你的银行卡信息。', only: 'web' },
      ],
    },
    terms: {
      title: '服务条款',
      intro: `这些条款适用于 play-slides.com 与 Slides 的相关应用。使用即表示你接受这些条款。最后更新：${LEGAL_UPDATED}。`,
      items: [
        { term: '谁在运营', body: `本站由一位居住在法国的独立开发者以个人身份运营，没有注册公司。联系邮箱：${E}。` },
        { term: '服务内容', body: 'Slides 是一款滑动益智游戏。基础玩法免费提供。「Slides 天才」是可选订阅，目前不开放（见《价格与订阅》）。' },
        { term: '账号', body: '基础玩法不需要账号。用银行卡在网页版订阅的，付完款要为这个邮箱设一组 6 位密码——邮箱加密码就是你的账号，换台设备用这两样取回订阅。' , only: 'web' },
        { term: '内部码开通的账号', body: '用内部码开通时会留下邮箱和一组 6 位密码；刷卡订阅之后设的密码也是一样，两条路留下的是同一种账号（存了什么见隐私政策）。密码请自己记好——被锁住的是这个账号，不是那张码：密码连续输错 4 次，账号锁 4 小时；错到 6 次就一直锁着，要通过邮箱验证才能重新开启并设置新密码。' },
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
        { term: '谁来退这笔钱', body: 'Creem 是这笔交易的记录商户，退款只能由它执行——我们在 Creem 后台提出，Creem 原路退回。我们没有绕开 Creem 自行退款的途径，也拿不到你的卡。', only: 'web' },
        { term: '多久到账', body: '我们 3 个工作日内回复（这是 Creem 对商户的要求，也是我们的承诺）。款项由 Creem 原路退回，通常 5–10 个工作日到账，具体取决于你的发卡行。', only: 'web' },
        { term: '我们没回你怎么办', body: '按 Creem 的规则，我们超过 3 个工作日没回应，Creem 可以代我们退款；你等了 7 天还没等到答复，可以直接找 Creem 的客服。这是你的权利，不需要经过我们同意。', only: 'web' },
        { term: '取消不等于退款', body: '取消订阅只是停掉未来的扣款。如果你还想要回已经付掉的这一期，请另外提一次退款申请。' },
        { term: '免费的部分', body: '基础玩法本来就免费，不涉及退款。' },
      ],
    },
    privacy: {
      title: '隐私政策',
      intro: `这里说明我们收集什么、为什么、以及你能做什么。先说结论：我们不出售你的任何数据。最后更新：${LEGAL_UPDATED}。`,
      items: [
        { term: '只存在你自己设备上的', body: '语言、教学是否看过、色盲友好开关、声音开关、标签页图标、棋子配色的选择、登录状态的本地缓存、你在多人游玩里取的昵称和当前小屋的座位，以及你的最高分和每局记录（含棋盘截图）。这些放在浏览器的 localStorage 里，不会自动上传；清掉浏览器数据就一起没了。' },
        { term: '登录之后的战绩', body: '登录之后打的每一局，会连同这一局的分数、用时、玩法和你取的名字一起存一份在我们的 Redis 里，挂在你的账号下——换台设备登录，记录跟着回来，成绩也进全球排行榜。榜上写的是你自己取的那个名字，不是邮箱。没登录就一份都不上传，记录只在这台设备上。想删掉云上那份，来信说一声就行。' },
        { term: '多人小屋', body: '开一间或加入一间小屋时，上传的只有你取的昵称、头像图形、这一局的得分与是否交卷，以及进出小屋的时间。棋盘本身在你自己的设备上算，不会上传；我们也不记你的邮箱和 IP。小屋没了，这些就一起没了。' },
        { term: '使用统计', body: '我们用 Vercel Analytics，以及（在配置了的情况下）Google Analytics 4，统计访问量、看了哪些页面、开始和结束了哪种玩法、用时与得分区间。这些是汇总数据，不用来识别你本人。Google Analytics 会使用 Cookie。' },
      { term: '账号', body: '账号有两种，存的东西不一样。**邮箱账号**：你的邮箱、注册时间、你对收邮件的选择和做出选择的那一刻、几个登录令牌（同时登录的设备各一个）。它没有密码——登录靠一张寄到这个邮箱的 6 位验证码，那张码只在我们的库里活 30 分钟，用过或过期就删掉。**免邮箱账号**：你自己取的第一串经 sha256 算出来的那个值（不是第一串本身，我们无法还原）、第二串经 scrypt 加盐后的哈希值（同样无法还原）、登录令牌、注册时间，以及输错次数和锁定状态；这种账号我们连一个邮箱都没有。两种都可能留着后台寄给你的内部码记录（码本身、哪一档、寄出时刻，有到期的话还有到期时刻，以及还剩几张你没点开看过）——「用没用过」不存，每次现场去码库里问。2026 年 10 月之前建立的账号可能还留有当时设的密码哈希和买过的档位，这两样不再新增。这是我们自己保存的唯一一份账号数据。' },
      { term: '邮件', body: '注册时有一个勾选框：要不要收 Slides 的邮件。不勾就不会收到，功能上没有任何区别；勾了我们只用这个邮箱发新玩法、新版本和偶尔的优惠，不会把它给任何广告商或者第三方。每封信底部都有退订链接，点一下就不再发，也可以来信让我们改。你什么时候做的这个选择我们一并记下来，因为需要能说清楚同意是哪一刻给的。跟服务本身有关的信不算营销邮件，不勾也会发：登录或注册时会发一封 6 位验证码，30 分钟内有效。' },
      { term: '数据放在哪', body: '网站由 Vercel 托管。账号、登录之后的战绩，以及多人游玩的小屋，存在我们的 Redis（Vercel KV／Upstash）里；其余设置都在你自己的设备上。这些服务都可能把数据存在欧盟以外，并依据标准合同条款进行跨境传输。' },
      { term: '保留多久', body: '统计数据按各平台的默认周期保留。多人小屋在屋里最后一个人点过它的二十分钟后自动消失（任何人在页面上的任何一次点击都算）。验证码 30 分钟后自己失效。账号和云上的战绩一直留着，直到你来信要求删除——我们没有「不活跃就自动清掉」这回事，所以也不在这儿写一个做不到的期限。设备上的缓存你随时可以自己清掉。' },
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
        { term: '运营者', body: '独立开发者，个人经营，没有注册公司。做游戏，也写作，还是一个学生。' },
        { term: '网站托管', body: 'Vercel Inc.（美国）。' },
        { term: '可用语言', body: '中文、English、Français 都可以。' },
      ],
    },
  },
  zhHant: {
    pricing: {
      title: '價格與訂閱',
      intro: 'Slides 的全部玩法都免費。「Slides 天才」是解鎖額外內容的那一檔。訂閱目前不開放：我們暫時不出售它，現在也沒有任何在續的訂閱。下面寫明這一檔現在是什麼狀態。',
      items: [
        { term: '免費的部分', body: '方塊、圓球兩種基礎玩法，以及計時挑戰、炸彈挑戰、多人遊玩，全部免費，無廣告，不需要註冊。特殊版面裡的菱形方塊和六邊圓球也是免費的；另外兩副（七色圓球、大三角）屬於訂閱，在主選單上掛著鎖，點開看得到是什麼。' },
        { term: '價格', body: '目前不出售，結帳入口已經撤下。此前的價格是 1.99 美元／月、4.99 美元／年；哪天重新開放，會先在本頁寫明。', only: 'web' },
        { term: '訂閱週期', body: '按你選的週期計費：月訂閱每 1 個月一期，年訂閱每 12 個月一期，都從付款當天起算。' },
        { term: '自動續費', body: '不適用：目前沒有任何在續的訂閱，也不會產生任何扣款。', only: 'web' },
        { term: '要不要取消', body: '沒有要取消的東西：目前沒有在續的訂閱。', only: 'web' },
        { term: '退款', body: '見《退款政策》：首次訂閱 14 天內可以無理由全額退款。', only: 'web' },
        { term: '誰收的款', body: '目前沒有在收的款。訂閱開放時由 Creem 作為記錄商戶（Merchant of Record）銷售、收款並開立收據；我們不接觸、也不保存你的信用卡資訊。', only: 'web' },
      ],
    },
    terms: {
      title: '服務條款',
      intro: `這些條款適用於 play-slides.com 與 Slides 的相關應用。使用即表示你接受這些條款。最後更新：${LEGAL_UPDATED}。`,
      items: [
        { term: '誰在營運', body: `本站由一位居住在法國的獨立開發者以個人身分營運，沒有註冊公司。聯絡信箱：${E}。` },
        { term: '服務內容', body: 'Slides 是一款滑動益智遊戲。基礎玩法免費提供。「Slides 天才」是選配訂閱，目前不開放（見《價格與訂閱》）。' },
        { term: '帳號', body: '基礎玩法不需要帳號。用信用卡在網頁版訂閱的，付完款要為這個信箱設一組 6 位密碼——信箱加密碼就是你的帳號，換台裝置用這兩樣取回訂閱。', only: 'web' },
        { term: '內部碼開通的帳號', body: '用內部碼開通時會留下信箱和一組 6 位密碼；刷卡訂閱之後設的密碼也是一樣，兩條路留下的是同一種帳號（存了什麼見隱私政策）。密碼請自己記好——被鎖住的是這個帳號，不是那張碼：密碼連續輸錯 4 次，帳號鎖 4 小時；錯到 6 次就一直鎖著，要透過電子郵件驗證才能重新開啟並設定新密碼。' },
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
        { term: '誰來退這筆錢', body: 'Creem 是這筆交易的記錄商戶，退款只能由它執行——我們在 Creem 後台提出，Creem 原路退回。我們沒有繞開 Creem 自行退款的途徑，也拿不到你的卡。', only: 'web' },
        { term: '多久入帳', body: '我們 3 個工作天內回覆（這是 Creem 對商戶的要求，也是我們的承諾）。款項由 Creem 原路退回，通常 5–10 個工作天入帳，實際取決於你的發卡行。', only: 'web' },
        { term: '我們沒回你怎麼辦', body: '按 Creem 的規則，我們超過 3 個工作天沒回應，Creem 可以代我們退款；你等了 7 天還沒等到答覆，可以直接找 Creem 的客服。這是你的權利，不需要經過我們同意。', only: 'web' },
        { term: '取消不等於退款', body: '取消訂閱只是停掉未來的扣款。如果你還想要回已經付掉的這一期，請另外提一次退款申請。' },
        { term: '免費的部分', body: '基礎玩法本來就免費，不涉及退款。' },
      ],
    },
    privacy: {
      title: '隱私政策',
      intro: `這裡說明我們收集什麼、為什麼、以及你能做什麼。先說結論：我們不販售你的任何資料。最後更新：${LEGAL_UPDATED}。`,
      items: [
        { term: '只存在你自己裝置上的', body: '語言、教學是否看過、色盲友善開關、聲音開關、分頁圖示、棋子配色的選擇、登入狀態的本機快取、你在多人遊玩裡取的暱稱和目前小屋的座位，以及你的最高分和每局紀錄（含棋盤截圖）。這些放在瀏覽器的 localStorage 裡，不會自動上傳；清掉瀏覽器資料就一起沒了。' },
        { term: '登入之後的戰績', body: '登入之後打的每一局，會連同這一局的分數、用時、玩法和你取的名字一起存一份在我們的 Redis 裡，掛在你的帳號下——換台裝置登入，紀錄跟著回來，成績也進全球排行榜。榜上寫的是你自己取的那個名字，不是信箱。沒登入就一份都不上傳，紀錄只在這台裝置上。想刪掉雲端那份，來信說一聲就行。' },
        { term: '多人小屋', body: '開一間或加入一間小屋時，上傳的只有你取的暱稱、頭像圖形、這一局的得分與是否交卷，以及進出小屋的時間。棋盤本身在你自己的裝置上算，不會上傳；我們也不記你的信箱和 IP。小屋沒了，這些就一起沒了。' },
        { term: '使用統計', body: '我們用 Vercel Analytics，以及（在有設定的情況下）Google Analytics 4，統計造訪量、看了哪些頁面、開始和結束了哪種玩法、用時與分數區間。這些是彙總資料，不用來識別你本人。Google Analytics 會使用 Cookie。' },
      { term: '帳號', body: '帳號有兩種，存的東西不一樣。**電子郵件帳號**：你的電子郵件、註冊時間、你對收信的選擇和做出選擇的那一刻、幾個登入權杖（同時登入的裝置各一個）。它沒有密碼——登入靠一組寄到這個信箱的 6 位驗證碼，那組碼只在我們的庫裡活 30 分鐘，用過或過期就刪掉。**免信箱帳號**：你自己取的第一串經 sha256 算出來的那個值（不是第一串本身，我們無法還原）、第二串經 scrypt 加鹽後的哈希值（同樣無法還原）、登入權杖、註冊時間，以及輸錯次數和鎖定狀態；這種帳號我們連一個電子郵件都沒有。兩種都可能留著後台寄給你的內部碼記錄（碼本身、哪一檔、寄出時刻，有到期的話還有到期時刻，以及還剩幾張你沒點開看過）——「用沒用過」不存，每次現場去碼庫裡問。2026 年 10 月之前建立的帳號可能還留有當時設的密碼哈希和買過的檔位，這兩樣不再新增。這是我們自己保存的唯一一份帳號資料。' },
      { term: '郵件', body: '註冊時有一個勾選框：要不要收 Slides 的郵件。不勾就不會收到，功能上沒有任何區別；勾了我們只用這個信箱發新玩法、新版本和偶爾的優惠，不會把它給任何廣告商或者第三方。每封信底部都有退訂連結，點一下就不再發，也可以來信讓我們改。你什麼時候做的這個選擇我們一併記下來，因為需要能說清楚同意是哪一刻給的。跟服務本身有關的信不算行銷郵件，不勾也會發：登入或註冊時會發一封 6 位驗證碼，30 分鐘內有效。' },
      { term: '資料放在哪', body: '網站由 Vercel 託管。帳號、登入之後的戰績，以及多人遊玩的小屋，存在我們的 Redis（Vercel KV／Upstash）裡；其餘設定都在你自己的裝置上。這些服務都可能把資料存在歐盟以外，並依據標準合約條款進行跨境傳輸。' },
      { term: '保留多久', body: '統計資料按各平台的預設週期保留。多人小屋在屋裡最後一個人點過它的二十分鐘後自動消失（任何人在頁面上的任何一次點擊都算）。驗證碼 30 分鐘後自己失效。帳號和雲上的戰績一直留著，直到你來信要求刪除——我們沒有「不活躍就自動清掉」這回事，所以也不在這兒寫一個做不到的期限。裝置上的快取你隨時可以自己清掉。' },
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
        { term: '營運者', body: '獨立開發者，個人經營，沒有註冊公司。做遊戲，也寫作，還是一個學生。' },
        { term: '網站代管', body: 'Vercel Inc.（美國）。' },
        { term: '可用語言', body: '中文、English、Français 都可以。' },
      ],
    },
  },
  en: {
    pricing: {
      title: 'Pricing & subscription',
      intro: 'Every game mode in Slides is free. "Slides Genius" is the tier that unlocks extra content. The subscription is currently closed: we are not selling it at the moment, and there are no running subscriptions. Below is where that tier stands today.',
      items: [
        { term: "What's free", body: 'Both base games — squares and balls — plus the timed challenge, the bomb challenge and multiplayer. No ads, no account needed. Among the extra layouts, diamond squares and hex balls are free as well; the remaining two (seven-colour balls and the big triangle) belong to the subscription and carry a lock on the home screen.' },
        { term: 'Price', body: 'Not on sale at the moment; the checkout has been taken down. The price was US$1.99 per month or US$4.99 per year. If it opens again, this page will say so first.', only: 'web' },
        { term: 'Billing period', body: 'You are billed for the period you pick: a monthly subscription renews every 1 month, a yearly one every 12 months, counted from the day you pay.' },
        { term: 'Automatic renewal', body: 'Does not apply: there are no running subscriptions, and nothing is being charged.', only: 'web' },
        { term: 'Is there anything to cancel', body: 'No: there are no running subscriptions.', only: 'web' },
        { term: 'Refunds', body: 'See the refund policy: a full, no-questions refund within 14 days of your first purchase.', only: 'web' },
        { term: 'Who takes the payment', body: 'Nothing is being charged at the moment. When the subscription is open, Creem sells it as merchant of record and handles payment and receipts; we never see or store your card details.', only: 'web' },
      ],
    },
    terms: {
      title: 'Terms of service',
      intro: `These terms cover play-slides.com and the Slides apps. Using the service means you accept them. Last updated ${LEGAL_UPDATED}.`,
      items: [
        { term: 'Who runs this', body: `Slides is run by an independent developer based in France, acting as an individual — there is no registered company. Contact: ${E}.` },
        { term: 'What the service is', body: 'Slides is a sliding puzzle game. The base games are free. "Slides Genius" is an optional subscription, currently closed (see Pricing & subscription).' },
        { term: 'Accounts', body: 'The base games need no account. For a subscription bought by card on the site, you set a six-character passcode for that address after paying — the address and the passcode together are your account, and the two of them bring the subscription back on another device.', only: 'web' },
        { term: 'Accounts made by a code', body: 'Redeeming a code leaves an email address and a six-character passcode with us; so does the passcode you set after paying by card — both routes leave the same kind of account (the privacy policy says what it holds). Remember it: what gets locked is the account, not the code. Four wrong tries lock the account for four hours; six leave it locked until you verify by email and set a new passcode.' },
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
        { term: 'Who actually refunds it', body: 'Creem is the merchant of record for the sale, so only Creem can issue the refund — we request it in Creem’s dashboard and Creem returns the money to the original payment method. We have no way to refund outside Creem, and we never hold your card.', only: 'web' },
        { term: 'How long it takes', body: 'We reply within 3 working days — that is Creem’s requirement of us as well as our own promise. Creem returns the money to the original payment method, usually landing in 5–10 working days, depending on your bank.', only: 'web' },
        { term: 'If we do not answer', body: 'Under Creem’s rules, if we have not replied within 3 working days Creem may refund on our behalf; and if you have waited 7 days without an answer you can contact Creem support directly. That is your right and needs no permission from us.', only: 'web' },
        { term: 'Cancelling is not refunding', body: 'Cancelling only stops future charges. If you also want the current period back, ask for a refund separately.' },
        { term: 'The free part', body: 'The base games are free, so there is nothing to refund there.' },
      ],
    },
    privacy: {
      title: 'Privacy policy',
      intro: `What we collect, why, and what you can do about it. The short version: we do not sell any of your data. Last updated ${LEGAL_UPDATED}.`,
      items: [
        { term: 'Kept on your own device only', body: 'Your language, whether you have seen each tutorial, the colourblind and sound switches, your tab icon, your choice of piece palette, the cached state of being signed in, the nickname you play multiplayer under and your seat in the current room, and your best scores and per-run records (including the board snapshots). All of it lives in your browser’s localStorage and is never uploaded on its own; clearing your browser data deletes it.' },
        { term: 'Runs, once you are signed in', body: 'Every run you finish while signed in is also stored in our Redis under your account: the score, how long it took, which board, and the name you chose — so a new device brings your records back with it, and the run goes on the global leaderboard. The board shows the name you picked, never an email address. Signed out, nothing is uploaded and your records stay on the device. Ask us and we will delete the cloud copy.' },
        { term: 'Multiplayer rooms', body: 'Opening or joining a room uploads only the nickname you chose, your avatar shape, this round’s score and whether you have handed in, and the times you came and went. The board itself is worked out on your own device and never leaves it; we record neither your email address nor your IP. When the room goes, this goes with it.' },
        { term: 'Usage statistics', body: 'We use Vercel Analytics and, where it is configured, Google Analytics 4 to count visits, which screens are opened, which mode was started and finished, and the range of times and scores. This is aggregate data and is not used to identify you. Google Analytics sets cookies.' },
      { term: 'Accounts', body: 'There are two kinds, and they hold different things. **Email accounts**: your address, when you signed up, whether you asked for our email and the moment you said so, and a few sign-in tokens (one per device signed in at once). There is no password — signing in means typing a six-digit code we email you, and that code lives in our store for thirty minutes before it is used or deleted. **Address-free accounts**: the sha256 of the first string you chose (not the string itself; we cannot recover it), the scrypt hash of the second one (likewise unrecoverable), sign-in tokens, when you signed up, and the count of wrong tries with any lock it caused — for these accounts we hold no email address at all. Either kind may also carry insider codes we posted to it: the code, which tier, when it was sent, an expiry if it has one, and how many you have not yet opened — whether a code has been spent is not stored, we ask the code store each time. Accounts made before October 2026 may still carry the password hash and purchased tier from back then; neither is written any more. This is the only account record we keep.' },
      { term: 'Email from us', body: 'Signing up offers a checkbox: would you like email from Slides. Leave it unticked and you get none, with no difference to anything you can do; tick it and we use the address for new boards, new versions and the occasional offer, and we give it to no advertiser or third party. Every message carries an unsubscribe link, and writing to us works too. We note when you made the choice, because we need to be able to say when consent was given. Mail about the service itself is not marketing and is sent either way: signing up or signing in sends one six-digit code, good for thirty minutes.' },
      { term: 'Where the data sits', body: 'The site is hosted by Vercel. Accounts, your runs once signed in, and multiplayer rooms live in our Redis (Vercel KV / Upstash); every other setting stays on your own device. These services may hold data outside the EU, transferred under standard contractual clauses.' },
      { term: 'How long we keep it', body: 'Statistics are kept for each platform’s default period. A multiplayer room disappears twenty minutes after the last tap anyone made in it (any tap on the page counts). A sign-in code expires by itself after thirty minutes. Accounts and the runs stored for them stay until you write and ask us to delete them — there is no "deleted after N years of inactivity" job in this codebase, so we will not print a deadline here that we do not keep. The cache on your device is yours to clear whenever you like.' },
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
        { term: 'Operator', body: 'An independent developer, operating as an individual with no registered company. Makes games, writes, and is also a student.' },
        { term: 'Hosting', body: 'Vercel Inc. (United States).' },
        { term: 'Languages', body: 'English, Français, 中文.' },
      ],
    },
  },
  fr: {
    pricing: {
      title: 'Tarifs et abonnement',
      intro: 'Tous les modes de jeu de Slides sont gratuits. « Slides Génie » est la formule qui débloque du contenu supplémentaire. L’abonnement est actuellement fermé : nous ne le vendons pas pour le moment, et aucun abonnement n’est en cours. Voici où en est cette formule aujourd’hui.',
      items: [
        { term: 'Ce qui est gratuit', body: 'Les deux jeux de base — carrés et billes — ainsi que le défi chronométré, le défi bombe et le multijoueur. Sans publicité et sans compte. Parmi les dispositions supplémentaires, les carrés en losange et les billes hexagonales sont gratuits eux aussi ; les deux autres (billes sept couleurs et grand triangle) relèvent de l’abonnement et portent un cadenas sur l’écran d’accueil.' },
        { term: 'Prix', body: 'Pas en vente pour le moment ; la page de paiement a été retirée. Le prix était de 1,99 $US par mois ou 4,99 $US par an. En cas de réouverture, cette page l’indiquera d’abord.', only: 'web' },
        { term: 'Période de facturation', body: 'Vous êtes facturé pour la période choisie : un abonnement mensuel se renouvelle tous les mois, un abonnement annuel tous les 12 mois, à compter du jour du paiement.' },
        { term: 'Renouvellement automatique', body: 'Sans objet : aucun abonnement n’est en cours et rien n’est prélevé.', only: 'web' },
        { term: 'Y a-t-il quelque chose à résilier', body: 'Non : aucun abonnement n’est en cours.', only: 'web' },
        { term: 'Remboursement', body: 'Voir la politique de remboursement : remboursement intégral et sans motif dans les 14 jours suivant le premier achat.', only: 'web' },
        { term: 'Qui encaisse', body: 'Rien n’est encaissé pour le moment. Lorsque l’abonnement est ouvert, Creem le vend en tant que marchand officiel (merchant of record) et gère le paiement et les reçus ; nous ne voyons ni ne conservons jamais vos données bancaires.', only: 'web' },
      ],
    },
    terms: {
      title: 'Conditions d’utilisation',
      intro: `Ces conditions couvrent play-slides.com et les applications Slides. Utiliser le service vaut acceptation. Dernière mise à jour : ${LEGAL_UPDATED}.`,
      items: [
        { term: 'Qui édite ce site', body: `Slides est édité à titre individuel par un développeur indépendant résidant en France ; il n’existe pas de société enregistrée. Contact : ${E}.` },
        { term: 'Le service', body: 'Slides est un jeu de puzzle à glissement. Les jeux de base sont gratuits. « Slides Génie » est un abonnement facultatif, actuellement fermé (voir Tarifs et abonnement).' },
        { term: 'Comptes', body: 'Les jeux de base ne demandent aucun compte. Pour un abonnement payé par carte sur le site, vous choisissez après le paiement un mot de passe de six caractères pour cette adresse — l’adresse et le mot de passe forment votre compte, et à eux deux ils rouvrent l’abonnement sur un autre appareil.', only: 'web' },
        { term: 'Comptes créés par un code', body: 'Utiliser un code laisse chez nous une adresse courriel et un mot de passe de six caractères ; le mot de passe défini après un paiement par carte fait de même — les deux chemins laissent le même type de compte (la politique de confidentialité dit ce qu’il contient). Retenez-le : ce qui se verrouille est le compte, pas le code. Quatre erreurs verrouillent le compte pendant quatre heures ; six le laissent verrouillé jusqu’à une vérification par courriel et la définition d’un nouveau mot de passe.' },
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
        { term: 'Qui rembourse réellement', body: 'Creem est le vendeur officiel (merchant of record) de la transaction : lui seul peut rembourser. Nous le demandons depuis le tableau de bord Creem, et Creem recrédite le moyen de paiement d’origine. Nous n’avons aucun moyen de rembourser en dehors de Creem, et nous ne détenons jamais votre carte.', only: 'web' },
        { term: 'Délais', body: 'Nous répondons sous 3 jours ouvrés — c’est à la fois l’exigence de Creem envers nous et notre propre engagement. Creem recrédite le moyen de paiement d’origine, généralement sous 5 à 10 jours ouvrés selon votre banque.', only: 'web' },
        { term: 'Si nous ne répondons pas', body: 'Selon les règles de Creem, passé 3 jours ouvrés sans réponse de notre part, Creem peut rembourser à notre place ; et si vous attendez depuis 7 jours sans réponse, vous pouvez écrire directement au support de Creem. C’est votre droit, il ne dépend pas de nous.', only: 'web' },
        { term: 'Résilier n’est pas rembourser', body: 'La résiliation arrête seulement les prélèvements à venir. Si vous voulez aussi récupérer la période en cours, faites une demande de remboursement séparée.' },
        { term: 'La partie gratuite', body: 'Les jeux de base sont gratuits : il n’y a rien à rembourser de ce côté.' },
      ],
    },
    privacy: {
      title: 'Politique de confidentialité',
      intro: `Ce que nous collectons, pourquoi, et ce que vous pouvez faire. En résumé : nous ne vendons aucune de vos données. Dernière mise à jour : ${LEGAL_UPDATED}.`,
      items: [
        { term: 'Conservé uniquement sur votre appareil', body: 'Votre langue, les tutoriels déjà vus, les interrupteurs daltonisme et son, votre icône d’onglet, votre choix de palette, l’état de votre connexion mis en cache, le pseudonyme sous lequel vous jouez en multijoueur et votre place dans la salle en cours, ainsi que vos meilleurs scores et vos parties enregistrées (captures du plateau comprises). Tout cela vit dans le localStorage de votre navigateur et n’est jamais envoyé de lui-même ; effacer les données du navigateur le supprime.' },
        { term: 'Vos parties, une fois connecté', body: 'Chaque partie terminée en étant connecté est aussi enregistrée dans notre Redis sous votre compte : le score, la durée, le plateau et le pseudonyme choisi — ainsi un nouvel appareil retrouve vos parties, et le score entre au classement mondial. Le classement affiche le pseudonyme, jamais une adresse courriel. Déconnecté, rien n’est envoyé et vos parties restent sur l’appareil. Écrivez-nous et nous supprimons la copie en ligne.' },
        { term: 'Salles multijoueur', body: 'Ouvrir ou rejoindre une salle n’envoie que le pseudonyme choisi, la forme de votre avatar, le score de la manche et le fait d’avoir rendu, ainsi que vos heures d’arrivée et de départ. Le plateau lui-même est calculé sur votre appareil et n’en sort jamais ; nous n’enregistrons ni votre adresse courriel ni votre IP. Quand la salle disparaît, cela disparaît avec elle.' },
        { term: 'Statistiques d’usage', body: 'Nous utilisons Vercel Analytics et, lorsqu’il est configuré, Google Analytics 4 pour compter les visites, les écrans ouverts, le mode commencé et terminé, et les plages de durée et de score. Ce sont des données agrégées, qui ne servent pas à vous identifier. Google Analytics dépose des cookies.' },
      { term: 'Comptes', body: 'Il y en a deux sortes, qui ne contiennent pas la même chose. **Comptes avec adresse** : votre adresse, la date d’inscription, votre choix de recevoir nos courriels et le moment où vous l’avez fait, et quelques jetons de connexion (un par appareil connecté en même temps). Il n’y a pas de mot de passe — on se connecte avec un code à six chiffres envoyé par courriel, et ce code ne vit que trente minutes dans notre base avant d’être utilisé ou supprimé. **Comptes sans adresse** : le sha256 de la première chaîne que vous avez choisie (pas la chaîne elle-même, nous ne pouvons pas la retrouver), le hachage scrypt de la seconde (également irrécupérable), les jetons de connexion, la date d’inscription, ainsi que le nombre d’essais erronés et le verrouillage éventuel ; pour ces comptes nous n’avons aucune adresse e-mail. Les deux sortes peuvent aussi porter les codes Génie que nous vous avons envoyés : le code, le palier, la date d’envoi, une expiration s’il en a une, et combien vous n’avez pas encore ouverts — nous ne stockons pas si un code a été utilisé, nous le demandons chaque fois à la base des codes. Les comptes créés avant octobre 2026 peuvent encore porter le hachage du mot de passe et le palier acheté de l’époque ; ni l’un ni l’autre n’est plus écrit. C’est le seul enregistrement de compte que nous gardons.' },
      { term: 'Nos courriels', body: 'À l’inscription, une case à cocher : voulez-vous des courriels de Slides. Non cochée, vous n’en recevez aucun, sans aucune différence sur ce que vous pouvez faire ; cochée, nous utilisons l’adresse pour les nouveaux plateaux, les nouvelles versions et une offre occasionnelle, et nous ne la donnons à aucun annonceur ni tiers. Chaque message porte un lien de désabonnement, et nous écrire fonctionne aussi. Nous notons le moment de ce choix, car nous devons pouvoir dire quand le consentement a été donné. Les courriels liés au service ne sont pas du marketing et partent dans tous les cas : une inscription ou une connexion envoie un code à six chiffres, valable trente minutes.' },
      { term: 'Où sont les données', body: 'Le site est hébergé par Vercel. Les comptes, vos parties une fois connecté et les salles multijoueur vivent dans notre Redis (Vercel KV / Upstash) ; tous les autres réglages restent sur votre appareil. Ces services peuvent conserver des données hors de l’UE, transférées selon les clauses contractuelles types.' },
      { term: 'Durée de conservation', body: 'Les statistiques sont conservées selon la période par défaut de chaque plateforme. Une salle multijoueur disparaît vingt minutes après le dernier appui de quiconque dans celle-ci (tout appui sur la page compte). Un code de connexion expire de lui-même au bout de trente minutes. Les comptes et les parties qui y sont attachées restent jusqu’à ce que vous nous écriviez pour demander leur suppression — il n’existe dans ce code aucune tâche « supprimé après N années d’inactivité », donc nous n’inscrivons pas ici un délai que nous ne tenons pas. Le cache sur votre appareil, vous pouvez l’effacer quand vous voulez.' },
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
        { term: 'Éditeur', body: 'Un développeur indépendant exerçant à titre individuel, sans société enregistrée. Il fait des jeux, écrit, et est aussi étudiant.' },
        { term: 'Hébergeur', body: 'Vercel Inc. (États-Unis).' },
        { term: 'Langues', body: 'Français, English, 中文.' },
      ],
    },
  },
};

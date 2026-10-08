export type Lang = 'en' | 'fr' | 'zhHant' | 'zhHans';

export const LANG_STORAGE_KEY = 'slides_lang';
export const TUTORIAL_SEEN_KEY = 'slides_tutorial_seen';

export interface I18nStrings {
  langName: string;
  homeTagline: string;
  /** 新手拦截底下那颗小按钮：《我会玩》，按下去引导的锁全撤（见 engine/firstPlay.ts）。 */
  knowHow: string;
  next: string;
  prev: string;
  /**
   * 教学条右边那颗《‹》的读屏名：把上一条摆回来看一眼（ui/coachBar.ts 的 peek）。专门一个，不借《返回》
   * （back）——那颗键不退出任何东西，读屏念「返回」，按下去的人以为要离开这一局（10-08 方案第四批第 8 条）。
   * 也不借上面那个 prev：它英文写的是「Back」，是分镜教学那颗键的。
   */
  coachPrev: string;
  replay: string;
  doneBtn: string;
  pause: string;
  resume: string;
  run4: string;
  flip: string;
  navProfile: string;
  navRecords: string;
  noRecordsYet: string;
  /**
   * 记录页空态**换规则那一次**专用的一句（《侵蚀阶梯》v1.2 §6）。
   *
   * 只对「本机真被清掉过存档」的人说；新装的设备照旧说 noRecordsYet——对一台从没
   * 打过的设备说「战绩从这里重新开始」，是一句没头没脑的话。
   */
  recordsResetByRules: string;
  switchLanguage: string;
  // ---- home page ----
  sectionTimed: string;
  /** 《无限反转》：名字，和挑图形那一屏底下那句规矩。 */
  flipModeTitle: string;
  flipModeTagline: string;
  /**
   * 《计时挑战》挑图形那一屏，图底下那一句。
   *
   * 和 MODE_TIPS.timed（「限时100s，能得多少分呢？」）是两件事，两句并存：这一句是
   * **挑形状那一屏**的标语，那一句是**局中**棋盘底下那条教学。MODE_TIPS 里 timed
   * 和 layout 两条是玩家逐字点的名，中文一个字都不要动（见那一段的说明）。
   */
  timedModeTagline: string;
  /**
   * 小屋里开无限反转那一局时，等待屏上那一句：这一局和别的局差在哪儿。
   *
   * 从前写的是「连击加成减弱：连续得分每次 ×1.5 · 没有时间奖励」——《侵蚀阶梯》
   * v1.2 之后这句话两头都错了：连击倍率整个没有了，时间奖励**谁都没有**（时间不
   * 再计分）。说一个别人有、你没有的东西，比不说更糟。
   *
   * 现在说的是这一局真正的两处不同：图案不吃侵蚀（整局 4 枚），不乘步数系数。
   */
  flipScoringHint: string;
  /** 《真正解密 · 步步为营》：名字，和挑图形那一屏底下那句规矩。 */
  puzzleModeTitle: string;
  puzzleModeTagline: string;
  /** 步步为营 HUD 第三格的抬头（别的玩法那一格写「用时」）。 */
  stepsLeftLabel: string;
  /** 步步为营的结束理由（engine/puzzleScore.ts 的 PUZZLE_STEPS_OUT_REASON）。 */
  stepsOutReason: string;
  /**
   * 步步为营结算页那六行（见 engine/runRecord.ts 的 runBreakdown）。
   *
   * {n} 是每一枚值多少分——从 puzzleScore.ts 的常数填进来，不写死在文案里：
   * 10 和 5 是暂定值，改常数的时候这两句要跟着改口，而不是变成假话。{c} 是枚数。
   *
   * ⚠️ **一行讲一件事。** 从前是四行，最后一行的**值**是一整句「连续多退 m · 消边多退
   * e · 剩 l（最多攒到 p）」——右边那一栏本来只容得下一个数，法语里那一句有七十多个字
   * 符，于是它要么压住左边的抬头，要么被结算页那块板子裁掉。分享卡更糟：那一栏是按最
   * 宽的一行缩字号的，一句话把整张卡的明细全带小了一圈。
   */
  puzzleClearedLabel: string;
  puzzleStarsLabel: string;
  /**
   * 「走了 {n} 步（得分 {k} 步）」——右边不摆数，整句就是它自己。
   *
   * 英法文用 `|` 分单复数（走 countPhrase，看的是 {n}）。{k} 那一截没有第二套单复数可
   * 挑，所以法文写成不随数变的说法（« avec points »）——原先的 « ({k} ont marqué) »
   * 在 k=1 时是 « 1 ont marqué »，和「1 coups」是同一种错。
   */
  puzzleStepsLabel: string;
  /** 「连续多退」，右边是 +{m}。 */
  puzzleStreakLabel: string;
  /** 「消边多退」，右边是 +{e}。 */
  puzzleEdgeLabel: string;
  /** 「剩 {l}（最多攒到 {p}）」——右边不摆数。 */
  puzzleLeftLabel: string;
  bombBasicTitle: string;
  bombTimedTitle: string;
  bombAdvancedTitle: string;
  // 炸弹选择页面板左边那三个字（bombTierBasic / Timed / Advanced，第 18 推）撤了：10-08 方案 3-G
  // 换成三枚小图标（ctlIcons 的 CTL_TIER_*），「省掉一组四语文案」。
  randomTargetTitle: string;
  /**
   * 老虎机挑图形那一屏，三张图底下那一句。
   *
   * 这一屏从前一个字都没有（玩家当时的原话是「不需要任何文字指示」），可三张图
   * 只说得出「选哪一族」，说不出「这一局的得分图案是随机抽的」——而那正是这个玩
   * 法和基础玩法唯一的区别。
   *
   * 和 MODE_TIPS.slot 是两件事，别混：这一句是**挑形状那一屏**的标语（对应
   * flipModeTagline），MODE_TIPS.slot 是**局中**棋盘底下那句教学。《无限反转》
   * 那三层——菜单标题 / 选择页标语 / 局中教学——本来就是分开的，这一句补上之后
   * 两个玩法的结构才对齐。
   */
  randomTargetTagline: string;
  /** 小屋里的随机得分目标：全屋同一对图案，还是各转各的。 */
  slotShareCaption: string;
  slotSameLabel: string;
  slotOwnLabel: string;
  /** 《老虎机模式》介绍页：三台机器底下那颗键的两种字（红 STOP / 绿 开始），
   *  和右下角那颗《开始 〉》。 */
  slotDemoStop: string;
  slotStartLabel: string;
  comingSoon: string;
  multiplayerTitle: string;
  rankingsTitle: string;
  /** 排行榜那一块。 */
  rankTotalBoard: string;
  /** 排行榜上那六个母标签。点开来是它旗下的几张榜（见 ui/leaderboard 的 boardGroups）。 */
  rankTabBase: string;
  rankTabTimed: string;
  rankTabBomb: string;
  rankTabLayout: string;
  rankTabSlot: string;
  rankTabFlip: string;
  rankTabPuzzle: string;
  rankLocked: string;
  rankLockedCta: string;
  rankSignedOut: string;
  rankEmpty: string;
  /**
   * 榜没拉下来（网断了、服务器没回）——和「这张榜上还没有人」是两件事（2026-10-08 方案 2-8）。
   * 从前拉不到也落在 rankEmpty 上，玩家看着一张空榜，以为真没人玩。
   */
  rankNetwork: string;
  /**
   * 每日挑战那一局交上去，服务器说它没进「今日」榜（交晚了，或者日子 / 种子对不上——2026-10-08
   * 方案 2-11）。日子和种子都是按本机的钟算的，钟不对就是这两种，所以提一句设备的日期。
   */
  dailyNotCounted: string;
  /** 榜上没取过名字的那一行。见 engine/nickname.ts 的 leaderboardName。 */
  rankAnon: string;
  /**
   * 昵称（第 16 推）：个人主页头卡上那一格。登录了、还没登记昵称时显示 nickSet；✎ 那颗键的
   * aria-label 是 nickEdit，原地编辑时 ✓ / ✕ 的 aria-label 是 nickSave / nickCancel。
   */
  nickSet: string;
  nickEdit: string;
  nickSave: string;
  nickCancel: string;
  /**
   * 改名失败的四句话（api/scores.js 的 rename 回的那四种）。blocked **只说「换一个」**，不说撞
   * 了哪个词（见 api/_badwords.js 文件头）。小屋里没登录的人敲的名字过不了关，也用这几句。
   */
  nickTaken: string;
  nickBlocked: string;
  nickBad: string;
  nickRequired: string;
  /**
   * 步步为营清盘的那一局还剩几步（第 14 推）：排行榜那一行、战绩图上「全部消完了」后面。
   * 「单数|复数」两种写法，走 countPhrase。
   */
  puzzleLeftSteps: string;
  rankLoading: string;
  rankExpired: string;
  rankReLogin: string;
  /**
   * 那根拉杆的名字。原先叫「图形翻面速度」——可站里已经不再有「翻面」这件事
   * 了（玩家 2026-09 定的：色块得分就变成星星，不要再用翻面/正面/反面去解释
   * 它）。它是界面上最后一处写着「翻面」的字。
   */
  flipSpeedTitle: string;
  flipSpeedHint: string;
  flipSpeedLocked: string;
  flipSpeedSlow: string;
  flipSpeedFast: string;
  flipSpeedPick: string;
  totalScoreTitle: string;
  totalScoreSync: string;
  // ---- 各页通用的返回键 ----
  backToMenu: string;
  /** The end-of-run summary's way out — short, since it sits beside two
   *  other buttons on one row. */
  homeBtn: string;
  /** Shown on a wide board's start card, under the turn-your-phone glyph. */
  rotateHint: string;
  back: string;
  // ---- account page ----
  /**
   * 《账号》——已登录的人点开的那一扇窗，抬头就这两个字。全站只用「账号」
   * 这一个词（「账户」从前在这儿和几处混着用，指的是同一件事）；只有
   * {store} 那两句说的是苹果／谷歌自己的账号，不是我们这儿的。
   *
   * 不写「你已是 Slides 天才」：登录和有权限是两回事（玩家原话：「登录是登
   * 录……登录不代表有权限」）。一个订阅到期的人照样登得进来看自己的战绩、换
   * 密码、兑一张内部码，给他挂一块「你已是天才」的招牌是说假话。是不是天
   * 才，由窗里那一段《订单情况》如实回答。
   */
  accountTitle: string;
  loginGateway: string;
  tutorialShort: string;
  becomeGenius: string;
  geniusSpecialTitle: string;
  /** 付费墙上「订阅后立刻拿到」那一段的小标题。 */
  geniusNowTitle: string;
  /**
   * 付费墙上「还没做、做完自动包含」那一段的小标题。
   *
   * 分段的规矩：**确定的、已经做好的** 排进上面《订阅后立刻解锁》那一段；
   * 剩下的排这一段。所以这一句只需要说「还没到」，不必再说一遍「正在做」
   * ——原先写的是「正在制作　敬请期待」，两句话说的是同一件事。
   */
  geniusSoonTitle: string;
  /**
   * 付费墙上「订阅后立刻解锁」那三条的说法。
   *
   * 比棋盘本身的名字长，也应该更长：主菜单上的图标旁边只要认得出是哪个
   * 就够了，这里是要让一个还没付钱的人看懂他买到的是什么。
   */
  geniusNowCircleSeven: string;
  geniusNowTriangleBig: string;
  /** 开多人房间——GENIUS_LAYOUTS 之外唯一一件订阅立刻拿到的东西。 */
  geniusHostRooms: string;
  // ---- subscription: the paywall, and the web's e-mail sign-in ----
  /** Title of the window the 成为 Slides 天才 button opens. */
  subscribeTitle: string;
  /**
   * 停售之后那一窗开头那句话（《侵蚀阶梯》PR-12 / E11，2026-10）。
   *
   * 和 `notOnSaleYet` 不是一回事：那一句说的是「还没开」（结账接口答 503 时用），
   * 这一句说的是「开过，现在停了」。两句话指向两种完全不同的状态，共用一句会在其中
   * 一种情形下变成假话——而这一窗上的每一句都要和《价格与订阅》对得上。
   */
  /*
   * registerUnlocks（「注册后免费立即解锁全部内容」）撤了（第 17 推）：邀请窗的抬头说的就是
   * 这一句，两行说同一件事，方案点名删掉。
   */
  /**
   * 「还剩 {n} 个名额」。
   *
   * ⚠️ **2026-10-02 起没人用它了**（E39：名额整个撤掉，不限人数）。摆在这儿是因为撤
   * 一个 key 要动四语四处，和撤那一整套前端是同一件事，一并留给那一轮
   * （推送 2 的 i18n 清理）。
   */
  /** 注册那颗键。 */
  registerBtn: string;
  /** The two billing periods, as a price is labelled: "每月" / "每年". */
  planMonthly: string;
  planYearly: string;
  restoreBtn: string;
  signInBtn: string;
  signOutBtn: string;
  emailLabel: string;
  emailPlaceholder: string;
  emailInvalid: string;
  /** Why the site asks for an address and the app never does. */
  /**
   * 注册这一栏说的是什么。
   *
   * 两度取代：先是「刷卡订阅只需要电子邮件，不用设密码」，接着是
   * 「注册就是订阅。先付款，再……」。后面那一句在 2026-10 之后不成立
   * 了——Creem 的两个订阅商品暂时关掉，注册不再经过任何结账页，这一屏
   * 自己收邮箱和密码（E11 / PR-12）。
   *
   * 现在这一句**只说这张表要填什么**，不带任何承诺。「注册就解锁全部
   * 功能、还剩几个名额」那句话印在天才那一屏上，而那一句是服务端
   * （/api/slots）说得出才摆出来的——名额满了它自己就不见了。把承诺挪
   * 到这儿来，就等于让界面自己猜，而猜出来的承诺正是这个仓库躲着的那
   * 种东西。
   */
  signInHint: string;
  /** Carries {store} — "App Store" or "Google Play", per platform. */
  storeNoAccountHint: string;
  subscribedTitle: string;
  manageSubscription: string;
  /** Also carries {store}: where a store subscription is cancelled. */
  manageOnStore: string;
  geniusStatus: string;
  /** Badge on a 「+」 board that the subscription unlocks. */
  geniusOnly: string;
  // ---- redeem codes, and the account one creates ----
  /**
   * 「密码」这个词。
   *
   * ⚠️ **这一档 2026-10 整个没有了**（E37：身份换成验证码 / 两串凭据，密码连同那扇
   * 《忘记密码》窗一起撤了）。剩下这两个键只在**翻译报错**时用得着：服务端如果答
   * `password` / `weak`，屏幕上要有句话（见 ui/subscribe.ts 的 accountFailText）。
   *
   * 上面原先注着「On the log-in tab, where a passcode is only for code-made accounts」和
   * 「付款回来后立刻弹出的设密码窗口」——**那两扇窗、那一个 tab 都不存在了**，注释却留着
   * 指路，而这个文件是四种语言唯一的底稿，照着过期注释去改字就是照着一张旧地图走。
   */
  passwordLabel: string;
  /** 密码框底下那六小段的实时文案（给读屏软件）。{n} 是已经打进去的位数。 */
  pwMeterSay: string;
  /** 「太短了」。现在只在服务端答 `weak` 时出现。 */
  setPwShort: string;
  /** 注册时那一行勾选：要不要收 Slides 的邮件。默认不勾——同意得是主动给的。 */
  newsOptIn: string;

  /**
   * 注册 / 登录那扇窗的三态（E37/E38）。
   *
   * 身份 2026-10 换掉了：没有密码了。一条路是邮箱 + 六位验证码，另一条是两串自己取的
   * 凭据（给没有邮箱、或者不想留邮箱的人）。两条都在同一扇窗里，不是两扇。
   *
   * ⚠️ `pairWarning` 那一句**不能省**。那条路的真正钥匙是第一串：它必须唯一，所以撞名
   * 时服务端会如实答「已被占用」，于是它是最容易被外人知道的那一串；而「忘了第二串」凭
   * 它就能重设。玩家 2026-10-01 在知情的前提下拍的板——条件是界面上如实告知。
   *
   * **2026-10-03：这一句从「屏幕上一整段」改成「读屏念整句 + 屏幕上一把钥匙和三个字」**
   * （`pairKeyNote`，用 `aria-describedby` 把整句挂在第一串那个框上）。告知这件事一个字
   * 没少，少的是版面：那一整段占掉这扇窗三分之一的高度，而它说的事只有三个字要紧——别
   * 告诉别人。读屏那一头**反而更完整**：从前那一段是个和输入框无关的 `<p>`，光标落进框
   * 里时根本不会被念到。
   */
  codeSentTo: string;
  useAnotherEmail: string;
  mailDownHint: string;
  pairlessEntry: string;
  pairFirstLabel: string;
  /** 《账户》那一屏身份那一行的标签。`pairFirstLabel` 是表单上的长说明，摆进一行里太长。 */
  pairFirstShort: string;
  /** 帐号窗那颗眼睛的读屏名：第一串遮着时按它露出来、露着时按它遮回去（第 17 推）。 */
  showHandle: string;
  hideHandle: string;

  /**
   * 《联系与特别感谢》那扇窗（E42/3.2）。
   *
   * 个人主页底部从五行法务收成两行：《隐私政策》和这一扇。那三份（价格 / 条款 / 退款）
   * 是为「在卖东西」写的，而 2026-10 的改制把付费整个撤了。
   *
   * `contactInvite` 那一段是玩家自己写的原话，四语都照它的三个意思来：出了问题来找我 /
   * 没出问题也欢迎来 / 我本人看本人回。英法把原长句拆成三短句——中文靠逗号串得住，英法
   * 一逗到底读不下来。原话里的两个「您」照 10-08 方案第四批第 3 条（全站「您 / 你」按现状多数
   * 统一成「你」）改了，别的一个字没动。
   *
   * 名单本身不在这儿，在 `src/thanks.ts`（名字不翻译，四语共用一份）。
   */
  contactThanksTitle: string;
  /** 那扇窗里两段各自的小标题。 */
  contactTitle: string;
  thanksTitle: string;
  contactInvite: string;
  thanksTail: string;
  pairSecondLabel: string;
  /**
   * 第一串标签后面那一小行（配一把钥匙的图标）：「勿外传」。
   *
   * `pairWarning` 整句搬去读屏那一层之后，屏幕上留下的就是这一行 + 那把钥匙。**不是省
   * 掉了告知**：玩家 2026-10-01 拍板时的条件是「界面上如实告知」，而「少文字」也是他定
   * 的站点原则——一把钥匙 + 三个字说的是同一件事，整句仍在，只是改由读屏念（见下面
   * `pairWarning`）。
   */
  pairKeyNote: string;
  /** 两串输入框里的那句占位提示：位数、字符集、分不分大小写，一句说完。 */
  pairPlaceholder: string;
  /** 那颗「→」键给读屏念的词。屏幕上只有一枚箭头（玩家定的「少文字」）。 */
  continueBtn: string;
  pairWarning: string;
  pairSaveBtn: string;
  pairSavedHint: string;
  /**
   * 免邮箱那一颗「登录 / 注册」同一键（ui/subscribe.ts 的 pairSubmit）：登录对不上、自动试注册成功
   * 之后说的那一句（2026-10-08 方案 2-13，玩家原话）。他以为自己在登录旧账号，其实开了一个新的
   * ——第一串打错一个字就是这样。流程一个字不动，只是把这件事说出来。
   */
  pairNewAccountHint: string;
  pairForgot: string;
  pairResetBtn: string;
  useEmailInstead: string;
  pairTaken: string;
  pairBad: string;
  pairWrong: string;
  codeWrong: string;
  codeStale: string;
  /** 内部码换来的东西，绑到一个邮箱上，好换设备时取回。 */
  /** 内部码兑换后的绑定窗：这一颗是「以后再说」；状态窗里那一颗是「绑定到账号」。 */
  /** 内部码本身过了使用期限。 */
  codeExpired: string;
  /**
   * 短时间内试得太多（限速挡下了，429）。限速按**来路的网段**数（api/_ratelimit.js 的 callerId：IP 段），不按
   * 设备——同一个网络底下的几台设备共用一个桶。所以四种语言都说「这个网络」：法文原先写的是「depuis cet
   * appareil」（这台设备），换一台手机照样被挡，那句话就是错的（10-08 方案第四批第 7 条）。
   */
  tooManyTries: string;
  /** 还在订阅期内，这张码留着更值。 */
  alreadyActive: string;
  /** 个人主页上的内部码入口。 */
  /** 内部码已经兑上了——个人主页那一行右边那个对勾的说明。 */
  /** 订单情况 — what a signed-in player is shown about what they bought. */
  orderTitle: string;
  orderPlanLabel: string;
  orderUntilLabel: string;
  orderLifetime: string;
  orderLapsed: string;
  /** 年付赠码 — the two months a yearly subscriber has to give away. */
  giftTitle: string;
  giftHint: string;
  giftUsed: string;
  giftExpires: string;
  copyBtn: string;
  copiedLabel: string;
  /** 已订阅但从没设过密码的人，在登录时看到的指引。 */
  redeemBadCode: string;
  pwWrong: string;
  /** Carries {hours}. */
  pwLocked: string;
  pwBlocked: string;
  /** 锁死之后那个真的能按的按钮。 */
  unlockSendBtn: string;
  codeFieldLabel: string;
  /** 密码换好了，但这个账号此刻没有在续的订阅——说清楚哪一半成了。 */
  /** 登录成功，但这个账号此刻没有在续的订阅。同样是「哪一半成了」。 */
  // ---- 已登录：《账号》那一扇窗，以及窗里那两件事 ----
  /** 窗里那一段小标签：底下几行都是「对这个账号做的事」。 */
  accountActions: string;
  /** 客服信箱那一行。收单方的要求是它「在公开网站上、也在用户自己的账号里」
   *  都看得见——不是法务文档第三段里的一个地址，是他打开账号就在那儿的一行。 */
  supportLine: string;
  /** 付款前那一句：钱是谁收的、对账单上会写谁。三个渠道都有一个 merchant of
   *  record（网页是 Creem，应用里是 App Store / Google Play），所以这句话
   *  四处通用，只换名字。 */
  changeEmailRow: string;
  /** 改密码：先证明你是本人。 */
  /** 换邮箱：码寄到**新**地址——谁收得到，那个地址就是谁的。 */
  newEmailLabel: string;
  emailCodeSent: string;
  emailChanged: string;
  /** 想换过去的那个地址上已经有账号了。 */
  emailTaken: string;
  emailSame: string;
  /** 两扇小窗共用的那一颗：确认。 */
  confirmBtn: string;
  /** 这台设备手里的令牌不作数了（在别处改过密码、或者过期）。 */
  sessionGone: string;
  unlockBadCode: string;
  unlockExpired: string;
  /** Carries {email} — the support address, when no mail can be sent. */
  unlockNoMail: string;
  // ---- multiplayer: the room, the countdown, the live standings ----
  mpTitle: string;
  mpIntro: string;
  mpCreate: string;
  mpContest: string;
  /**
   * 《开小屋》里被换掉的那一段，和它换成的那一段。
   *
   * 拨开 Pro 之后那颗键上**只有这一段字在动**（玩家 2026-09：「在打开 pro 的开关后，
   * Open a room 中只有 room 一词动态被替换成了 contest」）——动词留在原地，换的是宾语。
   * 整句换掉的话，屏幕上是一整行字跳了一下，看不出「变的是哪一件事」。
   *
   * 所以每种语言在这儿各记**自己那一段最小的、换完还通顺的**：英文是一个词（room →
   * contest），法文必须连冠词一起换（une salle → un concours，阴阳性不同），中文是那
   * 两个字（小屋 → 竞赛）。
   *
   * 铁律：`mpCreate` 里必须找得到 `mpCreateNoun`，换完必须**一字不差等于** `mpContest`
   * ——这两条由 scripts/check-room-word.mjs 钉着，翻译改一半就当场红。
   */
  mpCreateNoun: string;
  mpContestNoun: string;
  mpContestHint: string;
  mpJoin: string;
  mpNameLabel: string;
  mpNamePlaceholder: string;
  mpShuffle: string;
  mpCodeLabel: string;
  mpCodePlaceholder: string;
  mpRoomCode: string;
  mpShareHint: string;
  mpPlayers: string;
  mpHostBadge: string;
  /** 交出座位、离开这间房。房间页和结算页上是同一颗键、同一个说法——对玩家
   *  来说这本来就是同一件事，两个名字只会让人以为是两回事。 */
  mpLeave: string;
  /** 多人设置页分割线底下那句招呼——「加入 Slides 天才搭建的小屋」，说的是下半
   *  段「进别人开的屋子」（ui/multiplayer.ts 第 367 行）。 */
  mpNeedGenius: string;
  /** 离开小屋后那张总排名的标题。 */
  mpStandings: string;
  mpFinished: string;
  /** The host picks the board from the home page, where all eight of them
   *  live with their icons — these are the trip there and back. */
  mpGoPick: string;
  /** 屋主被送回主菜单挑下一个玩法时，顶上那条横幅。{code} 换成房号。
   *  横幅上只留这一行——挑一个玩法全房间就一起玩，这件事横幅一亮就说完了，
   *  底下再写一句解释是同一件事说两遍。 */
  mpPickingTitle: string;
  mpBackToRoom: string;
  mpNotAMode: string;
  /** A room is an evening: round after round, then a closing card. */
  mpRoundLabel: string;
  mpNextRound: string;
  mpDisbandRoom: string;
  /**
   * 屋主在等待页上那颗「不等了」（2026-10-08 方案 2-6）：还没交卷的人按「这一局不打了」替他交
   * 卷，这一局就此结束，屋主照常挑下一局。只有屋主看得到。
   */
  mpStopWaiting: string;
  /**
   * 屋主按了《解散小屋》，服务器那头没办成（网断了一下、服务器忙）：他还在这间屋里，再按一次就
   * 行（2026-10-08 方案 2-7）。
   */
  mpDisbandFailed: string;
  mpRoomEnded: string;
  mpTotalLabel: string;
  /** 竞赛排名图上那个大数字底下的一行小字。 */
  mpRoomTotal: string;
  /** 客人催屋主开下一局的那颗键。 */
  mpNudge: string;
  /** 名单上给中途走掉的人挂的那个小标。 */
  mpLeftTag: string;
  /** 《解锁更多配色》那扇窗：标题、一句说明、三套的名字。 */
  paletteTitle: string;
  paletteHint: string;
  /** 没开通的人点开配色窗口时，顶上那句——看得见，但要开通才挑得动。
      《界面明暗》那扇窗也用它：同一句话，不必翻两遍。 */
  paletteLocked: string;
  /**
   * 《深色界面》那颗开关。
   *
   * 是一颗开关，不是一扇挑选窗（玩家 2026-09：「简化一下，就和现在开关色盲友好模
   * 式一样，亮/暗的开关按钮」）。所以只有一个名字，而且名字说的是**打开**之后是
   * 什么样——「界面明暗」那种两头都提的说法，放在开关上看不出往哪边拨。
   *
   * 深色是天才特供，没开通的按不动（个人主页那一行挂着锁）。
   */
  themeTitle: string;
  /** 色盲友好开着时，配色窗口的标题和那一句。 */
  paletteCvdTitle: string;
  paletteCvdHint: string;
  /** 三套色盲配色的名字。 */
  cvdStd: string;
  cvdWarm: string;
  cvdCool: string;
  paletteNow: string;
  paletteJia: string;
  paletteBing: string;
  /** 开局前问一句：这个玩法的规则你会吗？{name} 是玩法名。 */
  mpKnowRules: string;
  mpKnowYes: string;
  mpKnowNo: string;
  /** 有人在看教学时，其他人那一屏上写的话。 */
  mpLearningWait: string;
  /** 等人学教学那一屏底下的练习盘上面那一句。 */
  mpPracticeHint: string;
  mpRoundResult: string;
  mpFinalTitle: string;
  mpBestRound: string;
  /**
   * 小屋战绩卡上和 mpBestRound 并排的那一栏，后面接「名字 + 用时」。
   *
   * 四种语言都说**同一件事：最快的那一局**。从前中文写的是「最快玩家」（说的是
   * 人），英/法写的是「最快的那块棋盘」（说的是局）——同一栏两个概念，而且和左
   * 边那栏「单局最高 / Best single round」也对不上。玩家看得懂，只是没对齐，
   * 2026-09 统一成「单局最快」这一版。
   */
  mpFastest: string;
  mpRoundsPlayed: string;
  /** 离开太久，服务器已经开了下一局，这一盘没能算进小屋总分。 */
  mpRoundDropped: string;
  /** 线上已经是新的一版了：菜单上那一行，按一下重新加载。对局中不出现（见 engine/newVersion.ts）。 */
  newVersionTip: string;
  mpErrEnded: string;
  /** 网络断了一下，但座位还留着——不是把人踢出房间的理由。 */
  mpReconnecting: string;
  /** 屋主要走之前得知道：他一走，就没人能开下一局了。 */
  mpHostLeaveWarn: string;
  /** 客人要走时问的那一句。屋主那句说的是「你走了整桌就散」，对客人不成立，
   *  照搬过去是吓唬人——他走了别人接着玩，所以只问要不要走。 */
  mpGuestLeaveWarn: string;
  mpLeaveAnyway: string;
  /** 《离开小屋》那颗键改成按住生效之后，键上那行字。 */
  mpLeaveHold: string;
  /** 长按对开关设备不可达，所以辅助文案里写明还有一条直接的路。 */
  mpLeaveHoldHint: string;
  mpStay: string;
  /** 房间局里按下《完成》时问的那一句。问的这段时间钟停着、牌也盖上。 */
  mpFinishConfirm: string;
  /** 屋主把座位交回去了，这间房再也开不了下一局。 */
  mpRoomCancelled: string;
  /** 屋主散场时，还在打的人看到的那句话。 */
  /** 屋主中途散场，而这个人没权限单独打这个玩法：一句话，按下去回主页。 */
  mpHostLeftLocked: string;
  mpHostAwaySolo: string;
  /** 知道了。 */
  mpOk: string;
  /** 屋主还在，只是这会儿听不见他——网络卡了，不是走了。 */
  mpHostFixing: string;
  mpErrNoRoom: string;
  mpErrFull: string;
  mpErrStarted: string;
  /** 同一把离线的椅子，另一台设备先一步认领走了。 */
  mpErrClaimed: string;
  mpErrTooFew: string;
  mpErrNotOpen: string;
  /** 服务器的限速把这一下挡住了（api/room.js 的 RATE）。 */
  mpErrTooMany: string;
  /** 只有屋主能做的事，别人按了（第 14 推）。原先落进 default，屏幕上写「连不上网络」。 */
  mpErrNotHost: string;
  /** 服务端不认这一局的玩法（多半是这台设备上的包太旧）（第 14 推）。原先同样写「连不上网络」。 */
  mpErrMode: string;
  notOnSaleYet: string;
  purchaseUnavailable: string;
  purchaseCancelled: string;
  purchaseNetwork: string;
  /** 请求到达了服务器、服务器答不上来。跟 purchaseNetwork 分开，因为让
   *  一个网络正常的人去查网络，只会让他白折腾。 */
  serverBusy: string;
  restoreNothing: string;
  workingLabel: string;
  // ---- game shell (shared HUD/overlays across every shape) ----
  pauseBtn: string;
  finishBtn: string;
  endRunYes: string;
  endRunNo: string;
  scoreLabel: string;
  timeLabel: string;
  startBtn: string;
  pausedTitle: string;
  /** 暂停面板里那一颗《怎么玩》，也是那一屏自己的标题。 */
  howToPlayBtn: string;
  /** 《怎么玩》那一屏底下的那一颗。 */
  gotItBtn: string;
  /** 暂停面板里《再来一局》：把这一局丢掉，原地重开一局同样的玩法。 */
  restartRunBtn: string;
  /** 丢掉这一局之前问的那一句。 */
  restartConfirm: string;
  /** 暂停面板里《结束游戏》——从前底排那一颗《完成》。 */
  endRunBtn: string;
  /**
   * 结算弹窗的标题（10-08 方案 3-I 起它就是标题，从前是「挑战结束」底下那一行小字）。
   *
   * 和 compositeLabel（明细里那一行）、endTipComposite（底下那句说明的打头）说的是同一个数，叫法必须
   * 一样：英法原先这儿写「Composite score」/「Score composite」，明细和说明写「Final score」/「Score
   * final」——同一屏上一个数两个名字（10-08 方案第四批第 1 条统一成后者）。中文标题多一个「得」
   * （综合得分 / 综合分），是同一个词。门：check-score-terms。
   */
  compositeScoreLabel: string;
  /** "Your average in this mode" on the end-of-run summary. */
  avgScoreLabel: string;
  /** Accessible name for the sound on/off button in 个人主页. */
  soundBtn: string;
  shareBtn: string;
  restartBtn: string;
  shareCardTitle: string;
  shareImgAlt: string;
  shareHint: string;
  closeBtn: string;
  // ---- game-screen chrome, once written per shape in Chinese only ----
  shellStartBody: string;
  taglineRowCol: string;
  taglineThreeWay: string;
  taglineDiagonal: string;
  taglineVBoard: string;
  taglineBomb: string;
  rulesPill: string;
  // ---- gain-bubble source labels (which pattern just paid out) ----
  /**
   * 得分气泡上那一句「几连」。**枚数是变的**（《侵蚀阶梯》v1.2 §2：图案 4→3→2→1），
   * 所以这一句带一个 {n}，不再是写死的「4连」。
   *
   * 这一族从前有五个：labelRun4 / labelBlock22 / label121 / labelBigTriangle，外加
   * HUD 上那个 perfLabel（《行动有效率》）。得分图案 2026-09 之后只剩 1×N 一种，
   * 《行动有效率》在任何界面都不存在了（PR-7），那五个于是一个用它的地方都没有。
   * 留着比删掉危险：下一个人会拿 labelBlock22 去标一个这版里凑不出来的图案，四种
   * 语言都现成的，看着完全像是对的。
   */
  labelRunN: string;
  labelPattern: string;
  labelWholeLine: string;
  // ---- game controller (dynamic end-of-run text) ----
  /**
   * 《侵蚀阶梯》v1.2 §5 结算页那几行的文案。行序是固定的：
   * 翻面 → 削线 → 拼出分 → 步数系数 → 综合分。
   */
  /** 「翻面 {n} 枚 ×2」；带拆弹时另接一句 flipRowDefused。 */
  /** HUD《得分图案》那一块的读屏播报：「得分图案变成 {n} 枚」。 */
  /**
   * 结算页底下那一句（只摆头一回）：综合分是怎么来的。
   *
   * 从前这儿借的是教学第 6 条（「时间越短、步数越少……」）。《侵蚀阶梯》v1.2 §5
   * 之后时间不计分，教学也收成五条——借下标的写法当场就指空了。所以单给一个键。
   */
  endTipComposite: string;
  patternNowLabel: string;
  /** HUD 左边那一块的标题：拼出得分。 */
  builtScoreHudLabel: string;
  flipRowLabel: string;
  /** 「（含拆除 {n} 枚）」——和上面那一句同一行，法文同样分单复数。 */
  flipRowDefused: string;
  /** 「削线 {n} 条（星星数²）」。 */
  lineRowLabel: string;
  /**
   * 「完成奖励」——老虎机拼成一次，除了翻面那几枚的 +2，再给 ⌈枚数²/2⌉
   * （《侵蚀阶梯》v1.2 §7，engine/targets.ts 的 scoreForSize）。
   *
   * 这一行从前不摆，于是老虎机那一局的明细**加起来对不上拼出分**——规则书和挑图形页
   * 都在讲这个奖励，结算页上却找不到它去了哪儿。
   */
  slotBonusLabel: string;
  /** 「拼出分」——翻面分 + 削线分，无任何过程系数。 */
  builtScoreLabel: string;
  /** 「步数系数」；副标「{p}步，基准{par}」。 */
  stepCoefLabel: string;
  /**
   * 中文两份是紧凑写法「19步，基准28」（10-08 方案 3-I：结算弹窗设计图上就是这么写的）。从前是
   * 「19 步 · 基准 28」，比图上宽 19px——明细里数的那一栏因此比图上靠右 17px，有通关勾的那种排法
   * 里这一行还被折成两行。
   */
  stepCoefDetail: string;
  /** 「综合分」——拼出分 × 步数系数。 */
  compositeLabel: string;
  /** 「用时 {t}（不计分）」——结算页那一行小字。 */
  timeNotScoredLabel: string;
  /** 徽章：清盘 / 解锁 1 枚。 */
  badgeSwept: string;
  badgeUnlockedOne: string;
  patternPointsLabel: string;
  comboBonusLabel: string;
  linePointsLabel: string;
  perfBonusLabel: string;
  timeMultLabel: string;
  neverFlippedLabel: string;
  defaultPenaltyLabel: string;
  bombPenaltyLabel: string;
  timeUpReason: string;
  noMoreMatchesReason: string;
  /**
   * 这一局是怎么收场的：**盘面清空了**。
   *
   * 键名 allFlipped 是 2026-09 星星消除上线之前留下的——那时候终局是「全部翻成
   * 星星」，所以这四句话原本都写着「全部已变成星星」。星星现在会被消成空图形，
   * 终局变成「一枚不剩」（见各棋盘的 isGameOver），那句话于是成了假话：玩家报
   * 过一次，结算页写着「全部已變成星星」，盘面上还躺着四颗同色蓝星。
   *
   * 键名没跟着改，是因为它同时是**存档里的那个字符串**（runRecord 的
   * REASON_LABEL_KEY，云端战绩里存的也是它）——改了名，玩家早先那些记录就会
   * 显示成一行生硬的中文原文。
   */
  allFlippedReason: string;
  manualEndReason: string;
  bombHazardReason: string;
  /** Contains a literal "{n}" placeholder substituted with the move count. */
  stepsPhrase: string;
  /** Contains a literal "{n}" placeholder substituted with the best score. */
  bestPhrase: string;
  // ---- share card (canvas-drawn) ----
  shareStartLabel: string;
  shareEndLabel: string;
  shareAllCleared: string;
  shareFooterHint: string;
  shareQrCaption: string;
  /**
   * 分享卡上二维码说明下面那一行（第 19 推）：这一局的代号，「{code}」换成 XXXX-XXXX。
   * （界面上 2026-10 起叫「代号」，不叫「种子」，10-08 方案 3-B；键名沿用。）
   * 每日挑战那一局后面再接一句 shareDailyTag（「· 每日 MM/DD」），「{m}」「{d}」换成月、日
   * ——法语照它自己的习惯写成日/月，写成月/日的话「10/03」在那边读作三月十号。
   */
  shareSeedLine: string;
  shareDailyTag: string;
  // ---- 每日挑战与种子码（第 19 推）----
  /** 主菜单那张卡底下的标签，也是那一页的名字。 */
  dailyTitle: string;
  /**
   * 那张卡的读屏名：「每日挑战，10 月 3 日」。中文用「{m}」「{d}」；英法两种语言的月份要念出
   * 名字来，用「{month}」，名字从 monthNames 里取（十二个，用 | 隔开）。
   */
  dailyAria: string;
  monthNames: string;
  /** 每日挑战那一页上的大键：开今天这一局。 */
  dailyPlay: string;
  /** 代号输入框前头那个字，也是输入框的读屏名（2026-10 起叫「代号」，键名沿用 seed）。 */
  seedLabel: string;
  /** 输入框旁边那颗开局键的读屏名。 */
  seedGo: string;
  /** 敲进来的码认不出来的三种（engine/seedCode.ts 的 decodeSeed）。expired 是方案原话。 */
  seedBad: string;
  seedExpired: string;
  seedNewer: string;
  /**
   * 输代号那一格底下那一行小字：敲代号开的局不上榜（10-08 方案 3-B，玩家拍板方案 A）。服务器
   * 照这一条办（api/scores.js 的 ranked），这儿先说出来——不让人打完一局好的才发现没上榜。
   * 只有网页端说：小红书那一端根本没有排行榜。
   */
  seedNoBoard: string;
  /** 七色圆球那一天，竖着拿手机时倒数之前只摆这一句（方案原话「请横屏」），不带任何棋盘标识。 */
  dailyTurn: string;
  /** 排行榜上那个「今日」标签。 */
  rankTabDaily: string;
  /** 小红书那一版：本机今天每日挑战最好的一局，「{n}」换成分数。 */
  dailyBest: string;
  // ---- shared shape UI ----
  colorblindBtn: string;
  /**
   * 《Pro》那颗开关的名字。四种语言写的都是同一个词——玩家 2026-09 点名要这个词
   * （「加入《Pro》按钮开关」），而它在四种语言里都读得通，翻译反而会让同一个设置在
   * 不同语言里成了不同的东西。摆在色盲友好那一条旁边，两处（个人主页、暂停面板）同
   * 一个说法。
   */
  proBtn: string;
  shapeNameSquare: string;
  /**
   * 小球那三副（circle / circleHex / circleSeven）的英法名字和主菜单上那张卡（ui/menuTags.ts）一字不差：
   * Classic Balls / Hex Balls / Diamond Balls，Billes classiques / Billes hexagone / Billes losange。原先这儿是
   * Circle / Hex Circle / Seven-colour Circle（法文 Cercle…），同一副棋盘在主菜单、规则页、成绩页上三个叫法
   * （10-08 方案第四批第 9 条，玩家拍板 Balls 系）。门：check-rules-counts 第 ⑤ 节。
   */
  shapeNameCircle: string;
  shapeNameTriangle: string;
  shapeNameCircleHex: string;
  shapeNameSquareDiamond: string;
  shapeNameTriangleBig: string;
  shapeNameCircleSeven: string;
  shapeNameTriangleAdvanced: string;
}

export const LANG_ORDER: Lang[] = ['en', 'fr', 'zhHant', 'zhHans'];

/**
 * 带数字的那几句怎么念：模板里用 `|` 隔开单数形和复数形
 * （`'{n} round|{n} rounds'`），没有 `|` 的（中文那两份）原样用。
 *
 * 原先每种语言都只写了一份复数形，于是只打过一局的人看见的是「1 rounds」、
 * 走了一步的人看见的是「1 moves」。单复数的界线各语言还不一样：英文只有 1
 * 用单数，法文 0 和 1 都用单数（« 0 manche »、« 1 manche »），中文根本没有
 * 这回事——所以这条规矩只能写在这里，写在调用处就得每处都记一遍。
 */
export function countPhrase(tpl: string, n: number, lang: Lang): string {
  const forms = tpl.split('|');
  const singular = lang === 'fr' ? Math.abs(n) < 2 : n === 1;
  const pick = forms.length > 1 && singular ? forms[0] : forms[forms.length - 1];
  return pick.replace('{n}', String(n));
}

export const STRINGS: Record<Lang, I18nStrings> = {
  en: {
    langName: 'English',
    homeTagline: 'Slide · Score · Clear',
    knowHow: 'I know how',
    next: 'Next',
    prev: 'Back',
    coachPrev: 'Previous',
    replay: 'Replay',
    doneBtn: 'Done',
    pause: 'Pause',
    resume: 'Resume',
    run4: 'Slide a row or column to line up 4 tiles of the same colour',
    flip: 'A tile that scores turns into a star, in a colour chosen at random',
    navProfile: 'Profile',
    navRecords: 'Records & rankings',
    noRecordsYet: 'No score yet',
    recordsResetByRules: 'New rules are live — your record starts fresh here',
    switchLanguage: 'Language',
    sectionTimed: 'Timed challenge',
    flipModeTitle: 'Endless flip',
    flipModeTagline: 'Score to make a star, score again to turn it back · stars never clear · 100 s',
    timedModeTagline: '100-second challenge',
    flipScoringHint: 'The scoring shape stays at four pieces all game · no move factor',
    puzzleModeTitle: 'Puzzle · Step by step',
    puzzleModeTagline: 'Eight moves in hand. A move costs 1. Scoring pays 1 back. Scoring twice in a row pays 1 more. Clearing a line pays 2 more. No clock.',
    stepsLeftLabel: 'Moves left',
    stepsOutReason: 'Out of moves',
    puzzleClearedLabel: 'Cleared {c} × {n}',
    puzzleStarsLabel: 'Stars {c} × {n}',
    puzzleStepsLabel: '{n} move ({k} scored)|{n} moves ({k} scored)',
    puzzleStreakLabel: 'Streak refunds',
    puzzleEdgeLabel: 'Line refunds',
    puzzleLeftLabel: '{l} left (peak {p})',
    bombBasicTitle: 'Basic bomb',
    bombTimedTitle: 'Timed bomb',
    bombAdvancedTitle: 'Advanced bomb',
    randomTargetTitle: 'Slot machine mode',
    randomTargetTagline: 'Scoring shapes drawn at random',
    slotShareCaption: 'Patterns for the room',
    slotSameLabel: 'Same',
    slotOwnLabel: 'Different',
    slotDemoStop: 'STOP',
    slotStartLabel: 'Start',
    comingSoon: 'Coming soon',
    multiplayerTitle: 'Multiplayer',
    rankingsTitle: 'Records & rankings',
    rankTotalBoard: 'Overall',
    rankTabBase: 'Base',
    rankTabTimed: 'Timed',
    rankTabBomb: 'Bomb',
    rankTabLayout: 'Layouts',
    rankTabSlot: 'Slots',
    rankTabFlip: 'Flip',
    rankTabPuzzle: 'Step by step',
    rankLocked: 'Your runs may already be on the board — become a Slides Genius to see it',
    rankLockedCta: 'Become a Slides Genius',
    rankSignedOut: 'Sign in and your runs go on the board',
    rankEmpty: 'Nobody on this board yet',
    rankNetwork: 'Couldn’t load the board. Check your connection.',
    dailyNotCounted: 'This run didn’t count for today’s challenge. Check your device’s date and time.',
    rankAnon: 'Anonymous player',
    nickSet: 'Set a nickname',
    nickEdit: 'Edit nickname',
    nickSave: 'Save nickname',
    nickCancel: 'Cancel',
    nickTaken: 'That nickname is already taken.',
    nickBlocked: 'Try another name.',
    nickBad: 'Up to 12 characters.',
    nickRequired: 'A nickname can’t be empty.',
    puzzleLeftSteps: '{n} move left|{n} moves left',
    rankLoading: 'Loading…',
    rankExpired: 'Your sign-in has expired. Sign in again and your runs go on the board.',
    rankReLogin: 'Sign in again',
    flipSpeedTitle: 'Star speed',
    flipSpeedHint: 'How fast a piece becomes a star. Everything else stays the same.',
    flipSpeedLocked: 'Slides Genius sets this. Here is what it does.',
    flipSpeedSlow: 'Slow',
    flipSpeedFast: 'Fast',
    flipSpeedPick: 'Recommended',
    totalScoreTitle: 'Total score',
    totalScoreSync: 'Sign in and your last 60 runs are kept in the cloud',
    backToMenu: 'Back to menu',
    homeBtn: 'Home',
    rotateHint: 'Turn your phone sideways — this board is a wide one',
    back: 'Back',
    accountTitle: 'Account',
    loginGateway: 'Sign in',
    tutorialShort: 'Tutorial',
    becomeGenius: 'Become a Slides Genius',
    geniusSpecialTitle: 'Slides Genius Exclusives',
    geniusNowTitle: 'Unlocked the moment you sign up',
    geniusNowCircleSeven: 'Seven-colour diamond ball board',
    geniusNowTriangleBig: 'Hexagonal triangle board, 54 tiles',
    geniusSoonTitle: 'Coming soon',
    geniusHostRooms: 'Put up a room and race your friends online',
    subscribeTitle: 'Sign up — Slides Genius, free',
    registerBtn: 'Sign up',
    planMonthly: 'per month',
    planYearly: 'per year',
    restoreBtn: 'Restore purchase',
    signInBtn: 'Sign in',
    signOutBtn: 'Sign out',
    emailLabel: 'Email',
    emailPlaceholder: 'you@example.com',
    emailInvalid: 'That does not look like an email address.',
    signInHint: 'Your address, and a six-digit code we email you. No password to remember.',
    storeNoAccountHint: 'Bought with your {store} account — no sign-up, and you never leave the app.',
    subscribedTitle: 'You are a Slides Genius',
    manageSubscription: 'Manage subscription',
    manageOnStore: 'Cancel or change it in your {store} account settings.',
    geniusStatus: 'Account',
    geniusOnly: 'Genius only',
    passwordLabel: 'Passcode (6 characters)',
    pwMeterSay: '6-digit passcode · {n} entered',
    setPwShort: 'Use exactly six letters or digits.',
    newsOptIn: 'Email me new boards and updates',
    codeSentTo: 'Sent to {email}',
    useAnotherEmail: '← Another address',
    mailDownHint: 'Mail is not going out right now. Try “No email”.',
    pairlessEntry: 'No email',
    pairFirstLabel: 'First string',
    pairFirstShort: 'First string',
    showHandle: 'Show the first string',
    hideHandle: 'Hide the first string',
    contactThanksTitle: 'Contact & thanks',
    contactTitle: 'Contact',
    thanksTitle: 'Special thanks',
    contactInvite: 'If something goes wrong, write to me and attach a screenshot. And if nothing has gone wrong, write to me anyway — I read and answer every message myself. Thank you for your support.',
    thanksTail: 'and the many friends who played, tested, and told me what to fix',
    pairSecondLabel: 'Second string',
    pairKeyNote: 'keep it private',
    pairPlaceholder: '8–64 letters or digits, case matters',
    continueBtn: 'Continue',
    pairWarning: 'The first string is your key. Tell no one: whoever knows it can reset the second one.',
    pairSaveBtn: 'Save',
    pairSavedHint: '✓ Saved — screenshot both strings',
    pairNewAccountHint: 'Signed in to a new account. If you meant your old one, sign out and try again.',
    pairForgot: 'Forgot the second string?',
    pairResetBtn: 'Set a new second string',
    useEmailInstead: '← Use an email address',
    pairTaken: 'That first string is taken. Pick another one.',
    pairBad: 'Both strings need 8–64 letters or digits.',
    pairWrong: 'Those two strings do not match an account.',
    codeWrong: 'That code is not right.',
    codeStale: 'That code has expired. Ask for a new one.',
    codeExpired: 'That insider code has passed its use-by date.',
    tooManyTries: 'Too many tries from this network. Try again later.',
    alreadyActive: 'Your subscription is still running. Keep this insider code for later, or pass it on — it is only spent once.',
    orderTitle: 'Your account',
    orderPlanLabel: 'Plan',
    orderUntilLabel: 'Good until',
    orderLifetime: 'Lifetime',
    orderLapsed: 'This account does not have access right now.',
    giftTitle: 'Two months to give away',
    giftHint: 'Yours for subscribing by the year. Send one to a friend — each unlocks one month, once.',
    giftUsed: 'used',
    giftExpires: 'use by {date}',
    copyBtn: 'Copy',
    copiedLabel: 'Copied',
    redeemBadCode: 'That insider code is not valid, or it has already been used.',
    pwWrong: 'That passcode is not right.',
    pwLocked: 'Too many wrong tries. Opens again in about {hours} h.',
    pwBlocked: 'Locked after too many wrong tries. Open it by email.',
    unlockSendBtn: 'Send the code',
    codeFieldLabel: 'The 6-digit code from the email',
    accountActions: 'Account settings',
    supportLine: 'A question, a refund, anything at all — write to {email}.',
    changeEmailRow: 'Change email',
    newEmailLabel: 'New email',
    emailCodeSent: 'We sent a 6-digit code to the new address. Enter it to finish.',
    emailChanged: 'Done — your account is on the new address.',
    emailTaken: 'That address already has an account.',
    emailSame: 'That is the address you are already on.',
    confirmBtn: 'Confirm',
    sessionGone: 'This device is no longer signed in. Please sign in again.',
    unlockBadCode: 'That code is not right.',
    unlockExpired: 'That code has expired. Send a new one.',
    unlockNoMail: 'We cannot send mail automatically yet. Write to {email} and we will open it for you.',
    mpTitle: 'Multiplayer',
    mpIntro: 'Put up a little room, one and the same board, and race.',
    mpCreate: 'Open a room',
    mpContest: 'Open a contest',
    mpCreateNoun: 'room',
    mpContestNoun: 'contest',
    mpContestHint: 'Up to 20 · you watch, you don’t play',
    mpJoin: 'Join a room',
    mpNameLabel: 'Your name',
    mpNamePlaceholder: 'Pick a name',
    mpShuffle: 'Another',
    mpCodeLabel: 'Room code',
    mpCodePlaceholder: 'four digits',
    mpRoomCode: 'Room',
    mpShareHint: 'Give these four digits to a friend and they can join the room.',
    mpPlayers: 'Players',
    mpHostBadge: 'host',
    mpLeave: 'Leave the room',
    mpNeedGenius: 'Join a room a Slides Genius put up',
    mpStandings: 'Standings',
    mpFinished: 'done',
    mpGoPick: 'Pick a board on the home page',
    mpPickingTitle: 'You are picking for room {code}',
    mpBackToRoom: 'Back to the room',
    mpNotAMode: 'Rooms play the six boards — not timed runs or bombs.',
    mpRoundLabel: 'Round {n}',
    mpNextRound: 'Pick the next board',
    mpDisbandRoom: 'Break up the room',
    mpStopWaiting: 'Stop waiting',
    mpDisbandFailed: 'The room is still open — try again.',
    mpRoomEnded: 'The host closed the room.',
    mpTotalLabel: 'total',
    mpRoomTotal: 'Room total',
    mpNudge: 'Nudge the host',
    mpLeftTag: 'left',
    paletteTitle: 'Piece colours',
    paletteHint: 'Changes the pieces in every board. Off while the colourblind palette is on.',
    paletteLocked: 'Here is what a Slides Genius gets to pick from.',
    themeTitle: 'Dark interface',
    paletteCvdTitle: 'Colourblind palette',
    paletteCvdHint: 'All three are checked against red-, green- and blue-yellow-blind vision. Pick the one you like.',
    cvdStd: 'Standard',
    cvdWarm: 'Warm',
    cvdCool: 'Cool',
    paletteNow: 'Original',
    paletteJia: 'Deep',
    paletteBing: 'Soft',
    mpKnowRules: 'Do you know how {name} works?',
    mpKnowYes: 'I do',
    mpKnowNo: 'Teach me',
    mpLearningWait: 'Someone in the room is still learning — hold on',
    mpPracticeHint: 'Don’t just wait — give it a go',
    mpRoundResult: 'This round',
    mpFinalTitle: 'How the room finished',
    mpBestRound: 'Best single round',
    mpFastest: 'Fastest single round',
    mpRoundsPlayed: '{n} round|{n} rounds',
    mpRoundDropped: 'Away too long — this round missed the room total. It’s still in your own records.',
    newVersionTip: 'New version — tap to refresh',
    mpErrEnded: 'That room has been closed.',
    mpReconnecting: 'Connection lost — getting you back in…',
    mpHostLeaveWarn: 'Close the room?',
    mpGuestLeaveWarn: 'Leave?',
    mpLeaveAnyway: 'Leave anyway',
    mpLeaveHold: 'Hold to leave',
    mpLeaveHoldHint: 'Hold the button, or press Enter',
    mpStay: 'Stay',
    mpFinishConfirm: 'Done?',
    mpRoomCancelled: 'The host has wandered off — the room is closed for now',
    mpHostLeftLocked: 'The host has left and the room is closed for now — come back in a bit?',
    mpHostAwaySolo: 'The host has stepped away · playing on your own now',
    mpOk: 'ok',
    mpHostFixing: 'The host will be right back',
    mpErrNoRoom: 'No room with that code.',
    mpErrFull: 'That room is full.',
    mpErrStarted: 'That game has already started.',
    mpErrClaimed: 'Someone just took that seat back. Try another name.',
    mpErrTooFew: 'Two players at least.',
    mpErrNotOpen: 'Multiplayer is not open yet.',
    mpErrTooMany: 'Too many requests from your network just now. Wait a few seconds and try again — this is not your connection.',
    mpErrNotHost: 'Only the host can do this.',
    mpErrMode: 'This mode can’t open a room right now. Refresh and try again.',
    notOnSaleYet: 'The subscription is not open yet.',
    purchaseUnavailable: 'This device cannot complete the purchase yet.',
    purchaseCancelled: 'Cancelled — you have not been charged.',
    purchaseNetwork: 'No connection. Please try again in a moment.',
    serverBusy: 'Something went wrong on our side, not with your connection. Please try again in a moment.',
    restoreNothing: 'No subscription found to restore.',
    workingLabel: 'Working…',
    pauseBtn: 'Pause',
    finishBtn: 'Finish',
    endRunYes: 'Yes',
    endRunNo: 'No',
    scoreLabel: 'Score',
    timeLabel: 'Time',
    startBtn: 'Start',
    pausedTitle: 'Paused',
    howToPlayBtn: 'How to play',
    gotItBtn: 'Got it',
    restartRunBtn: 'Play again',
    restartConfirm: 'Start over?',
    endRunBtn: 'End game',
    compositeScoreLabel: 'Final score',
    avgScoreLabel: 'Your average in this mode',
    soundBtn: 'Sound',
    shareBtn: 'Share',
    restartBtn: 'Again',
    shareCardTitle: 'Share result',
    shareImgAlt: 'Result card',
    shareHint: 'Press and hold, or right-click the image, to save it',
    closeBtn: 'Close',
    shellStartBody: 'Drag a whole line to build same-colour patterns. Tap Start for a fresh board.',
    taglineRowCol: 'Drag a whole row or column · build same-colour patterns',
    taglineThreeWay: 'Drag a whole line — across, or either diagonal · build same-colour patterns',
    taglineDiagonal: 'Drag a whole line — across or diagonally · build same-colour patterns',
    taglineVBoard: 'A V-shaped board · the two arms slide independently',
    taglineBomb: 'Keep 4 red tiles from ever connecting',
    rulesPill: 'How to play',
    labelRunN: 'Run of {n}',
    labelPattern: 'Pattern',
    labelWholeLine: 'Full line',
    endTipComposite: 'Final score = build score \u00d7 move multiplier. Fewer moves, bigger multiplier \u2014 it never drops below \u00d71.00.',
    patternNowLabel: 'Pattern is now {n} tile|Pattern is now {n} tiles',
    builtScoreHudLabel: 'Build score',
    flipRowLabel: 'Flipped {n} ×2',
    flipRowDefused: '(incl. {n} defused)',
    lineRowLabel: '{n} line cleared (stars²)|{n} lines cleared (stars²)',
    slotBonusLabel: 'Completion bonus',
    builtScoreLabel: 'Build score',
    stepCoefLabel: 'Move multiplier',
    stepCoefDetail: '{p} moves · par {par}',
    compositeLabel: 'Final score',
    timeNotScoredLabel: 'Time {t} (not scored)',
    badgeSwept: 'Board cleared',
    badgeUnlockedOne: 'Unlocked 1-tile',
    patternPointsLabel: 'Pattern points',
    comboBonusLabel: 'Streak & chain bonus',
    linePointsLabel: 'Whole-line bonus',
    perfBonusLabel: 'Hit-rate bonus',
    timeMultLabel: 'Time multiplier',
    neverFlippedLabel: 'Never became a star',
    defaultPenaltyLabel: 'Penalty',
    bombPenaltyLabel: 'Bomb penalty',
    timeUpReason: "Time's up",
    noMoreMatchesReason: 'No scoring shape can be made any more',
    allFlippedReason: 'Board cleared',
    manualEndReason: 'Ended manually',
    bombHazardReason: 'Bomb tiles connected',
    stepsPhrase: '{n} move|{n} moves',
    bestPhrase: 'best {n}',
    shareQrCaption: 'Scan to play Slides',
    shareSeedLine: 'Daily code {code}',
    shareDailyTag: 'Daily {m}/{d}',
    dailyTitle: 'Daily Challenge',
    dailyAria: 'Daily Challenge, {month} {d}',
    monthNames: 'January|February|March|April|May|June|July|August|September|October|November|December',
    dailyPlay: "Today's challenge",
    seedLabel: 'Daily code',
    seedGo: 'Play this daily code',
    seedBad: "That daily code isn't right — check it again",
    seedExpired: 'This daily code has expired',
    seedNewer: 'This daily code needs a newer version of Slides',
    seedNoBoard: 'Games started from a daily code don’t go on the leaderboards',
    dailyTurn: 'Turn your phone sideways',
    rankTabDaily: 'Today',
    dailyBest: "Today's best {n}",
    shareStartLabel: 'Start',
    shareEndLabel: 'End',
    shareAllCleared: 'Board cleared',
    shareFooterHint: 'Drag a whole row, column, or diagonal to match same-colour patterns',
    colorblindBtn: 'Colourblind-friendly palette',
    proBtn: 'Pro',
    shapeNameSquare: 'Square',
    shapeNameCircle: 'Classic Balls',
    shapeNameTriangle: 'Triangle',
    shapeNameCircleHex: 'Hex Balls',
    shapeNameSquareDiamond: 'Diamond Square',
    shapeNameTriangleBig: 'Big Triangle',
    shapeNameCircleSeven: 'Diamond Balls',
    shapeNameTriangleAdvanced: 'Advanced Triangle',
  },
  fr: {
    langName: 'Français',
    homeTagline: 'Glisser · Marquer · Effacer',
    knowHow: 'Je sais jouer',
    next: 'Suivant',
    prev: 'Précédent',
    coachPrev: 'Précédent',
    replay: 'Rejouer',
    doneBtn: 'Terminé',
    pause: 'Pause',
    resume: 'Reprendre',
    run4: 'Faites glisser une ligne ou une colonne pour aligner 4 cases de la même couleur',
    flip: 'Une case qui marque devient une étoile, d’une couleur tirée au hasard',
    navProfile: 'Profil',
    navRecords: 'Historique et classements',
    noRecordsYet: 'Pas encore de score',
    recordsResetByRules: 'Nouvelles règles en ligne — votre palmarès repart d\'ici',
    switchLanguage: 'Langue',
    sectionTimed: 'Défi chronométré',
    flipModeTitle: 'Retournement infini',
    flipModeTagline: 'Marquer crée une étoile, marquer encore la ramène · les étoiles ne s’effacent jamais · 100 s',
    timedModeTagline: 'Défi de 100 secondes',
    flipScoringHint: 'Le motif reste à quatre pièces toute la partie · pas de facteur de coups',
    puzzleModeTitle: 'Énigme · Pas à pas',
    puzzleModeTagline: 'Huit coups en main. Un coup coûte 1. Marquer en rend 1. Marquer deux fois de suite en rend 1 de plus. Effacer une ligne en rend 2 de plus. Sans chronomètre.',
    stepsLeftLabel: 'Coups',
    stepsOutReason: 'Plus de coups',
    puzzleClearedLabel: 'Effacées {c} × {n}',
    puzzleStarsLabel: 'Étoiles {c} × {n}',
    puzzleStepsLabel: '{n} coup ({k} avec points)|{n} coups ({k} avec points)',
    puzzleStreakLabel: 'Coups rendus · enchaînés',
    puzzleEdgeLabel: 'Coups rendus · lignes',
    puzzleLeftLabel: '{l} restants (max {p})',
    bombBasicTitle: 'Bombe de base',
    bombTimedTitle: 'Bombe chronométrée',
    bombAdvancedTitle: 'Bombe avancée',
    randomTargetTitle: 'Mode machine à sous',
    randomTargetTagline: 'Motifs gagnants tirés au hasard',
    slotShareCaption: 'Motifs pour la salle',
    slotSameLabel: 'Identiques',
    slotOwnLabel: 'Différents',
    slotDemoStop: 'STOP',
    slotStartLabel: 'Démarrer',
    comingSoon: 'Bientôt disponible',
    multiplayerTitle: 'Multijoueur',
    rankingsTitle: 'Historique et classements',
    rankTotalBoard: 'Général',
    rankTabBase: 'Base',
    rankTabTimed: 'Chrono',
    rankTabBomb: 'Bombe',
    rankTabLayout: 'Plateaux',
    rankTabSlot: 'Machine',
    rankTabFlip: 'Infini',
    rankTabPuzzle: 'Pas à pas',
    rankLocked: 'Vos parties comptent peut-être déjà — devenez Slides Génie pour voir le classement',
    rankLockedCta: 'Devenir un Slides Génie',
    rankSignedOut: 'Connectez-vous et vos parties entrent au classement',
    rankEmpty: 'Personne à ce classement pour l’instant',
    rankNetwork: 'Classement indisponible. Vérifiez votre connexion.',
    dailyNotCounted: 'Cette partie ne compte pas pour le défi du jour. Vérifiez la date et l’heure de votre appareil.',
    rankAnon: 'Joueur anonyme',
    nickSet: 'Choisir un pseudonyme',
    nickEdit: 'Modifier le pseudonyme',
    nickSave: 'Enregistrer le pseudonyme',
    nickCancel: 'Annuler',
    nickTaken: 'Ce pseudonyme est déjà pris.',
    nickBlocked: 'Choisissez un autre nom.',
    nickBad: '12 caractères au maximum.',
    nickRequired: 'Le pseudonyme ne peut pas être vide.',
    puzzleLeftSteps: '{n} coup restant|{n} coups restants',
    rankLoading: 'Chargement…',
    rankExpired: 'Votre session a expiré. Reconnectez-vous pour que vos parties entrent au classement.',
    rankReLogin: 'Se reconnecter',
    flipSpeedTitle: 'Vitesse des étoiles',
    flipSpeedHint: 'À quelle vitesse une pièce devient une étoile. Le reste ne change pas.',
    flipSpeedLocked: 'Réglage Slides Génie. Voici ce qu\u2019il fait.',
    flipSpeedSlow: 'Lent',
    flipSpeedFast: 'Rapide',
    flipSpeedPick: 'Recommandé',
    totalScoreTitle: 'Score cumulé',
    totalScoreSync: 'Connectez-vous : vos 60 dernières parties sont gardées dans le cloud',
    backToMenu: 'Retour au menu',
    homeBtn: 'Accueil',
    rotateHint: 'Tournez votre téléphone — ce plateau est large',
    back: 'Retour',
    accountTitle: 'Compte',
    loginGateway: 'Connexion',
    tutorialShort: 'Tutoriel',
    becomeGenius: 'Devenir un Slides Génie',
    geniusSpecialTitle: 'Exclusivités Slides Génie',
    geniusNowTitle: 'Débloqué dès votre inscription',
    geniusNowCircleSeven: 'Plateau losange à sept couleurs',
    geniusNowTriangleBig: 'Plateau triangle hexagonal, 54 pièces',
    geniusSoonTitle: 'Bientôt disponible',
    geniusHostRooms: 'Montez une salle et faites la course en ligne',
    subscribeTitle: 'Inscrivez-vous — Slides Génie, gratuit',
    registerBtn: 'Créer un compte',
    planMonthly: 'par mois',
    planYearly: 'par an',
    restoreBtn: 'Restaurer l’achat',
    signInBtn: 'Se connecter',
    signOutBtn: 'Se déconnecter',
    emailLabel: 'E-mail',
    emailPlaceholder: 'vous@exemple.com',
    emailInvalid: 'Cette adresse ne semble pas valide.',
    signInHint: 'Votre adresse, et un code à six chiffres envoyé par e-mail. Aucun mot de passe à retenir.',
    storeNoAccountHint: 'Acheté avec votre compte {store} — sans inscription, sans quitter l’application.',
    subscribedTitle: 'Vous êtes un Slides Génie',
    manageSubscription: 'Gérer l’abonnement',
    manageOnStore: 'Résiliez ou modifiez dans les réglages de votre compte {store}.',
    geniusStatus: 'Compte',
    geniusOnly: 'Réservé aux Génies',
    passwordLabel: 'Code secret (6 caractères)',
    pwMeterSay: 'Code secret à 6 caractères · {n} saisis',
    setPwShort: 'Exactement six lettres ou chiffres.',
    newsOptIn: 'M’envoyer les nouveautés par e-mail',
    codeSentTo: 'Envoyé à {email}',
    useAnotherEmail: '← Changer d’adresse',
    mailDownHint: 'Les e-mails ne partent pas pour le moment. Essayez « Sans e-mail ».',
    pairlessEntry: 'Sans e-mail',
    pairFirstLabel: 'Première chaîne',
    pairFirstShort: 'Première chaîne',
    showHandle: 'Afficher la première chaîne',
    hideHandle: 'Masquer la première chaîne',
    contactThanksTitle: 'Contact et remerciements',
    contactTitle: 'Contact',
    thanksTitle: 'Remerciements',
    contactInvite: 'Si quelque chose ne va pas, écrivez-moi en joignant une capture d’écran. Et si tout va bien, écrivez-moi quand même — je lis et réponds à chaque message personnellement. Merci de votre soutien.',
    thanksTail: 'et les nombreux amis qui ont joué, testé et dit ce qu’il fallait corriger',
    pairSecondLabel: 'Deuxième chaîne',
    pairKeyNote: 'à ne pas partager',
    pairPlaceholder: '8 à 64 lettres ou chiffres, casse respectée',
    continueBtn: 'Continuer',
    pairWarning: 'La première chaîne est votre clé. Ne la donnez à personne : qui la connaît peut redéfinir la seconde.',
    pairSaveBtn: 'Enregistrer',
    pairSavedHint: '✓ Enregistré — faites une capture des deux chaînes',
    pairNewAccountHint: 'Connecté à un nouveau compte. Si vous vouliez l’ancien, déconnectez-vous et réessayez.',
    pairForgot: 'Deuxième chaîne oubliée ?',
    pairResetBtn: 'Définir une nouvelle deuxième chaîne',
    useEmailInstead: '← Utiliser une adresse e-mail',
    pairTaken: 'Cette première chaîne est déjà prise. Choisissez-en une autre.',
    pairBad: 'Les deux chaînes doivent faire 8 à 64 lettres ou chiffres.',
    pairWrong: 'Ces deux chaînes ne correspondent à aucun compte.',
    codeWrong: 'Ce code n’est pas le bon.',
    codeStale: 'Ce code a expiré. Demandez-en un nouveau.',
    codeExpired: 'Ce code Génie a dépassé sa date limite.',
    tooManyTries: 'Trop de tentatives depuis ce réseau. Réessayez plus tard.',
    alreadyActive: 'Votre abonnement court toujours. Gardez ce code Génie pour plus tard, ou offrez-le — il ne sert qu’une fois.',
    orderTitle: 'Votre compte',
    orderPlanLabel: 'Formule',
    orderUntilLabel: 'Valable jusqu’au',
    orderLifetime: 'À vie',
    orderLapsed: 'Ce compte n’a pas d’accès pour le moment.',
    giftTitle: 'Deux mois à offrir',
    giftHint: 'Pour votre abonnement à l’année. Offrez-en un — chacun débloque un mois, une seule fois.',
    giftUsed: 'utilisé',
    giftExpires: 'à utiliser avant le {date}',
    copyBtn: 'Copier',
    copiedLabel: 'Copié',
    redeemBadCode: 'Ce code Génie n’est pas valide, ou il a déjà été utilisé.',
    pwWrong: 'Ce code secret n’est pas le bon.',
    pwLocked: 'Trop d’essais. Se rouvre dans environ {hours} h.',
    pwBlocked: 'Verrouillé après trop d’essais. Rouvrez-le par e-mail.',
    unlockSendBtn: 'Envoyer le code',
    codeFieldLabel: 'Le code à 6 chiffres reçu par e-mail',
    accountActions: 'Réglages du compte',
    supportLine: 'Une question, un remboursement, quoi que ce soit — écrivez à {email}.',
    changeEmailRow: 'Changer d’adresse',
    newEmailLabel: 'Nouvelle adresse',
    emailCodeSent: 'Un code à 6 chiffres est parti vers la nouvelle adresse. Saisissez-le pour terminer.',
    emailChanged: 'C’est fait — votre compte est sur la nouvelle adresse.',
    emailTaken: 'Cette adresse a déjà un compte.',
    emailSame: 'C’est déjà votre adresse actuelle.',
    confirmBtn: 'Confirmer',
    sessionGone: 'Cet appareil n’est plus connecté. Reconnectez-vous.',
    unlockBadCode: 'Ce code n’est pas le bon.',
    unlockExpired: 'Ce code a expiré. Demandez-en un nouveau.',
    unlockNoMail: 'Nous ne pouvons pas encore envoyer d’e-mail automatiquement. Écrivez à {email} et nous le rouvrirons.',
    mpTitle: 'Multijoueur',
    mpIntro: 'Montez une petite salle, un seul et même plateau, et faites la course.',
    mpCreate: 'Ouvrir une salle',
    mpContest: 'Ouvrir un concours',
    mpCreateNoun: 'une salle',
    mpContestNoun: 'un concours',
    mpContestHint: 'Jusqu’à 20 · vous regardez, sans jouer',
    mpJoin: 'Rejoindre une salle',
    mpNameLabel: 'Votre nom',
    mpNamePlaceholder: 'Choisissez un nom',
    mpShuffle: 'Un autre',
    mpCodeLabel: 'Code de la salle',
    mpCodePlaceholder: 'quatre chiffres',
    mpRoomCode: 'Salle',
    mpShareHint: 'Donnez ces quatre chiffres à un ami : il pourra rejoindre la salle.',
    mpPlayers: 'Joueurs',
    mpHostBadge: 'hôte',
    mpLeave: 'Quitter la salle',
    mpNeedGenius: 'Rejoignez la salle d’un Slides Génie',
    mpStandings: 'Classement',
    mpFinished: 'terminé',
    mpGoPick: 'Choisir un plateau sur l’accueil',
    mpPickingTitle: 'Vous choisissez pour la salle {code}',
    mpBackToRoom: 'Retour à la salle',
    mpNotAMode: 'Les salles jouent les six plateaux — ni chrono ni bombes.',
    mpRoundLabel: 'Manche {n}',
    mpNextRound: 'Choisir le plateau suivant',
    mpDisbandRoom: 'Dissoudre la salle',
    mpStopWaiting: 'Ne plus attendre',
    mpDisbandFailed: 'La salle est toujours ouverte — réessayez.',
    mpRoomEnded: 'L’hôte a fermé la salle.',
    mpTotalLabel: 'total',
    mpRoomTotal: 'Total de la salle',
    mpNudge: 'Presser l’hôte',
    mpLeftTag: 'parti',
    paletteTitle: 'Couleurs des pièces',
    paletteHint: 'S’applique à tous les plateaux. Inactif quand la palette daltonienne est active.',
    paletteLocked: 'Voici ce dans quoi un Slides Génie peut choisir.',
    themeTitle: 'Interface sombre',
    paletteCvdTitle: 'Palette daltonienne',
    paletteCvdHint: 'Les trois sont vérifiées pour les daltonismes rouge, vert et bleu-jaune. Choisissez celle qui vous plaît.',
    cvdStd: 'Standard',
    cvdWarm: 'Chaude',
    cvdCool: 'Froide',
    paletteNow: 'D’origine',
    paletteJia: 'Profonde',
    paletteBing: 'Douce',
    mpKnowRules: 'Vous connaissez les règles de {name} ?',
    mpKnowYes: 'Oui',
    mpKnowNo: 'Expliquez-moi',
    mpLearningWait: 'Quelqu’un apprend encore — un instant',
    mpPracticeHint: 'Ne restez pas à attendre : essayez !',
    mpRoundResult: 'Cette manche',
    mpFinalTitle: 'Bilan de la salle',
    mpBestRound: 'Meilleure manche',
    mpFastest: 'Manche la plus rapide',
    mpRoundsPlayed: '{n} manche|{n} manches',
    mpRoundDropped: 'Absence trop longue : cette manche n’entre pas dans le total de la salle. Elle reste dans vos records.',
    newVersionTip: 'Nouvelle version — recharger',
    mpErrEnded: 'Cette salle a été fermée.',
    mpReconnecting: 'Connexion perdue — on vous y ramène…',
    mpHostLeaveWarn: 'Dissoudre la salle ?',
    mpGuestLeaveWarn: 'Partir ?',
    mpLeaveAnyway: 'Partir quand même',
    mpLeaveHold: 'Maintenir pour partir',
    mpLeaveHoldHint: 'Maintenez le bouton, ou appuyez sur Entrée',
    mpStay: 'Rester',
    mpFinishConfirm: 'Terminé ?',
    mpRoomCancelled: 'L’hôte est parti — la salle est fermée pour l’instant',
    mpHostLeftLocked: 'L’hôte est parti, la salle est fermée pour l’instant — revenez un peu plus tard ?',
    mpHostAwaySolo: 'L’hôte s’est absenté · vous jouez seul désormais',
    mpOk: 'ok',
    mpHostFixing: 'L’hôte revient tout de suite',
    mpErrNoRoom: 'Aucune salle avec ce code.',
    mpErrFull: 'Cette salle est pleine.',
    mpErrStarted: 'Cette partie a déjà commencé.',
    mpErrClaimed: 'Quelqu’un vient de reprendre cette place. Essayez un autre nom.',
    mpErrTooFew: 'Il faut au moins deux joueurs.',
    mpErrNotOpen: 'Le multijoueur n’est pas encore ouvert.',
    mpErrTooMany: 'Trop de requêtes depuis votre réseau à l’instant. Attendez quelques secondes et réessayez — ce n’est pas votre connexion.',
    mpErrNotHost: 'Seul l’hôte peut faire cela.',
    mpErrMode: 'Ce mode ne peut pas ouvrir de salle pour l’instant. Actualisez et réessayez.',
    notOnSaleYet: 'L’abonnement n’est pas encore ouvert.',
    purchaseUnavailable: 'Cet appareil ne peut pas encore finaliser l’achat.',
    purchaseCancelled: 'Annulé — vous n’avez pas été débité.',
    purchaseNetwork: 'Pas de connexion. Réessayez dans un instant.',
    serverBusy: 'Un problème de notre côté, pas avec votre connexion. Réessayez dans un instant.',
    restoreNothing: 'Aucun abonnement à restaurer.',
    workingLabel: 'En cours…',
    pauseBtn: 'Pause',
    finishBtn: 'Terminer',
    endRunYes: 'Oui',
    endRunNo: 'Non',
    scoreLabel: 'Score',
    timeLabel: 'Temps',
    startBtn: 'Commencer',
    pausedTitle: 'En pause',
    howToPlayBtn: 'Comment jouer',
    gotItBtn: 'Compris',
    restartRunBtn: 'Rejouer',
    restartConfirm: 'Recommencer ?',
    endRunBtn: 'Terminer',
    compositeScoreLabel: 'Score final',
    avgScoreLabel: 'Votre moyenne dans ce mode',
    soundBtn: 'Son',
    shareBtn: 'Partager',
    restartBtn: 'Rejouer',
    shareCardTitle: 'Partager le résultat',
    shareImgAlt: 'Carte de résultat',
    shareHint: 'Appuyez longuement, ou clic droit sur l\'image, pour l\'enregistrer',
    closeBtn: 'Fermer',
    shellStartBody: 'Faites glisser une ligne entière pour former des motifs d\'une même couleur. Touchez Commencer pour un nouveau plateau.',
    taglineRowCol: 'Faites glisser une rangée ou une colonne · formez des motifs d\'une même couleur',
    taglineThreeWay: 'Faites glisser une ligne — horizontale, ou l\'une des deux diagonales · formez des motifs d\'une même couleur',
    taglineDiagonal: 'Faites glisser une ligne — horizontale ou en diagonale · formez des motifs d\'une même couleur',
    taglineVBoard: 'Un plateau en V · les deux bras glissent indépendamment',
    taglineBomb: 'Empêchez 4 pièces rouges de se rejoindre',
    rulesPill: 'Règles du jeu',
    labelRunN: 'Suite de {n}',
    labelPattern: 'Motif',
    labelWholeLine: 'Ligne entière',
    endTipComposite: 'Score final = score de jeu \u00d7 coefficient de coups. Moins de coups, plus gros coefficient \u2014 jamais sous \u00d71,00.',
    patternNowLabel: 'Le motif passe à {n} pièce|Le motif passe à {n} pièces',
    builtScoreHudLabel: 'Score de jeu',
    flipRowLabel: '{n} retournée ×2|{n} retournées ×2',
    flipRowDefused: '(dont {n} désamorcée)|(dont {n} désamorcées)',
    lineRowLabel: '{n} ligne effacée (étoiles²)|{n} lignes effacées (étoiles²)',
    slotBonusLabel: 'Prime de réussite',
    builtScoreLabel: 'Score de jeu',
    stepCoefLabel: 'Coefficient de coups',
    stepCoefDetail: '{p} coups · référence {par}',
    compositeLabel: 'Score final',
    timeNotScoredLabel: 'Temps {t} (hors score)',
    badgeSwept: 'Plateau vidé',
    badgeUnlockedOne: 'Motif à 1 pièce',
    patternPointsLabel: 'Points de motifs',
    comboBonusLabel: 'Bonus de série',
    linePointsLabel: 'Bonus de ligne',
    perfBonusLabel: 'Bonus de taux de réussite',
    timeMultLabel: 'Multiplicateur de temps',
    neverFlippedLabel: 'Jamais devenues étoiles',
    defaultPenaltyLabel: 'Pénalité',
    bombPenaltyLabel: 'Pénalité de bombe',
    timeUpReason: 'Temps écoulé',
    noMoreMatchesReason: 'Plus aucun motif ne peut être formé',
    allFlippedReason: 'Plateau vidé',
    manualEndReason: 'Terminé manuellement',
    bombHazardReason: 'Cases-bombes connectées',
    stepsPhrase: '{n} coup|{n} coups',
    bestPhrase: 'meilleur score {n}',
    shareQrCaption: 'Scannez pour jouer à Slides',
    shareSeedLine: 'Code du jour {code}',
    shareDailyTag: 'Défi du {d}/{m}',
    dailyTitle: 'Défi du jour',
    dailyAria: 'Défi du jour, {d} {month}',
    monthNames: 'janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre',
    dailyPlay: "Défi d'aujourd'hui",
    seedLabel: 'Code du jour',
    seedGo: 'Jouer ce code du jour',
    seedBad: "Ce code du jour n'est pas valide — vérifiez-le",
    seedExpired: 'Ce code du jour a expiré',
    seedNewer: 'Ce code du jour demande une version plus récente de Slides',
    seedNoBoard: 'Les parties lancées depuis un code du jour ne vont pas au classement',
    dailyTurn: 'Tournez votre téléphone',
    rankTabDaily: "Aujourd'hui",
    dailyBest: 'Meilleur du jour {n}',
    shareStartLabel: 'Début',
    shareEndLabel: 'Fin',
    shareAllCleared: 'Plateau vidé',
    shareFooterHint: 'Faites glisser une ligne, colonne ou diagonale entière pour assortir les couleurs',
    colorblindBtn: 'Palette adaptée aux daltoniens',
    proBtn: 'Pro',
    shapeNameSquare: 'Carré',
    shapeNameCircle: 'Billes classiques',
    shapeNameTriangle: 'Triangle',
    shapeNameCircleHex: 'Billes hexagone',
    shapeNameSquareDiamond: 'Carré losange',
    shapeNameTriangleBig: 'Grand triangle',
    shapeNameCircleSeven: 'Billes losange',
    shapeNameTriangleAdvanced: 'Triangle avancé',
  },
  zhHant: {
    langName: '繁體中文',
    homeTagline: '滑動－得分－消除',
    knowHow: '我會玩',
    next: '下一條',
    prev: '上一條',
    coachPrev: '上一條',
    replay: '再一次',
    doneBtn: '完成',
    pause: '暫停',
    resume: '繼續',
    run4: '滑動一整行或一整列，湊齊 4 個同色方塊',
    flip: '得分的方塊會變成星星，顏色隨機',
    navProfile: '個人主頁',
    navRecords: '記錄與排名',
    noRecordsYet: '尚無成績',
    recordsResetByRules: '新規則上線，戰績從這裡重新開始',
    switchLanguage: '語言',
    sectionTimed: '計時挑戰',
    flipModeTitle: '無限反轉',
    flipModeTagline: '得分變星星，再得分變回色塊，來回反轉，星星不消除，100 秒',
    timedModeTagline: '100s 挑戰',
    flipScoringHint: '得分圖案整局都是 4 枚 · 不乘步數係數',
    puzzleModeTitle: '真正解密 · 步步為營',
    puzzleModeTagline: '手裡 8 步。走一步扣 1 步。得分退回 1 步。連著得分再退 1 步。消掉一條線再退 2 步。沒有時間限制。',
    stepsLeftLabel: '餘步',
    stepsOutReason: '步數用完了',
    puzzleClearedLabel: '被消除 {c} 枚 × {n}',
    puzzleStarsLabel: '星星 {c} 顆 × {n}',
    puzzleStepsLabel: '走了 {n} 步（得分 {k} 步）',
    puzzleStreakLabel: '連續多退',
    puzzleEdgeLabel: '消邊多退',
    puzzleLeftLabel: '剩 {l}（最多攢到 {p}）',
    bombBasicTitle: '基礎炸彈',
    bombTimedTitle: '定時炸彈',
    bombAdvancedTitle: '進階炸彈',
    randomTargetTitle: '老虎機模式',
    randomTargetTagline: '隨機得分圖案',
    slotShareCaption: '全屋的得分圖案',
    slotSameLabel: '相同',
    slotOwnLabel: '不同',
    slotDemoStop: 'STOP',
    slotStartLabel: '開始',
    comingSoon: '敬請期待',
    multiplayerTitle: '多人遊玩',
    rankingsTitle: '成績與排名',
    rankTotalBoard: '總榜',
    rankTabBase: '基礎',
    rankTabTimed: '計時',
    rankTabBomb: '炸彈',
    rankTabLayout: '特殊佈局',
    rankTabSlot: '老虎機',
    rankTabFlip: '無限反轉',
    rankTabPuzzle: '步步為營',
    rankLocked: '你的排名或許已經上榜，成為 Slides 天才查看',
    rankLockedCta: '成為 Slides 天才',
    rankSignedOut: '登入之後，你的成績才會上榜',
    rankEmpty: '這張榜上還沒有人',
    rankNetwork: '榜沒載入，檢查一下網路。',
    dailyNotCounted: '這一局沒進今日挑戰榜。看看設備的日期和時間對不對。',
    rankAnon: '匿名玩家',
    nickSet: '設定暱稱',
    nickEdit: '修改暱稱',
    nickSave: '儲存暱稱',
    nickCancel: '取消',
    nickTaken: '這個暱稱已經有人用了',
    nickBlocked: '換一個名字',
    nickBad: '最多 12 個字',
    nickRequired: '暱稱不能空著',
    puzzleLeftSteps: '剩 {n} 步',
    rankLoading: '載入中…',
    rankExpired: '登入已過期，重新登入後成績才會上榜',
    rankReLogin: '重新登入',
    flipSpeedTitle: '變成星星的速度',
    flipSpeedHint: '一枚棋子變成星星要多快。其他的都不變。',
    flipSpeedLocked: '這是 Slides 天才的設定。先看看它是做什麼的。',
    flipSpeedSlow: '慢',
    flipSpeedFast: '快',
    flipSpeedPick: '推薦',
    totalScoreTitle: '累計得分',
    totalScoreSync: '登入後最近 60 局會存到雲端',
    backToMenu: '返回選單',
    homeBtn: '主頁',
    rotateHint: '這個棋盤很寬，把手機橫過來玩',
    back: '返回',
    accountTitle: '帳號',
    loginGateway: '登入',
    tutorialShort: '教學',
    becomeGenius: '成為 Slides 天才',
    geniusSpecialTitle: 'Slides 天才特供',
    subscribeTitle: '僅需註冊即可免費成為 Slides 天才',
    geniusNowTitle: '註冊後立即解鎖',
    geniusNowCircleSeven: '七色菱形小球棋盤',
    geniusNowTriangleBig: '六邊三角棋盤，54 枚',
    geniusSoonTitle: '敬請期待',
    geniusHostRooms: '蓋起小屋，和朋友線上競賽',
    registerBtn: '註冊',
    planMonthly: '每月',
    planYearly: '每年',
    restoreBtn: '恢復購買',
    signInBtn: '登入',
    signOutBtn: '登出',
    emailLabel: '信箱',
    emailPlaceholder: 'you@example.com',
    emailInvalid: '這個信箱看起來不太對。',
    signInHint: '留一個信箱，我們寄一組 6 位驗證碼過去。沒有密碼要記。',
    storeNoAccountHint: '用你的 {store} 帳號購買，不必註冊，也不用離開 App。',
    subscribedTitle: '你已經是 Slides 天才',
    manageSubscription: '管理訂閱',
    manageOnStore: '到 {store} 的帳號設定裡取消或更改。',
    geniusStatus: '帳號狀態',
    geniusOnly: '天才特供',
    passwordLabel: '密碼（6 位字元）',
    pwMeterSay: '6 位密碼，已輸入 {n} 位',
    setPwShort: '密碼要正好 6 位，數字或字母。',
    newsOptIn: '接收新玩法與更新郵件',
    codeSentTo: '已寄到 {email}',
    useAnotherEmail: '← 換信箱',
    mailDownHint: '郵件暫時寄不出，可先用《免信箱》。',
    pairlessEntry: '免信箱',
    pairFirstLabel: '第一串',
    pairFirstShort: '第一串',
    showHandle: '顯示第一串',
    hideHandle: '遮住第一串',
    contactThanksTitle: '聯絡與特別感謝',
    contactTitle: '聯絡',
    thanksTitle: '特別感謝',
    contactInvite: '歡迎遇到任何問題附上截圖聯絡我，也歡迎你在沒有遇到問題的情況下聯絡我，我都會本人查看回覆，感謝你的支持',
    thanksTail: '等諸多測試並提出珍貴建議的朋友',
    pairSecondLabel: '第二串',
    pairKeyNote: '勿外傳',
    pairPlaceholder: '8–64 位字母或數字，分大小寫',
    continueBtn: '繼續',
    pairWarning: '第一串是你的鑰匙，別告訴任何人——知道它的人可以重設第二串。',
    pairSaveBtn: '儲存',
    pairSavedHint: '✓ 已存好，截圖留存兩串',
    pairNewAccountHint: '新帳號登入成功，若嘗試登入舊帳號請退出重試',
    pairForgot: '忘了第二串？',
    pairResetBtn: '重設第二串',
    useEmailInstead: '← 改用信箱',
    pairTaken: '這一串已經有人在用了，換一串。',
    pairBad: '兩串都要 8–64 位字母或數字。',
    pairWrong: '這兩串對不上。',
    codeWrong: '驗證碼不對。',
    codeStale: '驗證碼過期了，重新要一張。',
    codeExpired: '這個內部碼已經過了使用期限。',
    tooManyTries: '這個網路上試得太多了，請稍後再試。',
    alreadyActive: '你的訂閱還在有效期內。這張碼留著以後用，或者送人——它只能用一次。',
    orderTitle: '你的帳號',
    orderPlanLabel: '方案',
    orderUntilLabel: '有效期至',
    orderLifetime: '終身',
    orderLapsed: '這個帳號目前沒有權限。',
    giftTitle: '兩個月，送給朋友',
    giftHint: '訂了一年才有的。發一張給朋友——每張解鎖一個月，只能用一次。',
    giftUsed: '已使用',
    giftExpires: '{date} 前有效',
    copyBtn: '複製',
    copiedLabel: '已複製',
    redeemBadCode: '這個內部碼無效，或已經被使用過了。',
    pwWrong: '密碼不對。',
    pwLocked: '錯太多次了，約 {hours} 小時後自動解開。',
    pwBlocked: '錯太多次，已鎖住。用信箱解開。',
    unlockSendBtn: '寄出驗證碼',
    codeFieldLabel: '信件裡的 6 位數驗證碼',
    accountActions: '帳號設定',
    supportLine: '有問題、要退款，什麼事都可以寫信到 {email}。',
    changeEmailRow: '更換信箱',
    newEmailLabel: '新的信箱',
    emailCodeSent: '驗證碼已經寄到新的信箱，填進來就換好。',
    emailChanged: '換好了——帳號已經在新的信箱底下。',
    emailTaken: '這個信箱已經有帳號了。',
    emailSame: '這就是你現在用的信箱。',
    confirmBtn: '確認',
    sessionGone: '這台裝置的登入已經失效，請重新登入。',
    unlockBadCode: '驗證碼不對。',
    unlockExpired: '驗證碼已過期，請重新寄一次。',
    unlockNoMail: '目前還無法自動寄信。請寫信到 {email}，我們幫你開啟。',
    mpTitle: '多人遊玩',
    mpIntro: '蓋起一個小屋，同樣的棋盤，與大家競賽',
    mpCreate: '開小屋',
    mpContest: '開競賽',
    mpCreateNoun: '小屋',
    mpContestNoun: '競賽',
    mpContestHint: '最多 20 人 · 你主持、看即時榜單，不下場',
    mpJoin: '加入小屋',
    mpNameLabel: '你的名字',
    mpNamePlaceholder: '起個名字',
    mpShuffle: '換一個',
    mpCodeLabel: '小屋號碼',
    mpCodePlaceholder: '四位數字',
    mpRoomCode: '小屋號碼',
    mpShareHint: '把這四位數字給朋友，邀請加入小屋',
    mpPlayers: '玩家',
    mpHostBadge: '屋主',
    mpLeave: '離開小屋',
    mpNeedGenius: '加入 Slides 天才搭建的小屋',
    mpStandings: '排名',
    mpFinished: '已完成',
    mpGoPick: '去主選單選玩法',
    mpPickingTitle: '你為 {code} 小屋選擇',
    mpBackToRoom: '小屋裡',
    mpNotAMode: '小屋只玩六副棋盤，計時與炸彈暫時不行。',
    mpRoundLabel: '第 {n} 局',
    mpNextRound: '選下一個玩法',
    mpDisbandRoom: '解散小屋',
    mpStopWaiting: '不等了',
    mpDisbandFailed: '小屋還沒解散，再按一次試試。',
    mpRoomEnded: '屋主結束了小屋。',
    mpTotalLabel: '總分',
    mpRoomTotal: '全屋總分',
    mpNudge: '催屋主',
    mpLeftTag: '已離開',
    paletteTitle: '棋子配色',
    paletteHint: '換的是每個玩法裡棋子的顏色。開著色盲配色時這裡不生效。',
    paletteLocked: '這就是 Slides 天才能挑的幾套。',
    themeTitle: '深色介面',
    paletteCvdTitle: '色盲配色',
    paletteCvdHint: '三套都驗過紅色盲、綠色盲、藍黃色盲。挑你順眼的那一套。',
    cvdStd: '標準',
    cvdWarm: '暖',
    cvdCool: '冷',
    paletteNow: '原本',
    paletteJia: '沉穩',
    paletteBing: '柔和',
    mpKnowRules: '會{name}的規則嗎？',
    mpKnowYes: '會',
    mpKnowNo: '不會，教我',
    mpLearningWait: '小屋裡有人在學習，稍等',
    mpPracticeHint: '別乾等著，試著玩玩看',
    mpRoundResult: '本局',
    mpFinalTitle: '小屋戰績',
    mpBestRound: '單局最高',
    mpFastest: '單局最快',
    mpRoundsPlayed: '共 {n} 局',
    mpRoundDropped: '離開太久了，這一局沒算進小屋總分；你自己的記錄裡還在。',
    newVersionTip: '有新版本，點一下重新載入',
    mpErrEnded: '這個小屋已經結束了。',
    mpReconnecting: '網路斷了一下，正在把你接回小屋…',
    mpHostLeaveWarn: '解散小屋？',
    mpGuestLeaveWarn: '是否離開？',
    mpLeaveAnyway: '還是離開',
    mpLeaveHold: '按住離開',
    mpLeaveHoldHint: '按住這顆鍵，或按 Enter',
    mpStay: '留下',
    mpFinishConfirm: '完成了嗎？',
    mpRoomCancelled: '屋主離家出走了，小屋暫時解散',
    mpHostLeftLocked: '屋主離開，小屋暫時解散，等一會再來？',
    mpHostAwaySolo: '屋主暫時離開，正在獨自遊玩',
    mpOk: 'ok',
    mpHostFixing: '屋主等一下就來',
    mpErrNoRoom: '沒有這個小屋號碼。',
    mpErrFull: '小屋滿了。',
    mpErrStarted: '這一局已經開始了。',
    mpErrClaimed: '剛才有人先一步坐回這個位子了。換個名字再試。',
    mpErrTooFew: '至少要兩個人。',
    mpErrNotOpen: '多人遊玩尚未開放。',
    mpErrTooMany: '剛才你這個網路發來的請求太多了，等幾秒再試一次。這不是你的網路問題。',
    mpErrNotHost: '只有屋主能這樣做。',
    mpErrMode: '這個玩法暫時進不了小屋，重新整理頁面再試。',
    notOnSaleYet: '訂閱尚未開放。',
    purchaseUnavailable: '這台裝置目前還無法完成購買。',
    purchaseCancelled: '已取消，沒有扣款。',
    purchaseNetwork: '連不上網路，請稍後再試。',
    serverBusy: '伺服器暫時出錯，請稍後再試。這不是你的網路問題。',
    restoreNothing: '沒有找到可以恢復的訂閱。',
    workingLabel: '處理中…',
    pauseBtn: '暫停',
    finishBtn: '完成',
    endRunYes: '是',
    endRunNo: '否',
    scoreLabel: '得分',
    timeLabel: '用時',
    startBtn: '開始',
    pausedTitle: '已暫停',
    howToPlayBtn: '怎麼玩',
    gotItBtn: '知道了',
    restartRunBtn: '再來一局',
    restartConfirm: '重新開一局？',
    endRunBtn: '結束遊戲',
    compositeScoreLabel: '綜合得分',
    avgScoreLabel: '該玩法你的均分',
    soundBtn: '聲音',
    shareBtn: '分享',
    restartBtn: '再來',
    shareCardTitle: '分享戰績',
    shareImgAlt: '戰績卡片',
    shareHint: '長按或右鍵圖片即可儲存',
    closeBtn: '關閉',
    shellStartBody: '拖動整條線拼出同色圖案，點擊開始生成一局新的棋盤。',
    taglineRowCol: '拖動一整行或一整列 · 拼出同色圖案',
    taglineThreeWay: '沿水平、左斜或右斜方向拖動整條線 · 拼出同色圖案',
    taglineDiagonal: '拖動水平或斜線方向的整條線 · 拼出同色圖案',
    taglineVBoard: 'V 形棋盤 · 左右兩臂橫向互不相連',
    taglineBomb: '避免紅色 4 連',
    rulesPill: '遊戲規則',
    labelRunN: '{n}連',
    labelPattern: '圖案',
    labelWholeLine: '整線',
    endTipComposite: '綜合分 = 拼出分 × 步數係數。步數越少係數越高，最低 ×1.00，只加不減。',
    patternNowLabel: '得分圖案變成 {n} 枚',
    builtScoreHudLabel: '拼出得分',
    flipRowLabel: '翻面 {n} 枚 ×2',
    flipRowDefused: '（含拆除 {n} 枚）',
    lineRowLabel: '削線 {n} 條（星星數²）',
    slotBonusLabel: '完成獎勵',
    builtScoreLabel: '拼出分',
    stepCoefLabel: '步數係數',
    stepCoefDetail: '{p}步，基準{par}',
    compositeLabel: '綜合分',
    timeNotScoredLabel: '用時 {t}（不計分）',
    badgeSwept: '清盤',
    badgeUnlockedOne: '解鎖 1 枚',
    patternPointsLabel: '圖案分',
    comboBonusLabel: '連擊加成',
    linePointsLabel: '整線獎勵',
    perfBonusLabel: '有效得分率加成',
    timeMultLabel: '用時係數',
    neverFlippedLabel: '沒變成星星',
    defaultPenaltyLabel: '懲罰',
    bombPenaltyLabel: '炸彈懲罰',
    timeUpReason: '時間到',
    noMoreMatchesReason: '再也湊不出得分圖案',
    allFlippedReason: '全部消完了',
    manualEndReason: '手動結束',
    bombHazardReason: '紅色炸彈相連',
    stepsPhrase: '共 {n} 步',
    bestPhrase: '本機最佳 {n}',
    shareQrCaption: '掃碼來 Slides～',
    shareSeedLine: '代號 {code}',
    shareDailyTag: '每日 {m}/{d}',
    dailyTitle: '每日挑戰',
    dailyAria: '每日挑戰，{m} 月 {d} 日',
    monthNames: '一月|二月|三月|四月|五月|六月|七月|八月|九月|十月|十一月|十二月',
    dailyPlay: '今日挑戰',
    seedLabel: '代號',
    seedGo: '用這個代號開局',
    seedBad: '這串代號不對，再核對一遍',
    seedExpired: '這個代號已過期',
    seedNewer: '這個代號要新版本才能玩',
    seedNoBoard: '代號局不計入排行榜',
    dailyTurn: '請橫屏',
    rankTabDaily: '今日',
    dailyBest: '今日最佳 {n}',
    shareStartLabel: '開始',
    shareEndLabel: '結束',
    shareAllCleared: '全部消除',
    shareFooterHint: '拖動整行整列或整條斜線，拼出同色圖案',
    colorblindBtn: '色盲友好配色',
    proBtn: 'Pro',
    shapeNameSquare: '方塊',
    shapeNameCircle: '圓球',
    shapeNameTriangle: '三角',
    shapeNameCircleHex: '六邊圓球',
    shapeNameSquareDiamond: '菱形方塊',
    shapeNameTriangleBig: '大三角',
    shapeNameCircleSeven: '七色圓球',
    shapeNameTriangleAdvanced: '進階三角',
  },
  zhHans: {
    langName: '简体中文',
    homeTagline: '滑动－得分－消除',
    knowHow: '我会玩',
    next: '下一条',
    prev: '上一条',
    coachPrev: '上一条',
    replay: '再一次',
    doneBtn: '完成',
    pause: '暂停',
    resume: '继续',
    run4: '滑动一整行或一整列，凑齐 4 个同色方块',
    flip: '得分的方块会变成星星，颜色随机',
    navProfile: '个人主页',
    navRecords: '记录与排名',
    noRecordsYet: '尚无成绩',
    recordsResetByRules: '新规则《侵蚀阶梯》上线，战绩从这里重新开始',
    switchLanguage: '语言',
    sectionTimed: '计时挑战',
    flipModeTitle: '无限反转',
    flipModeTagline: '得分变星星，再得分变回色块，来回反转，星星不消除，100 秒',
    timedModeTagline: '100s 挑战',
    flipScoringHint: '得分图案整局都是 4 枚 · 不乘步数系数',
    puzzleModeTitle: '真正解密 · 步步为营',
    puzzleModeTagline: '手里 8 步。走一步扣 1 步。得分退回 1 步。连着得分再退 1 步。消掉一条线再退 2 步。没有时间限制。',
    stepsLeftLabel: '余步',
    stepsOutReason: '步数用完了',
    puzzleClearedLabel: '被消除 {c} 枚 × {n}',
    puzzleStarsLabel: '星星 {c} 颗 × {n}',
    puzzleStepsLabel: '走了 {n} 步（得分 {k} 步）',
    puzzleStreakLabel: '连续多退',
    puzzleEdgeLabel: '消边多退',
    puzzleLeftLabel: '剩 {l}（最多攒到 {p}）',
    bombBasicTitle: '基础炸弹',
    bombTimedTitle: '定时炸弹',
    bombAdvancedTitle: '进阶炸弹',
    randomTargetTitle: '老虎机模式',
    randomTargetTagline: '随机得分图案',
    slotShareCaption: '全屋的得分图案',
    slotSameLabel: '相同',
    slotOwnLabel: '不同',
    slotDemoStop: 'STOP',
    slotStartLabel: '开始',
    comingSoon: '敬请期待',
    multiplayerTitle: '多人游玩',
    rankingsTitle: '成绩与排名',
    rankTotalBoard: '总榜',
    rankTabBase: '基础',
    rankTabTimed: '计时',
    rankTabBomb: '炸弹',
    rankTabLayout: '特殊布局',
    rankTabSlot: '老虎机',
    rankTabFlip: '无限反转',
    rankTabPuzzle: '步步为营',
    rankLocked: '你的排名或许已经上榜，成为 Slides 天才查看',
    rankLockedCta: '成为 Slides 天才',
    rankSignedOut: '登录之后，你的成绩才会上榜',
    rankEmpty: '这张榜上还没有人',
    rankNetwork: '榜没加载出来，检查一下网络。',
    dailyNotCounted: '这一局没进今日挑战榜。看看设备的日期和时间对不对。',
    rankAnon: '匿名玩家',
    nickSet: '设置昵称',
    nickEdit: '修改昵称',
    nickSave: '保存昵称',
    nickCancel: '取消',
    nickTaken: '这个昵称已经有人用了',
    nickBlocked: '换一个名字',
    nickBad: '最多 12 个字',
    nickRequired: '昵称不能空着',
    puzzleLeftSteps: '剩 {n} 步',
    rankLoading: '加载中…',
    rankExpired: '登录已过期，重新登录后成绩才会上榜',
    rankReLogin: '重新登录',
    flipSpeedTitle: '变成星星的速度',
    flipSpeedHint: '一枚棋子变成星星要多快。其他的都不变。',
    flipSpeedLocked: '这是 Slides 天才的设定。先看看它是做什么的。',
    flipSpeedSlow: '慢',
    flipSpeedFast: '快',
    flipSpeedPick: '推荐',
    totalScoreTitle: '累计得分',
    totalScoreSync: '登录后最近 60 局会存到云端',
    backToMenu: '返回菜单',
    homeBtn: '主页',
    rotateHint: '这个棋盘很宽，把手机横过来玩',
    back: '返回',
    accountTitle: '账号',
    loginGateway: '登录',
    tutorialShort: '教学',
    becomeGenius: '成为 Slides 天才',
    geniusSpecialTitle: 'Slides 天才特供',
    subscribeTitle: '仅需注册即可免费成为 Slides 天才',
    geniusNowTitle: '注册后立即解锁',
    geniusNowCircleSeven: '七色菱形小球棋盘',
    geniusNowTriangleBig: '六边三角棋盘，54 枚',
    geniusSoonTitle: '敬请期待',
    geniusHostRooms: '盖起小屋，和朋友线上竞赛',
    registerBtn: '注册',
    planMonthly: '每月',
    planYearly: '每年',
    restoreBtn: '恢复购买',
    signInBtn: '登录',
    signOutBtn: '退出登录',
    emailLabel: '邮箱',
    emailPlaceholder: 'you@example.com',
    emailInvalid: '这个邮箱地址看起来不太对。',
    signInHint: '留一个邮箱，我们寄一组 6 位验证码过去。没有密码要记。',
    storeNoAccountHint: '用你的 {store} 账号购买，不用注册，也不用离开 App。',
    subscribedTitle: '你已经是 Slides 天才',
    manageSubscription: '管理订阅',
    manageOnStore: '到 {store} 的账号设置里取消或更改。',
    geniusStatus: '账号状态',
    geniusOnly: '天才特供',
    passwordLabel: '密码（6 位字符）',
    pwMeterSay: '6 位密码，已输入 {n} 位',
    setPwShort: '密码要正好 6 位，数字或字母。',
    newsOptIn: '接收新玩法与更新邮件',
    codeSentTo: '已寄到 {email}',
    useAnotherEmail: '← 换邮箱',
    mailDownHint: '邮件暂时寄不出，可先用《免邮箱》。',
    pairlessEntry: '免邮箱',
    pairFirstLabel: '第一串',
    pairFirstShort: '第一串',
    showHandle: '显示第一串',
    hideHandle: '遮住第一串',
    contactThanksTitle: '联系与特别感谢',
    contactTitle: '联系',
    thanksTitle: '特别感谢',
    contactInvite: '欢迎遇到任何问题附上截图联络我，也欢迎你在没有遇到问题的情况下联络我，我都会本人查看回复，感谢你的支持',
    thanksTail: '等诸多测试并提出珍贵建议的朋友',
    pairSecondLabel: '第二串',
    pairKeyNote: '勿外传',
    pairPlaceholder: '8–64 位字母或数字，分大小写',
    continueBtn: '继续',
    pairWarning: '第一串是你的钥匙，别告诉任何人——知道它的人可以重设第二串。',
    pairSaveBtn: '保存',
    pairSavedHint: '✓ 已存好，截图留存两串',
    pairNewAccountHint: '新账号登录成功，若尝试登录旧账号请退出重试',
    pairForgot: '忘了第二串？',
    pairResetBtn: '重设第二串',
    useEmailInstead: '← 改用邮箱',
    pairTaken: '这一串已经有人在用了，换一串。',
    pairBad: '两串都要 8–64 位字母或数字。',
    pairWrong: '这两串对不上。',
    codeWrong: '验证码不对。',
    codeStale: '验证码过期了，重新要一张。',
    codeExpired: '这个内部码已经过了使用期限。',
    tooManyTries: '这个网络上试得太多了，请稍后再试。',
    alreadyActive: '你的订阅还在有效期内。这张码留着以后用，或者送人——它只能用一次。',
    orderTitle: '你的账号',
    orderPlanLabel: '方案',
    orderUntilLabel: '有效期至',
    orderLifetime: '终身',
    orderLapsed: '这个账号目前没有权限。',
    giftTitle: '两个月，送给朋友',
    giftHint: '订了一年才有的。发一张给朋友——每张解锁一个月，只能用一次。',
    giftUsed: '已使用',
    giftExpires: '{date} 前有效',
    copyBtn: '复制',
    copiedLabel: '已复制',
    redeemBadCode: '这个内部码无效，或者已经被用过了。',
    pwWrong: '密码不对。',
    pwLocked: '错太多次了，约 {hours} 小时后自动解开。',
    pwBlocked: '错太多次，已锁住。用邮箱解开。',
    unlockSendBtn: '发送验证码',
    codeFieldLabel: '邮件里的 6 位验证码',
    accountActions: '账号设置',
    supportLine: '有问题、要退款，什么事都可以写信到 {email}。',
    changeEmailRow: '更换邮箱',
    newEmailLabel: '新的邮箱',
    emailCodeSent: '验证码已经寄到新邮箱，填进来就换好。',
    emailChanged: '换好了——账号已经在新的邮箱底下。',
    emailTaken: '这个邮箱已经有账号了。',
    emailSame: '这就是你现在用的邮箱。',
    confirmBtn: '确认',
    sessionGone: '这台设备的登录已经失效，请重新登录。',
    unlockBadCode: '验证码不对。',
    unlockExpired: '验证码已过期，请重新发送。',
    unlockNoMail: '目前还无法自动发信。请写信到 {email}，我们帮你开启。',
    mpTitle: '多人游玩',
    mpIntro: '盖起一个小屋，同样的棋盘，与大家竞赛',
    mpCreate: '开小屋',
    mpContest: '开竞赛',
    mpCreateNoun: '小屋',
    mpContestNoun: '竞赛',
    mpContestHint: '最多 20 人 · 你主持、看实时榜单，不下场',
    mpJoin: '加入小屋',
    mpNameLabel: '你的名字',
    mpNamePlaceholder: '起个名字',
    mpShuffle: '换一个',
    mpCodeLabel: '小屋号码',
    mpCodePlaceholder: '四位数字',
    mpRoomCode: '小屋号码',
    mpShareHint: '把这四位数字给朋友，邀请加入小屋',
    mpPlayers: '玩家',
    mpHostBadge: '屋主',
    mpLeave: '离开小屋',
    mpNeedGenius: '加入 Slides 天才搭建的小屋',
    mpStandings: '排名',
    mpFinished: '已完成',
    mpGoPick: '去主菜单选玩法',
    mpPickingTitle: '你为 {code} 小屋选择',
    mpBackToRoom: '小屋里',
    mpNotAMode: '小屋只玩六副棋盘，计时和炸弹暂时不行。',
    mpRoundLabel: '第 {n} 局',
    mpNextRound: '选下一个玩法',
    mpDisbandRoom: '解散小屋',
    mpStopWaiting: '不等了',
    mpDisbandFailed: '小屋还没解散，再按一次试试。',
    mpRoomEnded: '屋主结束了小屋。',
    mpTotalLabel: '总分',
    mpRoomTotal: '全屋总分',
    mpNudge: '催屋主',
    mpLeftTag: '已离开',
    paletteTitle: '棋子配色',
    paletteHint: '换的是每个玩法里棋子的颜色。开着色盲配色时这里不生效。',
    paletteLocked: '这就是 Slides 天才能挑的几套。',
    themeTitle: '深色界面',
    paletteCvdTitle: '色盲配色',
    paletteCvdHint: '三套都验过红色盲、绿色盲、蓝黄色盲。挑你顺眼的那一套。',
    cvdStd: '标准',
    cvdWarm: '暖',
    cvdCool: '冷',
    paletteNow: '原本',
    paletteJia: '沉稳',
    paletteBing: '柔和',
    mpKnowRules: '会{name}的规则吗？',
    mpKnowYes: '会',
    mpKnowNo: '不会，教我',
    mpLearningWait: '小屋里有人在学习，稍等',
    mpPracticeHint: '别干等着，试着玩玩看',
    mpRoundResult: '本局',
    mpFinalTitle: '小屋战绩',
    mpBestRound: '单局最高',
    mpFastest: '单局最快',
    mpRoundsPlayed: '共 {n} 局',
    mpRoundDropped: '离开太久了，这一局没算进小屋总分；你自己的记录里还在。',
    newVersionTip: '有新版本，点一下刷新',
    mpErrEnded: '这个小屋已经结束了。',
    mpReconnecting: '网络断了一下，正在把你接回小屋…',
    mpHostLeaveWarn: '解散小屋？',
    mpGuestLeaveWarn: '是否离开？',
    mpLeaveAnyway: '还是离开',
    mpLeaveHold: '按住离开',
    mpLeaveHoldHint: '按住这颗键，或按 Enter',
    mpStay: '留下',
    mpFinishConfirm: '完成了吗？',
    mpRoomCancelled: '屋主离家出走了，小屋暂时解散',
    mpHostLeftLocked: '屋主离开，小屋暂时解散，等一会再来？',
    mpHostAwaySolo: '屋主暂时离开，正在独自游玩',
    mpOk: 'ok',
    mpHostFixing: '屋主等一下就来',
    mpErrNoRoom: '没有这个小屋号码。',
    mpErrFull: '小屋满了。',
    mpErrStarted: '这一局已经开始了。',
    mpErrClaimed: '刚才有人先一步坐回这个位子了。换个名字再试。',
    mpErrTooFew: '至少要两个人。',
    mpErrNotOpen: '多人游玩尚未开放。',
    mpErrTooMany: '刚才你这个网络发来的请求太多了，等几秒再试一次。这不是你的网络问题。',
    mpErrNotHost: '只有屋主能这样做。',
    mpErrMode: '这个玩法暂时进不了小屋，刷新页面再试。',
    notOnSaleYet: '订阅尚未开放。',
    purchaseUnavailable: '这台设备暂时还无法完成购买。',
    purchaseCancelled: '已取消，没有扣款。',
    purchaseNetwork: '连不上网络，请稍后再试。',
    serverBusy: '服务器暂时出错，请稍后再试。这不是你的网络问题。',
    restoreNothing: '没有找到可以恢复的订阅。',
    workingLabel: '处理中…',
    pauseBtn: '暂停',
    finishBtn: '完成',
    endRunYes: '是',
    endRunNo: '否',
    scoreLabel: '得分',
    timeLabel: '用时',
    startBtn: '开始',
    pausedTitle: '已暂停',
    howToPlayBtn: '怎么玩',
    gotItBtn: '知道了',
    restartRunBtn: '再来一局',
    restartConfirm: '重新开一局？',
    endRunBtn: '结束游戏',
    compositeScoreLabel: '综合得分',
    avgScoreLabel: '该玩法你的均分',
    soundBtn: '声音',
    shareBtn: '分享',
    restartBtn: '再来',
    shareCardTitle: '分享战绩',
    shareImgAlt: '战绩卡片',
    shareHint: '长按或右键图片即可保存',
    closeBtn: '关闭',
    shellStartBody: '拖动整条线拼出同色图案，点击开始生成一局新的棋盘。',
    taglineRowCol: '拖动一整行或一整列 · 拼出同色图案',
    taglineThreeWay: '沿水平、左斜或右斜方向拖动整条线 · 拼出同色图案',
    taglineDiagonal: '拖动水平或斜线方向的整条线 · 拼出同色图案',
    taglineVBoard: 'V 形棋盘 · 左右两臂横向互不相连',
    taglineBomb: '避免红色 4 连',
    rulesPill: '游戏规则',
    labelRunN: '{n}连',
    labelPattern: '图案',
    labelWholeLine: '整线',
    endTipComposite: '综合分 = 拼出分 × 步数系数。步数越少系数越高，最低 ×1.00，只加不减。',
    patternNowLabel: '得分图案变成 {n} 枚',
    builtScoreHudLabel: '拼出得分',
    flipRowLabel: '翻面 {n} 枚 ×2',
    flipRowDefused: '（含拆除 {n} 枚）',
    lineRowLabel: '削线 {n} 条（星星数²）',
    slotBonusLabel: '完成奖励',
    builtScoreLabel: '拼出分',
    stepCoefLabel: '步数系数',
    stepCoefDetail: '{p}步，基准{par}',
    compositeLabel: '综合分',
    timeNotScoredLabel: '用时 {t}（不计分）',
    badgeSwept: '清盘',
    badgeUnlockedOne: '解锁 1 枚',
    patternPointsLabel: '图案分',
    comboBonusLabel: '连击加成',
    linePointsLabel: '整线奖励',
    perfBonusLabel: '有效得分率加成',
    timeMultLabel: '用时系数',
    neverFlippedLabel: '没变成星星',
    defaultPenaltyLabel: '惩罚',
    bombPenaltyLabel: '炸弹惩罚',
    timeUpReason: '时间到',
    noMoreMatchesReason: '再也凑不出得分图案',
    allFlippedReason: '全部消完了',
    manualEndReason: '手动结束',
    bombHazardReason: '红色炸弹相连',
    stepsPhrase: '共 {n} 步',
    bestPhrase: '本机最佳 {n}',
    shareQrCaption: '扫码来 Slides～',
    shareSeedLine: '代号 {code}',
    shareDailyTag: '每日 {m}/{d}',
    dailyTitle: '每日挑战',
    dailyAria: '每日挑战，{m} 月 {d} 日',
    monthNames: '一月|二月|三月|四月|五月|六月|七月|八月|九月|十月|十一月|十二月',
    dailyPlay: '今日挑战',
    seedLabel: '代号',
    seedGo: '用这个代号开局',
    seedBad: '这串代号不对，再核对一遍',
    seedExpired: '这个代号已过期',
    seedNewer: '这个代号要新版本才能玩',
    seedNoBoard: '代号局不计入排行榜',
    dailyTurn: '请横屏',
    rankTabDaily: '今日',
    dailyBest: '今日最佳 {n}',
    shareStartLabel: '开始',
    shareEndLabel: '结束',
    shareAllCleared: '全部消除',
    shareFooterHint: '拖动整行整列或整条斜线，拼出同色图案',
    colorblindBtn: '色盲友好配色',
    proBtn: 'Pro',
    shapeNameSquare: '方块',
    shapeNameCircle: '圆球',
    shapeNameTriangle: '三角',
    shapeNameCircleHex: '六边圆球',
    shapeNameSquareDiamond: '菱形方块',
    shapeNameTriangleBig: '大三角',
    shapeNameCircleSeven: '七色圆球',
    shapeNameTriangleAdvanced: '进阶三角',
  },
};

// Kept separate from STRINGS/I18nStrings (whose values are all plain
// strings and get looked up generically via `keyof I18nStrings` in a few
// places, e.g. each tutorial's captionKey) — an array-typed field there
// would widen those lookups to `string | string[]` everywhere.
export const PRIVILEGES: Record<Lang, string[]> = {
  en: ['More colour palettes', 'More levels', 'More score targets', 'More layouts', 'More game modes', 'More competitions', 'Global rankings', 'An Apple Watch edition'],
  fr: ['Plus de palettes de couleurs', 'Plus de niveaux', "Plus d'objectifs de score", 'Plus de plateaux', 'Plus de modes de jeu', 'Plus de compétitions', 'Classement mondial', 'Une édition Apple Watch'],
  zhHant: ['解鎖更多配色', '更多關卡', '更多得分目標', '更多佈局', '更多玩法', '更多競賽', '世界排名', 'Apple Watch 特別版'],
  zhHans: ['解锁更多配色', '更多关卡', '更多得分目标', '更多布局', '更多玩法', '更多竞赛', '世界排名', 'Apple Watch 特别版'],
};

/**
 * 教学挑选页底下那五条规则。和 PRIVILEGES 一样单放（值是数组，不进 I18nStrings）。
 * 中文是玩家自己写的原话。
 */
/**
 * 五条规则：教学条（ui/coachBar.ts）、《怎么玩》那一屏（ui/rulesModal.ts）、
 * 教学挑选页，三处念的都是这一份；网页版和小红书版也是这一份。
 *
 * 第 3 条的尾巴改过两次，记在这儿：
 *
 *   · 2026-09 先补上「但图案里至少要有一个色块」——那条规矩引擎里一直就在，
 *     《游戏规则》里也早写着，只有玩家真会读的这五条漏了它。漏掉的后果是玩
 *     家以为「星星同色也算」，凑了一组全星星的却不给分，看着像 bug。
 *   · 同月《星星跟随色块消除》上线之后，这句话自己变成了假话：整组都是星星
 *     的图案**现在能得分**了，按星星枚数的平方算，那几颗随后从棋盘上消除
 *     （engine/groupScore.ts + scoring.ts 的 clearStars）。所以第 3 条现在讲
 *     的是两件事：混合组一分不变，纯星星组另算一套。
 *     漏掉它的后果和上一次正好反过来——玩家不知道凑纯星星值钱得多（4 颗就
 *     16 分，而 4 枚色块只有 4 分），整局都在做低分的事。
 *
 * 《无限反转》是唯一的例外：那一局 toggleOnMatch 开着，纯星星组不得分（见
 * scoring.ts 的 starsScore）。所以它的《怎么玩》换用下面那条
 * TUTORIAL_RULE3_FLIP，讲的还是老规矩。
 *
 * **第 5 条也被同一件事改过（2026-09）。** 原话是「全部变成星星，这一局结束」
 * ——星星会被消掉之后这句话也成了假话，而且这一条比第 3 条更要紧：它是写在规
 * 则里的一句承诺，引擎按它办事。玩家报的那一局正是撞在这上面：结算页写着「全
 * 部已變成星星」，盘面上还躺着四颗同色蓝星，明明凑得出图案。现在终局是「一枚
 * 不剩」（八副棋盘的 isGameOver），这一条跟着改成「全部消完」。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 只有两个词：色块、星星
 *
 * 玩家 2026-09 定的：「不再有『翻面』这件事硬性存在的，意思就是色块得分会变
 * 成星星……这样就不存在翻面、反面这些中间概念来解释星星了」。
 *
 * 先前那一版是「每个图形都有正反两面／开局全是正面／反面是一颗星星」——三个
 * 新概念压在第 1 条里，而且「正面／反面」是从做的人那边看过去的说法：棋盘上
 * 他看见的只有两样东西，一块颜色，和一颗星。所以现在第 1 条只说一件事：色块
 * 得分后会变成星星。
 *
 * 往下加句子的时候照这个来：教学、玩法附注、结算页上的收尾话，只准出现「色
 * 块」和「星星」，不要再写翻面、反面、正面。四种语言同一条规矩（coloured
 * piece / star，pièce colorée / étoile）。
 *
 * 例外只有一处：《无限反转》是玩法的名字，不是描述动作的词，照旧叫它。
 */
/**
 * 教学那**五条**——玩家 2026-09 逐字定的（《侵蚀阶梯》v1.2 上线那一版）。
 *
 * 五条对着新规则的五件事：翻面得分 → 星星还能再用 → 图案会变小 → 外边消除 →
 * 目标是清盘。从前那六条讲的是上一套规则（2×2 那一族图案、整组星星按平方算、
 * 时间越短分越高），每一条在这一版里都成了假话。
 *
 * 第 3 条「得分图案会随着游戏解锁而变化」说的就是侵蚀阶梯（§2）：图案从 4 枚一路
 * 降到 1 枚。屏幕上那一块《得分图案》画的是同一件事（ui/patternBlock.ts），所以这
 * 句话指得到实物。
 *
 * 第 4 条按棋盘分两套（见下面 TUTORIAL_RULE4）：外边族说「最外面的一条线」，方块
 * 说「任意整行整列」。
 */
export const TUTORIAL_RULES: Record<Lang, string[]> = {
  en: [
    'A piece that completes a scoring shape scores and flips into a star of another colour.',
    'Stars can join coloured pieces to make another scoring shape.',
    'The scoring shape gets shorter as the game unlocks.',
    'Stars of one colour along the board\u2019s outer edge score and clear.',
    'Try to clear the whole board.',
  ],
  fr: [
    'Une pi\u00e8ce qui compl\u00e8te un motif marque et se retourne en \u00e9toile d\u2019une autre couleur.',
    'Les \u00e9toiles peuvent compl\u00e9ter un motif avec les pi\u00e8ces color\u00e9es.',
    'Le motif \u00e0 former raccourcit \u00e0 mesure que la partie se d\u00e9bloque.',
    'Des \u00e9toiles de m\u00eame couleur sur le bord ext\u00e9rieur marquent et disparaissent.',
    'Essayez de tout faire dispara\u00eetre.',
  ],
  zhHant: [
    '色塊拼出得分圖案會得分翻面，變成其他顏色的星星。',
    '星星可以與色塊一同再次拼出得分圖案。',
    '得分圖案會隨著遊戲解鎖而變化。',
    '同色星星在整體的外邊會得分並消除。',
    '嘗試全部消除吧～',
  ],
  zhHans: [
    '色块拼出得分图案会得分翻面，变成其他颜色的星星。',
    '星星可以与色块一同再次拼出得分图案。',
    '得分图案会随着游戏解锁而变化。',
    '同色星星在整体的外边会得分并消除。',
    '尝试全部消除吧～',
  ],
};

/**
 * 第 4 条按棋盘分两套。
 *
 * 上面那一份是通稿，教学挑选页、暂停面板、《怎么玩》那一屏用它——那几处玩家还没挑
 * 玩法，两套都得说得过去。
 *
 * 棋盘底下那块教学条（ui/coachBar.ts）是在**某一局里**讲的：他眼前只有一副棋盘。
 * 这时候再讲另一种棋盘的规矩，是在他手上这一局里插进一段用不上的话。玩家的原话
 * ——小球那一局「在文字内容中也去除所有与方块有关的内容」。
 *
 * **《侵蚀阶梯》v1.2 §3 之后两套是这样分的**：
 *   · 方块 36 —— 任意一整行 / 一整列全是同色星星就消掉，棋盘合拢；
 *   · 其余五副（外边族）—— 只削**此刻最外面的那一条线**，至少 3 枚，棋盘一圈圈变
 *     小。托盘上那条浅色带标出的就是这一圈（ui/edgeBand.ts），所以这句话指得到实物。
 *
 * 菱形方块归外边族：它长得是方块，规则却和小球一路（见 shapes/squareDiamond.ts 文件
 * 头那段——按方块那套算，实测清盘率从 23–27/30 跌到 2–6/30）。
 *
 * **小球那一句 10-08 方案 3-E-4 改短了**：只留「同色星星连满此刻最外面的一条边，就得分并消除」，
 * 「最少要 3 枚」「消完之后，剩下的部分整体放大」两句删掉（方案给的四语原文；英文按这张表的英式拼
 * 法写 same-colour，法文撇号和这一块别的句子一样用弯的）。删之前查过：教学条往后那一条（第 5 条
 * 「尝试全部消除吧～」）、配图都不靠这两句；靠着它们逐字比对的只有门（check-multiplayer），跟着改了。
 * 完整的规矩（至少 3 枚、整体放大、门槛降到 1）照旧写在规则书里（src/rules.ts）。方案点名的是小球，
 * 菱形方块、三角那两句没动。
 */
export type RuleShape = 'circle' | 'square' | 'squareDiamond' | 'triangle';
export const TUTORIAL_RULE4: Record<Lang, Record<RuleShape, string>> = {
  en: {
    circle: 'Fill the current outermost edge with same-colour stars to score and clear it.',
    square: 'Stars of one colour filling a whole row or column score and clear, and the board closes up.',
    squareDiamond: 'Stars of one colour filling the outermost line score and clear. At least 3 of them. What is left then grows to fill the board.',
    triangle: 'Stars of one colour filling the outermost line score and clear. At least 3 of them. What is left then grows to fill the board.',
  },
  fr: {
    circle: 'Remplissez l’arête la plus extérieure d’étoiles de même couleur pour marquer et l’effacer.',
    square: 'Des \u00e9toiles de m\u00eame couleur sur toute une ligne ou colonne marquent et disparaissent, et le plateau se referme.',
    squareDiamond: 'Des étoiles de même couleur sur la ligne la plus externe marquent et disparaissent. Au moins 3. Ce qui reste s’agrandit ensuite pour remplir le plateau.',
    triangle: 'Des étoiles de même couleur sur la ligne la plus externe marquent et disparaissent. Au moins 3. Ce qui reste s’agrandit ensuite pour remplir le plateau.',
  },
  zhHant: {
    circle: '同色星星連滿此刻最外面的一條邊，就得分並消除。',
    square: '同色星星連滿整行或整列，就得分並消除，棋盤合攏。',
    squareDiamond: '同色星星連滿此刻最外面的一條線，就得分並消除。最少要 3 枚。消完之後，剩下的部分整體放大。',
    triangle: '同色星星連滿此刻最外面的一條線，就得分並消除。最少要 3 枚。消完之後，剩下的部分整體放大。',
  },
  zhHans: {
    circle: '同色星星连满此刻最外面的一条边，就得分并消除。',
    square: '同色星星连满整行或整列，就得分并消除，棋盘合拢。',
    squareDiamond: '同色星星连满此刻最外面的一条线，就得分并消除。最少要 3 枚。消完之后，剩下的部分整体放大。',
    triangle: '同色星星连满此刻最外面的一条线，就得分并消除。最少要 3 枚。消完之后，剩下的部分整体放大。',
  },
};

/**
 * 《无限反转》那一局的第 3 条。
 *
 * 通稿第 3 条说「得分图案会随着游戏解锁而变化」——那一局**不吃侵蚀**（玩家
 * 2026-09-27 拍板，E15：翻过去还能翻回来，吃侵蚀的话几步就降到 1×1、随便一枚都得
 * 分，玩法当场塌了）。图案永远停在开局那一级，所以通稿那一句在那一局是假话。
 *
 * 第 4、5 条那一局整条抽掉（ui/rulesModal.ts 的 omitRules）：外边消除在那一局不发
 * 生，也没有「全部消除」这个目标（它是固定 100 秒）。这一条不能抽——不讲的话他不知
 * 道图案是几枚。
 */
export const TUTORIAL_RULE3_FLIP: Record<Lang, string> = {
  en: 'In Endless Flip the scoring shape never shrinks \u2014 it stays four pieces all game.',
  fr: 'Dans Retournement infini, le motif ne raccourcit jamais : il reste \u00e0 quatre pi\u00e8ces.',
  zhHant: '《無限反轉》裡得分圖案不會變小，整局都是 4 枚。',
  zhHans: '《无限反转》里得分图案不会变小，整局都是 4 枚。',
};

/**
 * 教学条那一局要念的五条：第 4 条换成这副棋盘自己那一句，其余照通稿。
 *
 * flip = 《无限反转》：第 3 条也要换（见 TUTORIAL_RULE3_FLIP）。教学条本身走不到这
 * 一路（那一局摆的是一句 MODE_TIPS，不是五条），用它的是《怎么玩》。
 */
export function tutorialRules(lang: Lang, shape: RuleShape, flip = false): string[] {
  const base = TUTORIAL_RULES[lang] ?? TUTORIAL_RULES.zhHans;
  const four = (TUTORIAL_RULE4[lang] ?? TUTORIAL_RULE4.zhHans)[shape];
  const three = TUTORIAL_RULE3_FLIP[lang] ?? TUTORIAL_RULE3_FLIP.zhHans;
  return base.map((t, i) => (i === 3 ? four : i === 2 && flip ? three : t));
}

/**
 * 炸弹 / 无限反转 / 老虎机 / 计时 / 特殊布局头一回进来时，棋盘底下摆的那一句。
 *
 * 这几个玩法都是在基础规则上加一层：滑动、得分、翻面、消除全没变，变的只是
 * 多出来的那一条。所以每个只说那一条——能玩到这儿的人五条规矩早听过了。这一
 * 句摆一整局，不定时走掉（见 ui/coachBar.ts 的 mountCoachTip）。
 *
 * timed 和 layout 这两句是玩家逐字点的名，翻译时中文那两条一个字都不要动。
 * layout 说的是「特殊布局」那几副棋盘（菱形方块、六边形小球、六边形三角、菱
 * 形小球、V 字三角）：规矩和基础版一模一样，只是格子摆法不同——所以这一句不
 * 讲规矩，只是把这件事说破，免得他以为自己进了一个没学过的玩法。
 */
export const MODE_TIPS: Record<
  Lang,
  Record<'bomb' | 'flip' | 'slot' | 'timed' | 'layout' | 'puzzle', string>
> = {
  en: {
    bomb: 'Sliding, scoring and clearing work as before. Red is the bomb colour. Four reds touching blow up. Any four that touch will do it. A bomb next to a scoring shape gets defused.',
    flip: 'Score and a coloured piece turns into a star. In Endless Flip a star that scores turns back into a coloured piece. So same-colour stars never clear. 100 seconds. Off you go!',
    slot: 'Slot Machine spins one scoring shape at the start. Only that shape scores this game. Build it and those pieces turn into stars. It shrinks too: one piece fewer each time the ladder drops, down to a single piece. After that, any still-joined part of it counts. Clearing works as before. Give it a go!',
    timed: '100 seconds on the clock — how many points can you get?',
    layout: 'Same rules, different board. Fancy the challenge?',
    puzzle: 'Eight moves to start. Every move costs 1. Scoring pays 1 back. Scoring twice in a row pays 1 more. Clearing a line pays 2 more. How high can you score?',
  },
  fr: {
    bomb: 'Le glissement, les points et les disparitions ne changent pas. Le rouge est la couleur de la bombe. Quatre rouges qui se touchent explosent. N’importe lesquels, du moment qu’ils se touchent. Une bombe voisine d’une figure qui marque se désamorce.',
    flip: 'Quand vous marquez, la pièce devient une étoile. Dans Retournement infini, une étoile qui marque redevient une pièce colorée. Les étoiles de même couleur ne disparaissent donc jamais. 100 secondes. C’est parti !',
    slot: 'Machine à sous tire une figure gagnante au départ. Seule cette figure marque cette partie. Formez-la et ces pièces deviennent des étoiles. Elle rétrécit aussi : une pièce de moins à chaque palier, jusqu’à une seule. Ensuite, toute partie encore reliée compte. Les disparitions ne changent pas. À vous !',
    timed: '100 secondes au compteur — combien de points allez-vous marquer ?',
    layout: 'Mêmes règles, autre plateau. Vous relevez le défi ?',
    puzzle: 'Huit coups pour commencer. Chaque coup en coûte 1. Marquer en rend 1. Marquer deux fois de suite en rend 1 de plus. Effacer une ligne en rend 2 de plus. Quel score allez-vous atteindre ?',
  },
  zhHant: {
    bomb: '滑動、得分、消除都和以前一樣。紅色是炸彈色。四個紅的連在一起就會爆炸。任意四個碰到一起都算。得分圖案旁邊的炸彈會被拆掉。',
    flip: '得分之後色塊會變成星星。《無限反轉》裡星星得分會再變回色塊。所以同色星星永遠不會消除。限時 100 秒。開始吧！',
    slot: '《老虎機》開局會轉出一個得分圖案。這一局只有它算分。拼出它就得分，那幾枚變成星星。它也會變小：每降一級少一枚，最少剩一枚。少到一枚之後，它任意還連著的那幾枚都算。消除規則不變。快挑戰一下吧！',
    timed: '限時100s，能得多少分呢？',
    layout: '規則相同，佈局不同，你能挑戰麼？',
    puzzle: '開局有 8 步。每走一步扣 1 步。得分退回 1 步。連著得分再退 1 步。消掉一條線再退 2 步。你能得多少分？',
  },
  zhHans: {
    bomb: '滑动、得分、消除都和以前一样。红色是炸弹色。四个红的连在一起就会爆炸。任意四个碰到一起都算。得分图案旁边的炸弹会被拆掉。',
    flip: '得分之后色块会变成星星。《无限反转》里星星得分会再变回色块。所以同色星星永远不会消除。限时 100 秒。开始吧！',
    slot: '《老虎机》开局会转出一个得分图案。这一局只有它算分。拼出它就得分，那几枚变成星星。它也会变小：每降一级少一枚，最少剩一枚。少到一枚之后，它任意还连着的那几枚都算。消除规则不变。快挑战一下吧！',
    timed: '限时100s，能得多少分呢？',
    layout: '规则相同，布局不同，你能挑战么？',
    puzzle: '开局有 8 步。每走一步扣 1 步。得分退回 1 步。连着得分再退 1 步。消掉一条线再退 2 步。你能得多少分？',
  },
};

/*
 * 这四个读写存储的函数（loadLang / saveLang / hasSeenTutorial / markTutorialSeen）都照下面
 * isFirstRun 的写法包一层 try/catch（2026-10-08 方案 2-5）。有的浏览器环境一碰 localStorage
 * 就抛（Chrome 关掉网站数据、一些 App 内置浏览器）：从前 boot() 第一句 loadLang() 一抛，开机
 * 就停在那儿，玩家看到一张白屏。读不到就当没存过，写不进去就算了——这一次照样玩得了。
 */
export function loadLang(): Lang | null {
  try {
    const v = localStorage.getItem(LANG_STORAGE_KEY);
    return v && LANG_ORDER.includes(v as Lang) ? (v as Lang) : null;
  } catch {
    return null;
  }
}

export function saveLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    /* 存不进去：下次打开再按浏览器的语言猜一遍。 */
  }
}

/**
 * 我们这四个语言名 → 浏览器认的那个标签（BCP-47）。
 *
 * 两处在用：`<html lang>`（见 applyHtmlLang），和算日期那几行
 * （`toLocaleDateString`，ui/subscribe.ts）。**一张表，不要抄第二份**——抄出来的那一份
 * 迟早和这一份走样，而走样的后果是「某一种语言下日期格式对、读屏念错」这种没人会去
 * 对照的事。
 */
export const HTML_LANG: Record<Lang, string> = {
  en: 'en',
  fr: 'fr',
  zhHans: 'zh-Hans',
  zhHant: 'zh-Hant',
};

/**
 * 把当前语言写到 `<html lang>` 上。
 *
 * `index.html` 里那一位是写死的 `zh-CN`，而这个页面从不整页跳转（换语言是原地重画，
 * 见 main.ts 的 onLanguageSwitched），所以**从头到尾它就一直是 zh-CN**：一个把站点
 * 切成法文的人，读屏会用中文嗓子去念那些法文句子，字也按中文的断行规则断。
 *
 * 四个地方真的在读这一位：读屏挑嗓子、浏览器挑字体和断行、`:lang()` 选择器、以及
 * 「翻译这一页吗」那个提示。它们都不看界面上写的是什么字，只看这一位。
 */
export function applyHtmlLang(lang: Lang): void {
  document.documentElement.lang = HTML_LANG[lang];
}

/**
 * The language to open in when this browser has never chosen one.
 *
 * Read from the browser's own accept-language list rather than from the
 * visitor's IP: the list is a preference the person actually set, while an
 * IP is only a guess at where they are — a Chinese speaker in Paris wants
 * Chinese, not French. It also costs nothing, needs no server, and is right
 * offline. Whatever it picks is only a default; 个人主页 can change it, and
 * that choice is what gets stored.
 *
 * `navigator.languages` is ordered by preference, so the first tag we
 * recognise wins. Script subtags decide Chinese where they are given
 * (zh-Hans / zh-Hant); otherwise the region does, with Taiwan, Hong Kong and
 * Macau traditional and everything else simplified.
 */
export function detectLang(): Lang {
  let tags: readonly string[] = [];
  try {
    tags = navigator.languages?.length ? navigator.languages : [navigator.language];
  } catch {
    return 'en';
  }
  for (const raw of tags) {
    const tag = (raw || '').toLowerCase();
    if (tag.startsWith('zh')) {
      if (tag.includes('hant')) return 'zhHant';
      if (tag.includes('hans')) return 'zhHans';
      return /-(tw|hk|mo)\b/.test(tag) ? 'zhHant' : 'zhHans';
    }
    if (tag.startsWith('fr')) return 'fr';
    if (tag.startsWith('en')) return 'en';
  }
  return 'en';
}

/**
 * 有分镜教学的那几族——**两族**（《侵蚀阶梯》v1.2 PR-6）。
 *
 * 三角那一族的基础棋盘删了，只剩六边蜂窝 54 那副天才特供的布局；布局本来就没有
 * 自己的分镜教学（只有基础那几副有），所以这一族现在一段也没有。
 * `slides_tutorial_seen_triangle` 那把旧钥匙留在玩家本地没人读了——不删是因为删它
 * 得写一段迁移，而它占的那几个字节不值得。
 */
export type TutorialShape = 'square' | 'circle';
const TUTORIAL_SEEN_KEYS: Record<TutorialShape, string> = {
  square: TUTORIAL_SEEN_KEY,
  circle: 'slides_tutorial_seen_circle',
};

export function hasSeenTutorial(shape: TutorialShape = 'square'): boolean {
  try {
    return localStorage.getItem(TUTORIAL_SEEN_KEYS[shape]) === '1';
  } catch {
    // 读不到就当没看过——顶多多教一遍（小红书那一端 tutorial.ts 是同一个口径）。
    return false;
  }
}

export function markTutorialSeen(shape: TutorialShape = 'square'): void {
  try {
    localStorage.setItem(TUTORIAL_SEEN_KEYS[shape], '1');
  } catch {
    /* 存不进去：下一次照样当没看过。 */
  }
}

/**
 * 这台设备是不是头一回打开。
 *
 * 现在头一回和往后一样都落在主菜单，只是《基础方块》和《基础小球》两张卡镶
 * 着一圈光替他指路（见 main.ts 的 afterLangChosen 和 engine/firstPlay.ts）。
 * 中间有一版是进来就直接开一局小球，路是指明了，可他连主菜单长什么样都还没
 * 见过就被按进了游戏里，是「意料之外的界面」。
 *
 * 判「头一回」看两把钥匙，缺一不可：这把新钥匙没立过，而且方块那段教学也
 * 没看过。只看新钥匙的话，改版之前就在玩的人升上来会被当成新人。
 */
const FIRST_RUN_KEY = 'slides_first_run';

export function isFirstRun(): boolean {
  try {
    return localStorage.getItem(FIRST_RUN_KEY) !== '1' && !hasSeenTutorial();
  } catch {
    return false;
  }
}

export function markFirstRunDone(): void {
  try {
    localStorage.setItem(FIRST_RUN_KEY, '1');
  } catch {
    /* 无痕模式写不进去，那就每次都当头一回——总好过整页崩掉。 */
  }
}

/** 这台设备看过哪几族的教学。进小屋时报给服务器，开局前它据此判「可不可能有新手」。 */
export function seenTutorials(): TutorialShape[] {
  return (['square', 'circle'] as TutorialShape[]).filter((s) => {
    try {
      return hasSeenTutorial(s);
    } catch {
      return false;
    }
  });
}

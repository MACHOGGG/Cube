export type Lang = 'en' | 'fr' | 'zhHant' | 'zhHans';

export const LANG_STORAGE_KEY = 'slides_lang';
export const TUTORIAL_SEEN_KEY = 'slides_tutorial_seen';

export interface I18nStrings {
  langName: string;
  pickerTagline: string;
  homeTagline: string;
  skip: string;
  next: string;
  prev: string;
  replay: string;
  doneBtn: string;
  pause: string;
  resume: string;
  run4: string;
  twoByTwo: string;
  flip: string;
  mixedFace: string;
  wholeLine: string;
  circleClusterIntro: string;
  circleFlipTeach: string;
  circleFlipDragHint: string;
  circleBlank: string;
  circleBlankMove: string;
  triSlide: string;
  triBigTriangle: string;
  triFlipOrientation: string;
  triBlank: string;
  navHome: string;
  navAccount: string;
  navProfile: string;
  navRecords: string;
  noRecordsYet: string;
  moreModesTitle: string;
  switchLanguage: string;
  // ---- home page ----
  howToBtn: string;
  sectionBase: string;
  sectionTimed: string;
  sectionMore: string;
  bombBasicTitle: string;
  bombTimedTitle: string;
  bombAdvancedTitle: string;
  randomTargetTitle: string;
  comingSoon: string;
  multiplayerTitle: string;
  rankingsTitle: string;
  totalScoreTitle: string;
  totalScoreSync: string;
  exclusiveEntry: string;
  // ---- tutorial picker / generic back buttons ----
  tutorialPickerTitle: string;
  tutorialPickerTagline: string;
  backToMenu: string;
  /** The end-of-run summary's way out — short, since it sits beside two
   *  other buttons on one row. */
  homeBtn: string;
  /** Shown on a wide board's start card, under the turn-your-phone glyph. */
  rotateHint: string;
  back: string;
  squareTutorialDesc: string;
  circleTutorialDesc: string;
  triangleTutorialDesc: string;
  // ---- account page ----
  accountTitle: string;
  tabRegister: string;
  tabLogin: string;
  accountComingSoon: string;
  loginGateway: string;
  contactUs: string;
  tutorialShort: string;
  geniusPrivilegesTitle: string;
  privilegesSoon: string;
  becomeGenius: string;
  geniusSpecialTitle: string;
  /** 付费墙上「订阅后立刻拿到」那一段的小标题。 */
  geniusNowTitle: string;
  /** 付费墙上「还没做、做完自动包含」那一段的小标题。 */
  geniusSoonTitle: string;
  /**
   * 付费墙上「订阅后立刻解锁」那三条的说法。
   *
   * 比棋盘本身的名字长，也应该更长：主菜单上的图标旁边只要认得出是哪个
   * 就够了，这里是要让一个还没付钱的人看懂他买到的是什么。
   */
  geniusNowCircleSeven: string;
  geniusNowTriangleAdvanced: string;
  /** 开多人房间——GENIUS_LAYOUTS 之外唯一一件订阅立刻拿到的东西。 */
  geniusHostRooms: string;
  // ---- subscription: the paywall, and the web's e-mail sign-in ----
  /** Title of the window the 成为 Slides 天才 button opens. */
  subscribeTitle: string;
  subscribeIntro: string;
  /** The two billing periods, as a price is labelled: "每月" / "每年". */
  planMonthly: string;
  planYearly: string;
  subscribeBtn: string;
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
   * 取代了原来那句「刷卡订阅只需要电子邮件，不用设密码」——在「注册即
   * 订阅、邮箱 + 六位密码」之后它就不成立了，而且会和玩家付完款紧接着
   * 看到的设密码窗口正面打架。
   */
  registerIsSubscribe: string;
  signInHint: string;
  /** Carries {store} — "App Store" or "Google Play", per platform. */
  storeNoAccountHint: string;
  subscribedTitle: string;
  subscribedUntil: string;
  manageSubscription: string;
  /** Also carries {store}: where a store subscription is cancelled. */
  manageOnStore: string;
  geniusStatus: string;
  /** Badge on a 「+」 board that the subscription unlocks. */
  geniusOnly: string;
  // ---- redeem codes, and the account one creates ----
  haveCode: string;
  redeemTitle: string;
  redeemHint: string;
  redeemCodeLabel: string;
  redeemBtn: string;
  passwordLabel: string;
  passwordPlaceholder: string;
  /** On the log-in tab, where a passcode is only for code-made accounts. */
  passwordAny: string;
  /** 付款回来后立刻弹出的设密码窗口。 */
  setPwTitle: string;
  setPwHint: string;
  setPwLabel: string;
  setPwPlaceholder: string;
  setPwShort: string;
  /** 注册时那一行勾选：要不要收 Slides 的邮件。默认不勾——同意得是主动给的。 */
  newsOptIn: string;
  setPwLater: string;
  /** 内部码换来的东西，绑到一个邮箱上，好换设备时取回。 */
  bindTitle: string;
  bindHint: string;
  bindTaken: string;
  redeemCodePlaceholder: string;
  /** 内部码本身过了使用期限。 */
  codeExpired: string;
  /** 短时间内试得太多——防止有人枚举内部码。 */
  tooManyTries: string;
  /** 还在订阅期内，这张码留着更值。 */
  alreadyActive: string;
  /** 个人主页上的内部码入口。 */
  insiderCode: string;
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
  needsPwHint: string;
  redeemBadCode: string;
  pwWrong: string;
  /** Carries {hours}. */
  pwLocked: string;
  pwBlocked: string;
  unlockTitle: string;
  /** 锁死之后那个真的能按的按钮。 */
  unlockNow: string;
  unlockIntro: string;
  unlockSendBtn: string;
  unlockSent: string;
  unlockCodeLabel: string;
  unlockNewPw: string;
  unlockConfirmBtn: string;
  unlockBadCode: string;
  unlockExpired: string;
  /** Carries {email} — the support address, when no mail can be sent. */
  unlockNoMail: string;
  // ---- multiplayer: the room, the countdown, the live standings ----
  mpTitle: string;
  mpIntro: string;
  mpCreate: string;
  mpJoin: string;
  mpNameLabel: string;
  mpNamePlaceholder: string;
  mpAvatarLabel: string;
  mpShuffle: string;
  mpCodeLabel: string;
  mpCodePlaceholder: string;
  mpRoomCode: string;
  mpShareHint: string;
  mpPlayers: string;
  mpHostBadge: string;
  mpPickMode: string;
  mpStartBtn: string;
  mpWaitingHost: string;
  /** 交出座位、离开这间房。房间页和结算页上是同一颗键、同一个说法——对玩家
   *  来说这本来就是同一件事，两个名字只会让人以为是两回事。 */
  mpLeave: string;
  /** 离开房间后那张总排名的标题 */
  mpRankTitle: string;
  mpNeedGenius: string;
  mpSameBoard: string;
  mpGo: string;
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
  mpEndRoom: string;
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
  /** 没开通的人点开配色窗口时，顶上那句——看得见，但要开通才挑得动。 */
  paletteLocked: string;
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
  mpRoundResult: string;
  mpFinalTitle: string;
  mpBestRound: string;
  mpFastest: string;
  mpRoundsPlayed: string;
  mpErrEnded: string;
  /** 网络断了一下，但座位还留着——不是把人踢出房间的理由。 */
  mpReconnecting: string;
  /** 屋主要走之前得知道：他一走，就没人能开下一局了。 */
  mpHostLeaveWarn: string;
  /** 客人要走时问的那一句。屋主那句说的是「你走了整桌就散」，对客人不成立，
   *  照搬过去是吓唬人——他走了别人接着玩，所以只问要不要走。 */
  mpGuestLeaveWarn: string;
  mpLeaveAnyway: string;
  mpStay: string;
  /** 房间局里按下《完成》时问的那一句。问的这段时间钟停着、牌也盖上。 */
  mpFinishConfirm: string;
  /** 屋主把座位交回去了，这间房再也开不了下一局。 */
  mpRoomCancelled: string;
  /** 知道了。 */
  mpOk: string;
  /** 屋主还在，只是这会儿听不见他——网络卡了，不是走了。 */
  mpHostFixing: string;
  mpErrNoRoom: string;
  mpErrFull: string;
  mpErrStarted: string;
  mpErrTooFew: string;
  mpErrNotOpen: string;
  notOnSaleYet: string;
  purchaseUnavailable: string;
  purchaseCancelled: string;
  purchaseNetwork: string;
  /** 请求到达了服务器、服务器答不上来。跟 purchaseNetwork 分开，因为让
   *  一个网络正常的人去查网络，只会让他白折腾。 */
  serverBusy: string;
  restoreNothing: string;
  signInNotFound: string;
  workingLabel: string;
  // ---- game shell (shared HUD/overlays across every shape) ----
  pauseBtn: string;
  finishBtn: string;
  /** The "are you sure" a player gets before a run is thrown away. */
  endRunTitle: string;
  endRunYes: string;
  endRunNo: string;
  scoreLabel: string;
  perfLabel: string;
  timeLabel: string;
  stuckEndBtn: string;
  startBtn: string;
  pausedTitle: string;
  pausedBody: string;
  endTitleDefault: string;
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
  iconPill: string;
  iconTitle: string;
  iconHint: string;
  // ---- gain-bubble source labels (which pattern just paid out) ----
  labelRun4: string;
  labelBlock22: string;
  label121: string;
  labelBigTriangle: string;
  labelPattern: string;
  labelWholeLine: string;
  // ---- game controller (dynamic end-of-run text) ----
  patternPointsLabel: string;
  comboBonusLabel: string;
  linePointsLabel: string;
  perfBonusLabel: string;
  timeMultLabel: string;
  neverFlippedLabel: string;
  remainingLabel: string;
  defaultPenaltyLabel: string;
  bombPenaltyLabel: string;
  timeUpReason: string;
  noMoreMatchesReason: string;
  allFlippedReason: string;
  manualEndReason: string;
  bombHazardReason: string;
  /** Contains a literal "{n}" placeholder substituted with the move count. */
  stepsPhrase: string;
  /** Contains a literal "{n}" placeholder substituted with the best score. */
  bestPhrase: string;
  rateLabel: string;
  // ---- share card (canvas-drawn) ----
  shareStartLabel: string;
  shareEndLabel: string;
  shareFooterHint: string;
  shareQrCaption: string;
  // ---- shared shape UI ----
  colorblindBtn: string;
  shapeNameSquare: string;
  shapeNameCircle: string;
  shapeNameTriangle: string;
  shapeNameCircleHex: string;
  shapeNameSquareDiamond: string;
  shapeNameTriangleBig: string;
  shapeNameCircleSeven: string;
  shapeNameTriangleAdvanced: string;
}

export const LANG_ORDER: Lang[] = ['en', 'fr', 'zhHant', 'zhHans'];

export const STRINGS: Record<Lang, I18nStrings> = {
  en: {
    langName: 'English',
    pickerTagline: 'Choose your language',
    homeTagline: 'Slide · Score · Clear',
    skip: 'Skip tutorial',
    next: 'Next',
    prev: 'Back',
    replay: 'Replay',
    doneBtn: 'Done',
    pause: 'Pause',
    resume: 'Resume',
    run4: 'Slide a row or column to line up 4 tiles of the same color',
    twoByTwo: 'A 2×2 block of the same color scores too',
    flip: 'Scored tiles flip to a color chosen at random',
    mixedFace: 'A flipped tile can keep scoring — match its color with a front-facing tile too',
    wholeLine: 'A whole row or column of matching flipped tiles scores big and clears the board',
    circleClusterIntro: 'Drag horizontally, or along either diagonal; same-colored balls score three ways — a run of 4, a "22" diamond, or a "121" diamond. Drag once to see all three flip in turn',
    circleFlipTeach: "Scored balls flip to a randomly determined color — balls cleared together in one group don't always end up the same color",
    circleFlipDragHint: 'Drag to flip it',
    circleBlank: 'When a whole flipped line matches, it becomes blank balls — still slide freely, but they can never score again',
    circleBlankMove: 'A blank ball still holds its place on the board and drags normally — try it and watch it slide along',
    triSlide: 'Drag along a horizontal, left-diagonal, or right-diagonal line to line up 4 triangles of the same color',
    triBigTriangle: '4 triangles combining into one big triangle (3 one way, 1 the other) score too',
    triFlipOrientation: 'Scored triangles flip to a color chosen at random for each one — watch this group flip and back again',
    triBlank: 'When a whole flipped line matches, it becomes blank triangles — still slide freely, but they can never score again',
    navHome: 'Home',
    navAccount: 'Account',
    navProfile: 'Profile',
    navRecords: 'Records & rankings',
    noRecordsYet: 'No score yet',
    moreModesTitle: 'More modes',
    switchLanguage: 'Language',
    howToBtn: 'How to slide? · Watch the tutorial again',
    sectionBase: 'Base games',
    sectionTimed: 'Timed challenge',
    sectionMore: 'More layouts',
    bombBasicTitle: 'Basic bomb',
    bombTimedTitle: 'Timed bomb',
    bombAdvancedTitle: 'Advanced bomb',
    randomTargetTitle: 'Random score target',
    comingSoon: 'Coming soon',
    multiplayerTitle: 'Multiplayer',
    rankingsTitle: 'Records & rankings',
    totalScoreTitle: 'Total score',
    totalScoreSync: 'Slides Genius keeps every run forever',
    exclusiveEntry: 'Genius',
    tutorialPickerTitle: 'How to slide?',
    tutorialPickerTagline: 'Pick a game to watch its tutorial again',
    backToMenu: 'Back to menu',
    homeBtn: 'Home',
    rotateHint: 'Turn your phone sideways — this board is a wide one',
    back: 'Back',
    squareTutorialDesc: 'Drag a whole row/column · the basics',
    circleTutorialDesc: '3 slide directions · "22"/"121" diamonds',
    triangleTutorialDesc: '3 slide directions · big triangle & flip',
    accountTitle: 'Account',
    tabRegister: 'Sign up',
    tabLogin: 'Log in',
    accountComingSoon: 'A full account system is coming soon',
    loginGateway: 'Sign in',
    contactUs: 'Contact us',
    tutorialShort: 'Tutorial',
    geniusPrivilegesTitle: 'Slides Genius perks',
    privilegesSoon: '…more coming soon',
    becomeGenius: 'Become a Slides Genius',
    geniusSpecialTitle: 'Slides Genius Exclusives',
    geniusNowTitle: 'Unlocked the moment you subscribe',
    geniusNowCircleSeven: 'Seven-colour diamond ball board',
    geniusNowTriangleAdvanced: 'Advanced V-shaped triangle board',
    geniusSoonTitle: 'In the works — coming soon',
    geniusHostRooms: 'Online races for 2–4 players at once',
    subscribeTitle: 'Become a Slides Genius',
    subscribeIntro: 'More unlocked right away, more added now and then, cancel any time.',
    planMonthly: 'per month',
    planYearly: 'per year',
    subscribeBtn: 'Subscribe',
    restoreBtn: 'Restore purchase',
    signInBtn: 'Log in',
    signOutBtn: 'Log out',
    emailLabel: 'Email',
    emailPlaceholder: 'you@example.com',
    emailInvalid: 'That does not look like an email address.',
    registerIsSubscribe: 'Registering is subscribing. Pay first, then set a six-character password for this address — the two of them bring your subscription back on any device.',
    signInHint: 'Your email address and the password you set.',
    storeNoAccountHint: 'Bought with your {store} account — no sign-up, and you never leave the app.',
    subscribedTitle: 'You are a Slides Genius',
    subscribedUntil: 'Runs until',
    manageSubscription: 'Manage subscription',
    manageOnStore: 'Cancel or change it in your {store} account settings.',
    geniusStatus: 'Subscription',
    geniusOnly: 'Genius only',
    haveCode: 'Have an insider code?',
    redeemTitle: 'Slides Genius insider code',
    redeemHint: 'Type your insider code. It unlocks straight away.',
    redeemCodeLabel: 'Insider code',
    redeemBtn: 'Unlock',
    passwordLabel: 'Passcode (6 characters)',
    passwordPlaceholder: '6 characters',
    passwordAny: 'Password',
    setPwTitle: 'Choose a password',
    setPwHint: 'You are a Slides Genius. Set a password so this subscription comes back on your other devices — your email address and this password are all it takes.',
    setPwLabel: 'Password (6 characters or more)',
    setPwPlaceholder: '6 characters or more',
    setPwShort: 'Use exactly six characters.',
    newsOptIn: 'Email me about new Slides boards and updates. Unsubscribe anytime.',
    setPwLater: 'Later',
    bindTitle: 'Save it to an address',
    bindHint: 'Your insider code is redeemed and the boards are open. Give an email address and a password and it comes back on your other devices too — without them it lives in this browser alone.',
    bindTaken: 'That address already has an account. Use another one, or write to us.',
    redeemCodePlaceholder: 'e.g. K7M2QD',
    codeExpired: 'That insider code has passed its use-by date.',
    tooManyTries: 'Too many tries from here. Try again later.',
    alreadyActive: 'Your subscription is still running. Keep this insider code for later, or pass it on — it is only spent once.',
    insiderCode: 'Slides Genius insider code',
    orderTitle: 'Your subscription',
    orderPlanLabel: 'Plan',
    orderUntilLabel: 'Paid up to',
    orderLifetime: 'Lifetime',
    orderLapsed: 'This account has no running subscription.',
    giftTitle: 'Two months to give away',
    giftHint: 'Yours for subscribing by the year. Send one to a friend — each unlocks one month, once.',
    giftUsed: 'used',
    giftExpires: 'use by {date}',
    copyBtn: 'Copy',
    copiedLabel: 'Copied',
    needsPwHint: 'This subscription has no password yet. Open it from the device you paid on to set one.',
    redeemBadCode: 'That insider code is not valid, or it has already been used.',
    pwWrong: 'That passcode is not right.',
    pwLocked: 'Too many wrong tries. Opens again in about {hours} h.',
    pwBlocked: 'Locked after too many wrong tries. Open it by email.',
    unlockTitle: 'Unlock by email',
    unlockNow: 'Unlock',
    unlockIntro: 'We will send a six-digit code to your address. It lets you set a new passcode.',
    unlockSendBtn: 'Send the code',
    unlockSent: 'Sent. The code is good for 30 minutes.',
    unlockCodeLabel: 'The 6-digit code from the email',
    unlockNewPw: 'New passcode (6 characters)',
    unlockConfirmBtn: 'Unlock and set passcode',
    unlockBadCode: 'That code is not right.',
    unlockExpired: 'That code has expired. Send a new one.',
    unlockNoMail: 'We cannot send mail automatically yet. Write to {email} and we will open it for you.',
    mpTitle: 'Multiplayer',
    mpIntro: 'Put up a little room for up to four, one and the same board, and race.',
    mpCreate: 'Open a room',
    mpJoin: 'Join a room',
    mpNameLabel: 'Your name',
    mpNamePlaceholder: 'Pick a name',
    mpAvatarLabel: 'Your mark',
    mpShuffle: 'Another',
    mpCodeLabel: 'Room code',
    mpCodePlaceholder: 'four digits',
    mpRoomCode: 'Room',
    mpShareHint: 'Give these four digits to your friends — up to {n} players.',
    mpPlayers: 'Players',
    mpHostBadge: 'host',
    mpPickMode: 'Pick a board',
    mpStartBtn: 'Start',
    mpWaitingHost: 'Waiting for the host to pick a board.',
    mpLeave: 'Leave the room',
    mpRankTitle: 'Competition ranking',
    mpNeedGenius: 'Join a room a Slides Genius put up',
    mpSameBoard: 'Everyone gets exactly the same board.',
    mpGo: 'Go!',
    mpStandings: 'Standings',
    mpFinished: 'done',
    mpGoPick: 'Pick a board on the home page',
    mpPickingTitle: 'You are picking for room {code}',
    mpBackToRoom: 'Back to the room',
    mpNotAMode: 'Rooms play the eight plain boards — not timed runs or bombs.',
    mpRoundLabel: 'Round {n}',
    mpNextRound: 'Pick the next board',
    mpEndRoom: 'Close the room',
    mpRoomEnded: 'The host closed the room.',
    mpTotalLabel: 'total',
    mpRoomTotal: 'Room total',
    mpNudge: 'Nudge the host',
    mpLeftTag: 'left',
    paletteTitle: 'Piece colours',
    paletteHint: 'Changes the pieces in every board. Off while the colourblind palette is on.',
    paletteLocked: 'Here is what a Slides Genius gets to pick from.',
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
    mpLearningWait: 'Someone in the cabin is learning — hold on',
    mpRoundResult: 'This round',
    mpFinalTitle: 'How the room finished',
    mpBestRound: 'Best single round',
    mpFastest: 'Quickest board',
    mpRoundsPlayed: '{n} rounds',
    mpErrEnded: 'That room has been closed.',
    mpReconnecting: 'Connection lost — getting you back in…',
    mpHostLeaveWarn: 'Close the room?',
    mpGuestLeaveWarn: 'Leave?',
    mpLeaveAnyway: 'Leave anyway',
    mpStay: 'Stay',
    mpFinishConfirm: 'Done?',
    mpRoomCancelled: 'Oh no — the room is gone',
    mpOk: 'ok',
    mpHostFixing: 'The host is fixing the cables — hang on',
    mpErrNoRoom: 'No room with that code.',
    mpErrFull: 'That room is full — {n} players is the most.',
    mpErrStarted: 'That game has already started.',
    mpErrTooFew: 'Two players at least.',
    mpErrNotOpen: 'Multiplayer is not open yet.',
    notOnSaleYet: 'The subscription is not open yet.',
    purchaseUnavailable: 'This device cannot complete the purchase yet.',
    purchaseCancelled: 'Cancelled — you have not been charged.',
    purchaseNetwork: 'No connection. Please try again in a moment.',
    serverBusy: 'Something went wrong on our side. Please try again in a moment.',
    restoreNothing: 'No subscription found to restore.',
    signInNotFound: 'No active subscription under that address.',
    workingLabel: 'Working…',
    pauseBtn: 'Pause',
    finishBtn: 'Finish',
    endRunTitle: 'End this game?',
    endRunYes: 'Yes',
    endRunNo: 'No',
    scoreLabel: 'Score',
    perfLabel: 'Hit rate',
    timeLabel: 'Time',
    stuckEndBtn: 'No more possible flips · tap to end',
    startBtn: 'Start',
    pausedTitle: 'Paused',
    pausedBody: 'The timer has stopped and the board is hidden.',
    endTitleDefault: 'Challenge complete',
    compositeScoreLabel: 'Composite score',
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
    iconPill: 'Icon',
    iconTitle: 'App icon',
    iconHint: 'Pick the icon that shows on the browser tab.',
    labelRun4: 'Run of 4',
    labelBlock22: '2x2',
    label121: '1-2-1',
    labelBigTriangle: 'Big triangle',
    labelPattern: 'Pattern',
    labelWholeLine: 'Full line',
    patternPointsLabel: 'Pattern points',
    comboBonusLabel: 'Streak & chain bonus',
    linePointsLabel: 'Whole-line bonus',
    perfBonusLabel: 'Hit-rate bonus',
    timeMultLabel: 'Time multiplier',
    neverFlippedLabel: 'Never flipped',
    remainingLabel: 'Flipped, unfinished',
    defaultPenaltyLabel: 'Penalty',
    bombPenaltyLabel: 'Bomb penalty',
    timeUpReason: "Time's up",
    noMoreMatchesReason: 'No face-up tile can ever be flipped',
    allFlippedReason: 'Every tile is flipped',
    manualEndReason: 'Ended manually',
    bombHazardReason: 'Bomb tiles connected',
    stepsPhrase: '{n} moves',
    bestPhrase: 'best {n}',
    rateLabel: 'Hit rate ',
    shareQrCaption: 'Scan to play Slides',
    shareStartLabel: 'Start',
    shareEndLabel: 'End',
    shareFooterHint: 'Drag a whole row, column, or diagonal to match same-color patterns',
    colorblindBtn: 'Colorblind-friendly palette',
    shapeNameSquare: 'Square',
    shapeNameCircle: 'Circle',
    shapeNameTriangle: 'Triangle',
    shapeNameCircleHex: 'Hex Circle',
    shapeNameSquareDiamond: 'Diamond Square',
    shapeNameTriangleBig: 'Big Triangle',
    shapeNameCircleSeven: 'Seven-color Circle',
    shapeNameTriangleAdvanced: 'Advanced Triangle',
  },
  fr: {
    langName: 'Français',
    pickerTagline: 'Choisissez votre langue',
    homeTagline: 'Glisser · Marquer · Effacer',
    skip: 'Passer le tutoriel',
    next: 'Suivant',
    prev: 'Précédent',
    replay: 'Rejouer',
    doneBtn: 'Terminé',
    pause: 'Pause',
    resume: 'Reprendre',
    run4: 'Faites glisser une ligne ou une colonne pour aligner 4 cases de la même couleur',
    twoByTwo: 'Un carré 2×2 de la même couleur rapporte aussi',
    flip: 'Les cases marquées se retournent sur une couleur tirée au hasard',
    mixedFace: 'Une case retournée peut aussi marquer — associez-la à une case encore de face',
    wholeLine: 'Une ligne ou colonne entière retournée de la même couleur rapporte gros et vide le plateau',
    circleClusterIntro: 'Faites glisser à l\'horizontale ou en diagonale ; des boules de la même couleur marquent de trois façons — une ligne de 4, un losange "22", ou un losange "121". Faites glisser une fois pour voir les trois se retourner tour à tour',
    circleFlipTeach: 'Les boules marquées se retournent sur une couleur tirée au hasard — des boules effacées ensemble ne finissent pas forcément de la même couleur',
    circleFlipDragHint: 'Fais-la glisser pour la retourner',
    circleBlank: 'Quand toute une ligne retournée est assortie, ses boules deviennent vides — elles glissent toujours librement, mais ne peuvent plus jamais marquer',
    circleBlankMove: 'Une boule vide garde sa place sur le plateau et glisse normalement — essayez et regardez-la se déplacer',
    triSlide: 'Faites glisser le long d\'une ligne horizontale, diagonale gauche ou diagonale droite pour aligner 4 triangles de la même couleur',
    triBigTriangle: '4 triangles formant un grand triangle (3 dans un sens, 1 dans l\'autre) rapportent aussi',
    triFlipOrientation: 'Les triangles marqués se retournent sur une couleur tirée au hasard, chacun la sienne — regardez ce groupe se retourner puis revenir',
    triBlank: 'Quand toute une ligne retournée est assortie, ses triangles deviennent vides — ils glissent toujours librement, mais ne peuvent plus jamais marquer',
    navHome: 'Accueil',
    navAccount: 'Compte',
    navProfile: 'Profil',
    navRecords: 'Historique et classements',
    noRecordsYet: 'Pas encore de score',
    moreModesTitle: 'Autres modes',
    switchLanguage: 'Langue',
    howToBtn: 'Comment glisser ? · Revoir le tutoriel',
    sectionBase: 'Jeux de base',
    sectionTimed: 'Défi chronométré',
    sectionMore: 'Plus de plateaux',
    bombBasicTitle: 'Bombe de base',
    bombTimedTitle: 'Bombe chronométrée',
    bombAdvancedTitle: 'Bombe avancée',
    randomTargetTitle: 'Objectif de score aléatoire',
    comingSoon: 'Bientôt disponible',
    multiplayerTitle: 'Multijoueur',
    rankingsTitle: 'Historique et classements',
    totalScoreTitle: 'Score cumulé',
    totalScoreSync: 'Slides Génie garde chaque partie pour toujours',
    exclusiveEntry: 'Génie',
    tutorialPickerTitle: 'Comment glisser ?',
    tutorialPickerTagline: 'Choisissez un jeu pour revoir son tutoriel',
    backToMenu: 'Retour au menu',
    homeBtn: 'Accueil',
    rotateHint: 'Tournez votre téléphone — ce plateau est large',
    back: 'Retour',
    squareTutorialDesc: 'Faites glisser une ligne/colonne entière · les bases',
    circleTutorialDesc: '3 directions · losanges "22"/"121"',
    triangleTutorialDesc: '3 directions · grand triangle et retournement',
    accountTitle: 'Compte',
    tabRegister: "S'inscrire",
    tabLogin: 'Se connecter',
    accountComingSoon: 'Un système de compte complet arrive bientôt',
    loginGateway: 'Connexion',
    contactUs: 'Nous contacter',
    tutorialShort: 'Tutoriel',
    geniusPrivilegesTitle: 'Avantages Slides Génie',
    privilegesSoon: '…encore plus à venir',
    becomeGenius: 'Devenir un Slides Génie',
    geniusSpecialTitle: 'Exclusivités Slides Génie',
    geniusNowTitle: 'Débloqué dès votre abonnement',
    geniusNowCircleSeven: 'Plateau losange à sept couleurs',
    geniusNowTriangleAdvanced: 'Plateau triangle avancé en V',
    geniusSoonTitle: 'En cours de réalisation — bientôt disponible',
    geniusHostRooms: 'Courses en ligne à 2–4 joueurs simultanés',
    subscribeTitle: 'Devenir un Slides Génie',
    subscribeIntro: 'Plus de jeux tout de suite, d’autres de temps en temps, résiliable à tout moment.',
    planMonthly: 'par mois',
    planYearly: 'par an',
    subscribeBtn: 'S’abonner',
    restoreBtn: 'Restaurer l’achat',
    signInBtn: 'Se connecter',
    signOutBtn: 'Se déconnecter',
    emailLabel: 'Courriel',
    emailPlaceholder: 'vous@exemple.com',
    emailInvalid: 'Cette adresse ne semble pas valide.',
    registerIsSubscribe: 'S’inscrire, c’est s’abonner. Payez d’abord, puis choisissez un mot de passe de six caractères pour cette adresse — à eux deux, ils rouvrent votre abonnement sur n’importe quel appareil.',
    signInHint: 'Votre adresse et le mot de passe que vous avez défini.',
    storeNoAccountHint: 'Acheté avec votre compte {store} — sans inscription, sans quitter l’application.',
    subscribedTitle: 'Vous êtes un Slides Génie',
    subscribedUntil: 'Valable jusqu’au',
    manageSubscription: 'Gérer l’abonnement',
    manageOnStore: 'Résiliez ou modifiez dans les réglages de votre compte {store}.',
    geniusStatus: 'Abonnement',
    geniusOnly: 'Réservé aux Génies',
    haveCode: 'Vous avez un code Génie ?',
    redeemTitle: 'Code Slides Génie',
    redeemHint: 'Saisissez votre code Génie. Il débloque tout de suite.',
    redeemCodeLabel: 'Code Génie',
    redeemBtn: 'Débloquer',
    passwordLabel: 'Code secret (6 caractères)',
    passwordPlaceholder: '6 caractères',
    passwordAny: 'Mot de passe',
    setPwTitle: 'Choisissez un mot de passe',
    setPwHint: 'Vous êtes un Slides Génie. Définissez un mot de passe pour retrouver cet abonnement sur vos autres appareils — votre adresse et ce mot de passe suffisent.',
    setPwLabel: 'Mot de passe (6 caractères minimum)',
    setPwPlaceholder: '6 caractères minimum',
    setPwShort: 'Exactement six caractères.',
    newsOptIn: 'M’envoyer les nouveautés Slides par e-mail. Désinscription à tout moment.',
    setPwLater: 'Plus tard',
    bindTitle: 'Rattachez-le à une adresse',
    bindHint: 'Votre code Génie est utilisé et les plateaux sont ouverts. Donnez une adresse courriel et un mot de passe et il vous suivra sur vos autres appareils — sans eux, il ne vit que dans ce navigateur.',
    bindTaken: 'Cette adresse a déjà un compte. Utilisez-en une autre, ou écrivez-nous.',
    redeemCodePlaceholder: 'ex. K7M2QD',
    codeExpired: 'Ce code Génie a dépassé sa date limite.',
    tooManyTries: 'Trop de tentatives depuis cet appareil. Réessayez plus tard.',
    alreadyActive: 'Votre abonnement court toujours. Gardez ce code Génie pour plus tard, ou offrez-le — il ne sert qu’une fois.',
    insiderCode: 'Code Slides Génie',
    orderTitle: 'Votre abonnement',
    orderPlanLabel: 'Formule',
    orderUntilLabel: 'Payé jusqu’au',
    orderLifetime: 'À vie',
    orderLapsed: 'Ce compte n’a pas d’abonnement en cours.',
    giftTitle: 'Deux mois à offrir',
    giftHint: 'Pour votre abonnement à l’année. Offrez-en un — chacun débloque un mois, une seule fois.',
    giftUsed: 'utilisé',
    giftExpires: 'à utiliser avant le {date}',
    copyBtn: 'Copier',
    copiedLabel: 'Copié',
    needsPwHint: 'Cet abonnement n’a pas encore de mot de passe. Ouvrez-le depuis l’appareil du paiement pour en définir un.',
    redeemBadCode: 'Ce code Génie n’est pas valide, ou il a déjà été utilisé.',
    pwWrong: 'Ce code secret n’est pas le bon.',
    pwLocked: 'Trop d’essais. Se rouvre dans environ {hours} h.',
    pwBlocked: 'Verrouillé après trop d’essais. Rouvrez-le par courriel.',
    unlockTitle: 'Déverrouiller par courriel',
    unlockNow: 'Déverrouiller',
    unlockIntro: 'Nous envoyons un code à six chiffres à votre adresse. Il permet de définir un nouveau code secret.',
    unlockSendBtn: 'Envoyer le code',
    unlockSent: 'Envoyé. Le code est valable 30 minutes.',
    unlockCodeLabel: 'Le code à 6 chiffres reçu par courriel',
    unlockNewPw: 'Nouveau code secret (6 caractères)',
    unlockConfirmBtn: 'Déverrouiller et enregistrer',
    unlockBadCode: 'Ce code n’est pas le bon.',
    unlockExpired: 'Ce code a expiré. Demandez-en un nouveau.',
    unlockNoMail: 'Nous ne pouvons pas encore envoyer de courriel automatiquement. Écrivez à {email} et nous le rouvrirons.',
    mpTitle: 'Multijoueur',
    mpIntro: 'Montez une petite salle jusqu’à quatre, un seul et même plateau, et faites la course.',
    mpCreate: 'Ouvrir une salle',
    mpJoin: 'Rejoindre une salle',
    mpNameLabel: 'Votre nom',
    mpNamePlaceholder: 'Choisissez un nom',
    mpAvatarLabel: 'Votre signe',
    mpShuffle: 'Un autre',
    mpCodeLabel: 'Code de la salle',
    mpCodePlaceholder: 'quatre chiffres',
    mpRoomCode: 'Salle',
    mpShareHint: 'Donnez ces quatre chiffres à vos amis — {n} joueurs au maximum.',
    mpPlayers: 'Joueurs',
    mpHostBadge: 'hôte',
    mpPickMode: 'Choisissez un plateau',
    mpStartBtn: 'Commencer',
    mpWaitingHost: 'En attente du plateau choisi par l’hôte.',
    mpLeave: 'Quitter la salle',
    mpRankTitle: 'Classement du tournoi',
    mpNeedGenius: 'Rejoignez la salle d’un Slides Génie',
    mpSameBoard: 'Tout le monde reçoit exactement le même plateau.',
    mpGo: 'Partez !',
    mpStandings: 'Classement',
    mpFinished: 'terminé',
    mpGoPick: 'Choisir un plateau sur l’accueil',
    mpPickingTitle: 'Vous choisissez pour la salle {code}',
    mpBackToRoom: 'Retour à la salle',
    mpNotAMode: 'Les salles jouent les huit plateaux simples — ni chrono ni bombes.',
    mpRoundLabel: 'Manche {n}',
    mpNextRound: 'Choisir le plateau suivant',
    mpEndRoom: 'Fermer la salle',
    mpRoomEnded: 'L’hôte a fermé la salle.',
    mpTotalLabel: 'total',
    mpRoomTotal: 'Total de la salle',
    mpNudge: 'Presser l’hôte',
    mpLeftTag: 'parti',
    paletteTitle: 'Couleurs des pièces',
    paletteHint: 'S’applique à tous les plateaux. Inactif quand la palette daltonienne est active.',
    paletteLocked: 'Voici ce dans quoi un Slides Génie peut choisir.',
    paletteCvdTitle: 'Palette daltonienne',
    paletteCvdHint: 'Les trois sont vérifiées pour les daltonismes rouge, vert et bleu-jaune. Choisissez celle qui vous plaît.',
    cvdStd: 'Standard',
    cvdWarm: 'Chaude',
    cvdCool: 'Froide',
    paletteNow: 'D’origine',
    paletteJia: 'Profonde',
    paletteBing: 'Douce',
    mpKnowRules: 'Tu connais les règles de {name} ?',
    mpKnowYes: 'Oui',
    mpKnowNo: 'Explique-moi',
    mpLearningWait: 'Quelqu’un apprend encore — un instant',
    mpRoundResult: 'Cette manche',
    mpFinalTitle: 'Bilan de la salle',
    mpBestRound: 'Meilleure manche',
    mpFastest: 'Plateau le plus rapide',
    mpRoundsPlayed: '{n} manches',
    mpErrEnded: 'Cette salle a été fermée.',
    mpReconnecting: 'Connexion perdue — on vous y ramène…',
    mpHostLeaveWarn: 'Dissoudre la salle ?',
    mpGuestLeaveWarn: 'Partir ?',
    mpLeaveAnyway: 'Partir quand même',
    mpStay: 'Rester',
    mpFinishConfirm: 'Terminé ?',
    mpRoomCancelled: 'Oh non — la salle a disparu',
    mpOk: 'ok',
    mpHostFixing: 'L’hôte répare les câbles, un instant',
    mpErrNoRoom: 'Aucune salle avec ce code.',
    mpErrFull: 'Cette salle est pleine — {n} joueurs au maximum.',
    mpErrStarted: 'Cette partie a déjà commencé.',
    mpErrTooFew: 'Il faut au moins deux joueurs.',
    mpErrNotOpen: 'Le multijoueur n’est pas encore ouvert.',
    notOnSaleYet: 'L’abonnement n’est pas encore ouvert.',
    purchaseUnavailable: 'Cet appareil ne peut pas encore finaliser l’achat.',
    purchaseCancelled: 'Annulé — vous n’avez pas été débité.',
    purchaseNetwork: 'Pas de connexion. Réessayez dans un instant.',
    serverBusy: 'Un problème de notre côté. Réessayez dans un instant.',
    restoreNothing: 'Aucun abonnement à restaurer.',
    signInNotFound: 'Aucun abonnement actif à cette adresse.',
    workingLabel: 'En cours…',
    pauseBtn: 'Pause',
    finishBtn: 'Terminer',
    endRunTitle: 'Terminer la partie ?',
    endRunYes: 'Oui',
    endRunNo: 'Non',
    scoreLabel: 'Score',
    perfLabel: 'Taux de réussite',
    timeLabel: 'Temps',
    stuckEndBtn: 'Plus aucun retournement possible · appuyez pour terminer',
    startBtn: 'Commencer',
    pausedTitle: 'En pause',
    pausedBody: 'Le chronomètre est arrêté et le plateau est caché.',
    endTitleDefault: 'Défi terminé',
    compositeScoreLabel: 'Score composite',
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
    taglineThreeWay: 'Faites glisser une ligne — horizontale ou diagonale · formez des motifs d\'une même couleur',
    taglineDiagonal: 'Faites glisser une ligne — horizontale ou diagonale · formez des motifs d\'une même couleur',
    taglineVBoard: 'Un plateau en V · les deux bras glissent indépendamment',
    taglineBomb: 'Empêchez 4 pièces rouges de se rejoindre',
    rulesPill: 'Règles du jeu',
    iconPill: 'Icône',
    iconTitle: 'Icône de l’app',
    iconHint: 'Choisissez l’icône affichée sur l’onglet du navigateur.',
    labelRun4: 'Suite de 4',
    labelBlock22: '2x2',
    label121: '1-2-1',
    labelBigTriangle: 'Grand triangle',
    labelPattern: 'Motif',
    labelWholeLine: 'Ligne entière',
    patternPointsLabel: 'Points de motifs',
    comboBonusLabel: 'Bonus de série',
    linePointsLabel: 'Bonus de ligne',
    perfBonusLabel: 'Bonus de taux de réussite',
    timeMultLabel: 'Multiplicateur de temps',
    neverFlippedLabel: 'Jamais retournées',
    remainingLabel: 'Retournées, inachevées',
    defaultPenaltyLabel: 'Pénalité',
    bombPenaltyLabel: 'Pénalité de bombe',
    timeUpReason: 'Temps écoulé',
    noMoreMatchesReason: 'Plus aucune tuile visible ne peut être retournée',
    allFlippedReason: 'Toutes les cases sont retournées',
    manualEndReason: 'Terminé manuellement',
    bombHazardReason: 'Cases-bombes connectées',
    stepsPhrase: '{n} coups',
    bestPhrase: 'meilleur score {n}',
    rateLabel: 'Taux de réussite ',
    shareQrCaption: 'Scannez pour jouer à Slides',
    shareStartLabel: 'Début',
    shareEndLabel: 'Fin',
    shareFooterHint: 'Faites glisser une ligne, colonne ou diagonale entière pour assortir les couleurs',
    colorblindBtn: 'Palette adaptée aux daltoniens',
    shapeNameSquare: 'Carré',
    shapeNameCircle: 'Cercle',
    shapeNameTriangle: 'Triangle',
    shapeNameCircleHex: 'Cercle hexagonal',
    shapeNameSquareDiamond: 'Carré losange',
    shapeNameTriangleBig: 'Grand triangle',
    shapeNameCircleSeven: 'Cercle à sept couleurs',
    shapeNameTriangleAdvanced: 'Triangle avancé',
  },
  zhHant: {
    langName: '繁體中文',
    pickerTagline: '選擇語言',
    homeTagline: '滑動－得分－消除',
    skip: '跳過教學',
    next: '下一條',
    prev: '上一條',
    replay: '再一次',
    doneBtn: '完成',
    pause: '暫停',
    resume: '繼續',
    run4: '滑動一整行或一整列，湊齊 4 個同色方塊',
    twoByTwo: '湊成 2×2 的同色方塊同樣得分',
    flip: '得分的方塊會翻面到隨機決定的顏色',
    mixedFace: '翻面後的方塊一樣能繼續得分——把它和正面的同色方塊拼在一起',
    wholeLine: '反面同色連成一整行或一整列，會獲得高分並清空棋盤',
    circleClusterIntro: '圓球能沿水平、左斜、右斜拖動；同色能拼出三種得分圖案——4連線、「22」菱形、「121」菱形。拖動一下，依次看看它們翻面得分',
    circleFlipTeach: '得分的圓球會翻面，換成隨機決定的顏色——同一組消除的圓球，翻面後的顏色不一定相同',
    circleFlipDragHint: '拖動它試著翻面',
    circleBlank: '整條線翻面同色湊齊時，會變成空白球——仍可自由滑動補位，但不會再得分',
    circleBlankMove: '空白球依然佔著位置，也能被正常拖動——試著拖一下，看它照樣跟著滑動',
    triSlide: '沿水平、左斜或右斜方向拖動一整條線，湊齊 4 個同色三角',
    triBigTriangle: '4 個三角拼成一個大三角（3 個同向 + 1 個反向）同樣得分',
    triFlipOrientation: '得分的三角會翻面到隨機決定的顏色，每個三角各不相同——一起看這一組翻面再翻回來',
    triBlank: '整條線翻面同色湊齊時，會變成空白角——仍可自由滑動補位，但不會再得分',
    navHome: '首頁',
    navAccount: '帳戶',
    navProfile: '個人主頁',
    navRecords: '記錄與排名',
    noRecordsYet: '尚無成績',
    moreModesTitle: '更多玩法',
    switchLanguage: '語言',
    howToBtn: '如何滑？· 重新觀看新手教學',
    sectionBase: '基礎玩法',
    sectionTimed: '計時挑戰',
    sectionMore: '更多佈局',
    bombBasicTitle: '基礎炸彈',
    bombTimedTitle: '定時炸彈',
    bombAdvancedTitle: '進階炸彈',
    randomTargetTitle: '隨機得分目標',
    comingSoon: '敬請期待',
    multiplayerTitle: '多人遊玩',
    rankingsTitle: '成績與排名',
    totalScoreTitle: '累計得分',
    totalScoreSync: 'Slides 天才可永久記憶所有成績',
    exclusiveEntry: '天才入口',
    tutorialPickerTitle: '如何滑？',
    tutorialPickerTagline: '選擇一種玩法，重新觀看新手教學',
    backToMenu: '返回選單',
    homeBtn: '主頁',
    rotateHint: '這個棋盤很寬，把手機橫過來玩',
    back: '返回',
    squareTutorialDesc: '拖動整行/整列 · 基礎教學',
    circleTutorialDesc: '三向滑動 ·「22」/「121」菱形',
    triangleTutorialDesc: '三向滑動 · 大三角與翻面',
    accountTitle: '帳戶',
    tabRegister: '註冊',
    tabLogin: '登入',
    accountComingSoon: '敬請期待完整的帳戶系統',
    loginGateway: '登入',
    contactUs: '聯絡我們',
    tutorialShort: '教學',
    geniusPrivilegesTitle: 'Slides 天才專屬特權',
    privilegesSoon: '……敬請期待',
    becomeGenius: '成為 Slides 天才',
    geniusSpecialTitle: 'Slides 天才特供',
    subscribeTitle: '成為 Slides 天才',
    geniusNowTitle: '訂閱後立刻解鎖',
    geniusNowCircleSeven: '七色菱形小球棋盤',
    geniusNowTriangleAdvanced: '進階V型三角棋盤',
    geniusSoonTitle: '正在製作　敬請期待',
    geniusHostRooms: '2-4 人同時線上競賽',
    subscribeIntro: '立刻解鎖更多，不定時更新，隨時取消',
    planMonthly: '每月',
    planYearly: '每年',
    subscribeBtn: '訂閱',
    restoreBtn: '恢復購買',
    signInBtn: '登入',
    signOutBtn: '登出',
    emailLabel: '電子郵件',
    emailPlaceholder: 'you@example.com',
    emailInvalid: '這個郵件地址看起來不太對。',
    registerIsSubscribe: '註冊就是訂閱。先付款，再為這個電子郵件設一個 6 位密碼——之後在任何裝置上，用這兩樣就能找回你的訂閱。',
    signInHint: '你的電子郵件，加上你設的密碼。',
    storeNoAccountHint: '用你的 {store} 帳號購買，不必註冊，也不用離開 App。',
    subscribedTitle: '你已經是 Slides 天才',
    subscribedUntil: '有效期至',
    manageSubscription: '管理訂閱',
    manageOnStore: '到 {store} 的帳號設定裡取消或更改。',
    geniusStatus: '訂閱狀態',
    geniusOnly: '天才特供',
    haveCode: '有內部碼？',
    redeemTitle: 'Slides 天才內部碼',
    redeemHint: '輸入你的內部碼，馬上生效。',
    redeemCodeLabel: '內部碼',
    redeemBtn: '解鎖',
    passwordLabel: '密碼（6 位字元）',
    passwordPlaceholder: '6 位字元',
    passwordAny: '密碼',
    setPwTitle: '設定密碼',
    setPwHint: '你已經是 Slides 天才了。設一組密碼，換手機或換電腦時就能把訂閱取回來——只要電子郵件加這組密碼。',
    setPwLabel: '密碼（至少 6 位）',
    setPwPlaceholder: '至少 6 位',
    setPwShort: '密碼要正好 6 位。',
    newsOptIn: '想收到 Slides 的新玩法與更新郵件。可隨時退訂。',
    setPwLater: '稍後再說',
    bindTitle: '綁定到一個信箱',
    bindHint: '內部碼已經生效，棋盤都開了。留一個電子郵件和密碼，換手機或換電腦時就能把它取回來——不留的話，它只活在這個瀏覽器裡。',
    bindTaken: '這個信箱已經有帳號了。換一個，或者寫信給我們。',
    redeemCodePlaceholder: '例如 K7M2QD',
    codeExpired: '這個內部碼已經過了使用期限。',
    tooManyTries: '這裡試得太多了，請稍後再試。',
    alreadyActive: '你的訂閱還在有效期內。這張碼留著以後用，或者送人——它只能用一次。',
    insiderCode: 'Slides 天才內部碼',
    orderTitle: '你的訂閱',
    orderPlanLabel: '方案',
    orderUntilLabel: '已付到',
    orderLifetime: '終身',
    orderLapsed: '這個帳號目前沒有進行中的訂閱。',
    giftTitle: '兩個月，送給朋友',
    giftHint: '訂了一年才有的。發一張給朋友——每張解鎖一個月，只能用一次。',
    giftUsed: '已使用',
    giftExpires: '{date} 前有效',
    copyBtn: '複製',
    copiedLabel: '已複製',
    needsPwHint: '這個訂閱還沒設密碼。請在付款的那台裝置上打開，設一組。',
    redeemBadCode: '這個內部碼無效，或已經被使用過了。',
    pwWrong: '密碼不對。',
    pwLocked: '錯太多次了，約 {hours} 小時後自動解開。',
    pwBlocked: '錯太多次，已鎖住。用電子郵件解開。',
    unlockTitle: '電子郵件驗證解鎖',
    unlockNow: '解鎖',
    unlockIntro: '我們會寄一組六位數驗證碼到你的信箱，用它可以設定新密碼。',
    unlockSendBtn: '寄出驗證碼',
    unlockSent: '已寄出，驗證碼 30 分鐘內有效。',
    unlockCodeLabel: '信件裡的 6 位數驗證碼',
    unlockNewPw: '新密碼（6 位字元）',
    unlockConfirmBtn: '解鎖並設定新密碼',
    unlockBadCode: '驗證碼不對。',
    unlockExpired: '驗證碼已過期，請重新寄一次。',
    unlockNoMail: '目前還無法自動寄信。請寫信到 {email}，我們幫你開啟。',
    mpTitle: '多人遊玩',
    mpIntro: '蓋起一個最多四人的小屋，同樣的棋盤，與大家競賽',
    mpCreate: '開小屋',
    mpJoin: '加入小屋',
    mpNameLabel: '你的名字',
    mpNamePlaceholder: '起個名字',
    mpAvatarLabel: '你的圖形',
    mpShuffle: '換一個',
    mpCodeLabel: '小屋號碼',
    mpCodePlaceholder: '四位數字',
    mpRoomCode: '小屋號碼',
    mpShareHint: '把這四位數字給朋友——最多 {n} 個人。',
    mpPlayers: '玩家',
    mpHostBadge: '屋主',
    mpPickMode: '選一個玩法',
    mpStartBtn: '開始',
    mpWaitingHost: '等屋主選玩法。',
    mpLeave: '離開小屋',
    mpRankTitle: '競賽排名',
    mpNeedGenius: '加入 Slides 天才搭建的小屋',
    mpSameBoard: '所有人拿到完全一樣的棋盤。',
    mpGo: '開始！',
    mpStandings: '排名',
    mpFinished: '已完成',
    mpGoPick: '去主選單選玩法',
    mpPickingTitle: '你為 {code} 小屋選擇',
    mpBackToRoom: '小屋里',
    mpNotAMode: '小屋只玩八種基本玩法，計時與炸彈暫時不行。',
    mpRoundLabel: '第 {n} 局',
    mpNextRound: '選下一個玩法',
    mpEndRoom: '結束小屋',
    mpRoomEnded: '屋主結束了小屋。',
    mpTotalLabel: '總分',
    mpRoomTotal: '全屋總分',
    mpNudge: '催屋主',
    mpLeftTag: '已離開',
    paletteTitle: '棋子配色',
    paletteHint: '換的是每個玩法裡棋子的顏色。開著色盲配色時這裡不生效。',
    paletteLocked: '這就是 Slides 天才能挑的幾套。',
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
    mpRoundResult: '本局',
    mpFinalTitle: '小屋戰績',
    mpBestRound: '單局最高',
    mpFastest: '最快玩家',
    mpRoundsPlayed: '共 {n} 局',
    mpErrEnded: '這個小屋已經結束了。',
    mpReconnecting: '網路斷了一下，正在把你接回小屋…',
    mpHostLeaveWarn: '解散小屋？',
    mpGuestLeaveWarn: '是否離開？',
    mpLeaveAnyway: '還是離開',
    mpStay: '留下',
    mpFinishConfirm: '完成了嗎？',
    mpRoomCancelled: 'Ohno！小屋被取消',
    mpOk: 'ok',
    mpHostFixing: '屋主修理電纜中，稍等',
    mpErrNoRoom: '沒有這個小屋號碼。',
    mpErrFull: '小屋滿了——最多 {n} 個人。',
    mpErrStarted: '這一局已經開始了。',
    mpErrTooFew: '至少要兩個人。',
    mpErrNotOpen: '多人遊玩尚未開放。',
    notOnSaleYet: '訂閱尚未開放。',
    purchaseUnavailable: '這台裝置目前還無法完成購買。',
    purchaseCancelled: '已取消，沒有扣款。',
    purchaseNetwork: '連不上網路，請稍後再試。',
    serverBusy: '伺服器暫時出錯，請稍後再試。這不是你的網路問題。',
    restoreNothing: '沒有找到可以恢復的訂閱。',
    signInNotFound: '這個郵件地址名下沒有有效的訂閱。',
    workingLabel: '處理中…',
    pauseBtn: '暫停',
    finishBtn: '完成',
    endRunTitle: '是否結束遊戲？',
    endRunYes: '是',
    endRunNo: '否',
    scoreLabel: '得分',
    perfLabel: '有效得分率',
    timeLabel: '用時',
    stuckEndBtn: '無法全部翻面 · 點擊結束本局',
    startBtn: '開始',
    pausedTitle: '已暫停',
    pausedBody: '計時已停止，棋盤已隱藏。',
    endTitleDefault: '挑戰結束',
    compositeScoreLabel: '綜合得分',
    avgScoreLabel: '該玩法您的均分',
    soundBtn: '聲音',
    shareBtn: '分享',
    restartBtn: '再來',
    shareCardTitle: '分享戰績',
    shareImgAlt: '戰績卡片',
    shareHint: '長按或右鍵圖片即可儲存',
    closeBtn: '關閉',
    shellStartBody: '拖動整條線拼出同色圖案，點擊開始生成一局新的方糖陣勢。',
    taglineRowCol: '拖動一整行或一整列 · 拼出同色圖案',
    taglineThreeWay: '沿水平、左斜或右斜方向拖動整條線 · 拼出同色圖案',
    taglineDiagonal: '拖動水平或斜線方向的整條線 · 拼出同色圖案',
    taglineVBoard: 'V 形棋盤 · 左右兩臂橫向互不相連',
    taglineBomb: '避免紅色 4 連',
    rulesPill: '遊戲規則',
    iconPill: '圖示',
    iconTitle: '更換圖示',
    iconHint: '選擇顯示在瀏覽器分頁上的圖示。',
    labelRun4: '4連',
    labelBlock22: '2×2',
    label121: '121',
    labelBigTriangle: '大三角',
    labelPattern: '圖案',
    labelWholeLine: '整線',
    patternPointsLabel: '圖案分',
    comboBonusLabel: '連擊加成',
    linePointsLabel: '整線獎勵',
    perfBonusLabel: '有效得分率加成',
    timeMultLabel: '用時係數',
    neverFlippedLabel: '從未翻面',
    remainingLabel: '翻面未收尾',
    defaultPenaltyLabel: '懲罰',
    bombPenaltyLabel: '炸彈懲罰',
    timeUpReason: '時間到',
    noMoreMatchesReason: '無法翻面所有正面色塊',
    allFlippedReason: '全部方塊已翻成點面',
    manualEndReason: '手動結束',
    bombHazardReason: '紅色炸彈相連',
    stepsPhrase: '共 {n} 步',
    bestPhrase: '本機最佳 {n}',
    rateLabel: '得分率',
    shareQrCaption: '掃碼來 Slides～',
    shareStartLabel: '開始',
    shareEndLabel: '結束',
    shareFooterHint: '拖動整行整列或整條斜線，拼出同色圖案',
    colorblindBtn: '色盲友好配色',
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
    pickerTagline: '选择语言',
    homeTagline: '滑动－得分－消除',
    skip: '跳过教学',
    next: '下一条',
    prev: '上一条',
    replay: '再一次',
    doneBtn: '完成',
    pause: '暂停',
    resume: '继续',
    run4: '滑动一整行或一整列，凑齐 4 个同色方块',
    twoByTwo: '凑成 2×2 的同色方块同样得分',
    flip: '得分的方块会翻面到随机决定的颜色',
    mixedFace: '翻面后的方块一样能继续得分——把它和正面的同色方块拼在一起',
    wholeLine: '反面同色连成一整行或一整列，会获得高分并清空棋盘',
    circleClusterIntro: '圆球能沿水平、左斜、右斜拖动；同色能拼出三种得分图案——4连线、"22"菱形、"121"菱形。拖动一下，依次看看它们翻面得分',
    circleFlipTeach: '得分的圆球会翻面，换成随机决定的颜色——同一组消除的圆球，翻面后的颜色不一定相同',
    circleFlipDragHint: '拖动它试着翻面',
    circleBlank: '整条线翻面同色凑齐时，会变成空白球——仍可自由滑动补位，但不会再得分',
    circleBlankMove: '空白球依然占着位置，也能被正常拖动——试着拖一下，看它照样跟着滑动',
    triSlide: '沿水平、左斜或右斜方向拖动一整条线，凑齐 4 个同色三角',
    triBigTriangle: '4 个三角拼成一个大三角（3 个同向 + 1 个反向）同样得分',
    triFlipOrientation: '得分的三角会翻面到随机决定的颜色，每个三角各不相同——一起看这一组翻面再翻回来',
    triBlank: '整条线翻面同色凑齐时，会变成空白角——仍可自由滑动补位，但不会再得分',
    navHome: '首页',
    navAccount: '账户',
    navProfile: '个人主页',
    navRecords: '记录与排名',
    noRecordsYet: '尚无成绩',
    moreModesTitle: '更多玩法',
    switchLanguage: '语言',
    howToBtn: '如何滑？· 重新观看新手教学',
    sectionBase: '基础玩法',
    sectionTimed: '计时挑战',
    sectionMore: '更多布局',
    bombBasicTitle: '基础炸弹',
    bombTimedTitle: '定时炸弹',
    bombAdvancedTitle: '进阶炸弹',
    randomTargetTitle: '随机得分目标',
    comingSoon: '敬请期待',
    multiplayerTitle: '多人游玩',
    rankingsTitle: '成绩与排名',
    totalScoreTitle: '累计得分',
    totalScoreSync: 'Slides 天才可永久记忆所有成绩',
    exclusiveEntry: '天才入口',
    tutorialPickerTitle: '如何滑？',
    tutorialPickerTagline: '选择一种玩法，重新观看新手教学',
    backToMenu: '返回菜单',
    homeBtn: '主页',
    rotateHint: '这个棋盘很宽，把手机横过来玩',
    back: '返回',
    squareTutorialDesc: '拖动整行/整列 · 基础教学',
    circleTutorialDesc: '三向滑动 ·"22"/"121"菱形',
    triangleTutorialDesc: '三向滑动 · 大三角与翻面',
    accountTitle: '账户',
    tabRegister: '注册',
    tabLogin: '登录',
    accountComingSoon: '敬请期待完整的账户系统',
    loginGateway: '登录',
    contactUs: '联系我们',
    tutorialShort: '教学',
    geniusPrivilegesTitle: 'Slides 天才专属特权',
    privilegesSoon: '……敬请期待',
    becomeGenius: '成为 Slides 天才',
    geniusSpecialTitle: 'Slides 天才特供',
    subscribeTitle: '成为 Slides 天才',
    geniusNowTitle: '订阅后立刻解锁',
    geniusNowCircleSeven: '七色菱形小球棋盘',
    geniusNowTriangleAdvanced: '进阶V型三角棋盘',
    geniusSoonTitle: '正在制作　敬请期待',
    geniusHostRooms: '2-4 人同时线上竞赛',
    subscribeIntro: '立刻解锁更多，不定时更新，随时取消',
    planMonthly: '每月',
    planYearly: '每年',
    subscribeBtn: '订阅',
    restoreBtn: '恢复购买',
    signInBtn: '登录',
    signOutBtn: '退出登录',
    emailLabel: '邮箱',
    emailPlaceholder: 'you@example.com',
    emailInvalid: '这个邮箱地址看起来不太对。',
    registerIsSubscribe: '注册就是订阅。先付款，再为这个邮箱设一个 6 位密码——之后在任何设备上，用这两样就能找回你的订阅。',
    signInHint: '你的邮箱，加上你设的密码。',
    storeNoAccountHint: '用你的 {store} 账号购买，不用注册，也不用离开 App。',
    subscribedTitle: '你已经是 Slides 天才',
    subscribedUntil: '有效期至',
    manageSubscription: '管理订阅',
    manageOnStore: '到 {store} 的账号设置里取消或更改。',
    geniusStatus: '订阅状态',
    geniusOnly: '天才特供',
    haveCode: '有内部码？',
    redeemTitle: 'Slides 天才内部码',
    redeemHint: '输入你的内部码，马上生效。',
    redeemCodeLabel: '内部码',
    redeemBtn: '解锁',
    passwordLabel: '密码（6 位字符）',
    passwordPlaceholder: '6 位字符',
    passwordAny: '密码',
    setPwTitle: '设置密码',
    setPwHint: '你已经是 Slides 天才了。设一组密码，换手机或换电脑时就能把订阅取回来——只要邮箱加这组密码。',
    setPwLabel: '密码（至少 6 位）',
    setPwPlaceholder: '至少 6 位',
    setPwShort: '密码要正好 6 位。',
    newsOptIn: '想收到 Slides 的新玩法与更新邮件。可随时退订。',
    setPwLater: '稍后再说',
    bindTitle: '绑定到一个邮箱',
    bindHint: '内部码已经生效，棋盘都开了。留一个邮箱和密码，换手机或换电脑时就能把它取回来——不留的话，它只活在这个浏览器里。',
    bindTaken: '这个邮箱已经有账号了。换一个，或者写信给我们。',
    redeemCodePlaceholder: '例如 K7M2QD',
    codeExpired: '这个内部码已经过了使用期限。',
    tooManyTries: '这里试得太多了，请稍后再试。',
    alreadyActive: '你的订阅还在有效期内。这张码留着以后用，或者送人——它只能用一次。',
    insiderCode: 'Slides 天才内部码',
    orderTitle: '你的订阅',
    orderPlanLabel: '方案',
    orderUntilLabel: '已付到',
    orderLifetime: '终身',
    orderLapsed: '这个账号目前没有进行中的订阅。',
    giftTitle: '两个月，送给朋友',
    giftHint: '订了一年才有的。发一张给朋友——每张解锁一个月，只能用一次。',
    giftUsed: '已使用',
    giftExpires: '{date} 前有效',
    copyBtn: '复制',
    copiedLabel: '已复制',
    needsPwHint: '这个订阅还没设密码。请在付款的那台设备上打开，设一组。',
    redeemBadCode: '这个内部码无效，或者已经被用过了。',
    pwWrong: '密码不对。',
    pwLocked: '错太多次了，约 {hours} 小时后自动解开。',
    pwBlocked: '错太多次，已锁住。用邮箱解开。',
    unlockTitle: '邮箱验证解锁',
    unlockNow: '解锁',
    unlockIntro: '我们会发一组六位数验证码到你的邮箱，用它可以设置新密码。',
    unlockSendBtn: '发送验证码',
    unlockSent: '已发送，验证码 30 分钟内有效。',
    unlockCodeLabel: '邮件里的 6 位验证码',
    unlockNewPw: '新密码（6 位字符）',
    unlockConfirmBtn: '解锁并设置新密码',
    unlockBadCode: '验证码不对。',
    unlockExpired: '验证码已过期，请重新发送。',
    unlockNoMail: '目前还无法自动发信。请写信到 {email}，我们帮你开启。',
    mpTitle: '多人游玩',
    mpIntro: '盖起一个最多四人的小屋，同样的棋盘，与大家竞赛',
    mpCreate: '开小屋',
    mpJoin: '加入小屋',
    mpNameLabel: '你的名字',
    mpNamePlaceholder: '起个名字',
    mpAvatarLabel: '你的图形',
    mpShuffle: '换一个',
    mpCodeLabel: '小屋号码',
    mpCodePlaceholder: '四位数字',
    mpRoomCode: '小屋号码',
    mpShareHint: '把这四位数字给朋友——最多 {n} 个人。',
    mpPlayers: '玩家',
    mpHostBadge: '屋主',
    mpPickMode: '选一个玩法',
    mpStartBtn: '开始',
    mpWaitingHost: '等屋主选玩法。',
    mpLeave: '离开小屋',
    mpRankTitle: '竞赛排名',
    mpNeedGenius: '加入 Slides 天才搭建的小屋',
    mpSameBoard: '所有人拿到完全一样的棋盘。',
    mpGo: '开始！',
    mpStandings: '排名',
    mpFinished: '已完成',
    mpGoPick: '去主菜单选玩法',
    mpPickingTitle: '你为 {code} 小屋选择',
    mpBackToRoom: '小屋里',
    mpNotAMode: '小屋只玩八种基本玩法，计时和炸弹暂时不行。',
    mpRoundLabel: '第 {n} 局',
    mpNextRound: '选下一个玩法',
    mpEndRoom: '结束小屋',
    mpRoomEnded: '屋主结束了小屋。',
    mpTotalLabel: '总分',
    mpRoomTotal: '全屋总分',
    mpNudge: '催屋主',
    mpLeftTag: '已离开',
    paletteTitle: '棋子配色',
    paletteHint: '换的是每个玩法里棋子的颜色。开着色盲配色时这里不生效。',
    paletteLocked: '这就是 Slides 天才能挑的几套。',
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
    mpRoundResult: '本局',
    mpFinalTitle: '小屋战绩',
    mpBestRound: '单局最高',
    mpFastest: '最快玩家',
    mpRoundsPlayed: '共 {n} 局',
    mpErrEnded: '这个小屋已经结束了。',
    mpReconnecting: '网络断了一下，正在把你接回小屋…',
    mpHostLeaveWarn: '解散小屋？',
    mpGuestLeaveWarn: '是否离开？',
    mpLeaveAnyway: '还是离开',
    mpStay: '留下',
    mpFinishConfirm: '完成了吗？',
    mpRoomCancelled: 'Ohno！小屋被取消',
    mpOk: 'ok',
    mpHostFixing: '屋主修理电缆中，稍等',
    mpErrNoRoom: '没有这个小屋号码。',
    mpErrFull: '小屋满了——最多 {n} 个人。',
    mpErrStarted: '这一局已经开始了。',
    mpErrTooFew: '至少要两个人。',
    mpErrNotOpen: '多人游玩尚未开放。',
    notOnSaleYet: '订阅尚未开放。',
    purchaseUnavailable: '这台设备暂时还无法完成购买。',
    purchaseCancelled: '已取消，没有扣款。',
    purchaseNetwork: '连不上网络，请稍后再试。',
    serverBusy: '服务器暂时出错，请稍后再试。这不是你的网络问题。',
    restoreNothing: '没有找到可以恢复的订阅。',
    signInNotFound: '这个邮箱名下没有有效的订阅。',
    workingLabel: '处理中…',
    pauseBtn: '暂停',
    finishBtn: '完成',
    endRunTitle: '是否结束游戏？',
    endRunYes: '是',
    endRunNo: '否',
    scoreLabel: '得分',
    perfLabel: '有效得分率',
    timeLabel: '用时',
    stuckEndBtn: '无法全部翻面 · 点击结束本局',
    startBtn: '开始',
    pausedTitle: '已暂停',
    pausedBody: '计时已停止，棋盘已隐藏。',
    endTitleDefault: '挑战结束',
    compositeScoreLabel: '综合得分',
    avgScoreLabel: '该玩法您的均分',
    soundBtn: '声音',
    shareBtn: '分享',
    restartBtn: '再来',
    shareCardTitle: '分享战绩',
    shareImgAlt: '战绩卡片',
    shareHint: '长按或右键图片即可保存',
    closeBtn: '关闭',
    shellStartBody: '拖动整条线拼出同色图案，点击开始生成一局新的方糖阵势。',
    taglineRowCol: '拖动一整行或一整列 · 拼出同色图案',
    taglineThreeWay: '沿水平、左斜或右斜方向拖动整条线 · 拼出同色图案',
    taglineDiagonal: '拖动水平或斜线方向的整条线 · 拼出同色图案',
    taglineVBoard: 'V 形棋盘 · 左右两臂横向互不相连',
    taglineBomb: '避免红色 4 连',
    rulesPill: '游戏规则',
    iconPill: '图标',
    iconTitle: '更换图标',
    iconHint: '选择显示在浏览器标签页上的图标。',
    labelRun4: '4连',
    labelBlock22: '2×2',
    label121: '121',
    labelBigTriangle: '大三角',
    labelPattern: '图案',
    labelWholeLine: '整线',
    patternPointsLabel: '图案分',
    comboBonusLabel: '连击加成',
    linePointsLabel: '整线奖励',
    perfBonusLabel: '有效得分率加成',
    timeMultLabel: '用时系数',
    neverFlippedLabel: '从未翻面',
    remainingLabel: '翻面未收尾',
    defaultPenaltyLabel: '惩罚',
    bombPenaltyLabel: '炸弹惩罚',
    timeUpReason: '时间到',
    noMoreMatchesReason: '无法翻面所有正面色块',
    allFlippedReason: '全部方块已翻成点面',
    manualEndReason: '手动结束',
    bombHazardReason: '红色炸弹相连',
    stepsPhrase: '共 {n} 步',
    bestPhrase: '本机最佳 {n}',
    rateLabel: '得分率',
    shareQrCaption: '扫码来 Slides～',
    shareStartLabel: '开始',
    shareEndLabel: '结束',
    shareFooterHint: '拖动整行整列或整条斜线，拼出同色图案',
    colorblindBtn: '色盲友好配色',
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
  en: ['More color palettes', 'More levels', 'More score targets', 'More layouts', 'More game modes', 'More competitions', 'Global & friend rankings', 'An Apple Watch edition'],
  fr: ['Plus de palettes de couleurs', 'Plus de niveaux', "Plus d'objectifs de score", 'Plus de plateaux', 'Plus de modes de jeu', 'Plus de compétitions', 'Classements mondiaux et entre amis', 'Une édition Apple Watch'],
  zhHant: ['解鎖更多配色', '更多關卡', '更多得分目標', '更多佈局', '更多玩法', '更多競賽', '世界排名和好友排名', 'Apple Watch 特別版'],
  zhHans: ['解锁更多配色', '更多关卡', '更多得分目标', '更多布局', '更多玩法', '更多竞赛', '世界排名和好友排名', 'Apple Watch 特别版'],
};

export function loadLang(): Lang | null {
  const v = localStorage.getItem(LANG_STORAGE_KEY);
  return v && LANG_ORDER.includes(v as Lang) ? (v as Lang) : null;
}

export function saveLang(lang: Lang): void {
  localStorage.setItem(LANG_STORAGE_KEY, lang);
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

export type TutorialShape = 'square' | 'circle' | 'triangle';
const TUTORIAL_SEEN_KEYS: Record<TutorialShape, string> = {
  square: TUTORIAL_SEEN_KEY,
  circle: 'slides_tutorial_seen_circle',
  triangle: 'slides_tutorial_seen_triangle',
};

export function hasSeenTutorial(shape: TutorialShape = 'square'): boolean {
  return localStorage.getItem(TUTORIAL_SEEN_KEYS[shape]) === '1';
}

export function markTutorialSeen(shape: TutorialShape = 'square'): void {
  localStorage.setItem(TUTORIAL_SEEN_KEYS[shape], '1');
}

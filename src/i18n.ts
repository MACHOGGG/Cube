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
    totalScoreSync: 'sign in to unlock + sync',
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
    totalScoreSync: 'connexion : débloquer + synchroniser',
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
    totalScoreSync: '登入解鎖＋同步',
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
    totalScoreSync: '登录解锁＋同步',
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
    loginGateway: '登入',
    contactUs: '联系我们',
    tutorialShort: '教学',
    geniusPrivilegesTitle: 'Slides 天才专属特权',
    privilegesSoon: '……敬请期待',
    becomeGenius: '成为 Slides 天才',
    geniusSpecialTitle: 'Slides 天才特供',
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

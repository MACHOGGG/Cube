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
  switchLanguage: string;
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
    switchLanguage: 'Switch language',
  },
  fr: {
    langName: 'Français',
    pickerTagline: 'Choisissez votre langue',
    homeTagline: 'Glisser · Marquer · Effacer',
    skip: 'Passer le tutoriel',
    next: 'Suivant',
    prev: 'Précédent',
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
    switchLanguage: 'Changer de langue',
  },
  zhHant: {
    langName: '繁體中文',
    pickerTagline: '選擇語言',
    homeTagline: '滑動－得分－消除',
    skip: '跳過教學',
    next: '下一條',
    prev: '上一條',
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
    switchLanguage: '切換語言',
  },
  zhHans: {
    langName: '简体中文',
    pickerTagline: '选择语言',
    homeTagline: '滑动－得分－消除',
    skip: '跳过教学',
    next: '下一条',
    prev: '上一条',
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
    switchLanguage: '切换语言',
  },
};

export function loadLang(): Lang | null {
  const v = localStorage.getItem(LANG_STORAGE_KEY);
  return v && LANG_ORDER.includes(v as Lang) ? (v as Lang) : null;
}

export function saveLang(lang: Lang): void {
  localStorage.setItem(LANG_STORAGE_KEY, lang);
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

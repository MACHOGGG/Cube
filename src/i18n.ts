export type Lang = 'en' | 'fr' | 'zhHant' | 'zhHans';

export const LANG_STORAGE_KEY = 'slides_lang';
export const TUTORIAL_SEEN_KEY = 'slides_tutorial_seen';

export interface I18nStrings {
  langName: string;
  pickerTagline: string;
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
  circleSlide: string;
  circleCluster: string;
  circleCluster121: string;
  circleBlank: string;
  triSlide: string;
  triBigTriangle: string;
  triFlipOrientation: string;
  triBlank: string;
}

export const LANG_ORDER: Lang[] = ['en', 'fr', 'zhHant', 'zhHans'];

export const STRINGS: Record<Lang, I18nStrings> = {
  en: {
    langName: 'English',
    pickerTagline: 'Choose your language',
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
    circleSlide: 'Drag along a horizontal, left-diagonal, or right-diagonal line to line up 4 balls of the same color',
    circleCluster: 'A "22" diamond — 2 balls, then 2 more one row over — of the same color scores too',
    circleCluster121: 'A "121" diamond — 1 ball, then 2, then 1, spanning three rows — of the same color scores too',
    circleBlank: 'When a whole flipped line matches, it becomes blank balls — still slide freely, but they can never score again',
    triSlide: 'Drag along a horizontal, left-diagonal, or right-diagonal line to line up 4 triangles of the same color',
    triBigTriangle: '4 triangles combining into one big triangle (3 one way, 1 the other) score too',
    triFlipOrientation: 'A triangle pushed off one edge wraps back in on the other side — pointing the opposite way',
    triBlank: 'When a whole flipped line matches, it becomes blank triangles — still slide freely, but they can never score again',
  },
  fr: {
    langName: 'Français',
    pickerTagline: 'Choisissez votre langue',
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
    circleSlide: 'Faites glisser le long d\'une ligne horizontale, diagonale gauche ou diagonale droite pour aligner 4 boules de la même couleur',
    circleCluster: 'Un losange "22" — 2 boules, puis 2 autres une rangée plus loin — de la même couleur rapporte aussi',
    circleCluster121: 'Un losange "121" — 1 boule, puis 2, puis 1, sur trois rangées — de la même couleur rapporte aussi',
    circleBlank: 'Quand toute une ligne retournée est assortie, ses boules deviennent vides — elles glissent toujours librement, mais ne peuvent plus jamais marquer',
    triSlide: 'Faites glisser le long d\'une ligne horizontale, diagonale gauche ou diagonale droite pour aligner 4 triangles de la même couleur',
    triBigTriangle: '4 triangles formant un grand triangle (3 dans un sens, 1 dans l\'autre) rapportent aussi',
    triFlipOrientation: 'Un triangle poussé hors d\'un bord revient de l\'autre côté — pointant dans l\'autre sens',
    triBlank: 'Quand toute une ligne retournée est assortie, ses triangles deviennent vides — ils glissent toujours librement, mais ne peuvent plus jamais marquer',
  },
  zhHant: {
    langName: '繁體中文',
    pickerTagline: '選擇語言',
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
    circleSlide: '沿水平、左斜或右斜方向拖動一整條線，湊齊 4 顆同色圓球',
    circleCluster: '同色的「22」菱形(2 顆接著下一行再 2 顆)同樣得分',
    circleCluster121: '同色的「121」菱形(1 顆、2 顆、1 顆，橫跨三行)同樣得分',
    circleBlank: '整條線翻面同色湊齊時，會變成空白球——仍可自由滑動補位，但不會再得分',
    triSlide: '沿水平、左斜或右斜方向拖動一整條線，湊齊 4 個同色三角',
    triBigTriangle: '4 個三角拼成一個大三角（3 個同向 + 1 個反向）同樣得分',
    triFlipOrientation: '被推出邊緣的三角，會從另一側補回並換成相反的朝向',
    triBlank: '整條線翻面同色湊齊時，會變成空白角——仍可自由滑動補位，但不會再得分',
  },
  zhHans: {
    langName: '简体中文',
    pickerTagline: '选择语言',
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
    circleSlide: '沿水平、左斜或右斜方向拖动一整条线，凑齐 4 颗同色圆球',
    circleCluster: '同色的"22"菱形(2颗接着下一行再2颗)同样得分',
    circleCluster121: '同色的"121"菱形(1颗、2颗、1颗，横跨三行)同样得分',
    circleBlank: '整条线翻面同色凑齐时，会变成空白球——仍可自由滑动补位，但不会再得分',
    triSlide: '沿水平、左斜或右斜方向拖动一整条线，凑齐 4 个同色三角',
    triBigTriangle: '4 个三角拼成一个大三角（3 个同向 + 1 个反向）同样得分',
    triFlipOrientation: '被推出边缘的三角，会从另一侧补回并换成相反的朝向',
    triBlank: '整条线翻面同色凑齐时，会变成空白角——仍可自由滑动补位，但不会再得分',
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

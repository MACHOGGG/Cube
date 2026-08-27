export type Lang = 'en' | 'fr' | 'zhHant' | 'zhHans';

export const LANG_STORAGE_KEY = 'slides_lang';
export const TUTORIAL_SEEN_KEY = 'slides_tutorial_seen';

export interface I18nStrings {
  langName: string;
  pickerTagline: string;
  skip: string;
  next: string;
  prev: string;
  run4: string;
  twoByTwo: string;
  flip: string;
  mixedFace: string;
  wholeLine: string;
}

export const LANG_ORDER: Lang[] = ['en', 'fr', 'zhHant', 'zhHans'];

export const STRINGS: Record<Lang, I18nStrings> = {
  en: {
    langName: 'English',
    pickerTagline: 'Choose your language',
    skip: 'Skip',
    next: 'Next',
    prev: 'Back',
    run4: 'Slide a row or column to line up 4 tiles of the same color',
    twoByTwo: 'A 2×2 block of the same color scores too',
    flip: 'Scored tiles flip to a color chosen at random',
    mixedFace: 'A flipped tile can keep scoring — match its color with a front-facing tile too',
    wholeLine: 'A whole row or column of matching flipped tiles scores big and clears the board',
  },
  fr: {
    langName: 'Français',
    pickerTagline: 'Choisissez votre langue',
    skip: 'Passer',
    next: 'Suivant',
    prev: 'Précédent',
    run4: 'Faites glisser une ligne ou une colonne pour aligner 4 cases de la même couleur',
    twoByTwo: 'Un carré 2×2 de la même couleur rapporte aussi',
    flip: 'Les cases marquées se retournent sur une couleur tirée au hasard',
    mixedFace: 'Une case retournée peut aussi marquer — associez-la à une case encore de face',
    wholeLine: 'Une ligne ou colonne entière retournée de la même couleur rapporte gros et vide le plateau',
  },
  zhHant: {
    langName: '繁體中文',
    pickerTagline: '選擇語言',
    skip: '跳過',
    next: '下一條',
    prev: '上一條',
    run4: '滑動一整行或一整列，湊齊 4 個同色方塊',
    twoByTwo: '湊成 2×2 的同色方塊同樣得分',
    flip: '得分的方塊會翻面到隨機決定的顏色',
    mixedFace: '翻面後的方塊一樣能繼續得分——把它和正面的同色方塊拼在一起',
    wholeLine: '反面同色連成一整行或一整列，會獲得高分並清空棋盤',
  },
  zhHans: {
    langName: '简体中文',
    pickerTagline: '选择语言',
    skip: '跳过',
    next: '下一条',
    prev: '上一条',
    run4: '滑动一整行或一整列，凑齐 4 个同色方块',
    twoByTwo: '凑成 2×2 的同色方块同样得分',
    flip: '得分的方块会翻面到随机决定的颜色',
    mixedFace: '翻面后的方块一样能继续得分——把它和正面的同色方块拼在一起',
    wholeLine: '反面同色连成一整行或一整列，会获得高分并清空棋盘',
  },
};

export function loadLang(): Lang | null {
  const v = localStorage.getItem(LANG_STORAGE_KEY);
  return v && LANG_ORDER.includes(v as Lang) ? (v as Lang) : null;
}

export function saveLang(lang: Lang): void {
  localStorage.setItem(LANG_STORAGE_KEY, lang);
}

export function hasSeenTutorial(): boolean {
  return localStorage.getItem(TUTORIAL_SEEN_KEY) === '1';
}

export function markTutorialSeen(): void {
  localStorage.setItem(TUTORIAL_SEEN_KEY, '1');
}

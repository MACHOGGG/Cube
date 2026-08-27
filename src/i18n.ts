export type Lang = 'en' | 'fr' | 'zhHant' | 'zhHans';

export const LANG_STORAGE_KEY = 'slides_lang';
export const TUTORIAL_SEEN_KEY = 'slides_tutorial_seen';

export interface I18nStrings {
  langName: string;
  pickerTagline: string;
  skip: string;
  next: string;
  beat1: string;
  beat2: string;
  beat3: string;
  beat4: string;
  beat5: string;
}

export const LANG_ORDER: Lang[] = ['en', 'fr', 'zhHant', 'zhHans'];

export const STRINGS: Record<Lang, I18nStrings> = {
  en: {
    langName: 'English',
    pickerTagline: 'Choose your language',
    skip: 'Skip',
    next: 'Next',
    beat1: 'Slide a row or column to complete a 2×2 same-color pattern',
    beat2: 'Slide a row or column to complete a 1×4 same-color line',
    beat3: 'When you score, the matched tiles flip to a color chosen at random',
    beat4: 'Flipped tiles can keep scoring too — match a front color with its same back color',
    beat5: 'A whole row or column of matching flipped tiles scores big and clears from the board',
  },
  fr: {
    langName: 'Français',
    pickerTagline: 'Choisissez votre langue',
    skip: 'Passer',
    next: 'Suivant',
    beat1: 'Faites glisser une ligne ou une colonne pour former un carré 2×2 de la même couleur',
    beat2: 'Faites glisser une ligne ou une colonne pour aligner 4 cases de la même couleur',
    beat3: 'Une fois un score marqué, les cases retournent sur une couleur tirée au hasard',
    beat4: 'Les cases retournées comptent aussi — associez une couleur au recto avec la même au verso',
    beat5: 'Une ligne ou colonne entière retournée de la même couleur rapporte gros et disparaît du plateau',
  },
  zhHant: {
    langName: '繁體中文',
    pickerTagline: '選擇語言',
    skip: '跳過',
    next: '下一個',
    beat1: '滑動一整行或一整列，湊成 2×2 同色圖案',
    beat2: '滑動一整行或一整列，湊成 1×4 同色圖案',
    beat3: '得分後，得分的方塊會翻面到隨機決定的顏色',
    beat4: '翻面後的顏色一樣能繼續得分——試著把正面和反面的同色拼在一起',
    beat5: '反面同色連成一整行或一整列，會獲得高分並從棋盤中消除',
  },
  zhHans: {
    langName: '简体中文',
    pickerTagline: '选择语言',
    skip: '跳过',
    next: '下一个',
    beat1: '滑动一整行或一整列，凑成 2×2 同色图案',
    beat2: '滑动一整行或一整列，凑成 1×4 同色图案',
    beat3: '得分后，得分的方块会翻面到随机决定的颜色',
    beat4: '翻面后的颜色一样能继续得分——试着把正面和反面的同色拼在一起',
    beat5: '反面同色连成一整行或一整列，会获得高分并从棋盘中消除',
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

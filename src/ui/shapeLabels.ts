import { STRINGS, type Lang, type I18nStrings } from '../i18n';

// Every ShapeCardMeta.id in the game, mapped to the I18nStrings key holding
// its localized display name — card.name itself is set once at module load
// (in Chinese, before any language is even chosen) and used as an internal
// identifier/fallback, never read directly for display anymore.
const SHAPE_NAME_KEY: Record<string, keyof I18nStrings> = {
  square: 'shapeNameSquare',
  circle: 'shapeNameCircle',
  triangle: 'shapeNameTriangle',
  circleHex: 'shapeNameCircleHex',
  squareDiamond: 'shapeNameSquareDiamond',
  triangleBig: 'shapeNameTriangleBig',
  circleSeven: 'shapeNameCircleSeven',
  triangleAdvanced: 'shapeNameTriangleAdvanced',
};

/** Looks up a shape card's localized display name by its id; falls back to
 *  the card's own (Chinese) built-in name if the id is somehow unknown. */
export function shapeName(lang: Lang, id: string, fallback: string): string {
  const key = SHAPE_NAME_KEY[id];
  return key ? (STRINGS[lang][key] as string) : fallback;
}

import { STRINGS, type Lang, type I18nStrings } from '../i18n';

// Every ShapeCardMeta.id in the game, mapped to the I18nStrings key holding
// its localized display name — card.name itself is set once at module load
// (in Chinese, before any language is even chosen) and used as an internal
// identifier/fallback, never read directly for display anymore.
const SHAPE_NAME_KEY: Record<string, keyof I18nStrings> = {
  square: 'shapeNameSquare',
  circle: 'shapeNameCircle',
  circleHex: 'shapeNameCircleHex',
  squareDiamond: 'shapeNameSquareDiamond',
  triangleBig: 'shapeNameTriangleBig',
  circleSeven: 'shapeNameCircleSeven',
  // 下面两副棋盘 2026-09 删了（《侵蚀阶梯》v1.2 PR-6：原《三角》id `triangle`、
  // V 形 `triangleAdvanced`）。**名字这一行故意留着**：云端存着的旧战绩、别人寄
  // 来的旧分享卡里还带着这两个 id，查得到名字总比在记录页上显示一串 id 好——而
  // card 对象已经没了，兜底的 fallback 只会是 id 本身。
  triangle: 'shapeNameTriangle',
  triangleAdvanced: 'shapeNameTriangleAdvanced',
};

/** Looks up a shape card's localized display name by its id; falls back to
 *  the card's own (Chinese) built-in name if the id is somehow unknown. */
export function shapeName(lang: Lang, id: string, fallback: string): string {
  const key = SHAPE_NAME_KEY[id];
  return key ? (STRINGS[lang][key] as string) : fallback;
}

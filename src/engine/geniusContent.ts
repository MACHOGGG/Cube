import { isGenius } from './subscription';

/**
 * What 「Slides 天才」 actually buys — the one list, so the paywall, the home
 * page and the 天才特供 panel can never disagree about it.
 *
 * Everything here already exists and already works. That is the point: a
 * subscription that unlocks something on the day it is bought is a different
 * proposition from one that promises features later, and these two boards
 * are the deepest of the five 「+」 layouts, so they are worth having rather
 * than merely being withheld.
 *
 * What stays free is deliberate too. Each of the three shapes keeps a free
 * 「+」 layout of its own — 菱形方块, 六边圆球, 大三角 — so no shape becomes
 * a locked door, and the free game is still the whole game plus a variant
 * for every piece.
 */
export const GENIUS_LAYOUTS: readonly string[] = ['circleSeven', 'triangleAdvanced'];

/** Hosting a multiplayer room is the subscriber's; joining one is not. */
export const GENIUS_HOSTS_ROOMS = true;

/** True when this board is behind the subscription and the player is not. */
export function isLayoutLocked(cardId: string): boolean {
  return GENIUS_LAYOUTS.includes(cardId) && !isGenius();
}

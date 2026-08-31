/**
 * Where every board in the game gets its randomness.
 *
 * `shuffle` is the single source: all eight modes deal through it, and the
 * triangle boards' balanced deal (engine/orientationDeal.ts) does too. The
 * only other Math.random in the app scatters particles in engine/juice.ts,
 * which is decoration and touches nothing about the board.
 *
 * That single funnel is what makes a shared game possible. Seed this module
 * and every player's device deals the identical board — same colours in the
 * same slots, row for row — from nothing but a string agreed in advance. No
 * board is ever transmitted, and no client has to be trusted to report one
 * honestly, because each one builds it for itself and cannot build a
 * different one.
 *
 * What a seed does *not* fix is the palette: a player with 色盲友好 switched
 * on sees the Okabe–Ito colours rather than the standard ones. The deal is
 * a list of colour *indices*, and only the map from index to hex differs, so
 * two players are always looking at the same board — one of them just paints
 * it differently. That is exactly the intent: an accessibility setting is
 * personal and must not be forced by whoever opened the room.
 */

/** Math.random until a seed is installed; the seeded generator after. */
let source: () => number = Math.random;

/**
 * Hashes a seed string into a 32-bit state (xmur3), so a room code or any
 * other short string spreads over the whole range instead of leaving
 * neighbouring seeds producing neighbouring boards.
 */
function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** mulberry32 — small, fast, and good enough for dealing a board. */
function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deal from this seed until told otherwise. Called just before a shared run
 * is built and left in place for the whole run, so anything the board draws
 * for later is drawn from the same sequence on every device.
 */
export function seedRandom(seed: string): void {
  source = mulberry32(hashSeed(seed));
}

/** Back to a different board every time — every solo run. */
export function clearSeed(): void {
  source = Math.random;
}

export function isSeeded(): boolean {
  return source !== Math.random;
}

/** The raw stream, for anything that needs a number rather than an order. */
export function random(): number {
  return source();
}

export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(source() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

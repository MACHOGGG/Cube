import { get, set } from './_store.js';

/**
 * A counter per caller per window, for the one endpoint that needs it.
 *
 * Redeeming is the only place a stranger can guess at something valuable.
 * Six characters of a 32-letter alphabet is 1.07 billion, which sounds like
 * plenty until you notice that a script can try a few hundred a second and
 * that every hit is a free subscription. The space is what makes guessing
 * expensive; this is what stops anyone paying that price quickly.
 *
 * Deliberately coarse: one key per caller per window, no sliding window, no
 * token bucket. It costs one round trip, it cannot be tricked into using
 * memory, and being approximate at the edges of a window matters far less
 * than being simple enough to be obviously correct.
 */
export async function tooMany(bucket, id, limit, windowS) {
  const key = `rl:${bucket}:${id}:${Math.floor(Date.now() / (windowS * 1000))}`;
  const seen = Number((await get(key)) || 0) + 1;
  // The window's own key expires with it, so nothing accumulates.
  await set(key, seen, windowS + 60);
  return seen > limit;
}

/**
 * Who is asking, as well as a serverless function can know.
 *
 * x-forwarded-for is set by the platform's edge and is the closest thing to
 * a caller identity available here. It can be shared by a whole office or a
 * whole carrier, which is why the limits above are generous enough that a
 * real person redeeming a real code never meets them.
 */
export function callerId(req) {
  const fwd = req.headers['x-forwarded-for'];
  const first = String(fwd || '').split(',')[0].trim();
  return first || req.headers['x-real-ip'] || 'unknown';
}

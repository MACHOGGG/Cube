import { randomBytes, randomInt } from 'node:crypto';
import { send, readBody, creem, configured as creemConfigured, entitled } from './_creem.js';
import { codeHolder, loadAccount, normalizeEmail } from './_accounts.js';
import { expire, hdel, hgetall, hset, hsetnx, storeConfigured } from './_store.js';

/**
 * Multiplayer rooms: a four-digit code, two to four players, one board.
 *
 * Almost nothing here is real-time, and that is the design rather than a
 * shortcut. Three things could have needed a socket, and none of them does:
 *
 *   The board. Every player deals it themselves from one seed (see
 *   engine/rng.ts), so what crosses the wire is a short string, once. No
 *   board is transmitted and no client is trusted to report one - none of
 *   them could produce a different board even if it wanted to.
 *
 *   The countdown. The server names an instant, `startAt`, and every device
 *   counts down to it locally. Each reply also carries `serverNow`, so a
 *   client whose clock is off can correct for it. 3-2-1 then lands together
 *   without a single message being exchanged at the moment it matters.
 *
 *   The scoreboard. Scores are polled about once a second. A leaderboard
 *   that re-orders a second later reads as live; nobody can tell, and it
 *   costs no infrastructure at all.
 *
 * Rooms are a Redis hash with one field per player, never a single JSON
 * document: four phones report scores at the same moment, and a
 * read-modify-write of one blob would quietly drop most of those writes.
 */

const MAX_PLAYERS = 4;
const MIN_PLAYERS = 2;
const ROOM_TTL_S = 2 * 3600;
/** Long enough to read "3, 2, 1" without anyone feeling held up. */
const COUNTDOWN_MS = 3500;

/** The boards a host may choose. Anything else is not a mode we ship. */
const MODES = new Set([
  'square', 'circle', 'triangle',
  'squareDiamond', 'circleHex', 'circleSeven', 'triangleBig', 'triangleAdvanced',
]);
const AVATAR_SHAPES = new Set(['circle', 'triangle', 'square']);
/** Control characters, which a player's name has no business containing. */
const CTRL_RE = /[\u0000-\u001F\u007F]/g;

const roomKey = (code) => 'room:' + code;
const id = (bytes) => randomBytes(bytes).toString('hex');

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (!storeConfigured()) return send(res, 503, { error: 'notConfigured' });

  const body = readBody(req);
  try {
    switch (body.action) {
      case 'create': return await create(res, body);
      case 'join': return await join(res, body);
      case 'state': return await state(res, body);
      case 'start': return await start(res, body);
      case 'score': return await score(res, body);
      case 'leave': return await leave(res, body);
      default: return send(res, 400, { error: 'action' });
    }
  } catch {
    return send(res, 502, { error: 'upstream' });
  }
}

// ---- who may open a room ------------------------------------------------

/**
 * Opening a room is the subscriber's; joining one is free, so that a
 * subscriber can actually play with their friends rather than needing all of
 * them to buy a subscription before anyone has a game.
 *
 * Two of the three ways of being a subscriber can be checked here, and are:
 * a card subscription is confirmed with Creem, and a redeemed code against
 * the account's own sign-in token. The third - bought through the App Store
 * or Google Play - cannot be, because verifying those receipts needs Apple's
 * and Google's server APIs and the credentials that go with them. Until that
 * is wired up a store build's claim is taken at its word. What that risks is
 * somebody opening a game room without paying, which is worth stating
 * plainly and is not worth shutting out every honest store subscriber over.
 */
async function hostMayOpen({ email, accountToken, holderCode, storeClaim }) {
  const address = normalizeEmail(email);

  // A code redeemed but not yet attached to an address. What it granted lives
  // under the code, so that is where to look — asking for an email here would
  // turn "I have not finished signing up" into "you did not pay", which is
  // both wrong and the exact moment a player is least willing to hear it.
  if (holderCode && accountToken) {
    const held = await loadAccount(codeHolder(holderCode));
    if (held?.token && held.token === accountToken && (held.until || 0) > Date.now()) {
      return true;
    }
  }

  if (address && accountToken) {
    const account = await loadAccount(address);
    if (account?.token && account.token === accountToken && (account.until || 0) > Date.now()) {
      return true;
    }
  }

  if (address && creemConfigured()) {
    try {
      const customer = await creem('/v1/customers', { query: { email: address } });
      if (customer?.id) {
        const list = await creem(`/v1/customers/${encodeURIComponent(customer.id)}/subscriptions`, {
          query: { page_size: 50 },
        });
        if ((list?.items || []).some(entitled)) return true;
      }
    } catch {
      // A Creem outage should not stop a paid-up player opening a room.
      if (storeClaim) return true;
    }
  }

  return Boolean(storeClaim);
}

// ---- shaping what a player is told --------------------------------------

/** Twelve characters of the player's choosing, minus anything that would
 *  break the row it is drawn into. */
function cleanName(value) {
  return String(value ?? '').replace(CTRL_RE, '').trim().slice(0, 12);
}

function cleanAvatar(value) {
  const shape = AVATAR_SHAPES.has(value?.shape) ? value.shape : 'circle';
  const raw = Number(value?.hue);
  const hue = Number.isFinite(raw) ? ((raw % 360) + 360) % 360 : 0;
  return { shape, hue: Math.round(hue) };
}

/** Everything the room looks like - minus every player's private token. */
function publicState(code, hash) {
  const meta = hash.meta || {};
  const players = [];
  for (const [field, value] of Object.entries(hash)) {
    if (!field.startsWith('p:') || !value) continue;
    players.push({
      id: field.slice(2),
      name: value.name,
      avatar: value.avatar,
      score: value.score || 0,
      finished: Boolean(value.finished),
      isHost: field.slice(2) === meta.host,
    });
  }
  players.sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name)));
  return {
    code,
    host: meta.host ?? null,
    mode: meta.mode ?? null,
    seed: meta.seed ?? null,
    startAt: meta.startAt ?? null,
    players,
    // Lets a device with a wrong clock still count down to the same instant.
    serverNow: Date.now(),
  };
}

const readRoom = async (code) => {
  const hash = await hgetall(roomKey(code));
  return hash && hash.meta ? hash : null;
};

/** Checks that this really is the player it claims to be. */
function seatOf(hash, playerId, token) {
  const seat = hash['p:' + playerId];
  return seat && seat.token && seat.token === token ? seat : null;
}

const seatCount = (hash) => Object.keys(hash).filter((k) => k.startsWith('p:')).length;

// ---- the six things a room can be asked ---------------------------------

async function create(res, body) {
  if (!(await hostMayOpen(body))) return send(res, 403, { error: 'geniusOnly' });

  const playerId = id(8);
  const token = id(16);
  const meta = { host: playerId, createdAt: Date.now(), mode: null, seed: null, startAt: null };

  // Four digits is 10 000 rooms; at any plausible number of games running at
  // once a handful of tries finds a free one. HSETNX makes the claim atomic,
  // so two hosts cannot be handed the same code.
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = String(randomInt(0, 10000)).padStart(4, '0');
    if (!(await hsetnx(roomKey(code), 'meta', meta))) continue;
    await hset(roomKey(code), 'p:' + playerId, {
      token,
      name: cleanName(body.name) || 'Host',
      avatar: cleanAvatar(body.avatar),
      score: 0,
      finished: false,
      joinedAt: Date.now(),
    });
    await expire(roomKey(code), ROOM_TTL_S);
    return send(res, 200, {
      code,
      playerId,
      playerToken: token,
      state: publicState(code, await hgetall(roomKey(code))),
    });
  }
  return send(res, 503, { error: 'busy' });
}

async function join(res, body) {
  const code = String(body.code ?? '').trim();
  const hash = await readRoom(code);
  if (!hash) return send(res, 404, { error: 'noRoom' });
  if (hash.meta.startAt) return send(res, 409, { error: 'started' });
  if (seatCount(hash) >= MAX_PLAYERS) return send(res, 409, { error: 'full' });

  const playerId = id(8);
  const token = id(16);
  await hset(roomKey(code), 'p:' + playerId, {
    token,
    name: cleanName(body.name) || 'Player',
    avatar: cleanAvatar(body.avatar),
    score: 0,
    finished: false,
    joinedAt: Date.now(),
  });
  await expire(roomKey(code), ROOM_TTL_S);
  return send(res, 200, {
    playerId,
    playerToken: token,
    state: publicState(code, await hgetall(roomKey(code))),
  });
}

async function state(res, body) {
  const code = String(body.code ?? '').trim();
  const hash = await readRoom(code);
  if (!hash) return send(res, 404, { error: 'noRoom' });
  return send(res, 200, publicState(code, hash));
}

async function start(res, body) {
  const code = String(body.code ?? '').trim();
  const hash = await readRoom(code);
  if (!hash) return send(res, 404, { error: 'noRoom' });
  if (hash.meta.host !== body.playerId || !seatOf(hash, body.playerId, body.playerToken)) {
    return send(res, 403, { error: 'notHost' });
  }
  if (hash.meta.startAt) return send(res, 409, { error: 'started' });
  if (!MODES.has(body.mode)) return send(res, 400, { error: 'mode' });
  if (seatCount(hash) < MIN_PLAYERS) return send(res, 409, { error: 'tooFew' });

  const meta = {
    ...hash.meta,
    mode: body.mode,
    // The one string from which every player builds the identical board.
    seed: id(8),
    startAt: Date.now() + COUNTDOWN_MS,
  };
  await hset(roomKey(code), 'meta', meta);
  await expire(roomKey(code), ROOM_TTL_S);
  return send(res, 200, publicState(code, { ...hash, meta }));
}

async function score(res, body) {
  const code = String(body.code ?? '').trim();
  const hash = await readRoom(code);
  if (!hash) return send(res, 404, { error: 'noRoom' });
  const seat = seatOf(hash, body.playerId, body.playerToken);
  if (!seat) return send(res, 403, { error: 'notInRoom' });

  seat.score = Math.max(0, Math.floor(Number(body.score) || 0));
  seat.finished = Boolean(body.finished);
  seat.lastSeen = Date.now();
  // Only this player's own field is written, so four reports arriving at
  // once cannot overwrite one another.
  await hset(roomKey(code), 'p:' + body.playerId, seat);
  return send(res, 200, publicState(code, { ...hash, ['p:' + body.playerId]: seat }));
}

async function leave(res, body) {
  const code = String(body.code ?? '').trim();
  const hash = await readRoom(code);
  if (!hash) return send(res, 200, { ok: true });
  if (seatOf(hash, body.playerId, body.playerToken)) {
    await hdel(roomKey(code), 'p:' + body.playerId);
  }
  return send(res, 200, { ok: true });
}

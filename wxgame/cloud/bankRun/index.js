/**
 * 记一局：客户端报「玩法、种子、得分、步数、用时」，这里做合理性检查，通过才累计到
 * 这个 openid 的账上。得分只能从这条路进账——客户端没有直接写 players 的权限。
 *
 * 检查是粗的，挡的是「改个数字就发」这一类，不是防高手：
 *   · 玩法必须是清单里的；
 *   · 得分不能超过这个玩法的上限（按网页版实测的高分留了余量）；
 *   · 用时太短（不到 10 秒）的一局不算——真人滑不出来；
 *   · 每个 openid 每小时最多记 60 局。
 *
 * 草案：还没在云开发里部署过。
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

/** 每个玩法一局最多能记多少综合得分。宽一点，宁可漏过一两局怪分，别错杀真的高分。 */
const MAX_SCORE = {
  square: 4000,
  circle: 4000,
  triangle: 4000,
  slot: 4000,
  flip: 3000,
};
const MIN_SECONDS = 10;
const RUNS_PER_HOUR = 60;

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, reason: 'noUser' };
  const mode = String(event.mode || '');
  const score = Math.floor(Number(event.score));
  const seconds = Math.round(Number(event.seconds));
  const moves = Math.floor(Number(event.moves));
  if (!(mode in MAX_SCORE)) return { ok: false, reason: 'mode' };
  if (!Number.isFinite(score) || score < 0 || score > MAX_SCORE[mode]) return { ok: false, reason: 'score' };
  if (!Number.isFinite(seconds) || seconds < MIN_SECONDS) return { ok: false, reason: 'seconds' };
  if (!Number.isFinite(moves) || moves < 1) return { ok: false, reason: 'moves' };

  const now = Date.now();
  const recent = await db
    .collection('runs')
    .where({ openid: OPENID, at: _.gt(now - 3600 * 1000) })
    .count();
  if (recent.total >= RUNS_PER_HOUR) return { ok: false, reason: 'tooMany' };

  await db.collection('runs').add({
    data: { openid: OPENID, mode, seed: String(event.seed || ''), score, moves, seconds, at: now },
  });
  // 有账就加，没账就开：两步各自幂等，重复调用不会开出两本账。
  const players = db.collection('players');
  const updated = await players.doc(OPENID).update({
    data: { total: _.inc(score), runs: _.inc(1), updatedAt: now },
  });
  if (!updated.stats || updated.stats.updated === 0) {
    await players.add({
      data: { _id: OPENID, total: score, spent: 0, runs: 1, lifeRedeemed: false, updatedAt: now },
    });
  }
  const me = await players.doc(OPENID).get();
  const p = me.data || { total: score, spent: 0 };
  return { ok: true, total: p.total, balance: p.total - (p.spent || 0) };
};

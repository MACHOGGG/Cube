/**
 * 换码：累计得分够了，换一张正规版（网页 / App）的《Slides 天才内部码》。
 *
 *   1 万分 → 1 个月（month）　2 万 → 半年（half）　3 万 → 1 年（year）　4 万 → 终身（life）
 *
 * 顺序是「先扣分、再取码、取不到退回」：扣分那一步带条件（余额够才扣），云数据库
 * 的 update 是原子的，两个请求同时来也只有一个扣得到。码从现有的 /api/mint 取
 * （网页版那套内部码，plan 同名），ADMIN_TOKEN 只在云函数的环境变量里。
 *
 * 草案：还没在云开发里部署过。
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const TIERS = {
  month: { points: 10000, plan: 'month' },
  half: { points: 20000, plan: 'half' },
  year: { points: 30000, plan: 'year' },
  life: { points: 40000, plan: 'life' },
};

async function mintOne(plan) {
  const url = process.env.MINT_URL || 'https://play-slides.com/api/mint';
  const token = process.env.ADMIN_TOKEN;
  if (!token) throw new Error('ADMIN_TOKEN 没有配在云函数的环境变量里');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, plan, count: 1 }),
  });
  if (!res.ok) throw new Error('mint ' + res.status);
  const body = await res.json();
  const code = body && Array.isArray(body.codes) ? body.codes[0] : null;
  if (!code) throw new Error('mint 没有返回码');
  return code;
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, reason: 'noUser' };
  const tier = TIERS[String(event.tier || '')];
  if (!tier) return { ok: false, reason: 'tier' };

  const players = db.collection('players');
  const me = await players.doc(OPENID).get().catch(() => ({ data: null }));
  const p = me.data;
  if (!p) return { ok: false, reason: 'noScore' };
  if (tier.plan === 'life' && p.lifeRedeemed) return { ok: false, reason: 'lifeOnce' };
  const balance = (p.total || 0) - (p.spent || 0);
  if (balance < tier.points) return { ok: false, reason: 'notEnough', balance, need: tier.points };

  // 先扣分：带条件的原子更新。余额在这一刻不够（另一次兑换刚扣过）就一分不扣。
  const took = await players.where({ _id: OPENID, total: _.gte((p.spent || 0) + tier.points) }).update({
    data: {
      spent: _.inc(tier.points),
      ...(tier.plan === 'life' ? { lifeRedeemed: true } : {}),
      updatedAt: Date.now(),
    },
  });
  if (!took.stats || took.stats.updated === 0) return { ok: false, reason: 'notEnough' };

  let code;
  try {
    code = await mintOne(tier.plan);
  } catch (err) {
    // 取不到码：把分退回去，和网页版「码烧掉却没到账就放回去」同一个原则。
    await players.doc(OPENID).update({
      data: { spent: _.inc(-tier.points), ...(tier.plan === 'life' ? { lifeRedeemed: false } : {}) },
    });
    return { ok: false, reason: 'mint', detail: String(err && err.message) };
  }

  await db.collection('redemptions').add({
    data: { openid: OPENID, tier: String(event.tier), points: tier.points, plan: tier.plan, code, at: Date.now() },
  });
  return { ok: true, code, plan: tier.plan, balance: balance - tier.points };
};

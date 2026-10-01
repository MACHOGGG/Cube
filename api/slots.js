/**
 * 「还剩几个名额」——注册引导那一行印的那个数。
 *
 * 玩家 2026-10 把 Creem 的两个订阅商品暂时关掉，改成「注册即解锁全部功能」，第一批放
 * 100 个名额（E11 / PR-12）。那一行字要是实话，这个数就得从服务端真的数出来，而不是前端
 * 写死一个。
 *
 * ── 为什么单开一个接口 ────────────────────────────────────────
 *
 * 这个数**没登录的人也要看得到**——它就印在注册引导那一屏上，而那一屏正是给还没有账号的
 * 人看的。`api/subscription.js` 那条路要先证明身份，天然答不了这一问。
 *
 * 它也只回这一件事：开不开、还剩几个、一共几个。不碰账号、不碰权益、不认人。
 *
 * ── 答不出来的时候说「没开」，不说「还剩很多」 ────────────────
 *
 * 窗口没开（`GENIUS_GRANT_WINDOW` 没填）、或者根本没有库可数（没配 Redis 也没开内存
 * 兜底）时，回的是 `{ open: false }`，**一个数都不给**。界面那头就只摆一句中性的「订阅
 * 目前不开放」，不摆任何承诺。
 *
 * 这一条是故意的：没有它，界面就得自己猜——而「猜着写一句承诺」正是这个仓库躲着的那种
 * 事。服务端说得出才说，说不出就不说。
 */
import { send } from './_creem.js';
import { storeConfigured } from './_store.js';
import { GENIUS_GRANT_LIMIT, grantWindowOpen, slotsLeft } from './_entitlement.js';

export default async function handler(req, res) {
  if (req.method && req.method !== 'GET') return send(res, 405, { error: 'method' });
  // 两种「说不出」：开关没开，和没有库可数。对界面是同一件事。
  if (!grantWindowOpen() || !storeConfigured()) return send(res, 200, { open: false });
  try {
    const left = await slotsLeft();
    // `open` 问的是「现在还注册得到吗」，不是「开关开没开」：名额满了就是注册不到了，
    // 界面那头照这一位决定摆不摆那句承诺。
    return send(res, 200, { open: left > 0, left, total: GENIUS_GRANT_LIMIT() });
  } catch {
    // 库一时读不到：同样说「没开」，而不是蒙一个数。宁可少说一句，不要说错一句。
    return send(res, 200, { open: false });
  }
}

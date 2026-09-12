import { bump } from './_store.js';

/**
 * A counter per caller per window, for every door a stranger can knock on.
 *
 * Redeeming is the loudest example: six characters of a 32-letter alphabet is
 * 1.07 billion, which sounds like plenty until you notice that a script can
 * try a few hundred a second and that every hit is a free subscription. The
 * space is what makes guessing expensive; this is what stops anyone paying
 * that price quickly. The same counter guards the admin token, the login
 * password and the change-of-address code.
 *
 * ── 为什么是 bump 而不是「读一次、加一、写回去」 ────────────────────
 *
 * 原先这里是三步：GET 拿到现在几次、加一、SET 写回去。一个一个发请求时它是
 * 对的，同时发就是一道假门——三步之间隔着两次网络往返，同一瞬间打进来的几十
 * 个请求会读到同一个旧值，于是整整一批只被记成一次。实测：同一个 IP 并发打
 * 200 次，本该 20 次/小时的上限一次都没拦住；改成一个一个发才挡下 180 次。
 *
 * 这件事在这个仓库里已经咬过两回（猜解锁码、猜密码），两回都是换成 bump()
 * 收的场，可是限速这一处一直留着旧写法，于是兑换码、发码后台令牌、登录密码
 * 这几道最值钱的门全都虚掩着。
 *
 * INCR 是 Redis 自己那一步：加一，返回新值。每个请求各拿一个属于自己的号，
 * 超号的当场退回，比对根本轮不上。
 *
 * 其余仍然刻意粗糙：一个键一个窗口，不做滑动窗口、不做令牌桶。一次往返，
 * 骗不到内存，窗口边缘上算得毛一点，远不如「简单到一眼看得出对不对」要紧。
 */
export async function tooMany(bucket, id, limit, windowS) {
  const key = `rl:${bucket}:${id}:${Math.floor(Date.now() / (windowS * 1000))}`;
  // The window's own key expires with it, so nothing accumulates.
  return (await bump(key, windowS + 60)) > limit;
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
  // headers 一定有——除非是测试里那份手搭的 req。少一层判断就少一处会炸的地方。
  const headers = req?.headers || {};
  const fwd = headers['x-forwarded-for'];
  const first = String(fwd || '').split(',')[0].trim();
  return first || headers['x-real-ip'] || 'unknown';
}

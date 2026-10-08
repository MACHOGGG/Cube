import { bump, get } from './_store.js';

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
  // The window's own key expires with it, so nothing accumulates.
  return (await bump(windowKey(bucket, id, windowS), windowS + 60)) > limit;
}

/** 三个函数共用的那个键：一个桶、一个身份、一个窗口。 */
const windowKey = (bucket, id, windowS) => `rl:${bucket}:${id}:${Math.floor(Date.now() / (windowS * 1000))}`;

/**
 * 「查」和「记」拆成两步的那一种：先 `atLimit` 只看不记，事情真的做成了再 `countHit` 记
 * 一笔。和 `tooMany` 记的是同一个键，所以同一个桶不要两种写法混着用。
 *
 * 只给「失败不该算钱」的那种额度用（2026-10-08 方案 1-2：signin 的 `signin:toAll` 只数真的
 * 寄出去的信——Resend 那头挂了、信一封没出去，不该把这个邮箱一小时的额度也一起烧掉）。
 *
 * ⚠️ 代价照实写：查和记之间隔着一次发信，同一瞬间打进来的几个请求会一起看到「还没到」，
 * 于是这一窗口可能多放过几次——正是 `tooMany` 文件头那段说的「假门」，只是这儿是有意的、
 * 而且只多放过「同时在飞的那几封」。真正挡人的那几道（按来路、按「邮箱 + 来路」）照旧用
 * `tooMany`，一步做完。
 */
export async function atLimit(bucket, id, limit, windowS) {
  return (Number(await get(windowKey(bucket, id, windowS))) || 0) >= limit;
}
/** 记一笔（见 atLimit）。 */
export async function countHit(bucket, id, windowS) {
  await bump(windowKey(bucket, id, windowS), windowS + 60);
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
  // x-vercel-forwarded-for 排在前面，理由不是「今天更安全」，而是「将来还安全」。
  //
  // 今天两个头的内容是一样的，而且 `split(',')[0]` 拿到的就是真实 IP：Vercel 的
  // 边缘**覆写**这个头、不转发外部传进来的值，正是为了防 IP 伪造（企业版客户才
  // 能申请让它信任自己传的那一份）。所以客户端自己塞一个
  // `X-Forwarded-For: 1.2.3.4` 换不掉自己的桶。
  //
  // 会变的是那个前提：**Vercel 前面没有别的代理**。哪天为了加速或防护在前面挂
  // 一层 CDN，x-forwarded-for 就可能被那一层改写，而 x-vercel-forwarded-for 是
  // 边缘自己写的、始终作数。这一行现在换掉，是因为真到那天没人会想起来回头改
  // 这里——而那时全站的限速会一起变成摆设。
  //
  // 顺带记一句：**不要**改成「取最后一段」。那是给「代理把真实 IP 追加在末尾」
  // 那种模型写的，Vercel 是覆写模型，末尾可能是它自己的内部跳数，改了会把所有
  // 人归进同一个桶——比不限速更糟，因为它看起来还在工作。
  const fwd = headers['x-vercel-forwarded-for'] || headers['x-forwarded-for'];
  const first = String(fwd || '').split(',')[0].trim();
  return bucketOf(first) || bucketOf(String(headers['x-real-ip'] ?? '')) || 'unknown';
}

/**
 * 一个人一个桶——而 IPv6 下「一个地址」不等于「一个人」。
 *
 * ── 原先是什么样 ──────────────────────────────────────────────
 *
 * 上面那一行直接把拿到的字符串当桶名。IPv4 时代这是对的：一条宽带一个地址，换地址
 * 要么重拨要么买代理，都有成本，所以「一小时 10 次」真的是一小时 10 次。
 *
 * IPv6 下这个前提整个没了。家宽标配分到的是一整个 /64 网段（18446744073709551616 个地
 * 址），而且是**自己随便用**的：换一个源地址不用重拨、不用代理、不花一分钱，一行
 * `ip -6 addr add` 就是一个全新的桶。于是「注册一小时 10 个」变成「一小时想开多少
 * 个开多少个」，兑换码那道 `tooMany` 也一样——而那两道正是这个仓库里最值钱的门。
 *
 * 这不是理论上的：Vercel 的边缘默认就给 IPv6 客户端写 IPv6 的 `x-forwarded-for`，
 * 所以今天任何一个 IPv6 玩家本来就落在一个独占的桶里。限速那一侧看着在工作（日志
 * 里确实有 `rl:signup:2001:...` 这种键在涨），只是永远拦不住人——又一次假绿。
 *
 * ── 收到 /64，不是 /48、不是 /128 ────────────────────────────
 *
 * /64 是「一个家、一个手机的蜂窝连接」这个级别的分配单位，也是 RFC 要求的最小
 * 分配。往粗收（/48、/32）会把整个小区、整家运营商归进一个桶，那是另一个方向的
 * 错——上面写过，「把所有人归进同一个桶比不限速更糟，因为它看起来还在工作」。
 *
 * 顺带收掉三种写法上的坑，三种都真的会从头里出来：
 *
 *   · `[2001:db8::1]:443` —— 带方括号和端口。不剥的话端口号成了桶名的一部分，
 *     每次连接一个新桶。
 *   · `::ffff:1.2.3.4` —— IPv4 映射地址。同一个人可能这一次被写成映射形式、下一
 *     次被写成 `1.2.3.4`，两个桶。拆回 IPv4 才归得到一处。
 *   · `fe80::1%eth0` —— 带 zone。只会出现在内网/本机调试，但它同样会把一个人拆成
 *     两个桶（有 zone 和没 zone）。
 *
 * 认不出来的东西**原样返回**，不丢掉：`unknown`（本地起服务器、测试里手搭的 req）
 * 照旧落在同一个桶里，这正是我们要的——让门在本地也真的能拦住。
 */
function bucketOf(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return '';
  // `[addr]` 或 `[addr]:port`
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
  if (bracket) s = bracket[1];
  // zone（`%eth0`）不参与身份。
  const pct = s.indexOf('%');
  if (pct >= 0) s = s.slice(0, pct);
  // `1.2.3.4:443`：只有一个冒号、而且前半是 IPv4，才当成「带端口的 IPv4」。
  // IPv6 至少两个冒号，所以这一条不会误伤它。
  const one = s.indexOf(':');
  if (one >= 0 && s.indexOf(':', one + 1) < 0 && IPV4_RE.test(s.slice(0, one))) {
    return s.slice(0, one);
  }
  if (s.indexOf(':') < 0) return s; // IPv4 或者认不出来的东西，原样。
  const groups = expand6(s);
  if (!groups) return s; // 看着像 IPv6 但解不开——原样，别悄悄归并。
  // `::ffff:a.b.c.d` 这一族（前 80 位 0、第 6 组 ffff）拆回 IPv4。
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const [a, b] = [groups[6], groups[7]];
    return [a >> 8, a & 255, b >> 8, b & 255].join('.');
  }
  // 收到 /64：只留前四组，后面写死 ::，这样桶名一眼看得出是个网段不是个地址。
  return groups.slice(0, 4).map((g) => g.toString(16)).join(':') + '::/64';
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** IPv6 → 八个数（0…65535）。解不开回 null，绝不猜。 */
function expand6(text) {
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : null;
  const parts = tail === null ? head : [...head, ...tail];
  // 末尾可以是一个 IPv4（`::ffff:1.2.3.4`，也包括 `2001:db8::1.2.3.4` 这种少见写法），
  // 它顶两组。
  const last = parts[parts.length - 1];
  const dotted = last && IPV4_RE.exec(last);
  let extra = [];
  if (dotted) {
    const n = dotted.slice(1).map(Number);
    if (n.some((x) => x > 255)) return null;
    extra = [(n[0] << 8) | n[1], (n[2] << 8) | n[3]];
    if (tail === null) head.pop();
    else tail.pop();
  }
  const fixed = tail === null ? [...head, ...extra] : null;
  const groups =
    fixed ??
    (() => {
      const fill = 8 - head.length - tail.length - extra.length;
      if (fill < 0) return null;
      return [...head, ...Array(fill).fill('0'), ...tail, ...extra];
    })();
  if (!groups || groups.length !== 8) return null;
  const out = [];
  for (const g of groups) {
    if (typeof g === 'number') {
      out.push(g);
      continue;
    }
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

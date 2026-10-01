/**
 * 「还剩几个名额」——注册引导那一屏印的那个数，从服务端问来。
 *
 * 玩家 2026-10：Creem 的两个订阅商品暂时关掉，改成「注册即解锁全部功能」，第一批 100 个
 * 名额，**「满了就不再送」**（E11 / PR-12）。服务端那一头是 `api/_entitlement.js` 的原子
 * 计数器，这一头只负责问一声、把答案摆出来。
 *
 * ── 两条规矩 ────────────────────────────────────────────────────
 *
 * **① 问不到就什么都不说。** 服务端答 `{ open: false }`（窗口没开、没有库可数、或者一时
 * 读不到）时，这儿回 `null`，界面那头就只摆一句中性的「订阅目前不开放」，**不摆任何承
 * 诺**。界面自己不猜：说得出才说，说不出就不说。这一条也顺带解决了上线顺序——
 * `GENIUS_GRANT_WINDOW` 填上之前，那句承诺根本不会出现。
 *
 * **② 一次会话只问一次。** 这个数变得不快（一个人注册才减一），而订阅窗可能被反复点开。
 * 问一次存着，省掉每次点开都打一趟服务器。真要看最新的，刷新页面。
 */

export interface GeniusSlots {
  /** 现在还注册得到吗（名额满了就是 false，哪怕窗口还开着）。 */
  open: boolean;
  /** 还剩几个。 */
  left: number;
  /** 一共几个。 */
  total: number;
}

let cached: GeniusSlots | null | undefined;

/**
 * 问一次服务端。问不到、或者服务端说不出，一律回 `null`。
 *
 * 不抛：这一问失败不该拦住订阅窗打开——窗照开，只是少那一行字。
 */
export async function geniusSlots(): Promise<GeniusSlots | null> {
  if (cached !== undefined) return cached;
  try {
    const res = await fetch('/api/slots', { headers: { accept: 'application/json' } });
    if (!res.ok) return (cached = null);
    const body = (await res.json()) as Partial<GeniusSlots>;
    // 三位都得是像样的数才算数。缺一位就当没问到——半份答案拼出来的那一行字，
    // 比没有那一行更糟。
    if (!body || body.open !== true) return (cached = null);
    const left = Number(body.left);
    const total = Number(body.total);
    if (!Number.isFinite(left) || !Number.isFinite(total) || left <= 0 || total <= 0) {
      return (cached = null);
    }
    return (cached = { open: true, left: Math.floor(left), total: Math.floor(total) });
  } catch {
    return (cached = null);
  }
}

/** 只给门用：把缓存清掉，好在同一个页面里验第二种答复。 */
export function resetGeniusSlotsCache(): void {
  cached = undefined;
}

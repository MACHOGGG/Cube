/**
 * Google Analytics 用不用：玩家自己说了算（10-11 方案 A-14）。
 *
 * GA4 会在这台设备上写两个 Cookie（`_ga`、`_ga_<编号>`，各活两年），按 CNIL 的规定，这一类追踪器必
 * 须**先问、问到了才用**；「继续浏览」不算同意，「拒绝」得和「接受」一样容易。原先它开机就加载、一句
 * 都不问。现在：
 *
 *   · 本机记一份答复 `slides_consent_ga = { v: 'granted' | 'denied', at: 毫秒 }`。记下「他同意了没有」
 *     本身属于必要存储，不用再为它问一次；
 *   · **只有答复是「接受」、而且还没过期**，analytics.ts 才加载 GA；
 *   · 拒绝之后六个月内不再问，接受之后两年（和那两个 Cookie 一样长）再问一次；过了期就当没答过——
 *     主菜单上那张同意条重新出现，GA 也不加载，直到他再点一次「接受」；
 *   · 不理它：什么都不写，GA 不加载，游戏照常玩，下一次回到主菜单再出现。
 *
 * Vercel 那一路不写 Cookie，不受这一条管（analytics.ts 文件头）。
 */

/** 本机记答复的那个键。 */
export const CONSENT_KEY = 'slides_consent_ga';

export type ConsentChoice = 'granted' | 'denied';

const DAY = 86_400_000;
/** 拒绝之后多久不再问：六个月。 */
export const DENIED_TTL_MS = 183 * DAY;
/** 接受之后多久再问一次：两年——和 `_ga` 那两个 Cookie 的寿命一样。 */
export const GRANTED_TTL_MS = 730 * DAY;

/**
 * 他此刻的答复：接受 / 拒绝；没答过、记录坏了、或者已经过期，都是 null（等于还没问过）。
 * 存储用不了（无痕窗口把 localStorage 关了）也是 null：问不住答复，就每次都当没答过——GA 照样不加载。
 */
export function consentChoice(now: number = Date.now()): ConsentChoice | null {
  try {
    const raw = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null') as { v?: unknown; at?: unknown } | null;
    if (!raw || (raw.v !== 'granted' && raw.v !== 'denied')) return null;
    const at = Number(raw.at);
    if (!Number.isFinite(at)) return null;
    const ttl = raw.v === 'granted' ? GRANTED_TTL_MS : DENIED_TTL_MS;
    return now - at < ttl ? raw.v : null;
  } catch {
    return null;
  }
}

/** 记下他的答复（接受、拒绝、在隐私政策那扇窗里拨开关都走这儿）。 */
export function recordConsent(v: ConsentChoice, now: number = Date.now()): void {
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ v, at: now }));
  } catch {
    /* 记不住：下一次回到主菜单还会再问一遍——宁可多问，不可替他答。 */
  }
}

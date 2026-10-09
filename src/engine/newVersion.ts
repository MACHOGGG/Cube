/**
 * 「线上已经是新的一版了」——问得出来，但永远不自己刷新。
 *
 * ── 为什么要有这件事 ────────────────────────────────────────────
 *
 * 这是个单页应用：进来之后就不再整页跳转（换语言、换页面全是原地重画）。一台开着不关的
 * 手机——锁屏放进口袋、第二天再划开——跑的还是**上一次打开时下载的那一份**。症状不是白
 * 屏：是他手里那一版和服务端已经对不上（接口回的字段换了、法务文本改了、存档键跟着规则
 * 版本走了），而屏幕上什么都不说。
 *
 * ── 三条规矩，一条都不许破 ──────────────────────────────────────
 *
 * ① **绝不自己刷新。** 刷新会把这一局连同还没交卷的分数一起扔掉——那是「意料之外的疏漏操
 *    作」里最贵的一种。发现新版本只做一件事：让界面有机会说一句话，按不按在玩家。
 * ② **对局中一个字都不说。** 说了他就会去按，而按下去正是①要避免的那件事。这个模块只负
 *    责「发现」，说不说、什么时候说由调用方决定（`ui/newVersionPill.ts`：那一行长在主菜单
 *    那块招牌玻璃里，打一局的时候屏幕上没有主菜单，于是它根本不存在）。
 * ③ **读不到就当没有新版本。** 断网、离线、`/version.json` 404（比如自建部署没跑那一步构
 *    建脚本）——这些都不该让屏幕上冒出一句话来。错在「不说」那一边，不在「乱说」那一边。
 *
 * ── 怎么问 ─────────────────────────────────────────────────────
 *
 * 问的是构建时写下的 `/version.json`（见 scripts/build-version.mjs），里头是这一版的提交
 * 号。`vercel.json` 给这个路径配了 `no-store`，再加上请求本身也带 `cache: 'no-store'`：
 * 两头都要，缺一头都可能让这一问永远拿到同一个旧答案（而「永远没有新版本」和「这件事做
 * 好了」在屏幕上一模一样）。
 *
 * 问的时机只有两个：**切回这个标签页的时候**（那正是「放了一夜再划开」那一刻），和每
 * `EVERY_MS` 一次。不做轮询之外的事——没有 service worker、没有 WebSocket：这件事值当的投
 * 入就是一张 JSON。
 */
import { fetchWithTimeout } from './fetchTimeout';

const URL_PATH = '/version.json';
/** 十分钟一次。这一问便宜（一张几十字节的 JSON），但它也只值这么密。 */
const EVERY_MS = 10 * 60 * 1000;

/** 这一次打开时线上是哪一版。问不到就是 null——那时候整条按「没有新版本」走。 */
let mine: string | null = null;
/** 已经发现过新版本：不再问，也不再喊第二遍。 */
let found = false;
let timer = 0;

async function askOnce(): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(URL_PATH, { cache: 'no-store' });
    if (!res.ok) return null;
    const said: unknown = await res.json();
    const sha = (said as { sha?: unknown })?.sha;
    return typeof sha === 'string' && sha ? sha : null;
  } catch {
    // 断网、离线、JSON 坏了——一律当没问到（规矩③）。
    return null;
  }
}

/**
 * 开始盯着线上那一版。发现新的就叫一次 `onNew`，然后不再问。
 *
 * `onNew` 只是「可以说了」，不是「去刷新」：说不说、什么时候说由调用方决定（规矩②）。
 */
export function watchVersion(onNew: () => void): void {
  const check = async () => {
    if (found) return;
    const now = await askOnce();
    if (!now) return;
    if (mine === null) {
      // 第一次问到：记下这一版是哪一版，这就是往后比对的基准。
      mine = now;
      return;
    }
    if (now === mine) return;
    found = true;
    window.clearInterval(timer);
    onNew();
  };
  void check();
  timer = window.setInterval(check, EVERY_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check();
  });
}

/** 给门用：这一次打开时记下的那个版本号（还没问到就是 null）。 */
export const seenVersion = (): string | null => mine;

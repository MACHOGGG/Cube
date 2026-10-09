/**
 * 带超时的 fetch（10-09 补充方案 7-13 第 13 条）。前端的每一个请求都走这儿——门
 * scripts/check-fetch-timeout.mjs 不许 src/ 里别处再写裸的 fetch(。
 *
 * fetch 自己没有超时。网络卡在半路（电梯里、地铁换乘、Wi-Fi 的认证页挡着）的时候，请求既不成功也
 * 不失败，能挂好几分钟：那颗键一直转、「处理中…」一直挂着，小屋的轮询停在那一下不再往下走，玩家
 * 不知道该等还是该重来。现在默认 15 秒没回音就放弃，抛一个和「网断了」同一类的错（TypeError，
 * fetch 断网时抛的就是它）——调用的地方原来怎么接断网就怎么接它，一行不用改。
 *
 * 量的是「等到回包头」：回包头到了、正文还在路上的那一段不算（几十字节的 JSON，真卡在那一段的
 * 少见；要算的话每个调用处都得把读正文包进来，换来的东西不值这个改动）。
 *
 * 两样老内核的事（小红书那一端是 Chrome 61——虽然它不联网、不会打进这个模块，网页端也还有老手机）：
 *   · 不用 `AbortSignal.timeout()`：Chrome 103 才有。
 *   · `AbortController` 也不是哪儿都有（Chrome 66）：没有的话请求本身停不下来，只是不再等它——
 *     回来了也没人接，对玩家是同一件事。也不用 Promise 的 finally（Chrome 63）。
 */

/** 默认等多久。 */
export const FETCH_TIMEOUT_MS = 15_000;

export function fetchWithTimeout(input: string, init: RequestInit = {}, ms = FETCH_TIMEOUT_MS): Promise<Response> {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  return new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => {
      ctl?.abort();
      reject(new TypeError('timeout'));
    }, ms);
    fetch(input, ctl ? { ...init, signal: ctl.signal } : init).then(
      (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * 带超时的 fetch（10-09 补充方案 7-13 第 13 条）。前端的每一个请求都走这儿——门
 * scripts/check-fetch-timeout.mjs 不许 src/ 里别处再写裸的 fetch(。
 *
 * fetch 自己没有超时。网络卡在半路（电梯里、地铁换乘、Wi-Fi 的认证页挡着）的时候，请求既不成功也
 * 不失败，能挂好几分钟：那颗键一直转、「处理中…」一直挂着，小屋的轮询停在那一下不再往下走，玩家
 * 不知道该等还是该重来。现在默认 15 秒没回音就放弃，抛一个和「网断了」同一类的错（TypeError，
 * fetch 断网时抛的就是它）——调用的地方原来怎么接断网就怎么接它，一行不用改。
 *
 * **量的是「整份回包到手」：回包头、连同正文**（10-11 方案 A-13）。原先拿到回包头就把计时器清了，正
 * 文那一段不算——当时的理由是「几十字节的 JSON，真卡在那一段的少见；要算的话每个调用处都得把读正
 * 文包进来」。可它真会卡：头到了、正文不来的时候，调用处那一句 `await res.json()` 永远等不到，小屋的
 * 轮询（engine/room.ts 的 post）就停在那一下，再也不往下走，屏幕上什么都不报。现在正文在这儿、在同
 * 一个钟里读完，交出去的是一份已经读好的 Response（状态、状态行、回包头原样——dailyClock 要读
 * `Date` 那个头），调用处照旧 `res.json()`，一行不用改。前端这几处的回包全是几十到几百字节的 JSON，
 * 先读进内存不花什么。
 *
 * 两样老内核的事（小红书那一端是 Chrome 61——虽然它不联网、不会打进这个模块，网页端也还有老手机）：
 *   · 不用 `AbortSignal.timeout()`：Chrome 103 才有。计时还是那一个 setTimeout，谁先到算谁的（等于
 *     Promise.race，只是不多造一个 Promise）。
 *   · `AbortController` 也不是哪儿都有（Chrome 66）：没有的话请求本身停不下来，只是不再等它——
 *     回来了也没人接，对玩家是同一件事。也不用 Promise 的 finally（Chrome 63）。
 */

/** 默认等多久。 */
export const FETCH_TIMEOUT_MS = 15_000;

export function fetchWithTimeout(input: string, init: RequestInit = {}, ms = FETCH_TIMEOUT_MS): Promise<Response> {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  return new Promise<Response>((resolve, reject) => {
    // 计时器、回包、出错三条路，只认先到的那一条：到点之后正文才慢吞吞地来，不能再交出去一次。
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ctl?.abort();
      reject(new TypeError('timeout'));
    }, ms);
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    };
    // 一条链走到底：请求出错、读正文出错（连 `text` 都没有的那种）都落到同一个 fail 上。
    fetch(input, ctl ? { ...init, signal: ctl.signal } : init)
      .then((res) => res.text().then((text): [Response, string] => [res, text]))
      .then(([res, text]) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // 装回去那一步要是抛了（状态码不合 Response 的规矩之类），得把它交出去——计时器已经清了，
        // 不接住的话这个 Promise 就永远悬着，正是这个文件要治的那个病。
        try {
          resolve(readAlready(res, text));
        } catch (err) {
          reject(err);
        }
      }, fail);
  });
}

/**
 * 把读好的正文装回一份 Response：状态、状态行、回包头原样。
 *
 * 204 / 205 / 304 这几种状态按规矩不许带正文（`new Response('', { status: 204 })` 会抛），空正文也一
 * 样当「没有」（HEAD 那一问就是这样）。
 */
function readAlready(res: Response, text: string): Response {
  const noBody = text === '' || res.status === 204 || res.status === 205 || res.status === 304;
  return new Response(noBody ? null : text, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

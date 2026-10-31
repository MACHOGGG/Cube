/**
 * 全局错误记录（10-31 方案推01 Z-A01 ④）。
 *
 * 原先全 src/ 没有一处 `window.addEventListener('error')` / `unhandledrejection`：线上哪一句抛了错，没有
 * 任何痕迹。站长报「消完了不结算」时，连「是不是抛了错、抛在哪」都问不出来。现在两类各记**一次**
 * `console.error('[slides:error]', 首行)`——只记首行、只记一次，免得一个每帧都抛的错把控制台刷满；
 * 真机上连着 Safari 网页检查器就能看到。不上报（统计里只有结尾兜底那一条 `end_guard`，见 analytics.ts）。
 *
 * 网页入口（src/main.ts）和小红书入口（xhs/src/main.ts）开机第一件事各调一次。
 */
const firstLine = (x: unknown): string => {
  try {
    const t = x instanceof Error ? x.message || x.name : String(x);
    return t.split('\n')[0].slice(0, 300);
  } catch {
    return '?';
  }
};

let armed = false;

export function armErrorLog(): void {
  if (armed) return;
  armed = true;
  let sawError = false;
  let sawRejection = false;
  try {
    window.addEventListener('error', (e: ErrorEvent) => {
      if (sawError) return;
      sawError = true;
      try { console.error('[slides:error]', firstLine(e.error ?? e.message)); } catch { /* 没有 console 就算了 */ }
    });
    window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
      if (sawRejection) return;
      sawRejection = true;
      try { console.error('[slides:error]', firstLine(e.reason)); } catch { /* 同上 */ }
    });
  } catch {
    /* 连 addEventListener 都没有的环境：不记 */
  }
}

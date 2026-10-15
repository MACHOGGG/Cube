export interface Timer {
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  elapsedSeconds(): number;
}

export function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m + ':' + String(s).padStart(2, '0');
}

/**
 * Mirrors the start/pause/resume timing math shared by every prototype's HUD clock.
 *
 * **量的是单调钟（performance.now），不是墙上的钟（Date.now）**（10-15 补充 S8）。墙上的钟会被人拨、会被系统校时：
 * 计时局局中把钟往前拨 60 秒，倒数从 1:38 跳到 0:37；往回拨 60 秒，倒数变成 2:37；无限反转往回拨之后结束，用时
 * 是 −57 秒，服务器（api/_maxscore.js）整局拒收；基础局用时 −87 秒，战绩图上印「-2:-27」。单调钟只随真实流逝走。
 * 没暂停就休眠时，多数平台上它不计休眠那一段（墙上的钟计）——暂停 / 切后台（会自动暂停）表现不变。
 */
export function createTimer(onTick: (elapsedSeconds: number) => void): Timer {
  let startTime = 0;
  let pausedElapsed = 0;
  let timerId: number | undefined;
  let running = false;

  function tick() {
    if (!running) return;
    onTick(Math.floor((performance.now() - startTime) / 1000));
  }

  return {
    start() {
      startTime = performance.now();
      running = true;
      clearInterval(timerId);
      timerId = window.setInterval(tick, 250);
    },
    pause() {
      pausedElapsed = performance.now() - startTime;
      running = false;
      clearInterval(timerId);
    },
    resume() {
      running = true;
      startTime = performance.now() - pausedElapsed;
      clearInterval(timerId);
      timerId = window.setInterval(tick, 250);
    },
    stop() {
      // 停表也记一次：停下之后再问「打了多久」，答案该是停下那一刻的数，不
      // 该跟着墙上的钟继续涨。结算页是在停表之后画的。
      if (running) pausedElapsed = performance.now() - startTime;
      running = false;
      clearInterval(timerId);
    },
    /**
     * 打了多久。停着的时候读到的是停下那一刻的数。
     *
     * 从前这里一律拿当下减开表时刻，不看表在不在走。表面上没事——
     * resume() 会把 startTime 往后挪，把暂停的那一段抹掉。可是**停着的时候
     * 读**就不对了：暂停中（或者切到后台自动暂停中）问一次，答案里含着这一
     * 段还没被抹掉的空白；玩家接了个电话，回来一看用时凭空多了两分钟，用时
     * 系数把这一局的分压了下去。
     */
    elapsedSeconds() {
      return Math.floor((running ? performance.now() - startTime : pausedElapsed) / 1000);
    },
  };
}

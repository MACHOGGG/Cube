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

/** Mirrors the start/pause/resume timing math shared by every prototype's HUD clock. */
export function createTimer(onTick: (elapsedSeconds: number) => void): Timer {
  let startTime = 0;
  let pausedElapsed = 0;
  let timerId: number | undefined;
  let running = false;

  function tick() {
    if (!running) return;
    onTick(Math.floor((Date.now() - startTime) / 1000));
  }

  return {
    start() {
      startTime = Date.now();
      running = true;
      clearInterval(timerId);
      timerId = window.setInterval(tick, 250);
    },
    pause() {
      pausedElapsed = Date.now() - startTime;
      running = false;
      clearInterval(timerId);
    },
    resume() {
      running = true;
      startTime = Date.now() - pausedElapsed;
      clearInterval(timerId);
      timerId = window.setInterval(tick, 250);
    },
    stop() {
      // 停表也记一次：停下之后再问「打了多久」，答案该是停下那一刻的数，不
      // 该跟着墙上的钟继续涨。结算页是在停表之后画的。
      if (running) pausedElapsed = Date.now() - startTime;
      running = false;
      clearInterval(timerId);
    },
    /**
     * 打了多久。停着的时候读到的是停下那一刻的数。
     *
     * 从前这里一律拿 Date.now() 减开表时刻，不看表在不在走。表面上没事——
     * resume() 会把 startTime 往后挪，把暂停的那一段抹掉。可是**停着的时候
     * 读**就不对了：暂停中（或者切到后台自动暂停中）问一次，答案里含着这一
     * 段还没被抹掉的空白；玩家接了个电话，回来一看用时凭空多了两分钟，用时
     * 系数把这一局的分压了下去。
     */
    elapsedSeconds() {
      return Math.floor((running ? Date.now() - startTime : pausedElapsed) / 1000);
    },
  };
}

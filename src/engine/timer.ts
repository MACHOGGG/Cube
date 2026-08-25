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
      running = false;
      pausedElapsed = Date.now() - startTime;
      clearInterval(timerId);
    },
    resume() {
      running = true;
      startTime = Date.now() - pausedElapsed;
      clearInterval(timerId);
      timerId = window.setInterval(tick, 250);
    },
    stop() {
      running = false;
      clearInterval(timerId);
    },
    elapsedSeconds() {
      return Math.floor((Date.now() - startTime) / 1000);
    },
  };
}

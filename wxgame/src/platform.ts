/**
 * 小游戏和浏览器两头共用的一层薄壳：一块画布、触摸、震动、下一帧。
 *
 * 微信小游戏里没有 DOM——画布是 wx.createCanvas() 给的，触摸是 wx.onTouch*
 * 给的。同一份 game.js 在浏览器里也要能跑（scripts/check-wxgame.mjs 拿它做
 * 回归、截图），所以这儿两头各写一份，游戏本身只认这个接口。
 */
export interface TouchHandlers {
  start(x: number, y: number): void;
  move(x: number, y: number): void;
  end(x: number, y: number): void;
}

export interface Platform {
  ctx: CanvasRenderingContext2D;
  /** 逻辑尺寸（和触摸坐标同一套单位）。画布本身按像素比放大过，ctx 已经 scale 过。 */
  width: number;
  height: number;
  onTouch(h: TouchHandlers): void;
  vibrate(): void;
  requestFrame(fn: () => void): void;
  now(): number;
  isWx: boolean;
}

// 微信小游戏的全局对象。浏览器里没有它，靠 typeof 判断。
declare const wx: any;

export function createPlatform(): Platform {
  if (typeof wx !== 'undefined' && typeof wx.createCanvas === 'function') return wxPlatform();
  return browserPlatform();
}

function wxPlatform(): Platform {
  // 第一次 wx.createCanvas() 给的就是屏幕上那块画布。
  const canvas = wx.createCanvas();
  const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
  const dpr: number = info.pixelRatio || 1;
  const width: number = info.windowWidth;
  const height: number = info.windowHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.scale(dpr, dpr);
  const at = (e: any): [number, number] | null => {
    const t = e?.touches?.[0] ?? e?.changedTouches?.[0];
    return t ? [t.clientX, t.clientY] : null;
  };
  return {
    ctx,
    width,
    height,
    isWx: true,
    onTouch(h) {
      wx.onTouchStart((e: any) => {
        const p = at(e);
        if (p) h.start(p[0], p[1]);
      });
      wx.onTouchMove((e: any) => {
        const p = at(e);
        if (p) h.move(p[0], p[1]);
      });
      wx.onTouchEnd((e: any) => {
        const p = at(e);
        if (p) h.end(p[0], p[1]);
      });
      wx.onTouchCancel((e: any) => {
        const p = at(e);
        if (p) h.end(p[0], p[1]);
      });
    },
    vibrate() {
      try {
        wx.vibrateShort?.({ type: 'light' });
      } catch {
        /* 没有震动也没关系 */
      }
    },
    requestFrame(fn) {
      requestAnimationFrame(fn);
    },
    now: () => Date.now(),
  };
}

function browserPlatform(): Platform {
  const canvas = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  canvas.style.display = 'block';
  canvas.style.touchAction = 'none';
  canvas.id = 'wxgame';
  document.body.style.margin = '0';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  return {
    ctx,
    width,
    height,
    isWx: false,
    onTouch(h) {
      let down = false;
      canvas.addEventListener('pointerdown', (e) => {
        down = true;
        canvas.setPointerCapture(e.pointerId);
        h.start(e.clientX, e.clientY);
      });
      canvas.addEventListener('pointermove', (e) => {
        if (down) h.move(e.clientX, e.clientY);
      });
      const up = (e: PointerEvent) => {
        if (!down) return;
        down = false;
        h.end(e.clientX, e.clientY);
      };
      canvas.addEventListener('pointerup', up);
      canvas.addEventListener('pointercancel', up);
    },
    vibrate() {
      try {
        navigator.vibrate?.(8);
      } catch {
        /* 桌面浏览器没有震动 */
      }
    },
    requestFrame(fn) {
      requestAnimationFrame(fn);
    },
    now: () => Date.now(),
  };
}

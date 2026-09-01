/**
 * 催房主时，往 Slides 标题那个框里掉的图形。
 *
 * 客人在小屋里按一下《催房主》，房主的标题框里就掉进来几个随机颜色、随机
 * 形状的小东西：方块、圆球、三角——就是这个游戏本来的三种。它们在框子里
 * 互相撞、也和框子的圆角边撞，一边弹一边淡，淡完就没了。一直按就一直掉。
 *
 * 为什么是画在 canvas 上而不是一堆 div：
 * 十几个东西同时在弹，每一帧都要改它们的位置。用 div 的话每帧就是十几次
 * 样式写入加一次重排；canvas 上是一次清屏加十几次填充，而且它天然被自己的
 * 边界裁住，不会有哪一个飞出框外盖到别的东西上。
 *
 * 「太多了就淡得快」是有意的设计，不是省事：一个人按住不放的时候，如果每个
 * 都活满一样久，框子会被塞满，标题就看不见了——而那是房主要用来认路的东西。
 * 现在的做法是数量一超过 SOFT_CAP，剩下的寿命就整体按比例缩短，于是掉得越
 * 猛、清得越快，框子永远留得出缝。
 */

/** 三种图形，和棋盘上的一样。 */
type Kind = 'square' | 'circle' | 'triangle';
const KINDS: Kind[] = ['square', 'circle', 'triangle'];

/** 棋子的那套标准色。掉进来的东西属于这个游戏，不该是另一套颜色。 */
const COLORS = ['#2F8A96', '#B23A3A', '#D89B1E', '#4C68B0', '#2F9E52', '#9B958D'];

const GRAVITY = 1500;      // px/s²
const BOUNCE = 0.62;       // 撞墙之后还剩多少速度
const FLOOR_DRAG = 0.86;   // 贴着底走的时候的横向摩擦
const LIFE_MS = 2600;      // 一个图形能活多久（不拥挤的时候）
const FADE_FROM = 0.55;    // 活过这么大比例之后开始淡
const SOFT_CAP = 8;        // 超过这么多个，寿命开始整体缩短
const HARD_CAP = 40;       // 再多就不收了——最老的那个直接让位
const R_MIN = 7;
const R_MAX = 12;

interface Piece {
  x: number; y: number;
  vx: number; vy: number;
  r: number;
  kind: Kind;
  color: string;
  rot: number; vrot: number;
  /** 已经活了多久，毫秒。 */
  age: number;
}

export interface TitleRain {
  /** 掉 n 个进去。 */
  drop(n?: number): void;
  /** 收摊：停掉动画、拆掉画布。 */
  stop(): void;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

/**
 * 把雨挂到 host 上（就是那块标题玻璃）。画布铺满它，盖在字上面，不吃点击。
 *
 * 一个图形都没有的时候，rAF 是停着的——房主坐在小屋里不动的那几分钟，这里
 * 一帧都不跑。
 */
export function mountTitleRain(host: HTMLElement): TitleRain {
  const canvas = document.createElement('canvas');
  canvas.className = 'title-rain';
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    // 这台设备给不了 2D 上下文。少一个玩笑，不该少掉整个小屋。
    canvas.remove();
    return { drop: () => {}, stop: () => {} };
  }

  const pieces: Piece[] = [];
  let raf = 0;
  let last = 0;
  let w = 0;
  let h = 0;
  let dead = false;

  function resize() {
    const rect = host.getBoundingClientRect();
    w = Math.max(1, rect.width);
    h = Math.max(1, rect.height);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  /** 拥挤的时候寿命按比例缩短——掉得越猛，清得越快。 */
  const lifespan = () => LIFE_MS / (1 + Math.max(0, pieces.length - SOFT_CAP) * 0.35);

  function shape(p: Piece) {
    ctx!.save();
    ctx!.translate(p.x, p.y);
    ctx!.rotate(p.rot);
    ctx!.globalAlpha = alphaOf(p);
    ctx!.fillStyle = p.color;
    const r = p.r;
    if (p.kind === 'circle') {
      ctx!.beginPath();
      ctx!.arc(0, 0, r, 0, Math.PI * 2);
      ctx!.fill();
    } else if (p.kind === 'square') {
      const s = r * 1.7;
      const k = s * 0.24;
      roundRect(ctx!, -s / 2, -s / 2, s, s, k);
      ctx!.fill();
    } else {
      const s = r * 2.1;
      const hgt = (s * Math.sqrt(3)) / 2;
      ctx!.beginPath();
      ctx!.moveTo(0, -hgt * 0.62);
      ctx!.lineTo(s / 2, hgt * 0.38);
      ctx!.lineTo(-s / 2, hgt * 0.38);
      ctx!.closePath();
      ctx!.fill();
    }
    ctx!.restore();
  }

  const alphaOf = (p: Piece) => {
    const t = p.age / lifespan();
    if (t <= FADE_FROM) return 1;
    return Math.max(0, 1 - (t - FADE_FROM) / (1 - FADE_FROM));
  };

  function step(now: number) {
    if (dead) return;
    const dt = Math.min(0.032, (now - last) / 1000);
    last = now;

    for (const p of pieces) {
      p.age += dt * 1000;
      p.vy += GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;

      // 四面墙。框子是圆角的，但在这个尺度上按直边处理看不出来，而且直边
      // 撞出来的方向是对的——圆角那一点点差别没人会注意到，代码复杂度倒是
      // 差很多。
      if (p.x < p.r) { p.x = p.r; p.vx = Math.abs(p.vx) * BOUNCE; }
      if (p.x > w - p.r) { p.x = w - p.r; p.vx = -Math.abs(p.vx) * BOUNCE; }
      if (p.y > h - p.r) {
        p.y = h - p.r;
        p.vy = -Math.abs(p.vy) * BOUNCE;
        p.vx *= FLOOR_DRAG;
        p.vrot *= FLOOR_DRAG;
      }
      // 顶上不挡：新的从上面掉进来，撞到看不见的天花板会很怪。
    }

    // 互相撞。等质量的完全弹性碰撞，只沿连心线交换那一份速度。
    for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        const a = pieces[i];
        const b = pieces[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        const min = a.r + b.r;
        if (d2 >= min * min || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        // 先分开，免得两个粘在一起来回抖。
        const push = (min - d) / 2;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel > 0) continue;             // 已经在分开了
        const imp = -(1 + BOUNCE) * rel / 2;
        a.vx -= imp * nx; a.vy -= imp * ny;
        b.vx += imp * nx; b.vy += imp * ny;
      }
    }

    // 淡完的清掉。
    const span = lifespan();
    for (let i = pieces.length - 1; i >= 0; i--) {
      if (pieces[i].age >= span) pieces.splice(i, 1);
    }

    ctx!.clearRect(0, 0, w, h);
    for (const p of pieces) shape(p);

    if (pieces.length) raf = requestAnimationFrame(step);
    else raf = 0;
  }

  function drop(n = 1) {
    if (dead) return;
    for (let k = 0; k < n; k++) {
      if (pieces.length >= HARD_CAP) pieces.shift();
      const r = rand(R_MIN, R_MAX);
      pieces.push({
        x: rand(r + 6, Math.max(r + 7, w - r - 6)),
        y: -rand(4, 26),
        vx: rand(-70, 70),
        vy: rand(0, 90),
        r,
        kind: pick(KINDS),
        color: pick(COLORS),
        rot: rand(0, Math.PI * 2),
        vrot: rand(-6, 6),
        age: 0,
      });
    }
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(step);
    }
  }

  return {
    drop,
    stop() {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      canvas.remove();
    },
  };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

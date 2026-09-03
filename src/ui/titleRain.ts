/**
 * 催屋主时，往 Slides 标题那个框里掉的图形。
 *
 * 客人在小屋里按一下《催屋主》，屋主的标题框里就掉进来一个随机颜色、随机形
 * 状的小东西：方块、圆球、三角——就是这个游戏本来的三种。按一下掉一个，按得
 * 越密掉得越密（节奏由 multiplayer.ts 按服务器记下的每一下的时刻来放）。
 *
 * 掉进来之后它不沉底：在整个圆角矩形里四处弹——撞四面墙（连圆角也照着圆弧
 * 弹）、互相撞也弹（等质量的完全弹性碰撞），速度不衰减，一直弹到自己淡掉为
 * 止。玩家的原话：「掉落后在整个 title 的圆角矩形内部四处弹跳，小图形之间碰
 * 撞也会反弹」。
 *
 * 为什么是画在 canvas 上而不是一堆 div：
 * 十几个东西同时在弹，每一帧都要改它们的位置。用 div 的话每帧就是十几次
 * 样式写入加一次重排；canvas 上是一次清屏加十几次填充，而且它天然被自己的
 * 边界裁住，不会有哪一个飞出框外盖到别的东西上。
 *
 * 「太多了就淡得快」是有意的设计，不是省事：一个人按住不放的时候，如果每个
 * 都活满一样久，框子会被塞满，标题就看不见了——而那是屋主要用来认路的东西。
 * 数量一超过 SOFT_CAP，剩下的寿命就整体按比例缩短，于是掉得越猛、清得越快，
 * 框子永远留得出缝。
 */

/** 三种图形，和棋盘上的一样。 */
type Kind = 'square' | 'circle' | 'triangle';
const KINDS: Kind[] = ['square', 'circle', 'triangle'];

/** 棋子的那套标准色。掉进来的东西属于这个游戏，不该是另一套颜色。 */
const COLORS = ['#2F8A96', '#B23A3A', '#D89B1E', '#4C68B0', '#2F9E52', '#9B958D'];

/** 每个图形自己的速度（px/s），一进来就定，此后撞什么都不变。 */
const SPEED_MIN = 120;
const SPEED_MAX = 200;
const LIFE_MS = 5600;      // 一个图形能活多久（不拥挤的时候）
const FADE_FROM = 0.72;    // 活过这么大比例之后开始淡
const SOFT_CAP = 10;       // 超过这么多个，寿命开始整体缩短
const HARD_CAP = 40;       // 再多就不收了——最老的那个直接让位
const R_MIN = 7;
const R_MAX = 12;

interface Piece {
  x: number; y: number;
  vx: number; vy: number;
  /** 自己的速度大小；每一帧撞完之后都按它把速度矫回来，弹多久都不慢。 */
  speed: number;
  r: number;
  kind: Kind;
  color: string;
  rot: number; vrot: number;
  /** 已经活了多久，毫秒。 */
  age: number;
  /** 从上面掉进来的那一下还没完全进框——进了框顶上那面墙才算数。 */
  inside: boolean;
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
 * 一个图形都没有的时候，rAF 是停着的——屋主坐在小屋里不动的那几分钟，这里
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
  /** 框子的圆角半径——从它的样式里读，框子怎么画的，弹就怎么弹。 */
  let corner = 0;
  let dead = false;

  function resize() {
    const rect = host.getBoundingClientRect();
    w = Math.max(1, rect.width);
    h = Math.max(1, rect.height);
    corner = Math.min(
      parseFloat(getComputedStyle(host).borderTopLeftRadius) || 0,
      w / 2,
      h / 2,
    );
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

  /**
   * 四面墙，连圆角一起。
   *
   * 直边照直边弹；到了四个角上，框子的边是一段圆弧——圆心在 (corner, corner)
   * 那几个点，半径 corner。图形的圆心离那个圆心不能超过 corner − r，超了就
   * 沿着连心线（也就是圆弧的法线）弹回来。顶上那面墙只对已经完全进了框的图
   * 形算数：新的是从上面掉进来的，一进来就撞天花板会很怪。
   */
  function walls(p: Piece) {
    if (p.x < p.r) { p.x = p.r; p.vx = Math.abs(p.vx); }
    if (p.x > w - p.r) { p.x = w - p.r; p.vx = -Math.abs(p.vx); }
    if (p.y > h - p.r) { p.y = h - p.r; p.vy = -Math.abs(p.vy); }
    if (p.inside && p.y < p.r) { p.y = p.r; p.vy = Math.abs(p.vy); }
    if (corner <= p.r) return;
    const limit = corner - p.r;
    const arcs: [number, number][] = [
      [w - corner, h - corner],
      [corner, h - corner],
      ...(p.inside ? ([[corner, corner], [w - corner, corner]] as [number, number][]) : []),
    ];
    for (const [cx, cy] of arcs) {
      // 只管自己那一角的扇形：圆心到图形的方向得指向角落。
      const dx = p.x - cx;
      const dy = p.y - cy;
      const toward = (cx < w / 2 ? dx < 0 : dx > 0) && (cy < h / 2 ? dy < 0 : dy > 0);
      if (!toward) continue;
      const d = Math.hypot(dx, dy);
      if (d <= limit || d === 0) continue;
      const nx = dx / d;
      const ny = dy / d;
      p.x = cx + nx * limit;
      p.y = cy + ny * limit;
      const along = p.vx * nx + p.vy * ny;
      if (along > 0) {
        p.vx -= 2 * along * nx;
        p.vy -= 2 * along * ny;
      }
    }
  }

  function step(now: number) {
    if (dead) return;
    const dt = Math.min(0.032, (now - last) / 1000);
    last = now;

    for (const p of pieces) {
      p.age += dt * 1000;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;
      if (!p.inside && p.y - p.r >= 0) p.inside = true;
      walls(p);
    }

    // 互相撞。等质量的完全弹性碰撞：沿连心线那一份速度整个交换，切向的各留各的。
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
        a.vx += rel * nx; a.vy += rel * ny;
        b.vx -= rel * nx; b.vy -= rel * ny;
      }
    }

    // 撞来撞去速度大小会有零碎的漂移，每一帧按各自的 speed 矫回来：弹多久都不慢、也不越弹越快。
    for (const p of pieces) {
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > 1e-6) {
        const k = p.speed / sp;
        p.vx *= k;
        p.vy *= k;
      } else {
        p.vx = p.speed;
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
      const speed = rand(SPEED_MIN, SPEED_MAX);
      // 从上面掉进来：朝下、带一点左右。
      const angle = rand(Math.PI * 0.22, Math.PI * 0.78);
      pieces.push({
        x: rand(r + 6, Math.max(r + 7, w - r - 6)),
        y: -r - rand(2, 14),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        speed,
        r,
        kind: pick(KINDS),
        color: pick(COLORS),
        rot: rand(0, Math.PI * 2),
        vrot: rand(-6, 6),
        age: 0,
        inside: false,
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

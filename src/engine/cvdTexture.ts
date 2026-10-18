/**
 * 色盲友好配色开着时，棋子身上的格内纹理（10-18 补充 M-4，站长定方案乙）。
 *
 * 颜色是第一线索，纹理是第二线索：同色的两枚纹理一样，玩家比「是不是同一色」时多一样东西可看。不改
 * 规则、不改配色、不改棋子大小；色盲关着时，棋盘的 DOM 和样式一个字节都不变（六副棋盘只在
 * colorblindOn() 时才调这里）。依据是 WCAG 1.4.1「不只靠颜色传达信息」和游戏无障碍指南基础级那一条——
 * 标准配色在完全绿色盲眼里，经典方块的蓝和紫只差 ΔE00 1.4，而色盲那三套里也各剩几对「近对」。
 *
 * 表按色值查：三套色盲配色（std / warm / cool，engine/palettePref.ts 的 CVD_COLORS，std 那七色就是六副棋盘
 * 各自 colorblind 数组里的 Okabe–Ito）21 个色值两两不同，炸弹红 #C63B3B 不在表里——炸弹不铺，它身上本来就
 * 有「！」和裂纹。std 那七行照站长选定的那张样图原样；warm、cool 按样图同一条原则排：先用 Machado 2009
 * （严重度 1.0）模拟三种色盲、两两算 CIEDE2000，ΔE00 < 17 的算近对，近对里尽量做到「方向差 90°」或「线 /
 * 点 / 无」，「无」给近对伙伴最多的那一色。
 *
 * 线和棋子底色的亮度比只有约 1.5–1.7:1（白线那一色约 2:1），严格按 WCAG 1.4.11 不达标——这是「看得见、
 * 但不抢颜色」的折中，站长知道这个取舍，不加重。
 *
 * 所有数都在这里算成像素拼进去，不用 calc()、不用 var()：小红书 Chrome 61 的降级层不处理渐变里的这两样。
 */
export type Tex = 'h' | 'v' | 'grid' | 'd' | 'a' | 'dots' | 'none';

const TEX: Record<string, Tex> = {
  // std（Okabe–Ito）
  '#D55E00': 'h',
  '#E69F00': 'v',
  '#F0E442': 'dots',
  '#009E73': 'd',
  '#56B4E9': 'a',
  '#0072B2': 'grid',
  '#CC79A7': 'none',
  // warm
  '#DD344F': 'grid',
  '#E9CF99': 'h',
  '#EA732F': 'none',
  '#C181A1': 'd',
  '#FEB449': 'v',
  '#B2A972': 'dots',
  '#A66378': 'a',
  // cool
  '#8767B7': 'h',
  '#A0DCB5': 'grid',
  '#1F8985': 'dots',
  '#37E6FA': 'd',
  '#5E8052': 'v',
  '#9199CE': 'none',
  '#43B196': 'a',
};
/** 正面线色「纯黑、纯白哪个对比度高用哪个」：21 色里只有 std 的蓝选白。 */
const WHITE_INK = new Set(['#0072B2']);

/** 这一色铺什么；不在表里（炸弹红等）返回 null。 */
export function texOf(hex: string): Tex | null {
  return TEX[hex.toUpperCase()] ?? null;
}

/**
 * 反面要不要缩星、加 halo：只有真铺了纹理的那几色（h / v / grid / d / a / dots）。查不到（炸弹红）或「无」，
 * 反面和今天一模一样。六副棋盘共用这一个判断。
 */
export function texShrinks(hex: string): boolean {
  const t = texOf(hex);
  return t !== null && t !== 'none';
}

/**
 * 纹理周期 P（CSS 像素）：棋子的特征长度乘一个系数，不小于 5。方块、菱形方块、三角是 0.16 × 边长，三副小球
 * 是 0.18 × 直径（各棋盘自己量好特征长度传进来）。
 */
export function texPeriod(len: number, k: number): number {
  return Math.max(5, Math.round(k * len));
}

/** 保留一位小数，去掉多余的 0（「2.0」写成「2」）。 */
const n = (x: number): string => String(Math.round(x * 10) / 10);

function rgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** 一层条纹：宽 (to − from) × P，中线在 P/2。 */
function stripes(deg: number, p: number, from: number, to: number, ink: string): string {
  return (
    `repeating-linear-gradient(${deg}deg, transparent 0px, transparent ${n(from * p)}px, ` +
    `${ink} ${n(from * p)}px, ${ink} ${n(to * p)}px, transparent ${n(to * p)}px, transparent ${n(p)}px)`
  );
}

/**
 * 算好一枚棋子要写的三条行内样式。face = 'front' 时线色按正面线色（黑 22%，蓝那一色白 38%）；'back' 时
 * 线色是这一色本身、不透明度 0.5（反面的底板上先铺一层星星自己颜色的纹理，再画缩小的星）。
 * 返回 null = 不铺（不在表里，或者是「无」）。
 *
 * 角度：CSS 渐变的方向和条纹垂直——135deg 朝右下，条纹沿「左下 → 右上」走，就是「/」；45deg 是「\」。
 */
export function texStyle(
  hex: string,
  period: number,
  face: 'front' | 'back',
): { image: string; size: string; position: string } | null {
  const t = texOf(hex);
  if (t === null || t === 'none') return null;
  const p = period;
  const ink =
    face === 'back'
      ? rgba(hex, 0.5)
      : WHITE_INK.has(hex.toUpperCase())
        ? 'rgba(255, 255, 255, 0.38)'
        : 'rgba(0, 0, 0, 0.22)';
  switch (t) {
    case 'h':
      return { image: stripes(180, p, 0.35, 0.65, ink), size: 'auto', position: '0 0' };
    case 'v':
      return { image: stripes(90, p, 0.35, 0.65, ink), size: 'auto', position: '0 0' };
    case 'd':
      return { image: stripes(135, p, 0.35, 0.65, ink), size: 'auto', position: '0 0' };
    case 'a':
      return { image: stripes(45, p, 0.35, 0.65, ink), size: 'auto', position: '0 0' };
    case 'grid':
      return {
        image: `${stripes(180, p, 0.38, 0.62, ink)}, ${stripes(90, p, 0.38, 0.62, ink)}`,
        size: 'auto, auto',
        position: '0 0, 0 0',
      };
    case 'dots': {
      // 三角点阵：两层同一张图，第二层错开半个周期、下移 0.866P。
      const dot = `radial-gradient(circle at 50% 25%, ${ink} 0px, ${ink} ${n(0.21 * p)}px, transparent ${n(0.21 * p + 0.5)}px)`;
      const tile = `${n(p)}px ${n(1.732 * p)}px`;
      return {
        image: `${dot}, ${dot}`,
        size: `${tile}, ${tile}`,
        position: `0 0, ${n(0.5 * p)}px ${n(0.866 * p)}px`,
      };
    }
  }
  return null;
}

/**
 * 给一枚棋子（或三角的 .fill、反面那一块 .tri-tex）铺上纹理。只在色盲开着时调。
 *
 * 必须写在 `el.style.background = …`（简写）**之后**：行内简写会把 background-image 写成初始值，而且压得过
 * 样式表里任何选择器，所以纹理只能用行内分项补写。
 *
 * data-tex 是给门认的（「无」那一色也打，查不到的什么都不打）；不要拿 data-r / data-c 认。
 */
export function applyTex(el: HTMLElement, hex: string, period: number, face: 'front' | 'back'): void {
  const t = texOf(hex);
  if (t === null) return; // 炸弹等：不铺、也不打记号
  el.dataset.tex = t;
  const s = texStyle(hex, period, face);
  if (!s) return; // 「无」：只打记号
  el.style.backgroundImage = s.image;
  el.style.backgroundSize = s.size;
  el.style.backgroundPosition = s.position;
}

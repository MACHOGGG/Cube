/**
 * 《Pro》那一圈：这一局每种颜色得分后翻成哪一种（站长 2026-10-14 定的新 Pro，10-15 补充 S10：K-4）。
 *
 * 按这副棋盘调色板的颜色序号，序号 i 的色块得分后翻成序号 next(i) 的星星，最后一个回到第一个——永远固定，和这一局
 * 发到什么牌无关。**炸弹局里红色那个序号不进这一圈**：红块的反面照现在（engine/bomb.ts 的 dealBombBacks），拆掉之后
 * 照旧翻成发牌时印好的颜色。
 *
 * ⚠️ **这个文件不许 import ./rng，一个随机数都不许取**（scripts/check-pro.mjs 钉着）。Pro 只在各副棋盘的 generate*()
 * 发完牌之后改写 dotColor：发牌那一行一个字不动、取的随机数个数一样，所以非 Pro 局、代号局、每日局的牌逐枚不变
 * （scripts/check-seed-golden.mjs 的金标一字不改）；Pro 局的正面和种子码也和不开 Pro 时一模一样，只是反面换了。
 */

/** 这一局那一圈：调色板序号从小到大，炸弹局去掉红（redIdx 给 -1 表示不是炸弹局）。 */
export function proCycle(nColors: number, redIdx: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < nColors; i++) if (i !== redIdx) out.push(i);
  return out;
}

/** 序号 color 的下一色；不在圈里（红、空位 -1）原样返回。 */
export function proNext(cycle: readonly number[], color: number): number {
  const at = cycle.indexOf(color);
  return at < 0 ? color : cycle[(at + 1) % cycle.length];
}

/**
 * 发完牌之后改写：圈里每一色的格子 dotColor = next(color)。不碰 face、不碰 color、不取随机数。空位（color === -1）、
 * 红块（不在圈里）跳过。
 */
export function applyProBacks<T extends { color: number; dotColor: number }>(
  grid: readonly (readonly (T | null | undefined)[])[],
  cycle: readonly number[],
): void {
  for (const row of grid) {
    for (const tile of row) {
      if (!tile || tile.color < 0) continue;
      if (cycle.indexOf(tile.color) < 0) continue;
      tile.dotColor = proNext(cycle, tile.color);
    }
  }
}

/**
 * 局中那颗灯泡（10-31 方案推12 Z-J03，10-14 F-2 ①–③、C-11）：**每个玩法的前两局**，暂停那块琥珀牌分成两半——左边仍是
 * 暂停，右边一颗灯泡（#hintBtn），点了先暂停、打开这一局那一份规则，关掉再继续。第 3 局起没有。
 *
 * 「玩法」按入口数（main.ts 开局时给 ShapeGameOpts.bulbKey）：square、circle、timed、bomb（三档合一个）、slot、flip、puzzle、
 * layout（更多布局一族一个，同 firstPlay 的 'layout'）、daily（每日挑战那一局，不管那天是什么玩法）；输代号开的局按它自己的
 * 玩法数。小屋局不摆（不给 bulbKey）。灯泡不算教学内容（站长 10-29 C-11）：带教学条的那一局也算第 1 局，《再来一局》也算。
 *
 * 记的那一下是**开打**那一刻（倒数数完、#startBtn 按下去，见 ui/gameShell.ts）——倒数中退出不算一局。键 `slides_bulb_<玩法>`
 * 存数字，落在隐私政策「进度」那一类已有的 slides_bulb_ 前缀里；小红书那一端换成自己的前缀（slides.xhs.bulb.）。
 * **存不进 localStorage 就当已满（不摆）**：记不住第几局的话，每一局都会有，那就不是「前两局」了。
 */
let prefix = 'slides_bulb_';

/** 小红书端在开机时换成自己那套前缀（xhs/src/main.ts）。 */
export function setBulbPrefix(p: string): void {
  prefix = p;
}

/** 每个玩法前几局有灯泡。 */
export const BULB_RUNS = 2;

/** 这一局开打了：要不要摆灯泡（这个玩法还没满两局就摆），并记一笔。 */
export function claimBulb(key: string): boolean {
  try {
    const k = prefix + key;
    const n = Math.max(0, Math.floor(Number(localStorage.getItem(k)) || 0));
    if (n >= BULB_RUNS) return false;
    localStorage.setItem(k, String(n + 1));
    return true;
  } catch {
    return false;
  }
}

/**
 * 《Pro》——全站一个设置（个人主页、暂停面板各一颗开关，记在本机 slides_pro）。
 *
 * 它管**单人局的翻面颜色**（站长 2026-10-14 定的新 Pro，10-15 补充 S10：K-4）：开着它开局的那一局，每一枚色块得分
 * 后翻成调色板里「下一种颜色」的星星，最后一种回到第一种；炸弹局里红色不在这一圈里。棋盘旁边摆一只颜色关系轮盘
 * （ui/proWheel.ts）。对应关系和改写反面的写法见 engine/proCycle.ts。
 *
 * 三条边界不在这个文件里判，但改这儿的人得知道：
 *   ① 只在单人局起作用，由控制器在开局那一刻定（gameController 的 newGame：`proAllowed && proOn()` 并且种子是随手
 *      抽的），每日挑战、输代号、小屋一律照普通规则发牌；
 *   ② 开局那一刻定，局中不能改，暂停面板那颗开关局中是灰的；
 *   ③ 小红书那一版没有 Pro。
 *
 * 从前（2026-09 起）它管的是每枚色块外侧那一圈描边（engine/proHint.ts，还往 <html> 上挂 data-pro、拨开关时通知
 * 三角那几副重画），10-14 改版时整套删了：现在开关只在开局那一刻被读一次，局中没有谁要跟着它变。
 */
const KEY = 'slides_pro';

let on = read();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function proOn(): boolean {
  return on;
}

export function setPro(next: boolean): void {
  if (next === on) return;
  on = next;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* 无痕模式：这个设置活到关窗为止 */
  }
}

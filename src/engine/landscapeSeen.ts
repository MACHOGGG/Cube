/**
 * 「这个人已经横着玩过了」。
 *
 * 开局页上那句「把手机转过来」是写给第一次遇上宽棋盘的人看的。转过一次之
 * 后这句话就不再是提示，而是每一局都要重新读一遍的旧新闻——玩家的原话：
 * 「在玩家使用过第一次横屏游玩之后，游戏的横屏提示就把文字删除只保留现在
 * 的提示动画」。动画留着，因为它一眼就懂，占的地方也小。
 *
 * 判定的是「真的横着玩过」，不是「见过这一页」：开局页自己还挂着的时候不
 * 算数——那时候人只是在看提示，手机还没转。所以打点在两个时刻：一局真的开
 * 起来了而屏幕是横的，或者局中把手机转横了。
 */
const KEY = 'slides_landscape_played';

let seen = read();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    // 私密模式：这一次会话里照常记，只是下次进来又是新的。
    return false;
  }
}

export const landscapePlayed = (): boolean => seen;

export function markLandscapePlayed(): void {
  if (seen) return;
  seen = true;
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* 存不下就只在这一次会话里生效，不值得为它报错。 */
  }
}

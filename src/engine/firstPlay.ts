/**
 * 「这个玩法他开过没有」——头一回进去时才有的那点招待，都靠它。
 *
 *   square / circle  两张基础卡。开过之前，主菜单上那张卡一直镶着一圈光；头
 *                    一回点进去，棋盘底下那块教学条把六条规矩一条一条讲完
 *                    （见 ui/coachBar.ts）。两张各算各的：打完小球只有小球那
 *                    张不亮了，方块那张继续亮着等他。
 *   bomb / slot /    头一回进去：棋盘底下摆一句话，说清这个玩法在基础规则上
 *   flip / timed /   加的那一层，摆一整局（见 ui/modeTips.ts）。第二回再进去
 *   layout           就没有了——同一句话说两遍就成了噪音。
 *
 * layout 是「特殊布局」那一整族共用的一把钥匙（菱形方块、六边形小球、六边形
 * 三角、菱形小球、V 字三角）：那一句说的是「规矩没变，只是格子摆法不同」，
 * 对哪一副棋盘都是同一句，说过一遍就够了。
 *
 * 存不进 localStorage（无痕窗口、清过站点数据）就当「已经开过」——宁可少招待
 * 一次，也不要每一局都重来一遍：一句每次都冒出来的提示比没有还烦。
 */
import { hasSeenTutorial } from '../i18n';

export type PlayKey = 'square' | 'circle' | 'bomb' | 'slot' | 'flip' | 'timed' | 'layout';

const KEY = (k: PlayKey) => `slides_played_${k}`;

/**
 * 老玩家不该被当成新人。
 *
 * 这把新钥匙是今天才有的，在它之前打过几百局的人本地并没有它。方块和小球那
 * 段分镜动画的旧钥匙（slides_tutorial_seen_*）能认出他们：那段动画是进这个玩
 * 法的必经之路，看过就等于打开过。
 */
function playedBefore(k: PlayKey): boolean {
  if (k === 'square' || k === 'circle') return hasSeenTutorial(k);
  return false;
}

export function firstTimeIn(k: PlayKey): boolean {
  try {
    if (playedBefore(k)) return false;
    return localStorage.getItem(KEY(k)) !== '1';
  } catch {
    return false;
  }
}

export function markOpened(k: PlayKey): void {
  try {
    localStorage.setItem(KEY(k), '1');
  } catch {
    /* 存不进去就下次再招待一遍，不是什么大事 */
  }
}

/**
 * 主菜单上该给哪几张基础卡镶光。
 *
 * 玩家定的：「一进来就是基础方块和基础小球闪光……玩完一个后就不闪烁了，只剩
 * 下第二个独自继续闪烁直到也被玩完」。两张都打过了就返回空的，主菜单从此安
 * 安静静。
 */
export function glowingBasics(): readonly ('square' | 'circle')[] {
  return (['square', 'circle'] as const).filter((k) => firstTimeIn(k));
}

/**
 * 新手拦截底下那颗《我会玩》。
 *
 * 玩家 2026-09 定的：「在所有版本的新手检测拦截……的下方出现一个小的按钮
 * 《我会玩》，点击后立刻跳过所有教学的锁（第一次点击开每个玩法还是会触发自带
 * 的教学）」。
 *
 * 两端共用这一颗（网页版的主菜单、小红书那一版的主菜单），所以摆在 src/ui 下
 * ——同一句话、同一个尺寸、同一个位置，不会因为两处各写一遍而慢慢长成两个样。
 *
 * 它按下去之后引导就永远撤了，所以刻意做得**小**：
 *   · 字号比卡片底下那行小字还小一档，没有底色、没有边框，只有一条下划线暗示
 *     它可以点——不和那几张发光的卡抢；
 *   · 不写解释。玩家的站点原则第一条是「少文字」，而「我会玩」三个字本身就是
 *     全部意思；真的不会玩的人不会按它，按了也随时能从暂停里的《怎么玩》把六
 *     条规矩再读一遍。
 *   · 热区留够 44px 高（全站的最小触控标准），看着小，按着不小。
 */
import { STRINGS, type Lang } from '../i18n';
import { claimKnowsHow } from '../engine/firstPlay';

/**
 * 造一颗《我会玩》。按下去先记住、再叫 `onSkip` 让调用方重画自己那张菜单。
 *
 * 只在引导还拦着的时候造它——「引导没在拦，却摆着一颗跳过引导的按钮」是玩家
 * 点名不要的那种「意料之外的界面」。判定留给调用方（网页版看
 * `lockedForFirstPlay()`，小红书那版看它自己的 `basicsDone()`）。
 */
export function knowHowButton(lang: Lang, onSkip: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'know-how-btn';
  btn.textContent = STRINGS[lang].knowHow;
  btn.addEventListener('click', () => {
    claimKnowsHow();
    onSkip();
  });
  return btn;
}

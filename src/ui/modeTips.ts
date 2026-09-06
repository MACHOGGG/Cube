/**
 * 炸弹 / 无限反转 / 老虎机头一回进来时的那一句提示。
 *
 * 把「哪一句」（i18n 的 MODE_TIPS）和「配什么图」（ruleArt 的 bombTipArt /
 * flipTipArt，老虎机直接用这一局转出来的两个图案）凑成 gameController 要的那
 * 个 `{ text, art }`——它交给 coachBar 的 mountCoachTip 摆 15 秒，然后自己走
 * 掉（玩家定的）。
 *
 * 这三个玩法都是在基础规则上加一层，所以每句只说加的那一层；六条规矩他在头
 * 一局小球那块教学条上已经听过一遍了。
 */
import { MODE_TIPS, type Lang } from '../i18n';
import { bombTipArt, flipTipArt } from './ruleArt';
import { renderPatternHintIcons } from '../engine/patternIcon';
import { targetPatternDefs } from '../engine/targetIcon';
import type { TargetPattern } from '../engine/targets';
import type { CoachShape } from './coachBar';

export interface ModeTip {
  text: string;
  art: string;
}

/** 炸弹：一行四颗红的挨在一起就炸。图里画的是他刚挑的那种图形。 */
export function bombTip(lang: Lang, shape: CoachShape): ModeTip {
  return { text: MODE_TIPS[lang].bomb, art: bombTipArt(shape) };
}

/** 无限反转：三枚图形正反面来回翻，3 秒一次。同样跟着他挑的图形走。 */
export function flipTip(lang: Lang, shape: CoachShape): ModeTip {
  return { text: MODE_TIPS[lang].flip, art: flipTipArt(shape) };
}

/**
 * 老虎机：配图就是这一局转出来的那两个得分图案。
 *
 * 用的是读数条上那两个图标同一份画法（patternIcon 的 renderPatternHintIcons），
 * 所以提示里指的和他抬头就能看见的是同两个图——换一张图重画一遍，等于让他自
 * 己去对。
 */
export function slotTip(lang: Lang, targets: readonly TargetPattern[]): ModeTip {
  return {
    text: MODE_TIPS[lang].slot,
    art: `<span class="tip-targets">${renderPatternHintIcons(targetPatternDefs(targets), lang).join('')}</span>`,
  };
}

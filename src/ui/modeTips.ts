/**
 * 炸弹 / 无限反转 / 老虎机 / 计时 / 特殊布局头一回进来时的那一句提示。
 *
 * 把「哪一句」（i18n 的 MODE_TIPS）和「配什么图」（ruleArt 的 bombTipArt /
 * flipTipArt，老虎机直接用这一局转出来的两个图案）凑成 gameController 要的那
 * 个 `{ text, art }`——它交给 coachBar 的 mountCoachTip，在棋盘底下摆一整局
 * （玩家定的）。
 *
 * 这几个玩法都是在基础规则上加一层，所以每句只说加的那一层；六条规矩他在头
 * 一回玩基础方块 / 基础小球那块教学条上已经听过一遍了。
 *
 * 计时和特殊布局那两句没有配图：前者要说的是头上那个数字（他抬头就看得
 * 见），后者要说的是「这副棋盘和你学过的那副规矩一样」——画一幅新棋盘反而是
 * 在说「这里有新东西」，正好说反了。
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

/** 计时：头上那个数字是唯一的新东西，一句话说完。 */
export function timedTip(lang: Lang): ModeTip {
  return { text: MODE_TIPS[lang].timed, art: '' };
}

/** 特殊布局：规矩一条没变，变的只是格子怎么摆。 */
export function layoutTip(lang: Lang): ModeTip {
  return { text: MODE_TIPS[lang].layout, art: '' };
}

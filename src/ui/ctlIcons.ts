/**
 * 那一副圆盘：暂停、完成、离开、返回。
 *
 * 原来它们长在 gameShell 里，因为只有游戏页用得上。现在全站的《返回》也是
 * 同一颗——玩家的原话：「替代游戏中所有 开始 返回 暂停 用统一的图标」——所
 * 以搬到这里单放一个文件：个人主页、记录与排名、多人设置页都要用它，可它
 * 们没有一个需要把整个游戏外壳拖进来。gameShell 仍然把这四个再导出一遍，
 * 老的引用（scripts/icon-sheet.mjs）不用改。
 */
import { custom } from './customIcons';

/**
 * The two controls' marks: a disc with the sign cut into it, drawn rather
 * than written.
 *
 * They replace the words 完成/暂停, which had to be translated and then made
 * to fit — "Terminer" is four times the width of 完成 — and which a player
 * mid-run reads as shapes anyway. The disc takes `--ctl-disc` and the sign
 * `--ctl-mark`, so the pressed state swaps the two and the mark inverts with
 * the chip under it (see .app--game .controls .icon-btn in style.css).
 */
const ctlGlyph = (inner: string) =>
  `<svg class="ctl-glyph" viewBox="0 0 100 100" aria-hidden="true" focusable="false">` +
  `<circle cx="50" cy="50" r="46" fill="var(--ctl-disc)"/>${inner}</svg>`;
// 导出是给 scripts/icon-sheet.mjs 用的——图标清单要把它们和别的图标一起画
// 出来，否则这两颗就成了唯一没在清单上、又能换的图标。
// 换成自己画的：ctl-pause.svg / ctl-finish.svg。注意这两个现在是用
// var(--ctl-disc) / var(--ctl-mark) 画的，按下去会两色对调；换成写死颜色
// 的文件之后按下的反色就没有了。
export const CTL_PAUSE = custom('ctl-pause') ?? ctlGlyph(
  '<rect x="35" y="28" width="11" height="44" rx="5.5" fill="var(--ctl-mark)"/>' +
    '<rect x="54" y="28" width="11" height="44" rx="5.5" fill="var(--ctl-mark)"/>',
);
export const CTL_FINISH = custom('ctl-finish') ?? ctlGlyph(
  '<path d="M29 51.5 L44 66 L72 35" fill="none" stroke="var(--ctl-mark)" stroke-width="12" ' +
    'stroke-linecap="round" stroke-linejoin="round"/>',
);
/** 多人局那颗《离开房间》：一扇开着的门，一支箭走出去。换成自己的：ctl-leave.svg。 */
export const CTL_LEAVE = custom('ctl-leave') ?? ctlGlyph(
  '<path d="M56 26 H30 V74 H56" fill="none" stroke="var(--ctl-mark)" stroke-width="9" ' +
    'stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M48 50 H74 M63 39 L74 50 L63 61" fill="none" stroke="var(--ctl-mark)" ' +
    'stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>',
);

/**
 * 小屋局底排那颗《色盲友好》开关。
 *
 * 小屋局按不了《暂停》（一场同步竞赛停不下来），可色盲配色是这局里随时该
 * 够得着的东西——玩家定的：「在小屋对战里有一个小的《色盲友好》开关和《完
 * 成》按钮在游戏界面下方」。所以它单独摆在那一排上，不藏在暂停面板里。
 *
 * 画的是一颗左半实心的圆：同一副圆盘上「换一套配色」最直白的记号，和暂停
 * 那两条、完成那个勾、离开那扇门都不会认混。换成自己的：ctl-cvd.svg。
 */
export const CTL_CVD = custom('ctl-cvd') ?? ctlGlyph(
  '<circle cx="50" cy="50" r="26" fill="none" stroke="var(--ctl-mark)" stroke-width="9"/>' +
    '<path d="M50 24 A26 26 0 0 0 50 76 Z" fill="var(--ctl-mark)"/>',
);

/** 开局页那颗《返回》：同一副圆盘，里面是一支向左的箭。换成自己的：ctl-back.svg。 */
export const CTL_BACK = custom('ctl-back') ?? ctlGlyph(
  '<path d="M60 30 L40 50 L60 70" fill="none" stroke="var(--ctl-mark)" stroke-width="11" ' +
    'stroke-linecap="round" stroke-linejoin="round"/>',
);

/**
 * 教学那一排：上一条、下一条、再一次。同一副圆盘，里面分别是向左的箭、向右的
 * 箭、绕一圈的箭——玩家的原话：「上一条改为 ⬅️ 标识，下一条改为 ➡️，再一次改为
 * 🔄，完成改为 ✅（不是这个 emoji 但就是这个图示）」；《完成》用的就是 CTL_FINISH
 * 那个对勾。换成自己的：ctl-prev.svg / ctl-next.svg / ctl-replay.svg。
 */
export const CTL_PREV = custom('ctl-prev') ?? ctlGlyph(
  '<path d="M70 50 H32 M47 34 L30 50 L47 66" fill="none" stroke="var(--ctl-mark)" stroke-width="10" ' +
    'stroke-linecap="round" stroke-linejoin="round"/>',
);
export const CTL_NEXT = custom('ctl-next') ?? ctlGlyph(
  '<path d="M30 50 H68 M53 34 L70 50 L53 66" fill="none" stroke="var(--ctl-mark)" stroke-width="10" ' +
    'stroke-linecap="round" stroke-linejoin="round"/>',
);
export const CTL_REPLAY = custom('ctl-replay') ?? ctlGlyph(
  '<path d="M69 43 A21 21 0 1 0 71 57" fill="none" stroke="var(--ctl-mark)" stroke-width="10" ' +
    'stroke-linecap="round"/>' +
    '<path d="M69 27 V43 H53" fill="none" stroke="var(--ctl-mark)" stroke-width="10" ' +
    'stroke-linecap="round" stroke-linejoin="round"/>',
);

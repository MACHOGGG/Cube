/**
 * 《炸弹挑战》第二层：三档 × 两副棋盘，一整页（10-08 方案 3-G）。
 *
 * 方案原话：「炸弹选择改全屏第二层——复用老虎机/步步为营现成的第二层组件（slotIntro/puzzleMode 那
 * 套），不新写层；整层放大到与老虎机层一致版式；『基础/计时/进阶』删文字、各配小图标（进 appIcons/
 * ctlIcons 体系，省掉一组四语文案）。图标源即 3-F-4 的 iconFor。」
 *
 * 从前这一步是主菜单那张炸弹卡飞到屏幕中间、放大成一扇挑选窗（ui/centerPicker.ts），背后是压暗的主
 * 菜单。计时、无限反转、步步为营、老虎机那几步 2026-09 起都是一整页，只有炸弹还是一扇窗——同一种
 * 「第二层」两套长相，而且窗里那六格只有 87px（390 宽的手机上，老虎机那一页一格 156）。
 *
 * 现在骨架就是挑图形那几页那一副：.slot-page ＋ .start-stage ＋ .slot-pick-area，页底那颗 .page-exit，
 * 返回键回主菜单。中间摆的还是第 18 推按设计图做的那块面板——陶土色、正中一颗白色八角星、三排两格、
 * 一排一个底板颜色——整块放大，格子按屏幕算到和老虎机那一页的图差不多大（算式在 style.css 的
 * .bomb-page 那一段）。面板左边那一列从「基础 / 计时 / 进阶」三个字换成三枚小图标：iconFor({ mode })
 * 不带棋盘，取那一档自己那一枚（ctlIcons 的 CTL_TIER_*，和全站《返回》《暂停》同一套圆盘画法）。
 *
 * 一格就是 iconFor({ mode, board })：按下去之后倒数页上摆的就是这一张（3-F-4）。
 *
 * 主菜单上那张炸弹卡不动（方案 3-D-5：「主菜单炸弹卡保留现有合成 icon，选项图标只出现在第二层」）：
 * 手机上是那枚炸弹图标，电脑上是这块面板的缩图，按下去都是开这一页。
 */
import { STRINGS, type Lang } from '../i18n';
import type { BombTier } from '../engine/bomb';
import type { ShapeCardMeta } from '../shapes/types';
import { bombPanelStar } from './homeIcons';
import { BOMB_MODE, iconFor } from './modeIcons';
import { shapeName } from './shapeLabels';
import { CTL_BACK } from './ctlIcons';

/** 一排：哪一档，和这一档开在哪两副棋盘上（左边方块那一族、右边小球那一族）。 */
export interface BombTierRow {
  tier: BombTier;
  cards: ShapeCardMeta[];
}

export interface BombModeHandlers {
  onBack: () => void;
  /** 按下了一格：这一档、这副棋盘，开这一局。 */
  onStart: (tier: BombTier, board: string) => void;
}

/** 读屏那一句里这一档叫什么（三个标题本来就有四语，不另加字）。 */
const TIER_TITLE = { basic: 'bombBasicTitle', timed: 'bombTimedTitle', advanced: 'bombAdvancedTitle' } as const;

export function renderBombModePage(root: HTMLElement, lang: Lang, rows: BombTierRow[], handlers: BombModeHandlers): void {
  const s = STRINGS[lang];
  root.innerHTML = `
    <div class="app slot-page bomb-page">
      <div class="start-stage">
        <div class="start-count slot-pick-area">
          <div class="bomb-pick">
            <!-- 左边那一列：一档一枚小图标，和自己那一排上下居中（对齐的道理在 style.css 的 .bomb-pick）。
                 aria-hidden：每一格自己的读屏名里已经带着这一档（「计时炸弹 · 方块」）。 -->
            <div class="bomb-tiers" aria-hidden="true">
              ${rows.map((r) => `<span class="bomb-tier bomb-tier--${r.tier}">${iconFor({ mode: BOMB_MODE[r.tier] })}</span>`).join('')}
            </div>
            <div class="bomb-panel">
              <span class="bomb-star" aria-hidden="true">${bombPanelStar()}</span>
              ${rows
                .map(
                  (r) => `
              <div class="bomb-row bomb-row--${r.tier}">
                ${r.cards
                  .map(
                    (c) => `<button class="bomb-chip" data-tier="${r.tier}" data-board="${c.id}"
                        aria-label="${s[TIER_TITLE[r.tier]]} · ${shapeName(lang, c.id, c.name)}">${iconFor({ mode: BOMB_MODE[r.tier], board: c.id })}</button>`,
                  )
                  .join('')}
              </div>`,
                )
                .join('')}
            </div>
          </div>
        </div>
        <button class="icon-btn page-exit" id="bombBack" aria-label="${s.back}">${CTL_BACK}</button>
      </div>
    </div>
  `;
  for (const chip of Array.from(root.querySelectorAll<HTMLButtonElement>('.bomb-chip'))) {
    chip.addEventListener('click', () => handlers.onStart(chip.dataset.tier as BombTier, chip.dataset.board!));
  }
  root.querySelector<HTMLButtonElement>('#bombBack')!.addEventListener('click', handlers.onBack);
}

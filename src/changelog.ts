import type { Lang } from './i18n';

/**
 * 更新说明（10-11 方案 B-9，玩家定的 Q6）。
 *
 * 主菜单那张「有新版本」卡上写哪一句，由这儿说了算：
 *
 *   · `RELEASE` 是人手递增的一个数。**只有大更新才加一、写一条**（谁写：Claude Code；玩家可以改）。改个
 *     bug、动一处样式不加——那种更新卡上说的是通用那一句「有新版本」。
 *   · 构建时 scripts/build-version.mjs 把 `RELEASE` 和这一条的四种语言写进 `/version.json`（`release`、
 *     `note`）。还开着旧页面的人问到它：线上的 `release` 比自己这一份大，卡上就是「新版本：{这一句}」。
 *   · 一句话说「多了什么」，**最简短**：简繁 ≤12 个字、英文 ≤40 个字符、法文 ≤48 个字符（门
 *     check-new-version 量）。例：「新增：每日挑战排名」。
 *
 * 写着「新增」的那一句是给**还在用旧版本的人**看的——他刷新之后才会看到那样东西。所以写进来的那一推，必须
 * 真的带着那样东西。
 *
 * 0 = 还没有写过一条：这一套从 10-11 起才有，线上的旧页面不认 `release`，照旧比 `sha`（见 engine/newVersion.ts）。
 */
export const RELEASE = 4;

export type ReleaseNote = Record<Lang, string>;

/**
 * 键是那一次的 `RELEASE`。
 *
 * 编号照 10-15 补充〇·三「RELEASE 重新编号」：P8（终局）→ 1、S9（步步为营第 3 版）→ 2、P14 → 3、S10 → 4、P18 → 5。
 * 第 1 号（10-14 方案 P8）、第 3 号（P14）那两推还没做，所以这儿暂时只有第 2、4 号——RELEASE 只许往上涨，哪一推先上线
 * 就先占号，后上线的那一推要接着往上编（别回头去填 1、3）。
 */
export const CHANGELOG: Readonly<Record<number, ReleaseNote>> = {
  2: {
    zhHans: '改进：步步为营新规则',
    zhHant: '改進：步步為營新規則',
    en: 'Step by step has new move rules',
    fr: 'Nouvelles règles pour Pas à pas',
  },
  // 10-15 补充 S10（K-4）：Pro 改成单人局的固定翻色 + 颜色轮盘。
  4: {
    zhHans: '新版 Pro：颜色绕一圈',
    zhHant: '新版 Pro：顏色繞一圈',
    en: 'New Pro: colours flip in a fixed loop',
    fr: 'Nouveau Pro : couleurs en boucle fixe',
  },
};

/** 每种语言最长多少（简繁按字、英法按字符）。 */
export const NOTE_MAX: Readonly<Record<Lang, number>> = { zhHans: 12, zhHant: 12, en: 40, fr: 48 };

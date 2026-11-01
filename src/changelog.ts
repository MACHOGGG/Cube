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
export const RELEASE = 14;

export type ReleaseNote = Record<Lang, string>;

/**
 * 键是那一次的 `RELEASE`。
 *
 * 编号照 10-15 补充〇·三「RELEASE 重新编号」：P8（终局）→ 1、S9（步步为营第 3 版）→ 2、P14 → 3、S10 → 4、P18 → 5。
 * 第 1 号（10-14 方案 P8）、第 3 号（P14）那两推还没做，所以这儿暂时只有第 2、4 号——RELEASE 只许往上涨，哪一推先上线
 * 就先占号，后上线的那一推要接着往上编（别回头去填 1、3）。
 * 10-18 补充照这条先占号：T3（暂停面板的声音、振动）→ 5、T4（色盲纹理）→ 6。原先排给 P18 的 5 被占了，P18 上线时接着往上编。
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
  // 10-18 补充 T3（M-3）：暂停面板加「声音」「振动」两行。
  5: {
    zhHans: '暂停里可关声音和振动',
    zhHant: '暫停裡可關聲音和震動',
    en: 'Sound and vibration switches in pause',
    fr: 'Son et vibrations réglables en pause',
  },
  // 10-18 补充 T4（M-4）：色盲友好配色开着时，棋子身上多一层和颜色一一对应的纹理。
  6: {
    zhHans: '色盲友好配色加上纹理',
    zhHant: '色盲友好配色加上紋理',
    en: 'Colourblind palette now adds patterns',
    fr: 'Des motifs sur les pièces pour les daltoniens',
  },
  // 10-31 方案推04（Z-K01、Z-K02）：老虎机 / 无限反转 / 炸弹那三句一句话提示改成实话，规则书删「天才特供」。
  7: {
    zhHans: '改进：玩法提示更准确',
    zhHant: '改進：玩法提示更準確',
    en: 'Clearer tips for each game mode',
    fr: 'Astuces de mode plus précises',
  },
  // 10-31 方案推05（Z-C01–C03）：教学条换条等盘面、A 起就亮灯、E 亮步数最少的那一下、第 1 条换成站长原话、句末去句号。
  8: {
    zhHans: '改进：教学跟着棋盘走',
    zhHant: '改進：教學跟著棋盤走',
    en: 'Tutorial tips now follow your board',
    fr: 'Le tutoriel suit votre plateau',
  },
  // 10-31 方案推06（Z-C04、Z-C05）：教学只活在一局里、走到结算页才记看过；所有玩法《再来一局》都先倒数。
  9: {
    zhHans: '再来一局也有倒数',
    zhHant: '再來一局也有倒數',
    en: 'Play again now counts down first',
    fr: 'Rejouer lance un compte à rebours',
  },
  // 10-31 方案推10（Z-D11）：电脑端个人主页两栏上下居中，《返回》换成全站那颗大《退出》（手机一起换）。
  10: {
    zhHans: '电脑版个人主页居中',
    zhHant: '電腦版個人主頁居中',
    en: 'Profile page centred on desktop',
    fr: 'Profil centré sur ordinateur',
  },
  // 10-31 方案推12（Z-J03）：每个玩法前两局，暂停那块牌上多一颗灯泡（附录甲 §1 推12 那一行）。主菜单一步一步出现（Z-J02）
  // 不另加（站长 10-30：老玩家开机就补到原来那一步，新玩家没有旧版本可比）。
  11: {
    zhHans: '新增：局中灯泡提示',
    zhHant: '新增：局中燈泡提示',
    en: 'New: a hint bulb in your first games',
    fr: 'Nouveau\u00a0: l\u2019ampoule d\u2019aide',
  },
  // 10-31 方案推14（Z-B23，ero2 全站规则大更新、清档）：V16 站长定的简体原文（附录甲 §1 推14 那一行）。收尾逐一消除、整线消除
  // 音、榜单重做、Pro 新规都并在这一条里，不另占号。
  12: {
    zhHans: '新规则上线，战绩重新开始',
    zhHant: '新規則上線，戰績重新開始',
    en: 'New rules are live: records start fresh',
    fr: 'Nouvelles r\u00e8gles en ligne \u2014 palmar\u00e8s \u00e0 z\u00e9ro',
  },
  // 11-01 补充方案推15A：主菜单触屏慢拖没反应（onLostCapture 把卡片交出隐式捕获当成松手；慢拖不到约 160px 本来也不换站）。
  // 站长给的原文是「修复：主菜单慢慢滑也能换玩法」（14 个字），简繁上限 12 个字，删「主菜单」三个字：「换玩法」已经说了是哪儿。
  13: {
    zhHans: '修复：慢慢滑也能换玩法',
    zhHant: '修復：慢慢滑也能換玩法',
    en: 'Fixed: slow swipes now switch modes',
    fr: 'Corrig\u00e9\u00a0: glisser lentement change de mode',
  },
  // 11-01 补充方案推15B：暂停｜灯泡那块牌两半各摆正中、电脑上灯泡也不画圆盘；暂停面板标题和每一行靠左、两颗出口竖排。
  // 站长给的原文「改进：暂停键、教学灯泡和暂停面板排得更整齐」21 个字，简繁上限 12 个字，收成「暂停键和面板」——灯泡是
  // 暂停那块牌的另一半。
  14: {
    zhHans: '改进：暂停键和面板更整齐',
    zhHant: '改進：暫停鍵和面板更整齊',
    en: 'Tidier pause button and pause menu',
    fr: 'Pause\u00a0: bouton et menu mieux align\u00e9s',
  },
};

/** 每种语言最长多少（简繁按字、英法按字符）。 */
export const NOTE_MAX: Readonly<Record<Lang, number>> = { zhHans: 12, zhHant: 12, en: 40, fr: 48 };

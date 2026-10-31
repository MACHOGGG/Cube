/**
 * 三个带钟的玩法，一个时长。
 *
 * 原先是三个数写在三处：《计时挑战》60 秒（main.ts 那一句字面的 `timeLimitSec: 60`）、
 * 《定时炸弹》90 秒（`tier === 'timed' ? 90`）、《无限反转》60 秒（自己的
 * `FLIP_SECONDS`，而且它从 120 改到 60 的时候，小红书版那一份是**手抄**过去的）。
 * 三处各写一个数，于是：
 *
 * - 玩家在同一个 app 里要记三个时长，而屏幕上只有一句小字告诉他是哪一个；
 * - 界面上那句「60s 挑战」和炸弹图标上那枚「90s」都是**手写的字**，和真正生效的数
 *   没有任何关系——改了一头忘了另一头，屏幕上就写着一个数、跑着另一个数；
 * - 小红书那一份靠注释「和网页版同一个数」维持同步，注释维持不了任何东西。
 *
 * 玩家 2026-09 拍板三个统一成 **100 秒**，只留一个数（MODE_SECONDS），让上面那三种走样都失去发生的地方。
 *
 * ero2（站长 10-22、10-25 定，10-31 方案推14 Z-B05）改成现在这两条：
 *   · 《计时挑战》《定时炸弹》按棋盘：经典小球 60 秒、经典方块 100 秒（只有这两副开得出这两档，seedCode.ts 的
 *     VARIANTS）——`TIMED_SECONDS` / `timedSecondsFor`；
 *   · 《无限反转》留 100 秒——`FLIP_SECONDS`，服务器手抄一份（api/_maxscore.js 的 FLIP_SECONDS）。
 * 数仍旧只写在这一个文件里。屏幕上那几句话里的秒数：MODE_TIPS.timed 用 `{s}` 按棋盘现填（ui/modeTips.ts 的
 * timedTipText），规则书和挑形状页那一句写死两个数——门 `scripts/check-mode-clock.mjs` 把它们钉在这两个常量上。
 */
/** 计时挑战、定时炸弹一局几秒，按棋盘（站长 10-22、10-25）。只有经典方块、经典小球开得出这两档（seedCode.ts 的 VARIANTS）。 */
export const TIMED_SECONDS: Readonly<Record<string, number>> = Object.freeze({ square: 100, circle: 60 });
export const timedSecondsFor = (shapeId: string): number => TIMED_SECONDS[shapeId] ?? 100;
/** 《无限反转》一局几秒（站长定：留 100）。服务器手抄一份：api/_maxscore.js 的 FLIP_SECONDS。 */
export const FLIP_SECONDS = 100;

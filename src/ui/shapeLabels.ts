import type { Lang } from '../i18n';
import { menuTag } from './menuTags';

/**
 * 每一副棋盘的 ShapeCardMeta.id。card.name 本身是模块加载时写死的中文（那时候还没选语言），
 * 只当内部标识和兜底，不直接拿来显示。
 *
 * 下面两副棋盘 2026-09 删了（《侵蚀阶梯》v1.2 PR-6：原《三角》id `triangle`、V 形
 * `triangleAdvanced`）。**这两个 id 故意留着**：云端存着的旧战绩、别人寄来的旧分享卡里还带着
 * 它们，查得到名字总比在记录页上显示一串 id 好——而 card 对象已经没了，兜底的 fallback 只会是
 * id 本身。
 */
const BOARD_IDS = new Set(['square', 'circle', 'circleHex', 'squareDiamond', 'triangleBig', 'circleSeven', 'triangle', 'triangleAdvanced']);

/**
 * 一副棋盘在界面上叫什么：**就是主菜单那张卡上的名字**（ui/menuTags.ts），全站只有这一份。
 *
 * 10-09 补充方案第一部分第 5 条（原方案第四批第 9 条，玩家答复「全部一起统一，以 menuTags.ts
 * 现有名字为准，规则页、成绩页、分享卡等处全改」）。从前这儿查的是 i18n 里另一套
 * shapeName*：结算页、分享卡、每一局的标题、主菜单卡的读屏名用那一套（方块 / 圆球 / 大三角 /
 * 七色圆球，Square / Big Triangle，Carré / Grand triangle），卡面上的字用 menuTags 那一套（经典
 * 方块 / 经典小球 / 六边形三角 / 菱形小球……）——同一副棋盘两个名字，读屏念的和眼睛看到的都不
 * 一样。第四批先对齐了小球一族的英法，这一次三族四种语言一起对齐，并且干脆不留第二份：那八条
 * i18n 字串删了，这儿直接取卡名。门：check-rules-counts 第 ⑤ 节。
 *
 * 认不出的 id 回 `fallback`（调用方给的是 card.name 或 id 本身）。
 */
export function shapeName(lang: Lang, id: string, fallback: string): string {
  return BOARD_IDS.has(id) ? menuTag(lang, id) || fallback : fallback;
}

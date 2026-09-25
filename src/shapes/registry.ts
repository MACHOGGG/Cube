/**
 * 八副棋盘的名片，按 id 查——**「这一副归哪一族、按哪一套规则讲」只有这一个答案。**
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么要有这个文件
 *
 * 从前这件事是**猜**出来的，而且猜的地方有四处、对不认识的 id 给出**三种不同的静默
 * 默认值**：
 *
 *   | 函数 | 在哪 | 怎么判 | 不认识的 id 给什么 |
 *   | --- | --- | --- | --- |
 *   | `familyOf`         | ui/gameShell.ts   | 看前缀 | `'square'`   |
 *   | `rulesShapeOf`     | ui/gameShell.ts   | squareDiamond 特判，其余走 familyOf | `'square'` |
 *   | `tutorialFamilyOf` | ui/multiplayer.ts | 看前缀 | `null`       |
 *   | `slotFamilyOf`     | main.ts           | 完全相等 | `'triangle'` |
 *
 * 下一副新棋盘只要 id 不以 square / circle / triangle 开头，就会在三个地方被分进三个
 * 不同的家族，而且**不报任何错**——老虎机给它转错族的图案、《怎么玩》念错那一条、
 * 教学配图配错一族，三样各错各的，屏幕上没有一处看得出来是同一个原因。
 *
 * 前缀之所以一直没出事，是**运气**：两个三角 2026-09 对调过内容（main.ts 那两行有意
 * 交叉），恰好两个 id 都以 triangle 开头。gameShell 里那句「按前缀认就不受这件事影
 * 响」说的是这个巧合，不是一条保证。
 *
 * 现在：家族和规则由棋盘**自己在 card 里声明**（`ShapeCardMeta` 的 family /
 * ruleShape，必填——少填一副 `npm run typecheck` 当场编译不过），这儿只负责按 id 查
 * 到那张名片，查不到就**明确报错**，不再悄悄给个默认值。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么是「注册」而不是这儿直接 import 八个工厂
 *
 * 八副棋盘每一副都 `import { buildShell } from '../ui/gameShell'`，而 gameShell 要用
 * 这儿的 `cardOf`。这儿再反过来 import 八个工厂就成环了——ESM 不会报错，但模块初始化
 * 的顺序会让这张表在 gameShell 第一次用它的时候还是空的，于是查什么都「不认识」。
 *
 * 所以由 `src/main.ts` 注册：它是整张图的顶点，而且**本来就在模块加载时把八个游戏都
 * 建好了**（工厂只是返回一个带 card 和 mount 的对象，摸 DOM 的事全在 mount 里）。
 * 注册那一句就在那八行旁边，早于任何界面跑起来。
 */
import type { ShapeCardMeta } from './types';
import type { Family } from '../engine/targets';

const BY_ID = new Map<string, ShapeCardMeta>();

/** main.ts 在建好八个游戏之后调一次。重复注册同一个 id 直接覆盖（热重载时会发生）。 */
export function registerCards(cards: readonly ShapeCardMeta[]): void {
  for (const card of cards) BY_ID.set(card.id, card);
}

/**
 * 这一副棋盘的名片。**查不到就抛**——不给默认值是这个文件存在的全部意义。
 *
 * 会抛的两种情形都该抛：新棋盘忘了注册（当场暴露，而不是被悄悄分错家族），或者
 * 拿一个根本不是棋盘 id 的字符串来查（那是调用点的 bug）。**外面来的字符串**
 * （服务器发的小屋 mode、存档里的旧 id）要用 `cardOrNull`，别用这个。
 */
export function cardOf(id: string): ShapeCardMeta {
  const card = BY_ID.get(id);
  if (!card) {
    throw new Error(
      `不认识的玩法 id：${id}。` +
        `八副棋盘的名片由 main.ts 调 registerCards 注册（见 shapes/registry.ts 文件头）；` +
        `新加一副要记得加进那一串。`,
    );
  }
  return card;
}

/**
 * 同上，但查不到就回 `undefined`。
 *
 * 给**外面来的字符串**用：服务器发的小屋 `mode`、本地存档里的旧 id。那些不在我们
 * 手里，拿它们抛异常等于让一条脏数据把玩家的界面整个打掉。
 */
export function cardOrNull(id: string): ShapeCardMeta | undefined {
  return BY_ID.get(id);
}

/** 三个族名本身（服务器的 SLOT_MODES 就是这三个字符串）。 */
export const FAMILIES: readonly Family[] = ['square', 'circle', 'triangle'];

/**
 * 把一个**族名**认回 Family。
 *
 * 输入不是棋盘 id，是族名——小屋那一局的 `mode` 在老虎机那一档就是这三个字符串之一
 * （见 api/room.js 的 `SLOT_MODES`），所以这儿做完全匹配，**不查名片表**。
 *
 * 认不出来就抛，不再拿 `'triangle'` 兜底：兜底的后果是把三角的得分图案发到一副方块
 * 棋盘上，玩家要凑的图案根本凑不出来，而屏幕上一个字的错都没有。真收到别的值，那是
 * 前后端的协议不对上了，那种事该响。
 */
export function familyFromName(name: string): Family {
  const found = FAMILIES.find((f) => f === name);
  if (!found) throw new Error(`不是族名：${name}（该是 ${FAMILIES.join(' / ')} 之一）`);
  return found;
}

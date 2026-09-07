/**
 * 这一版的教学分两层，这个文件管第二层的入口，外加两层各自「看过没有」的记账。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 第一层：分镜动画，没有一个字
 *
 * 第一次点开《经典方块》放方块那一段，第一次点开《经典小球》放小球那一段，
 * 各放一次，看过就记住。用的是网页版那两个原件（src/ui/tutorial.ts 与
 * src/ui/circleTutorial.ts），速度、下面那四颗键全是它们自带的，这一版不加不
 * 减不改。挂它的地方在 main.ts 的 showShapeStory。
 *
 * 分镜不再自己弹出来（玩家定的）：想看的人到成绩与说明页的《怎么玩》里，
 * 自己按那两颗键。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 第二层：六条规则，有字有配图
 *
 * 那一屏本身现在住在 src/ui/rulesModal.ts——网页版局中按《暂停》里那一颗
 * 《怎么玩》开的是同一份（玩家定的：「网页端的《怎么玩》同步小红书的版
 * 本」）。这个文件只剩一件事：替这一版把 triangle 关掉，别的原样转交。
 *
 * 它**不会自己跳出来**，只有两个入口，都得玩家自己按：
 *
 *   · 成绩与说明页上一颗《怎么玩》（profile.ts）
 *   · 局中按暂停，面板里一颗《怎么玩》（现在由 gameShell 自带）
 *
 * 玩家定的分工：前面先看一段纯动画；还有疑问的人，自己到这两处来看字。
 */
import { type Lang } from '../../src/i18n';
import { buildRuleArt } from '../../src/ui/ruleArt';
import { openRulesModal, type StoryFamily } from '../../src/ui/rulesModal';

/**
 * 这一版的六幅配图：摘掉三角那一列。
 *
 * 只有第 1 幅有三角（它画的是「每个图形都有正反两面」，网页版是方块、小球、
 * 三角各一列），这一版剩方块和小球两列——这一版整块没有三角，讲一个玩家在
 * 这儿见不到的图形，只会让人以为自己漏了什么。别的五幅本来就只有方块和小球。
 *
 * 导出去是因为头一局那块教学条（ui/coachBar.ts）要的是同一份——两处画的是
 * 同样六条规矩，配图不能一处有三角、另一处没有。
 */
export const RULE_ART = buildRuleArt({ triangle: false });

/**
 * 教学条在一局里用的那两份：讲小球那一局画小球，讲方块那一局画方块。
 *
 * 上面那一份（RULE_ART）是《怎么玩》整页用的通稿——那一页玩家还没挑玩法，
 * 两种图形都要照顾到。棋盘底下那块条子不一样：他眼前只有一种图形，画另一
 * 种是在他手上这一局里插一段用不上的画（玩家定的：「把逐步教学的图形从方
 * 块改为小球，除了第一条以外」）。第 1 条两份都一样——它讲的正是「每个图形
 * 都有正反两面」，本来就要并排摆几种。
 */
export const RULE_ART_CIRCLE = buildRuleArt({ triangle: false, shape: 'circle' });
export const RULE_ART_SQUARE = RULE_ART;

/** 会放分镜动画的两族。三角整块不做，所以只有这两个。 */
export type { StoryFamily };

/**
 * 哪一族的分镜动画看过了，各记一格。
 *
 * 键名带 `slides.xhs.` 前缀，和网页版那三个（slides_tutorial_seen…）分开：玩家
 * 的第一条要求是「分开保存，与网页端、微信端完全分离」。真机上本来就是两个
 * 域、两份存档，但在同一个浏览器里看预览页时这条前缀是唯一的隔离。
 *
 * 存不进去（隐私模式、容器把 localStorage 关了）就当没看过——顶多多放一遍，
 * 不会出错。
 */
const STORY_KEY: Record<StoryFamily, string> = {
  square: 'slides.xhs.story.square',
  circle: 'slides.xhs.story.circle',
};

export function storySeen(fam: StoryFamily): boolean {
  try {
    return localStorage.getItem(STORY_KEY[fam]) === '1';
  } catch {
    return false;
  }
}

export function markStorySeen(fam: StoryFamily): void {
  try {
    localStorage.setItem(STORY_KEY[fam], '1');
  } catch {
    /* 存不下就算了，下次再放一遍也不是什么大事 */
  }
}

/**
 * 打开《怎么玩》那一屏。返回一个关掉它的函数（换屏的时候要用——弹窗是挂在
 * body 上的，不跟着 #app 一起被清掉）。
 *
 * 只有玩家自己按了才会走到这儿——这一屏不自动跳出来。
 *
 * @param onStory 给了就在六条规则上头摆两颗键（方块 / 小球），按下去放那一族的
 *   分镜动画。只有成绩与说明页那个入口会给——分镜不再自己弹出来（玩家定的），
 *   想看的人从那儿自己点。局中按暂停开的这一屏不给：他正在玩，不该在这儿被
 *   一段动画接走。
 */
export function openTutorial(
  lang: Lang,
  onClose?: () => void,
  onStory?: (fam: StoryFamily) => void,
): () => void {
  // triangle: false 是这一版和网页版唯一的分歧——这一版整块没有三角，讲一个
  // 玩家在这儿见不到的图形只会让人以为自己漏了什么。
  return openRulesModal({ lang, triangle: false, onClose, onStory });
}

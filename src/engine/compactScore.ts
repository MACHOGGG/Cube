/**
 * 把一个没有上限的分数缩短成「放得进一个固定小格子」的写法。
 *
 * 中文用万/亿，别的语言用 K/M/B。十万以下原样不动——那个量级本来就短，缩了
 * 反而看不出差别（3210 和 3.2K 一样长，还多了一层换算）。
 *
 * 繁体那份写「萬」「億」：「万」「亿」是简体字形，摆在一屏繁体字中间是显眼的
 * 错字。这个函数原先只在《累计得分》那一张卡上用，两个字混在大号数字里不容易
 * 被看见；现在两块缩略牌里每一行都印一遍，非改不可。
 *
 * 两处在用，都是「小格子里的预览，完整的那份一点就有」：
 *   · 《记录与排名》顶上那张累计得分卡（ui/recordsPage.ts），点开看全部位数
 *   · 那一页两块缩略牌里的分数（同上、ui/leaderboard.ts 的 mountBoardThumb），
 *     点开是整页的记录 / 整张榜，那儿写的是一位不少的原数
 *
 * 为什么缩略牌里非缩不可：那两块是 `1fr 1fr` 的左右两半，而 `1fr` 的下限是
 * **内容的最小宽度**——一个十位数的分数（等宽字体，不能折行）能把自己那一半
 * 撑过半幅，先把另一半挤扁，再把整块顶出屏幕。玩家实拍到过（2026-09：榜上
 * 一个 1000000000 把整块排行榜顶到屏幕外面）。样式那边用 minmax(0, 1fr) 挡住
 * 了「挤扁另一半」，而「自己这一半装不下」只能由数字自己短下来。
 */
import type { Lang } from '../i18n';

export function compactScore(n: number, lang: Lang): string {
  const zh = lang === 'zhHans' || lang === 'zhHant';
  const cut = (v: number, unit: string) => {
    const t = (n / v).toFixed(n / v >= 100 ? 0 : 1);
    return (t.endsWith('.0') ? t.slice(0, -2) : t) + unit;
  };
  if (zh) {
    const [wan, yi] = lang === 'zhHant' ? ['萬', '億'] : ['万', '亿'];
    if (n >= 1e8) return cut(1e8, yi);
    if (n >= 1e5) return cut(1e4, wan);
    return String(n);
  }
  if (n >= 1e9) return cut(1e9, 'B');
  if (n >= 1e6) return cut(1e6, 'M');
  if (n >= 1e5) return cut(1e3, 'K');
  return String(n);
}

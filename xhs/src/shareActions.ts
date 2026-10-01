/**
 * 一张战绩图 + 底下那两颗键：《发笔记》《存相册》。
 *
 * 两个地方用到同一套：一局打完的结算页（游戏自带的那个分享窗口，见
 * main.ts 的 enhanceShareOverlay），和成绩页里点开的某一局（runSheet.ts）。
 * 所以文案、按键、失败提示都写在这一个文件里，两处不会各自漂。
 *
 * 为什么不能沿用网页版那条路：网页版的分享窗口写着「长按图片保存」，靠的是
 * 浏览器长按菜单——小工具的容器把它禁掉了，玩家长按什么也不会发生。规范给
 * 的替代品是两个原生接口（发笔记 / 存相册），见 bridge.ts。
 */
import type { RunData } from '../../src/engine/runRecord';
import { inMiniTool, postNote, readableError, saveToAlbum } from './bridge';

/**
 * 小红书给标题的上限：**20 个字**，ASCII 也按一个算（`Slides` 就是 6 个）。
 *
 * 这个数是这一整段的由来，所以摆在最上面。下面那两个常数都是为它让路的。
 */
const TITLE_MAX = 20;

/**
 * 笔记的标题。玩家 2026-09 给的原话是：
 *
 *   「我在Slides小工具单局就**分，你咧？」
 *
 * 整句连四位分数是 24 个字，放不下。玩家从几版里挑了这一版（当时列的 D 版）：
 * 砍掉「我在」和那个「就」，保住「小工具」三个字——他要的是标题里就出现「小工
 * 具」，因为那是小红书上搜得到的名字。
 *
 *   Slides小工具单局{分数}分，你咧？      四位分数 20 个字，正好卡住
 *
 * **五位分数会多出一个字**，所以多一条退路：那时候把「小工具」摘掉，换成
 * `Slides单局{分数}分，你咧？`（五位是 18 个字，六位也够）。摘的是标题里最不值钱
 * 的三个字——正文第一句本来就写着「小红书搜索Slides小工具」，标题再说一遍是重复；
 * 而被平台截断会把句尾那个「？」吃掉，留下半句话。
 *
 * 五位分数真会出现：综合分 = 拼出分 × 步数系数（engine/stepCoef.ts），方块满盘
 * 清完拼出分约 300，系数打得好能到几十倍。所以这条退路不是摆设。
 */
export function noteTitle(score: number): string {
  const full = `Slides小工具单局${score}分，你咧？`;
  return full.length <= TITLE_MAX ? full : `Slides单局${score}分，你咧？`;
}

/**
 * 笔记正文。玩家 2026-09 逐字给的，一个字没改。
 *
 * **不带这一局的分数和用时了**（从前是「我随手就能 N 分，在 M 内就完成」）：新
 * 这一版的正文里没有留位置，分数由标题带。所以这一段现在是个定值，`d` 只剩下
 * 「调用处都传着它」这一个理由——留着形参是为了两处调用不用改，也为了哪天正文
 * 又要用到这一局的数时不必回头改签名。
 *
 * 第一句「小红书搜索Slides小工具」是有意的：笔记会被不在小红书里的人看到，得先
 * 说清在哪儿搜得到；网页端那一版跟在后面。
 */
export function noteContent(_d: RunData): string {
  return (
    '小红书搜索Slides小工具，完整版在网页端Play-slides.com。' +
    'Slides是一款原创的滑动补偿拼图游戏。滑动、得分、消除，一步步得分解谜。' +
    '它上手极其简单，轻松得分，可是想要拿到高分却不容易，考验玩家的高智商，' +
    '在最少的行动、最短的时间中随机应变，消除干净。' +
    '完整版有多人小屋在线对战、注册即免费解锁的Slides天才玩法、全球排行榜、计时挑战、' +
    '以及更多进阶玩法和布局供你来玩～'
  );
}

/**
 * 把两颗键 + 一行提示装进 `host`。
 *
 * `dataUri` 是战绩图（renderShareCard 吐出来的 PNG data:uri），`run` 用来
 * 填笔记里的分数和用时。
 */
export function mountShareActions(host: HTMLElement, dataUri: string, d: RunData): void {
  const bar = document.createElement('div');
  bar.className = 'xhs-share-bar';
  bar.innerHTML = `
    <button class="xhs-share-btn xhs-share-btn--note" type="button">发笔记</button>
    <button class="xhs-share-btn" type="button">存相册</button>
    <p class="xhs-share-note" role="status"></p>
  `;
  const [noteBtn, albumBtn] = Array.from(bar.querySelectorAll<HTMLButtonElement>('.xhs-share-btn'));
  const say = bar.querySelector<HTMLElement>('.xhs-share-note')!;

  // 不在小红书里（我的预览页、浏览器）就没有那两个原生接口。键留着但按不
  // 动，并说清楚为什么——比按下去一声不响强。
  if (!inMiniTool()) {
    noteBtn.disabled = true;
    albumBtn.disabled = true;
    say.textContent = '发笔记和存相册要在小红书里才能用';
    host.appendChild(bar);
    return;
  }

  /** 一次点击：先禁键防连点，说一句在做什么，做完再说结果。 */
  const run = async (btn: HTMLButtonElement, doing: string, done: string, job: () => Promise<void>) => {
    if (btn.disabled) return;
    noteBtn.disabled = true;
    albumBtn.disabled = true;
    say.textContent = doing;
    try {
      await job();
      say.textContent = done;
    } catch (err) {
      say.textContent = readableError(err);
    } finally {
      noteBtn.disabled = false;
      albumBtn.disabled = false;
    }
  };

  noteBtn.addEventListener('click', () =>
    run(noteBtn, '正在打开…', '去发布页改两句就能发', () =>
      postNote({ title: noteTitle(d.totalScore), content: noteContent(d), imageDataUri: dataUri }),
    ),
  );
  albumBtn.addEventListener('click', () =>
    run(albumBtn, '正在保存…', '已经存进相册了', () => saveToAlbum(dataUri)),
  );

  host.appendChild(bar);
}

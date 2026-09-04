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
import { formatClock } from '../../src/engine/runRecord';
import type { RunData } from '../../src/engine/runRecord';
import { inMiniTool, postNote, readableError, saveToAlbum } from './bridge';

/** 完整版在哪儿。笔记正文里带一次。 */
const SITE = 'play-slides.com';

/**
 * 笔记的标题。玩家给的原话是：
 *
 *   「Slides 单局 **** 分！拼色块而已，你能更强吗？！」
 *
 * 但规范把标题卡在 **20 个字**以内，整句放不下（含四位分数是 30 个字）。
 * 所以在句号处切开：前半句当标题（17 个字，五位分数也塞得下），后半句
 * 「拼色块而已，你能更强吗？！」挪到正文第一行——一个字没丢，只是换了位置。
 */
export const noteTitle = (score: number): string => `Slides 单局 ${score} 分！`;

/** 标题里没放下的那半句，正文从它起头。 */
const HOOK = '拼色块而已，你能更强吗？！';

/**
 * 笔记正文。玩家给的原文，两个 ** 换成这一局的真数：综合得分、用时。
 */
export function noteContent(d: RunData): string {
  const score = d.totalScore;
  const time = formatClock(d.elapsedSec);
  return (
    `${HOOK}\n\n` +
    `我随手就能${score}分，在${time}内就完成，你行么？` +
    `Slides是一款原创的滑动补偿拼图游戏。通过滑动、翻面、消除得分解谜。` +
    `它上手极其简单，轻松得分，可是想要拿到高分却不容易，考验玩家的高智商，` +
    `在最少的行动、最短的时间里随机应变，得到最多的分数。` +
    `完整版有多人小屋在线对战、Slides天才特供、全球排行榜、计时挑战、` +
    `以及更多玩法和布局供你来玩，详情请访问${SITE}。`
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

/**
 * 开场动画的单独版：一个只放那段动画的页面。
 *
 * 玩家的原话：「现在开场动画的部分你能否导出一个版本无论是高清视频格式还是
 * 某个可以跑出原动画的文件格式我可以使用？」——出来的 splash.html 就是后
 * 者：一个文件，双击就放，拖到任何浏览器里都行，也能贴进 keynote / 网页 /
 * Artifact。
 *
 * 它放的是**真的那一段**，不是照着做的一份：showLoadingScreen 就是网站开
 * 屏时调的那个函数（src/ui/loadingScreen.ts），这里只是换了个地方喊它。哪
 * 天动画调了，重出一次这个文件，导出的也跟着变——不会出现「网站上是新的，
 * 手里那份还是旧的」。
 *
 * 三件为「导出」而加的事，网站上都没有：
 *   · 放完自己再放一遍（网站上放完就进游戏了）；
 *   · 一个尺寸挑子，1080 / 1440 / 2160 见方——录屏、截帧、放大看都用得上；
 *   · 一颗《再放一次》，和一个 ?loop=0 让它只放一遍（截帧脚本用这个）。
 *
 * 出这个文件：npm run build:splash
 */
import '../../src/style.css';
import '../../src/ui/loadingScreen.css';
import { showLoadingScreen } from '../../src/ui/loadingScreen';

const params = new URLSearchParams(location.search);
const loop = params.get('loop') !== '0';
/** 那扇窗要多大。给的是**导出画布**的边长，动画自己按它缩放。 */
const size = Math.max(240, Math.min(4096, Number(params.get('size')) || 1080));
/** 截帧脚本会把这个设成 1：只留那扇窗，别的什么都不画。 */
const bare = params.get('bare') === '1';

const stage = document.createElement('div');
stage.id = 'stage';
document.body.appendChild(stage);

const bar = document.createElement('div');
bar.id = 'bar';
if (!bare) {
  bar.innerHTML =
    `<button type="button" id="again">再放一次</button>` +
    `<span class="sizes">` +
    [1080, 1440, 2160].map((s) => `<button type="button" data-size="${s}"${s === size ? ' aria-pressed="true"' : ''}>${s}</button>`).join('') +
    `</span>` +
    `<span class="note">这一段就是网站开屏时放的那一段</span>`;
  document.body.appendChild(bar);
}

// 那扇窗的边长在 loadingScreen 里是 min(320, 短边 × 0.58)，也就是最大 320。
// 想要 1080 见方的画布，就把整段按 1080/320 放大——放大的是 CSS transform，
// 里面每一笔仍是矢量，多大都不糊。
const SPLASH_SIDE_MAX = 320;
function applySize(): void {
  const k = size / SPLASH_SIDE_MAX;
  stage.style.width = size + 'px';
  stage.style.height = size + 'px';
  document.documentElement.style.setProperty('--k', String(k));
}

let playing = false;
async function play(): Promise<void> {
  if (playing) return;
  playing = true;
  const done = showLoadingScreen();
  // showLoadingScreen 把那一层挂在 document.body 上（网站上它就该盖住整屏）。
  // 这儿要的是「摆进舞台里、跟着舞台缩放」，所以立刻搬过来——它是同步挂上去
  // 的，这一行跑到的时候节点已经在了。
  const layer = document.body.querySelector<HTMLElement>(':scope > .splash');
  if (layer) stage.appendChild(layer);
  await done;
  playing = false;
  if (loop) setTimeout(play, 400);
}

applySize();
play();

bar.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  const s = b.getAttribute('data-size');
  if (s) {
    const u = new URL(location.href);
    u.searchParams.set('size', s);
    location.href = u.href;
    return;
  }
  play();
});

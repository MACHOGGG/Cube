/**
 * 介绍页——这一版自己的东西（网页版没有这一屏）。
 *
 * 只说三件事：这是什么、完整版在哪、以后可能有 APP。文字少，是玩家定的全站
 * 规矩之一。
 *
 * 网址只能是**文字**，不能做成可点的链接：小工具禁止跳转站外，也禁止
 * window.open（见 device-capabilities.md 的「不可用行为」）。剪贴板也被禁
 * 了，所以连「复制网址」都做不了——只能让人看着敲。
 */
import { CTL_BACK } from '../../src/ui/ctlIcons';

export interface AboutHandlers {
  onBack: () => void;
}

const SITE = 'play-slides.com';

export function renderAboutPage(root: HTMLElement, h: AboutHandlers): void {
  root.innerHTML = `
    <div class="app xhs-about">
      <div class="home-head">
        <div class="home-head-glass">
          <h1 class="home-title">Slides</h1>
          <p class="home-sub tag-line">滑动 – 得分 – 消除</p>
        </div>
      </div>
      <div class="xhs-about-body">
        <p class="xhs-about-line">这里是 Slides 的小红书版，五个玩法，全部免费。</p>
        <p class="xhs-about-line">完整版有更多布局、计时挑战、多人小屋和全球排行榜：</p>
        <p class="xhs-about-site">${SITE}</p>
        <p class="xhs-about-note">后续可能推出 APP 版。</p>
      </div>
      <div class="start-actions">
        <button class="icon-btn start-act" id="aboutBack" aria-label="返回">${CTL_BACK}</button>
      </div>
    </div>
  `;
  root.querySelector<HTMLButtonElement>('#aboutBack')!.addEventListener('click', h.onBack);
}

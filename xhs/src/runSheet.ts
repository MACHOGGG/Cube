/**
 * 点开成绩页里的某一局，看那一张战绩图。
 *
 * 图是现画的——用网页版那支 renderShareCard，喂进存档里留着的开局和结束两
 * 张棋盘照片。所以这一屏和网页版《记录与排名》里点开一条记录看到的是同一张
 * 图（那边的做法见 src/ui/recordsPage.ts 的 openRunCard）。
 *
 * 有一种局画不出来：存档只给最近十局留照片（persistence.ts 的 MAX_RUNS，
 * 为了不把手机存储撑爆），再往前的只剩分数。那种局**照样点得开**，只是图
 * 的位置换成一句话——玩家定的：「能点，点开说一句『这一局太久了，照片没留
 * 住』」。
 */
import { renderShareCard } from '../../src/engine/shareCard';
import { buildShareInfo } from '../../src/engine/runRecord';
import type { StoredRun } from '../../src/engine/persistence';
import { shapeName } from '../../src/ui/shapeLabels';
import { CTL_BACK } from '../../src/ui/ctlIcons';
import { STRINGS, type Lang } from '../../src/i18n';
import { mountShareActions } from './shareActions';

export interface RunSheetHandlers {
  onBack: () => void;
}

const esc = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function renderRunSheet(
  root: HTMLElement,
  run: StoredRun,
  lang: Lang,
  h: RunSheetHandlers,
): void {
  const s = STRINGS[lang];
  const d = run.data;
  const name = shapeName(lang, d.shapeId, d.shapeFallback);

  const page = document.createElement('div');
  page.className = 'app xhs-run-sheet';
  page.innerHTML = `
    <header class="home-head">
      <div class="home-head-glass">
        <h1 class="home-title">Slides</h1>
        <p class="home-sub tag-line">${esc(name)} · ${d.totalScore} 分</p>
      </div>
    </header>
    <div class="xhs-run-body" id="runBody"></div>
    <div class="page-back-row">
      <button class="icon-btn page-back" id="runBack" aria-label="${esc(s.back)}">${CTL_BACK}</button>
    </div>
  `;

  const body = page.querySelector<HTMLElement>('#runBody')!;

  // 两张照片缺一张就画不成——开局那张是图的左半边，结束那张是右半边。
  if (run.start && run.end) {
    let dataUri = '';
    try {
      dataUri = renderShareCard(buildShareInfo(d, name, lang), run.end, run.start);
    } catch {
      dataUri = '';
    }
    if (dataUri) {
      const img = document.createElement('img');
      img.className = 'xhs-run-img';
      img.src = dataUri;
      img.alt = `${name} ${d.totalScore} 分`;
      body.appendChild(img);
      mountShareActions(body, dataUri, d);
    } else {
      body.appendChild(gone('这一局的图画不出来了'));
    }
  } else {
    body.appendChild(gone('这一局太久了，照片没留住'));
  }

  page.querySelector<HTMLButtonElement>('#runBack')!.addEventListener('click', h.onBack);
  root.appendChild(page);
}

/** 画不出图的时候，摆一块和图一样大的空板子说明原因——比一行孤零零的字稳。 */
function gone(text: string): HTMLElement {
  const box = document.createElement('div');
  box.className = 'xhs-run-gone';
  box.textContent = text;
  return box;
}

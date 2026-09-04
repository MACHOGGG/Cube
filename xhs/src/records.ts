/**
 * 本机游玩历史——这一版用它顶掉排行榜。
 *
 * 小工具不联网，全球排行榜做不了（玩家点头的替代方案）。但「打过哪几局、
 * 各拿了多少分」这件事本来就是本地的：网页版的 src/engine/persistence.ts
 * 每局结算时把它存进 localStorage，这一版原样沿用那份存档，只是自己画一屏
 * 把它列出来。
 *
 * localStorage 在小工具里可用、按工具独立隔离，但**不保证永久**（规范原话，
 * 见 device-capabilities.md §1）。所以读写全都包在 try/catch 里，读不到就当
 * 「还没有记录」，不报错、不挡路。
 *
 * 每个玩法一本账：网页版的存档键是「玩法 + 模式」拼出来的 bestKey（见
 * src/shapes/square.ts 的 bestKey 那一段），这一版列的就是这五本。
 */
import { loadRuns, type StoredRun } from '../../src/engine/persistence';
import { CTL_BACK } from '../../src/ui/ctlIcons';
import { STRINGS, type Lang } from '../../src/i18n';

export interface RecordsHandlers {
  onBack: () => void;
}

/**
 * 这一版摆出来的五本账。
 *
 * 键要和玩法自己算出来的那个对上——网页版是 `bestKey`（基础）、
 * `bestKey + '_bomb'`（炸弹）、`_flip`（无限反转）。老虎机那一局用的是基础
 * 的键（它没有自己的后缀，见 square.ts 的 modeKey 那一段：targets 不进
 * bestKey），所以老虎机和基础局记在同一本上——这一点和网页版一致，不另立。
 */
const BOOKS: { key: string; name: string }[] = [
  { key: 'sugarcube_best', name: '方块' },
  { key: 'circle_best', name: '小球' },
  { key: 'sugarcube_best_bomb', name: '方块 · 炸弹' },
  { key: 'circle_best_bomb', name: '小球 · 炸弹' },
  { key: 'sugarcube_best_flip', name: '方块 · 无限反转' },
  { key: 'circle_best_flip', name: '小球 · 无限反转' },
];

const fmtDate = (at: number): string => {
  const d = new Date(at);
  const two = (n: number) => (n < 10 ? '0' + n : String(n));
  return `${d.getMonth() + 1}月${d.getDate()}日 ${two(d.getHours())}:${two(d.getMinutes())}`;
};

interface Row {
  at: number;
  name: string;
  score: number;
}

/** 把六本账并成一张按时间倒序的清单，顺便算总分和各自的最高分。 */
function collect(): { rows: Row[]; total: number; best: { name: string; score: number }[] } {
  const rows: Row[] = [];
  const best: { name: string; score: number }[] = [];
  let total = 0;
  for (const book of BOOKS) {
    let runs: StoredRun[] = [];
    try {
      runs = loadRuns(book.key);
    } catch {
      runs = [];
    }
    let top = 0;
    for (const run of runs) {
      const score = Math.max(0, Math.round(run.data?.score ?? 0));
      rows.push({ at: run.at, name: book.name, score });
      total += score;
      if (score > top) top = score;
    }
    if (top > 0) best.push({ name: book.name, score: top });
  }
  rows.sort((a, b) => b.at - a.at);
  best.sort((a, b) => b.score - a.score);
  return { rows, total, best };
}

export function renderRecordsPage(root: HTMLElement, lang: Lang, h: RecordsHandlers): void {
  const s = STRINGS[lang];
  const { rows, total, best } = collect();
  root.innerHTML = `
    <div class="app xhs-records">
      <div class="home-head">
        <div class="home-head-glass">
          <h1 class="home-title">Slides</h1>
          <p class="home-sub tag-line">游玩记录</p>
        </div>
      </div>
      <div class="total-card xhs-total">
        <span class="total-card-title">累计得分</span>
        <span class="total-card-value">${total}</span>
      </div>
      ${
        best.length
          ? `<div class="xhs-best">${best
              .map(
                (b) =>
                  `<div class="xhs-best-row"><span>${b.name}</span><span class="xhs-best-score">${b.score}</span></div>`,
              )
              .join('')}</div>`
          : ''
      }
      <div class="xhs-runs">
        ${
          rows.length
            ? rows
                .slice(0, 40)
                .map(
                  (r) =>
                    `<div class="xhs-run-row"><span class="xhs-run-when">${fmtDate(r.at)}</span>` +
                    `<span class="xhs-run-name">${r.name}</span>` +
                    `<span class="xhs-run-score">${r.score}</span></div>`,
                )
                .join('')
            : `<p class="rank-empty">还没有记录，去玩一局吧</p>`
        }
      </div>
      <div class="start-actions">
        <button class="icon-btn start-act" id="recBack" aria-label="${s.back}">${CTL_BACK}</button>
      </div>
    </div>
  `;
  root.querySelector<HTMLButtonElement>('#recBack')!.addEventListener('click', h.onBack);
}

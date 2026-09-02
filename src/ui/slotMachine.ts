/**
 * 《随机得分目标》——先挑一个图形，再让老虎机转出这一局认哪两个得分图案。
 *
 * 玩法本身没有新东西：挑完什么就是那个基础玩法，同一副棋盘、同样的滑法、
 * 同样的整行奖励。唯一变的是「拼成什么算分」——原来写死在各个玩法里的那两
 * 三个图案，换成这里转出来的两个，分数按 targets.ts 的 scoreOf（枚数²÷2，
 * 向上取整）。玩家的原话：「玩法就是三个基础图形的玩法只是……得分的图形不
 * 同而已」。
 *
 * 转出来的两个一定是能同时成立的：有些图案互相包含（拼出大的就白送一个小
 * 的），有些是玩家点名不许同时出现的，都记在 targets.ts 的 exclusions() 里，
 * drawPair() 只从合得来的对子里抽。
 */
import { STRINGS, type Lang } from '../i18n';
import { renderPatternHintIcons } from '../engine/patternIcon';
import { targetPatternDefs } from '../engine/targetIcon';
import { drawPair, scoreOf, targetsOf, type Family, type TargetPattern } from '../engine/targets';
import { ICON_BASE_CIRCLE, ICON_BASE_SQUARE, ICON_BASE_TRIANGLE } from './homeIcons';
import { custom } from './customIcons';
import { shapeName } from './shapeLabels';
import { ICON_LOCK } from './homeIcons';

/** 老虎机自己那块牌子。玩家给的文件，没有就不画——它是个装饰，不是内容。 */
const ICON_SLOT = custom('slot-machine') ?? '';

/** 三个基础玩法，和它们在主菜单上的那张图。 */
const FAMILIES: { family: Family; shapeId: string; icon: string }[] = [
  { family: 'square', shapeId: 'square', icon: ICON_BASE_SQUARE },
  { family: 'circle', shapeId: 'circle', icon: ICON_BASE_CIRCLE },
  // 主菜单上的《三角》后面装的是 triangleBig.ts 画的那块整三角，它自己的 id
  // 就叫 'triangle'（两个三角的内容 2026-09 对调过，各自的身份也跟着换了，
  // 见 main.ts 那段注释）。这里要的是玩家看到的那个名字，所以用它。
  { family: 'triangle', shapeId: 'triangle', icon: ICON_BASE_TRIANGLE },
];

export interface RandomTargetHandlers {
  onBack: () => void;
  /** 转完了，开这一局：这个 family 的基础玩法，认这两个图案。 */
  onStart: (family: Family, targets: TargetPattern[]) => void;
  /** 没开通的人按下那颗《成为 Slides 天才》。 */
  onGenius: () => void;
}

/** 一枚图案画成小图示（和棋盘上那一排是同一套画法）。 */
const iconOf = (p: TargetPattern): string => renderPatternHintIcons(targetPatternDefs([p]), 'zhHans')[0];

/**
 * @param locked 没开通 Slides 天才。页面照样打得开——玩家自己定的规矩：做好
 *   的东西谁都点得进来看，只是玩不了。所以图形照画、标语照写，三颗图形键挂
 *   着锁按不动，底下给一条去开通的路。
 */
export function renderRandomTargetPage(
  root: HTMLElement,
  lang: Lang,
  handlers: RandomTargetHandlers,
  locked: boolean,
): void {
  const s = STRINGS[lang];
  root.innerHTML = `
    <div class="app slot-page">
      <header class="home-head">
        <div class="home-head-glass">
          <h1 class="home-title">Slides</h1>
          <p class="home-sub">${s.homeTagline}</p>
        </div>
      </header>

      <div class="slot-crest">
        ${ICON_SLOT ? `<span class="slot-crest-art">${ICON_SLOT}</span>` : ''}
        <p class="slot-tagline">${s.randomTargetTagline}</p>
      </div>

      <div class="menu-section-label" id="slotStep">${s.randomTargetPick}</div>
      <div class="slot-shapes${locked ? ' slot-shapes--locked' : ''}" id="slotShapes">
        ${FAMILIES.map(
          (f) => `<button class="slot-shape" data-family="${f.family}"
                          aria-label="${shapeName(lang, f.shapeId, f.family)}"${
                            locked ? ' disabled aria-disabled="true"' : ''
                          }>
                    ${f.icon}
                    ${locked ? `<span class="slot-lock">${ICON_LOCK}</span>` : ''}
                    <span class="slot-shape-name">${shapeName(lang, f.shapeId, f.family)}</span>
                  </button>`,
        ).join('')}
      </div>

      <div class="slot-reels" id="slotReels" hidden>
        <div class="slot-reel" id="slotReelA"></div>
        <div class="slot-reel" id="slotReelB"></div>
      </div>
      <p class="slot-note" id="slotNote" hidden></p>
      <button class="profile-pill profile-pill--wide slot-go" id="slotGo" hidden>${s.startBtn}</button>
      ${locked ? `<button class="genius-cta slot-cta" id="slotGenius">${s.becomeGenius}</button>` : ''}

      <button class="profile-row profile-row--back" id="slotBack">${s.back}</button>
    </div>
  `;

  const reels = root.querySelector<HTMLElement>('#slotReels')!;
  const reelA = root.querySelector<HTMLElement>('#slotReelA')!;
  const reelB = root.querySelector<HTMLElement>('#slotReelB')!;
  const step = root.querySelector<HTMLElement>('#slotStep')!;
  const note = root.querySelector<HTMLElement>('#slotNote')!;
  const go = root.querySelector<HTMLButtonElement>('#slotGo')!;

  let timer = 0;
  let picked: { family: Family; pair: TargetPattern[] } | null = null;

  /**
   * 转。
   *
   * 结果一开始就定了（drawPair 抽的），滚动的那一秒是给人看的——两个轮子错
   * 开停下，先停左边再停右边，不然两个同时定住看着像一次刷新，不像转出来的。
   */
  function spin(family: Family) {
    const pair = drawPair(family);
    if (!pair) return; // 这一族没有能同时成立的两个（不会发生，见 check-targets）
    picked = { family, pair };
    const pool = targetsOf(family);
    reels.hidden = false;
    note.hidden = false;
    go.hidden = true;
    step.textContent = s.randomTargetSpinning;
    note.textContent = s.randomTargetSpinning;

    let n = 0;
    const stopA = 14;
    const stopB = 22;
    window.clearInterval(timer);
    timer = window.setInterval(() => {
      n++;
      if (n <= stopA) reelA.innerHTML = iconOf(pool[n % pool.length]);
      else if (n === stopA + 1) reelA.innerHTML = iconOf(pair[0]);
      if (n <= stopB) reelB.innerHTML = iconOf(pool[(n + 3) % pool.length]);
      else {
        reelB.innerHTML = iconOf(pair[1]);
        window.clearInterval(timer);
        settle(pair);
      }
    }, 70);
  }

  function settle(pair: TargetPattern[]) {
    step.textContent = s.randomTargetTitle;
    note.textContent =
      `${s.randomTargetOnly} ` +
      pair.map((p) => s.randomTargetPoints.replace('{n}', String(scoreOf(p)))).join(' · ');
    reelA.classList.add('slot-reel--set');
    reelB.classList.add('slot-reel--set');
    go.hidden = false;
  }

  root.querySelector<HTMLButtonElement>('#slotGenius')?.addEventListener('click', handlers.onGenius);
  for (const btn of Array.from(root.querySelectorAll<HTMLButtonElement>('.slot-shape'))) {
    btn.addEventListener('click', () => {
      // disabled 已经拦住了手；这一句拦的是以后谁把锁改成一个 class。
      if (locked) return;
      for (const other of Array.from(root.querySelectorAll('.slot-shape')))
        other.classList.toggle('slot-shape--on', other === btn);
      reelA.classList.remove('slot-reel--set');
      reelB.classList.remove('slot-reel--set');
      spin(btn.dataset.family as Family);
    });
  }

  go.addEventListener('click', () => {
    if (!picked) return;
    window.clearInterval(timer);
    handlers.onStart(picked.family, picked.pair);
  });
  root.querySelector<HTMLButtonElement>('#slotBack')!.addEventListener('click', () => {
    window.clearInterval(timer);
    handlers.onBack();
  });
}

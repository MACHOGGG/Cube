/**
 * 《每日挑战》那一页（第 19 推）。
 *
 * 方案原话：「今日挑战按钮、种子输入框、自己的 4-3-2-1（复用 startStage 的 startStageHtml /
 * playCountdown），倒数期间不显示玩法和棋盘；倒数完 game.mount(..., {seed, noCountdown:true})」。
 *
 * 所以这一页有两幕：
 *
 *   · **挑**：今天那张图（星期几的底图 + 日期，和主菜单上那张是同一个函数画的），底下一颗
 *     《今日挑战》，再底下一格种子输入框——敲一串别人分享出来的码，开的就是那一局。最底下
 *     是全站统一的那颗《退出》（第 18 推的 `.page-exit`）。
 *   · **数**：4-3-2-1。上半屏摆的是**今天那张图**（每日挑战）或者**那串码**（输进来的），不
 *     摆玩法图——这一局是什么，等棋盘亮出来才知道，那正是「挑战」的意思。数完把这一局交出去
 *     （onLaunch），由外面那一层挂棋盘，棋盘自己那一页不再数一遍（noCountdown）。
 *
 * 七色圆球那一天（棋盘是横着躺的菱形）：竖着拿手机的话，数之前只摆一句「请横屏」——不带任何
 * 棋盘标识（方案原话），转过来才开始数；电脑和本来就横着的设备不提示。倒数一律 4-3-2-1（单人
 * 那边七色圆球是从 5 数起的，多出来那一秒是给转手机的——这儿转手机那一步单独等，不占倒数）。
 *
 * 老虎机那一天：不转轮子（方案原话「目标直接出现在得分图案位置；不加老虎机那多出来的 +1 倒
 * 数」）——目标早就从种子里抽好了（seedDeal.ts 的 seedGameOf），棋盘那一页也不再转（gameShell
 * 那一段认 noCountdown）。
 *
 * 网页版和小红书版共用这一页，「现在几点」由外面给（网页端用服务器的钟，小红书用本机的钟——
 * 方案原话），锁也由外面判（小红书那一版没有锁）。
 */
import { STRINGS, type Lang } from '../i18n';
import { dailySeed, dayIndexOf, dayKey, decodeSeed, formatSeed } from '../engine/seedCode';
import { seedGameOf, type SeedGame } from '../engine/seedDeal';
import { isLandscapeMode, playCountdown, startStageHtml } from './startStage';
import { dailyAria, dailyArtHtml, watchDay } from './dailyArt';
import { CTL_BACK } from './ctlIcons';
import { pushLayer } from '../engine/backNav';
import { ICON_ARROW } from './uiIcons';

/** 每日挑战一律从 4 数起（方案原话「倒数统一 4-3-2-1」）。 */
const DAILY_COUNT_FROM = 4;


export interface DailyModeHandlers {
  onBack: () => void;
  /** 数完了：把这一局挂上去（外面那一层加 lang、教学、noCountdown）。 */
  onLaunch: (game: SeedGame) => void;
  /**
   * 「现在」——网页端是服务器的钟（engine/dailyClock.ts 的 dailyNow），小红书是本机的钟。
   * 今天是哪一天、今天那串码是什么，全从它算。
   */
  now: () => number;
  /**
   * 输进来的这串码开出来的那一局这个人能不能玩（网页端的天才锁；小红书那一版没有锁，不给）。
   * 不能玩就走 onLocked，不数、不开。
   *
   * **每日挑战不问这一句**：今天那一局谁都能打（主菜单上那张卡首玩期间也是亮的——方案原话
   * 「首玩期间也显示」），不然一个新玩家在「今天轮到老虎机」那一天点进来，看到的是一把锁。
   */
  canPlay?: (game: SeedGame) => boolean;
  onLocked?: () => void;
  /** 本机今天每日挑战最好的一局（小红书那一版：没有排行榜，就在这儿摆一句）。没有就 null。 */
  todayBest?: (dayKey: string) => number | null;
  /**
   * 输代号那一格底下要不要说「代号局不计入排行榜」（10-08 方案 3-B）。网页端给 true——服务器真的
   * 不让敲代号开的那一局上榜（api/scores.js 的 ranked），先说出来，免得他打完一局好的才发现。
   * 小红书那一版不给：那一端根本没有排行榜，说这一句等于提一个不存在的东西。
   */
  boardNote?: boolean;
}

/** 七色圆球那一天、竖着拿着手机：倒数之前先请他转过来。电脑（鼠标）不提示。 */
function needsTurn(board: string): boolean {
  // 哪几副要横着打，问 startStage 那一份（10-08 方案 3-F-1 删掉了这儿抄的那一份名单）。
  if (!isLandscapeMode(board)) return false;
  return (
    window.matchMedia('(orientation: portrait)').matches && window.matchMedia('(pointer: coarse)').matches
  );
}

/**
 * 把这一页摆进 root。
 *
 * @returns 拆页面时叫一声：倒数的计时器、零点换图的那个钟、转屏的监听全撤掉。
 */
export function renderDailyModePage(root: HTMLElement, lang: Lang, handlers: DailyModeHandlers): () => void {
  const s = STRINGS[lang];
  /** 这一页上现在挂着的、拆的时候要撤的东西。 */
  let cleanups: (() => void)[] = [];
  const clear = () => {
    for (const f of cleanups) f();
    cleanups = [];
  };

  /** 第一幕：挑。`msg` 是上一次输码没过的那一句（从倒数退回来时清空）。 */
  function showPick(): void {
    clear();
    const day = dayIndexOf(handlers.now());
    const best = handlers.todayBest?.(dayKey(day)) ?? null;
    root.innerHTML = `
      <div class="app slot-page daily-page">
        <div class="start-stage">
          <div class="start-count slot-pick-area daily-pick">
            <div class="daily-art" id="dailyArt" role="img" aria-label="${dailyAria(lang, day)}">${dailyArtHtml(day)}</div>
            <button class="profile-pill profile-pill--wide daily-play" id="dailyPlay">${s.dailyPlay}</button>
            ${best !== null ? `<p class="daily-best" id="dailyBest">${s.dailyBest.replace('{n}', String(best))}</p>` : ''}
            <form class="seed-form" id="seedForm" autocomplete="off" novalidate>
              <label class="seed-label" for="seedInput">${s.seedLabel}</label>
              <input class="seed-input" id="seedInput" type="text" inputmode="text" maxlength="12"
                     autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="XXXX-XXXX">
              <button class="pill-icon seed-go" id="seedGo" type="submit" aria-label="${s.seedGo}">${ICON_ARROW}</button>
            </form>
            <p class="seed-msg" id="seedMsg" role="status" aria-live="polite"></p>
            ${handlers.boardNote ? `<p class="seed-note" id="seedNote">${s.seedNoBoard}</p>` : ''}
          </div>
          <button class="icon-btn page-exit" id="dailyBack" aria-label="${s.back}">${CTL_BACK}</button>
        </div>
      </div>
    `;
    // 页面开着过了北京零点：图、数字、读屏那一句一起换（和主菜单那张卡同一个钟）。按《今日
    // 挑战》那一下另外现算一次今天，不靠这张图——图慢了一拍，开出来的也还是今天那一局。
    cleanups.push(
      watchDay(handlers.now, (d) => {
        const art = root.querySelector<HTMLElement>('#dailyArt');
        if (!art) return;
        art.innerHTML = dailyArtHtml(d);
        art.setAttribute('aria-label', dailyAria(lang, d));
      }),
    );
    root.querySelector<HTMLButtonElement>('#dailyPlay')!.addEventListener('click', () => {
      const today = dayIndexOf(handlers.now());
      const game = seedGameOf(dailySeed(today), 'daily', dayKey(today));
      // 今天那一串一定认得出来（它就是这一版算出来的）；真认不出来是编号表和轮换对不上了，
      // 门 check-seed-code 每次都验——这儿不该把人卡在一张按不动的页面上，所以什么也不做。
      if (game) showCount(game, dailyArtHtml(today));
    });
    const form = root.querySelector<HTMLFormElement>('#seedForm')!;
    const input = root.querySelector<HTMLInputElement>('#seedInput')!;
    const msg = root.querySelector<HTMLElement>('#seedMsg')!;
    // 改了一个字就把上一句错误撤掉：那句话说的是上一串，不是这一串。
    input.addEventListener('input', () => {
      msg.textContent = '';
      input.removeAttribute('aria-invalid');
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const dec = decodeSeed(input.value);
      if (!dec.ok) {
        msg.textContent =
          dec.reason === 'version' ? s.seedExpired : dec.reason === 'newer' || dec.reason === 'variant' ? s.seedNewer : s.seedBad;
        input.setAttribute('aria-invalid', 'true');
        return;
      }
      const game = seedGameOf(dec.code, 'entered');
      if (!game) {
        msg.textContent = s.seedBad;
        return;
      }
      if (handlers.canPlay && !handlers.canPlay(game)) {
        handlers.onLocked?.();
        return;
      }
      // 倒数那一屏上摆那串码本身（JetBrains Mono）：输进来的人认得出这是他敲的那一串，而它不
      // 泄露是哪个玩法。
      showCount(game, `<p class="daily-seed-code">${formatSeed(dec.code)}</p>`);
    });
    root.querySelector<HTMLButtonElement>('#dailyBack')!.addEventListener('click', handlers.onBack);
  }

  /**
   * 第二幕：数。上半屏是 `emblem`（今天那张图，或者那串码），**不是**这一局的玩法图。
   *
   * **和单人开局页是同一层、同一套**（10-08 方案 3-F-1：「今日挑战倒数页改用 startStage 组件……
   * 删自建版——『界面统一』自动达成」）。从前这一幕借的是挑图形那几页的骨架（.slot-page ＋ 页底
   * 那颗 .page-exit）：图小一圈（176 对 260）、倒数窗高出 68px、《退出》是 62px 站在离底 116 的地
   * 方——同一个 4-3-2-1，从这儿进和从主菜单进长得不一样。现在外面套的就是游戏外壳开局那一层
   * （.overlay--start），图摆进 startStage 自己那一格（.start-mark，和玩法图一样大），《退出》是
   * startStage 底下那一排的键（.start-act，--exit-disc 那个尺寸、离底同一个坐标）。
   *
   * 只有《退出》，没有《暂停》：这一幕还没有棋盘，也没有暂停那一层可开（和老虎机那一局的开局页
   * 一样只留一颗）。数到一半按它，回到第一幕（不是回主菜单——他可能只是想换一串码）。手机的返回键
   * 去同一个地方（10-09 补充方案 7-13 第 12 条，见下面那句 pushLayer）。
   */
  function showCount(game: SeedGame, emblem: string): void {
    clear();
    root.innerHTML = `
      <div class="app daily-page daily-page--count">
        <div class="overlay opaque show overlay--start">
          ${startStageHtml({
            mode: game.variant,
            countId: 'dailyCount',
            emblem:
              `<div class="start-marks" style="--marks:1"><span class="start-mark">` +
              `<span class="start-mark-art daily-emblem" id="dailyEmblem">${emblem}</span></span></div>`,
            extra: `<p class="daily-turn" id="dailyTurn" hidden>${s.dailyTurn}</p>`,
            actions: `<button class="icon-btn start-act" id="dailyBack" aria-label="${s.back}">${CTL_BACK}</button>`,
          })}
        </div>
      </div>
    `;
    const win = root.querySelector<HTMLElement>('#dailyCount')!;
    const turn = root.querySelector<HTMLElement>('#dailyTurn')!;
    const emblemEl = root.querySelector<HTMLElement>('#dailyEmblem')!;
    let stopCount: (() => void) | null = null;
    const begin = () => {
      turn.hidden = true;
      emblemEl.hidden = false;
      win.hidden = false;
      stopCount = playCountdown(win, () => {
        stopCount = null;
        // 这一页已经被换掉了（退出、或者别的什么把 root 清了）：不开。
        if (!root.querySelector('.daily-page--count')) return;
        clear();
        handlers.onLaunch(game);
      }, DAILY_COUNT_FROM);
    };
    cleanups.push(() => stopCount?.());
    if (needsTurn(game.board)) {
      // 只摆那一句：图和倒数窗都藏起来（「不带任何棋盘标识」——今天那张图本身不是棋盘标识，
      // 可这一屏上只该有这一件要他做的事）。
      turn.hidden = false;
      emblemEl.hidden = true;
      win.hidden = true;
      const mq = window.matchMedia('(orientation: portrait)');
      const onTurn = () => {
        if (mq.matches) return;
        mq.removeListener(onTurn);
        window.removeEventListener('resize', onTurn);
        begin();
      };
      // addListener 而不是 addEventListener：小红书那一端是 Chrome 61，MediaQueryList 上还没
      // 有 addEventListener（Chrome 79 才有）。resize 那一条是兜底——有的 WebView 转屏不发
      // change。
      mq.addListener(onTurn);
      window.addEventListener('resize', onTurn);
      cleanups.push(() => {
        mq.removeListener(onTurn);
        window.removeEventListener('resize', onTurn);
      });
    } else {
      begin();
    }
    root.querySelector<HTMLButtonElement>('#dailyBack')!.addEventListener('click', showPick);
    // 手机的返回键和屏幕上的《退出》去同一个地方：回第一幕。原先返回键走的是整页那一条（main.ts
    // 的 setScreenBack(showMenu)），数到一半一按就回了主菜单——同一屏上两个「退」去两个地方。挂成
    // 一层：这一幕一被换掉（数完开了局、按了《退出》），那一层自己就不算数了（backNav 认的是这个
    // 元素还在不在文档里），回到第一幕再按返回，照旧是整页那一条回主菜单。
    pushLayer(showPick, root.querySelector('.daily-page--count')!);
  }

  showPick();
  return clear;
}

/**
 * 房间局里那几块「停下来说一句话」的画面。
 *
 * 四块，各自答一个问题：
 *
 *   《完成了吗？》——交卷之前问一句。问的这段时间钟停着，牌也盖上：想一想
 *   要不要交，不该顺便多看一会儿棋盘，也不该被钟催着做决定。
 *
 *   交卷之后的等待页——和开局那一幕同一张脸（玩法图 + 那扇小门），只是下半
 *   屏不再是 3、2、1，而是一份还在动的名单：谁交了、谁还在打、自己排第几。
 *   交了卷不是结束，是开始等别人。
 *
 *   《Ohno！房间被取消》——屋主把座位交回去了，这间房再也开不了下一局。
 *   给一颗《ok》，按了回主菜单。
 *
 *   《屋主修理电缆中，稍等》——屋主还在，只是这会儿听不见他。这一块没有
 *   「知道了」可按：知道了也没用，得等。能按的只有《退出》——愿意等就等，
 *   不愿意等的人不该被关在里面。
 *
 * 这四块都画成盖住整屏的一层，而不是塞进某一页里：它们出现的时候，底下那一
 * 页正在发生什么已经不重要了。
 */
import { STRINGS, type Lang } from '../i18n';
import { avatarSvg, type RoomPlayer, type RoomState } from '../engine/room';
import { modeBadges } from './startStage';
import { gameIcon } from './homeIcons';
import { custom } from './customIcons';

const esc = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 交了卷的那个小勾。房间页、局中的名单、等待页，三处同一个记号。 */
export const TICK = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.6 6.2 12 13 4.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** 一个人交卷了没有，画成名字后面那一点点东西。 */
export const tickFor = (done: boolean, label: string): string =>
  done ? `<span class="mp-tick" title="${esc(label)}" aria-label="${esc(label)}">${TICK}</span>` : '';

/**
 * 《完成了吗？》
 *
 * `onHold` 在问出口的那一刻调用（停表、盖牌），`onResume` 在选了「否」之后
 * 调用（接着打）。两件事由 gameController 去做——只有它手上有那只表。
 */
export function confirmFinish(
  lang: Lang,
  handlers: { onHold: () => void; onResume: () => void; onFinish: () => void },
): void {
  const s = STRINGS[lang];
  const overlay = document.createElement('div');
  // opaque：这一层要把棋盘整个盖住。犹豫的这几秒不该变成多看几眼盘面的机会。
  overlay.className = 'overlay opaque show';
  overlay.id = 'finishConfirm';
  overlay.innerHTML = `
    <div class="modal">
      <p class="tag-line">${s.mpFinishConfirm}</p>
      <div class="btn-row">
        <button class="secondary" id="mpFinishYes">${s.endRunYes}</button>
        <button class="primary" id="mpFinishNo">${s.endRunNo}</button>
      </div>
    </div>
  `;
  handlers.onHold();
  document.body.appendChild(overlay);
  overlay.querySelector<HTMLButtonElement>('#mpFinishNo')!.addEventListener('click', () => {
    overlay.remove();
    handlers.onResume();
  });
  overlay.querySelector<HTMLButtonElement>('#mpFinishYes')!.addEventListener('click', () => {
    overlay.remove();
    handlers.onFinish();
  });
}

/** 等待页上的一行：名次、图形、名字、分数，交了卷的后面一个勾。 */
function waitRow(
  p: RoomPlayer,
  rank: number,
  meId: string | undefined,
  doneLabel: string,
  leftLabel: string,
): string {
  return `<div class="mp-player${meId && p.id === meId ? ' mp-player--me' : ''}${p.left ? ' mp-player--left' : ''}">
    <span class="mp-final-rank">${rank}</span>
    <span class="mp-avatar">${avatarSvg(p.avatar)}</span>
    <span class="mp-player-name">${esc(p.name)}</span>
    ${p.left ? `<span class="mp-badge mp-badge--left">${leftLabel}</span>` : tickFor(p.finished, doneLabel)}
    <span class="mp-player-total">${p.total + p.score}</span>
  </div>`;
}

export interface WaitPanel {
  /** 名单变了就重画一次；这一层自己不去问服务器。 */
  update(state: RoomState): void;
  remove(): void;
}

/**
 * 交卷之后那一页：上半屏这一局是什么，下半屏大家打到哪儿了。
 *
 * 上半屏和开局页用的是同一组标志（同一个 startStage 的图 + 那扇小门），所以
 * 这一局从头到尾是同一张脸——开始时看见它，交卷之后还是它。
 */
export function showWaitPanel(
  lang: Lang,
  opts: { shapeId: string; meId?: string; code?: string; onLeave: () => void },
): WaitPanel {
  const s = STRINGS[lang];
  const marks = [
    `<span class="start-mark"><span class="start-mark-art">${gameIcon(opts.shapeId)}</span></span>`,
    ...modeBadges(false, true),
  ];
  // 和教学等待页同一个转圈的小人（ui/multiplayer.ts 的 showLearningWait 用的
  // 也是它）。两处等的是同一件事——等屋里别的人——所以该长同一张脸。
  const spinner = custom('mp-loading') ?? '';
  const overlay = document.createElement('div');
  overlay.className = 'overlay opaque show overlay--wait';
  overlay.id = 'mpWait';
  overlay.innerHTML = `
    <div class="start-stage mp-wait-stage">
      ${opts.code ? `<p class="mp-wait-code">${s.mpRoomCode} ${esc(opts.code)}</p>` : ''}
      <div class="start-emblem">
        <div class="start-marks" style="--marks:${marks.length}">${marks.join('')}</div>
      </div>
      ${spinner ? `<div class="mp-wait-spin">${spinner}</div>` : ''}
      <div class="mp-wait-rows mp-players" id="mpWaitRows"></div>
      <div class="start-actions">
        <button class="icon-btn start-act" id="mpWaitLeave">${s.mpLeave}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const rows = overlay.querySelector<HTMLElement>('#mpWaitRows')!;
  overlay.querySelector<HTMLButtonElement>('#mpWaitLeave')!.addEventListener('click', opts.onLeave);
  return {
    update(state) {
      rows.innerHTML = state.players
        .map((p, i) => waitRow(p, i + 1, opts.meId, s.mpFinished, s.mpLeftTag))
        .join('');
    },
    remove() {
      overlay.remove();
    },
  };
}

/**
 * 屋主没了，或者屋主暂时听不见。
 *
 * 两件事分开说，因为要做的事不一样：房间真的散了，这一页就是终点，给一颗
 * 《ok》送人回主菜单；屋主只是卡住了，那就没什么可「知道」的，只能等——所以
 * 那一块没有确认键，只有一颗《退出》给等不下去的人。
 */
export type HostTrouble = 'gone' | 'away';

export interface HostNotice {
  /** 现在该显示哪一种，或者什么都不显示。重复调用同一种不会重画。 */
  set(kind: HostTrouble | null): void;
  remove(): void;
}

export function hostNotice(
  lang: Lang,
  handlers: { onDismiss: () => void; onLeave: () => void },
): HostNotice {
  const s = STRINGS[lang];
  let shown: HostTrouble | null = null;
  let overlay: HTMLElement | null = null;
  const clear = () => {
    overlay?.remove();
    overlay = null;
  };
  return {
    set(kind) {
      if (kind === shown) return;
      shown = kind;
      clear();
      if (!kind) return;
      overlay = document.createElement('div');
      overlay.className = 'overlay show overlay--top';
      overlay.id = kind === 'gone' ? 'roomCancelled' : 'hostAway';
      overlay.innerHTML = `
        <div class="modal">
          <p class="tag-line">${kind === 'gone' ? s.mpRoomCancelled : s.mpHostFixing}</p>
          <div class="btn-row">
            ${
              kind === 'gone'
                ? `<button class="primary" id="roomCancelledOk">${s.mpOk}</button>`
                : `<button class="secondary" id="hostAwayLeave">${s.mpLeave}</button>`
            }
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      overlay
        .querySelector<HTMLButtonElement>('#roomCancelledOk')
        ?.addEventListener('click', handlers.onDismiss);
      overlay
        .querySelector<HTMLButtonElement>('#hostAwayLeave')
        ?.addEventListener('click', handlers.onLeave);
    },
    remove: clear,
  };
}

/**
 * 这一刻屋主出了什么事，从一份房间状态里读出来。
 *
 * 「走了」和「卡住了」在数据上是两回事：走了的人座位已经从房间里删掉，名单
 * 里根本没有他；卡住的人还在名单上，只是服务器有一阵子没听见他的动静了
 * （away，见 api/room.js）。房间已经正式散场（ended）不算这里的事——那条路
 * 有自己的总战绩页。
 */
export function hostTroubleIn(state: RoomState | null, iAmTheHost: boolean): HostTrouble | null {
  if (!state || state.ended || iAmTheHost || !state.host) return null;
  const host = state.players.find((p) => p.id === state.host);
  // 座位不在了，或者座位还在但人已经交回去了（left）——对屋里其他人来说
  // 是同一件事：这间小屋再也开不出下一局。名单上留着走掉的人是为了排名
  // （见 api/room.js 的 leave），不是为了假装他还在。
  // 屋主把网页关掉了，也是同一件事：他的终端没了，这间屋子开不出下一局。
  // closed 只有 bye 那条路会置上（pagehide 且不进 bfcache），切应用、锁屏都
  // 不算——那些仍然走下面的 away，屋里等他回来。
  if (!host || host.left || host.closed) return 'gone';
  return host.away ? 'away' : null;
}

export interface ExtraControl {
  id: string;
  label: string;
}

export interface ShellMeta {
  title: string;
  tagline: string;
  startBody: string;
  hint: string;
  assumptions: string;
  extraControls?: ExtraControl[];
}

export interface ShellRefs {
  root: HTMLElement;
  boardWrap: HTMLElement;
  boardEl: HTMLElement;
  legendEl: HTMLElement;
  hudTimeEl: HTMLElement;
  hudPerfEl: HTMLElement;
  scoreReelEl: HTMLElement;
  gainBadgeEl: HTMLElement;
  startOverlay: HTMLElement;
  pauseOverlay: HTMLElement;
  endOverlay: HTMLElement;
  endTitleEl: HTMLElement;
  endScoreEl: HTMLElement;
  endDetailEl: HTMLElement;
  buttons: {
    stop: HTMLButtonElement;
    finish: HTMLButtonElement;
    back: HTMLButtonElement;
    start: HTMLButtonElement;
    continueBtn: HTMLButtonElement;
    restart: HTMLButtonElement;
    endBack: HTMLButtonElement;
    extra: Record<string, HTMLButtonElement>;
  };
}

/**
 * Builds the HUD/board/legend/overlay DOM every shape shares — the only
 * things that differ between shapes are copy (title/hint/assumptions), any
 * extra control buttons, and the board contents the shape renders inside
 * #board.
 */
export function buildShell(container: HTMLElement, meta: ShellMeta): ShellRefs {
  const extraButtonsHtml = (meta.extraControls ?? [])
    .map((b) => `<button class="icon-btn" id="${b.id}">${b.label}</button>`)
    .join('');

  container.innerHTML = `
    <div class="app">
      <h1>${meta.title}</h1>
      <p class="tag-line">${meta.tagline}</p>

      <div class="controls">
        <button class="icon-btn" id="stopBtn">暂停</button>
        <button class="icon-btn" id="finishBtn">结束</button>
        ${extraButtonsHtml}
        <button class="icon-btn" id="backBtn">返回菜单</button>
      </div>

      <div class="hud">
        <div class="hud-cell score-cell">
          <span class="gain-badge" id="gainBadge"></span>
          <div class="k">得分</div>
          <div class="v"><span class="score-reel" id="scoreReel"></span></div>
        </div>
        <div class="hud-cell perf-cell"><div class="k">状态</div><div class="v" id="hud-perf">0%</div></div>
        <div class="hud-cell"><div class="k">用时</div><div class="v" id="hud-time">0:00</div></div>
      </div>

      <div class="board-wrap" id="boardWrap">
        <div class="board" id="board"></div>
      </div>

      <div class="legend" id="legend"></div>
      <p class="hint">${meta.hint}</p>
      <p class="assumptions">${meta.assumptions}</p>
    </div>

    <div class="overlay opaque show" id="startOverlay">
      <div class="modal">
        <h2>${meta.title}</h2>
        <p>${meta.startBody}</p>
        <div class="btn-row"><button class="primary" id="startBtn">开始</button></div>
      </div>
    </div>

    <div class="overlay opaque" id="pauseOverlay">
      <div class="modal">
        <h2>已暂停</h2>
        <p>计时已停止，棋盘已隐藏。</p>
        <div class="btn-row"><button class="primary" id="continueBtn">继续</button></div>
      </div>
    </div>

    <div class="overlay" id="endOverlay">
      <div class="modal">
        <h2 id="endTitle">挑战结束</h2>
        <div class="big-score" id="endScore">0</div>
        <p id="endDetail">共 0 步 · 用时 0:00 · 本机最佳 0</p>
        <div class="btn-row">
          <button class="secondary" id="endBackBtn">返回菜单</button>
          <button class="primary" id="restartBtn">再来一局</button>
        </div>
      </div>
    </div>
  `;

  const req = <T extends HTMLElement>(id: string) => {
    const el = container.querySelector<T>('#' + id);
    if (!el) throw new Error(`gameShell: missing #${id}`);
    return el;
  };

  const extra: Record<string, HTMLButtonElement> = {};
  for (const b of meta.extraControls ?? []) extra[b.id] = req<HTMLButtonElement>(b.id);

  return {
    root: container,
    boardWrap: req('boardWrap'),
    boardEl: req('board'),
    legendEl: req('legend'),
    hudTimeEl: req('hud-time'),
    hudPerfEl: req('hud-perf'),
    scoreReelEl: req('scoreReel'),
    gainBadgeEl: req('gainBadge'),
    startOverlay: req('startOverlay'),
    pauseOverlay: req('pauseOverlay'),
    endOverlay: req('endOverlay'),
    endTitleEl: req('endTitle'),
    endScoreEl: req('endScore'),
    endDetailEl: req('endDetail'),
    buttons: {
      stop: req('stopBtn'),
      finish: req('finishBtn'),
      back: req('backBtn'),
      start: req('startBtn'),
      continueBtn: req('continueBtn'),
      restart: req('restartBtn'),
      endBack: req('endBackBtn'),
      extra,
    },
  };
}

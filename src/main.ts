import './style.css';
import { renderMenu } from './ui/menu';
import { renderMoreMenu, renderTimedPicker, renderLayoutsPicker, type MoreOptionId } from './ui/moreMenu';
import { createSquareGame } from './shapes/square';
import { createTriangleGame } from './shapes/triangle';
import { createCircleGame } from './shapes/circle';
import { createCircleHexGame } from './shapes/circleHex';
import { createSquareDiamondGame } from './shapes/squareDiamond';
import { createTriangleBigGame } from './shapes/triangleBig';
import type { ShapeGame, ShapeGameOpts } from './shapes/types';

const rootEl = document.getElementById('app');
if (!rootEl) throw new Error('#app not found');
const root: HTMLElement = rootEl;

const games: ShapeGame[] = [createSquareGame(), createTriangleGame(), createCircleGame()];
const layoutGames: ShapeGame[] = [createCircleHexGame(), createSquareDiamondGame(), createTriangleBigGame()];

let activeDestroy: (() => void) | null = null;

function teardown() {
  if (activeDestroy) {
    activeDestroy();
    activeDestroy = null;
  }
}

function showMenu() {
  teardown();
  renderMenu(
    root,
    games.map((g) => g.card),
    (id) => {
      const game = games.find((g) => g.card.id === id);
      if (game) showGame(game);
    },
    showMore,
  );
}

function showMore() {
  teardown();
  renderMoreMenu(root, onSelectMoreOption, showMenu);
}

function onSelectMoreOption(id: MoreOptionId) {
  if (id === 'timed') showTimedPicker();
  else if (id === 'randomTarget') showComingSoon('随机得分目标');
  else showLayoutsPicker();
}

function showLayoutsPicker() {
  teardown();
  renderLayoutsPicker(
    root,
    layoutGames.map((g) => g.card),
    (id) => {
      const game = layoutGames.find((g) => g.card.id === id);
      if (game) showGame(game, undefined, showLayoutsPicker);
    },
    showMore,
  );
}

function showTimedPicker() {
  teardown();
  renderTimedPicker(
    root,
    games.map((g) => g.card),
    (id) => {
      const game = games.find((g) => g.card.id === id);
      if (game) showGame(game, { timeLimitSec: 60 });
    },
    showMore,
  );
}

function showComingSoon(title: string) {
  teardown();
  root.innerHTML = `
    <div class="app">
      <h1>${title}</h1>
      <p class="tag-line">敬请期待</p>
      <div class="controls">
        <button class="icon-btn" id="backBtn">返回</button>
      </div>
    </div>
  `;
  root.querySelector<HTMLButtonElement>('#backBtn')?.addEventListener('click', showMore);
}

function showGame(game: ShapeGame, opts?: ShapeGameOpts, onBack?: () => void) {
  activeDestroy = game.mount(root, onBack ?? (opts?.timeLimitSec ? showTimedPicker : showMenu), opts);
}

showMenu();

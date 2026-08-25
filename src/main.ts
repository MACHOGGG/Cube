import './style.css';
import { renderMenu } from './ui/menu';
import { createSquareGame } from './shapes/square';
import { createTriangleGame } from './shapes/triangle';
import { createCircleGame } from './shapes/circle';
import type { ShapeGame } from './shapes/types';

const rootEl = document.getElementById('app');
if (!rootEl) throw new Error('#app not found');
const root: HTMLElement = rootEl;

const games: ShapeGame[] = [createSquareGame(), createTriangleGame(), createCircleGame()];

let activeDestroy: (() => void) | null = null;

function showMenu() {
  if (activeDestroy) {
    activeDestroy();
    activeDestroy = null;
  }
  renderMenu(
    root,
    games.map((g) => g.card),
    (id) => {
      const game = games.find((g) => g.card.id === id);
      if (game) showGame(game);
    },
  );
}

function showGame(game: ShapeGame) {
  activeDestroy = game.mount(root, showMenu);
}

showMenu();

export interface ShapeCardMeta {
  id: string;
  name: string;
  desc: string;
  bestKey: string;
  /** Inline SVG markup for the menu card glyph. */
  glyph: string;
}

import type { Lang } from '../i18n';

export interface ShapeGameOpts {
  /** Timed-challenge mode: run ends automatically after this many seconds. */
  timeLimitSec?: number;
  /** Bomb-challenge mode: red hazard tiles, instant game-over on a 4+ cluster. */
  bomb?: boolean;
  /** Localizes the shell chrome and dynamic end-of-run text; falls back to 'zhHans' if omitted. */
  lang?: Lang;
}

export interface ShapeGame {
  card: ShapeCardMeta;
  /** Builds the game inside container and wires onBack; returns a destroy() to call when navigating away. */
  mount(container: HTMLElement, onBack: () => void, opts?: ShapeGameOpts): () => void;
}

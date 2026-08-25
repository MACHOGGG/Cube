export interface ShapeCardMeta {
  id: 'square' | 'triangle' | 'circle';
  name: string;
  desc: string;
  bestKey: string;
  /** Inline SVG markup for the menu card glyph. */
  glyph: string;
}

export interface ShapeGame {
  card: ShapeCardMeta;
  /** Builds the game inside container and wires onBack; returns a destroy() to call when navigating away. */
  mount(container: HTMLElement, onBack: () => void): () => void;
}

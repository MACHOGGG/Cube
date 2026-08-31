/**
 * Redraws a board whenever the box it lives in actually changes size.
 *
 * A window `resize` listener is not enough on a phone. Turning the device
 * fires resize while the viewport is still settling — Safari animates its
 * chrome and only then reports the final `100dvh` — so a board that
 * measures its panel at that moment lays itself out against the old, taller
 * box and comes out too big for the new one, and stays that way until
 * something else happens to trigger a render. (Which is why it looked fixed
 * "as soon as you touched it".)
 *
 * A ResizeObserver on the panel itself is the honest signal: it fires when
 * the panel is the size it is going to be, however many frames that takes.
 * The window listeners stay as a backstop for the browsers without one and
 * for changes that don't resize the panel at all.
 */
export function observeBoardSize(el: HTMLElement, redraw: () => void): () => void {
  let w = -1;
  let h = -1;
  const tick = () => {
    const r = el.getBoundingClientRect();
    // Nothing moved: skip, so a redraw that itself touches layout can never
    // feed back into another one.
    if (Math.abs(r.width - w) < 0.5 && Math.abs(r.height - h) < 0.5) return;
    w = r.width;
    h = r.height;
    redraw();
  };
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(tick) : null;
  ro?.observe(el);
  window.addEventListener('resize', tick);
  window.addEventListener('orientationchange', tick);
  return () => {
    ro?.disconnect();
    window.removeEventListener('resize', tick);
    window.removeEventListener('orientationchange', tick);
  };
}

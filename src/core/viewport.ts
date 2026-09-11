import { DESIGN_HEIGHT, DESIGN_WIDTH } from "./config";
import { k } from "./k";

/**
 * Maps design units onto real device pixels.
 *
 * The canvas fills the window at the monitor's own resolution, so there is no
 * fixed internal framebuffer to upscale from. What stays fixed is the
 * *proportions*: the square design box is fitted into the window, and one
 * design unit becomes `scale` pixels inside it. Everything is drawn through
 * `px`/`py`/`pu`, which means a paddle 4 units wide is genuinely 4 * scale
 * pixels of crisp geometry, and text is rasterised at its final pixel size
 * rather than being blown up from a small atlas.
 *
 * Read straight from `k.width()`/`k.height()` every frame rather than via
 * `onResize`: that handler is declared to return `void`, so it cannot be
 * cancelled, and polling is a handful of arithmetic ops.
 */

let scale = 1;
let left = 0;
let top = 0;
let boxWidth = 0;
let boxHeight = 0;

export function updateViewport(): void {
  const w = k.width();
  const h = k.height();
  // Fit the design aspect inside the window; on a square monitor this is a no-op.
  scale = Math.min(w / DESIGN_WIDTH, h / DESIGN_HEIGHT);
  boxWidth = DESIGN_WIDTH * scale;
  boxHeight = DESIGN_HEIGHT * scale;
  left = (w - boxWidth) / 2;
  top = (h - boxHeight) / 2;
}

/** Device pixels per design unit. */
export function viewportScale(): number {
  return scale;
}

/** The square play area in device pixels: `[left, top, width, height]`. */
export function viewportBox(): readonly [number, number, number, number] {
  return [left, top, boxWidth, boxHeight];
}

/** Design x -> screen x. */
export function px(x: number): number {
  return left + x * scale;
}

/** Design y -> screen y. */
export function py(y: number): number {
  return top + y * scale;
}

/** Design length -> screen length. */
export function pu(length: number): number {
  return length * scale;
}

/**
 * Design length -> whole screen pixels.
 *
 * Used for font sizes: KAPLAY caches a glyph atlas per (font, size) pair, so
 * rounding keeps the number of distinct cache entries bounded even if someone
 * drags the window around for a while.
 */
export function pt(length: number): number {
  return Math.max(1, Math.round(length * scale));
}

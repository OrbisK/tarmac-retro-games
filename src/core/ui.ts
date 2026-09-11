import type { Color } from "kaplay";
import { DESIGN_HEIGHT, DESIGN_WIDTH, PALETTE, type PaletteKey } from "./config";
import { k } from "./k";
import { pt, pu, px, py, viewportBox } from "./viewport";

/**
 * Shared look-and-feel, and the single place design units become pixels.
 *
 * Every helper here takes **design units** and converts on the way to KAPLAY,
 * so screen and game code keeps working in one coordinate space while the
 * actual output is sized to the monitor. Draw through these rather than
 * calling `k.drawRect`/`k.drawText` directly, or the shape will land in raw
 * device pixels and ignore the viewport.
 *
 * Colors are built once at module load — `Color` instances are immutable
 * values, and re-deriving them from hex every frame would churn the heap.
 */

export const C = ((): Record<PaletteKey, Color> => {
  const out = {} as Record<PaletteKey, Color>;
  for (const key of Object.keys(PALETTE) as PaletteKey[]) {
    out[key] = k.Color.fromHex(PALETTE[key]);
  }
  return out;
})();

/** Per-player accent color. */
export function playerColor(player: number): Color {
  return player === 0 ? C.p1 : C.p2;
}

/**
 * Text sizes, in design units.
 *
 * Because text is now rasterised at its final pixel size, these are free to be
 * small numbers: 10 units on a 1440-tall screen is a 60px glyph, drawn sharp.
 */
export const FONT_SMALL = 10;
export const FONT_BODY = 12;
export const FONT_TITLE = 20;
/**
 * In-game countdowns and round verdicts — the numbers a player reads while
 * their hands are busy, from further back than anything else on screen.
 *
 * Games pass this through `scaleUnits()`, so it grows with the game scale.
 * Long lines (a "PLAYER 1 WINS" banner) stay on `FONT_TITLE`: they are
 * already large, and at 2x scale a 13-character line would not fit the box.
 */
export const FONT_HUGE = 28;

export const CENTER_X = DESIGN_WIDTH / 2;
export const CENTER_Y = DESIGN_HEIGHT / 2;

/** Fill the letterboxed play area. Drawn first by the scene wrapper. */
export function drawBackdrop(color: Color = C.bg): void {
  k.drawRect({
    pos: k.vec2(px(0), py(0)),
    width: pu(DESIGN_WIDTH),
    height: pu(DESIGN_HEIGHT),
    color,
  });
}

/** An axis-aligned rectangle, the workhorse primitive. */
export function drawBox(opts: {
  x: number;
  y: number;
  w: number;
  h: number;
  color?: Color;
  opacity?: number;
  outline?: Color;
  outlineWidth?: number;
}): void {
  k.drawRect({
    pos: k.vec2(px(opts.x), py(opts.y)),
    width: pu(opts.w),
    height: pu(opts.h),
    color: opts.color ?? C.text,
    opacity: opts.opacity ?? 1,
    ...(opts.outline
      ? { outline: { width: pt(opts.outlineWidth ?? 1), color: opts.outline } }
      : {}),
  });
}

export function drawDot(opts: { x: number; y: number; radius: number; color?: Color }): void {
  k.drawCircle({
    pos: k.vec2(px(opts.x), py(opts.y)),
    radius: pu(opts.radius),
    color: opts.color ?? C.text,
  });
}

export function drawTriangle(opts: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3: number;
  y3: number;
  color?: Color;
}): void {
  k.drawTriangle({
    p1: k.vec2(px(opts.x1), py(opts.y1)),
    p2: k.vec2(px(opts.x2), py(opts.y2)),
    p3: k.vec2(px(opts.x3), py(opts.y3)),
    color: opts.color ?? C.text,
  });
}

export function drawLabel(opts: {
  text: string;
  x: number;
  y: number;
  size?: number;
  color?: Color;
  anchor?: "left" | "center" | "right";
  opacity?: number;
}): void {
  const anchor = opts.anchor ?? "left";
  k.drawText({
    text: opts.text,
    size: pt(opts.size ?? FONT_BODY),
    pos: k.vec2(px(opts.x), py(opts.y)),
    color: opts.color ?? C.text,
    opacity: opts.opacity ?? 1,
    anchor: anchor === "left" ? "topleft" : anchor === "center" ? "top" : "topright",
  });
}

/** Measure a string in design units, for panels that size to their text. */
export function measureLabel(text: string, size = FONT_BODY): number {
  const scale = pu(1);
  if (scale <= 0) return 0;
  return k.formatText({ text, size: pt(size) }).width / scale;
}

/** A one-pixel-outline panel, the workhorse of the menu chrome. */
export function drawPanel(opts: {
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: Color;
  outline?: Color;
  fillOpacity?: number;
}): void {
  drawBox({
    x: opts.x,
    y: opts.y,
    w: opts.w,
    h: opts.h,
    color: opts.fill ?? C.bgAlt,
    opacity: opts.fillOpacity ?? 1,
    outline: opts.outline ?? C.dim,
  });
}

/** Horizontal progress bar, 0..1. Used for the hold-to-quit indicator. */
export function drawBar(opts: {
  x: number;
  y: number;
  w: number;
  h: number;
  progress: number;
  color?: Color;
}): void {
  const p = Math.max(0, Math.min(1, opts.progress));
  drawPanel({ x: opts.x, y: opts.y, w: opts.w, h: opts.h, fill: C.bg, outline: C.dim });
  if (p > 0) {
    drawBox({
      x: opts.x + 1,
      y: opts.y + 1,
      w: Math.max(0.5, (opts.w - 2) * p),
      h: opts.h - 2,
      color: opts.color ?? C.accent,
    });
  }
}

/** Dotted vertical divider, e.g. the Pong centre line. */
export function drawDottedColumn(x: number, dash = 4, gap = 4, color: Color = C.dim): void {
  for (let y = 0; y < DESIGN_HEIGHT; y += dash + gap) {
    drawBox({ x, y, w: 1, h: dash, color });
  }
}

/**
 * Repaint the black bars around the play area.
 *
 * Content that deliberately overflows the design box — a carousel card sliding
 * out, say — would otherwise be drawn over the letterbox. Calling this last
 * clips it, and costs nothing on a square window where there are no bars.
 */
export function drawLetterboxBars(): void {
  const [left, top, boxW, boxH] = viewportBox();
  const w = k.width();
  const h = k.height();
  if (left > 0.5) {
    k.drawRect({ pos: k.vec2(0, 0), width: left, height: h, color: C.black });
    k.drawRect({ pos: k.vec2(left + boxW, 0), width: w - left - boxW, height: h, color: C.black });
  }
  if (top > 0.5) {
    k.drawRect({ pos: k.vec2(0, 0), width: w, height: top, color: C.black });
    k.drawRect({ pos: k.vec2(0, top + boxH), width: w, height: h - top - boxH, color: C.black });
  }
}

/** Full-width horizontal rule. */
export function drawRule(y: number, color: Color = C.dim): void {
  drawBox({ x: 0, y, w: DESIGN_WIDTH, h: 1, color });
}

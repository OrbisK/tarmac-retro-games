import type { Color } from "kaplay";
import type { Button, FaceColor } from "./buttons";
import { input } from "./input";
import {
  C,
  drawBox,
  drawDot,
  drawLabel,
  drawTriangle,
  FONT_SMALL,
  measureLabel,
} from "./ui";

/**
 * On-screen button prompts.
 *
 * Directions draw as arrows and the face buttons as filled circles in the
 * colour actually printed on the pad, so a prompt looks like the thing the
 * player is holding. The colour is looked up through the live bindings, so it
 * follows the physical button if the action gets rebound.
 *
 * Colour is never the only cue: face glyphs carry their letter, and where a
 * row is too short for a legible letter the adjacent label says what the
 * button does.
 */

/** Glyph box side, in design units. Sized so the letter clears 10 units. */
export const GLYPH_SIZE = 14;

const FACE_LETTER: Partial<Record<Button, string>> = {
  a: "A",
  b: "B",
  x: "X",
  y: "Y",
};

/** Buttons with no printed colour get a labelled box instead of a circle. */
const BOX_LABEL: Partial<Record<Button, string>> = {
  l: "L",
  r: "R",
  start: "START",
  back: "BACK",
};

const FACE_COLOR: Record<FaceColor, Color> = {
  blue: C.btnBlue,
  red: C.btnRed,
  yellow: C.btnYellow,
  green: C.btnGreen,
};

function boxLabelSize(size: number): number {
  return Math.max(FONT_SMALL, size * 0.62);
}

function isDirection(button: Button): boolean {
  return button === "up" || button === "down" || button === "left" || button === "right";
}

/** Width a glyph will occupy, without drawing it. */
export function glyphWidth(button: Button, size = GLYPH_SIZE): number {
  const label = BOX_LABEL[button];
  if (label !== undefined) {
    return Math.max(size, measureLabel(label, boxLabelSize(size)) + 6);
  }
  return size;
}

/**
 * Draw one button glyph in a `size` box with its top-left at (x, y).
 * Returns the width consumed, so callers can lay out a row.
 *
 * `letter` can be turned off where the box is too short for a readable one —
 * the surrounding text is then carrying the meaning.
 */
export function drawButtonGlyph(opts: {
  x: number;
  y: number;
  button: Button;
  size?: number;
  player?: number;
  letter?: boolean;
}): number {
  const size = opts.size ?? GLYPH_SIZE;
  const { x, y, button } = opts;
  const showLetter = opts.letter ?? true;

  if (isDirection(button)) {
    // A solid arrow, inset so consecutive arrows read as separate glyphs.
    const near = size * 0.18;
    const far = size * 0.82;
    const mid = size / 2;
    const pts: Record<string, [number, number, number, number, number, number]> = {
      right: [near, near, near, far, far, mid],
      left: [far, near, far, far, near, mid],
      up: [near, far, far, far, mid, near],
      down: [near, near, far, near, mid, far],
    };
    const p = pts[button];
    if (p) {
      drawTriangle({
        x1: x + p[0],
        y1: y + p[1],
        x2: x + p[2],
        y2: y + p[3],
        x3: x + p[4],
        y3: y + p[5],
        color: C.text,
      });
    }
    return size;
  }

  const boxLabel = BOX_LABEL[button];
  if (boxLabel !== undefined) {
    const labelSize = boxLabelSize(size);
    const w = Math.max(size, measureLabel(boxLabel, labelSize) + 6);
    drawBox({ x, y, w, h: size, color: C.bg, outline: C.dim });
    drawLabel({
      text: boxLabel,
      x: x + w / 2,
      y: y + (size - labelSize) / 2,
      size: labelSize,
      color: C.text,
      anchor: "center",
    });
    return w;
  }

  // Face button: a filled circle in the colour printed on the pad.
  const color = input.faceColor(opts.player ?? 0, button);
  const fill = color ? FACE_COLOR[color] : null;
  const radius = size / 2;
  if (fill) {
    drawDot({ x: x + radius, y: y + radius, radius, color: fill });
  } else {
    // No pad, or bound to something with no printed colour.
    drawDot({ x: x + radius, y: y + radius, radius, color: C.dim });
    drawDot({ x: x + radius, y: y + radius, radius: radius - 1.5, color: C.bg });
  }

  const letter = FACE_LETTER[button];
  if (showLetter && letter !== undefined) {
    const letterSize = Math.max(FONT_SMALL, size * 0.72);
    drawLabel({
      text: letter,
      x: x + radius,
      y: y + (size - letterSize) / 2 - size * 0.04,
      size: letterSize,
      color: fill ? C.black : C.text,
      anchor: "center",
    });
  }
  return size;
}

/** One element of a hint row: a button glyph, or a run of text. */
export type Hint = { button: Button; player?: number } | { text: string } | { gap: number };

const HINT_SPACING = 3;

export function hintsWidth(hints: readonly Hint[], size = GLYPH_SIZE): number {
  let w = 0;
  for (let i = 0; i < hints.length; i++) {
    const hint = hints[i];
    if ("button" in hint) w += glyphWidth(hint.button, size);
    else if ("gap" in hint) w += hint.gap;
    else w += measureLabel(hint.text, Math.max(FONT_SMALL, size * 0.72));
    if (i < hints.length - 1) w += HINT_SPACING;
  }
  return w;
}

/**
 * Draw a row of glyphs and labels on one baseline, so footers stay aligned
 * however the bindings are configured.
 */
export function drawHints(opts: {
  x: number;
  y: number;
  hints: readonly Hint[];
  size?: number;
  align?: "left" | "right";
  color?: Color;
}): void {
  const size = opts.size ?? GLYPH_SIZE;
  const textSize = Math.max(FONT_SMALL, size * 0.72);
  let x = opts.align === "right" ? opts.x - hintsWidth(opts.hints, size) : opts.x;

  for (let i = 0; i < opts.hints.length; i++) {
    const hint = opts.hints[i];
    if ("button" in hint) {
      x += drawButtonGlyph({
        x,
        y: opts.y,
        button: hint.button,
        size,
        ...(hint.player === undefined ? {} : { player: hint.player }),
      });
    } else if ("gap" in hint) {
      x += hint.gap;
    } else {
      drawLabel({
        text: hint.text,
        x,
        y: opts.y + (size - textSize) / 2,
        size: textSize,
        color: opts.color ?? C.textDim,
      });
      x += measureLabel(hint.text, textSize);
    }
    if (i < opts.hints.length - 1) x += HINT_SPACING;
  }
}

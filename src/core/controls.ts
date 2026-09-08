import type { Color } from "kaplay";
import type { Button } from "./buttons";
import { DESIGN_HEIGHT, DESIGN_WIDTH, MAX_PLAYERS } from "./config";
import { input } from "./input";
import { drawButtonGlyph, drawHints, glyphWidth, hintsWidth, type Hint } from "./prompts";
import {
  C,
  drawBox,
  drawLabel,
  drawPanel,
  FONT_BODY,
  FONT_SMALL,
  measureLabel,
} from "./ui";

/**
 * The controls modal: one panel per game, listing what each button does.
 *
 * Opened from the menu so a player can read the layout of the game they are
 * about to start without launching it. Games declare the rows and nothing
 * else — the quit line is the same everywhere, so it is added here, and the
 * panel sizes itself to whatever it is handed.
 *
 * Rows are glyph runs from `prompts.ts`, so a rebound action shows the button
 * that actually drives it, in the colour printed on the pad.
 */

/** One line: the buttons that do a thing, and the thing they do. */
export interface ControlRow {
  readonly buttons: readonly Button[];
  readonly label: string;
}

const GLYPH = 14;
/** Space between two glyphs in the same run, matching `drawHints`. */
const GLYPH_GAP = 3;
const ROW_H = 18;
const PAD = 8;
/** Gap between the glyph column and the label column. */
const COL_GAP = 8;
const FOOTER_GLYPH = 12;
const MIN_W = 176;
const MAX_W = 300;

/** Every in-game scene installs `installQuitToMenu`, so this holds for all. */
const QUIT_ROW: ControlRow = { buttons: ["back"], label: "HOLD TO QUIT" };

/** Built once: `onDraw` must not allocate. */
const FOOTER_HINTS: readonly Hint[] = [
  { button: "a" },
  { text: "PLAY" },
  { gap: 8 },
  { button: "b" },
  { text: "CLOSE" },
];

/**
 * Fallback for a cabinet with nothing plugged in — development, mostly.
 * Hidden the moment a pad shows up: once there is real hardware to play on,
 * the keyboard line is noise on top of the glyph rows.
 */
const KEY_NOTE = "KEYS  P1 WASD  P2 ARROWS";

function runWidth(row: ControlRow): number {
  let w = 0;
  for (let i = 0; i < row.buttons.length; i++) {
    w += glyphWidth(row.buttons[i], GLYPH);
    if (i < row.buttons.length - 1) w += GLYPH_GAP;
  }
  return w;
}

/**
 * Draw the modal centred over whatever is already on screen.
 *
 * Allocation-free: the panel is measured with numbers rather than by building
 * hint arrays, since this runs every frame the modal is open.
 */
export function drawControlsModal(opts: {
  title: string;
  rows: readonly ControlRow[];
  accent: Color;
}): void {
  const rows = opts.rows;
  /** `rows` plus the shared quit line. */
  const rowCount = rows.length + 1;

  let showKeys = true;
  for (let p = 0; p < MAX_PLAYERS; p++) {
    if (input.padConnected(p)) showKeys = false;
  }

  // --- measure ---
  let glyphCol = 0;
  let labelCol = 0;
  for (let i = 0; i < rowCount; i++) {
    const row = i < rows.length ? rows[i] : QUIT_ROW;
    glyphCol = Math.max(glyphCol, runWidth(row));
    labelCol = Math.max(labelCol, measureLabel(row.label, FONT_SMALL));
  }
  let contentW = Math.max(
    glyphCol + COL_GAP + labelCol,
    measureLabel(opts.title, FONT_BODY),
    hintsWidth(FOOTER_HINTS, FOOTER_GLYPH),
  );
  if (showKeys) contentW = Math.max(contentW, measureLabel(KEY_NOTE, FONT_SMALL));

  const w = Math.min(MAX_W, Math.max(MIN_W, Math.ceil(contentW) + PAD * 2));
  const h =
    PAD * 2 +
    FONT_BODY +
    6 +
    rowCount * ROW_H +
    (showKeys ? FONT_SMALL + 6 : 0) +
    4 +
    FOOTER_GLYPH;
  const x = Math.round((DESIGN_WIDTH - w) / 2);
  const y = Math.round((DESIGN_HEIGHT - h) / 2);

  // --- draw ---
  drawBox({ x: 0, y: 0, w: DESIGN_WIDTH, h: DESIGN_HEIGHT, color: C.black, opacity: 0.78 });
  drawPanel({ x, y, w, h, fill: C.bgAlt, outline: opts.accent });

  drawLabel({
    text: opts.title,
    x: x + w / 2,
    y: y + PAD,
    size: FONT_BODY,
    color: opts.accent,
    anchor: "center",
  });

  let rowY = y + PAD + FONT_BODY + 6;
  const labelX = x + PAD + glyphCol + COL_GAP;
  for (let i = 0; i < rowCount; i++) {
    const row = i < rows.length ? rows[i] : QUIT_ROW;
    let glyphX = x + PAD;
    for (let j = 0; j < row.buttons.length; j++) {
      glyphX += drawButtonGlyph({ x: glyphX, y: rowY, button: row.buttons[j], size: GLYPH });
      glyphX += GLYPH_GAP;
    }
    drawLabel({
      text: row.label,
      x: labelX,
      y: rowY + (GLYPH - FONT_SMALL) / 2,
      size: FONT_SMALL,
      // White throughout, including the quit line: on `bgAlt` the dim greys
      // give up too much contrast at 10 units, and the quit row is already
      // set apart by sitting last, under the game's own actions.
      color: C.white,
    });
    rowY += ROW_H;
  }

  if (showKeys) {
    drawLabel({
      text: KEY_NOTE,
      x: x + w / 2,
      y: rowY,
      size: FONT_SMALL,
      color: C.white,
      anchor: "center",
    });
    rowY += FONT_SMALL + 6;
  }

  drawHints({
    x: x + w / 2 - hintsWidth(FOOTER_HINTS, FOOTER_GLYPH) / 2,
    y: y + h - PAD - FOOTER_GLYPH,
    size: FOOTER_GLYPH,
    hints: FOOTER_HINTS,
    // `drawHints` defaults its text to `textDim`; the panel needs white.
    color: C.white,
  });
}

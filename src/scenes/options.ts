import { DESIGN_HEIGHT, DESIGN_WIDTH } from "../core/config";
import { input } from "../core/input";
import { k } from "../core/k";
import { drawHints, type Hint } from "../core/prompts";
import { installQuitToMenu } from "../core/quit";
import { defineScene, goTo, INPUT_TEST_SCENE, OPTIONS_SCENE } from "../core/scene";
import {
  GAME_SCALE_STEPS,
  gameScale,
  gameScaleIndex,
  nudgeGameScale,
  resetSettings,
  settingsAreCustomised,
} from "../core/settings";
import {
  C,
  drawBox,
  drawLabel,
  drawPanel,
  drawRule,
  drawTriangle,
  FONT_SMALL,
} from "../core/ui";
import { GAMES } from "../games/registry";

/**
 * Options: the cabinet-side settings, currently just the game scale.
 *
 * Navigated with **directions only**, like the input test and button setup it
 * sits next to — this screen is reachable on a pad whose face buttons report
 * the wrong indices, and it should stay usable there.
 *
 * Each game draws its own sample below at true design-unit size, so a change
 * can be judged here rather than by launching a match and coming back.
 */

const ROW_SCALE = 0;
const ROW_RESET = 1;
const ROW_COUNT = 2;

const ROW_H = 13;
const ROWS_TOP = 19;
const CARET_X = 4;
const LABEL_X = 14;
const VALUE_X = 122;
const PIPS_X = 168;
/** Status marks stay at 5+ units square; 7 keeps a gap between them too. */
const PIP_SIZE = 7;
const PIP_STRIDE = 11;

const PANEL_TOP = ROWS_TOP + ROW_H * ROW_COUNT + 6;
const PANEL_H = DESIGN_HEIGHT - PANEL_TOP - 40;
const PANEL_MARGIN = 4;
const PANEL_GAP = 6;

const STATUS_SECONDS = 2.2;

/** Built once: the footer differs by row, and `onDraw` must not allocate. */
const SCALE_HINTS = [
  { button: "up" },
  { button: "down" },
  { text: "PICK" },
  { gap: 6 },
  { button: "left" },
  { button: "right" },
  { text: "SCALE" },
  { gap: 6 },
  { button: "l" },
  { text: "INPUT" },
] as const satisfies readonly Hint[];

/** Only Right acts on the reset row, so Left is not advertised there. */
const RESET_HINTS = [
  { button: "up" },
  { button: "down" },
  { text: "PICK" },
  { gap: 6 },
  { button: "right" },
  { text: "RESET" },
  { gap: 6 },
  { button: "l" },
  { text: "INPUT" },
] as const satisfies readonly Hint[];

/**
 * Filtered once at module load, not per frame: `onDraw` must not allocate,
 * and the registry is fixed for the life of the process.
 */
const SAMPLE_GAMES = GAMES.filter((game) => game.drawScaleSample);

/** "1x", "1.25x" — the trailing zero on 1.50 would read as false precision. */
function scaleText(): string {
  return `${gameScale()}x`;
}

function drawScaleRow(y: number): void {
  drawLabel({ text: "GAME SCALE", x: LABEL_X, y, size: FONT_SMALL, color: C.text });
  drawLabel({
    text: scaleText(),
    x: VALUE_X,
    y,
    size: FONT_SMALL,
    color: C.accent,
  });
  const selected = gameScaleIndex();
  for (let i = 0; i < GAME_SCALE_STEPS.length; i++) {
    const on = i <= selected;
    drawBox({
      x: PIPS_X + i * PIP_STRIDE,
      y: y + 1,
      w: PIP_SIZE,
      h: PIP_SIZE,
      color: on ? C.accent : C.bg,
      outline: on ? C.accent : C.dim,
    });
  }
}

function drawResetRow(y: number): void {
  const customised = settingsAreCustomised();
  drawLabel({ text: "RESET DEFAULTS", x: LABEL_X, y, size: FONT_SMALL, color: C.text });
  drawLabel({
    text: customised ? "CHANGED" : "AT DEFAULT",
    x: VALUE_X,
    y,
    size: FONT_SMALL,
    color: customised ? C.accent : C.textDim,
  });
}

/** One panel per game that offers a sample, side by side across the box. */
function drawSamples(): void {
  if (SAMPLE_GAMES.length === 0) return;
  const total = DESIGN_WIDTH - PANEL_MARGIN * 2;
  const panelW = (total - PANEL_GAP * (SAMPLE_GAMES.length - 1)) / SAMPLE_GAMES.length;

  for (let i = 0; i < SAMPLE_GAMES.length; i++) {
    const game = SAMPLE_GAMES[i];
    const x = PANEL_MARGIN + i * (panelW + PANEL_GAP);
    drawPanel({ x, y: PANEL_TOP, w: panelW, h: PANEL_H, fill: C.bg, outline: C.dim });
    drawLabel({
      text: game.title,
      x: x + panelW / 2,
      y: PANEL_TOP + 3,
      size: FONT_SMALL,
      color: C[game.accent],
      anchor: "center",
    });
    game.drawScaleSample?.(
      x + 3,
      PANEL_TOP + 3 + FONT_SMALL + 3,
      panelW - 6,
      PANEL_H - (3 + FONT_SMALL + 3) - 4,
    );
  }
}

function main(): void {
  installQuitToMenu();

  let row = ROW_SCALE;
  let status = "";
  let statusLeft = 0;

  function say(message: string): void {
    status = message;
    statusLeft = STATUS_SECONDS;
  }

  k.onUpdate(() => {
    if (statusLeft > 0) {
      statusLeft -= k.dt();
      if (statusLeft <= 0) status = "";
    }

    if (input.anyPressed("up")) row = (row + ROW_COUNT - 1) % ROW_COUNT;
    if (input.anyPressed("down")) row = (row + 1) % ROW_COUNT;

    if (row === ROW_SCALE) {
      // Edge-triggered, not repeat-triggered: five steps is a short ladder and
      // a held direction would run off the end before anyone let go.
      if (input.anyPressed("left") && nudgeGameScale(-1)) say(`SCALE ${scaleText()}`);
      if (input.anyPressed("right") && nudgeGameScale(1)) say(`SCALE ${scaleText()}`);
    } else if (input.anyPressed("right")) {
      resetSettings();
      say(`RESTORED ${scaleText()}`);
    }

    if (input.anyPressed("l")) goTo(INPUT_TEST_SCENE);
  });

  k.onDraw(() => {
    drawLabel({ text: "OPTIONS", x: 4, y: 3, size: FONT_SMALL, color: C.accent });
    drawLabel({
      text: "APPLIES ON NEXT LAUNCH",
      x: DESIGN_WIDTH - 4,
      y: 3,
      size: FONT_SMALL,
      color: C.textDim,
      anchor: "right",
    });
    drawRule(14);

    for (let i = 0; i < ROW_COUNT; i++) {
      const y = ROWS_TOP + i * ROW_H;
      if (i === row) {
        drawBox({
          x: 1,
          y: y - 2,
          w: DESIGN_WIDTH - 2,
          h: ROW_H,
          color: C.bgAlt,
        });
        drawTriangle({
          x1: CARET_X,
          y1: y,
          x2: CARET_X,
          y2: y + 8,
          x3: CARET_X + 6,
          y3: y + 4,
          color: C.accent,
        });
      }
      if (i === ROW_SCALE) drawScaleRow(y);
      else if (i === ROW_RESET) drawResetRow(y);
    }

    drawSamples();

    if (status !== "") {
      drawLabel({
        text: status,
        x: 4,
        y: PANEL_TOP + PANEL_H + 3,
        size: FONT_SMALL,
        color: C.good,
      });
    }

    drawHints({
      x: 4,
      y: DESIGN_HEIGHT - 16,
      hints: row === ROW_SCALE ? SCALE_HINTS : RESET_HINTS,
    });
  });
}

export function registerOptions(): void {
  defineScene(OPTIONS_SCENE, main);
}

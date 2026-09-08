import { DESIGN_HEIGHT, DESIGN_WIDTH } from "../core/config";
import type { GameDefinition } from "../core/game";
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
  isLocked,
  nudgeUnlock,
  resetUnlocks,
  UNLOCK_FIELDS,
  unlockCountdownText,
  unlockFieldText,
  unlockScheduled,
  unlocksAreCustomised,
} from "../core/unlocks";
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
 * Options: the cabinet-side settings — game scale, and a release time per
 * game.
 *
 * Navigated with **directions only**, like the input test and button setup it
 * sits next to — this screen is reachable on a pad whose face buttons report
 * the wrong indices, and it should stay usable there. That is what shapes the
 * unlock rows: with four directions and no confirm button, a row is *entered*
 * with Right, its fields are walked with Left/Right, values are changed with
 * Up/Down, and Left off the first field leaves the row again. Up/Down are the
 * row picker until a row is entered, and the value knob after.
 *
 * Each game draws its own scale sample below at true design-unit size, so a
 * change can be judged here rather than by launching a match and coming back.
 */

interface ScaleRow {
  readonly kind: "scale";
}
interface UnlockRow {
  readonly kind: "unlock";
  readonly game: GameDefinition;
}
interface ResetRow {
  readonly kind: "reset";
}
type Row = ScaleRow | UnlockRow | ResetRow;

/**
 * Built once at module load, not per frame: the registry is fixed for the life
 * of the process and `onDraw` must not allocate.
 */
const ROWS: readonly Row[] = [
  { kind: "scale" },
  ...GAMES.map((game): UnlockRow => ({ kind: "unlock", game })),
  { kind: "reset" },
];

const ROW_H = 13;
const ROWS_TOP = 19;
const CARET_X = 4;
const LABEL_X = 14;
const VALUE_X = 122;
const PIPS_X = 168;
/** Status marks stay at 5+ units square; 7 keeps a gap between them too. */
const PIP_SIZE = 7;
const PIP_STRIDE = 11;

/**
 * Left edge of each unlock field, in `UNLOCK_FIELDS` order — on/off, day,
 * month, year, hour, minute — and the width of its box. Fixed rather than
 * measured, so the columns line up down the list whatever the values say,
 * and wide enough that the box the cursor draws never touches its neighbour.
 */
const FIELD_X = [90, 116, 134, 158, 186, 209] as const;
const FIELD_W = [22, 16, 22, 26, 16, 16] as const;
/** Between the hour and minute boxes, not a field of its own. */
const COLON_X = 203;

const PANEL_TOP = ROWS_TOP + ROW_H * ROWS.length + 6;
const PANEL_H = DESIGN_HEIGHT - PANEL_TOP - 40;
const PANEL_MARGIN = 4;
const PANEL_GAP = 6;
/** Below this a sample panel is too short to show anything, so it is dropped. */
const PANEL_MIN_H = 44;

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

/** An unlock row that has not been entered yet: Right goes in. */
const UNLOCK_HINTS = [
  { button: "up" },
  { button: "down" },
  { text: "PICK" },
  { gap: 6 },
  { button: "right" },
  { text: "EDIT" },
  { gap: 6 },
  { button: "l" },
  { text: "INPUT" },
] as const satisfies readonly Hint[];

/** Inside an unlock row: directions change meaning, so they are re-labelled. */
const UNLOCK_EDIT_HINTS = [
  { button: "left" },
  { button: "right" },
  { text: "FIELD" },
  { gap: 6 },
  { button: "up" },
  { button: "down" },
  { text: "SET" },
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

/** The one thing about editing a row that the hint row has no space for. */
const EDIT_HELP = "LEFT FROM ON/OFF LEAVES THE ROW";

/** Filtered once at module load, for the same reason as `ROWS`. */
const SAMPLE_GAMES = GAMES.filter((game) => game.drawScaleSample);
const SHOW_SAMPLES = SAMPLE_GAMES.length > 0 && PANEL_H >= PANEL_MIN_H;
const FOOT_TOP = SHOW_SAMPLES ? PANEL_TOP + PANEL_H : PANEL_TOP;

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

/**
 * One game's release time: on/off, the timestamp field by field, and where
 * that leaves the game right now.
 *
 * `field` is the field being edited, or -1 when the row has not been entered.
 * The countdown on the right is what makes a wrong cabinet clock obvious: it
 * is the same number the menu will show a player.
 */
function drawUnlockRow(game: GameDefinition, y: number, field: number, now: number): void {
  drawLabel({ text: game.title, x: LABEL_X, y, size: FONT_SMALL, color: C[game.accent] });

  const scheduled = unlockScheduled(game.id);
  for (let i = 0; i < UNLOCK_FIELDS.length; i++) {
    const active = i === field;
    if (active) {
      drawBox({
        x: FIELD_X[i],
        y: y - 2,
        w: FIELD_W[i],
        h: 12,
        color: C.bg,
        outline: C.accent,
      });
    }
    // The time is dimmed while the schedule is off: still readable — it can
    // be set before being armed — but plainly not in force. `textDim` rather
    // than `dim`, which is a border grey and too low-contrast to read; the
    // state is not carried by the dimming anyway, the ON/OFF field says it.
    const color = active ? C.accent : i === 0 || scheduled ? C.text : C.textDim;
    drawLabel({
      text: unlockFieldText(game.id, UNLOCK_FIELDS[i]),
      x: FIELD_X[i] + FIELD_W[i] / 2,
      y,
      size: FONT_SMALL,
      color,
      anchor: "center",
    });
  }
  drawLabel({
    text: ":",
    x: COLON_X,
    y,
    size: FONT_SMALL,
    color: scheduled ? C.text : C.textDim,
  });

  const locked = isLocked(game.id, now);
  drawLabel({
    text: locked ? unlockCountdownText(game.id, now) : "OPEN",
    x: DESIGN_WIDTH - 4,
    y,
    size: FONT_SMALL,
    color: locked ? C.bad : C.good,
    anchor: "right",
  });
}

function drawResetRow(y: number): void {
  const customised = settingsAreCustomised() || unlocksAreCustomised();
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

  let rowIndex = 0;
  /** Field being edited on the selected unlock row, or -1 when not in one. */
  let field = -1;
  let status = "";
  let statusLeft = 0;

  function say(message: string): void {
    status = message;
    statusLeft = STATUS_SECONDS;
  }

  function moveRow(delta: number): void {
    rowIndex = (rowIndex + ROWS.length + delta) % ROWS.length;
    // Leaving a row always drops out of its fields: a field cursor left
    // behind would reappear the next time the row came round.
    field = -1;
  }

  k.onUpdate(() => {
    if (statusLeft > 0) {
      statusLeft -= k.dt();
      if (statusLeft <= 0) status = "";
    }

    const row = ROWS[rowIndex];

    if (row.kind === "unlock" && field >= 0) {
      if (input.anyPressed("left")) {
        if (field === 0) field = -1;
        else field--;
      } else if (input.anyPressed("right")) {
        field = Math.min(UNLOCK_FIELDS.length - 1, field + 1);
      }
      if (field >= 0) {
        // Repeat rather than edge, unlike the scale row: stepping an hour a
        // minute at a time would otherwise be sixty presses.
        const step = (input.anyRepeated("up") ? 1 : 0) - (input.anyRepeated("down") ? 1 : 0);
        const name = UNLOCK_FIELDS[field];
        if (step !== 0 && nudgeUnlock(row.game.id, name, step) && name === "state") {
          say(unlockScheduled(row.game.id) ? "UNLOCK TIME ON" : "UNLOCK TIME OFF");
        }
      }
    } else {
      if (input.anyPressed("up")) moveRow(-1);
      if (input.anyPressed("down")) moveRow(1);

      const current = ROWS[rowIndex];
      if (current.kind === "scale") {
        // Edge-triggered: five steps is a short ladder and a held direction
        // would run off the end before anyone let go.
        if (input.anyPressed("left") && nudgeGameScale(-1)) say(`SCALE ${scaleText()}`);
        if (input.anyPressed("right") && nudgeGameScale(1)) say(`SCALE ${scaleText()}`);
      } else if (current.kind === "unlock") {
        if (input.anyPressed("right")) field = 0;
      } else if (input.anyPressed("right")) {
        resetSettings();
        resetUnlocks();
        say("DEFAULTS RESTORED");
      }
    }

    if (input.anyPressed("l")) goTo(INPUT_TEST_SCENE);
  });

  k.onDraw(() => {
    const now = Date.now();
    drawLabel({ text: "OPTIONS", x: 4, y: 3, size: FONT_SMALL, color: C.accent });
    drawLabel({
      text: "SCALE APPLIES ON NEXT LAUNCH",
      x: DESIGN_WIDTH - 4,
      y: 3,
      size: FONT_SMALL,
      color: C.textDim,
      anchor: "right",
    });
    drawRule(14);

    for (let i = 0; i < ROWS.length; i++) {
      const row = ROWS[i];
      const y = ROWS_TOP + i * ROW_H;
      const selected = i === rowIndex;
      if (selected) {
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
      if (row.kind === "scale") drawScaleRow(y);
      else if (row.kind === "unlock") drawUnlockRow(row.game, y, selected ? field : -1, now);
      else drawResetRow(y);
    }

    if (SHOW_SAMPLES) drawSamples();

    const editing = ROWS[rowIndex].kind === "unlock" && field >= 0;
    if (status !== "") {
      drawLabel({
        text: status,
        x: 4,
        y: FOOT_TOP + 3,
        size: FONT_SMALL,
        color: C.good,
      });
    } else if (editing) {
      drawLabel({
        text: EDIT_HELP,
        x: 4,
        y: FOOT_TOP + 3,
        size: FONT_SMALL,
        color: C.textDim,
      });
    }

    drawHints({
      x: 4,
      y: DESIGN_HEIGHT - 16,
      hints: editing
        ? UNLOCK_EDIT_HINTS
        : ROWS[rowIndex].kind === "scale"
          ? SCALE_HINTS
          : ROWS[rowIndex].kind === "unlock"
            ? UNLOCK_HINTS
            : RESET_HINTS,
    });
  });
}

export function registerOptions(): void {
  defineScene(OPTIONS_SCENE, main);
}

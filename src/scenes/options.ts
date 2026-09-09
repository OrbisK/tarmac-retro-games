import { DESIGN_HEIGHT, DESIGN_WIDTH } from "../core/config";
import type { GameDefinition } from "../core/game";
import { input } from "../core/input";
import { k } from "../core/k";
import { drawHints, type Hint } from "../core/prompts";
import { installQuitToMenu } from "../core/quit";
import {
  GAME_STATE_OFF,
  GAME_STATE_TIMED,
  gameStateHelp,
  gameStateIndex,
  gameStateText,
  nudgeGameState,
  resetRoster,
  rosterIsCustomised,
} from "../core/roster";
import { defineScene, goTo, INPUT_TEST_SCENE, OPTIONS_SCENE } from "../core/scene";
import {
  GAME_SCALE_STEPS,
  gameScale,
  gameScaleIndex,
  IDLE_RETURN_STEPS,
  idleReturnIndex,
  idleReturnText,
  nudgeGameScale,
  nudgeIdleReturn,
  resetSettings,
  settingsAreCustomised,
} from "../core/settings";
import {
  isLocked,
  nudgeUnlock,
  resetUnlocks,
  UNLOCK_TIME_FIELDS,
  unlockCountdownText,
  unlockFieldText,
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
 * Options: the cabinet-side settings — game scale, the idle timeout, and one
 * row per game saying whether it plays and from when.
 *
 * Navigated with **directions only**, like the input test and button setup it
 * sits next to — this screen is reachable on a pad whose face buttons report
 * the wrong indices, and it should stay usable there. That is what shapes the
 * game rows: with four directions and no confirm button, a row is *entered*
 * with Right, its fields are walked with Left/Right, values are changed with
 * Up/Down, and Left off the first field leaves the row again. Up/Down are the
 * row picker until a row is entered, and the value knob after.
 *
 * It is also why a game's first field is one three-position state — `OFF`,
 * `ON`, `TIMED` — rather than a roster switch and a schedule switch side by
 * side. There is no room for a seventh field next to a 12-character title and
 * a countdown, and the operator is answering one question anyway: does this
 * game play, and from when. `core/roster.ts` composes the two flags.
 *
 * Each game draws its own scale sample below at true design-unit size, so a
 * change can be judged here rather than by launching a match and coming back.
 */

interface ScaleRow {
  readonly kind: "scale";
}
interface IdleRow {
  readonly kind: "idle";
}
interface GameRow {
  readonly kind: "game";
  readonly game: GameDefinition;
}
interface ResetRow {
  readonly kind: "reset";
}
type Row = ScaleRow | IdleRow | GameRow | ResetRow;

/**
 * Built once at module load, not per frame: the registry is fixed for the life
 * of the process and `onDraw` must not allocate.
 */
const ROWS: readonly Row[] = [
  { kind: "scale" },
  { kind: "idle" },
  ...GAMES.map((game): GameRow => ({ kind: "game", game })),
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
 * The fields of a game row: the state, then `UNLOCK_TIME_FIELDS`.
 *
 * One list rather than two, because the cursor walks all six with the same
 * two directions; index 0 goes to `core/roster.ts` and the rest to
 * `core/unlocks.ts`.
 */
const FIELD_COUNT = 1 + UNLOCK_TIME_FIELDS.length;

/**
 * Left edge of each of those fields and the width of its box. Fixed rather
 * than measured, so the columns line up down the list whatever the values
 * say, and wide enough that the box the cursor draws never touches its
 * neighbour — the state box takes `TIMED`, the widest value on the screen.
 */
const FIELD_X = [90, 130, 148, 172, 200, 223] as const;
const FIELD_W = [36, 16, 22, 26, 16, 16] as const;
/** Between the hour and minute boxes, not a field of its own. */
const COLON_X = 217;

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

/** Same shape as the scale row, so the same two directions change it. */
const IDLE_HINTS = [
  { button: "up" },
  { button: "down" },
  { text: "PICK" },
  { gap: 6 },
  { button: "left" },
  { button: "right" },
  { text: "TIMEOUT" },
  { gap: 6 },
  { button: "l" },
  { text: "INPUT" },
] as const satisfies readonly Hint[];

/** A game row that has not been entered yet: Right goes in. */
const GAME_HINTS = [
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

/** Inside a game row: directions change meaning, so they are re-labelled. */
const GAME_EDIT_HINTS = [
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
const EDIT_HELP = "LEFT FROM THE FIRST FIELD LEAVES THE ROW";

/** Filtered once at module load, for the same reason as `ROWS`. */
const SAMPLE_GAMES = GAMES.filter((game) => game.drawScaleSample);
const SHOW_SAMPLES = SAMPLE_GAMES.length > 0 && PANEL_H >= PANEL_MIN_H;
const FOOT_TOP = SHOW_SAMPLES ? PANEL_TOP + PANEL_H : PANEL_TOP;

/**
 * A panel narrower than this cannot hold a 12-character title, let alone a
 * sample at true size — so the strip is a **window** of that many panels
 * rather than one panel per game. Dividing the box by the registry worked at
 * four games and stopped working at five, and the registry only grows.
 *
 * The window follows the cursor: it centres on the last game row visited and
 * stays there while the scale itself is being changed two rows up, which is
 * the sequence an operator actually performs.
 */
const PANEL_MIN_W = 92;
const PANEL_VISIBLE = Math.max(
  1,
  Math.min(
    SAMPLE_GAMES.length,
    Math.floor((DESIGN_WIDTH - PANEL_MARGIN * 2 + PANEL_GAP) / (PANEL_MIN_W + PANEL_GAP)),
  ),
);

/** "1x", "1.25x" — the trailing zero on 1.50 would read as false precision. */
function scaleText(): string {
  return `${gameScale()}x`;
}

/** "IDLE 1M" / "IDLE TIMEOUT OFF" for the status line under the rows. */
function idleStatus(): string {
  return idleReturnIndex() > 0 ? `IDLE ${idleReturnText()}` : "IDLE TIMEOUT OFF";
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
 * The idle timeout: how long a game sits untouched before the cabinet takes
 * itself back to the menu, or `OFF`.
 *
 * Same ladder-of-pips shape as the scale row above it, with one difference:
 * `OFF` lights none. A lit pip means "this much timeout", so the shortest
 * setting has to be one pip and no-timeout has to be zero — a lit pip on
 * `OFF` would read as some.
 */
function drawIdleRow(y: number): void {
  const selected = idleReturnIndex();
  drawLabel({ text: "IDLE TIMEOUT", x: LABEL_X, y, size: FONT_SMALL, color: C.text });
  drawLabel({
    text: idleReturnText(),
    x: VALUE_X,
    y,
    size: FONT_SMALL,
    // Off is a state worth spotting from the doorway: this is the one setting
    // that stops the cabinet putting itself back on the menu.
    color: selected > 0 ? C.accent : C.bad,
  });
  for (let i = 1; i < IDLE_RETURN_STEPS.length; i++) {
    const on = i <= selected;
    drawBox({
      x: PIPS_X + (i - 1) * PIP_STRIDE,
      y: y + 1,
      w: PIP_SIZE,
      h: PIP_SIZE,
      color: on ? C.accent : C.bg,
      outline: on ? C.accent : C.dim,
    });
  }
}

/** The text in field `i` of a game row. */
function fieldText(id: string, i: number): string {
  return i === 0 ? gameStateText(id) : unlockFieldText(id, UNLOCK_TIME_FIELDS[i - 1]);
}

/** Step field `i` of a game row. Returns whether it moved. */
function nudgeField(id: string, i: number, delta: number): boolean {
  return i === 0 ? nudgeGameState(id, delta) : nudgeUnlock(id, UNLOCK_TIME_FIELDS[i - 1], delta);
}

/**
 * One game: whether it plays, the release timestamp field by field, and where
 * that leaves it right now.
 *
 * `field` is the field being edited, or -1 when the row has not been entered.
 * The right-hand column is the consequence rather than the setting — `HIDDEN`,
 * `OPEN`, or the countdown a player will see — and the countdown is also what
 * makes a wrong cabinet clock obvious, being the same number the menu shows.
 */
function drawGameRow(game: GameDefinition, y: number, field: number, now: number): void {
  const state = gameStateIndex(game.id);
  const off = state === GAME_STATE_OFF;
  // A game that is off gives up its accent, the same way a locked card does
  // on the menu: the colour is part of an identity the cabinet is not
  // offering. Never the only cue — the state field and the status say it too.
  drawLabel({
    text: game.title,
    x: LABEL_X,
    y,
    size: FONT_SMALL,
    color: off ? C.textDim : C[game.accent],
  });

  const timed = state === GAME_STATE_TIMED;
  for (let i = 0; i < FIELD_COUNT; i++) {
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
    // The time is dimmed unless it is in force: still readable — it can be
    // set before being armed, or while the game is off — but plainly not
    // doing anything. `textDim` rather than `dim`, which is a border grey and
    // too low-contrast to read; the dimming carries nothing on its own
    // anyway, the state field says which of the three positions this is.
    //
    // `OFF` keeps its red under the cursor: the outline box is what marks the
    // cursor, so the colour is free to go on saying the game is not playable.
    const color =
      i === 0 && off ? C.bad : active ? C.accent : i === 0 || timed ? C.text : C.textDim;
    drawLabel({
      text: fieldText(game.id, i),
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
    color: timed ? C.text : C.textDim,
  });

  const locked = isLocked(game.id, now);
  drawLabel({
    text: off ? "HIDDEN" : locked ? unlockCountdownText(game.id, now) : "OPEN",
    x: DESIGN_WIDTH - 4,
    y,
    size: FONT_SMALL,
    color: off || locked ? C.bad : C.good,
    anchor: "right",
  });
}

function drawResetRow(y: number): void {
  const customised = settingsAreCustomised() || unlocksAreCustomised() || rosterIsCustomised();
  drawLabel({ text: "RESET DEFAULTS", x: LABEL_X, y, size: FONT_SMALL, color: C.text });
  drawLabel({
    text: customised ? "CHANGED" : "AT DEFAULT",
    x: VALUE_X,
    y,
    size: FONT_SMALL,
    color: customised ? C.accent : C.textDim,
  });
}

/**
 * The sample strip: `PANEL_VISIBLE` panels, windowed around `anchor`.
 *
 * `selected` is the panel whose game row the cursor is on, outlined in its own
 * accent — without it, a strip that scrolls under a cursor two rows away would
 * be movement with no stated cause.
 */
function drawSamples(anchor: number, selected: number): void {
  const total = DESIGN_WIDTH - PANEL_MARGIN * 2;
  const panelW = (total - PANEL_GAP * (PANEL_VISIBLE - 1)) / PANEL_VISIBLE;
  const start = Math.max(
    0,
    Math.min(SAMPLE_GAMES.length - PANEL_VISIBLE, anchor - Math.floor(PANEL_VISIBLE / 2)),
  );

  for (let i = 0; i < PANEL_VISIBLE; i++) {
    const index = start + i;
    const game = SAMPLE_GAMES[index];
    const x = PANEL_MARGIN + i * (panelW + PANEL_GAP);
    drawPanel({
      x,
      y: PANEL_TOP,
      w: panelW,
      h: PANEL_H,
      fill: C.bg,
      outline: index === selected ? C[game.accent] : C.dim,
    });
    drawLabel({
      text: game.title,
      x: x + panelW / 2,
      y: PANEL_TOP + 3,
      size: FONT_SMALL,
      color: C[game.accent],
      anchor: "center",
    });
    // A marker in the outer corner where the strip continues, so panels that
    // are off the window are known to be there rather than missing.
    if (i === 0 && start > 0) {
      drawTriangle({
        x1: x + 8,
        y1: PANEL_TOP + 3,
        x2: x + 8,
        y2: PANEL_TOP + 11,
        x3: x + 3,
        y3: PANEL_TOP + 7,
        color: C.dim,
      });
    }
    if (i === PANEL_VISIBLE - 1 && index < SAMPLE_GAMES.length - 1) {
      drawTriangle({
        x1: x + panelW - 8,
        y1: PANEL_TOP + 3,
        x2: x + panelW - 8,
        y2: PANEL_TOP + 11,
        x3: x + panelW - 3,
        y3: PANEL_TOP + 7,
        color: C.dim,
      });
    }
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
  /** Field being edited on the selected game row, or -1 when not in one. */
  let field = -1;
  /** Where the sample strip is parked, and which panel the cursor is on. */
  let sampleAnchor = 0;
  let sampleSelected = -1;
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
    // Tracked here rather than measured in `onDraw`: the strip only moves
    // when the cursor does, and the anchor is deliberately sticky — stepping
    // up to the scale row keeps the game you just looked at on screen.
    const row = ROWS[rowIndex];
    sampleSelected = row.kind === "game" ? SAMPLE_GAMES.indexOf(row.game) : -1;
    if (sampleSelected >= 0) sampleAnchor = sampleSelected;
  }

  k.onUpdate(() => {
    if (statusLeft > 0) {
      statusLeft -= k.dt();
      if (statusLeft <= 0) status = "";
    }

    const row = ROWS[rowIndex];

    if (row.kind === "game" && field >= 0) {
      if (input.anyPressed("left")) {
        if (field === 0) field = -1;
        else field--;
      } else if (input.anyPressed("right")) {
        field = Math.min(FIELD_COUNT - 1, field + 1);
      }
      if (field >= 0) {
        // Repeat rather than edge, unlike the scale row: stepping an hour a
        // minute at a time would otherwise be sixty presses.
        const step = (input.anyRepeated("up") ? 1 : 0) - (input.anyRepeated("down") ? 1 : 0);
        if (step !== 0 && nudgeField(row.game.id, field, step) && field === 0) {
          // The state field is the one whose consequence is not written on
          // the row: `OFF` takes the game off the carousel altogether.
          say(gameStateHelp(row.game.id));
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
      } else if (current.kind === "idle") {
        // Edge-triggered like the scale row, and for the same reason: eight
        // steps is a short ladder to run off the end of on a held direction.
        if (input.anyPressed("left") && nudgeIdleReturn(-1)) say(idleStatus());
        if (input.anyPressed("right") && nudgeIdleReturn(1)) say(idleStatus());
      } else if (current.kind === "game") {
        if (input.anyPressed("right")) field = 0;
      } else if (input.anyPressed("right")) {
        resetSettings();
        resetUnlocks();
        resetRoster();
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
      else if (row.kind === "idle") drawIdleRow(y);
      else if (row.kind === "game") drawGameRow(row.game, y, selected ? field : -1, now);
      else drawResetRow(y);
    }

    if (SHOW_SAMPLES) drawSamples(sampleAnchor, sampleSelected);

    const editing = ROWS[rowIndex].kind === "game" && field >= 0;
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
        ? GAME_EDIT_HINTS
        : ROWS[rowIndex].kind === "scale"
          ? SCALE_HINTS
          : ROWS[rowIndex].kind === "idle"
            ? IDLE_HINTS
            : ROWS[rowIndex].kind === "game"
              ? GAME_HINTS
              : RESET_HINTS,
    });
  });
}

export function registerOptions(): void {
  defineScene(OPTIONS_SCENE, main);
}

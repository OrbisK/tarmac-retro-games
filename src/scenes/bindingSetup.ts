import {
  clearKeyBinding,
  clearPadBinding,
  describeKeys,
  describeSources,
  keyBindings,
  keysAreCustomised,
  padBindings,
  padIsCalibrated,
  resetKeyBindings,
  resetPadBindings,
  setKeyBinding,
  setPadBinding,
} from "../core/bindings";
import { BUTTON_HINTS, BUTTON_LABELS, BUTTONS, type Button } from "../core/buttons";
import { DESIGN_HEIGHT, DESIGN_WIDTH, MAX_PLAYERS } from "../core/config";
import { input } from "../core/input";
import { k } from "../core/k";
import { drawButtonGlyph, drawHints, glyphWidth } from "../core/prompts";
import { installQuitToMenu } from "../core/quit";
import { BINDINGS_SCENE, defineScene, goTo, INPUT_TEST_SCENE } from "../core/scene";
import { C, drawLabel, drawPanel, drawRule, FONT_SMALL, playerColor } from "../core/ui";

/**
 * Button setup.
 *
 * Navigated with **directions only** — up/down to pick a row, right to rebind,
 * left to clear. Nothing here needs a working face button, because a pad whose
 * face buttons report the wrong indices is exactly why you are on this screen.
 *
 * Gamepad bindings save against the controller's `id`, so calibrating one of a
 * pair of identical pads fixes both.
 */

/** Top of the device selector, the first row on the screen. */
const DEVICE_ROW_Y = 17;
/** The footer rule, and the floor the list has to stay off. */
const FOOTER_Y = DESIGN_HEIGHT - 14;
/** The device selector, one row per button, and the reset row. */
const ROW_COUNT = BUTTONS.length + 2;
/**
 * Row pitch, divided out of the box rather than stated.
 *
 * The list is the whole screen here — there is nothing else to put under it —
 * so the rows take the height the box has and the screen fills at any design
 * aspect. It is also what makes the glyphs big enough to carry their letter.
 */
const ROW_H = Math.floor((FOOTER_Y - 7 - DEVICE_ROW_Y) / ROW_COUNT);
const GLYPH_SIZE = ROW_H - 2;
/** Text is 10 units in a taller row: centre it rather than pin it to the top. */
const TEXT_DY = (ROW_H - FONT_SMALL) / 2;
const GLYPH_DY = (ROW_H - GLYPH_SIZE) / 2;
const HEADER_H = Math.round(DEVICE_ROW_Y + ROW_H);
/** Glyph column, indented to leave room for the selection caret. */
const GLYPH_X = 12;
/** Left edge of the name column, past the widest glyph (the START box). */
const LABEL_X = 64;
const VALUE_X = 150;
/** Give up waiting for a button rather than trapping the player on this row. */
const CAPTURE_TIMEOUT = 6;
/**
 * Input is ignored for a moment after a bind.
 *
 * Without this, binding `A` to a key produces a press edge for `A` on the very
 * next frame — the key is still held, and it now means something it did not
 * mean before — which instantly reopens capture on the same row. Any lockout
 * longer than a couple of frames swallows that phantom edge; by the time it
 * lifts, a held input has `prev == down` and produces no edge at all.
 */
const POST_BIND_LOCK = 0.3;

/** What the rows rebind: the connected pad, or one player's keyboard. */
type Target = { kind: "pad"; slot: number } | { kind: "keys"; slot: number };

/**
 * Reused every frame: the target list is rebuilt as pads come and go, and
 * this runs in `onUpdate`.
 */
const available: Target[] = [];

function refreshTargets(): void {
  available.length = 0;
  for (let slot = 0; slot < MAX_PLAYERS; slot++) {
    if (input.rawPad(slot)) available.push({ kind: "pad", slot });
  }
  for (let slot = 0; slot < MAX_PLAYERS; slot++) available.push({ kind: "keys", slot });
}

function targetName(target: Target): string {
  if (target.kind === "keys") return `KEYBOARD P${target.slot + 1}`;
  const pad = input.rawPad(target.slot);
  return pad ? `PAD P${target.slot + 1} (${pad.id.slice(0, 12).trim()})` : `PAD P${target.slot + 1}`;
}

function targetCustomised(target: Target): boolean {
  if (target.kind === "keys") return keysAreCustomised(target.slot);
  const pad = input.rawPad(target.slot);
  return padIsCalibrated(pad ? pad.id : null);
}

function bindingText(target: Target, button: Button): string {
  if (target.kind === "keys") return describeKeys(keyBindings(target.slot)[button]);
  const pad = input.rawPad(target.slot);
  return describeSources(
    padBindings(pad ? pad.id : null, pad?.mapping === "standard")[button],
  );
}

function main(): void {
  installQuitToMenu();

  /** Row 0 is the target selector; rows 1..12 are buttons; last row resets. */
  const RESET_ROW = ROW_COUNT - 1;

  refreshTargets();
  let targetIndex = 0;
  let row = 1;
  let capturing: Button | null = null;
  let captureLeft = 0;
  let status = "";
  let statusLeft = 0;
  let activationLock = 0;

  function currentTarget(): Target | null {
    return available[targetIndex] ?? null;
  }

  function say(message: string): void {
    status = message;
    statusLeft = 2.2;
  }

  function startCapture(button: Button): void {
    const target = currentTarget();
    if (!target) return;
    capturing = button;
    captureLeft = CAPTURE_TIMEOUT;
    if (target.kind === "pad") input.beginPadCapture(target.slot);
    else input.takeCapturedKey();
  }

  function stopCapture(): void {
    capturing = null;
    input.endPadCapture();
    activationLock = POST_BIND_LOCK;
  }

  /**
   * Restore one row to its default rather than emptying it. Emptying is a
   * trap: clear "up" with a stray press and the list is no longer navigable.
   */
  function restoreRow(button: Button): void {
    const target = currentTarget();
    if (!target) return;
    if (target.kind === "keys") clearKeyBinding(target.slot, button);
    else {
      const pad = input.rawPad(target.slot);
      if (!pad) return;
      clearPadBinding(pad.id, button);
    }
    say(`${BUTTON_LABELS[button].split(" ")[0]} back to default`);
  }

  function resetTarget(): void {
    const target = currentTarget();
    if (!target) return;
    if (target.kind === "keys") resetKeyBindings(target.slot);
    else {
      const pad = input.rawPad(target.slot);
      if (pad) resetPadBindings(pad.id);
    }
    say("defaults restored");
  }

  k.onUpdate(() => {
    const dt = k.dt();
    if (statusLeft > 0) statusLeft -= dt;
    if (activationLock > 0) activationLock -= dt;

    // Pads coming and going changes the target list; keep the cursor valid.
    refreshTargets();
    if (targetIndex >= available.length) targetIndex = Math.max(0, available.length - 1);

    if (capturing !== null) {
      captureLeft -= dt;
      const target = currentTarget();

      if (target?.kind === "pad") {
        const source = input.pollPadCapture();
        if (source) {
          const pad = input.rawPad(target.slot);
          if (pad) {
            setPadBinding(pad.id, capturing, [source]);
            say(`bound to ${source.t === "b" ? `B${source.i}` : `A${source.i}${source.d < 0 ? "-" : "+"}`}`);
          }
          stopCapture();
          return;
        }
      } else if (target?.kind === "keys") {
        const key = input.takeCapturedKey();
        if (key) {
          setKeyBinding(target.slot, capturing, [key]);
          say(`bound to ${key}`);
          stopCapture();
          return;
        }
      }

      // Cancel: a tap of anything already bound to back, or a timeout.
      if (captureLeft <= 0 || input.anyPressed("back")) {
        say("cancelled");
        stopCapture();
      }
      return;
    }

    if (activationLock > 0) return;

    for (let p = 0; p < MAX_PLAYERS; p++) {
      if (input.repeated(p, "up")) row = (row - 1 + ROW_COUNT) % ROW_COUNT;
      if (input.repeated(p, "down")) row = (row + 1) % ROW_COUNT;

      if (row === 0) {
        if (input.repeated(p, "right") && available.length > 0) {
          targetIndex = (targetIndex + 1) % available.length;
        }
        if (input.repeated(p, "left") && available.length > 0) {
          targetIndex = (targetIndex - 1 + available.length) % available.length;
        }
      } else if (row === RESET_ROW) {
        if (input.pressed(p, "right")) resetTarget();
      } else {
        const button = BUTTONS[row - 1];
        if (input.pressed(p, "right") || input.pressed(p, "a") || input.pressed(p, "start")) {
          startCapture(button);
        }
        if (input.pressed(p, "left")) restoreRow(button);
      }
    }

    if (input.anyPressed("l")) goTo(INPUT_TEST_SCENE);
  });

  k.onDraw(() => {
    const target = currentTarget();

    drawLabel({ text: "BUTTON SETUP", x: 4, y: 3, size: FONT_SMALL, color: C.accent });
    drawLabel({
      text: targetCustomised(target ?? { kind: "keys", slot: 0 }) ? "custom" : "defaults",
      x: DESIGN_WIDTH - 4,
      y: 3,
      size: FONT_SMALL,
      color: C.textDim,
      anchor: "right",
    });

    // Row 0: which device the rows below apply to.
    const targetActive = row === 0;
    drawPanel({
      x: 2,
      y: DEVICE_ROW_Y,
      w: DESIGN_WIDTH - 4,
      h: ROW_H,
      fill: targetActive ? C.bgAlt : C.bg,
      outline: targetActive ? C.accent : C.dim,
    });
    drawButtonGlyph({ x: GLYPH_X, y: DEVICE_ROW_Y + GLYPH_DY, button: "left", size: GLYPH_SIZE });
    drawButtonGlyph({
      x: GLYPH_X + glyphWidth("left", GLYPH_SIZE) + 1,
      y: DEVICE_ROW_Y + GLYPH_DY,
      button: "right",
      size: GLYPH_SIZE,
    });
    drawLabel({
      text: "DEVICE",
      x: LABEL_X,
      y: DEVICE_ROW_Y + TEXT_DY,
      size: FONT_SMALL,
      color: targetActive ? C.text : C.textDim,
    });
    drawLabel({
      text: target ? targetName(target) : "none",
      x: VALUE_X,
      y: DEVICE_ROW_Y + TEXT_DY,
      size: FONT_SMALL,
      color: target?.kind === "pad" ? playerColor(target.slot) : C.text,
    });

    // Button rows.
    for (let i = 0; i < BUTTONS.length; i++) {
      const button = BUTTONS[i];
      const rowIndex = i + 1;
      const y = HEADER_H + i * ROW_H;
      const active = row === rowIndex;
      const isCapturing = capturing === button;

      if (active) {
        drawPanel({
          x: 2,
          y,
          w: DESIGN_WIDTH - 4,
          h: ROW_H,
          fill: C.bgAlt,
          outline: isCapturing ? C.accent : C.dim,
        });
        drawLabel({ text: ">", x: 5, y: y + TEXT_DY, size: FONT_SMALL, color: C.accent });
      }
      // The letter is drawn here, unlike the menu's own rows: the glyph is a
      // row tall, which clears the readable minimum with room to spare.
      drawButtonGlyph({
        x: GLYPH_X,
        y: y + GLYPH_DY,
        button,
        size: GLYPH_SIZE,
        ...(target?.kind === "pad" ? { player: target.slot } : {}),
      });
      drawLabel({
        text: BUTTON_LABELS[button],
        x: LABEL_X,
        y: y + TEXT_DY,
        size: FONT_SMALL,
        color: active ? C.text : C.textDim,
      });
      // Only the selected row explains itself, to keep the list scannable.
      const hint = BUTTON_HINTS[button];
      if (active && hint !== undefined) {
        drawLabel({
          text: hint,
          x: DESIGN_WIDTH - 6,
          y: y + TEXT_DY,
          size: FONT_SMALL,
          color: C.textDim,
          anchor: "right",
        });
      }
      drawLabel({
        text: isCapturing
          ? `press... ${Math.ceil(captureLeft)}`
          : target
            ? bindingText(target, button)
            : "--",
        x: VALUE_X,
        y: y + TEXT_DY,
        size: FONT_SMALL,
        color: isCapturing ? C.accent : active ? C.good : C.textDim,
      });
    }

    // Reset row.
    const resetY = HEADER_H + BUTTONS.length * ROW_H;
    const resetActive = row === RESET_ROW;
    if (resetActive) {
      drawPanel({
        x: 2,
        y: resetY,
        w: DESIGN_WIDTH - 4,
        h: ROW_H,
        fill: C.bgAlt,
        outline: C.bad,
      });
      drawLabel({ text: ">", x: 5, y: resetY + TEXT_DY, size: FONT_SMALL, color: C.bad });
    }
    drawLabel({
      text: "RESET DEVICE",
      x: LABEL_X,
      y: resetY + TEXT_DY,
      size: FONT_SMALL,
      color: resetActive ? C.bad : C.textDim,
    });
    drawLabel({
      text: "press RIGHT",
      x: VALUE_X,
      y: resetY + TEXT_DY,
      size: FONT_SMALL,
      color: resetActive ? C.text : C.dim,
    });

    // Footer: status line, then the controls that always work.
    const footerY = FOOTER_Y;
    drawRule(footerY - 3);
    if (statusLeft > 0) {
      drawLabel({ text: status, x: 4, y: footerY, size: FONT_SMALL, color: C.good });
    } else {
      drawHints({
        x: 4,
        y: footerY - 2,
        size: 12,
        hints: [
          { button: "right" },
          { text: "BIND" },
          { gap: 4 },
          { button: "left" },
          { text: "DEFAULT" },
          { gap: 4 },
          { button: "l" },
          { text: "TEST" },
        ],
      });
    }
  });
}

export function registerBindingSetup(): void {
  defineScene(BINDINGS_SCENE, main);
}

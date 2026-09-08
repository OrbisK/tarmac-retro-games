import { BUTTONS } from "../core/buttons";
import { DESIGN_HEIGHT, DESIGN_WIDTH, MAX_PLAYERS } from "../core/config";
import { input } from "../core/input";
import { k } from "../core/k";
import { padBindings, padIsCalibrated } from "../core/bindings";
import { installQuitToMenu } from "../core/quit";
import { drawHints } from "../core/prompts";
import {
  BINDINGS_SCENE,
  defineScene,
  goTo,
  INPUT_TEST_SCENE,
  OPTIONS_SCENE,
} from "../core/scene";
import { C, drawBox, drawLabel, drawPanel, drawRule, FONT_SMALL, playerColor } from "../core/ui";

/**
 * Input test: what the hardware is actually reporting, right now.
 *
 * Shows raw button indices and axis values per pad, next to the logical
 * actions they currently resolve to — so a mis-mapped pad is diagnosable by
 * looking at it: press the button you call "A", read which `B<n>` lights up.
 */

const COL_W = 152;
const BTN_CELL = 9;
const BTN_SIZE = 7;
const RAW_BUTTONS = 16;
const RAW_AXES = 4;

/** Reused across frames so drawing allocates nothing. */
const pressedIndices: number[] = [];
const activeActions: string[] = [];

function drawSlot(slot: number, x: number, y: number): void {
  const pad = input.rawPad(slot);
  const accent = playerColor(slot);

  drawLabel({
    text: `P${slot + 1}`,
    x,
    y,
    size: FONT_SMALL,
    color: accent,
  });

  if (!pad) {
    drawLabel({
      text: "no pad",
      x: x + 24,
      y,
      size: FONT_SMALL,
      color: C.textDim,
    });
  } else {
    drawLabel({
      text: `pad ${pad.index}${padIsCalibrated(pad.id) ? " *" : ""}`,
      x: x + 24,
      y,
      size: FONT_SMALL,
      color: C.text,
    });
    drawLabel({
      text: pad.mapping === "standard" ? "std" : "raw",
      x: x + COL_W,
      y,
      size: FONT_SMALL,
      color: pad.mapping === "standard" ? C.good : C.accent,
      anchor: "right",
    });
    // The id is long and the only place to read it; clip rather than wrap.
    drawLabel({
      text: pad.id.replace(/\s+/g, " ").slice(0, 26),
      x,
      y: y + 11,
      size: FONT_SMALL,
      color: C.dim,
    });
  }

  // --- raw buttons: a lamp per index ---
  const lampsY = y + 24;
  pressedIndices.length = 0;
  for (let i = 0; i < RAW_BUTTONS; i++) {
    const button = pad?.buttons[i];
    const on = button ? button.pressed || button.value > 0.5 : false;
    const exists = button !== undefined;
    if (on) pressedIndices.push(i);
    drawBox({
      x: x + i * BTN_CELL,
      y: lampsY,
      w: BTN_SIZE,
      h: BTN_SIZE,
      color: on ? accent : C.bg,
      outline: exists ? C.dim : C.bgAlt,
    });
  }
  drawLabel({
    text: `btn ${pressedIndices.length > 0 ? pressedIndices.join(" ") : "-"}`,
    x,
    y: lampsY + 10,
    size: FONT_SMALL,
    color: pressedIndices.length > 0 ? C.text : C.textDim,
  });

  // --- raw axes: signed value plus a centre-out bar ---
  let axisY = lampsY + 22;
  for (let i = 0; i < RAW_AXES; i++) {
    const raw = pad?.axes[i];
    const value = typeof raw === "number" && !Number.isNaN(raw) ? raw : 0;
    const exists = typeof raw === "number";
    drawLabel({
      text: `a${i}`,
      x,
      y: axisY,
      size: FONT_SMALL,
      color: exists ? C.textDim : C.dim,
    });
    const barX = x + 18;
    const barW = 60;
    const mid = barX + barW / 2;
    drawPanel({ x: barX, y: axisY + 1, w: barW, h: 7, fill: C.bg, outline: C.dim });
    if (exists && Math.abs(value) > 0.02) {
      const w = Math.max(0.5, (barW / 2 - 1) * Math.min(1, Math.abs(value)));
      drawBox({
        x: value < 0 ? mid - w : mid,
        y: axisY + 2,
        w,
        h: 5,
        color: accent,
      });
    }
    drawLabel({
      text: exists ? value.toFixed(2) : "--",
      x: barX + barW + 4,
      y: axisY,
      size: FONT_SMALL,
      color: exists ? C.text : C.dim,
    });
    axisY += 10;
  }

  // --- resolved logical actions ---
  activeActions.length = 0;
  for (const btn of BUTTONS) {
    if (input.down(slot, btn)) activeActions.push(btn);
  }
  drawLabel({
    text: "action",
    x,
    y: axisY + 3,
    size: FONT_SMALL,
    color: C.textDim,
  });
  drawLabel({
    text: activeActions.length > 0 ? activeActions.join(" ") : "-",
    x,
    y: axisY + 14,
    size: FONT_SMALL,
    color: activeActions.length > 0 ? C.good : C.dim,
  });

  // What "a" is bound to on this pad, since that is the one people re-map most.
  if (pad) {
    const bound = padBindings(pad.id, pad.mapping === "standard").a;
    drawLabel({
      text: `a = ${bound.length > 0 ? bound.map((s) => (s.t === "b" ? `B${s.i}` : `A${s.i}`)).join(" ") : "--"}`,
      x,
      y: axisY + 25,
      size: FONT_SMALL,
      color: C.textDim,
    });
  }
}

function main(): void {
  installQuitToMenu();

  k.onUpdate(() => {
    // Directions only: the face buttons are exactly what might be broken.
    if (input.anyPressed("right")) goTo(BINDINGS_SCENE);
    if (input.anyPressed("left")) goTo(OPTIONS_SCENE);
  });

  k.onDraw(() => {
    drawLabel({
      text: "INPUT TEST",
      x: 4,
      y: 3,
      size: FONT_SMALL,
      color: C.accent,
    });
    drawLabel({
      text: `${input.padCount()} pad(s)`,
      x: DESIGN_WIDTH - 4,
      y: 3,
      size: FONT_SMALL,
      color: C.textDim,
      anchor: "right",
    });
    drawRule(14);

    for (let slot = 0; slot < MAX_PLAYERS; slot++) {
      drawSlot(slot, 4 + slot * (COL_W + 8), 19);
    }

    // Keyboard row, so a keyboard-only setup is diagnosable too.
    const keysY = DESIGN_HEIGHT - 30;
    drawRule(keysY - 3);
    const held = input.heldKeys();
    let keyText = "-";
    if (held.size > 0) keyText = Array.from(held).join(" ").slice(0, 36);
    drawLabel({ text: `keys ${keyText}`, x: 4, y: keysY, size: FONT_SMALL, color: C.text });

    drawHints({
      x: 4,
      y: DESIGN_HEIGHT - 15,
      hints: [
        { button: "right" },
        { text: "SETUP" },
        { gap: 6 },
        { button: "left" },
        { text: "OPTIONS" },
        { gap: 6 },
        { button: "back" },
        { text: "HOLD = MENU" },
      ],
    });
  });
}

export function registerInputTest(): void {
  defineScene(INPUT_TEST_SCENE, main);
}

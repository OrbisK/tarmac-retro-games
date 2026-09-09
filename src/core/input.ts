import { type BindingSource, faceColorOf, keyBindings, padBindings } from "./bindings";
import { BUTTON_COUNT, BUTTON_INDEX, BUTTONS, type Button, type FaceColor } from "./buttons";
import { MAX_PLAYERS } from "./config";
import { advanceIdle, noteActivity } from "./idle";
import { k } from "./k";

export { BUTTONS } from "./buttons";
export type { Button } from "./buttons";

/**
 * Two-player input abstraction over gamepads + keyboard.
 *
 * Design notes:
 *  - **Polling, not events.** `k.onGamepadConnect` returns `void` (no way to
 *    unregister), so calling it from a scene would leak a handler per scene
 *    entry. Reading state each frame avoids listeners for pads entirely.
 *  - **Raw Gamepad API, not `k.getGamepads()`.** KAPLAY resolves its button
 *    names ("south", "dpad-up", ...) through a table keyed on the pad's `id`
 *    string, falling back to a default. The cheap USB pads this cabinet uses
 *    report `mapping: ""` with two axes and ten buttons, so that lookup is a
 *    guess. Reading button indices ourselves is deterministic, and it is the
 *    same table for standard pads.
 *  - **Keyboard state is our own too.** KAPLAY defers key handling to a
 *    per-frame `app.events` one-shot, and `go()` calls `app.events.clear()` —
 *    so a keyup arriving during a scene transition can be dropped, leaving the
 *    key stuck down for the rest of the session. Owning the listeners also
 *    lets us clear on blur, which matters when someone alt-tabs mid-hold.
 *  - **Zero per-frame allocation** beyond the array the Gamepad API insists on
 *    returning: all state lives in preallocated typed arrays.
 *  - **Edge state survives scene changes** on purpose: a button still held
 *    from the menu will not read as a fresh press inside the game it started.
 *  - **This module feeds the idle clock** (`core/idle.ts`), because it is the
 *    one place that already knows what every player did this frame. Activity
 *    is an edge either way plus a bounded hold — see `STUCK_HOLD_SECONDS`.
 */

const N = BUTTON_COUNT;
const INDEX = BUTTON_INDEX;

const UP = INDEX.up;
const DOWN = INDEX.down;
const LEFT = INDEX.left;
const RIGHT = INDEX.right;

/**
 * Keyboard state, owned by this module.
 *
 * The listeners are installed once at module load and intentionally never
 * removed: they live as long as the page, so they cannot accumulate the way a
 * per-scene registration would.
 */
const heldKeys = new Set<string>();

/** DOM key -> our key names. Anything unlisted falls back to lowercasing. */
const KEY_ALIASES: Record<string, string> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  " ": "space",
  Escape: "escape",
  Enter: "enter",
  Backspace: "backspace",
  Tab: "tab",
  Shift: "shift",
  Control: "control",
  Alt: "alt",
  Meta: "meta",
};

/** Keys we swallow so the browser doesn't scroll or move focus mid-game. */
const SWALLOW = new Set(["up", "down", "left", "right", "space", "tab", "backspace"]);

function keyName(ev: KeyboardEvent): string {
  return KEY_ALIASES[ev.key] ?? ev.key.toLowerCase();
}

/** Most recent key to go down, for the setup screen's "press a key" capture. */
let capturedKey: string | null = null;

window.addEventListener("keydown", (ev) => {
  const name = keyName(ev);
  // Every key, not only bound ones: on the setup screens the key someone is
  // pressing is often the one that is not bound to anything yet.
  noteActivity();
  if (SWALLOW.has(name)) ev.preventDefault();
  if (!heldKeys.has(name)) capturedKey = name;
  heldKeys.add(name);
});
window.addEventListener("keyup", (ev) => {
  heldKeys.delete(keyName(ev));
});
// Losing focus mid-hold would otherwise leave the key down forever.
window.addEventListener("blur", () => heldKeys.clear());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) heldKeys.clear();
});

const DEADZONE = 0.35;
const TRIGGER_THRESHOLD = 0.5;
const REPEAT_DELAY = 0.34;
const REPEAT_RATE = 0.11;
/**
 * Frames to ignore a freshly connected pad for.
 *
 * Cheap USB pads can report garbage on their first poll, which would otherwise
 * read as a real button press — enough to launch a game straight out of the
 * menu the moment someone plugs a controller in.
 */
const PAD_SETTLE_FRAMES = 3;
/**
 * How long a held button keeps counting as activity for the idle clock.
 *
 * Holding is input — a paddle pinned against the top of the court is someone
 * playing — but it cannot count forever, or a jammed switch, a coin resting on
 * a button or a stick taped over would keep the cabinet inside a game for the
 * rest of the day. Longer than any deliberate hold in these games, and a
 * release is itself activity, so a real hand always clears the clock.
 */
const STUCK_HOLD_SECONDS = 30;

class PlayerState {
  readonly down = new Uint8Array(N);
  readonly prev = new Uint8Array(N);
  readonly held = new Float32Array(N);
  readonly nextRepeat = new Float32Array(N);
  readonly repeat = new Uint8Array(N);
  /** Analog stick, folded with the d-pad. Screen space: +x right, +y down. */
  axisX = 0;
  axisY = 0;
  /** Browser gamepad index, or -1 when this slot has no pad. */
  padIndex = -1;
  settle = 0;
}

const players: readonly PlayerState[] = Array.from(
  { length: MAX_PLAYERS },
  () => new PlayerState(),
);

/** Pads assigned to each slot this frame. Never held across frames: Chrome
 *  hands out a fresh snapshot object on every `getGamepads()` call. */
const assigned: (Gamepad | null)[] = new Array(MAX_PLAYERS).fill(null);

let connectedPads = 0;
let lastActive = -1;

function axisValue(pad: Gamepad, i: number): number {
  const v = pad.axes[i];
  return typeof v === "number" && !Number.isNaN(v) ? v : 0;
}

function buttonValue(pad: Gamepad, i: number): number {
  const b = pad.buttons[i];
  if (!b) return 0;
  return b.pressed ? 1 : b.value;
}

function sourceActive(pad: Gamepad, source: BindingSource): boolean {
  if (source.t === "b") return buttonValue(pad, source.i) > TRIGGER_THRESHOLD;
  const v = axisValue(pad, source.i);
  return source.d < 0 ? v < -DEADZONE : v > DEADZONE;
}

function padDown(pad: Gamepad | null, sources: readonly BindingSource[]): boolean {
  if (!pad) return false;
  for (let i = 0; i < sources.length; i++) {
    if (sourceActive(pad, sources[i])) return true;
  }
  return false;
}

function keyDown(keys: readonly string[]): boolean {
  for (let i = 0; i < keys.length; i++) {
    if (heldKeys.has(keys[i])) return true;
  }
  return false;
}

/**
 * Strength of a direction, 0..1, taken from whichever bound axis is pushed
 * furthest. Lets a game read a real analog stick while the same binding also
 * covers a d-pad reported as a digital +-1 axis.
 */
function analogMagnitude(pad: Gamepad | null, sources: readonly BindingSource[]): number {
  if (!pad) return 0;
  let best = 0;
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    if (source.t !== "a") continue;
    const signed = source.d < 0 ? -axisValue(pad, source.i) : axisValue(pad, source.i);
    if (signed > DEADZONE && signed > best) best = Math.min(1, signed);
  }
  return best;
}

/** Fill `assigned` with the lowest-indexed connected pads, in index order. */
function assignPads(): void {
  for (let p = 0; p < MAX_PLAYERS; p++) assigned[p] = null;
  connectedPads = 0;
  if (typeof navigator.getGamepads !== "function") return;

  const list = navigator.getGamepads();
  let slot = 0;
  for (let i = 0; i < list.length; i++) {
    const pad = list[i];
    if (!pad || !pad.connected) continue;
    connectedPads++;
    if (slot < MAX_PLAYERS) assigned[slot++] = pad;
  }
}

function poll(): void {
  assignPads();
  const dt = k.dt();
  /** Anything at all from any player this frame — feeds the idle clock. */
  let active = false;

  for (let p = 0; p < MAX_PLAYERS; p++) {
    const st = players[p];
    const pad = assigned[p];
    const padIndex = pad ? pad.index : -1;
    if (padIndex !== st.padIndex) {
      st.padIndex = padIndex;
      if (padIndex >= 0) st.settle = PAD_SETTLE_FRAMES;
    }

    st.prev.set(st.down);

    const pads = padBindings(pad ? pad.id : null, pad?.mapping === "standard");
    const keys = keyBindings(p);

    for (let i = 0; i < N; i++) {
      const btn = BUTTONS[i];
      st.down[i] = padDown(pad, pads[btn]) || keyDown(keys[btn]) ? 1 : 0;
    }

    // Analog where the hardware offers it, digital otherwise — so a game can
    // read axisX/axisY and not care which kind of controller it is on.
    let ax = analogMagnitude(pad, pads.right) - analogMagnitude(pad, pads.left);
    let ay = analogMagnitude(pad, pads.down) - analogMagnitude(pad, pads.up);
    if (ax === 0) ax = (st.down[RIGHT] ? 1 : 0) - (st.down[LEFT] ? 1 : 0);
    if (ay === 0) ay = (st.down[DOWN] ? 1 : 0) - (st.down[UP] ? 1 : 0);
    st.axisX = ax;
    st.axisY = ay;

    // A pad that just appeared gets its state adopted silently: copying `down`
    // over `prev` means this frame produces no edges at all.
    if (st.settle > 0) {
      st.settle--;
      st.prev.set(st.down);
      st.repeat.fill(0);
      st.held.fill(0);
      st.nextRepeat.fill(0);
      continue;
    }

    // --- hold timers and auto-repeat ---
    for (let i = 0; i < N; i++) {
      const isDown = st.down[i] === 1;
      const wasDown = st.prev[i] === 1;
      if (isDown && !wasDown) {
        st.held[i] = 0;
        st.nextRepeat[i] = REPEAT_DELAY;
        st.repeat[i] = 1;
        lastActive = p;
        active = true;
      } else if (isDown) {
        st.held[i] += dt;
        if (st.held[i] >= st.nextRepeat[i]) {
          st.nextRepeat[i] += REPEAT_RATE;
          st.repeat[i] = 1;
        } else {
          st.repeat[i] = 0;
        }
        if (st.held[i] < STUCK_HOLD_SECONDS) active = true;
      } else {
        // A release counts too: it is the other half of every press, and it is
        // what lets someone who was leaning on a button clear the idle clock.
        if (wasDown) active = true;
        st.held[i] = 0;
        st.nextRepeat[i] = 0;
        st.repeat[i] = 0;
      }
    }
  }

  // One clock for the machine, so it survives the scene change it causes.
  if (active) noteActivity();
  else advanceIdle(dt);
}

function state(player: number): PlayerState | null {
  return players[player] ?? null;
}

// --- raw access & binding capture (used by the setup screens) --------------

/** How far an axis must move from its resting value to count as a bind. */
const CAPTURE_AXIS_TRAVEL = 0.6;
const MAX_CAPTURE_BUTTONS = 32;
const MAX_CAPTURE_AXES = 8;

/** Resting state of the pad when capture began, so a held axis is ignored. */
const captureButtons = new Float32Array(MAX_CAPTURE_BUTTONS);
const captureAxes = new Float32Array(MAX_CAPTURE_AXES);
let captureSlot = -1;

function beginPadCapture(slot: number): void {
  captureSlot = slot;
  captureButtons.fill(0);
  captureAxes.fill(0);
  const pad = assigned[slot];
  if (!pad) return;
  for (let i = 0; i < Math.min(pad.buttons.length, MAX_CAPTURE_BUTTONS); i++) {
    captureButtons[i] = buttonValue(pad, i);
  }
  for (let i = 0; i < Math.min(pad.axes.length, MAX_CAPTURE_AXES); i++) {
    captureAxes[i] = axisValue(pad, i);
  }
}

/**
 * The first physical input to change since `beginPadCapture`, or null.
 *
 * Comparing against the resting snapshot rather than against zero means a pad
 * whose stick sits off-centre, or whose d-pad is being held when capture
 * starts, does not immediately bind itself.
 */
function pollPadCapture(): BindingSource | null {
  if (captureSlot < 0) return null;
  const pad = assigned[captureSlot];
  if (!pad) return null;

  // Raw indices, so these presses may be bound to nothing yet and invisible
  // to the idle clock — which would time out the very screen that exists to
  // fix a pad reporting the wrong ones.
  for (let i = 0; i < Math.min(pad.buttons.length, MAX_CAPTURE_BUTTONS); i++) {
    const now = buttonValue(pad, i);
    if (now > TRIGGER_THRESHOLD && captureButtons[i] <= TRIGGER_THRESHOLD) {
      noteActivity();
      return { t: "b", i };
    }
  }
  for (let i = 0; i < Math.min(pad.axes.length, MAX_CAPTURE_AXES); i++) {
    const travel = axisValue(pad, i) - captureAxes[i];
    if (Math.abs(travel) >= CAPTURE_AXIS_TRAVEL) {
      noteActivity();
      return { t: "a", i, d: travel > 0 ? 1 : -1 };
    }
  }
  return null;
}

export const input = {
  /** Installed once per scene by the scene wrapper; runs before game logic. */
  poll,

  /** Held this frame. */
  down(player: number, btn: Button): boolean {
    const st = state(player);
    return st ? st.down[INDEX[btn]] === 1 : false;
  },

  /** Went down this frame. */
  pressed(player: number, btn: Button): boolean {
    const st = state(player);
    if (!st) return false;
    const i = INDEX[btn];
    return st.down[i] === 1 && st.prev[i] === 0;
  },

  /** Came up this frame. */
  released(player: number, btn: Button): boolean {
    const st = state(player);
    if (!st) return false;
    const i = INDEX[btn];
    return st.down[i] === 0 && st.prev[i] === 1;
  },

  /** Pressed, plus auto-repeat while held. For menus and grid movement. */
  repeated(player: number, btn: Button): boolean {
    const st = state(player);
    return st ? st.repeat[INDEX[btn]] === 1 : false;
  },

  /** Seconds the button has been held past its initial press. */
  holdTime(player: number, btn: Button): number {
    const st = state(player);
    return st ? st.held[INDEX[btn]] : 0;
  },

  /** -1..1, right positive. Analog where available, otherwise digital. */
  axisX(player: number): number {
    return state(player)?.axisX ?? 0;
  },

  /** -1..1, **down positive** (screen space, matching KAPLAY). */
  axisY(player: number): number {
    return state(player)?.axisY ?? 0;
  },

  anyDown(btn: Button): boolean {
    for (let p = 0; p < MAX_PLAYERS; p++) if (input.down(p, btn)) return true;
    return false;
  },

  anyPressed(btn: Button): boolean {
    for (let p = 0; p < MAX_PLAYERS; p++) if (input.pressed(p, btn)) return true;
    return false;
  },

  anyRepeated(btn: Button): boolean {
    for (let p = 0; p < MAX_PLAYERS; p++) if (input.repeated(p, btn)) return true;
    return false;
  },

  /** Longest hold of `btn` across all players — for shared "hold to quit". */
  maxHoldTime(btn: Button): number {
    let best = 0;
    for (let p = 0; p < MAX_PLAYERS; p++) best = Math.max(best, input.holdTime(p, btn));
    return best;
  },

  padConnected(player: number): boolean {
    return (state(player)?.padIndex ?? -1) >= 0;
  },

  padCount(): number {
    return connectedPads;
  },

  /** Slot of the player who most recently pressed something, or -1. */
  lastActivePlayer(): number {
    return lastActive;
  },

  /**
   * This frame's raw gamepad snapshot for a slot, for the input test screen.
   * Do not hold onto it: the Gamepad API hands out a fresh object each poll.
   */
  rawPad(player: number): Gamepad | null {
    return assigned[player] ?? null;
  },

  /**
   * Colour printed on the physical button that currently drives `btn` on this
   * player's pad, or null when it is not a coloured face button (or there is
   * no pad). Follows rebinding, because the colour belongs to the switch.
   */
  faceColor(player: number, btn: Button): FaceColor | null {
    const pad = assigned[player] ?? null;
    return faceColorOf(btn, pad ? pad.id : null, pad?.mapping === "standard");
  },

  /** Keys currently held, by our own names. Read-only view. */
  heldKeys(): ReadonlySet<string> {
    return heldKeys;
  },

  /** Snapshot the pad's resting state before waiting for a bind. */
  beginPadCapture(player: number): void {
    beginPadCapture(player);
  },

  /** The physical input pressed since `beginPadCapture`, once. */
  pollPadCapture(): BindingSource | null {
    return pollPadCapture();
  },

  endPadCapture(): void {
    captureSlot = -1;
  },

  /** Consume the most recent keypress, for "press a key to bind". */
  takeCapturedKey(): string | null {
    const key = capturedKey;
    capturedKey = null;
    return key;
  },
};

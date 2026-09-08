/**
 * The logical button vocabulary every game codes against.
 *
 * Kept in its own module so `input.ts` and `bindings.ts` can both depend on it
 * without importing each other.
 *
 * These are *actions*, not the labels printed on any particular pad. On a
 * SNES-style pad the diamond is X on top, A right, B bottom, Y left, and which
 * physical switch ends up driving logical `a` is decided by the bindings —
 * see the setup screen.
 */
export const BUTTONS = [
  "up",
  "down",
  "left",
  "right",
  "a",
  "b",
  "x",
  "y",
  "l",
  "r",
  "start",
  "back",
] as const;

export type Button = (typeof BUTTONS)[number];

export const BUTTON_COUNT = BUTTONS.length;

export const BUTTON_INDEX = ((): Record<Button, number> => {
  const out = {} as Record<Button, number>;
  BUTTONS.forEach((b, i) => (out[b] = i));
  return out;
})();

/** Short row names for the setup screen; the glyph beside them carries the
 *  physical identity, so these stay narrow. */
export const BUTTON_LABELS: Readonly<Record<Button, string>> = {
  up: "UP",
  down: "DOWN",
  left: "LEFT",
  right: "RIGHT",
  a: "A",
  b: "B",
  x: "X",
  y: "Y",
  l: "L",
  r: "R",
  start: "START",
  back: "BACK",
};

/** What the action does, shown for the highlighted row only. */
export const BUTTON_HINTS: Partial<Readonly<Record<Button, string>>> = {
  a: "confirm",
  start: "confirm",
  back: "hold to quit",
};

/**
 * The colour printed on a physical face button.
 *
 * Recorded so on-screen prompts can match what the player is looking at —
 * "press the red button" beats "press A" on a pad whose letters are worn off.
 * The colour belongs to the *physical* button, not the logical action, so the
 * lookup goes through the bindings (see `faceColorOf` in `bindings.ts`) and
 * follows the button around if the action is rebound.
 */
export type FaceColor = "blue" | "red" | "yellow" | "green";

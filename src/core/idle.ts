import { DESIGN_HEIGHT, DESIGN_WIDTH, IDLE_WARNING_SECONDS } from "./config";
import { k } from "./k";
import { idleReturnSeconds } from "./settings";
import { C, drawLabel, drawPanel, FONT_BODY, FONT_SMALL, measureLabel } from "./ui";

/**
 * How long since anybody touched a controller, and the bail-out it drives.
 *
 * One clock for the whole machine, not one per scene: it is the *cabinet* that
 * is idle, and the timer has to survive the transition it causes — dropping
 * out of a finished game leaves the menu already idle, so the attract cycle
 * picks up straight away instead of waiting another interval on a screen
 * nobody is watching.
 *
 * `core/input.ts` feeds it, because that is the one place that already knows
 * what every player did this frame. What counts as activity is decided there
 * too — including the rule that a button held forever stops counting, so a
 * jammed switch cannot pin the cabinet inside a game.
 *
 * How long the timeout is, and whether there is one at all, is an operator
 * setting (`idleReturnSeconds()`); the clock itself runs either way, because
 * the menu's attract cycle reads it too and is not something an operator can
 * switch off.
 *
 * The action on timeout is passed into `installIdleReturn` rather than
 * imported: `scene.ts` installs it, and importing `goToMenu` back from here
 * would make that a cycle.
 */

let idle = 0;

/** Someone did something. Called from the input poll, and from key events. */
export function noteActivity(): void {
  idle = 0;
}

/** Advance the idle clock by a frame in which nothing happened. */
export function advanceIdle(dt: number): void {
  idle += dt;
}

/** Seconds since the last input, anywhere on the cabinet. */
export function idleSeconds(): number {
  return idle;
}

/**
 * Whether the cabinet has been idle long enough to leave the current scene.
 * Always false while the operator has the timeout switched off.
 */
export function idleTimedOut(): boolean {
  const limit = idleReturnSeconds();
  return limit > 0 && idle >= limit;
}

// --- the warning ----------------------------------------------------------

/**
 * "MENU IN 5", one per whole second of the warning window, built once.
 * `draw` must not allocate, and this is drawn every frame while it is up.
 */
const COUNTDOWN_LINES: readonly string[] = Array.from(
  { length: IDLE_WARNING_SECONDS + 1 },
  (_, seconds) => `MENU IN ${seconds}`,
);

/**
 * The actionable half of the warning: *any* input clears the timer, including
 * a release, so there is nothing to explain beyond "touch something".
 */
const HINT_LINE = "PRESS ANY BUTTON";

const PANEL_PAD = 5;
const LINE_GAP = 2;
const PANEL_H = PANEL_PAD * 2 + FONT_BODY + LINE_GAP + FONT_SMALL;
const PANEL_BOTTOM_MARGIN = 6;

/**
 * The last few seconds of the countdown, bottom-centre.
 *
 * Warned rather than dropped without notice: a player thinking about their
 * next move looks idle, and the whole panel is dismissed by any press. Bottom
 * centre keeps it clear of both the score HUDs games put along the top and the
 * hold-to-quit bar in the corner.
 */
function drawIdleWarning(): void {
  const limit = idleReturnSeconds();
  if (limit <= 0) return;
  const left = limit - idle;
  if (left > IDLE_WARNING_SECONDS) return;
  const line = COUNTDOWN_LINES[Math.max(0, Math.ceil(left))] ?? COUNTDOWN_LINES[0];

  // Sized to its text, so the panel does not depend on the font's advance.
  const w =
    Math.max(measureLabel(line, FONT_BODY), measureLabel(HINT_LINE, FONT_SMALL)) + PANEL_PAD * 2;
  const x = (DESIGN_WIDTH - w) / 2;
  const y = DESIGN_HEIGHT - PANEL_H - PANEL_BOTTOM_MARGIN;

  // Opaque fill: it has to be readable over whatever the game left on screen.
  drawPanel({ x, y, w, h: PANEL_H, fill: C.bg, outline: C.accent });
  drawLabel({
    text: line,
    x: DESIGN_WIDTH / 2,
    y: y + PANEL_PAD,
    size: FONT_BODY,
    color: C.accent,
    anchor: "center",
  });
  drawLabel({
    text: HINT_LINE,
    x: DESIGN_WIDTH / 2,
    y: y + PANEL_PAD + FONT_BODY + LINE_GAP,
    size: FONT_SMALL,
    color: C.textDim,
    anchor: "center",
  });
}

/**
 * Install the idle bail-out on the current scene.
 *
 * Called by `defineScene` for every scene but the menu, rather than by the
 * scenes themselves: a game that forgot the call would strand the cabinet in
 * a finished match, and that is exactly the failure this exists to prevent.
 * Installed unconditionally, even with the timeout off: the setting is read
 * per frame, so it can be changed while a scene is already up.
 *
 * `z` sits above the hold-to-quit widget and below the debug overlay — the
 * warning has to be readable over a game, and F3 has to be readable over it.
 */
export function installIdleReturn(onTimeout: () => void): void {
  k.add([
    k.z(9_500),
    k.fixed(),
    {
      id: "idleReturn",
      update() {
        if (idleTimedOut()) onTimeout();
      },
      draw() {
        drawIdleWarning();
      },
    },
  ]);
}

/**
 * Cabinet settings: operator preferences that outlive a session.
 *
 * Persisted the same way as `bindings.ts` — localStorage, with every access
 * guarded, because a cabinet whose storage is unavailable has to boot on
 * defaults rather than throw on the way to the menu.
 *
 * Everything here is a **discrete ladder**, not a free value: the options
 * screen is driven with four directions and no keyboard, so a setting has to
 * be reachable in a few presses, and every step has to be one somebody can
 * actually tell apart.
 */

const STORAGE_KEY = "tarmac.settings.v1";

/**
 * How much bigger a game draws its gameplay elements than their baseline
 * size: the Pong ball and paddles, the Snake cell, the in-game countdowns.
 *
 * This deliberately does **not** touch the design box. 320x320 stays the
 * layout authority, the Pong court keeps its dimensions and its speeds, and
 * the menu and chrome are untouched — only the things a player has to track
 * mid-rally get chunkier, which is the part that loses at cabinet distance.
 *
 * Discrete steps rather than a free slider: at this design resolution a factor
 * of 1.07 buys nothing anyone can see, and Snake's board has to land on a
 * whole number of cells. Every step keeps the baseline sizes whole — an 8-unit
 * Snake cell becomes 10, 12, 14, 16.
 */
export const GAME_SCALE_STEPS = [1, 1.25, 1.5, 1.75, 2] as const;

/**
 * The smallest factor on offer — i.e. the finest a scalable grid can get.
 * Games that preallocate for their grid size size that allocation from here.
 */
export const GAME_SCALE_MIN = GAME_SCALE_STEPS[0];

/**
 * Index 1 (1.25x), not 1x: the baseline sizes read fine on a desk and it is
 * the ball and the countdowns that go first from a couple of metres away. 1x
 * is still one step to the left for anyone who wants the original proportions.
 */
const DEFAULT_SCALE_INDEX = 1;

/**
 * Seconds of no input before a scene drops back to the menu. `0` is off.
 *
 * The ladder is coarse on purpose and stops at five minutes: past that a
 * cabinet is not "waiting for a player who stepped away", it is showing a
 * finished match to an empty room, and the operator who genuinely wants that
 * wants `OFF`.
 *
 * `OFF` is a real setting rather than a hidden one because the timeout is the
 * only thing on the machine that can interrupt a game nobody asked it to —
 * a tournament running long matches on a stage wants it gone. It does not
 * touch the menu's attract cycle, which has no game to interrupt.
 */
export const IDLE_RETURN_STEPS = [0, 30, 45, 60, 90, 120, 180, 300] as const;

/** One minute: long enough to think, short enough that the next player waits. */
const DEFAULT_IDLE_INDEX = 3;

let scaleIndex = DEFAULT_SCALE_INDEX;
let idleIndex = DEFAULT_IDLE_INDEX;

/** Snap an arbitrary stored number to the nearest offered step. */
function nearestIndex(steps: readonly number[], value: number, fallback: number): number {
  let best = fallback;
  let bestGap = Infinity;
  for (let i = 0; i < steps.length; i++) {
    const gap = Math.abs(steps[i] - value);
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  }
  return best;
}

function load(): void {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private mode / storage disabled: run on defaults.
    return;
  }
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const scale = parsed.gameScale;
    if (typeof scale === "number" && Number.isFinite(scale)) {
      scaleIndex = nearestIndex(GAME_SCALE_STEPS, scale, DEFAULT_SCALE_INDEX);
    }
    // Stored in seconds rather than as an index, so re-tuning the ladder does
    // not silently change what every cabinet in the field is set to.
    const idle = parsed.idleReturn;
    if (typeof idle === "number" && Number.isFinite(idle)) {
      idleIndex = nearestIndex(IDLE_RETURN_STEPS, idle, DEFAULT_IDLE_INDEX);
    }
  } catch (err) {
    console.warn("[settings] could not read settings, using defaults:", err);
  }
}

load();

function persist(): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ v: 1, gameScale: gameScale(), idleReturn: idleReturnSeconds() }),
    );
  } catch (err) {
    console.warn("[settings] could not save settings:", err);
  }
}

/** The current factor. Read it at scene entry, not per frame. */
export function gameScale(): number {
  return GAME_SCALE_STEPS[scaleIndex];
}

/** Which step is selected, for the options screen. */
export function gameScaleIndex(): number {
  return scaleIndex;
}

/**
 * Move the selection by `delta` steps, clamped at both ends.
 * Returns whether it actually moved, so the caller can stay quiet if it did not.
 */
export function nudgeGameScale(delta: number): boolean {
  const next = Math.max(0, Math.min(GAME_SCALE_STEPS.length - 1, scaleIndex + delta));
  if (next === scaleIndex) return false;
  scaleIndex = next;
  persist();
  return true;
}

export function settingsAreCustomised(): boolean {
  return scaleIndex !== DEFAULT_SCALE_INDEX || idleIndex !== DEFAULT_IDLE_INDEX;
}

export function resetSettings(): void {
  scaleIndex = DEFAULT_SCALE_INDEX;
  idleIndex = DEFAULT_IDLE_INDEX;
  persist();
}

// --- idle timeout ---------------------------------------------------------

/**
 * "OFF", "45S", "1M", "1M 30S" — built once per step at module load.
 *
 * The options screen draws the current one every frame, and formatting there
 * would allocate a string per frame for a value that changes on a keypress.
 */
const IDLE_RETURN_LABELS: readonly string[] = IDLE_RETURN_STEPS.map((seconds) => {
  if (seconds === 0) return "OFF";
  if (seconds < 60) return `${seconds}S`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}M` : `${minutes}M ${rest}S`;
});

/**
 * Seconds of idle before a scene returns to the menu; 0 when switched off.
 *
 * Read **per frame**, unlike `gameScale()`: nothing is sized or allocated
 * from it, so a change on the options screen can take effect on the spot —
 * including on the options screen itself, which is the only place the
 * operator can watch it happen.
 */
export function idleReturnSeconds(): number {
  return IDLE_RETURN_STEPS[idleIndex];
}

/** Which step is selected, for the options screen's pip ladder. */
export function idleReturnIndex(): number {
  return idleIndex;
}

/** The current setting as the options screen shows it. */
export function idleReturnText(): string {
  return IDLE_RETURN_LABELS[idleIndex] ?? "";
}

/** Step the idle timeout, clamped at both ends. Returns whether it moved. */
export function nudgeIdleReturn(delta: number): boolean {
  const next = Math.max(0, Math.min(IDLE_RETURN_STEPS.length - 1, idleIndex + delta));
  if (next === idleIndex) return false;
  idleIndex = next;
  persist();
  return true;
}

/**
 * A baseline design-unit length at the current game scale.
 *
 * Rounded to whole units and never below 1: half-unit geometry is exactly the
 * sub-unit detail the design rules rule out, and it would put a Snake grid
 * half a cell out of alignment with itself.
 */
export function scaleUnits(units: number): number {
  return Math.max(1, Math.round(units * gameScale()));
}

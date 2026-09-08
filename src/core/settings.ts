/**
 * Cabinet settings: operator preferences that outlive a session.
 *
 * Persisted the same way as `bindings.ts` — localStorage, with every access
 * guarded, because a cabinet whose storage is unavailable has to boot on
 * defaults rather than throw on the way to the menu.
 */

const STORAGE_KEY = "tarmac.settings.v1";

/**
 * How much bigger a game draws its gameplay elements than their baseline
 * size: the Pong ball and paddles, the Snake cell, the in-game countdowns.
 *
 * This deliberately does **not** touch the design box. 320x240 stays the
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
const DEFAULT_INDEX = 1;

let scaleIndex = DEFAULT_INDEX;

/** Snap an arbitrary stored number to the nearest offered step. */
function nearestIndex(value: number): number {
  let best = DEFAULT_INDEX;
  let bestGap = Infinity;
  for (let i = 0; i < GAME_SCALE_STEPS.length; i++) {
    const gap = Math.abs(GAME_SCALE_STEPS[i] - value);
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
    const stored = parsed.gameScale;
    if (typeof stored === "number" && Number.isFinite(stored)) {
      scaleIndex = nearestIndex(stored);
    }
  } catch (err) {
    console.warn("[settings] could not read settings, using defaults:", err);
  }
}

load();

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, gameScale: gameScale() }));
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
  return scaleIndex !== DEFAULT_INDEX;
}

export function resetSettings(): void {
  scaleIndex = DEFAULT_INDEX;
  persist();
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

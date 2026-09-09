import { setUnlockScheduled, unlockScheduled } from "./unlocks";

/**
 * The roster: which games this cabinet is currently offering at all.
 *
 * A hard operator switch, not a schedule — the answer to "Snake's left stick
 * is dead, take it off until I can fix it". A game switched off is gone from
 * the carousel entirely, and that is the whole difference between this and
 * `core/unlocks.ts`: a locked card is an advert with a countdown on it, and a
 * broken game has nothing to advertise and nothing to count down to. Leaving
 * it on the list would just collect presses.
 *
 * Persisted like `bindings.ts`, `settings.ts` and `unlocks.ts` — localStorage,
 * every access guarded, because a cabinet whose storage is unavailable has to
 * boot with every game *on* rather than throw on the way to the menu. Only
 * the games that are off are stored, so the default is "everything plays".
 *
 * The menu reads this **at scene entry** rather than per frame: it is the only
 * screen that uses the list, the options screen is the only thing that changes
 * it, and leaving options enters the menu — so there is no moment where a
 * stale list can be on screen.
 */

const STORAGE_KEY = "tarmac.roster.v1";

/**
 * Ids of the games that are switched off. Ids of games no longer in the
 * registry are kept rather than dropped, for the same reason as in
 * `unlocks.ts`: a game pulled for one event and put back stays as it was left.
 */
const off = new Set<string>();

function load(): void {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private mode / storage disabled: run with every game on.
    return;
  }
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as { off?: unknown };
    if (!Array.isArray(parsed.off)) return;
    for (const id of parsed.off)
      if (typeof id === "string" && id !== "") off.add(id);
  } catch (err) {
    console.warn("[roster] could not read the roster, every game is on:", err);
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, off: [...off] }));
  } catch (err) {
    console.warn("[roster] could not save the roster:", err);
  }
}

load();

/** Whether the cabinet is offering this game at all. */
export function gameEnabled(id: string): boolean {
  return !off.has(id);
}

/** Switch a game on or off. Returns whether that changed anything. */
export function setGameEnabled(id: string, on: boolean): boolean {
  if (on === gameEnabled(id)) return false;
  if (on) off.delete(id);
  else off.add(id);
  persist();
  return true;
}

export function rosterIsCustomised(): boolean {
  return off.size > 0;
}

/** Put every game back on the cabinet. Called from the options reset row. */
export function resetRoster(): void {
  if (off.size === 0) return;
  off.clear();
  persist();
}

// --- the state ladder -----------------------------------------------------
//
// The roster switch and the unlock schedule are two flags, but an operator is
// answering one question per game — "is this playable, and when?" — so the
// options screen offers them as one field with three positions. That also
// keeps the game row at the width it already was: a seventh field would not
// fit next to a 12-character title and a countdown.

export const GAME_STATE_OFF = 0;
export const GAME_STATE_ON = 1;
export const GAME_STATE_TIMED = 2;

/** The three positions, least available first, as the field shows them. */
const STATE_TEXT = ["OFF", "ON", "TIMED"] as const;

/**
 * What each position means, for the options screen's status line — static
 * strings rather than sentences built at the call site, and the one place the
 * ladder is explained to whoever is setting it.
 */
const STATE_EXPLAINED = [
  "OFF: HIDDEN FROM THE MENU",
  "ON: PLAYABLE NOW",
  "TIMED: PLAYABLE FROM THE TIME SET",
] as const;

/**
 * Which position a game is in, derived from the two flags rather than stored
 * alongside them — so there is no third copy of the truth to fall out of sync.
 *
 * A game that is off reads as `OFF` whether or not its schedule is armed: the
 * schedule cannot mean anything for a game that is not on the carousel.
 */
export function gameStateIndex(id: string): number {
  if (!gameEnabled(id)) return GAME_STATE_OFF;
  return unlockScheduled(id) ? GAME_STATE_TIMED : GAME_STATE_ON;
}

export function gameStateText(id: string): string {
  return STATE_TEXT[gameStateIndex(id)];
}

/** The current position spelled out, for the status line under the rows. */
export function gameStateHelp(id: string): string {
  return STATE_EXPLAINED[gameStateIndex(id)];
}

/**
 * Step a game along the ladder, clamped at both ends.
 *
 * Both flags are set from the target position rather than nudged
 * independently, so the ladder is monotone: stepping up out of `OFF` always
 * lands on `ON`, even for a game whose schedule flag was left armed. The
 * unlock *time* is never touched — it is kept, dimmed, exactly as it is for a
 * schedule that is switched off.
 */
export function nudgeGameState(id: string, delta: number): boolean {
  const from = gameStateIndex(id);
  const to = Math.max(GAME_STATE_OFF, Math.min(GAME_STATE_TIMED, from + delta));
  if (to === from) return false;
  // Order matters only in that both end up right; neither call can fail.
  setGameEnabled(id, to !== GAME_STATE_OFF);
  if (to !== GAME_STATE_OFF) setUnlockScheduled(id, to === GAME_STATE_TIMED);
  return true;
}

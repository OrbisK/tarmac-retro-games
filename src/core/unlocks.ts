/**
 * Timed unlocks: a per-game moment before which the menu refuses to launch it.
 *
 * One-off release times, not a daily window — a game is locked, counts down,
 * and then stays unlocked. That is what an event cabinet wants: games appear
 * over the course of a day, and once one is out it stays out.
 *
 * Persisted the same way as `bindings.ts` and `settings.ts` — localStorage,
 * with every access guarded, because a cabinet whose storage is unavailable
 * has to boot on defaults rather than throw on the way to the menu.
 *
 * The clock is the machine's local clock. There is nothing else to ask on a
 * cabinet that may not have a network, so a wrong system time reads as a
 * wrong unlock time; the options screen shows the countdown next to the
 * stamp so that is visible while setting it.
 *
 * **Strings are cached per game**, rebuilt only when the stored time or the
 * whole-second countdown changes: the menu and the options screen draw these
 * every frame, and `onDraw` must not allocate.
 */

const STORAGE_KEY = "tarmac.unlocks.v1";

/**
 * The timestamp fields the options screen steps through, left to right.
 *
 * Only the timestamp: whether the schedule is in force at all is the first
 * field of that row, and it belongs to `core/roster.ts` — the operator sets
 * one three-position state per game (off / on / timed) rather than a roster
 * switch and a schedule switch side by side.
 */
export const UNLOCK_TIME_FIELDS = ["day", "month", "year", "hour", "minute"] as const;
export type UnlockTimeField = (typeof UNLOCK_TIME_FIELDS)[number];

const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

/**
 * Year range the editor will step to. Wide enough that nobody hits an end in
 * practice, narrow enough that a held Up cannot run to year 275760.
 */
const MIN_YEAR = 2000;
const MAX_YEAR = 2099;

/** Where a schedule starts when it is first switched on: today, 18:00. */
const DEFAULT_HOUR = 18;

interface Entry {
  /** Whether this game is gated at all. Off (the default) means always open. */
  on: boolean;
  /** The unlock moment, epoch ms, always on a whole minute. */
  at: number;
}

/** Only games that have been touched get an entry; absent means "always open". */
const entries = new Map<string, Entry>();

function defaultAt(): number {
  const d = new Date();
  d.setHours(DEFAULT_HOUR, 0, 0, 0);
  return d.getTime();
}

function load(): void {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private mode / storage disabled: run with nothing gated.
    return;
  }
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as { games?: Record<string, unknown> };
    const games = parsed.games;
    if (!games || typeof games !== "object") return;
    for (const [id, value] of Object.entries(games)) {
      if (!value || typeof value !== "object") continue;
      const { on, at } = value as { on?: unknown; at?: unknown };
      if (typeof at !== "number" || !Number.isFinite(at)) continue;
      // Ids of games no longer in the registry are kept rather than dropped:
      // a game taken out for one event and put back keeps its time.
      entries.set(id, { on: on === true, at: onMinute(at) });
    }
  } catch (err) {
    console.warn("[unlocks] could not read unlock times, nothing gated:", err);
  }
}

function persist(): void {
  try {
    const games: Record<string, Entry> = {};
    for (const [id, entry] of entries) games[id] = entry;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, games }));
  } catch (err) {
    console.warn("[unlocks] could not save unlock times:", err);
  }
}

/** Seconds and milliseconds are never edited, so they are never stored. */
function onMinute(ms: number): number {
  const d = new Date(ms);
  d.setSeconds(0, 0);
  return d.getTime();
}

/**
 * The entry for a game, created on first touch.
 * Callers must not hold the object across a `resetUnlocks()`.
 */
function entryOf(id: string): Entry {
  let entry = entries.get(id);
  if (!entry) {
    entry = { on: false, at: defaultAt() };
    entries.set(id, entry);
  }
  return entry;
}

load();

/** Whether this game is gated by a schedule at all. */
export function unlockScheduled(id: string): boolean {
  return entries.get(id)?.on === true;
}

/** The unlock moment in epoch ms — meaningful only while `unlockScheduled`. */
export function unlockAt(id: string): number {
  return entryOf(id).at;
}

/** Whether the game may not be launched at `now` (epoch ms). */
export function isLocked(id: string, now: number): boolean {
  const entry = entries.get(id);
  return entry !== undefined && entry.on && now < entry.at;
}

/** Whole seconds left until unlock, rounded up; 0 when not locked. */
export function secondsUntilUnlock(id: string, now: number): number {
  const entry = entries.get(id);
  if (!entry || !entry.on) return 0;
  return Math.max(0, Math.ceil((entry.at - now) / 1000));
}

/**
 * Switch the schedule on or off, keeping whatever time is set. Driven from the
 * state ladder in `core/roster.ts`, not from a field of its own.
 */
export function setUnlockScheduled(id: string, on: boolean): boolean {
  const entry = entryOf(id);
  if (entry.on === on) return false;
  entry.on = on;
  persist();
  return true;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Step one field of a game's unlock time.
 *
 * Day, hour and minute carry: minute 59 + 1 is the next hour, and day 31 + 1
 * is the 1st of the next month, which is what anyone editing a timestamp
 * expects. Month and year clamp the day instead, so 31 MAR stepped to
 * February lands on the 28th rather than sliding into March.
 */
export function nudgeUnlock(id: string, field: UnlockTimeField, delta: number): boolean {
  const entry = entryOf(id);
  const d = new Date(entry.at);
  switch (field) {
    case "day":
      d.setDate(d.getDate() + delta);
      break;
    case "hour":
      d.setHours(d.getHours() + delta);
      break;
    case "minute":
      d.setMinutes(d.getMinutes() + delta);
      break;
    case "month": {
      const day = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + delta);
      d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth())));
      break;
    }
    case "year": {
      const year = d.getFullYear() + delta;
      if (year < MIN_YEAR || year > MAX_YEAR) return false;
      const day = d.getDate();
      d.setDate(1);
      d.setFullYear(year);
      d.setDate(Math.min(day, daysInMonth(year, d.getMonth())));
      break;
    }
  }
  d.setSeconds(0, 0);
  const next = d.getTime();
  if (next === entry.at) return false;
  entry.at = next;
  persist();
  return true;
}

export function unlocksAreCustomised(): boolean {
  for (const entry of entries.values()) if (entry.on) return true;
  return false;
}

/** Clear every schedule. Called from the options screen's reset row. */
export function resetUnlocks(): void {
  if (entries.size === 0) return;
  entries.clear();
  textCache.clear();
  countdownCache.clear();
  persist();
}

// --- cached strings -------------------------------------------------------
//
// Both screens draw these every frame. The caches are keyed by the value they
// were built from, so a frame that changes nothing allocates nothing.

interface TextCache {
  at: number;
  /** One per `UNLOCK_TIME_FIELDS` entry, in the same order. */
  fields: string[];
  /** "10 SEP 14:00", or with the year when it is not the current one. */
  stamp: string;
}

const textCache = new Map<string, TextCache>();

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

function textOf(id: string): TextCache {
  const entry = entryOf(id);
  let cache = textCache.get(id);
  if (cache && cache.at === entry.at) return cache;

  const d = new Date(entry.at);
  const day = `${d.getDate()}`;
  const month = MONTHS[d.getMonth()];
  const year = `${d.getFullYear()}`;
  const hour = pad2(d.getHours());
  const minute = pad2(d.getMinutes());
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const stamp = sameYear
    ? `${day} ${month} ${hour}:${minute}`
    : `${day} ${month} ${year} ${hour}:${minute}`;
  const fields = [day, month, year, hour, minute];

  if (!cache) {
    cache = { at: entry.at, fields, stamp };
    textCache.set(id, cache);
  } else {
    cache.at = entry.at;
    cache.fields = fields;
    cache.stamp = stamp;
  }
  return cache;
}

/** One field of the unlock time as the options screen shows it. */
export function unlockFieldText(id: string, field: UnlockTimeField): string {
  return textOf(id).fields[UNLOCK_TIME_FIELDS.indexOf(field)] ?? "";
}

/** The unlock moment as a player-facing stamp, e.g. "10 SEP 14:00". */
export function unlockStampText(id: string): string {
  return textOf(id).stamp;
}

interface CountdownCache {
  seconds: number;
  /** "02:14:37", or "2D 03H" past a day out. */
  duration: string;
  /** The menu's card line: "UNLOCKS IN 02:14:37". */
  line: string;
}

const countdownCache = new Map<string, CountdownCache>();

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  if (days > 0) return `${days}D ${pad2(Math.floor((seconds % 86400) / 3600))}H`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

function countdownOf(id: string, now: number): CountdownCache {
  const seconds = secondsUntilUnlock(id, now);
  let cache = countdownCache.get(id);
  if (cache && cache.seconds === seconds) return cache;
  const duration = formatDuration(seconds);
  const line = `UNLOCKS IN ${duration}`;
  if (!cache) {
    cache = { seconds, duration, line };
    countdownCache.set(id, cache);
  } else {
    cache.seconds = seconds;
    cache.duration = duration;
    cache.line = line;
  }
  return cache;
}

/** Time left, bare: "02:14:37". */
export function unlockCountdownText(id: string, now: number): string {
  return countdownOf(id, now).duration;
}

/** Time left as the menu card reads it: "UNLOCKS IN 02:14:37". */
export function unlockCountdownLine(id: string, now: number): string {
  return countdownOf(id, now).line;
}

/** What a locked game is called on the menu. */
export const LOCKED_TITLE = "???";

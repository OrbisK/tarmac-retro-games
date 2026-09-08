import { BUTTONS, type Button, type FaceColor } from "./buttons";
import { MAX_PLAYERS } from "./config";

/**
 * Button bindings: which physical input drives which logical action.
 *
 * Gamepad bindings are stored **per controller `id`**, not per player slot, so
 * calibrating one pad fixes every identical pad plugged into the cabinet — and
 * a different controller keeps its own layout. Keyboard bindings are per slot,
 * since there is only one keyboard.
 *
 * Overrides are persisted in localStorage and merged over the defaults, so a
 * partially calibrated pad still works for everything untouched.
 */

/** A physical input: a gamepad button index, or one direction of one axis. */
export type BindingSource =
  | { readonly t: "b"; readonly i: number }
  | { readonly t: "a"; readonly i: number; readonly d: -1 | 1 };

export type PadBindings = Readonly<Record<Button, readonly BindingSource[]>>;
export type KeyBindings = Readonly<Record<Button, readonly string[]>>;

/** Directions: the d-pad arrives on axes 0/1, with 12-15 as the hat fallback. */
const DIRECTION_BINDINGS = {
  up: [
    { t: "a", i: 1, d: -1 },
    { t: "b", i: 12 },
  ],
  down: [
    { t: "a", i: 1, d: 1 },
    { t: "b", i: 13 },
  ],
  left: [
    { t: "a", i: 0, d: -1 },
    { t: "b", i: 14 },
  ],
  right: [
    { t: "a", i: 0, d: 1 },
    { t: "b", i: 15 },
  ],
} as const satisfies Partial<Record<Button, readonly BindingSource[]>>;

/** Shoulders and the two small centre buttons; the same on both layouts. */
const AUX_BINDINGS = {
  l: [{ t: "b", i: 4 }, { t: "b", i: 6 }],
  r: [{ t: "b", i: 5 }, { t: "b", i: 7 }],
  start: [{ t: "b", i: 9 }],
  back: [{ t: "b", i: 8 }],
} as const satisfies Partial<Record<Button, readonly BindingSource[]>>;

/**
 * The cabinet's pads: a SNES-style diamond, and they report `mapping: ""`, so
 * the browser gives no layout information at all. Measured on the hardware:
 *
 *   B0 = X (blue, top)     B1 = A (red, right)
 *   B2 = B (yellow, below)  B3 = Y (green, left)
 *
 * Logical names line up with the pad's printed labels here, which is what
 * makes `a` (confirm) the red button under your thumb.
 */
export const CABINET_PAD_BINDINGS: PadBindings = {
  ...DIRECTION_BINDINGS,
  x: [{ t: "b", i: 0 }],
  a: [{ t: "b", i: 1 }],
  b: [{ t: "b", i: 2 }],
  y: [{ t: "b", i: 3 }],
  ...AUX_BINDINGS,
};

/**
 * Pads that report `mapping: "standard"` have a layout defined by spec, where
 * button 0 is the bottom face button. Using the cabinet layout for those would
 * put `a` on the *right* face button instead of the bottom one — wrong for an
 * Xbox-style pad, so they keep the standard order.
 */
export const STANDARD_PAD_BINDINGS: PadBindings = {
  ...DIRECTION_BINDINGS,
  a: [{ t: "b", i: 0 }],
  b: [{ t: "b", i: 1 }],
  x: [{ t: "b", i: 2 }],
  y: [{ t: "b", i: 3 }],
  ...AUX_BINDINGS,
};

/**
 * Face-button colours by **raw button index**, per layout.
 *
 * The cabinet's pads are the SNES diamond: B0 blue (X, top), B1 red (A,
 * right), B2 yellow (B, bottom), B3 green (Y, left). Standard-mapping pads
 * use the Xbox arrangement, where the bottom button is green.
 */
const CABINET_BUTTON_COLORS: readonly (FaceColor | null)[] = [
  "blue",
  "red",
  "yellow",
  "green",
];

const STANDARD_BUTTON_COLORS: readonly (FaceColor | null)[] = [
  "green",
  "red",
  "blue",
  "yellow",
];

/**
 * The colour of whichever physical button currently drives `button`, or null
 * if it is not a coloured face button (directions, shoulders, start/select).
 */
export function faceColorOf(
  button: Button,
  padId: string | null,
  standardMapping = false,
): FaceColor | null {
  const table = standardMapping ? STANDARD_BUTTON_COLORS : CABINET_BUTTON_COLORS;
  const sources = padBindings(padId, standardMapping)[button];
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    if (source.t !== "b") continue;
    const color = table[source.i];
    if (color) return color;
  }
  return null;
}

/**
 * Which default a pad starts from.
 *
 * Either way it is only a starting point: `l`/`r`/`start`/`back` in particular
 * are educated guesses for a pad with no declared mapping, and the button
 * setup screen is how you fix any of it.
 */
export function defaultPadBindings(standardMapping: boolean): PadBindings {
  return standardMapping ? STANDARD_PAD_BINDINGS : CABINET_PAD_BINDINGS;
}

export const DEFAULT_KEY_BINDINGS: readonly KeyBindings[] = [
  {
    up: ["w"],
    down: ["s"],
    left: ["a"],
    right: ["d"],
    a: ["space", "f"],
    b: ["g"],
    x: ["q"],
    y: ["e"],
    l: ["1"],
    r: ["2"],
    start: ["enter"],
    back: ["escape"],
  },
  {
    up: ["up"],
    down: ["down"],
    left: ["left"],
    right: ["right"],
    a: ["."],
    b: [","],
    x: ["m"],
    y: ["/"],
    l: ["9"],
    r: ["0"],
    start: ["shift"],
    back: ["backspace"],
  },
];

/** Human-readable form for the setup screen, e.g. `B1` or `A1-`. */
export function describeSource(source: BindingSource): string {
  return source.t === "b" ? `B${source.i}` : `A${source.i}${source.d < 0 ? "-" : "+"}`;
}

export function describeSources(sources: readonly BindingSource[]): string {
  return sources.length > 0 ? sources.map(describeSource).join(" ") : "--";
}

export function describeKeys(keys: readonly string[]): string {
  return keys.length > 0 ? keys.join(" ") : "--";
}

// --- persistence -----------------------------------------------------------

const STORAGE_KEY = "tarmac.bindings.v1";

type PadOverride = Partial<Record<Button, BindingSource[]>>;
type KeyOverride = Partial<Record<Button, string[]>>;

interface Store {
  pads: Record<string, PadOverride>;
  keys: Record<string, KeyOverride>;
}

const BUTTON_SET = new Set<string>(BUTTONS);

function isButton(value: string): value is Button {
  return BUTTON_SET.has(value);
}

/** Reject anything malformed rather than letting bad storage break input. */
function parseSource(raw: unknown): BindingSource | null {
  if (typeof raw !== "object" || raw === null) return null;
  const src = raw as Record<string, unknown>;
  const index = src.i;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index > 63) {
    return null;
  }
  if (src.t === "b") return { t: "b", i: index };
  if (src.t === "a" && (src.d === 1 || src.d === -1)) return { t: "a", i: index, d: src.d };
  return null;
}

function parsePadOverride(raw: unknown): PadOverride {
  const out: PadOverride = {};
  if (typeof raw !== "object" || raw === null) return out;
  for (const [button, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!isButton(button) || !Array.isArray(list)) continue;
    const sources = list.map(parseSource).filter((s): s is BindingSource => s !== null);
    out[button] = sources;
  }
  return out;
}

function parseKeyOverride(raw: unknown): KeyOverride {
  const out: KeyOverride = {};
  if (typeof raw !== "object" || raw === null) return out;
  for (const [button, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!isButton(button) || !Array.isArray(list)) continue;
    out[button] = list.filter((key): key is string => typeof key === "string");
  }
  return out;
}

function load(): Store {
  const empty: Store = { pads: {}, keys: {} };
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private mode / storage disabled: run on defaults.
    return empty;
  }
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const pads = (parsed.pads ?? {}) as Record<string, unknown>;
    const keys = (parsed.keys ?? {}) as Record<string, unknown>;
    for (const [id, value] of Object.entries(pads)) empty.pads[id] = parsePadOverride(value);
    for (const [slot, value] of Object.entries(keys)) empty.keys[slot] = parseKeyOverride(value);
  } catch (err) {
    console.warn("[bindings] ignoring unreadable saved bindings:", err);
  }
  return empty;
}

const store = load();

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, ...store }));
  } catch (err) {
    console.warn("[bindings] could not save bindings:", err);
  }
}

// --- resolution ------------------------------------------------------------

/**
 * Merged bindings are cached by key, so the per-frame poll reads a stable
 * object instead of rebuilding one. Writes invalidate the affected entry.
 */
const padCache = new Map<string, PadBindings>();
const keyCache = new Map<number, KeyBindings>();

export function padBindings(padId: string | null, standardMapping = false): PadBindings {
  const defaults = defaultPadBindings(standardMapping);
  if (padId === null) return defaults;
  // Cached by id alone: a device's mapping string never changes for that id.
  const cached = padCache.get(padId);
  if (cached) return cached;
  const override = store.pads[padId];
  const merged = override ? ({ ...defaults, ...override } as PadBindings) : defaults;
  padCache.set(padId, merged);
  return merged;
}

export function keyBindings(slot: number): KeyBindings {
  const cached = keyCache.get(slot);
  if (cached) return cached;
  const base = DEFAULT_KEY_BINDINGS[slot] ?? DEFAULT_KEY_BINDINGS[0];
  const override = store.keys[String(slot)];
  const merged = override ? ({ ...base, ...override } as KeyBindings) : base;
  keyCache.set(slot, merged);
  return merged;
}

export function setPadBinding(
  padId: string,
  button: Button,
  sources: readonly BindingSource[],
): void {
  const override = (store.pads[padId] ??= {});
  override[button] = [...sources];
  padCache.delete(padId);
  persist();
}

export function setKeyBinding(slot: number, button: Button, keys: readonly string[]): void {
  const override = (store.keys[String(slot)] ??= {});
  override[button] = [...keys];
  keyCache.delete(slot);
  persist();
}

/** Drop the override for one action so it falls back to the default. */
export function clearPadBinding(padId: string, button: Button): void {
  const override = store.pads[padId];
  if (!override) return;
  delete override[button];
  if (Object.keys(override).length === 0) delete store.pads[padId];
  padCache.delete(padId);
  persist();
}

export function clearKeyBinding(slot: number, button: Button): void {
  const override = store.keys[String(slot)];
  if (!override) return;
  delete override[button];
  if (Object.keys(override).length === 0) delete store.keys[String(slot)];
  keyCache.delete(slot);
  persist();
}

export function resetPadBindings(padId: string): void {
  delete store.pads[padId];
  padCache.delete(padId);
  persist();
}

export function resetKeyBindings(slot: number): void {
  delete store.keys[String(slot)];
  keyCache.delete(slot);
  persist();
}

export function resetAllBindings(): void {
  store.pads = {};
  store.keys = {};
  padCache.clear();
  keyCache.clear();
  persist();
}

/** True when this pad has any saved override — shown in the setup screen. */
export function padIsCalibrated(padId: string | null): boolean {
  return padId !== null && store.pads[padId] !== undefined;
}

export function keysAreCustomised(slot: number): boolean {
  return store.keys[String(slot)] !== undefined;
}

export function playerSlots(): number {
  return MAX_PLAYERS;
}

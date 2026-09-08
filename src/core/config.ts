/**
 * Global tuning constants. Pure data — imports nothing, so it is safe to use
 * from any module regardless of engine init order.
 */

/**
 * The layout reference, in **design units** — not pixels.
 *
 * Rendering happens at the monitor's real resolution; these numbers only fix
 * the proportions and the aspect ratio. `core/viewport.ts` works out how many
 * device pixels one design unit is worth and every draw call converts, so a
 * 4x4 unit ball is 4 units on a 640x480 panel and on a 4K one — sharp on both,
 * because nothing is ever rendered small and scaled up.
 *
 * Gameplay tuning (speeds, sizes, grid cells) is all expressed in these units,
 * so changing the numbers below rescales the whole design without touching a
 * single game. Raise them for finer detail and proportionally smaller UI.
 */
export const DESIGN_WIDTH = 320;
export const DESIGN_HEIGHT = 240;


/** Number of player slots the cabinet supports. */
export const MAX_PLAYERS = 2;

/**
 * Palette, chosen for contrast rather than subtlety.
 *
 * A cabinet is read from a couple of metres away, often with light on the
 * screen, at a coarse design resolution — so every colour used for text sits
 * at 6.5:1 or better against `bg`, and even the border/inactive grey clears
 * 4:1. If you add a colour, check it against `bg` before using it for
 * anything a player has to read.
 *
 * Contrast against `bg` (#0b0b16):
 *   text 16:1   good/btnGreen 13.5:1   accent/btnYellow 13.4:1
 *   p1 11.4:1   textDim 9.3:1   btnBlue 8.9:1   btnRed 7.0:1
 *   p2/bad 6.5:1   dim 4.3:1 (borders only)
 */
export const PALETTE = {
  bg: "#0b0b16",
  bgAlt: "#1f1f38",
  dim: "#7070a8",
  text: "#eaeaff",
  textDim: "#b0b0d8",
  accent: "#ffd23f",
  p1: "#4fd6ff",
  p2: "#ff5c7a",
  good: "#6ef08a",
  bad: "#ff5c7a",
  white: "#ffffff",
  black: "#000000",
  // The four colours printed on the cabinet's face buttons. Kept separate
  // from p1/p2/accent/good so player identity and button identity can appear
  // side by side without reading as the same thing.
  btnBlue: "#4fb8ff",
  btnRed: "#ff6b6b",
  btnYellow: "#ffd23f",
  btnGreen: "#6ef08a",
} as const;

export type PaletteKey = keyof typeof PALETTE;

/** Seconds the Back button must be held to bail out of a game. */
export const QUIT_HOLD_SECONDS = 0.7;

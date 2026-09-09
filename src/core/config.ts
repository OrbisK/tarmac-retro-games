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
 *
 * Tetromino faces, same test:
 *   tetO 13.5:1   tetS 13.5:1   tetI 12.5:1   tetL 8.3:1
 *   tetT 8.1:1   tetJ 7.2:1   tetZ 7.0:1
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
  // The seven tetromino faces. Their own entries rather than borrowed
  // p1/accent/good ones: a falling piece is not a player or a state, and a
  // stack has to stay separable hue by hue at a 10-unit block, so these were
  // picked as a set — every pair is far enough apart in Lab that the closest
  // (tetT/tetJ, purple next to blue) still reads as two colours across a room.
  // Garbage rows use `textDim`: the one neutral in the stack, and further from
  // every face than any face is from another.
  tetI: "#4fe3e3",
  tetO: "#ffd23f",
  tetT: "#c98cff",
  tetS: "#6ef08a",
  tetZ: "#ff6b6b",
  tetJ: "#6d9aff",
  tetL: "#ff8a2b",
} as const;

export type PaletteKey = keyof typeof PALETTE;

/** Seconds the Back button must be held to bail out of a game. */
export const QUIT_HOLD_SECONDS = 0.7;

/**
 * Idle behaviour: what the cabinet does when nobody is touching it.
 *
 * An event cabinet is left mid-match constantly — a round ends, the players
 * walk off, and the next person finds a finished game they have no reason to
 * recognise. So a scene left without input drops back to the menu, and the
 * menu itself starts browsing on its own, which is the only thing on the
 * machine that advertises what it holds.
 *
 * The attract delay is much shorter than the return: a menu nobody is driving
 * costs nothing to animate, while a game cut short is someone's match. That
 * is also why the return is the one an operator can change or switch off
 * (`IDLE_RETURN_STEPS` in `core/settings.ts`) and these are not — a wrong
 * attract cadence costs nobody anything.
 */
/** How long the "menu in N" warning is up before the return. */
export const IDLE_WARNING_SECONDS = 6;
/** Idle time on the menu before it starts cycling cards by itself. */
export const IDLE_ATTRACT_SECONDS = 12;
/** How long each card is held during that cycle. */
export const ATTRACT_STEP_SECONDS = 5;

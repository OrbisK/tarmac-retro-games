import type { PaletteKey } from "./config";

/**
 * What the menu needs to know about a game, and how the game gets wired in.
 *
 * A game module exports one of these; `registry.ts` collects them and
 * `main.ts` calls `register()` on each at boot. Games never import the menu,
 * so adding one touches exactly two files: the game itself and the registry.
 */
export interface GameDefinition {
  /** Stable id, also used as the scene name. */
  readonly id: string;
  readonly title: string;
  readonly tagline: string;
  /** Short player-count blurb, e.g. "2P VERSUS". */
  readonly players: string;
  readonly accent: PaletteKey;
  /** Define the game's scene(s). Called once at boot. */
  register(): void;
  /**
   * Optional animated thumbnail for the menu, drawn into the given box.
   * `t` is seconds since the menu opened. Must not allocate or add objects.
   */
  drawPreview?(x: number, y: number, w: number, h: number, t: number): void;
  /**
   * Optional sample of whatever this game sizes from the game scale — ball,
   * paddle, grid cell, countdown — drawn into the given box at its **true**
   * design-unit size for the current setting.
   *
   * The options screen shows one per game, so a scale change can be judged
   * before launching anything. Sized by the game rather than by the screen
   * on purpose: only the game knows which of its numbers scale. Must not
   * allocate or add objects.
   */
  drawScaleSample?(x: number, y: number, w: number, h: number): void;
}

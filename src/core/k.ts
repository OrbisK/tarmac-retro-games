import kaplay from "kaplay";
import { PALETTE } from "./config";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (!canvas) throw new Error('Missing <canvas id="game"> in index.html');

/**
 * The one and only KAPLAY context.
 *
 * `global: false` keeps every engine call explicit (`k.add`, `k.vec2`, ...)
 * instead of leaking hundreds of names onto `window`.
 *
 * No `width`/`height` is given on purpose: the canvas then follows its CSS box
 * (the whole window) and the framebuffer is sized in real device pixels, so
 * output is limited by the monitor rather than by a fake internal resolution.
 * KAPLAY's default `pixelDensity` is `devicePixelRatio`, which is what we
 * want. Layout scaling is handled in `core/viewport.ts`.
 *
 * Note: the engine is initialised at module-eval time, so any module that
 * imports `k` is guaranteed to see a ready context.
 */
export const k = kaplay({
  canvas,
  // The letterbox colour: the square play area is painted over it per scene.
  background: PALETTE.black,
  global: false,
  focus: true,
  touchToMouse: false,
  loadingScreen: false,
  debug: true,
  debugKey: "f2",
});

export type K = typeof k;

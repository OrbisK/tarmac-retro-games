import { DESIGN_HEIGHT, DESIGN_WIDTH, MAX_PLAYERS } from "../core/config";
import type { GameDefinition } from "../core/game";
import { input } from "../core/input";
import { k } from "../core/k";
import { defineScene, goTo, INPUT_TEST_SCENE, MENU_SCENE, OPTIONS_SCENE } from "../core/scene";
import {
  C,
  drawBox,
  drawLabel,
  drawLetterboxBars,
  drawPanel,
  drawRule,
  drawTriangle,
  FONT_SMALL,
  playerColor,
} from "../core/ui";
import { drawHints } from "../core/prompts";
import { GAMES } from "../games/registry";

/**
 * Main menu: a full-bleed carousel, one game at a time, left/right to browse.
 *
 * Cards are laid out on an endless track indexed by a *virtual* index that is
 * free to run negative or past the end — the game shown is that index modulo
 * the list length. That is what makes wrapping from the last game back to the
 * first slide continuously instead of rewinding across the whole track.
 *
 * Everything is drawn in one `onDraw` rather than built from objects: the
 * selection moves constantly, and rebuilding a list of game objects on every
 * input is exactly the churn to avoid on a machine that stays on for hours.
 */

const HEADER_H = 15;
const FOOTER_H = 17;
const CARD_TOP = HEADER_H + 4;
const CARD_BOTTOM = DESIGN_HEIGHT - FOOTER_H - 4;
const CARD_H = CARD_BOTTOM - CARD_TOP;
const CARD_MARGIN = 10;
const CARD_W = DESIGN_WIDTH - CARD_MARGIN * 2;
/** Cards sit one screen apart, so a full swipe moves exactly one game. */
const STRIDE = DESIGN_WIDTH;

const PREVIEW_INSET = 8;
const PREVIEW_H = 124;
const FONT_GAME_TITLE = 24;

/** How fast the track settles on the selected card. */
const SLIDE_SPEED = 11;

function drawCard(game: GameDefinition, offset: number, focused: boolean, t: number): void {
  const x = CARD_MARGIN + offset * STRIDE;
  const accent = C[game.accent];

  drawPanel({
    x,
    y: CARD_TOP,
    w: CARD_W,
    h: CARD_H,
    fill: focused ? C.bgAlt : C.bg,
    outline: focused ? accent : C.dim,
  });

  // Preview fills the top of the card and does the heavy lifting visually.
  const previewX = x + PREVIEW_INSET;
  const previewY = CARD_TOP + PREVIEW_INSET;
  const previewW = CARD_W - PREVIEW_INSET * 2;
  drawBox({
    x: previewX,
    y: previewY,
    w: previewW,
    h: PREVIEW_H,
    color: C.black,
    outline: focused ? accent : C.dim,
  });
  if (game.drawPreview) {
    game.drawPreview(previewX + 1, previewY + 1, previewW - 2, PREVIEW_H - 2, t);
  }

  const textCenter = x + CARD_W / 2;
  let y = previewY + PREVIEW_H + 6;
  drawLabel({
    text: game.title,
    x: textCenter,
    y,
    size: FONT_GAME_TITLE,
    color: focused ? C.text : C.textDim,
    anchor: "center",
  });
  y += FONT_GAME_TITLE + 4;
  drawLabel({
    text: game.players,
    x: textCenter,
    y,
    size: FONT_SMALL,
    color: accent,
    anchor: "center",
  });
  y += FONT_SMALL + 3;
  drawLabel({
    text: game.tagline,
    x: textCenter,
    y,
    size: FONT_SMALL,
    color: C.textDim,
    anchor: "center",
  });
}

function main(): void {
  const count = GAMES.length;
  /** Unbounded: the shown game is this modulo `count`, so wrapping is smooth. */
  let virtualIndex = 0;
  /** Eased position of the track, in card units. */
  let slide = 0;
  let elapsed = 0;

  function selected(): number {
    return ((virtualIndex % count) + count) % count;
  }

  // Input test / button setup live behind F4 rather than a button sequence:
  // setup is done with a keyboard attached, and it keeps the menu's own
  // direction handling free of a sequence matcher.
  k.onKeyPress("f4", () => goTo(INPUT_TEST_SCENE));
  // F5 skips the hop through the input test, which is the screen an operator
  // wants least often of the three.
  k.onKeyPress("f5", () => goTo(OPTIONS_SCENE));

  k.onUpdate(() => {
    const dt = k.dt();
    elapsed += dt;

    for (let p = 0; p < MAX_PLAYERS; p++) {
      // Up/down are accepted as well: on a d-pad people try both, and there
      // is nothing else for them to mean here.
      if (input.repeated(p, "right") || input.repeated(p, "down")) virtualIndex++;
      if (input.repeated(p, "left") || input.repeated(p, "up")) virtualIndex--;
      if (input.pressed(p, "a") || input.pressed(p, "start")) {
        const game = GAMES[selected()];
        if (game) goTo(game.id);
      }
    }

    // Exponential ease, framerate independent.
    slide += (virtualIndex - slide) * Math.min(1, dt * SLIDE_SPEED);
    if (Math.abs(virtualIndex - slide) < 0.0005) slide = virtualIndex;
  });

  k.onDraw(() => {
    // --- header ---
    drawLabel({
      text: "TARMAC",
      x: 6,
      y: 3,
      size: FONT_SMALL,
      color: C.accent,
    });
    let padX = DESIGN_WIDTH - 6;
    for (let p = MAX_PLAYERS - 1; p >= 0; p--) {
      const connected = input.padConnected(p);
      drawLabel({
        text: `P${p + 1}`,
        x: padX,
        y: 3,
        size: FONT_SMALL,
        color: connected ? playerColor(p) : C.dim,
        anchor: "right",
      });
      padX -= 26;
    }
    drawRule(HEADER_H);

    // --- carousel track ---
    // Only the cards that can be on screen are drawn; at most three during a
    // slide, one when settled.
    const first = Math.floor(slide) - 1;
    for (let i = first; i <= first + 2; i++) {
      const offset = i - slide;
      if (Math.abs(offset) > 1.05) continue;
      const index = ((i % count) + count) % count;
      const game = GAMES[index];
      if (!game) continue;
      drawCard(game, offset, Math.abs(offset) < 0.5, elapsed);
    }

    // --- navigation arrows, only when there is somewhere to go ---
    if (count > 1) {
      const arrowY = CARD_TOP + CARD_H / 2;
      drawTriangle({
        x1: 7,
        y1: arrowY - 7,
        x2: 7,
        y2: arrowY + 7,
        x3: 1,
        y3: arrowY,
        color: C.accent,
      });
      drawTriangle({
        x1: DESIGN_WIDTH - 7,
        y1: arrowY - 7,
        x2: DESIGN_WIDTH - 7,
        y2: arrowY + 7,
        x3: DESIGN_WIDTH - 1,
        y3: arrowY,
        color: C.accent,
      });
    }

    // --- footer: position dots on the left, controls on the right ---
    drawRule(DESIGN_HEIGHT - FOOTER_H);
    const active = selected();
    for (let i = 0; i < count; i++) {
      const on = i === active;
      // Kept chunky: a 2-unit dot would be a smear at this design resolution.
      const size = on ? 7 : 5;
      drawBox({
        x: 6 + i * 11 + (on ? 0 : 1),
        y: DESIGN_HEIGHT - FOOTER_H + 5 + (on ? 0 : 1),
        w: size,
        h: size,
        color: on ? C.accent : C.dim,
      });
    }
    drawHints({
      x: DESIGN_WIDTH - 5,
      y: DESIGN_HEIGHT - FOOTER_H + 1,
      align: "right",
      hints: [
        { button: "left" },
        { button: "right" },
        { text: "BROWSE" },
        { gap: 6 },
        { button: "a" },
        { text: "PLAY" },
      ],
    });

    // Clip the cards that slid past the design box.
    drawLetterboxBars();
  });
}

export function registerMenu(): void {
  defineScene(MENU_SCENE, main);
}

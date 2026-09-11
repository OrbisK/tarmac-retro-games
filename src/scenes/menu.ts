import {
  ATTRACT_STEP_SECONDS,
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  IDLE_ATTRACT_SECONDS,
  MAX_PLAYERS,
} from "../core/config";
import type { GameDefinition } from "../core/game";
import { idleSeconds } from "../core/idle";
import { input } from "../core/input";
import { k } from "../core/k";
import { syncPwa } from "../core/pwa";
import { gameEnabled } from "../core/roster";
import { defineScene, goTo, INPUT_TEST_SCENE, MENU_SCENE, OPTIONS_SCENE } from "../core/scene";
import {
  C,
  drawBox,
  drawLabel,
  drawLetterboxBars,
  drawPanel,
  drawRule,
  drawTriangle,
  FONT_MIN,
  FONT_SMALL,
  FONT_TITLE,
  measureLabel,
  playerColor,
} from "../core/ui";
import { drawControlsModal } from "../core/controls";
import { drawHints, type Hint } from "../core/prompts";
import {
  isLocked,
  LOCKED_TITLE,
  unlockCountdownLine,
  unlockStampText,
} from "../core/unlocks";
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
 *
 * Left alone for `IDLE_ATTRACT_SECONDS` it browses itself, one card every
 * `ATTRACT_STEP_SECONDS`, using the same virtual index as a player would — so
 * the cabinet shows its whole list to the room instead of holding on whatever
 * the last person happened to leave selected. This is also where a game that
 * timed out lands, with the idle clock already past the threshold, so the
 * cycle picks up immediately rather than after another wait.
 *
 * A game with an unlock time that has not passed yet (`core/unlocks.ts`) is
 * still on the carousel, but as `???` over a dimmed preview with the
 * countdown under it: the card is the advert for the game, so hiding it
 * entirely would lose the thing the countdown is for. The menu is the only
 * gate — pressing A on a locked card refuses and says how long is left.
 *
 * A game the operator has switched **off** (`core/roster.ts`) is the opposite
 * case and is simply not here: no card, no dot, no place in the wrap-around.
 * There is nothing to advertise about a game that does not work and nothing
 * to count down to, and a card that only ever refuses would just collect
 * presses. The list is read once on entry — the options screen is the only
 * thing that changes it, and leaving options comes back through here.
 */

const HEADER_H = 17;
const FOOTER_H = 20;
const CARD_TOP = HEADER_H + 4;
const CARD_BOTTOM = DESIGN_HEIGHT - FOOTER_H - 4;
const CARD_H = CARD_BOTTOM - CARD_TOP;
const CARD_MARGIN = 10;
const CARD_W = DESIGN_WIDTH - CARD_MARGIN * 2;
/** Cards sit one screen apart, so a full swipe moves exactly one game. */
const STRIDE = DESIGN_WIDTH;

const PREVIEW_INSET = 8;
const FONT_GAME_TITLE = 28;
/**
 * The block under the preview: title, player count, tagline — and on a locked
 * card the stamp on a fourth line, which is the taller of the two. Stated as
 * a height rather than measured so the preview, which is what the card is
 * mostly made of, can take everything the card has left.
 */
const CARD_TEXT_H =
  6 + FONT_GAME_TITLE + 4 + FONT_SMALL + 3 + FONT_SMALL + 3 + FONT_SMALL + PREVIEW_INSET;
const PREVIEW_H = CARD_H - PREVIEW_INSET - CARD_TEXT_H;
/** Room a tagline has before it starts crossing the card's own outline. */
const TAGLINE_W = CARD_W - PREVIEW_INSET * 2;
/**
 * `???` sits one size down, on `FONT_TITLE`: a locked card carries two extra
 * lines under it — the countdown and the stamp — and at 24 the last of them
 * runs into the bottom of the card.
 */
const FONT_LOCKED_TITLE = FONT_TITLE;

/** How fast the track settles on the selected card. */
const SLIDE_SPEED = 11;

/** How long the refusal reads for after A on a locked card. */
const LOCKED_FLASH_SECONDS = 0.75;
/** Flashes per second of the refused card's outline. */
const LOCKED_FLASH_HZ = 6;

/** The padlock over a locked preview, in design units. Chunky on purpose. */
const LOCK_BODY_W = 26;
const LOCK_BODY_H = 20;
const LOCK_SHACKLE_W = 16;
const LOCK_SHACKLE_H = 10;
/** Bar thickness of the shackle and the keyhole; 3 units reads at distance. */
const LOCK_BAR = 3;

/**
 * How much of the preview shows through on a locked card.
 *
 * Dimmed rather than blanked: the animation says there is a game there, and
 * at this opacity you can read that it is *a* game without reading *which*.
 */
const LOCKED_PREVIEW_VEIL = 0.82;

/**
 * The notice that stands in for the carousel when the roster is empty.
 *
 * Only an operator can produce this state, so it is addressed to one: it says
 * where the switch is rather than apologising to a player. Built once, like
 * every other string drawn every frame.
 */
const EMPTY_LINES = [
  "NO GAMES ENABLED",
  "EVERY GAME ON THIS CABINET IS",
  "SWITCHED OFF IN OPTIONS  (F5)",
] as const;
const EMPTY_TITLE_GAP = 8;
const EMPTY_LINE_GAP = 4;
const EMPTY_BLOCK_H = FONT_TITLE + EMPTY_TITLE_GAP + FONT_SMALL + EMPTY_LINE_GAP + FONT_SMALL;

/** Built once: `onDraw` must not allocate. */
const FOOTER_HINTS: readonly Hint[] = [
  { button: "left" },
  { button: "right" },
  { text: "BROWSE" },
  { gap: 6 },
  { button: "a" },
  { text: "PLAY" },
  { gap: 6 },
  { button: "y" },
  { text: "CONTROLS" },
];

/**
 * The padlock over a locked preview: shackle, body, keyhole.
 *
 * Assembled from boxes rather than a sprite so it stays in design units and
 * scales with the cabinet like everything else. Bars are 3 units — a 1-unit
 * outline would vanish against a moving preview.
 */
function drawLockGlyph(cx: number, cy: number): void {
  const top = cy - (LOCK_SHACKLE_H + LOCK_BODY_H) / 2;
  const shackleX = cx - LOCK_SHACKLE_W / 2;
  const postH = LOCK_SHACKLE_H - LOCK_BAR;
  drawBox({ x: shackleX, y: top, w: LOCK_SHACKLE_W, h: LOCK_BAR, color: C.textDim });
  drawBox({ x: shackleX, y: top + LOCK_BAR, w: LOCK_BAR, h: postH, color: C.textDim });
  drawBox({
    x: shackleX + LOCK_SHACKLE_W - LOCK_BAR,
    y: top + LOCK_BAR,
    w: LOCK_BAR,
    h: postH,
    color: C.textDim,
  });
  const bodyY = top + LOCK_SHACKLE_H;
  drawBox({ x: cx - LOCK_BODY_W / 2, y: bodyY, w: LOCK_BODY_W, h: LOCK_BODY_H, color: C.textDim });
  // Keyhole: punched in the card fill, so the body reads as solid.
  drawBox({ x: cx - LOCK_BAR / 2, y: bodyY + 6, w: LOCK_BAR, h: LOCK_BODY_H - 11, color: C.bg });
}

/**
 * The card area, with the empty-roster notice in it instead of a card.
 *
 * Outlined in `bad` rather than the accent: an empty carousel is a cabinet
 * that cannot do the one thing it is for, and it should read that way from
 * across the room.
 */
function drawEmptyRoster(): void {
  drawPanel({ x: CARD_MARGIN, y: CARD_TOP, w: CARD_W, h: CARD_H, fill: C.bg, outline: C.bad });
  const cx = DESIGN_WIDTH / 2;
  let y = CARD_TOP + (CARD_H - EMPTY_BLOCK_H) / 2;
  drawLabel({
    text: EMPTY_LINES[0],
    x: cx,
    y,
    size: FONT_TITLE,
    color: C.bad,
    anchor: "center",
  });
  y += FONT_TITLE + EMPTY_TITLE_GAP;
  for (let i = 1; i < EMPTY_LINES.length; i++) {
    drawLabel({
      text: EMPTY_LINES[i],
      x: cx,
      y,
      size: FONT_SMALL,
      color: C.textDim,
      anchor: "center",
    });
    y += FONT_SMALL + EMPTY_LINE_GAP;
  }
}

function drawCard(opts: {
  game: GameDefinition;
  offset: number;
  focused: boolean;
  t: number;
  /** Unlock time not reached: `???`, dimmed preview, countdown. */
  locked: boolean;
  /** This card was just refused, and is on the bright half of the flash. */
  refused: boolean;
  /** Measured on scene entry — see `taglineSizes`. */
  taglineSize: number;
  now: number;
}): void {
  const { game, focused, locked, refused } = opts;
  const x = CARD_MARGIN + opts.offset * STRIDE;
  // A locked card gives up its accent: the colour is part of the game's
  // identity, and the identity is the thing being held back.
  const accent = locked ? C.dim : C[game.accent];
  const outline = refused ? C.bad : focused ? accent : C.dim;

  drawPanel({
    x,
    y: CARD_TOP,
    w: CARD_W,
    h: CARD_H,
    fill: focused ? C.bgAlt : C.bg,
    outline,
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
    outline,
  });
  if (game.drawPreview) {
    game.drawPreview(previewX + 1, previewY + 1, previewW - 2, PREVIEW_H - 2, opts.t);
  }
  if (locked) {
    // Veil over the running preview, then the padlock on top of it.
    drawBox({
      x: previewX + 1,
      y: previewY + 1,
      w: previewW - 2,
      h: PREVIEW_H - 2,
      color: C.bg,
      opacity: LOCKED_PREVIEW_VEIL,
    });
    drawLockGlyph(previewX + previewW / 2, previewY + PREVIEW_H / 2);
  }

  const textCenter = x + CARD_W / 2;
  const titleSize = locked ? FONT_LOCKED_TITLE : FONT_GAME_TITLE;
  let y = previewY + PREVIEW_H + 6;
  drawLabel({
    text: locked ? LOCKED_TITLE : game.title,
    x: textCenter,
    y,
    size: titleSize,
    color: focused ? C.text : C.textDim,
    anchor: "center",
  });
  y += titleSize + 4;
  drawLabel({
    text: locked ? "LOCKED" : game.players,
    x: textCenter,
    y,
    size: FONT_SMALL,
    color: locked ? C.bad : accent,
    anchor: "center",
  });
  y += FONT_SMALL + 3;
  // The tagline would give the game away, so the countdown takes its line —
  // and the countdown is the reason a locked card is on the carousel at all.
  drawLabel({
    text: locked ? unlockCountdownLine(game.id, opts.now) : game.tagline,
    x: textCenter,
    y,
    size: locked ? FONT_SMALL : opts.taglineSize,
    color: locked ? C.accent : C.textDim,
    anchor: "center",
  });
  if (locked) {
    // "Come back at 14:00" is more use than a countdown for a long wait.
    y += FONT_SMALL + 3;
    drawLabel({
      text: unlockStampText(game.id),
      x: textCenter,
      y,
      size: FONT_SMALL,
      color: C.textDim,
      anchor: "center",
    });
  }
}

function main(): void {
  // Between two games, with nobody playing: the one safe moment to swap in a
  // new build, and a good moment to go looking for one. `core/pwa.ts` says
  // why the menu owns this rather than the worker deciding for itself.
  syncPwa();

  // Read once, on entry: see the note at the top about why that is enough.
  const games = GAMES.filter((game) => gameEnabled(game.id));
  const count = games.length;
  /**
   * Tagline sizes, measured here rather than in `onDraw`, which must not
   * allocate and runs this three times a frame mid-slide.
   *
   * A tagline is one line and the card is one card: the long ones drop to the
   * floor size rather than running out over the outline. Measured rather than
   * counted in characters, since the size that fits depends on the font.
   */
  const taglineSizes = games.map((game) =>
    measureLabel(game.tagline, FONT_SMALL) <= TAGLINE_W ? FONT_SMALL : FONT_MIN,
  );
  /** Unbounded: the shown game is this modulo `count`, so wrapping is smooth. */
  let virtualIndex = 0;
  /** Eased position of the track, in card units. */
  let slide = 0;
  let elapsed = 0;
  /** Controls modal for the selected game; swallows browsing while open. */
  let controlsOpen = false;
  /** Seconds left of the refusal after A/Y on a locked card. */
  let lockedFlash = 0;
  /** Seconds until the attract cycle moves on. Only counts down while idle. */
  let attractTimer = ATTRACT_STEP_SECONDS;

  function selected(): number {
    return ((virtualIndex % count) + count) % count;
  }

  /**
   * Launch the selected game, or refuse it if its unlock time is still ahead.
   *
   * The check is here rather than in the game scenes because the menu is the
   * only way in: a locked scene is unreachable, so a guard per game would be
   * two more places to forget.
   */
  function launchSelected(): void {
    const game = games[selected()];
    if (!game) return;
    if (isLocked(game.id, Date.now())) {
      lockedFlash = LOCKED_FLASH_SECONDS;
      return;
    }
    goTo(game.id);
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
    if (lockedFlash > 0) lockedFlash = Math.max(0, lockedFlash - dt);

    // Nothing to browse, launch or attract with. The menu has no idle
    // timeout, so the cabinet sits on the notice until somebody switches a
    // game back on from the options screen.
    if (count === 0) return;

    for (let p = 0; p < MAX_PLAYERS; p++) {
      if (controlsOpen) {
        // A/Start still launches, so "read the controls, then play" is one
        // press rather than a close-then-confirm.
        if (input.pressed(p, "a") || input.pressed(p, "start")) {
          launchSelected();
        } else if (input.pressed(p, "b") || input.pressed(p, "y") || input.pressed(p, "back")) {
          controlsOpen = false;
          break;
        }
        // No browsing behind the modal: the card under it must not change.
        continue;
      }
      // `break` so the press that opened the modal is not also read as the
      // press that closes it.
      if (input.pressed(p, "y")) {
        // The controls list names the game in its header and would launch it
        // from A, so a locked card refuses here too.
        if (isLocked(games[selected()]?.id ?? "", Date.now())) {
          lockedFlash = LOCKED_FLASH_SECONDS;
        } else {
          controlsOpen = true;
        }
        break;
      }
      // Up/down are accepted as well: on a d-pad people try both, and there
      // is nothing else for them to mean here.
      if (input.repeated(p, "right") || input.repeated(p, "down")) virtualIndex++;
      if (input.repeated(p, "left") || input.repeated(p, "up")) virtualIndex--;
      if (input.pressed(p, "a") || input.pressed(p, "start")) launchSelected();
    }

    // --- attract: browse on its own once nobody has touched anything ---
    // Nothing to attract with one game, and stepping a single-card carousel
    // would slide to the same card over and over.
    if (count > 1 && idleSeconds() >= IDLE_ATTRACT_SECONDS) {
      // The modal names one game and launches it from A, so it must not be
      // left open over a card that is about to change underneath it.
      controlsOpen = false;
      attractTimer -= dt;
      if (attractTimer <= 0) {
        attractTimer = ATTRACT_STEP_SECONDS;
        virtualIndex++;
      }
    } else {
      // Reset rather than pause, so the first attract step is a full interval
      // after the cabinet goes quiet.
      attractTimer = ATTRACT_STEP_SECONDS;
    }

    // Exponential ease, framerate independent.
    slide += (virtualIndex - slide) * Math.min(1, dt * SLIDE_SPEED);
    if (Math.abs(virtualIndex - slide) < 0.0005) slide = virtualIndex;
  });

  k.onDraw(() => {
    const now = Date.now();

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

    // --- nothing on the roster: the notice takes the whole card area ---
    if (count === 0) {
      drawEmptyRoster();
      drawRule(DESIGN_HEIGHT - FOOTER_H);
      drawLetterboxBars();
      return;
    }

    // Below the early return: with an empty roster there is no selection for
    // these to describe, and `selected()` divides by the card count.
    const active = selected();
    const activeGame = games[active];
    const activeLocked = activeGame !== undefined && isLocked(activeGame.id, now);
    // Square wave, so the refused card blinks rather than fading — a fade
    // reads as an animation, a blink reads as "no".
    const flashOn = lockedFlash > 0 && Math.floor(lockedFlash * LOCKED_FLASH_HZ * 2) % 2 === 1;

    // --- carousel track ---
    // Only the cards that can be on screen are drawn; at most three during a
    // slide, one when settled.
    const first = Math.floor(slide) - 1;
    for (let i = first; i <= first + 2; i++) {
      const offset = i - slide;
      if (Math.abs(offset) > 1.05) continue;
      const index = ((i % count) + count) % count;
      const game = games[index];
      if (!game) continue;
      const focused = Math.abs(offset) < 0.5;
      const locked = isLocked(game.id, now);
      drawCard({
        game,
        offset,
        focused,
        t: elapsed,
        locked,
        // Gated on `locked` too, so browsing away mid-flash does not leave
        // the refusal colour on an unlocked card.
        refused: focused && locked && flashOn,
        taglineSize: taglineSizes[index] ?? FONT_SMALL,
        now,
      });
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
    // The refusal takes the hint row: it is the widest space in the footer,
    // and while it is up the hints it replaces are the ones that just failed.
    if (lockedFlash > 0 && activeGame && activeLocked) {
      const y = DESIGN_HEIGHT - FOOTER_H + 4;
      const line = unlockCountdownLine(activeGame.id, now);
      drawLabel({
        text: line,
        x: DESIGN_WIDTH - 5,
        y,
        size: FONT_SMALL,
        color: C.accent,
        anchor: "right",
      });
      drawLabel({
        text: "LOCKED",
        x: DESIGN_WIDTH - 5 - measureLabel(line, FONT_SMALL) - 6,
        y,
        size: FONT_SMALL,
        color: C.bad,
        anchor: "right",
      });
    } else {
      drawHints({
        x: DESIGN_WIDTH - 5,
        y: DESIGN_HEIGHT - FOOTER_H + 1,
        align: "right",
        hints: FOOTER_HINTS,
      });
    }

    // --- controls modal, over the settled card ---
    if (controlsOpen) {
      const game = games[active];
      if (game) {
        drawControlsModal({ title: game.title, rows: game.controls, accent: C[game.accent] });
      }
    }

    // Clip the cards that slid past the design box.
    drawLetterboxBars();
  });
}

export function registerMenu(): void {
  defineScene(MENU_SCENE, main);
}

import type { Color } from "kaplay";
import { DESIGN_HEIGHT, DESIGN_WIDTH, MAX_PLAYERS } from "../core/config";
import type { GameDefinition } from "../core/game";
import { input } from "../core/input";
import { k } from "../core/k";
import { drawHints } from "../core/prompts";
import { installQuitToMenu } from "../core/quit";
import { defineScene } from "../core/scene";
import { scaleUnits } from "../core/settings";
import { pu } from "../core/viewport";
import {
  C,
  CENTER_X,
  CENTER_Y,
  drawBox,
  drawLabel,
  drawPanel,
  drawRule,
  FONT_BODY,
  FONT_HUGE,
  FONT_SMALL,
  FONT_TITLE,
  playerColor,
} from "../core/ui";

/**
 * Tetris Duel — two wells side by side, one screen, no scrolling.
 *
 * Built the way `snakeDuel.ts` is: no game objects for the playfield. Two
 * `Uint8Array` wells and four active-piece integers per player, painted in a
 * single `onDraw`. A match is 400 cells of state and zero allocation once the
 * scene is up, so the object count is flat however long the cabinet runs.
 *
 * **The well does not scale.** 10x20 at a 10-unit cell is the game — piece
 * spawn columns, wall kicks and every stacking decision are stated in those
 * dimensions, and two of those wells plus their side panels is exactly what
 * 320 units holds. So unlike Snake's board this one is fixed, and the game
 * scale drives the two things that are read rather than played: the
 * next-piece preview and the round countdown. `drawScaleSample` shows both.
 *
 * Versus rules: clearing two or more rows at once sends garbage under the
 * other well. Rows on their way in are shown on a meter beside each well and
 * cancel against your own next send, so answering an attack beats racing it.
 * Garbage lands when the piece that earned it locks, never mid-piece.
 */

const SCENE = "tetris-duel";

/* --- geometry ----------------------------------------------------------- */

const COLS = 10;
const ROWS = 20;
/** Fixed, not `scaleUnits`: see the note above. */
const CELL = 10;
const WELL_W = COLS * CELL;
const WELL_H = ROWS * CELL;

const HEADER_H = 18;
const WELL_TOP = 20;
const WELL_BOTTOM = WELL_TOP + WELL_H;

const PANEL_W = 44;
const METER_W = 6;
/**
 * The two halves are mirrored about the centre line: panel, garbage meter,
 * well, divider, well, meter, panel. Wells inboard so the two stacks are
 * next to each other — the thing each player keeps glancing at.
 */
const WELL_X = [56, DESIGN_WIDTH - 56 - WELL_W] as const;
const METER_X = [48, DESIGN_WIDTH - 48 - METER_W] as const;
const PANEL_X = [2, DESIGN_WIDTH - 2 - PANEL_W] as const;

/** Round-win marks. 7 square clears the 5-unit floor with a gap to spare. */
const PIP_SIZE = 7;
const PIP_STRIDE = 10;
const PIP_X = [20, DESIGN_WIDTH - 20 - PIP_SIZE] as const;

/** Baseline for the next-piece cell — one of the two things that scale. */
const NEXT_CELL_BASE = 5;

/* --- pieces ------------------------------------------------------------- */

const PIECE_COUNT = 7;
const ROT_COUNT = 4;
/** Side of the box each piece turns inside: I needs 4x4, O only 2x2. */
const BOX = [4, 2, 3, 3, 3, 3, 3] as const;

/** Spawn orientation as x,y pairs inside that box, in I O T S Z J L order. */
const SPAWN_CELLS: readonly (readonly number[])[] = [
  [0, 1, 1, 1, 2, 1, 3, 1],
  [0, 0, 1, 0, 0, 1, 1, 1],
  [1, 0, 0, 1, 1, 1, 2, 1],
  [1, 0, 2, 0, 0, 1, 1, 1],
  [0, 0, 1, 0, 1, 1, 2, 1],
  [0, 0, 0, 1, 1, 1, 2, 1],
  [2, 0, 0, 1, 1, 1, 2, 1],
];

/**
 * `[piece][rotation]` -> four x,y pairs, every orientation expanded once at
 * module load. Rotation at runtime is then an array index rather than four
 * coordinate transforms per collision probe.
 */
const SHAPES: readonly (readonly Int8Array[])[] = SPAWN_CELLS.map((spawn, piece) => {
  const side = BOX[piece];
  const rots: Int8Array[] = [];
  let cur = Int8Array.from(spawn);
  for (let r = 0; r < ROT_COUNT; r++) {
    rots.push(cur);
    const next = new Int8Array(8);
    for (let i = 0; i < 8; i += 2) {
      // Clockwise a quarter turn inside the box.
      next[i] = side - 1 - cur[i + 1];
      next[i + 1] = cur[i];
    }
    cur = next;
  }
  return rots;
});

/** Column the box's left edge spawns at, so every piece enters centred. */
const SPAWN_X = BOX.map((side) => Math.floor((COLS - side) / 2));

/**
 * Wall kicks, tried in order: in place, one then two columns off each wall,
 * then one row up. Enough to turn an I against a wall or out of a hole
 * without the full SRS table, which nobody at a cabinet is reading anyway.
 */
const KICK_X = [0, -1, 1, -2, 2, 0] as const;
const KICK_Y = [0, 0, 0, 0, 0, -1] as const;

/** Index into `SHAPES`, for the few places a specific piece is named. */
const PIECE_T = 2;

/** Cell codes: 0 empty, 1..7 a locked piece, 8 garbage. */
const GARBAGE = PIECE_COUNT + 1;
const CELL_COLOR: readonly Color[] = [
  C.bg,
  C.tetI,
  C.tetO,
  C.tetT,
  C.tetS,
  C.tetZ,
  C.tetJ,
  C.tetL,
  C.textDim,
];

/* --- tuning ------------------------------------------------------------- */

const WINS_NEEDED = 2;
const READY_TIME = 1.6;
const ROUND_OVER_TIME = 1.8;

/** Seconds per row, by level. Unscaled: the pace is not the operator's call. */
const GRAVITY_START = 0.8;
const GRAVITY_STEP = 0.06;
const GRAVITY_MIN = 0.09;
const LINES_PER_LEVEL = 8;
const SOFT_DROP_INTERVAL = 0.035;

/** Grace after landing, and how many moves may renew it before it sticks. */
const LOCK_DELAY = 0.4;
const LOCK_RESETS = 10;

/** The game's own auto-repeat: the shared menu one is too slow to steer with. */
const DAS_DELAY = 0.17;
const DAS_RATE = 0.05;

/** Rows sent under the other well for 1..4 rows cleared at once. */
const GARBAGE_SEND = [0, 0, 1, 2, 4] as const;

const CLEAR_SHOW_TIME = 0.9;

/** A tab-out must not drop a piece the length of the well in one frame. */
const MAX_DT = 0.05;

/* --- strings, built once ------------------------------------------------ */

const CLEAR_TEXT = ["", "SINGLE", "DOUBLE", "TRIPLE", "TETRIS"] as const;
const COUNTDOWN_TEXT = ["0", "1", "2", "3"] as const;
const POINT_TEXT = ["POINT P1", "POINT P2"] as const;
const WIN_TEXT = ["PLAYER 1 WINS", "PLAYER 2 WINS"] as const;
const KEY_HINT = ["WASD", "ARROWS"] as const;
const P_LABEL = ["P1", "P2"] as const;
/** One per round a best-of-`WINS_NEEDED` match can reach. */
const ROUND_TEXT: readonly string[] = Array.from(
  { length: WINS_NEEDED * 2 - 1 },
  (_, i) => `ROUND ${i + 1}`,
);

type Phase = "ready" | "play" | "roundOver" | "matchOver";

/**
 * One player's well and the piece currently falling in it.
 *
 * Every field is a number or a preallocated array; the two text fields are
 * rebuilt only when their number changes, because both are drawn every frame.
 */
class Well {
  readonly cells = new Uint8Array(COLS * ROWS);
  /** 7-bag randomiser: all seven pieces appear before any repeats. */
  readonly bag = new Uint8Array(PIECE_COUNT);
  bagAt = PIECE_COUNT;

  piece = 0;
  rot = 0;
  /** Top-left of the piece's rotation box, in cells. */
  x = 0;
  y = 0;
  /** Row the piece would land on, recomputed whenever it moves. */
  ghostY = 0;
  next = 0;

  alive = true;
  wins = 0;
  lines = 0;
  level = 0;
  /** Garbage rows on their way in, waiting for this piece to lock. */
  pending = 0;

  dropAccum = 0;
  /** Seconds of lock grace left, or < 0 when the piece is not resting. */
  lockTimer = -1;
  lockResets = 0;
  dasTimer = 0;
  dasDir = 0;

  clearKind = 0;
  clearTimer = 0;

  linesText = "0";
  levelText = "1";
}

function refillBag(w: Well): void {
  for (let i = 0; i < PIECE_COUNT; i++) w.bag[i] = i;
  for (let i = PIECE_COUNT - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(k.rand(0, i + 1)));
    const swap = w.bag[i];
    w.bag[i] = w.bag[j];
    w.bag[j] = swap;
  }
  w.bagAt = 0;
}

function drawFromBag(w: Well): number {
  if (w.bagAt >= PIECE_COUNT) refillBag(w);
  return w.bag[w.bagAt++];
}

/** Would this piece overlap a wall, the floor or a settled cell there? */
function collides(w: Well, piece: number, rot: number, ox: number, oy: number): boolean {
  const cells = SHAPES[piece][rot];
  for (let i = 0; i < 8; i += 2) {
    const x = ox + cells[i];
    const y = oy + cells[i + 1];
    if (x < 0 || x >= COLS || y >= ROWS) return true;
    if (y >= 0 && w.cells[y * COLS + x] !== 0) return true;
  }
  return false;
}

function updateGhost(w: Well): void {
  let y = w.y;
  while (!collides(w, w.piece, w.rot, w.x, y + 1)) y++;
  w.ghostY = y;
}

/**
 * Called after a move or a rotation succeeds.
 *
 * Sliding off a ledge cancels the lock outright; shuffling about on the floor
 * renews the grace a bounded number of times, so a piece cannot be held above
 * the stack forever by wiggling it.
 */
function noteMoved(w: Well): void {
  updateGhost(w);
  if (!collides(w, w.piece, w.rot, w.x, w.y + 1)) {
    w.lockTimer = -1;
    return;
  }
  if (w.lockTimer < 0) {
    w.lockTimer = LOCK_DELAY;
  } else if (w.lockResets < LOCK_RESETS) {
    w.lockTimer = LOCK_DELAY;
    w.lockResets++;
  }
}

function tryShift(w: Well, dx: number): boolean {
  if (collides(w, w.piece, w.rot, w.x + dx, w.y)) return false;
  w.x += dx;
  noteMoved(w);
  return true;
}

function tryRotate(w: Well, dir: number): boolean {
  const rot = (w.rot + dir + ROT_COUNT) % ROT_COUNT;
  for (let i = 0; i < KICK_X.length; i++) {
    const x = w.x + KICK_X[i];
    const y = w.y + KICK_Y[i];
    if (collides(w, w.piece, rot, x, y)) continue;
    w.rot = rot;
    w.x = x;
    w.y = y;
    noteMoved(w);
    return true;
  }
  return false;
}

/** One row down, or start the lock clock if there is nowhere to go. */
function tryDrop(w: Well): boolean {
  if (collides(w, w.piece, w.rot, w.x, w.y + 1)) {
    if (w.lockTimer < 0) w.lockTimer = LOCK_DELAY;
    return false;
  }
  w.y++;
  w.lockTimer = -1;
  return true;
}

function spawn(w: Well): void {
  w.piece = w.next;
  w.next = drawFromBag(w);
  w.rot = 0;
  w.x = SPAWN_X[w.piece];
  w.y = 0;
  w.dropAccum = 0;
  w.lockTimer = -1;
  w.lockResets = 0;
  // No room for the piece that is due: that is the loss condition.
  if (collides(w, w.piece, w.rot, w.x, w.y)) {
    w.alive = false;
    return;
  }
  updateGhost(w);
}

/**
 * Remove full rows and drop everything above them, in place.
 * Returns how many went.
 */
function clearLines(w: Well): number {
  let write = ROWS - 1;
  let cleared = 0;
  for (let read = ROWS - 1; read >= 0; read--) {
    let full = true;
    for (let x = 0; x < COLS; x++) {
      if (w.cells[read * COLS + x] === 0) {
        full = false;
        break;
      }
    }
    if (full) {
      cleared++;
      continue;
    }
    if (write !== read) w.cells.copyWithin(write * COLS, read * COLS, read * COLS + COLS);
    write--;
  }
  for (let y = write; y >= 0; y--) w.cells.fill(0, y * COLS, y * COLS + COLS);
  return cleared;
}

/**
 * Push the waiting garbage in under the stack, one hole column for the whole
 * batch so a big attack can be answered with one well-placed piece.
 */
function takeGarbage(w: Well): void {
  const rows = Math.min(w.pending, ROWS);
  w.pending = 0;
  if (rows <= 0) return;
  // Whatever is in the rows about to be pushed off the top has nowhere to go.
  for (let i = 0; i < rows * COLS; i++) {
    if (w.cells[i] !== 0) {
      w.alive = false;
      return;
    }
  }
  w.cells.copyWithin(0, rows * COLS);
  const hole = Math.min(COLS - 1, Math.floor(k.rand(0, COLS)));
  for (let i = 0; i < rows; i++) {
    const row = (ROWS - 1 - i) * COLS;
    w.cells.fill(GARBAGE, row, row + COLS);
    w.cells[row + hole] = 0;
  }
}

function gravityOf(w: Well): number {
  return Math.max(GRAVITY_MIN, GRAVITY_START - w.level * GRAVITY_STEP);
}

/**
 * The next piece, centred on `centerX` and on a two-cell-tall band from `top`
 * — every spawn orientation is at most two rows deep.
 */
function drawNextPiece(piece: number, centerX: number, top: number, cell: number): void {
  const cells = SHAPES[piece][0];
  let minX = 9;
  let maxX = -9;
  let minY = 9;
  let maxY = -9;
  for (let i = 0; i < 8; i += 2) {
    if (cells[i] < minX) minX = cells[i];
    if (cells[i] > maxX) maxX = cells[i];
    if (cells[i + 1] < minY) minY = cells[i + 1];
    if (cells[i + 1] > maxY) maxY = cells[i + 1];
  }
  const originX = centerX - ((maxX - minX + 1) * cell) / 2 - minX * cell;
  const originY = top + ((2 - (maxY - minY + 1)) * cell) / 2 - minY * cell;
  const color = CELL_COLOR[piece + 1];
  for (let i = 0; i < 8; i += 2) {
    drawBox({
      x: originX + cells[i] * cell,
      y: originY + cells[i + 1] * cell,
      w: cell - 1,
      h: cell - 1,
      color,
    });
  }
}

function main(): void {
  installQuitToMenu();

  // Read once at scene entry. Nothing here is grid geometry, but a size that
  // changed under a match in progress would still be wrong.
  const nextCell = scaleUnits(NEXT_CELL_BASE);
  const countdownSize = scaleUnits(FONT_HUGE);
  const clearSize = scaleUnits(FONT_BODY);
  const verdictSize = scaleUnits(FONT_TITLE);
  /** Below the next-piece band, which is two cells tall. */
  const statsY = WELL_TOP + 15 + nextCell * 2 + 8;

  const wells: readonly Well[] = [new Well(), new Well()];

  let phase: Phase = "ready";
  let phaseTimer = READY_TIME;
  let roundWinner = -1;
  let matchWinner = -1;

  function startRound(): void {
    for (let p = 0; p < MAX_PLAYERS; p++) {
      const w = wells[p];
      w.cells.fill(0);
      w.bagAt = PIECE_COUNT;
      w.alive = true;
      w.lines = 0;
      w.level = 0;
      w.pending = 0;
      w.dasDir = 0;
      w.dasTimer = 0;
      w.clearKind = 0;
      w.clearTimer = 0;
      w.linesText = "0";
      w.levelText = "1";
      w.next = drawFromBag(w);
      spawn(w);
    }
    roundWinner = -1;
    phase = "ready";
    phaseTimer = READY_TIME;
  }

  function startMatch(): void {
    for (let p = 0; p < MAX_PLAYERS; p++) wells[p].wins = 0;
    matchWinner = -1;
    startRound();
  }

  function endRound(): void {
    const out0 = !wells[0].alive;
    const out1 = !wells[1].alive;
    roundWinner = out0 && out1 ? -1 : out0 ? 1 : 0;
    if (roundWinner >= 0) wells[roundWinner].wins++;
    k.shake(pu(3));

    if (wells[0].wins >= WINS_NEEDED || wells[1].wins >= WINS_NEEDED) {
      matchWinner = wells[0].wins > wells[1].wins ? 0 : 1;
      phase = "matchOver";
    } else {
      phase = "roundOver";
      phaseTimer = ROUND_OVER_TIME;
    }
  }

  function lockPiece(w: Well, other: Well): void {
    const cells = SHAPES[w.piece][w.rot];
    const code = w.piece + 1;
    for (let i = 0; i < 8; i += 2) {
      const y = w.y + cells[i + 1];
      if (y >= 0) w.cells[y * COLS + w.x + cells[i]] = code;
    }

    const cleared = clearLines(w);
    if (cleared > 0) {
      w.lines += cleared;
      w.linesText = String(w.lines);
      const level = Math.floor(w.lines / LINES_PER_LEVEL);
      if (level !== w.level) {
        w.level = level;
        w.levelText = String(level + 1);
      }
      w.clearKind = cleared;
      w.clearTimer = CLEAR_SHOW_TIME;

      // Outgoing rows cancel incoming ones before they land, so a player
      // under attack can trade instead of only digging.
      let send = GARBAGE_SEND[cleared];
      const cancelled = Math.min(send, w.pending);
      w.pending -= cancelled;
      send -= cancelled;
      if (send > 0) other.pending += send;
      if (cleared >= 4) k.shake(pu(2));
    }

    takeGarbage(w);
    if (w.alive) spawn(w);
  }

  function stepPlayer(p: number, dt: number): void {
    const w = wells[p];
    if (!w.alive) return;
    const other = wells[1 - p];

    // --- sideways, on this game's own auto-repeat ---
    const left = input.down(p, "left");
    const right = input.down(p, "right");
    const dir = left === right ? 0 : left ? -1 : 1;
    if (dir !== w.dasDir) {
      w.dasDir = dir;
      w.dasTimer = DAS_DELAY;
      if (dir !== 0) tryShift(w, dir);
    } else if (dir !== 0) {
      w.dasTimer -= dt;
      while (w.dasTimer <= 0) {
        w.dasTimer += DAS_RATE;
        // Against a wall, stop repeating rather than spinning the loop.
        if (!tryShift(w, dir)) {
          w.dasTimer = DAS_RATE;
          break;
        }
      }
    }

    if (input.pressed(p, "a")) tryRotate(w, 1);
    if (input.pressed(p, "b")) tryRotate(w, -1);

    if (input.pressed(p, "x") || input.pressed(p, "up")) {
      while (tryDrop(w)) {
        // straight to the floor
      }
      lockPiece(w, other);
      return;
    }

    const gravity = gravityOf(w);
    const interval = input.down(p, "down") ? Math.min(gravity, SOFT_DROP_INTERVAL) : gravity;
    w.dropAccum += dt;
    let steps = 0;
    while (w.dropAccum >= interval && steps++ < 24) {
      w.dropAccum -= interval;
      if (!tryDrop(w)) {
        // Resting: hold the clock at zero so the grace period is not spent
        // the instant a sideways move opens a gap underneath.
        w.dropAccum = 0;
        break;
      }
    }

    if (w.lockTimer >= 0) {
      w.lockTimer -= dt;
      if (w.lockTimer <= 0) lockPiece(w, other);
    }
  }

  startMatch();

  k.onUpdate(() => {
    const dt = Math.min(MAX_DT, k.dt());

    for (let p = 0; p < MAX_PLAYERS; p++) {
      const w = wells[p];
      if (w.clearTimer > 0) w.clearTimer -= dt;
    }

    if (phase === "ready") {
      phaseTimer -= dt;
      if (phaseTimer <= 0) phase = "play";
    } else if (phase === "play") {
      for (let p = 0; p < MAX_PLAYERS; p++) stepPlayer(p, dt);
      if (!wells[0].alive || !wells[1].alive) endRound();
    } else if (phase === "roundOver") {
      phaseTimer -= dt;
      if (phaseTimer <= 0) startRound();
    } else if (input.anyPressed("a") || input.anyPressed("start")) {
      startMatch();
    }
  });

  function drawWell(p: number): void {
    const w = wells[p];
    const wellX = WELL_X[p];
    const accent = playerColor(p);
    const faded = w.alive ? 1 : 0.35;

    drawPanel({ x: wellX, y: WELL_TOP, w: WELL_W, h: WELL_H, fill: C.bgAlt, outline: accent });
    // Column guides: without them a gap ten columns away cannot be lined up.
    for (let c = 1; c < COLS; c++) {
      drawBox({ x: wellX + c * CELL, y: WELL_TOP, w: 1, h: WELL_H, color: C.bg });
    }

    for (let i = 0; i < w.cells.length; i++) {
      const code = w.cells[i];
      if (code === 0) continue;
      drawBox({
        x: wellX + (i % COLS) * CELL,
        y: WELL_TOP + Math.floor(i / COLS) * CELL,
        w: CELL - 1,
        h: CELL - 1,
        color: CELL_COLOR[code],
        opacity: faded,
      });
    }

    if (w.alive && phase !== "matchOver") {
      const cells = SHAPES[w.piece][w.rot];
      const color = CELL_COLOR[w.piece + 1];
      // Landing outline first, so a piece sitting on its own target hides it.
      if (w.ghostY > w.y) {
        for (let i = 0; i < 8; i += 2) {
          drawBox({
            x: wellX + (w.x + cells[i]) * CELL,
            y: WELL_TOP + (w.ghostY + cells[i + 1]) * CELL,
            w: CELL - 1,
            h: CELL - 1,
            color: C.bgAlt,
            outline: color,
          });
        }
      }
      for (let i = 0; i < 8; i += 2) {
        const y = w.y + cells[i + 1];
        if (y < 0) continue;
        drawBox({
          x: wellX + (w.x + cells[i]) * CELL,
          y: WELL_TOP + y * CELL,
          w: CELL - 1,
          h: CELL - 1,
          color,
        });
      }
    }

    // Incoming garbage: one block of meter per row on its way in.
    const meterX = METER_X[p];
    drawPanel({ x: meterX, y: WELL_TOP, w: METER_W, h: WELL_H, fill: C.bg, outline: C.dim });
    if (w.pending > 0) {
      const h = Math.min(ROWS, w.pending) * CELL;
      drawBox({ x: meterX + 1, y: WELL_BOTTOM - h, w: METER_W - 2, h, color: C.bad });
    }

    // Side panel, mirrored outward so both read from the screen edge in.
    const panelX = PANEL_X[p];
    const textX = p === 0 ? panelX + 1 : panelX + PANEL_W - 1;
    const anchor = p === 0 ? "left" : "right";

    drawLabel({ text: "NEXT", x: textX, y: WELL_TOP + 2, size: FONT_SMALL, color: C.textDim, anchor });
    drawNextPiece(w.next, panelX + PANEL_W / 2, WELL_TOP + 15, nextCell);

    drawLabel({ text: "LINES", x: textX, y: statsY, size: FONT_SMALL, color: C.textDim, anchor });
    drawLabel({ text: w.linesText, x: textX, y: statsY + 11, size: FONT_BODY, color: C.text, anchor });
    drawLabel({ text: "LEVEL", x: textX, y: statsY + 27, size: FONT_SMALL, color: C.textDim, anchor });
    drawLabel({
      text: w.levelText,
      x: textX,
      y: statsY + 38,
      size: FONT_BODY,
      color: C.text,
      anchor,
    });

    if (!input.padConnected(p)) {
      drawLabel({
        text: KEY_HINT[p],
        x: textX,
        y: WELL_BOTTOM - FONT_SMALL,
        size: FONT_SMALL,
        color: C.textDim,
        anchor,
      });
    }

    if (w.clearTimer > 0) {
      drawLabel({
        text: CLEAR_TEXT[w.clearKind],
        x: wellX + WELL_W / 2,
        y: WELL_TOP + 56,
        size: clearSize,
        color: C.accent,
        anchor: "center",
        opacity: Math.min(1, w.clearTimer / (CLEAR_SHOW_TIME * 0.5)),
      });
    }
  }

  k.onDraw(() => {
    drawRule(HEADER_H - 1);
    drawBox({ x: CENTER_X, y: HEADER_H, w: 1, h: DESIGN_HEIGHT - HEADER_H, color: C.dim });

    for (let p = 0; p < MAX_PLAYERS; p++) {
      drawWell(p);

      drawLabel({
        text: P_LABEL[p],
        x: p === 0 ? 4 : DESIGN_WIDTH - 4,
        y: 4,
        size: FONT_SMALL,
        color: playerColor(p),
        anchor: p === 0 ? "left" : "right",
      });
      for (let i = 0; i < WINS_NEEDED; i++) {
        drawBox({
          x: PIP_X[p] + (p === 0 ? i : -i) * PIP_STRIDE,
          y: 4,
          w: PIP_SIZE,
          h: PIP_SIZE,
          color: i < wells[p].wins ? playerColor(p) : C.bgAlt,
          outline: C.dim,
        });
      }
    }

    if (phase !== "matchOver") {
      drawLabel({
        text: ROUND_TEXT[Math.min(ROUND_TEXT.length - 1, wells[0].wins + wells[1].wins)],
        x: CENTER_X,
        y: 4,
        size: FONT_SMALL,
        color: C.textDim,
        anchor: "center",
      });
    }

    if (phase === "ready") {
      drawLabel({
        text: COUNTDOWN_TEXT[Math.max(0, Math.min(COUNTDOWN_TEXT.length - 1, Math.ceil(phaseTimer)))],
        x: CENTER_X,
        y: CENTER_Y - countdownSize / 2,
        size: countdownSize,
        color: C.text,
        anchor: "center",
      });
    }

    if (phase === "roundOver") {
      drawLabel({
        text: roundWinner < 0 ? "DRAW" : POINT_TEXT[roundWinner],
        x: CENTER_X,
        y: CENTER_Y - verdictSize / 2,
        size: verdictSize,
        color: roundWinner < 0 ? C.text : playerColor(roundWinner),
        anchor: "center",
      });
    }

    if (phase === "matchOver" && matchWinner >= 0) {
      drawBox({
        x: 0,
        y: HEADER_H,
        w: DESIGN_WIDTH,
        h: DESIGN_HEIGHT - HEADER_H,
        color: C.black,
        opacity: 0.72,
      });
      drawLabel({
        text: WIN_TEXT[matchWinner],
        x: CENTER_X,
        y: CENTER_Y - 22,
        size: FONT_TITLE,
        color: playerColor(matchWinner),
        anchor: "center",
      });
      drawHints({
        x: CENTER_X + 42,
        y: CENTER_Y + 4,
        align: "right",
        hints: [{ button: "a" }, { button: "start" }, { text: "REMATCH" }],
        color: C.text,
      });
      drawLabel({
        text: "HOLD BACK  MENU",
        x: CENTER_X,
        y: CENTER_Y + 18,
        size: FONT_SMALL,
        color: C.textDim,
        anchor: "center",
      });
    }
  });
}

/* --- menu preview ------------------------------------------------------- */

/** A settled stack for the thumbnail: column heights, then a colour each. */
const PREVIEW_STACK = [4, 2, 5, 3, 1, 2, 4, 3, 2, 5] as const;
const PREVIEW_CODES = [3, 6, 1, 7, 4, 2, 5, 3, 6, 1] as const;
const PREVIEW_ROWS = 11;

/**
 * Menu preview: both wells, because the split screen is the game. Everything
 * is sized from the box, so it reads the same as a thumbnail and full-bleed.
 */
function drawPreview(x: number, y: number, w: number, h: number, t: number): void {
  // Two wells and a divider column have to fit across the box, whatever shape
  // the menu hands over.
  const cell = Math.min(h / PREVIEW_ROWS, w / (COLS * 2 + 3));
  const wellW = COLS * cell;
  const wellH = PREVIEW_ROWS * cell;
  const originX = x + (w - (wellW * 2 + cell)) / 2;
  const originY = y + (h - wellH) / 2;
  const gap = Math.max(0.5, cell * 0.1);

  drawBox({
    x: x + w / 2 - gap / 2,
    y: originY,
    w: Math.max(0.5, gap),
    h: wellH,
    color: C.dim,
  });

  for (let side = 0; side < 2; side++) {
    const wellX = originX + side * (wellW + cell);
    drawBox({ x: wellX, y: originY, w: wellW, h: wellH, color: C.bgAlt });

    for (let col = 0; col < COLS; col++) {
      // The far well mirrored, so the two stacks are not the same picture.
      const height = PREVIEW_STACK[side === 0 ? col : COLS - 1 - col];
      for (let i = 0; i < height; i++) {
        drawBox({
          x: wellX + col * cell,
          y: originY + (PREVIEW_ROWS - 1 - i) * cell,
          w: cell - gap,
          h: cell - gap,
          color: CELL_COLOR[PREVIEW_CODES[(col + i + side * 3) % COLS]],
        });
      }
    }

    // One piece per well per cycle, turning as it falls.
    const phase = t / 2.6 + side * 0.45;
    const cycle = Math.floor(phase);
    const piece = (cycle * 3 + side * 2) % PIECE_COUNT;
    const shape = SHAPES[piece][cycle % ROT_COUNT];
    const row = Math.floor((phase % 1) * (PREVIEW_ROWS - 6));
    const color = CELL_COLOR[piece + 1];
    for (let i = 0; i < 8; i += 2) {
      drawBox({
        x: wellX + (3 + shape[i]) * cell,
        y: originY + (row + shape[i + 1]) * cell,
        w: cell - gap,
        h: cell - gap,
        color,
      });
    }
  }
}

/* --- options-screen sample ---------------------------------------------- */

let captionCell = -1;
let caption = "";

/** Cached: the options screen draws this every frame and must not allocate. */
function sampleCaption(cell: number): string {
  if (cell !== captionCell) {
    captionCell = cell;
    caption = `NEXT ${cell}`;
  }
  return caption;
}

/**
 * Options-screen sample: the next-piece preview and the round countdown, the
 * two things here that follow the setting. The caption carries the well's own
 * cell beside them, because that one is fixed and the difference is the point.
 */
function drawScaleSample(x: number, y: number, w: number, h: number): void {
  const cell = scaleUnits(NEXT_CELL_BASE);
  const countdownSize = scaleUnits(FONT_HUGE);

  // Two caption lines: with a panel per game the box is too narrow for one.
  const captionY = y + h - FONT_SMALL * 2 - 2;
  const midY = (y + captionY) / 2;
  const leftW = w * 0.5;

  drawNextPiece(PIECE_T, x + leftW / 2, midY - cell, cell);
  drawLabel({
    text: "3",
    x: x + leftW + (w - leftW) / 2,
    y: midY - countdownSize / 2,
    size: countdownSize,
    color: C.text,
    anchor: "center",
  });
  drawLabel({
    text: sampleCaption(cell),
    x: x + w / 2,
    y: captionY,
    size: FONT_SMALL,
    color: C.textDim,
    anchor: "center",
  });
  // The well's own cell, beside it, because that one does not move.
  drawLabel({
    text: `WELL CELL ${CELL}`,
    x: x + w / 2,
    y: captionY + FONT_SMALL + 2,
    size: FONT_SMALL,
    color: C.textDim,
    anchor: "center",
  });
}

export const tetrisDuelGame: GameDefinition = {
  id: SCENE,
  title: "TETRIS DUEL",
  tagline: "Best of 3. Clear rows, bury them in junk.",
  players: "2P VERSUS",
  accent: "tetT",
  controls: [
    { buttons: ["left", "right"], label: "MOVE" },
    { buttons: ["down"], label: "SOFT DROP" },
    { buttons: ["up", "x"], label: "HARD DROP" },
    { buttons: ["a"], label: "ROTATE" },
    { buttons: ["b"], label: "ROTATE BACK" },
    { buttons: ["a", "start"], label: "REMATCH" },
  ],
  drawPreview,
  drawScaleSample,
  register(): void {
    defineScene(SCENE, main);
  },
};

import type { Color } from "kaplay";
import { DESIGN_HEIGHT, DESIGN_WIDTH, MAX_PLAYERS } from "../core/config";
import type { GameDefinition } from "../core/game";
import { input } from "../core/input";
import { k } from "../core/k";
import { drawHints } from "../core/prompts";
import { installQuitToMenu } from "../core/quit";
import { defineScene } from "../core/scene";
import { gameScale, GAME_SCALE_MIN, scaleUnits } from "../core/settings";
import { pu } from "../core/viewport";
import {
  C,
  CENTER_X,
  drawBox,
  drawLabel,
  drawRule,
  FONT_HUGE,
  FONT_SMALL,
  FONT_TITLE,
  playerColor,
} from "../core/ui";

/**
 * Snake Duel. A fixed-timestep grid game, so it plays identically on a 60Hz
 * and a 144Hz screen.
 *
 * Deliberately built *without* game objects: a snake at full length would be
 * ~1000 objects, each with components and event lists, created and destroyed
 * every round. Instead the state is preallocated typed arrays and the whole
 * board is painted in one `onDraw`. Object count stays at 2 for the entire
 * session no matter how long it runs.
 *
 * The cell is a *baseline*: the board is laid out at `scaleUnits(CELL_BASE)`,
 * so raising the game scale trades board area for chunkier cells — 40x28 at
 * 1x, 20x14 at 2x (see `core/settings.ts`). The tick rate does not scale with
 * it: a grid game's feel is cells per second, not units per second, so the
 * reaction time per cell stays put and a coarser board just means shorter
 * rounds. `CAP` is sized for the *finest* board, so the ring buffers are one
 * allocation that fits every scale.
 */

const SCENE = "snake-duel";

const CELL_BASE = 8;
const HEADER_H = 16;
/** Height available to the board, below the header rule. */
const BOARD_H = DESIGN_HEIGHT - HEADER_H;
/**
 * Ring-buffer capacity: the cell count of the *finest* board any scale can
 * ask for, so one allocation per snake covers every scale. Only the first
 * `cols * rows` entries are in play at a given scale.
 */
const FINEST_CELL = Math.max(1, Math.round(CELL_BASE * GAME_SCALE_MIN));
const CAP = Math.floor(DESIGN_WIDTH / FINEST_CELL) * Math.floor(BOARD_H / FINEST_CELL);

/**
 * Board dimensions for a cell size. Shared with the options-screen sample —
 * two functions rather than one returning a pair, because the sample runs in
 * `onDraw` and that object would be an allocation per frame.
 */
function boardCols(cellSize: number): number {
  return Math.floor(DESIGN_WIDTH / cellSize);
}

function boardRows(cellSize: number): number {
  return Math.floor(BOARD_H / cellSize);
}

const START_LENGTH = 4;
const GROW_PER_PELLET = 3;
const PELLET_COUNT = 3;
const TICK_START = 0.145;
const TICK_MIN = 0.075;
const TICK_GAIN = 0.0035;
const WINS_NEEDED = 3;
const READY_TIME = 1.3;
const ROUND_OVER_TIME = 1.6;

/** up, right, down, left */
const DIR_X = [0, 1, 0, -1] as const;
const DIR_Y = [-1, 0, 1, 0] as const;
const DIR_UP = 0;
const DIR_RIGHT = 1;
const DIR_LEFT = 3;

/** Occupancy codes. */
const EMPTY = 0;

type Phase = "ready" | "play" | "roundOver" | "matchOver";

class Snake {
  /** Ring buffer of packed cell indices, tail at `start`, head at `start+len-1`. */
  readonly cells = new Int16Array(CAP);
  start = 0;
  len = 0;
  dir = DIR_RIGHT;
  grow = 0;
  alive = true;
  wins = 0;
  pellets = 0;
  /** Buffered turns, so a quick two-tap corner isn't swallowed by the tick. */
  readonly queue = new Int8Array(2);
  qLen = 0;

  head(): number {
    return this.cells[(this.start + this.len - 1) % CAP];
  }

  pushHead(cell: number): void {
    this.cells[(this.start + this.len) % CAP] = cell;
    this.len++;
  }

  popTail(): number {
    const cell = this.cells[this.start];
    this.start = (this.start + 1) % CAP;
    this.len--;
    return cell;
  }

  enqueue(dir: number): void {
    if (this.qLen >= this.queue.length) return;
    // Ignore a turn that would reverse into the neck, and repeated inputs.
    const last = this.qLen > 0 ? this.queue[this.qLen - 1] : this.dir;
    if (dir === last) return;
    if ((dir + 2) % 4 === last) return;
    this.queue[this.qLen++] = dir;
  }

  dequeue(): void {
    if (this.qLen === 0) return;
    this.dir = this.queue[0];
    this.queue[0] = this.queue[1];
    this.qLen--;
  }

  reset(): void {
    this.start = 0;
    this.len = 0;
    this.grow = 0;
    this.alive = true;
    this.pellets = 0;
    this.qLen = 0;
  }
}

function main(): void {
  installQuitToMenu();

  // Board geometry, read once per scene entry: the grid dimensions are baked
  // into every cell index in play, so this cannot change mid-match.
  const cellSize = scaleUnits(CELL_BASE);
  const cols = boardCols(cellSize);
  const rows = boardRows(cellSize);
  /** Cells actually in play. `CAP` is the allocation; this is the board. */
  const cellCount = cols * rows;
  // Centred, so a cell size that doesn't divide the box leaves an even margin
  // rather than a bare strip down one edge.
  const boardX = Math.floor((DESIGN_WIDTH - cols * cellSize) / 2);
  const boardY = HEADER_H + Math.floor((BOARD_H - rows * cellSize) / 2);
  /** Where the countdown and the round verdict sit, centred on the board. */
  const boardMidY = boardY + (rows * cellSize) / 2;

  /** Gap between body segments; scaled, or it vanishes on a 16-unit cell. */
  const bodyInset = scaleUnits(1);
  const pelletBase = scaleUnits(5);
  const pelletPulseAmp = gameScale() * 0.5;
  const countdownSize = scaleUnits(FONT_HUGE);
  const verdictSize = scaleUnits(FONT_TITLE);

  const occupancy = new Uint8Array(CAP);
  const pellets = new Uint8Array(CAP);
  const snakes: readonly Snake[] = [new Snake(), new Snake()];

  const bodyColor: readonly Color[] = [playerColor(0), playerColor(1)];
  // Precomputed once — Color.lerp allocates, so never do this in draw.
  const headColor: readonly Color[] = [
    playerColor(0).lerp(C.white, 0.55),
    playerColor(1).lerp(C.white, 0.55),
  ];

  let phase: Phase = "ready";
  let phaseTimer = READY_TIME;
  let tickInterval = TICK_START;
  let tickAccum = 0;
  let roundWinner = -1;
  let matchWinner = -1;
  let pelletPulse = 0;

  function cellOf(x: number, y: number): number {
    return y * cols + x;
  }

  function spawnPellet(): void {
    // Random probing is fine while the board is mostly empty; the linear scan
    // is the bounded fallback for a nearly full board.
    for (let attempt = 0; attempt < 100; attempt++) {
      const cell = Math.floor(k.rand(0, cellCount));
      if (occupancy[cell] === EMPTY && pellets[cell] === 0) {
        pellets[cell] = 1;
        return;
      }
    }
    for (let cell = 0; cell < cellCount; cell++) {
      if (occupancy[cell] === EMPTY && pellets[cell] === 0) {
        pellets[cell] = 1;
        return;
      }
    }
  }

  function startRound(): void {
    occupancy.fill(EMPTY);
    pellets.fill(0);
    tickInterval = TICK_START;
    tickAccum = 0;
    roundWinner = -1;

    const row = Math.floor(rows / 2);
    for (let p = 0; p < MAX_PLAYERS; p++) {
      const snake = snakes[p];
      snake.reset();
      const headCol = p === 0 ? START_LENGTH + 1 : cols - START_LENGTH - 2;
      const step = p === 0 ? -1 : 1;
      snake.dir = p === 0 ? DIR_RIGHT : DIR_LEFT;
      // Lay the body down tail-first so the ring buffer order is correct.
      for (let i = START_LENGTH - 1; i >= 0; i--) {
        const cell = cellOf(headCol + step * i, row);
        snake.pushHead(cell);
        occupancy[cell] = p + 1;
      }
    }

    for (let i = 0; i < PELLET_COUNT; i++) spawnPellet();

    phase = "ready";
    phaseTimer = READY_TIME;
  }

  function startMatch(): void {
    for (let p = 0; p < MAX_PLAYERS; p++) snakes[p].wins = 0;
    matchWinner = -1;
    startRound();
  }

  function tick(): void {
    // 1. Apply one buffered turn per snake.
    for (let p = 0; p < MAX_PLAYERS; p++) snakes[p].dequeue();

    // 2. Work out where each head is going before anything moves, so a
    //    head-on collision kills both instead of depending on iteration order.
    const targets = [-1, -1];
    const dead = [false, false];
    for (let p = 0; p < MAX_PLAYERS; p++) {
      const snake = snakes[p];
      const head = snake.head();
      const hx = (head % cols) + DIR_X[snake.dir];
      const hy = Math.floor(head / cols) + DIR_Y[snake.dir];
      if (hx < 0 || hx >= cols || hy < 0 || hy >= rows) {
        dead[p] = true;
      } else {
        targets[p] = cellOf(hx, hy);
      }
    }

    // 3. Free the tails first: chasing your own tail is legal.
    const freedTails = [-1, -1];
    for (let p = 0; p < MAX_PLAYERS; p++) {
      const snake = snakes[p];
      if (snake.grow > 0) {
        snake.grow--;
      } else {
        freedTails[p] = snake.popTail();
        occupancy[freedTails[p]] = EMPTY;
      }
    }

    // 4. Resolve collisions.
    for (let p = 0; p < MAX_PLAYERS; p++) {
      if (dead[p]) continue;
      if (occupancy[targets[p]] !== EMPTY) dead[p] = true;
    }
    if (targets[0] >= 0 && targets[0] === targets[1]) {
      dead[0] = true;
      dead[1] = true;
    }

    // 5. Commit moves for whoever survived.
    for (let p = 0; p < MAX_PLAYERS; p++) {
      const snake = snakes[p];
      if (dead[p]) {
        snake.alive = false;
        // Put the tail back so the corpse is drawn at full length.
        if (freedTails[p] >= 0) {
          snake.start = (snake.start - 1 + CAP) % CAP;
          snake.len++;
          occupancy[freedTails[p]] = p + 1;
        }
        continue;
      }
      const cell = targets[p];
      snake.pushHead(cell);
      occupancy[cell] = p + 1;
      if (pellets[cell] === 1) {
        pellets[cell] = 0;
        snake.grow += GROW_PER_PELLET;
        snake.pellets++;
        tickInterval = Math.max(TICK_MIN, tickInterval - TICK_GAIN);
        spawnPellet();
      }
    }

    // 6. Round bookkeeping.
    if (dead[0] || dead[1]) {
      if (dead[0] && dead[1]) roundWinner = -1;
      else roundWinner = dead[0] ? 1 : 0;
      if (roundWinner >= 0) snakes[roundWinner].wins++;

      if (snakes[0].wins >= WINS_NEEDED || snakes[1].wins >= WINS_NEEDED) {
        matchWinner = snakes[0].wins > snakes[1].wins ? 0 : 1;
        phase = "matchOver";
      } else {
        phase = "roundOver";
        phaseTimer = ROUND_OVER_TIME;
      }
      k.shake(pu(2.5));
    }
  }

  startMatch();

  k.onUpdate(() => {
    const dt = k.dt();
    pelletPulse += dt;

    // Read turns every frame, not every tick, so nothing is dropped.
    for (let p = 0; p < MAX_PLAYERS; p++) {
      const snake = snakes[p];
      if (!snake.alive) continue;
      if (input.pressed(p, "up")) snake.enqueue(DIR_UP);
      else if (input.pressed(p, "right")) snake.enqueue(DIR_RIGHT);
      else if (input.pressed(p, "down")) snake.enqueue(2);
      else if (input.pressed(p, "left")) snake.enqueue(DIR_LEFT);
    }

    if (phase === "ready") {
      phaseTimer -= dt;
      // Let players pre-buffer a turn during the countdown, then go.
      if (phaseTimer <= 0) {
        phase = "play";
        tickAccum = 0;
      }
    } else if (phase === "play") {
      tickAccum += dt;
      // Bounded catch-up: after a tab-out, skip ahead rather than running
      // hundreds of ticks in one frame.
      let steps = 0;
      while (tickAccum >= tickInterval && phase === "play" && steps++ < 4) {
        tickAccum -= tickInterval;
        tick();
      }
      if (tickAccum > tickInterval * 4) tickAccum = 0;
    } else if (phase === "roundOver") {
      phaseTimer -= dt;
      if (phaseTimer <= 0) startRound();
    } else if (input.anyPressed("a") || input.anyPressed("start")) {
      startMatch();
    }
  });

  k.onDraw(() => {
    // Board frame.
    drawRule(HEADER_H - 1);

    // Pellets, gently pulsing.
    const pelletSize = pelletBase + Math.sin(pelletPulse * 6) * pelletPulseAmp;
    const pelletOff = (cellSize - pelletSize) / 2;
    for (let cell = 0; cell < cellCount; cell++) {
      if (pellets[cell] === 0) continue;
      drawBox({
        x: boardX + (cell % cols) * cellSize + pelletOff,
        y: boardY + Math.floor(cell / cols) * cellSize + pelletOff,
        w: pelletSize,
        h: pelletSize,
        color: C.accent,
      });
    }

    // Snakes: body then head, straight out of the ring buffers.
    for (let p = 0; p < MAX_PLAYERS; p++) {
      const snake = snakes[p];
      const faded = snake.alive ? 1 : 0.4;
      for (let i = 0; i < snake.len; i++) {
        const cell = snake.cells[(snake.start + i) % CAP];
        const isHead = i === snake.len - 1;
        const inset = isHead ? 0 : bodyInset;
        drawBox({
          x: boardX + (cell % cols) * cellSize + inset,
          y: boardY + Math.floor(cell / cols) * cellSize + inset,
          w: cellSize - inset * 2,
          h: cellSize - inset * 2,
          color: isHead ? headColor[p] : bodyColor[p],
          opacity: faded,
        });
      }
    }

    // Header: round wins and length per player.
    for (let p = 0; p < MAX_PLAYERS; p++) {
      const snake = snakes[p];
      const x = p === 0 ? 4 : DESIGN_WIDTH - 4;
      const anchor = p === 0 ? "left" : "right";
      drawLabel({
        text: `P${p + 1}  ${"#".repeat(snake.wins).padEnd(WINS_NEEDED, ".")}  ${snake.len}`,
        x,
        y: 4,
        size: FONT_SMALL,
        color: playerColor(p),
        anchor,
      });
    }

    if (phase === "ready") {
      drawLabel({
        text: `ROUND ${snakes[0].wins + snakes[1].wins + 1}`,
        x: CENTER_X,
        y: 4,
        size: FONT_SMALL,
        color: C.textDim,
        anchor: "center",
      });
      drawLabel({
        text: Math.ceil(phaseTimer).toString(),
        x: CENTER_X,
        y: boardMidY - countdownSize / 2,
        size: countdownSize,
        color: C.text,
        anchor: "center",
      });
    }

    if (phase === "roundOver") {
      drawLabel({
        text: roundWinner < 0 ? "DRAW" : `POINT P${roundWinner + 1}`,
        x: CENTER_X,
        y: boardMidY - verdictSize / 2,
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
        text: `PLAYER ${matchWinner + 1} WINS`,
        x: CENTER_X,
        y: DESIGN_HEIGHT / 2 - 22,
        size: FONT_TITLE,
        color: playerColor(matchWinner),
        anchor: "center",
      });
      drawHints({
        x: CENTER_X + 42,
        y: DESIGN_HEIGHT / 2 + 6 - 2,
        align: "right",
        hints: [{ button: "a" }, { button: "start" }, { text: "REMATCH" }],
        color: C.text,
      });
      drawLabel({
        text: "HOLD BACK  MENU",
        x: CENTER_X,
        y: DESIGN_HEIGHT / 2 + 18,
        size: FONT_SMALL,
        color: C.textDim,
        anchor: "center",
      });
    }
  });
}

/**
 * Menu preview: two snakes crawling toward each other on a grid derived from
 * the box, so the cells stay chunky whether the card is a thumbnail or
 * full-bleed.
 */
function drawPreview(x: number, y: number, w: number, h: number, t: number): void {
  const cell = Math.max(3, h / 9);
  const cols = Math.max(6, Math.floor(w / cell));
  const rows = Math.max(3, Math.floor(h / cell));
  const originX = x + (w - cols * cell) / 2;
  const originY = y + (h - rows * cell) / 2;
  const gap = Math.max(0.5, cell * 0.12);
  const bodyLength = Math.max(4, Math.floor(cols * 0.28));

  const rowTop = Math.floor(rows * 0.3);
  const rowBottom = Math.floor(rows * 0.68);
  const head = Math.floor(t * 7) % cols;

  const drawCell = (col: number, row: number, color: Color) => {
    drawBox({
      x: originX + col * cell + gap,
      y: originY + row * cell + gap,
      w: cell - gap * 2,
      h: cell - gap * 2,
      color,
    });
  };

  for (let i = 0; i < bodyLength; i++) {
    const fade = i === 0 ? C.white : undefined;
    drawCell(((head - i) % cols + cols) % cols, rowTop, fade ?? C.p1);
    drawCell(((cols - 1 - head + i) % cols + cols) % cols, rowBottom, fade ?? C.p2);
  }

  // A pellet just ahead of each snake.
  drawCell((head + 3) % cols, rowTop, C.accent);
  drawCell(((cols - 4 - head) % cols + cols) % cols, rowBottom, C.accent);
}

/**
 * Options-screen sample: a patch of board at the real cell size, next to the
 * countdown numeral at the size the round will start with.
 */
function drawScaleSample(x: number, y: number, w: number, h: number): void {
  const cellSize = scaleUnits(CELL_BASE);
  const inset = scaleUnits(1);
  const countdownSize = scaleUnits(FONT_HUGE);

  const captionY = y + h - FONT_SMALL;
  // Left: as much of a real board as the box holds. Right: the countdown.
  const gridW = Math.max(cellSize, w * 0.55);
  const sampleCols = Math.max(1, Math.floor(gridW / cellSize));
  const sampleRows = Math.max(1, Math.floor((captionY - y - 4) / cellSize));
  const gridX = x + (gridW - sampleCols * cellSize) / 2;
  const gridY = y + (captionY - 4 - y - sampleRows * cellSize) / 2;

  for (let row = 0; row < sampleRows; row++) {
    for (let col = 0; col < sampleCols; col++) {
      // One snake along the middle row, a pellet ahead of it, board elsewhere.
      const middle = row === Math.floor(sampleRows / 2);
      const isHead = middle && col === sampleCols - 2;
      const isBody = middle && col < sampleCols - 2;
      const isPellet = middle && col === sampleCols - 1;
      const cellX = gridX + col * cellSize;
      const cellY = gridY + row * cellSize;
      if (isPellet) {
        const pelletSize = scaleUnits(5);
        const off = (cellSize - pelletSize) / 2;
        drawBox({
          x: cellX + off,
          y: cellY + off,
          w: pelletSize,
          h: pelletSize,
          color: C.accent,
        });
      } else if (isHead || isBody) {
        const pad = isHead ? 0 : inset;
        drawBox({
          x: cellX + pad,
          y: cellY + pad,
          w: cellSize - pad * 2,
          h: cellSize - pad * 2,
          color: isHead ? C.white : C.p1,
        });
      } else {
        drawBox({
          x: cellX,
          y: cellY,
          w: cellSize - 1,
          h: cellSize - 1,
          color: C.bgAlt,
        });
      }
    }
  }

  drawLabel({
    text: "3",
    x: x + gridW + (w - gridW) / 2,
    y: (y + captionY) / 2 - countdownSize / 2,
    size: countdownSize,
    color: C.text,
    anchor: "center",
  });
  drawLabel({
    text: `CELL ${cellSize}  GRID ${boardCols(cellSize)}x${boardRows(cellSize)}`,
    x: x + w / 2,
    y: captionY,
    size: FONT_SMALL,
    color: C.textDim,
    anchor: "center",
  });
}

export const snakeDuelGame: GameDefinition = {
  id: SCENE,
  title: "SNAKE DUEL",
  tagline: "Best of 5. Cut them off or eat more.",
  players: "2P VERSUS",
  accent: "good",
  controls: [
    { buttons: ["up", "down", "left", "right"], label: "TURN" },
    { buttons: ["a", "start"], label: "REMATCH" },
  ],
  drawPreview,
  drawScaleSample,
  register(): void {
    defineScene(SCENE, main);
  },
};

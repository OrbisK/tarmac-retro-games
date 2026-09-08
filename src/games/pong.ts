import type { Color } from "kaplay";
import { DESIGN_HEIGHT, DESIGN_WIDTH, MAX_PLAYERS } from "../core/config";
import type { GameDefinition } from "../core/game";
import { input } from "../core/input";
import { k } from "../core/k";
import { makePool } from "../core/pool";
import { drawHints } from "../core/prompts";
import { installQuitToMenu } from "../core/quit";
import { defineScene } from "../core/scene";
import { scaleUnits } from "../core/settings";
import { pu } from "../core/viewport";
import {
  C,
  CENTER_X,
  drawBox,
  drawDottedColumn,
  drawLabel,
  drawRule,
  FONT_BODY,
  FONT_SMALL,
  FONT_TITLE,
  playerColor,
} from "../core/ui";

/**
 * Pong.
 *
 * State is plain numbers in design units and the court is painted in one
 * `onDraw`, rather than parking positions on game objects: with rendering
 * scaled to the monitor, one coordinate space is worth more than the
 * idiomatic-looking `add([pos(), rect()])`.
 *
 * Collision is by hand and sub-stepped — at 310 units/s a 4-unit ball tunnels
 * straight through a 4-unit paddle in a single frame.
 *
 * The sizes below are *baselines*: the ball and the paddles are drawn at
 * `scaleUnits()` of them, so the operator can make the things a player tracks
 * mid-rally chunkier (see `core/settings.ts`). The court and every speed stay
 * fixed, so the pace of a rally is the same at every scale — only the ball and
 * the paddles take up more of the court.
 */

const SCENE = "pong";

const COURT_TOP = 22;
const COURT_BOTTOM = DESIGN_HEIGHT;
const COURT_HEIGHT = COURT_BOTTOM - COURT_TOP;

const PADDLE_W_BASE = 4;
const PADDLE_H_BASE = 30;
/** Distance from the wall to the paddle's centre line. */
const PADDLE_INSET = 10;
const PADDLE_SPEED = 165;

const BALL_SIZE_BASE = 4;
const SPARK_SIZE_BASE = 2;
const BALL_SPEED_START = 130;
const BALL_SPEED_GAIN = 9;
const BALL_SPEED_MAX = 310;
/** How much of the paddle's own motion is imparted to the ball. */
const PADDLE_SPIN = 0.35;
/** Max deflection from hitting the paddle off-centre, in normalised y-speed. */
const EDGE_DEFLECT = 0.9;

const WIN_SCORE = 5;
const SERVE_DELAY = 1.1;

type Phase = "serve" | "play" | "over";

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: Color;
}

function main(): void {
  installQuitToMenu();

  // Read once per scene entry, not per frame: a mid-match change of scale
  // would move the ball's collision box out from under the rally.
  const paddleW = scaleUnits(PADDLE_W_BASE);
  const paddleH = scaleUnits(PADDLE_H_BASE);
  const ballSize = scaleUnits(BALL_SIZE_BASE);
  const sparkSize = scaleUnits(SPARK_SIZE_BASE);
  /** The serve prompt sits in open court, so it can afford to scale too. */
  const servePromptSize = scaleUnits(FONT_BODY);

  const scores = new Int32Array(MAX_PLAYERS);
  /** Vertical velocity of each paddle last frame, for spin. */
  const paddleVel = new Float32Array(MAX_PLAYERS);

  let phase: Phase = "serve";
  let serveTimer = SERVE_DELAY;
  /** Who the ball is served toward — the player who just conceded. */
  let serveTo = k.chance(0.5) ? 0 : 1;
  let winner = -1;
  let ballVX = 0;
  let ballVY = 0;
  let ballSpeed = BALL_SPEED_START;
  let shakeUntil = 0;

  /** Paddle centres. X is fixed; only Y moves. */
  const paddleX = [PADDLE_INSET, DESIGN_WIDTH - PADDLE_INSET];
  const paddleY = new Float32Array(MAX_PLAYERS).fill(COURT_TOP + COURT_HEIGHT / 2);

  /** Ball centre. */
  let ballX = CENTER_X;
  let ballY = COURT_TOP + COURT_HEIGHT / 2;

  // Pooled hit sparks: capacity is fixed, so a long rally cannot grow the heap.
  const sparks = makePool<Spark>(48, () => ({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    color: C.white,
  }));

  function emitSparks(x: number, y: number, dirX: number, color: Color, count: number): void {
    for (let i = 0; i < count; i++) {
      const s = sparks.spawn();
      s.x = x;
      s.y = y;
      s.vx = dirX * k.rand(40, 130);
      s.vy = k.rand(-90, 90);
      s.life = k.rand(0.15, 0.35);
      s.color = color;
    }
  }

  function resetBall(): void {
    ballX = CENTER_X;
    ballY = COURT_TOP + COURT_HEIGHT / 2;
    ballSpeed = BALL_SPEED_START;
    ballVX = 0;
    ballVY = 0;
  }

  function launch(): void {
    const dir = serveTo === 0 ? -1 : 1;
    // Never serve dead flat — a horizontal rally is boring.
    const angle = k.rand(-0.45, 0.45);
    ballVX = dir * Math.cos(angle);
    ballVY = Math.sin(angle) * (k.chance(0.5) ? -1 : 1);
    normaliseBallDir();
  }

  function normaliseBallDir(): void {
    const len = Math.hypot(ballVX, ballVY) || 1;
    ballVX /= len;
    ballVY /= len;
    // Keep some horizontal commitment so the ball always crosses the court.
    const minX = 0.45;
    if (Math.abs(ballVX) < minX) {
      ballVX = Math.sign(ballVX || 1) * minX;
      const rest = Math.sqrt(Math.max(0, 1 - minX * minX));
      ballVY = Math.sign(ballVY || 1) * rest;
    }
  }

  function concede(scorer: number): void {
    scores[scorer]++;
    shakeUntil = k.time() + 0.25;
    emitSparks(ballX, ballY, scorer === 0 ? -1 : 1, playerColor(scorer), 14);
    if (scores[scorer] >= WIN_SCORE) {
      winner = scorer;
      phase = "over";
      resetBall();
      return;
    }
    serveTo = scorer === 0 ? 1 : 0;
    phase = "serve";
    serveTimer = SERVE_DELAY;
    resetBall();
  }

  function tryPaddleHit(p: number): boolean {
    const halfW = paddleW / 2 + ballSize / 2;
    const halfH = paddleH / 2 + ballSize / 2;
    if (Math.abs(ballX - paddleX[p]) > halfW) return false;
    if (Math.abs(ballY - paddleY[p]) > halfH) return false;
    // Only bounce when travelling toward this paddle, so a ball that clipped
    // the end doesn't get trapped inside it.
    const towardPaddle = p === 0 ? ballVX < 0 : ballVX > 0;
    if (!towardPaddle) return false;

    const offset = (ballY - paddleY[p]) / (paddleH / 2);
    ballVX = p === 0 ? 1 : -1;
    ballVY = offset * EDGE_DEFLECT + (paddleVel[p] / PADDLE_SPEED) * PADDLE_SPIN;
    normaliseBallDir();
    ballX = paddleX[p] + (p === 0 ? halfW : -halfW);
    ballSpeed = Math.min(BALL_SPEED_MAX, ballSpeed + BALL_SPEED_GAIN);
    emitSparks(ballX, ballY, p === 0 ? 1 : -1, playerColor(p), 6);
    return true;
  }

  function stepBall(distance: number): void {
    ballX += ballVX * distance;
    ballY += ballVY * distance;

    const top = COURT_TOP + ballSize / 2;
    const bottom = COURT_BOTTOM - ballSize / 2;
    if (ballY < top) {
      ballY = top;
      ballVY = Math.abs(ballVY);
    } else if (ballY > bottom) {
      ballY = bottom;
      ballVY = -Math.abs(ballVY);
    }

    if (!tryPaddleHit(0)) tryPaddleHit(1);

    if (ballX < -ballSize) concede(1);
    else if (ballX > DESIGN_WIDTH + ballSize) concede(0);
  }

  k.onUpdate(() => {
    const dt = k.dt();

    // --- paddles (always movable, even between points) ---
    for (let p = 0; p < MAX_PLAYERS; p++) {
      const before = paddleY[p];
      const dir = input.axisY(p);
      paddleY[p] = k.clamp(
        before + dir * PADDLE_SPEED * dt,
        COURT_TOP + paddleH / 2,
        COURT_BOTTOM - paddleH / 2,
      );
      paddleVel[p] = dt > 0 ? (paddleY[p] - before) / dt : 0;
    }

    // --- ball / phase ---
    if (phase === "serve") {
      serveTimer -= dt;
      // Park the ball on the serving side while the countdown runs.
      ballY = k.clamp(
        paddleY[serveTo === 0 ? 1 : 0],
        COURT_TOP + ballSize,
        COURT_BOTTOM - ballSize,
      );
      if (serveTimer <= 0) {
        launch();
        phase = "play";
      }
    } else if (phase === "play") {
      // Sub-step so a fast ball can never pass through a paddle in one frame.
      let remaining = ballSpeed * dt;
      const maxStep = 2;
      let guard = 0;
      while (remaining > 0 && phase === "play" && guard++ < 64) {
        const step = Math.min(maxStep, remaining);
        stepBall(step);
        remaining -= step;
      }
    } else if (input.anyPressed("a") || input.anyPressed("start")) {
      scores.fill(0);
      winner = -1;
      serveTo = k.chance(0.5) ? 0 : 1;
      phase = "serve";
      serveTimer = SERVE_DELAY;
      resetBall();
    }

    // --- effects ---
    sparks.each((s) => {
      s.life -= dt;
      if (s.life <= 0) return false;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 240 * dt;
      return true;
    });

    // Shake is applied by the camera in device pixels, so scale it too.
    if (k.time() < shakeUntil) k.shake(pu(0.6));
  });

  k.onDraw(() => {
    drawDottedColumn(CENTER_X, 4, 5, C.dim);
    drawRule(COURT_TOP - 1);

    // Paddles and ball.
    for (let p = 0; p < MAX_PLAYERS; p++) {
      drawBox({
        x: paddleX[p] - paddleW / 2,
        y: paddleY[p] - paddleH / 2,
        w: paddleW,
        h: paddleH,
        color: playerColor(p),
      });
    }
    drawBox({
      x: ballX - ballSize / 2,
      y: ballY - ballSize / 2,
      w: ballSize,
      h: ballSize,
      color: C.white,
    });

    for (let p = 0; p < MAX_PLAYERS; p++) {
      drawLabel({
        text: String(scores[p]),
        x: p === 0 ? CENTER_X - 26 : CENTER_X + 26,
        y: 1,
        size: FONT_TITLE,
        color: playerColor(p),
        anchor: "center",
      });
      if (!input.padConnected(p)) {
        drawLabel({
          text: p === 0 ? "WASD" : "ARROWS",
          x: p === 0 ? 4 : DESIGN_WIDTH - 4,
          y: 3,
          size: FONT_SMALL,
          color: C.textDim,
          anchor: p === 0 ? "left" : "right",
        });
      }
    }

    sparks.each((s) => {
      drawBox({
        x: s.x,
        y: s.y,
        w: sparkSize,
        h: sparkSize,
        color: s.color,
        opacity: Math.min(1, s.life * 4),
      });
      return true;
    });

    if (phase === "serve") {
      drawLabel({
        text: `P${serveTo + 1} SERVE`,
        x: CENTER_X,
        y: COURT_TOP + 10,
        size: servePromptSize,
        color: C.textDim,
        anchor: "center",
      });
    }

    if (phase === "over" && winner >= 0) {
      drawBox({
        x: 0,
        y: COURT_TOP,
        w: DESIGN_WIDTH,
        h: COURT_HEIGHT,
        color: C.black,
        opacity: 0.72,
      });
      drawLabel({
        text: `PLAYER ${winner + 1} WINS`,
        x: CENTER_X,
        y: COURT_TOP + COURT_HEIGHT / 2 - 22,
        size: FONT_TITLE,
        color: playerColor(winner),
        anchor: "center",
      });
      drawHints({
        x: CENTER_X + 42,
        y: COURT_TOP + COURT_HEIGHT / 2 + 6 - 2,
        align: "right",
        hints: [{ button: "a" }, { button: "start" }, { text: "REMATCH" }],
        color: C.text,
      });
      drawLabel({
        text: "HOLD BACK  MENU",
        x: CENTER_X,
        y: COURT_TOP + COURT_HEIGHT / 2 + 18,
        size: FONT_SMALL,
        color: C.textDim,
        anchor: "center",
      });
    }
  });
}

/**
 * Menu preview: a live mini court, sized entirely from the box it is given.
 *
 * Nothing here is in absolute units — the menu draws this small on a card and
 * large on a full-bleed one, and it has to read clearly at both.
 */
function drawPreview(x: number, y: number, w: number, h: number, t: number): void {
  const paddleW = Math.max(1.5, w * 0.014);
  const paddleH = Math.max(6, h * 0.26);
  const ball = Math.max(1.5, w * 0.016);
  const inset = w * 0.05;

  // Centre line.
  const dash = h * 0.07;
  for (let dy = h * 0.02; dy < h; dy += dash * 2) {
    drawBox({ x: x + w / 2 - paddleW / 4, y: y + dy, w: Math.max(1, paddleW / 2), h: dash, color: C.dim });
  }

  // Ball on a triangle-wave path, so it bounces off all four sides.
  const tri = (phase: number) => {
    const p = phase - Math.floor(phase);
    return p < 0.5 ? p * 2 : 2 - p * 2;
  };
  const travelX = w - inset * 2 - ball;
  const travelY = h * 0.7 - ball;
  const bx = x + inset + tri(t * 0.42) * travelX;
  const by = y + h * 0.15 + tri(t * 0.66) * travelY;

  // Paddles chase the ball, which reads as a rally rather than a screensaver.
  const chase = (target: number) => k.clamp(target, y + 2, y + h - paddleH - 2);
  drawBox({
    x: x + inset - paddleW,
    y: chase(by - paddleH / 2 + Math.sin(t * 1.7) * h * 0.06),
    w: paddleW,
    h: paddleH,
    color: C.p1,
  });
  drawBox({
    x: x + w - inset,
    y: chase(by - paddleH / 2 - Math.sin(t * 1.3) * h * 0.06),
    w: paddleW,
    h: paddleH,
    color: C.p2,
  });
  drawBox({ x: bx, y: by, w: ball, h: ball, color: C.white });
}

/**
 * Options-screen sample: a strip of court with a paddle and the ball on it,
 * both at the size a match will actually use.
 */
function drawScaleSample(x: number, y: number, w: number, h: number): void {
  const paddleW = scaleUnits(PADDLE_W_BASE);
  const paddleH = scaleUnits(PADDLE_H_BASE);
  const ballSize = scaleUnits(BALL_SIZE_BASE);

  // Two caption lines: one panel per game means the box is narrow enough that
  // a single line would run past its edge once a third game joins the list.
  const captionY = y + h - FONT_SMALL * 2 - 2;
  const midY = (y + captionY) / 2;

  // A few dashes rather than `drawDottedColumn`, which spans the whole box.
  for (let dy = y + 2; dy < captionY - 4; dy += 9) {
    drawBox({ x: x + w / 2, y: dy, w: 1, h: 4, color: C.dim });
  }
  drawBox({
    x: x + PADDLE_INSET - paddleW / 2,
    y: midY - paddleH / 2,
    w: paddleW,
    h: paddleH,
    color: C.p1,
  });
  drawBox({
    x: x + w - PADDLE_INSET - paddleW / 2,
    y: midY - paddleH / 2,
    w: paddleW,
    h: paddleH,
    color: C.p2,
  });
  drawBox({
    x: x + w / 2 - ballSize / 2,
    y: midY - ballSize / 2,
    w: ballSize,
    h: ballSize,
    color: C.white,
  });
  drawLabel({
    text: `BALL ${ballSize}`,
    x: x + w / 2,
    y: captionY,
    size: FONT_SMALL,
    color: C.textDim,
    anchor: "center",
  });
  drawLabel({
    text: `PADDLE ${paddleW}x${paddleH}`,
    x: x + w / 2,
    y: captionY + FONT_SMALL + 2,
    size: FONT_SMALL,
    color: C.textDim,
    anchor: "center",
  });
}

export const pongGame: GameDefinition = {
  id: SCENE,
  title: "PONG",
  tagline: "First to 5. Edge the ball for spin.",
  players: "2P VERSUS",
  accent: "p1",
  controls: [
    { buttons: ["up", "down"], label: "MOVE PADDLE" },
    { buttons: ["a", "start"], label: "REMATCH" },
  ],
  drawPreview,
  drawScaleSample,
  register(): void {
    defineScene(SCENE, main);
  },
};

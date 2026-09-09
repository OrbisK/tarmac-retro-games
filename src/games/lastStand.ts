import type { Color } from "kaplay";
import { BUTTONS } from "../core/buttons";
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
  drawBar,
  drawBox,
  drawLabel,
  drawRule,
  drawTriangle,
  FONT_BODY,
  FONT_HUGE,
  FONT_SMALL,
  FONT_TITLE,
  playerColor,
} from "../core/ui";

/**
 * Last Stand — the cabinet's co-op game.
 *
 * Every other game here is two people beating each other; this one is two
 * people against the machine, and everything in it is bent toward making that
 * legible from the other side of the room.
 *
 * **The run is shared, the bodies are not.** One score, one wave counter, one
 * game over — but each player has their own hearts, and running out of them
 * puts you *down* rather than out: a flat marker on the floor with a bleed
 * bar, which your partner clears by standing on you for a moment. That is the
 * whole co-op mandate, and it needs no explaining because the thing on the
 * floor is obviously a person and the bar over it is obviously running out.
 * Bleed out and you sit the rest of the wave out; clearing the wave brings
 * you back. The run ends when nobody is on their feet.
 *
 * **Anyone can join mid-run.** A cabinet is walked up to by one person far
 * more often than by two, so the second slot is not a requirement — it is an
 * invitation, printed along the bottom of the arena, and pressing anything
 * drops that player into the wave in progress with a full three hearts. The
 * player who launched the game from the menu is joined for them.
 *
 * **Game scale.** The bullet and the countdown: the two things a player reads
 * with their hands already busy, and the bullet is the smallest thing on the
 * screen by some way. Scaling it does move the odds slightly — a 6-unit shot
 * clips a walker that a 3-unit one misses — which is the same trade Pong
 * makes with the ball, and the same reason: a shot you cannot see is worse
 * than one that lands a little more often. Bodies, the arena and every speed
 * stay fixed, so the pace of a wave is the pace of a wave at any setting.
 *
 * Structurally this follows the other games: plain numbers in design units,
 * fixed-capacity lists allocated at scene entry, one `onUpdate` and one
 * `onDraw`. Object count stays at 2 however long the run goes on.
 */

const SCENE = "last-stand";

/* ---------------------------------------------------------------- arena -- */

const HUD_H = 22;
const ARENA_TOP = HUD_H;
const ARENA_BOTTOM = DESIGN_HEIGHT;
const ARENA_CY = (ARENA_TOP + ARENA_BOTTOM) / 2;

/* -------------------------------------------------------------- players -- */

/** A body is 12 units square: three body widths of gap still reads as a gap. */
const BODY = 12;
/** The muzzle block, which is also which way the next shot goes. */
const MUZZLE = 5;
const PLAYER_SPEED = 92;
const HEARTS_MAX = 3;
/** Deflection past which the stick counts as pushed. */
const STICK = 0.25;

const INVULN_SECONDS = 1.2;
/** Speed the hit player is thrown at, and how fast that bleeds off. */
const HIT_KNOCK = 105;
const KNOCK_DECAY = 420;

const BULLET_BASE = 4;
const BULLET_SPEED = 235;
const FIRE_COOLDOWN = 0.19;

/** Seconds a downed player has before they are out for the rest of the wave. */
const BLEED_SECONDS = 12;
/**
 * How close the partner has to stand, centre to centre, to work on them.
 *
 * Two and a half body widths rather than the one it started at: at 20 units
 * two 12-unit bodies had to be almost exactly on top of each other, so the
 * lift kept failing for a reason nothing on screen explained. Standing over
 * someone should be a place you can stop, not a pixel you have to find.
 */
const REVIVE_RADIUS = 30;
/** Short enough to be worth trying with a walker already on its way in. */
const REVIVE_SECONDS = 0.9;
/** Hearts a revived or returning player comes back with. */
const REVIVE_HEARTS = 1;

const START_X = [CENTER_X - 46, CENTER_X + 46] as const;
const START_FACING = [1, -1] as const;

/** Player condition. Down is revivable, out is not — until the wave ends. */
const ALIVE = 0;
const DOWN = 1;
const OUT = 2;

interface Player {
  joined: boolean;
  state: number;
  x: number;
  y: number;
  /** Facing, as a unit vector: where the muzzle sits and shots come out. */
  fx: number;
  fy: number;
  hearts: number;
  invuln: number;
  cooldown: number;
  /** Knockback velocity, decaying. */
  kx: number;
  ky: number;
  bleed: number;
  revive: number;
  /** Set by the partner each frame they are close enough to work. */
  beingRevived: boolean;
}

/* -------------------------------------------------------------- enemies -- */

const WALKER = 0;
const RUNNER = 1;
const BRUTE = 2;

/**
 * Three shapes, told apart by silhouette first and colour second: a square
 * that walks, a dart that runs, and a big square that soaks up a magazine.
 * The brute shares the walker's orange on purpose — it *is* a walker, four
 * times the trouble — while the runner is the one that needs its own colour
 * because it arrives before you have looked at it properly.
 */
const E_SIZE = [12, 10, 20] as const;
const E_HP = [1, 1, 4] as const;
const E_SCORE = [10, 15, 40] as const;
const E_SPEED = [26, 58, 19] as const;
/** Added per wave past the first, and the ceiling it climbs to. */
const E_SPEED_GAIN = [1.7, 2.4, 1.1] as const;
const E_SPEED_MAX = [54, 96, 36] as const;
const E_COLOR: readonly Color[] = [C.tetL, C.tetT, C.tetL];

/** Seconds an arrival is telegraphed at the edge before it can touch anyone. */
const SPAWN_WARM = 0.55;
/** Arrivals keep this far from anyone on their feet, where the edge allows. */
const SPAWN_CLEARANCE = 52;
/** On screen at once. Past this the wave queues instead — a swarm you cannot
 *  pick shapes out of is not harder, only noisier. */
const MAX_LIVE = 16;
const CAP_ENEMIES = 20;
const CAP_BULLETS = 28;
const CAP_PICKUPS = 4;

interface Enemy {
  kind: number;
  x: number;
  y: number;
  hp: number;
  speed: number;
  /** Travel direction, kept for drawing the runner's point. */
  dx: number;
  dy: number;
  warm: number;
  stun: number;
  kx: number;
  ky: number;
  flash: number;
}

interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Pickup {
  x: number;
  y: number;
  life: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: Color;
}

const PICKUP_SIZE = 8;
const PICKUP_LIFE = 14;

/* ---------------------------------------------------------------- waves -- */

const READY_SECONDS = 3;
const CLEAR_SECONDS = 2.6;
const WAVE_BONUS = 50;
/** Longest wave the counts below can ask for, so the queue is one allocation. */
const QUEUE_CAP = 40;

function waveWalkers(wave: number): number {
  return Math.min(18, 4 + wave * 2);
}

function waveRunners(wave: number): number {
  return wave < 2 ? 0 : Math.min(10, Math.floor((wave - 1) * 1.5));
}

function waveBrutes(wave: number): number {
  return wave < 4 ? 0 : Math.min(4, Math.floor((wave - 2) / 2));
}

/**
 * Best of the session, not of all time.
 *
 * Module scope rather than `localStorage`: it survives every scene change and
 * dies with the page, which is the honest lifetime for a number nobody has
 * put a name against — and it keeps the operator's options screen out of it.
 * Promoting it to a stored table later is a `core/scores.ts` and a reset row,
 * not a change in here.
 */
let bestScore = 0;
let bestWave = 0;

type Phase = "ready" | "wave" | "cleared" | "over";

/** Prebuilt: both are drawn every frame of their phase. */
const COUNT_TEXT = ["GO", "1", "2", "3"] as const;
const JOIN_TEXT = [
  "P1 — PRESS ANY BUTTON TO JOIN",
  "P2 — PRESS ANY BUTTON TO JOIN",
] as const;
const HEARTS_LABEL = ["DOWN", "OUT"] as const;

/* ----------------------------------------------------------------- list -- */

/**
 * A fixed-capacity list with swap-remove.
 *
 * `makePool` covers the sparks, as it does in Pong, but the enemies, bullets
 * and pickups are read against each other every frame — separation is
 * pairwise, and every bullet tests every enemy. Those want plain index loops:
 * `pool.each` would mean a closure per pass, and a nested one per enemy.
 */
interface List<T> {
  readonly items: T[];
  count: number;
}

function makeList<T>(capacity: number, create: () => T): List<T> {
  const items = new Array<T>(capacity);
  for (let i = 0; i < capacity; i++) items[i] = create();
  return { items, count: 0 };
}

/** The next free slot, or null when full. Slots are reused, never allocated. */
function takeSlot<T>(list: List<T>): T | null {
  if (list.count >= list.items.length) return null;
  return list.items[list.count++];
}

/** Release slot `i`. Iterate backwards when removing inside a loop. */
function dropSlot<T>(list: List<T>, i: number): void {
  const last = --list.count;
  if (i !== last) {
    const tmp = list.items[i];
    list.items[i] = list.items[last];
    list.items[last] = tmp;
  }
}

/* ----------------------------------------------------------------- game -- */

function main(): void {
  installQuitToMenu();

  // Read once at scene entry: a scale change under a run would resize the
  // shot the player is currently leading a runner with.
  const bulletSize = scaleUnits(BULLET_BASE);
  const countSize = scaleUnits(FONT_HUGE);

  const players: Player[] = [];
  for (let p = 0; p < MAX_PLAYERS; p++) {
    players.push({
      joined: false,
      state: ALIVE,
      x: START_X[p],
      y: ARENA_CY + 24,
      fx: START_FACING[p],
      fy: 0,
      hearts: HEARTS_MAX,
      invuln: 0,
      cooldown: 0,
      kx: 0,
      ky: 0,
      bleed: 0,
      revive: 0,
      beingRevived: false,
    });
  }

  const enemies = makeList<Enemy>(CAP_ENEMIES, () => ({
    kind: WALKER,
    x: 0,
    y: 0,
    hp: 1,
    speed: 0,
    dx: 0,
    dy: 1,
    warm: 0,
    stun: 0,
    kx: 0,
    ky: 0,
    flash: 0,
  }));
  const bullets = makeList<Bullet>(CAP_BULLETS, () => ({ x: 0, y: 0, vx: 0, vy: 0 }));
  const pickups = makeList<Pickup>(CAP_PICKUPS, () => ({ x: 0, y: 0, life: 0 }));
  const sparks = makePool<Spark>(72, () => ({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    color: C.white,
  }));

  let phase: Phase = "ready";
  let phaseTimer = READY_SECONDS;
  let wave = 0;
  let score = 0;
  let shakeUntil = 0;

  /** This wave's arrivals, shuffled, spent one at a time. */
  const queue = new Uint8Array(QUEUE_CAP);
  let queueLen = 0;
  let queueAt = 0;
  let spawnTimer = 0;
  let spawnInterval = 1;

  // Strings drawn every frame, rebuilt only when the number behind them
  // changes — `onDraw` formats nothing.
  let waveText = "WAVE 1";
  let scoreText = "0";
  let scoreShown = 0;
  let clearText = "";
  let bonusText = "";
  let overWaveText = "";
  let overScoreText = "";
  let overBestText = "";

  /* ------------------------------------------------------------ effects -- */

  function emitSparks(x: number, y: number, count: number, color: Color, speed: number): void {
    for (let i = 0; i < count; i++) {
      const s = sparks.spawn();
      const a = k.rand(0, Math.PI * 2);
      s.x = x;
      s.y = y;
      s.vx = Math.cos(a) * k.rand(speed * 0.3, speed);
      s.vy = Math.sin(a) * k.rand(speed * 0.3, speed);
      s.life = k.rand(0.14, 0.34);
      s.color = color;
    }
  }

  /* ------------------------------------------------------------- helpers -- */

  function anyButtonPressed(p: number): boolean {
    for (let i = 0; i < BUTTONS.length; i++) {
      // Back is the quit hold — joining on it would put a player in the run
      // on the way out of it.
      if (BUTTONS[i] === "back") continue;
      if (input.pressed(p, BUTTONS[i])) return true;
    }
    return false;
  }

  function nearestStanding(x: number, y: number): number {
    let best = -1;
    let bestD = Infinity;
    for (let p = 0; p < MAX_PLAYERS; p++) {
      const pl = players[p];
      if (!pl.joined || pl.state !== ALIVE) continue;
      const dx = pl.x - x;
      const dy = pl.y - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  function standingCount(): number {
    let n = 0;
    for (let p = 0; p < MAX_PLAYERS; p++) {
      const pl = players[p];
      if (pl.joined && pl.state === ALIVE) n++;
    }
    return n;
  }

  function joinedCount(): number {
    let n = 0;
    for (let p = 0; p < MAX_PLAYERS; p++) if (players[p].joined) n++;
    return n;
  }

  function placePlayer(p: number, hearts: number): void {
    const pl = players[p];
    pl.state = ALIVE;
    pl.x = START_X[p];
    pl.y = ARENA_CY + 24;
    pl.fx = START_FACING[p];
    pl.fy = 0;
    pl.hearts = hearts;
    pl.invuln = INVULN_SECONDS;
    pl.cooldown = 0;
    pl.kx = 0;
    pl.ky = 0;
    pl.bleed = 0;
    pl.revive = 0;
  }

  function addScore(points: number): void {
    score += points;
    if (score !== scoreShown) {
      scoreShown = score;
      scoreText = String(score);
    }
  }

  /* --------------------------------------------------------------- waves -- */

  function startWave(n: number): void {
    wave = n;
    waveText = `WAVE ${n}`;

    let len = 0;
    const walkers = waveWalkers(n);
    const runners = waveRunners(n);
    const brutes = waveBrutes(n);
    for (let i = 0; i < walkers && len < QUEUE_CAP; i++) queue[len++] = WALKER;
    for (let i = 0; i < runners && len < QUEUE_CAP; i++) queue[len++] = RUNNER;
    for (let i = 0; i < brutes && len < QUEUE_CAP; i++) queue[len++] = BRUTE;
    // Shuffle in place, so a wave is not three blocks of one shape.
    for (let i = len - 1; i > 0; i--) {
      const j = Math.floor(k.rand(0, i + 1));
      const tmp = queue[i];
      queue[i] = queue[j];
      queue[j] = tmp;
    }
    queueLen = len;
    queueAt = 0;

    spawnInterval = Math.max(0.3, 1.0 - n * 0.055);
    spawnTimer = 0.35;
    phase = "wave";
  }

  function spawnOne(): void {
    if (queueAt >= queueLen) return;
    if (enemies.count >= MAX_LIVE) return;
    const e = takeSlot(enemies);
    if (e === null) return;

    const kind = queue[queueAt++];
    const half = E_SIZE[kind] / 2;
    let x = 0;
    let y = 0;
    // Arrive on the perimeter, away from anyone on their feet where there is
    // room to be. Eight tries and then wherever — the telegraph is the real
    // fairness, and a cornered pair should still be found.
    for (let attempt = 0; attempt < 8; attempt++) {
      const edge = Math.floor(k.rand(0, 4));
      if (edge === 0 || edge === 2) {
        x = k.rand(half, DESIGN_WIDTH - half);
        y = edge === 0 ? ARENA_TOP + half : ARENA_BOTTOM - half;
      } else {
        x = edge === 1 ? DESIGN_WIDTH - half : half;
        y = k.rand(ARENA_TOP + half, ARENA_BOTTOM - half);
      }
      const near = nearestStanding(x, y);
      if (near < 0) break;
      const dx = players[near].x - x;
      const dy = players[near].y - y;
      if (dx * dx + dy * dy > SPAWN_CLEARANCE * SPAWN_CLEARANCE) break;
    }

    e.kind = kind;
    e.x = x;
    e.y = y;
    e.hp = E_HP[kind];
    e.speed = Math.min(E_SPEED_MAX[kind], E_SPEED[kind] + E_SPEED_GAIN[kind] * (wave - 1));
    e.dx = 0;
    e.dy = 1;
    e.warm = SPAWN_WARM;
    e.stun = 0;
    e.kx = 0;
    e.ky = 0;
    e.flash = 0;
  }

  function killEnemy(i: number): void {
    const e = enemies.items[i];
    addScore(E_SCORE[e.kind]);
    emitSparks(e.x, e.y, e.kind === BRUTE ? 12 : 6, E_COLOR[e.kind], 130);
    if (e.kind === BRUTE) {
      // The only thing that gives hearts back mid-wave, and it sits there
      // until somebody who needs it takes it.
      const pick = takeSlot(pickups);
      if (pick !== null) {
        pick.x = e.x;
        pick.y = e.y;
        pick.life = PICKUP_LIFE;
      }
      shakeUntil = k.time() + 0.18;
    }
    dropSlot(enemies, i);
  }

  function clearWave(): void {
    phase = "cleared";
    phaseTimer = CLEAR_SECONDS;
    const bonus = WAVE_BONUS * wave;
    addScore(bonus);
    clearText = `WAVE ${wave} CLEAR`;
    bonusText = `+${bonus}`;
    // Everyone comes back for the next one: down, out, or standing and hurt.
    for (let p = 0; p < MAX_PLAYERS; p++) {
      const pl = players[p];
      if (!pl.joined) continue;
      if (pl.state === ALIVE) {
        pl.hearts = Math.min(HEARTS_MAX, pl.hearts + 1);
      } else {
        placePlayer(p, REVIVE_HEARTS);
      }
    }
    // Uncollected hearts stay on the floor into the next wave. A brute killed
    // last would otherwise drop one and have it wiped in the same frame.
    bullets.count = 0;
  }

  function endRun(): void {
    phase = "over";
    const record = score > bestScore;
    overWaveText = `REACHED WAVE ${wave}`;
    overScoreText = `SCORE ${score}`;
    overBestText = record ? "NEW BEST" : bestScore > 0 ? `BEST ${bestScore} — WAVE ${bestWave}` : "";
    if (record) {
      bestScore = score;
      bestWave = wave;
    }
    emitSparks(CENTER_X, ARENA_CY, 16, C.bad, 160);
    shakeUntil = k.time() + 0.35;
  }

  function startRun(): void {
    score = 0;
    scoreShown = 0;
    scoreText = "0";
    enemies.count = 0;
    bullets.count = 0;
    pickups.count = 0;
    sparks.clear();
    for (let p = 0; p < MAX_PLAYERS; p++) if (players[p].joined) placePlayer(p, HEARTS_MAX);
    wave = 0;
    waveText = "WAVE 1";
    phase = "ready";
    phaseTimer = READY_SECONDS;
  }

  /* ---------------------------------------------------------- the player -- */

  function updatePlayer(p: number, dt: number): void {
    const pl = players[p];
    if (!pl.joined || pl.state === OUT) return;

    if (pl.state === DOWN) {
      pl.bleed -= dt;
      if (pl.beingRevived) {
        pl.revive += dt;
        if (pl.revive >= REVIVE_SECONDS) {
          pl.state = ALIVE;
          pl.hearts = REVIVE_HEARTS;
          pl.invuln = INVULN_SECONDS;
          pl.revive = 0;
          emitSparks(pl.x, pl.y, 10, playerColor(p), 90);
        }
      } else {
        // Half-finished work is kept for a while: stepping aside to shoot the
        // walker that is about to arrive should barely cost anything, or the
        // only lift that ever completes is one nothing interrupted.
        pl.revive = Math.max(0, pl.revive - dt * 0.3);
      }
      if (pl.state === DOWN && pl.bleed <= 0) {
        pl.state = OUT;
        pl.revive = 0;
      }
      return;
    }

    const ax = input.axisX(p);
    const ay = input.axisY(p);
    let mx = 0;
    let my = 0;
    const len = Math.hypot(ax, ay);
    if (len > STICK) {
      mx = ax / len;
      my = ay / len;
      // Holding the aim button walks without turning, which is how you back
      // away from a brute and keep shooting it.
      if (!input.down(p, "b")) {
        pl.fx = mx;
        pl.fy = my;
      }
    }

    pl.x += (mx * PLAYER_SPEED + pl.kx) * dt;
    pl.y += (my * PLAYER_SPEED + pl.ky) * dt;
    const decay = KNOCK_DECAY * dt;
    pl.kx -= Math.sign(pl.kx) * Math.min(Math.abs(pl.kx), decay);
    pl.ky -= Math.sign(pl.ky) * Math.min(Math.abs(pl.ky), decay);

    const half = BODY / 2;
    pl.x = k.clamp(pl.x, half, DESIGN_WIDTH - half);
    pl.y = k.clamp(pl.y, ARENA_TOP + half, ARENA_BOTTOM - half);

    if (pl.invuln > 0) pl.invuln -= dt;

    pl.cooldown -= dt;
    if (phase === "wave" && input.down(p, "a") && pl.cooldown <= 0) {
      const b = takeSlot(bullets);
      if (b !== null) {
        b.x = pl.x + pl.fx * (half + bulletSize);
        b.y = pl.y + pl.fy * (half + bulletSize);
        b.vx = pl.fx * BULLET_SPEED;
        b.vy = pl.fy * BULLET_SPEED;
        pl.cooldown = FIRE_COOLDOWN;
      }
    }
  }

  function hitPlayer(p: number, fromX: number, fromY: number): void {
    const pl = players[p];
    pl.hearts--;
    pl.invuln = INVULN_SECONDS;
    const dx = pl.x - fromX;
    const dy = pl.y - fromY;
    const len = Math.hypot(dx, dy) || 1;
    pl.kx = (dx / len) * HIT_KNOCK;
    pl.ky = (dy / len) * HIT_KNOCK;
    emitSparks(pl.x, pl.y, 8, playerColor(p), 120);
    shakeUntil = k.time() + 0.2;
    if (pl.hearts <= 0) {
      pl.hearts = 0;
      pl.state = DOWN;
      pl.bleed = BLEED_SECONDS;
      pl.revive = 0;
      pl.kx = 0;
      pl.ky = 0;
      shakeUntil = k.time() + 0.35;
    }
  }

  /* --------------------------------------------------------------- frame -- */

  k.onUpdate(() => {
    const dt = k.dt();

    // Anyone not in the run is one button away from being in it, in every
    // phase — including the game over screen, where the same press is also
    // the rematch.
    for (let p = 0; p < MAX_PLAYERS; p++) {
      if (players[p].joined) continue;
      if (!anyButtonPressed(p)) continue;
      players[p].joined = true;
      placePlayer(p, HEARTS_MAX);
      emitSparks(players[p].x, players[p].y, 10, playerColor(p), 100);
    }

    if (phase === "over") {
      if (input.anyPressed("a") || input.anyPressed("start")) startRun();
      sparks.each((s) => {
        s.life -= dt;
        if (s.life <= 0) return false;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        return true;
      });
      if (k.time() < shakeUntil) k.shake(pu(0.8));
      return;
    }

    if (phase === "ready") {
      phaseTimer -= dt;
      if (phaseTimer <= 0) startWave(1);
    } else if (phase === "cleared") {
      phaseTimer -= dt;
      if (phaseTimer <= 0) startWave(wave + 1);
    }

    for (let p = 0; p < MAX_PLAYERS; p++) players[p].beingRevived = false;
    // Standing on a downed partner is the only "action" with no button on it:
    // being there is the input.
    for (let p = 0; p < MAX_PLAYERS; p++) {
      const pl = players[p];
      if (!pl.joined || pl.state !== ALIVE) continue;
      for (let o = 0; o < MAX_PLAYERS; o++) {
        if (o === p) continue;
        const other = players[o];
        if (!other.joined || other.state !== DOWN) continue;
        const dx = other.x - pl.x;
        const dy = other.y - pl.y;
        if (dx * dx + dy * dy <= REVIVE_RADIUS * REVIVE_RADIUS) other.beingRevived = true;
      }
    }
    for (let p = 0; p < MAX_PLAYERS; p++) updatePlayer(p, dt);

    // --- arrivals ---
    if (phase === "wave") {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnOne();
        spawnTimer = spawnInterval;
      }
    }

    // --- enemies ---
    for (let i = 0; i < enemies.count; i++) {
      const e = enemies.items[i];
      if (e.warm > 0) {
        e.warm -= dt;
        continue;
      }
      if (e.flash > 0) e.flash -= dt;
      if (e.stun > 0) e.stun -= dt;

      const target = nearestStanding(e.x, e.y);
      if (target >= 0 && e.stun <= 0) {
        const pl = players[target];
        const dx = pl.x - e.x;
        const dy = pl.y - e.y;
        const len = Math.hypot(dx, dy) || 1;
        e.dx = dx / len;
        e.dy = dy / len;
        e.x += e.dx * e.speed * dt;
        e.y += e.dy * e.speed * dt;
      }

      e.x += e.kx * dt;
      e.y += e.ky * dt;
      const decay = 600 * dt;
      e.kx -= Math.sign(e.kx) * Math.min(Math.abs(e.kx), decay);
      e.ky -= Math.sign(e.ky) * Math.min(Math.abs(e.ky), decay);
    }

    // Push overlapping bodies apart, so a crowd stays a crowd of shapes
    // rather than one orange smear. 16 on screen is 120 pairs.
    for (let i = 0; i < enemies.count; i++) {
      const a = enemies.items[i];
      if (a.warm > 0) continue;
      for (let j = i + 1; j < enemies.count; j++) {
        const b = enemies.items[j];
        if (b.warm > 0) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = (E_SIZE[a.kind] + E_SIZE[b.kind]) * 0.45;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 < 0.01) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) * 0.5;
        const nx = dx / d;
        const ny = dy / d;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
      }
    }

    // --- contact ---
    for (let i = 0; i < enemies.count; i++) {
      const e = enemies.items[i];
      const half = E_SIZE[e.kind] / 2;
      e.x = k.clamp(e.x, half, DESIGN_WIDTH - half);
      e.y = k.clamp(e.y, ARENA_TOP + half, ARENA_BOTTOM - half);
      if (e.warm > 0) continue;

      for (let p = 0; p < MAX_PLAYERS; p++) {
        const pl = players[p];
        if (!pl.joined || pl.state !== ALIVE || pl.invuln > 0) continue;
        if (Math.abs(pl.x - e.x) > half + BODY / 2) continue;
        if (Math.abs(pl.y - e.y) > half + BODY / 2) continue;
        hitPlayer(p, e.x, e.y);
        // The enemy bounces off too, so one walker cannot chew through three
        // hearts while the player is still recovering from the first.
        const dx = e.x - pl.x;
        const dy = e.y - pl.y;
        const len = Math.hypot(dx, dy) || 1;
        e.kx = (dx / len) * 150;
        e.ky = (dy / len) * 150;
        e.stun = 0.45;
        break;
      }
    }

    // --- bullets ---
    for (let i = bullets.count - 1; i >= 0; i--) {
      const b = bullets.items[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (
        b.x < -bulletSize ||
        b.x > DESIGN_WIDTH + bulletSize ||
        b.y < ARENA_TOP - bulletSize ||
        b.y > ARENA_BOTTOM + bulletSize
      ) {
        dropSlot(bullets, i);
        continue;
      }
      for (let j = 0; j < enemies.count; j++) {
        const e = enemies.items[j];
        if (e.warm > 0) continue;
        const half = E_SIZE[e.kind] / 2 + bulletSize / 2;
        if (Math.abs(b.x - e.x) > half || Math.abs(b.y - e.y) > half) continue;
        e.hp--;
        e.flash = 0.07;
        emitSparks(b.x, b.y, 3, C.white, 70);
        dropSlot(bullets, i);
        if (e.hp <= 0) killEnemy(j);
        break;
      }
    }

    // --- pickups ---
    for (let i = pickups.count - 1; i >= 0; i--) {
      const pick = pickups.items[i];
      pick.life -= dt;
      if (pick.life <= 0) {
        dropSlot(pickups, i);
        continue;
      }
      for (let p = 0; p < MAX_PLAYERS; p++) {
        const pl = players[p];
        // Nothing happens if you are already full: the heart stays on the
        // floor for whoever needs it.
        if (!pl.joined || pl.state !== ALIVE || pl.hearts >= HEARTS_MAX) continue;
        if (Math.abs(pl.x - pick.x) > (PICKUP_SIZE + BODY) / 2) continue;
        if (Math.abs(pl.y - pick.y) > (PICKUP_SIZE + BODY) / 2) continue;
        pl.hearts++;
        emitSparks(pick.x, pick.y, 8, C.good, 90);
        dropSlot(pickups, i);
        break;
      }
    }

    sparks.each((s) => {
      s.life -= dt;
      if (s.life <= 0) return false;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      return true;
    });

    // --- the run itself ---
    if (phase === "wave") {
      if (joinedCount() > 0 && standingCount() === 0) endRun();
      else if (queueAt >= queueLen && enemies.count === 0) clearWave();
    }

    if (k.time() < shakeUntil) k.shake(pu(0.8));
  });

  /* ---------------------------------------------------------------- draw -- */

  function drawEnemy(e: Enemy): void {
    const size = E_SIZE[e.kind];
    const half = size / 2;
    const color = e.flash > 0 ? C.white : E_COLOR[e.kind];

    if (e.warm > 0) {
      // The telegraph: a hollow blinking box on the spot it will occupy, so
      // an arrival behind you is something you were warned about.
      if (Math.floor(e.warm * 12) % 2 === 0) {
        drawBox({
          x: e.x - half,
          y: e.y - half,
          w: size,
          h: size,
          color: C.bgAlt,
          outline: E_COLOR[e.kind],
        });
      }
      return;
    }

    if (e.kind === RUNNER) {
      // A dart, pointed the way it is going.
      const tipX = e.x + e.dx * half;
      const tipY = e.y + e.dy * half;
      const backX = e.x - e.dx * half;
      const backY = e.y - e.dy * half;
      drawTriangle({
        x1: tipX,
        y1: tipY,
        x2: backX - e.dy * half,
        y2: backY + e.dx * half,
        x3: backX + e.dy * half,
        y3: backY - e.dx * half,
        color,
      });
      return;
    }

    drawBox({ x: e.x - half, y: e.y - half, w: size, h: size, color });
    if (e.kind === BRUTE) {
      // Damage opens a hole in it rather than dimming it: at this size a
      // brightness step is not a reading, and a hole is.
      const gone = 1 - e.hp / E_HP[BRUTE];
      const core = Math.round(size * 0.7 * gone);
      if (core >= 2) {
        drawBox({ x: e.x - core / 2, y: e.y - core / 2, w: core, h: core, color: C.bg });
      }
    }
  }

  function drawPlayerBody(p: number): void {
    const pl = players[p];
    if (!pl.joined || pl.state === OUT) return;
    const color = playerColor(p);
    const half = BODY / 2;

    if (pl.state === DOWN) {
      // Flat on the floor, with the bleed running out over it. The revive bar
      // sits under the bleed bar, filling the other way, so the pair reads as
      // a race at a glance.
      drawBox({ x: pl.x - half, y: pl.y + half - 5, w: BODY, h: 5, color: C.bgAlt });
      drawBox({ x: pl.x - half, y: pl.y + half - 5, w: BODY, h: 5, color, opacity: 0.55 });
      // Once the run is over there is nobody left to shout at: the bars and
      // the plea would sit under the game over panel asking for help that is
      // no longer coming.
      if (phase === "over") return;
      drawBar({
        x: pl.x - 14,
        y: pl.y - 14,
        w: 28,
        h: 5,
        progress: pl.bleed / BLEED_SECONDS,
        color: C.bad,
      });
      if (pl.revive > 0) {
        drawBar({
          x: pl.x - 14,
          y: pl.y - 7,
          w: 28,
          h: 5,
          progress: pl.revive / REVIVE_SECONDS,
          color: C.good,
        });
      } else if (Math.floor(k.time() * 3) % 2 === 0) {
        drawLabel({
          text: "HELP",
          x: pl.x,
          y: pl.y - 8,
          size: FONT_SMALL,
          color: C.bad,
          anchor: "center",
        });
      }
      return;
    }

    // Invulnerability blinks the body, which is also the "I have just been
    // hit" reading — the two are the same fact.
    if (pl.invuln > 0 && Math.floor(k.time() * 14) % 2 === 0) return;
    drawBox({ x: pl.x - half, y: pl.y - half, w: BODY, h: BODY, color });
    drawBox({
      x: pl.x + pl.fx * half - MUZZLE / 2,
      y: pl.y + pl.fy * half - MUZZLE / 2,
      w: MUZZLE,
      h: MUZZLE,
      color: C.white,
    });
  }

  function drawHud(): void {
    drawRule(HUD_H - 1);

    for (let p = 0; p < MAX_PLAYERS; p++) {
      const pl = players[p];
      const color = pl.joined ? playerColor(p) : C.dim;
      const edge = p === 0 ? 4 : DESIGN_WIDTH - 4;
      drawLabel({
        text: p === 0 ? "P1" : "P2",
        x: edge,
        y: 3,
        size: FONT_SMALL,
        color,
        anchor: p === 0 ? "left" : "right",
      });

      const pipsX = p === 0 ? 20 : DESIGN_WIDTH - 20;
      if (pl.joined && pl.state !== ALIVE) {
        // Steady, not blinking: a blinked-off word leaves that player's half
        // of the HUD blank, which reads as "not playing" rather than "down".
        const down = pl.state === DOWN;
        drawLabel({
          text: HEARTS_LABEL[down ? 0 : 1],
          x: pipsX,
          y: 3,
          size: FONT_SMALL,
          color: down ? C.bad : C.dim,
          anchor: p === 0 ? "left" : "right",
        });
        continue;
      }
      for (let i = 0; i < HEARTS_MAX; i++) {
        const x = p === 0 ? pipsX + i * 9 : pipsX - 6 - i * 9;
        const filled = pl.joined && i < pl.hearts;
        if (filled) drawBox({ x, y: 4, w: 6, h: 6, color });
        else drawBox({ x, y: 4, w: 6, h: 6, color: C.bg, outline: C.dim });
      }
    }

    drawLabel({ text: waveText, x: CENTER_X, y: 1, size: FONT_SMALL, color: C.accent, anchor: "center" });
    drawLabel({ text: scoreText, x: CENTER_X, y: 11, size: FONT_SMALL, color: C.text, anchor: "center" });
  }

  k.onDraw(() => {
    // The perimeter, which is also where everything comes from.
    drawBox({
      x: 0,
      y: ARENA_TOP,
      w: DESIGN_WIDTH,
      h: ARENA_BOTTOM - ARENA_TOP,
      color: C.bg,
      outline: C.bgAlt,
    });

    for (let i = 0; i < pickups.count; i++) {
      const pick = pickups.items[i];
      if (pick.life < 3 && Math.floor(pick.life * 8) % 2 === 0) continue;
      drawBox({ x: pick.x - PICKUP_SIZE / 2, y: pick.y - 1.5, w: PICKUP_SIZE, h: 3, color: C.good });
      drawBox({ x: pick.x - 1.5, y: pick.y - PICKUP_SIZE / 2, w: 3, h: PICKUP_SIZE, color: C.good });
    }

    // Downed players under everything: they are scenery until someone gets
    // to them, and a brute standing on the marker must not hide the brute.
    for (let p = 0; p < MAX_PLAYERS; p++) if (players[p].state === DOWN) drawPlayerBody(p);
    for (let i = 0; i < enemies.count; i++) drawEnemy(enemies.items[i]);
    for (let p = 0; p < MAX_PLAYERS; p++) if (players[p].state !== DOWN) drawPlayerBody(p);

    for (let i = 0; i < bullets.count; i++) {
      const b = bullets.items[i];
      drawBox({
        x: b.x - bulletSize / 2,
        y: b.y - bulletSize / 2,
        w: bulletSize,
        h: bulletSize,
        color: C.white,
      });
    }

    sparks.each((s) => {
      drawBox({ x: s.x, y: s.y, w: 2, h: 2, color: s.color, opacity: Math.min(1, s.life * 4) });
      return true;
    });

    drawHud();

    if (phase === "ready") {
      drawLabel({
        text: "GET READY",
        x: CENTER_X,
        y: ARENA_CY - 46,
        size: FONT_TITLE,
        color: C.text,
        anchor: "center",
      });
      drawLabel({
        text: COUNT_TEXT[Math.max(0, Math.min(COUNT_TEXT.length - 1, Math.ceil(phaseTimer)))],
        x: CENTER_X,
        y: ARENA_CY - countSize / 2,
        size: countSize,
        color: C.accent,
        anchor: "center",
      });
    }

    if (phase === "cleared") {
      drawLabel({
        text: clearText,
        x: CENTER_X,
        y: ARENA_CY - 24,
        size: FONT_TITLE,
        color: C.good,
        anchor: "center",
      });
      drawLabel({
        text: bonusText,
        x: CENTER_X,
        y: ARENA_CY + 2,
        size: FONT_BODY,
        color: C.accent,
        anchor: "center",
      });
    }

    if (phase === "over") {
      drawBox({
        x: 0,
        y: ARENA_TOP,
        w: DESIGN_WIDTH,
        h: ARENA_BOTTOM - ARENA_TOP,
        color: C.black,
        opacity: 0.85,
      });
      drawLabel({
        text: "GAME OVER",
        x: CENTER_X,
        y: ARENA_CY - 62,
        size: FONT_TITLE,
        color: C.bad,
        anchor: "center",
      });
      drawLabel({
        text: overWaveText,
        x: CENTER_X,
        y: ARENA_CY - 36,
        size: FONT_BODY,
        color: C.text,
        anchor: "center",
      });
      drawLabel({
        text: overScoreText,
        x: CENTER_X,
        y: ARENA_CY - 20,
        size: FONT_BODY,
        color: C.accent,
        anchor: "center",
      });
      if (overBestText !== "") {
        drawLabel({
          text: overBestText,
          x: CENTER_X,
          y: ARENA_CY - 4,
          size: FONT_SMALL,
          color: overBestText === "NEW BEST" ? C.good : C.textDim,
          anchor: "center",
        });
      }
      drawHints({
        x: CENTER_X + 42,
        y: ARENA_CY + 16,
        align: "right",
        hints: [{ button: "a" }, { button: "start" }, { text: "AGAIN" }],
        color: C.text,
      });
      drawLabel({
        text: "HOLD BACK  MENU",
        x: CENTER_X,
        y: ARENA_CY + 40,
        size: FONT_SMALL,
        color: C.textDim,
        anchor: "center",
      });
    }

    // Last, so it survives the game over wash: the second slot is an open
    // invitation for as long as nobody has taken it.
    for (let p = 0; p < MAX_PLAYERS; p++) {
      if (players[p].joined) continue;
      if (Math.floor(k.time() * 1.6) % 2 === 0) continue;
      drawLabel({
        text: JOIN_TEXT[p],
        x: CENTER_X,
        y: ARENA_BOTTOM - 12 - p * 12,
        size: FONT_SMALL,
        color: playerColor(p),
        anchor: "center",
      });
    }
  });

  // Whoever pressed the button on the menu is already in.
  const starter = input.lastActivePlayer();
  players[starter >= 0 ? starter : 0].joined = true;
}

/* -------------------------------------------------------------- preview -- */

/** Where the preview's swarm comes in from, as fractions of the box. */
const PREVIEW_EDGES: readonly (readonly [number, number])[] = [
  [0.04, 0.1],
  [0.96, 0.2],
  [0.5, 0.02],
  [0.02, 0.8],
  [0.98, 0.92],
  [0.62, 0.98],
];

/**
 * Menu preview: two figures back to back with the swarm closing on them.
 *
 * Everything is sized from the box — the menu draws this small on a card and
 * nearly full-bleed on the selected one.
 */
function drawPreview(x: number, y: number, w: number, h: number, t: number): void {
  const body = Math.max(3, h * 0.09);
  const cx = x + w / 2;
  const cy = y + h * 0.55;

  const p1x = cx - w * 0.1 + Math.sin(t * 1.1) * w * 0.04;
  const p1y = cy + Math.cos(t * 0.9) * h * 0.06;
  const p2x = cx + w * 0.1 - Math.sin(t * 0.8) * w * 0.04;
  const p2y = cy - Math.cos(t * 1.3) * h * 0.06;

  // The swarm: each one walks its own edge point to the middle and restarts,
  // so the card always has something arriving.
  for (let i = 0; i < PREVIEW_EDGES.length; i++) {
    const phase = (t * 0.34 + i / PREVIEW_EDGES.length) % 1;
    const [ex, ey] = PREVIEW_EDGES[i];
    const toward = i % 2 === 0 ? 1 : 0;
    const tx = toward === 0 ? p1x : p2x;
    const ty = toward === 0 ? p1y : p2y;
    const sx = x + ex * w;
    const sy = y + ey * h;
    const size = i % 3 === 1 ? body * 0.8 : body;
    drawBox({
      x: sx + (tx - sx) * phase - size / 2,
      y: sy + (ty - sy) * phase - size / 2,
      w: size,
      h: size,
      color: i % 3 === 1 ? C.tetT : C.tetL,
    });
  }

  // Shots, on the diagonals the pair are covering between them. Kept inside
  // the box the menu handed us — a card is drawn hard up against its border.
  const shot = Math.max(1.5, body * 0.3);
  for (let i = 0; i < 3; i++) {
    const phase = (t * 1.5 + i / 3) % 1;
    const reachX = w * 0.34 * phase;
    const reachY = h * 0.3 * phase;
    // Out to either side, not along one line: two players covering different
    // angles is the whole card, and collinear trails read as one dashed line.
    drawBox({ x: p1x - reachX, y: p1y - reachY - shot / 2, w: shot, h: shot, color: C.white });
    drawBox({ x: p2x + reachX, y: p2y - reachY - shot / 2, w: shot, h: shot, color: C.white });
  }

  drawBox({ x: p1x - body / 2, y: p1y - body / 2, w: body, h: body, color: C.p1 });
  drawBox({ x: p2x - body / 2, y: p2y - body / 2, w: body, h: body, color: C.p2 });
}

/**
 * Options-screen sample: the shot and the countdown, the two things this game
 * sizes from the setting. Nothing else on the field scales — a body is a
 * hitbox, and a hitbox measured against a fixed arena is the difficulty.
 */
function drawScaleSample(x: number, y: number, w: number, h: number): void {
  const bulletSize = scaleUnits(BULLET_BASE);
  const countSize = scaleUnits(FONT_HUGE);
  const captionY = y + h - FONT_SMALL * 2 - 2;
  const midY = (y + captionY) / 2;

  drawLabel({
    text: "3",
    x: x + w * 0.32,
    y: midY - countSize / 2,
    size: countSize,
    color: C.accent,
    anchor: "center",
  });
  drawBox({
    x: x + w * 0.66 - BODY / 2,
    y: midY - BODY / 2,
    w: BODY,
    h: BODY,
    color: C.p1,
  });
  drawBox({
    x: x + w * 0.66 + BODY / 2 + 4,
    y: midY - bulletSize / 2,
    w: bulletSize,
    h: bulletSize,
    color: C.white,
  });
  drawLabel({
    text: `SHOT ${bulletSize}`,
    x: x + w / 2,
    y: captionY,
    size: FONT_SMALL,
    color: C.textDim,
    anchor: "center",
  });
  drawLabel({
    text: `COUNT ${countSize}`,
    x: x + w / 2,
    y: captionY + FONT_SMALL + 2,
    size: FONT_SMALL,
    color: C.textDim,
    anchor: "center",
  });
}

export const lastStandGame: GameDefinition = {
  id: SCENE,
  title: "LAST STAND",
  tagline: "Waves of them. Pick your partner up.",
  players: "2P CO-OP",
  accent: "tetL",
  controls: [
    { buttons: ["up", "down", "left", "right"], label: "MOVE — AND AIM" },
    { buttons: ["a"], label: "FIRE — HOLD IT DOWN" },
    { buttons: ["b"], label: "HOLD TO KEEP YOUR AIM" },
    // The revive has no button of its own — being there is the input — but it
    // is the one rule of this game a player cannot look up anywhere else.
    { buttons: ["up", "down", "left", "right"], label: "REVIVE — STAND ON THEM" },
    { buttons: ["a", "start"], label: "JOIN IN / GO AGAIN" },
  ],
  drawPreview,
  drawScaleSample,
  register(): void {
    defineScene(SCENE, main);
  },
};

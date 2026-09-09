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
  CENTER_Y,
  drawBox,
  drawDot,
  drawLabel,
  FONT_HUGE,
  FONT_SMALL,
  FONT_TITLE,
  playerColor,
} from "../core/ui";

/**
 * Tarmac Brawl — a two-button-plus fighting game.
 *
 * The whole match is plain numbers in design units, stepped by hand and
 * painted in one `onDraw`: a fighter is six boxes, not six game objects, so
 * there is nothing to allocate or tear down between rounds.
 *
 * **The system is geometric, not special-cased.** Every attack is a rectangle
 * in world space and every fighter is a rectangle in world space; crouching
 * makes yours 60 units tall instead of 96, jumping lifts it off the floor.
 * That one fact is the whole game: a punch is aimed at chest height, so it
 * misses a croucher because it is literally above them; a sweep is aimed at
 * the floor, so it misses a jumper for the same reason. Nothing checks
 * "is crouching" to decide whether a punch lands.
 *
 * Blocking is the only rule layered on top, and it is two lines: standing
 * block stops high, mid and overhead; crouching block stops high, mid and low.
 * So a jump-in beats a crouch block, a sweep beats a standing block, and a
 * throw beats both — which is the triangle the game is played on.
 *
 * **Game scale.** As with Tetris, the answer here is *nothing on the field*.
 * A fighter's size is their reach, and reach measured against a fixed stage is
 * the entire spacing game: scaling the bodies up would not make the match
 * chunkier, it would make it a different match, with the corner two body
 * widths closer than it was tuned to be. So the setting drives what is read
 * rather than what is played — the round clock and the countdown.
 */

const SCENE = "brawl";

/* ---------------------------------------------------------------- stage -- */

/** Screen y of the floor: every fighter's feet rest here at height 0. */
const FLOOR_Y = 208;
const WALL_L = 14;
const WALL_R = DESIGN_WIDTH - 14;

/**
 * Backdrop blocks: width, then height above the floor. Static and drawn in
 * `bgAlt`, so the city is a silhouette the fight happens in front of rather
 * than anything the eye has to sort through.
 */
const SKYLINE: readonly (readonly [number, number])[] = [
  [44, 30],
  [30, 53],
  [58, 25],
  [38, 43],
  [52, 60],
  [32, 30],
  [60, 38],
  [40, 50],
  [46, 28],
  [54, 55],
  [36, 35],
  [50, 46],
];

/** A moon, so the sky is somewhere rather than a hole. */
const MOON_X = 252;
const MOON_Y = 74;
const MOON_R = 9;

/* --------------------------------------------------------------- bodies -- */

/**
 * A fighter is 96 units tall in a 240-unit box — two fifths of the screen, so
 * a guard, a crouch and an extended limb are separate silhouettes read from
 * across the room. The stage is still eight body widths wide, which is the
 * room the spacing game needs on a screen that never scrolls.
 */
const BODY_W = 34;
const STAND_H = 96;
const CROUCH_H = 60;
/** Legs tuck on the way up, so an airborne fighter is a smaller target. */
const AIR_H = 74;

const WALK_FWD = 133;
const WALK_BACK = 101;
const JUMP_VY = 389;
const JUMP_FWD = 117;
const GRAVITY = 1051;
/** Knockback bleed-off while grounded, in units/s². */
const FRICTION = 745;
/** Stick deflection past which a direction counts as pressed. */
const STICK = 0.3;

const START_OFFSET = 100;

/* ---------------------------------------------------------------- moves -- */

/**
 * How high an attack is aimed, for blocking purposes only — whether it
 * *reaches* the other fighter is decided by the rectangles.
 */
type Height = "high" | "mid" | "low" | "over";

interface Move {
  readonly name: string;
  readonly startup: number;
  readonly active: number;
  readonly recovery: number;
  readonly damage: number;
  /** Damage that gets through a block. */
  readonly chip: number;
  readonly height: Height;
  /** Hitbox in units from the fighter's centre, forward positive. */
  readonly x0: number;
  readonly x1: number;
  /** Hitbox in units above the fighter's own feet. */
  readonly y0: number;
  readonly y1: number;
  readonly hitstun: number;
  /** Pushback given to whoever was hit. */
  readonly push: number;
  /** Pushback the attacker takes when it is blocked. */
  readonly selfPush: number;
  readonly knockdown: boolean;
  /** Ignores block, and only reaches a grounded opponent. */
  readonly grab: boolean;
  readonly meterCost: number;
  readonly projectile: boolean;
  /** Meter earned for landing it, before the damage share. */
  readonly meterGain: number;
}

const PUNCH = 0;
const KICK = 1;
const LOW = 2;
const SWEEP = 3;
const AIR = 4;
const THROW = 5;
const FIRE = 6;

/**
 * The move table.
 *
 * Aimed heights are the readable part: a punch lives at 32..42 above the feet
 * and a standing fighter is 48 tall, so it lands; a crouching one is 30 tall,
 * so it sails over. A sweep lives at 0..12, under a jump. These numbers are
 * the balance — the block rules only decide what a guard absorbs.
 */
const MOVES: readonly Move[] = [
  {
    name: "PUNCH",
    startup: 0.06,
    active: 0.06,
    recovery: 0.16,
    damage: 6,
    chip: 0,
    height: "high",
    x0: 17,
    x1: 56,
    y0: 64,
    y1: 84,
    hitstun: 0.26,
    push: 60,
    selfPush: 44,
    knockdown: false,
    grab: false,
    meterCost: 0,
    projectile: false,
    meterGain: 3,
  },
  {
    name: "KICK",
    startup: 0.13,
    active: 0.08,
    recovery: 0.26,
    damage: 11,
    chip: 2,
    height: "mid",
    x0: 17,
    x1: 67,
    y0: 28,
    y1: 52,
    hitstun: 0.34,
    push: 116,
    selfPush: 60,
    knockdown: false,
    grab: false,
    meterCost: 0,
    projectile: false,
    meterGain: 5,
  },
  {
    name: "LOW",
    startup: 0.06,
    active: 0.06,
    recovery: 0.17,
    damage: 5,
    chip: 0,
    height: "low",
    x0: 17,
    x1: 53,
    y0: 8,
    y1: 32,
    hitstun: 0.24,
    push: 52,
    selfPush: 40,
    knockdown: false,
    grab: false,
    meterCost: 0,
    projectile: false,
    meterGain: 3,
  },
  {
    name: "SWEEP",
    startup: 0.15,
    active: 0.08,
    recovery: 0.34,
    damage: 10,
    chip: 2,
    height: "low",
    x0: 17,
    x1: 72,
    y0: 0,
    y1: 24,
    hitstun: 0.3,
    push: 144,
    selfPush: 68,
    knockdown: true,
    grab: false,
    meterCost: 0,
    projectile: false,
    meterGain: 6,
  },
  {
    name: "AIR",
    startup: 0.07,
    // Outlasts the jump, so the landing is what ends it: one jump is one
    // attack, rather than two if you press early enough.
    active: 0.7,
    recovery: 0.05,
    damage: 9,
    chip: 2,
    height: "over",
    x0: 12,
    x1: 59,
    y0: -12,
    y1: 40,
    hitstun: 0.32,
    push: 88,
    selfPush: 0,
    knockdown: false,
    grab: false,
    meterCost: 0,
    projectile: false,
    meterGain: 5,
  },
  {
    name: "THROW",
    startup: 0.1,
    active: 0.05,
    recovery: 0.42,
    damage: 15,
    chip: 0,
    height: "mid",
    x0: 17,
    x1: 59,
    y0: 0,
    y1: 84,
    hitstun: 0.3,
    push: 172,
    selfPush: 0,
    knockdown: true,
    grab: true,
    meterCost: 0,
    projectile: false,
    meterGain: 8,
  },
  {
    name: "FIRE",
    startup: 0.18,
    active: 0.04,
    recovery: 0.34,
    damage: 0,
    chip: 0,
    height: "mid",
    x0: 0,
    x1: 0,
    y0: 0,
    y1: 0,
    hitstun: 0,
    push: 0,
    selfPush: 0,
    knockdown: false,
    grab: false,
    meterCost: 30,
    projectile: true,
    meterGain: 0,
  },
];

/* ----------------------------------------------------------- projectile -- */

const SHOT_SPEED = 280;
const SHOT_W = 24;
const SHOT_H = 17;
/**
 * Chest height, deliberately clear of a 60-unit crouch: the fireball is
 * ducked by geometry, the same way a punch is.
 */
const SHOT_Y = 67;
const SHOT_DAMAGE = 9;
const SHOT_CHIP = 2;
const SHOT_HITSTUN = 0.32;
const SHOT_PUSH = 96;

/* ----------------------------------------------------------- match flow -- */

const MAX_HEALTH = 100;
const MAX_METER = 90;
const METER_PIP = 30;
const PIPS = MAX_METER / METER_PIP;

const ROUND_TIME = 60;
const WINS_NEEDED = 2;
/** Rounds a best-of-`WINS_NEEDED` match can reach. */
const MAX_ROUNDS = WINS_NEEDED * 2 - 1;

const READY_TIME = 3;
const FIGHT_FLASH = 0.7;
const ROUND_OVER_TIME = 2.2;
const KNOCKDOWN_TIME = 0.8;
/** Health the ghost bar gives back per second, chasing the real value. */
const GHOST_RATE = 46;

type Phase = "ready" | "play" | "roundOver" | "matchOver";

/** Built once — `onDraw` must not allocate. */
const COUNTDOWN_TEXT = ["0", "1", "2", "3"] as const;
const ROUND_TEXT: readonly string[] = Array.from(
  { length: MAX_ROUNDS },
  (_, i) => `ROUND ${i + 1}`,
);
const WIN_TEXT = ["PLAYER 1 WINS", "PLAYER 2 WINS"] as const;
const ROUND_WIN_TEXT = ["P1 TAKES IT", "P2 TAKES IT"] as const;

/* ------------------------------------------------------------------ HUD -- */

const BAR_W = 116;
const BAR_H = 11;
const BAR_Y = 16;
const BAR_L = 6;
const BAR_R = DESIGN_WIDTH - BAR_L - BAR_W;
const PIP_Y = 29;
const PIP_W = 10;
const PIP_H = 6;

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: Color;
}

interface Fighter {
  readonly slot: number;
  /** Centre of the body. */
  x: number;
  /** Height of the feet above the floor; 0 when grounded. */
  y: number;
  vy: number;
  /** Knockback only — walking is applied straight to `x`. */
  vx: number;
  facing: number;
  /** Current hurtbox height, kept in step with what is drawn. */
  h: number;
  health: number;
  /** Lags `health` down, for the drain bar. */
  ghost: number;
  meter: number;
  wins: number;
  crouching: boolean;
  blocking: boolean;
  /** Index into `MOVES`, or -1. */
  atk: number;
  atkTime: number;
  atkHit: boolean;
  atkFired: boolean;
  hitstun: number;
  blockstun: number;
  downTime: number;
  flash: number;
  walkAnim: number;
  /** Set the frame a hit lands, so the loser's pose survives the round end. */
  dead: boolean;
}

interface Shot {
  live: boolean;
  x: number;
  dir: number;
  owner: number;
}

function main(): void {
  installQuitToMenu();

  // Read once per scene entry: the clock must not resize under a round, and
  // nothing else in this game follows the setting.
  const clockSize = scaleUnits(FONT_TITLE);
  const countdownSize = scaleUnits(FONT_HUGE);

  const fighters: readonly Fighter[] = Array.from({ length: MAX_PLAYERS }, (_, slot) => ({
    slot,
    x: CENTER_X,
    y: 0,
    vy: 0,
    vx: 0,
    facing: slot === 0 ? 1 : -1,
    h: STAND_H,
    health: MAX_HEALTH,
    ghost: MAX_HEALTH,
    meter: 0,
    wins: 0,
    crouching: false,
    blocking: false,
    atk: -1,
    atkTime: 0,
    atkHit: false,
    atkFired: false,
    hitstun: 0,
    blockstun: 0,
    downTime: 0,
    flash: 0,
    walkAnim: 0,
    dead: false,
  }));

  /** One in flight per player, so a fireball war cannot fill the screen. */
  const shots: readonly Shot[] = Array.from({ length: MAX_PLAYERS }, () => ({
    live: false,
    x: 0,
    dir: 1,
    owner: 0,
  }));

  const sparks = makePool<Spark>(56, () => ({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    size: 2,
    color: C.white,
  }));

  let phase: Phase = "ready";
  let phaseTimer = READY_TIME;
  let roundTimer = ROUND_TIME;
  let round = 0;
  let roundWinner = -1;
  let matchWinner = -1;
  let fightFlash = 0;
  let shakeUntil = 0;

  function emitSparks(
    x: number,
    y: number,
    dirX: number,
    color: Color,
    count: number,
    size: number,
  ): void {
    for (let i = 0; i < count; i++) {
      const s = sparks.spawn();
      s.x = x;
      s.y = y;
      s.vx = dirX * k.rand(30, 150);
      s.vy = k.rand(-110, 60);
      s.life = k.rand(0.14, 0.34);
      s.size = size;
      s.color = color;
    }
  }

  function startRound(): void {
    for (let p = 0; p < MAX_PLAYERS; p++) {
      const f = fighters[p];
      f.x = CENTER_X + (p === 0 ? -START_OFFSET : START_OFFSET);
      f.y = 0;
      f.vy = 0;
      f.vx = 0;
      f.facing = p === 0 ? 1 : -1;
      f.h = STAND_H;
      f.health = MAX_HEALTH;
      f.ghost = MAX_HEALTH;
      // Meter carries between rounds — it is the one thing a round win is
      // worth beyond the point itself.
      f.crouching = false;
      f.blocking = false;
      f.atk = -1;
      f.atkTime = 0;
      f.hitstun = 0;
      f.blockstun = 0;
      f.downTime = 0;
      f.flash = 0;
      f.dead = false;
    }
    for (let p = 0; p < MAX_PLAYERS; p++) shots[p].live = false;
    sparks.clear();
    roundTimer = ROUND_TIME;
    roundWinner = -1;
    phase = "ready";
    phaseTimer = READY_TIME;
  }

  function startMatch(): void {
    for (let p = 0; p < MAX_PLAYERS; p++) {
      fighters[p].wins = 0;
      fighters[p].meter = 0;
    }
    round = 0;
    matchWinner = -1;
    startRound();
  }

  function endRound(winner: number): void {
    // Chip damage, a fireball still in the air and a blow landing on the same
    // frame can all reach for the round end; only the first one gets it.
    if (phase !== "play") return;
    roundWinner = winner;
    if (winner >= 0) fighters[winner].wins++;
    round++;
    shakeUntil = k.time() + 0.4;
    phase = fighters[0].wins >= WINS_NEEDED || fighters[1].wins >= WINS_NEEDED
      ? "matchOver"
      : "roundOver";
    phaseTimer = ROUND_OVER_TIME;
    if (phase === "matchOver") {
      matchWinner = fighters[0].wins >= WINS_NEEDED ? 0 : 1;
    }
    // Nothing in flight gets to land on a round that is already decided.
    for (let p = 0; p < MAX_PLAYERS; p++) shots[p].live = false;
  }

  /** Body height for the current pose — the hurtbox and the drawing share it. */
  function bodyHeight(f: Fighter): number {
    if (f.downTime > 0 || f.dead) return 28;
    if (f.y > 0) return AIR_H;
    if (f.crouching || f.atk === LOW || f.atk === SWEEP) return CROUCH_H;
    return STAND_H;
  }

  function addMeter(f: Fighter, amount: number): void {
    f.meter = Math.min(MAX_METER, f.meter + amount);
  }

  /** Whether `f`'s guard covers an attack aimed at `height`. */
  function guards(f: Fighter, height: Height): boolean {
    if (!f.blocking) return false;
    if (height === "over") return !f.crouching;
    if (height === "low") return f.crouching;
    return true;
  }

  function applyHit(
    attacker: Fighter,
    defender: Fighter,
    move: Move,
    hitX: number,
    hitY: number,
  ): void {
    const dir = attacker.facing;
    const blocked = !move.grab && guards(defender, move.height);

    if (blocked) {
      defender.health -= move.chip;
      defender.blockstun = move.hitstun * 0.72;
      defender.vx = dir * move.push * 0.55;
      attacker.vx = -dir * move.selfPush;
      addMeter(defender, move.chip + 2);
      addMeter(attacker, 1);
      emitSparks(hitX, hitY, dir, C.accent, 4, 2);
    } else {
      defender.health -= move.damage;
      defender.hitstun = move.hitstun;
      defender.blockstun = 0;
      defender.flash = 0.1;
      defender.atk = -1;
      // Guard drops the moment something gets through it. Without this the
      // stale flag would still be standing when the next hit arrives, and
      // nothing could ever be chained into anything.
      defender.blocking = false;
      defender.vx = dir * move.push;
      addMeter(attacker, move.meterGain + move.damage * 0.35);
      addMeter(defender, move.damage * 0.5);
      emitSparks(hitX, hitY, dir, C.white, move.damage >= 10 ? 9 : 5, move.damage >= 10 ? 3 : 2);
      if (move.knockdown) {
        defender.downTime = KNOCKDOWN_TIME;
        defender.hitstun = 0;
        // Off the floor a little, so the knockdown reads as one.
        if (defender.y <= 0) defender.vy = -90;
      }
      if (move.damage >= 10) shakeUntil = k.time() + 0.16;
    }

    if (defender.health <= 0) {
      defender.health = 0;
      defender.dead = true;
      defender.downTime = 0;
      defender.atk = -1;
      defender.vx = dir * 120;
      defender.vy = -170;
      emitSparks(hitX, hitY, dir, playerColor(attacker.slot), 14, 3);
      endRound(attacker.slot);
    }
  }

  /** Can `f` act at all this frame? */
  function actionable(f: Fighter): boolean {
    return (
      phase === "play" &&
      !f.dead &&
      f.downTime <= 0 &&
      f.hitstun <= 0 &&
      f.blockstun <= 0 &&
      f.atk < 0
    );
  }

  function startAttack(f: Fighter, move: number): void {
    const m = MOVES[move];
    if (f.meter < m.meterCost) return;
    f.meter -= m.meterCost;
    f.atk = move;
    f.atkTime = 0;
    f.atkHit = false;
    f.atkFired = false;
  }

  function readInput(f: Fighter, other: Fighter, dt: number): void {
    const p = f.slot;
    const grounded = f.y <= 0;

    if (phase !== "play" || f.dead) {
      f.crouching = false;
      f.blocking = false;
      return;
    }

    // Face the opponent whenever there is nothing committed — mid-attack and
    // mid-jump the facing is locked, which is what makes a crossup possible.
    if (grounded && f.atk < 0 && f.hitstun <= 0 && f.downTime <= 0) {
      const gap = other.x - f.x;
      if (Math.abs(gap) > 1) f.facing = gap > 0 ? 1 : -1;
    }

    const ax = input.axisX(p);
    const forward = ax * f.facing;
    const holdingDown = input.down(p, "down") || input.axisY(p) > STICK;

    if (f.downTime > 0 || f.hitstun > 0 || f.blockstun > 0) {
      f.crouching = holdingDown && grounded && f.blocking;
      return;
    }

    f.crouching = grounded && holdingDown && f.atk < 0;
    // Away from the opponent, on the ground, with nothing else going on.
    f.blocking = grounded && f.atk < 0 && forward < -STICK;

    if (!actionable(f)) {
      // An attack is running: it still owns the body, but keep the crouch
      // posture for LOW/SWEEP so the hurtbox matches the drawing.
      if (f.atk === LOW || f.atk === SWEEP) f.crouching = true;
      return;
    }

    // --- attacks ---
    if (!grounded) {
      if (input.pressed(p, "a") || input.pressed(p, "b")) startAttack(f, AIR);
      return;
    }
    if (input.pressed(p, "y")) {
      startAttack(f, THROW);
      return;
    }
    if (input.pressed(p, "x")) {
      if (f.meter >= MOVES[FIRE].meterCost && !shots[p].live) startAttack(f, FIRE);
      return;
    }
    if (input.pressed(p, "a")) {
      startAttack(f, f.crouching ? LOW : PUNCH);
      return;
    }
    if (input.pressed(p, "b")) {
      startAttack(f, f.crouching ? SWEEP : KICK);
      return;
    }

    // --- movement ---
    // Holding up hops again the moment you land, the way a fighter should.
    if (input.down(p, "up") || input.axisY(p) < -STICK) {
      f.vy = -JUMP_VY;
      f.y = 0.01;
      f.vx = Math.abs(forward) > STICK ? Math.sign(forward) * f.facing * JUMP_FWD : 0;
      f.crouching = false;
      return;
    }
    if (f.crouching) return;
    // Backing off and guarding are the same input, as they should be: you
    // walk away and the guard is simply up while you do it. Returning early
    // on `blocking` here would mean a player who wants to block can never
    // retreat, which takes the spacing game out of the game.
    if (Math.abs(ax) > STICK) {
      const speed = forward > 0 ? WALK_FWD : WALK_BACK;
      f.x += Math.sign(ax) * speed * dt;
      f.walkAnim += dt * 9;
    } else {
      f.walkAnim = 0;
    }
  }

  function stepPhysics(f: Fighter, dt: number): void {
    if (f.y > 0 || f.vy !== 0) {
      f.vy += GRAVITY * dt;
      f.y -= f.vy * dt;
      f.x += f.vx * dt;
      if (f.y <= 0) {
        f.y = 0;
        f.vy = 0;
        // Landing eats a jump attack, which is what limits a jump-in to one.
        if (f.atk === AIR) f.atk = -1;
        if (!f.dead && f.downTime <= 0) f.vx = 0;
        else f.vx *= 0.4;
      }
    } else if (f.vx !== 0) {
      f.x += f.vx * dt;
      const drop = FRICTION * dt;
      f.vx = Math.abs(f.vx) <= drop ? 0 : f.vx - Math.sign(f.vx) * drop;
    }

    const half = BODY_W / 2;
    f.x = k.clamp(f.x, WALL_L + half, WALL_R - half);
  }

  function stepAttack(f: Fighter, other: Fighter, dt: number): void {
    if (f.atk < 0) return;
    const m = MOVES[f.atk];
    f.atkTime += dt;

    if (m.projectile) {
      if (!f.atkFired && f.atkTime >= m.startup) {
        f.atkFired = true;
        const shot = shots[f.slot];
        shot.live = true;
        shot.owner = f.slot;
        shot.dir = f.facing;
        shot.x = f.x + f.facing * (BODY_W / 2 + SHOT_W / 2);
        emitSparks(shot.x, FLOOR_Y - SHOT_Y, f.facing, playerColor(f.slot), 5, 2);
      }
    } else if (!f.atkHit && f.atkTime >= m.startup && f.atkTime < m.startup + m.active) {
      tryHit(f, other, m);
    }

    if (f.atkTime >= m.startup + m.active + m.recovery) f.atk = -1;
  }

  function tryHit(f: Fighter, other: Fighter, m: Move): void {
    if (other.dead || other.downTime > 0) return;
    // A throw needs someone on the ground to grab.
    if (m.grab && other.y > 0) return;

    const hx0 = f.facing > 0 ? f.x + m.x0 : f.x - m.x1;
    const hx1 = f.facing > 0 ? f.x + m.x1 : f.x - m.x0;
    const half = BODY_W / 2;
    if (hx1 < other.x - half || hx0 > other.x + half) return;

    // Screen space: y grows downward, so the top of a box is the larger height.
    const hTop = FLOOR_Y - f.y - m.y1;
    const hBottom = FLOOR_Y - f.y - m.y0;
    const bTop = FLOOR_Y - other.y - other.h;
    const bBottom = FLOOR_Y - other.y;
    if (hBottom < bTop || hTop > bBottom) return;

    f.atkHit = true;
    const contactX = f.facing > 0 ? Math.min(hx1, other.x) : Math.max(hx0, other.x);
    const contactY = Math.max(hTop, bTop) + Math.min(hBottom - hTop, bBottom - bTop) / 2;
    applyHit(f, other, m, contactX, contactY);
  }

  function stepShot(shot: Shot, dt: number): void {
    if (!shot.live) return;
    shot.x += shot.dir * SHOT_SPEED * dt;
    if (shot.x < WALL_L - SHOT_W || shot.x > WALL_R + SHOT_W) {
      shot.live = false;
      return;
    }

    const target = fighters[shot.owner === 0 ? 1 : 0];
    if (target.dead || target.downTime > 0) return;

    const half = BODY_W / 2;
    if (shot.x + SHOT_W / 2 < target.x - half || shot.x - SHOT_W / 2 > target.x + half) return;
    const sTop = FLOOR_Y - SHOT_Y - SHOT_H;
    const sBottom = FLOOR_Y - SHOT_Y;
    const bTop = FLOOR_Y - target.y - target.h;
    const bBottom = FLOOR_Y - target.y;
    if (sBottom < bTop || sTop > bBottom) return;

    shot.live = false;
    const owner = fighters[shot.owner];
    const blocked = guards(target, "mid");
    const hitY = (Math.max(sTop, bTop) + Math.min(sBottom, bBottom)) / 2;

    if (blocked) {
      target.health -= SHOT_CHIP;
      target.blockstun = SHOT_HITSTUN * 0.72;
      target.vx = shot.dir * SHOT_PUSH * 0.6;
      addMeter(target, SHOT_CHIP + 2);
      emitSparks(shot.x, hitY, shot.dir, C.accent, 5, 2);
    } else {
      target.health -= SHOT_DAMAGE;
      target.hitstun = SHOT_HITSTUN;
      target.flash = 0.1;
      target.atk = -1;
      target.blocking = false;
      target.vx = shot.dir * SHOT_PUSH;
      addMeter(target, SHOT_DAMAGE * 0.5);
      emitSparks(shot.x, hitY, shot.dir, playerColor(shot.owner), 8, 3);
      shakeUntil = k.time() + 0.12;
    }

    if (target.health <= 0) {
      target.health = 0;
      target.dead = true;
      target.atk = -1;
      target.vx = shot.dir * 120;
      target.vy = -170;
      endRound(owner.slot);
    }
  }

  /** Fighters are solid: neither can walk through the other. */
  function separate(): void {
    const a = fighters[0];
    const b = fighters[1];
    // A knocked-out body is scenery, not an obstacle — shoving it along the
    // floor on the victory lap looks like a bug.
    if (a.dead || b.dead) return;
    const gap = b.x - a.x;
    const dist = Math.abs(gap);
    if (dist >= BODY_W) return;
    const push = (BODY_W - dist) / 2;
    const dir = gap === 0 ? 1 : Math.sign(gap);
    const half = BODY_W / 2;
    a.x = k.clamp(a.x - dir * push, WALL_L + half, WALL_R - half);
    b.x = k.clamp(b.x + dir * push, WALL_L + half, WALL_R - half);
  }

  k.onUpdate(() => {
    const dt = k.dt();

    if (phase === "ready") {
      phaseTimer -= dt;
      if (phaseTimer <= 0) {
        phase = "play";
        fightFlash = FIGHT_FLASH;
      }
    } else if (phase === "play") {
      roundTimer -= dt;
      if (fightFlash > 0) fightFlash -= dt;
      if (roundTimer <= 0) {
        roundTimer = 0;
        const h0 = fighters[0].health;
        const h1 = fighters[1].health;
        endRound(h0 === h1 ? -1 : h0 > h1 ? 0 : 1);
      }
    } else if (phase === "roundOver") {
      phaseTimer -= dt;
      if (phaseTimer <= 0) startRound();
    } else if (input.anyPressed("a") || input.anyPressed("start")) {
      startMatch();
      return;
    }

    for (let p = 0; p < MAX_PLAYERS; p++) {
      const f = fighters[p];
      const other = fighters[p === 0 ? 1 : 0];

      if (f.hitstun > 0) f.hitstun = Math.max(0, f.hitstun - dt);
      if (f.blockstun > 0) f.blockstun = Math.max(0, f.blockstun - dt);
      if (f.flash > 0) f.flash = Math.max(0, f.flash - dt);
      if (f.downTime > 0 && f.y <= 0) f.downTime = Math.max(0, f.downTime - dt);

      readInput(f, other, dt);
      stepPhysics(f, dt);
      stepAttack(f, other, dt);
      f.h = bodyHeight(f);

      // The drain bar catches up to the real number a beat after the hit.
      if (f.ghost > f.health) f.ghost = Math.max(f.health, f.ghost - GHOST_RATE * dt);
      else f.ghost = f.health;
    }

    separate();
    for (let p = 0; p < MAX_PLAYERS; p++) stepShot(shots[p], dt);

    sparks.each((s) => {
      s.life -= dt;
      if (s.life <= 0) return false;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 300 * dt;
      return true;
    });

    // Shake lives in camera space, which is device pixels.
    if (k.time() < shakeUntil) k.shake(pu(0.7));
  });

  /* ------------------------------------------------------------- draw -- */

  function drawStage(): void {
    drawDot({ x: MOON_X, y: MOON_Y, radius: MOON_R, color: C.bgAlt });

    let x = -6;
    for (let i = 0; i < SKYLINE.length && x < DESIGN_WIDTH; i++) {
      const [w, h] = SKYLINE[i];
      drawBox({ x, y: FLOOR_Y - h, w, h, color: C.bgAlt });
      x += w + 4;
    }
    drawBox({ x: 0, y: FLOOR_Y, w: DESIGN_WIDTH, h: DESIGN_HEIGHT - FLOOR_Y, color: C.bgAlt });
    drawBox({ x: 0, y: FLOOR_Y, w: DESIGN_WIDTH, h: 1, color: C.dim });
    // The walls, so being pinned in the corner is something you can see.
    drawBox({ x: WALL_L - 3, y: FLOOR_Y - 26, w: 3, h: 26, color: C.dim });
    drawBox({ x: WALL_R, y: FLOOR_Y - 26, w: 3, h: 26, color: C.dim });
  }

  /** 0..1 along a move: cocked, out, then pulled back in. */
  function swing(f: Fighter, m: Move): number {
    if (f.atkTime < m.startup) return 0.25 * (f.atkTime / m.startup);
    const spent = m.startup + m.active;
    if (f.atkTime < spent) return 1;
    return Math.max(0.15, 1 - (f.atkTime - spent) / m.recovery);
  }

  /**
   * One fighter, as boxes.
   *
   * The active limb is drawn in white rather than the player's colour: at this
   * size the single most important thing to read across the cabinet is whether
   * something is *out* right now, and a hue change carries that faster than a
   * shape change does.
   */
  function drawFighter(f: Fighter): void {
    const own = playerColor(f.slot);
    const body = f.flash > 0.02 ? C.white : own;
    const feet = FLOOR_Y - f.y;
    const cx = f.x;
    const fw = f.facing;
    const m = f.atk >= 0 ? MOVES[f.atk] : null;
    const active =
      m !== null && f.atkTime >= m.startup && f.atkTime < m.startup + m.active;
    const limb = active ? C.white : body;
    /**
     * How far through its swing the striking limb is, 0..1.
     *
     * The limb is drawn for the whole move rather than only on the frames it
     * can hit: six hundredths of a second is three frames, and a punch that
     * only exists for three frames reads as a flicker instead of a punch. It
     * winds up, snaps out, and pulls back — and the white is reserved for the
     * frames that actually connect, which is the part worth reading exactly.
     */
    const ext = m === null ? 0 : swing(f, m);

    // Airborne shadow, so height off the floor is readable at a glance.
    if (f.y > 2 && !f.dead) {
      const shrink = Math.min(13, f.y / 7);
      drawBox({
        x: cx - BODY_W / 2 + shrink / 2,
        y: FLOOR_Y - 3,
        w: BODY_W - shrink,
        h: 3,
        color: C.dim,
        opacity: 0.5,
      });
    }

    // Knocked down or knocked out: flat on the floor, head at the far end.
    if (f.dead || f.downTime > 0) {
      // Laid out flat: torso in the middle, head past the far end and legs
      // past the near one, all on the floor. A slab with a head stacked on
      // top of it reads as a crouch, which is the one thing it must not.
      const back = -fw;
      // A body on its back is 92 units wide where a standing one is 34, so it
      // is the one pose that has to be held inside the screen by hand.
      const lx = k.clamp(cx, 46, DESIGN_WIDTH - 46);
      drawBox({ x: lx - 22, y: feet - 20, w: 44, h: 20, color: body });
      drawBox({
        x: back > 0 ? lx + 22 : lx - 46,
        y: feet - 24,
        w: 24,
        h: 24,
        color: body,
      });
      drawBox({
        x: back > 0 ? lx - 44 : lx + 22,
        y: feet - 13,
        w: 22,
        h: 13,
        color: body,
      });
      return;
    }

    const h = f.h;
    const headH = h <= CROUCH_H ? 20 : 24;
    const legH = h <= CROUCH_H ? 12 : h === AIR_H ? 23 : 32;
    const torsoH = h - headH - legH;
    const top = feet - h;
    const torsoY = top + headH;
    const legY = torsoY + torsoH;
    const shoulderY = torsoY + 5;
    // Lean away from the blow while it hurts.
    const lean = f.hitstun > 0 ? -fw * 5 : 0;

    // Legs.
    const stride =
      f.walkAnim > 0 && f.atk < 0 && f.y <= 0 ? Math.sin(f.walkAnim) * 5 : 0;
    if (f.atk === KICK || f.atk === SWEEP || f.atk === AIR) {
      // The kicking leg is the attack: one long box straight out, at the
      // height the move is aimed.
      const move = MOVES[f.atk];
      const full = move.x1 - 12;
      const reach = Math.max(6, 14 + ext * (full - 14));
      const legTop = f.atk === KICK ? feet - 51 : f.atk === SWEEP ? feet - 18 : feet - 12;
      drawBox({ x: cx - 13, y: legY, w: 12, h: Math.max(8, legH - 4), color: body });
      drawBox({
        x: fw > 0 ? cx + 12 : cx - reach - 12,
        y: legTop,
        w: reach,
        h: 13,
        color: limb,
      });
    } else if (f.y > 0) {
      // Tucked, and angled the way the jump is going.
      drawBox({ x: cx - 15 + stride, y: legY, w: 12, h: legH, color: body });
      drawBox({ x: cx + 4 + fw * 4, y: legY, w: 12, h: legH - 6, color: body });
    } else {
      drawBox({ x: cx - 15 - stride, y: legY, w: 12, h: legH, color: body });
      drawBox({ x: cx + 4 + stride, y: legY, w: 12, h: legH, color: body });
    }

    // Torso and head.
    drawBox({ x: cx - 16 + lean, y: torsoY, w: 32, h: torsoH, color: body });
    drawBox({ x: cx - 11 + fw * 4 + lean, y: top, w: 22, h: headH, color: body });
    // A notch of background on the leading edge of the head reads as a face.
    drawBox({
      x: fw > 0 ? cx + 5 + lean : cx - 11 + lean,
      y: top + 7,
      w: 6,
      h: 6,
      color: C.bg,
    });

    // Arms.
    if (f.blocking) {
      // A guard bar in the accent colour: the one pose that must never be
      // confused with an idle stance.
      drawBox({ x: cx - 7, y: shoulderY, w: 16, h: 12, color: body });
      drawBox({
        x: fw > 0 ? cx + 13 : cx - 21,
        y: torsoY - 3,
        w: 8,
        h: torsoH + 6,
        color: C.accent,
      });
    } else if (f.atk === PUNCH || f.atk === LOW) {
      const move = MOVES[f.atk];
      const armY = f.atk === PUNCH ? shoulderY + 3 : feet - 30;
      const full = move.x1 - 11;
      const reach = Math.max(6, 12 + ext * (full - 12));
      drawBox({
        x: fw > 0 ? cx + 11 : cx - reach - 11,
        y: armY,
        w: reach,
        h: 12,
        color: limb,
      });
    } else if (f.atk === THROW) {
      const reach = Math.max(12, 24 + ext * (MOVES[THROW].x1 - 11 - 24));
      drawBox({
        x: fw > 0 ? cx + 11 : cx - reach - 11,
        y: shoulderY,
        w: reach,
        h: 11,
        color: limb,
      });
      drawBox({
        x: fw > 0 ? cx + 11 : cx - reach - 11,
        y: shoulderY + 16,
        w: reach,
        h: 11,
        color: limb,
      });
    } else if (f.atk === FIRE) {
      const reach = 12 + ext * 20;
      drawBox({
        x: fw > 0 ? cx + 11 : cx - reach - 11,
        y: shoulderY + 7,
        w: reach,
        h: 15,
        // Stays the player's colour even as it fires: white is reserved for a
        // limb that can actually hit you, and this one never can.
        color: own,
      });
    } else {
      // Idle: one arm tucked across, one hanging — enough to not read as a
      // block, which is the only pose that matters to tell apart.
      drawBox({ x: cx - 7 + lean, y: shoulderY, w: 16, h: 11, color: body });
      drawBox({ x: fw > 0 ? cx + 12 : cx - 19, y: shoulderY + 4, w: 7, h: 19, color: body });
    }
  }

  function drawShot(shot: Shot): void {
    if (!shot.live) return;
    const color = playerColor(shot.owner);
    drawBox({
      x: shot.x - SHOT_W / 2,
      y: FLOOR_Y - SHOT_Y - SHOT_H,
      w: SHOT_W,
      h: SHOT_H,
      color,
    });
    // A short tail, so which way it is going is never in question.
    drawBox({
      x: shot.dir > 0 ? shot.x - SHOT_W / 2 - 12 : shot.x + SHOT_W / 2,
      y: FLOOR_Y - SHOT_Y - SHOT_H + 4,
      w: 12,
      h: SHOT_H - 8,
      color,
      opacity: 0.5,
    });
    drawBox({
      x: shot.x - SHOT_W / 2 + 5,
      y: FLOOR_Y - SHOT_Y - SHOT_H + 5,
      w: SHOT_W - 10,
      h: SHOT_H - 10,
      color: C.white,
    });
  }

  function drawHud(): void {
    const blink = Math.floor(k.time() * 6) % 2 === 0;

    for (let p = 0; p < MAX_PLAYERS; p++) {
      const f = fighters[p];
      const barX = p === 0 ? BAR_L : BAR_R;
      const own = playerColor(p);
      const frac = Math.max(0, f.health) / MAX_HEALTH;
      const ghostFrac = Math.max(0, f.ghost) / MAX_HEALTH;
      const low = f.health <= 25 && f.health > 0;

      drawBox({ x: barX, y: BAR_Y, w: BAR_W, h: BAR_H, color: C.bg, outline: C.dim });
      // Ghost first, so the real bar sits on top of it.
      if (ghostFrac > frac) {
        const gw = BAR_W * ghostFrac;
        drawBox({
          x: p === 0 ? barX : barX + BAR_W - gw,
          y: BAR_Y + 1,
          w: Math.max(1, gw),
          h: BAR_H - 2,
          color: C.bad,
        });
      }
      if (frac > 0 && !(low && !blink)) {
        const fwidth = Math.max(1, BAR_W * frac);
        drawBox({
          x: p === 0 ? barX : barX + BAR_W - fwidth,
          y: BAR_Y + 1,
          w: fwidth,
          h: BAR_H - 2,
          color: own,
        });
      }

      drawLabel({
        text: p === 0 ? "P1" : "P2",
        x: p === 0 ? BAR_L : DESIGN_WIDTH - BAR_L,
        y: 3,
        size: FONT_SMALL,
        color: own,
        anchor: p === 0 ? "left" : "right",
      });

      // Round wins are dots beside the name; meter is a segmented gauge under
      // the bar. Different shapes on different rows, because the two are read
      // for completely different reasons and must never be confused.
      for (let i = 0; i < WINS_NEEDED; i++) {
        drawDot({
          x: p === 0 ? BAR_L + 26 + i * 12 : DESIGN_WIDTH - BAR_L - 26 - i * 12,
          y: 8,
          radius: 4.5,
          color: f.wins > i ? own : C.bgAlt,
        });
      }
      for (let i = 0; i < PIPS; i++) {
        const filled = f.meter >= (i + 1) * METER_PIP;
        const px0 = p === 0 ? barX + i * (PIP_W + 3) : barX + BAR_W - PIP_W - i * (PIP_W + 3);
        drawBox({
          x: px0,
          y: PIP_Y,
          w: PIP_W,
          h: PIP_H,
          color: filled ? C.accent : C.bg,
          outline: C.dim,
        });
      }
    }

    const seconds = Math.ceil(roundTimer);
    drawLabel({
      text: String(seconds),
      x: CENTER_X,
      y: 4,
      size: clockSize,
      color: seconds <= 10 && phase === "play" && blink ? C.bad : C.accent,
      anchor: "center",
    });
  }

  k.onDraw(() => {
    drawStage();

    for (let p = 0; p < MAX_PLAYERS; p++) drawShot(shots[p]);
    // Order matters at close range, where a limb is inside the other body:
    // the fighter with something out goes on top, or the attack that just
    // landed is hidden behind the fighter it landed on. Losers go under both.
    for (let p = 0; p < MAX_PLAYERS; p++) if (fighters[p].dead) drawFighter(fighters[p]);
    for (let p = 0; p < MAX_PLAYERS; p++) {
      const f = fighters[p];
      if (!f.dead && f.atk < 0) drawFighter(f);
    }
    for (let p = 0; p < MAX_PLAYERS; p++) {
      const f = fighters[p];
      if (!f.dead && f.atk >= 0) drawFighter(f);
    }

    sparks.each((s) => {
      drawBox({
        x: s.x,
        y: s.y,
        w: s.size,
        h: s.size,
        color: s.color,
        opacity: Math.min(1, s.life * 4),
      });
      return true;
    });

    drawHud();

    if (phase === "ready") {
      drawLabel({
        text: ROUND_TEXT[Math.min(ROUND_TEXT.length - 1, round)],
        x: CENTER_X,
        y: CENTER_Y - 46,
        size: FONT_TITLE,
        color: C.text,
        anchor: "center",
      });
      drawLabel({
        text: COUNTDOWN_TEXT[Math.max(0, Math.min(COUNTDOWN_TEXT.length - 1, Math.ceil(phaseTimer)))],
        x: CENTER_X,
        y: CENTER_Y - countdownSize / 2,
        size: countdownSize,
        color: C.accent,
        anchor: "center",
      });
    }

    if (phase === "play" && fightFlash > 0) {
      drawLabel({
        text: "FIGHT",
        x: CENTER_X,
        y: CENTER_Y - FONT_TITLE,
        size: FONT_TITLE,
        color: C.accent,
        anchor: "center",
      });
    }

    if (phase === "roundOver") {
      drawLabel({
        text: roundWinner < 0 ? "DRAW" : ROUND_WIN_TEXT[roundWinner],
        x: CENTER_X,
        y: CENTER_Y - 30,
        size: FONT_TITLE,
        color: roundWinner < 0 ? C.text : playerColor(roundWinner),
        anchor: "center",
      });
    }

    if (phase === "matchOver" && matchWinner >= 0) {
      drawBox({
        x: 0,
        y: 0,
        w: DESIGN_WIDTH,
        h: DESIGN_HEIGHT,
        color: C.black,
        opacity: 0.7,
      });
      drawLabel({
        text: WIN_TEXT[matchWinner],
        x: CENTER_X,
        y: CENTER_Y - 30,
        size: FONT_TITLE,
        color: playerColor(matchWinner),
        anchor: "center",
      });
      drawHints({
        x: CENTER_X + 42,
        y: CENTER_Y + 2,
        align: "right",
        hints: [{ button: "a" }, { button: "start" }, { text: "REMATCH" }],
        color: C.text,
      });
      drawLabel({
        text: "HOLD BACK  MENU",
        x: CENTER_X,
        y: CENTER_Y + 26,
        size: FONT_SMALL,
        color: C.textDim,
        anchor: "center",
      });
    }
  });

  startMatch();
}

/* -------------------------------------------------------------- preview -- */

/**
 * Menu preview: two fighters trading a punch on a loop.
 *
 * Everything is sized from the box, because the menu draws this small on a
 * card and nearly full-bleed on the selected one.
 */
function drawPreview(x: number, y: number, w: number, h: number, t: number): void {
  const floor = y + h * 0.84;
  const fh = h * 0.42;
  const fw = fh * 0.36;
  /** One design unit of the real stage, in this box. */
  const unit = fh / STAND_H;

  // Ground and skyline, at the stage's own proportions.
  drawBox({ x, y: floor, w, h: y + h - floor, color: C.bgAlt });
  let sx = x - unit * 6;
  for (let i = 0; i < SKYLINE.length && sx < x + w; i++) {
    const [bw, bh] = SKYLINE[i];
    const cw = bw * unit;
    const ch = bh * unit;
    drawBox({ x: sx, y: floor - ch, w: cw, h: ch, color: C.bgAlt });
    sx += cw + unit * 4;
  }
  drawBox({ x, y: floor, w, h: Math.max(1, unit), color: C.dim });

  // One exchange per cycle: close in, P1 punches, P2 answers, step back.
  const cycle = t * 0.75;
  const beat = cycle - Math.floor(cycle);
  const close = 0.5 - Math.cos(beat * Math.PI * 2) * 0.5;
  const gap = fw * (3.4 - close * 1.7);
  const p1Punch = beat > 0.34 && beat < 0.46;
  const p2Punch = beat > 0.58 && beat < 0.7;

  const drawOne = (cx: number, facing: number, color: Color, punching: boolean): void => {
    const headH = fh * 0.25;
    const legH = fh * 0.33;
    const torsoH = fh - headH - legH;
    const top = floor - fh;
    const armY = top + headH + fh * 0.06;
    drawBox({ x: cx - fw / 2, y: top + headH + torsoH, w: fw * 0.34, h: legH, color });
    drawBox({ x: cx + fw * 0.16, y: top + headH + torsoH, w: fw * 0.34, h: legH, color });
    drawBox({ x: cx - fw / 2, y: top + headH, w: fw, h: torsoH, color });
    drawBox({ x: cx - fw * 0.38 + facing * fw * 0.12, y: top, w: fw * 0.75, h: headH, color });
    const reach = punching ? fw * 1.3 : fw * 0.4;
    drawBox({
      x: facing > 0 ? cx + fw * 0.3 : cx - fw * 0.3 - reach,
      y: armY,
      w: reach,
      h: Math.max(1, fh * 0.11),
      color: punching ? C.white : color,
    });
  };

  const leftX = x + w / 2 - gap / 2;
  const rightX = x + w / 2 + gap / 2;
  drawOne(leftX, 1, C.p1, p1Punch);
  drawOne(rightX, -1, C.p2, p2Punch);

  // A spark at the point of contact, on the frames a punch is out.
  if (p1Punch || p2Punch) {
    const hx = p1Punch ? leftX + fw * 1.4 : rightX - fw * 1.4;
    const spark = Math.max(2, fh * 0.13);
    drawBox({
      x: hx - spark / 2,
      y: floor - fh * 0.72,
      w: spark,
      h: spark,
      color: C.white,
    });
  }
}

/**
 * Options-screen sample: the round clock and the countdown, the two numbers
 * this game sizes from the setting. Nothing on the field scales — a fighter's
 * size is their reach, and reach against a fixed stage is the match.
 */
function drawScaleSample(x: number, y: number, w: number, h: number): void {
  const clockSize = scaleUnits(FONT_TITLE);
  const countdownSize = scaleUnits(FONT_HUGE);
  // Two caption lines and one numeral: at 2x the countdown alone is 56 units
  // in a panel a quarter of the screen wide, so the clock is a number rather
  // than a second sample.
  const captionY = y + h - FONT_SMALL * 2 - 2;
  const midY = (y + captionY) / 2;

  drawLabel({
    text: "3",
    x: x + w / 2,
    y: midY - countdownSize / 2,
    size: countdownSize,
    color: C.accent,
    anchor: "center",
  });
  drawLabel({
    text: `COUNT ${countdownSize}`,
    x: x + w / 2,
    y: captionY,
    size: FONT_SMALL,
    color: C.textDim,
    anchor: "center",
  });
  drawLabel({
    text: `CLOCK ${clockSize}`,
    x: x + w / 2,
    y: captionY + FONT_SMALL + 2,
    size: FONT_SMALL,
    color: C.textDim,
    anchor: "center",
  });
}

export const brawlGame: GameDefinition = {
  id: SCENE,
  title: "TARMAC BRAWL",
  tagline: "Best of 3. Throw beats block.",
  players: "2P VERSUS",
  accent: "accent",
  controls: [
    { buttons: ["left", "right"], label: "WALK — AWAY GUARDS" },
    { buttons: ["up", "down"], label: "JUMP / CROUCH" },
    { buttons: ["a"], label: "PUNCH — LOW IF CROUCHED" },
    { buttons: ["b"], label: "KICK — SWEEP IF CROUCHED" },
    { buttons: ["y"], label: "THROW — BEATS A GUARD" },
    { buttons: ["x"], label: "FIREBALL — SPENDS A PIP" },
  ],
  drawPreview,
  drawScaleSample,
  register(): void {
    defineScene(SCENE, main);
  },
};

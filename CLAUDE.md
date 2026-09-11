# Tarmac Retro Games

A 2-player arcade cabinet on KAPLAY. Read `README.md` for the full picture;
these are the rules that are easy to break without noticing.

## Design in low resolution, render at native

`DESIGN_WIDTH x DESIGN_HEIGHT` (320x320) in `src/core/config.ts` is a
**design-unit** space, not a framebuffer. Rendering happens at the monitor's
real resolution, but every layout and gameplay decision is made in these
coarse units — chunky shapes, few text sizes, nothing that depends on detail
finer than about one unit. Do not add sub-unit detail "because the screen can
show it": it will look wrong next to everything else, and the cabinet is read
from a couple of metres away.

Minimums that hold everywhere: text at 10 units, hairlines at 1 unit,
interactive or status marks at 5 units square.

## Game scale

A player-facing multiplier on the handful of things a game sizes from it — the
Pong ball and paddles, the Snake cell, in-game countdowns. It is **not** a zoom
of the design box: 320x320 stays the authority, and courts, speeds, tick rates,
layout margins, the menu and all chrome are unaffected.

- Tune the **baseline** number, then draw with `scaleUnits(BASE)` from
  `core/settings.ts`.
- Read it **at scene entry**, into a local. Never per frame: the value must not
  change under a match in progress, and grid dimensions are baked into every
  cell index in play.
- Scale element sizes and short in-game numerals. Do not scale a court, a
  speed or a tick rate — the pace of a game should not depend on the setting.
- Long lines (a "PLAYER 1 WINS" banner) stay on `FONT_TITLE` unscaled; at 2x a
  13-character line does not fit the box.
- Anything preallocated from a grid size sizes that allocation from
  `GAME_SCALE_MIN` so one allocation covers every step (see `CAP` in
  `snakeDuel.ts`).
- A game with scale-sensitive elements should implement `drawScaleSample` so
  the options screen can show it.

## Idle and attract

Nobody stays at the cabinet, so nothing stays put: a screen with no input
returns to the menu, and the menu browses itself.

- **The scene wrapper is the only gate.** `defineScene` installs the bail-out
  on every scene except the menu; games and operator screens do not check, the
  same way they do not check unlocks. Do not add a second one.
- **Activity is defined once**, in `input.ts`, which already knows what every
  player did this frame. Edges either way count, a hold counts for its first
  `STUCK_HOLD_SECONDS` only — a jammed button must not pin the cabinet inside
  a game — and any key event counts even unbound, because the setup screens
  exist for inputs that are not bound yet. Feed the clock there, not from a
  scene.
- **The length is an operator setting** (`IDLE_RETURN_STEPS` in
  `settings.ts`), including `OFF`, and unlike the game scale it is read **per
  frame**: nothing is sized from it, and a change has to land while the
  options screen is still up. The attract cadence is not configurable and
  keeps running with the timeout off.
- Warning strings are prebuilt per whole second, and the timeout labels once
  per step, because both are drawn every frame — format at the definition, not
  in `onDraw`.

## Timed unlocks

A game can be gated behind a release time (`core/unlocks.ts`, options screen).

- **The menu is the only gate.** Games do not check; their scenes are only
  reachable through the carousel, so a second check would be a second place
  to forget. Anything new that can start a game calls `isLocked` and
  `gameEnabled` first.
- A locked game is still on the carousel, as `???` over a dimmed preview with
  its countdown. Never show the title, tagline or accent colour of a locked
  game, and never open its controls modal — the modal names it and launches
  it.
- Countdown and stamp strings come from `unlocks.ts` already built and cached
  per game, because both screens draw them every frame and `onDraw` must not
  allocate. Format there, not at the call site.
- The clock is the machine's local clock, read as `Date.now()` per frame — so
  a card unlocks while the menu is open without anything watching for it.

## Switching a game off

A game can also be taken off the cabinet outright (`core/roster.ts`, options
screen) — for a game that is **broken**, not one that is waiting.

- **A game that is off is not on the carousel at all**: no card, no dot, no
  place in the wrap-around. This is the opposite call from a timed unlock, on
  purpose. A locked card is an advert with a countdown and something to come
  back for; a broken game has neither, and a card that only ever refuses would
  collect presses all day. Do not add an "out of order" card.
- The menu filters `GAMES` **once, at scene entry**, into a local. Nothing but
  the options screen changes the roster and leaving options enters the menu, so
  there is no stale-list window — and a list rebuilt per frame would allocate
  in `onDraw`. Handle `count === 0`: with every game off the menu draws the
  `NO GAMES ENABLED` notice and browsing, launching and attract are all inert.
- **One field, two flags.** The options row offers `OFF` / `ON` / `TIMED` as
  one three-position state, because the operator is answering one question per
  game and because a seventh field does not fit next to a 12-character title
  and a countdown. `roster.ts` composes it from the roster switch and
  `unlockScheduled`; the position is *derived*, never a third stored copy.
  `unlocks.ts` owns the timestamp fields only.
- Switching a game off never touches its unlock time — it is kept, dimmed, so
  a schedule can be prepared before the game goes back on.

## Offline

The build is a PWA and precaches itself whole; nothing is fetched at runtime,
so keep it that way — a font, sprite or sound pulled from a URL breaks the one
guarantee here. Anything new that has to ship as a file goes in `public/` and
is picked up by `globPatterns` in `vite.config.ts`.

- **The menu is the only place an update is applied**, the same way it is the
  only unlock gate: `core/pwa.ts` sits on a waiting build until `syncPwa()`
  runs on menu entry. Never switch the worker to `autoUpdate` — it would
  reload the page mid-rally.
- The update check rides on that same call, throttled. Do not add an interval
  for it: the cabinet returns to the menu on its own constantly, and a
  long-lived timer is exactly what `core/lifecycle.ts` exists to avoid.
- The worker is off in `vite dev`. Test offline behaviour with
  `npm run build && npm run preview`, and read `sw` in the `F3` overlay.

## Always high contrast

Every colour used for text sits at 6.5:1 or better against `bg`; the border
grey clears 4:1. Contrast figures are listed above `PALETTE` in
`src/core/config.ts`. Check any new colour against `bg` before using it for
something a player has to read, and never convey state by a dim/bright pair
alone at this size.

## Draw through `core/ui.ts`

`drawBox`, `drawLabel`, `drawPanel`, `drawDot`, `drawTriangle`, `drawRule`,
`drawBar`, `drawDottedColumn` take **design units** and convert to device
pixels. Calling `k.drawRect` / `k.drawText` directly still compiles but lands
in raw pixels and ignores the viewport — the one mistake here that
typechecking will not catch. Camera-space effects need converting too:
`k.shake(pu(...))`.

## Scenes and cleanup

- Register scenes with `defineScene` and switch with `goTo` — never `k.go`.
  `go()` clears all root events and input handlers, so per-frame systems must
  be installed per scene entry (the wrapper does this), and two `go()` calls
  in one frame would run two scene bodies.
- Anything KAPLAY does not own (DOM listeners, raw timers, buffers) goes
  through `onCleanup` / `later` / `every` / `onWindowEvent` in
  `core/lifecycle.ts`. No `setTimeout`, `setInterval`, or bare
  `addEventListener`.
- Never call `k.onGamepadConnect` / `onGamepadDisconnect` / `onResize`: they
  return `void`, cannot be unregistered, and leak one handler per scene entry.
  Poll instead.
- Do not allocate in `onUpdate` / `onDraw`. Build `Color`s and arrays once;
  reuse buffers. Use `makePool` for transient effects, and typed arrays plus a
  single `onDraw` for anything numerous (grid cells, snake segments).

Verify with `F3`: `obj` and `mem` must return to the same numbers after
cycling between scenes.

## Input

Games code against logical actions (`a` is "confirm"), never physical pad
labels. Bindings are per controller `id` and remappable at runtime — see the
input test / button setup screens (cheat code on the menu, or `F4`; `F5` for
options). Those three screens are navigated with **directions only** on
purpose — they must work on a pad whose face buttons report wrong indices.

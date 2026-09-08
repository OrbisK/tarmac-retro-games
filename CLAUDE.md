# Tarmac Retro Games

A 2-player arcade cabinet on KAPLAY. Read `README.md` for the full picture;
these are the rules that are easy to break without noticing.

## Design in low resolution, render at native

`DESIGN_WIDTH x DESIGN_HEIGHT` (320x240) in `src/core/config.ts` is a
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
of the design box: 320x240 stays the authority, and courts, speeds, tick rates,
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

## Timed unlocks

A game can be gated behind a release time (`core/unlocks.ts`, options screen).

- **The menu is the only gate.** Games do not check; their scenes are only
  reachable through the carousel, so a second check would be a second place
  to forget. Anything new that can start a game calls `isLocked` first.
- A locked game is still on the carousel, as `???` over a dimmed preview with
  its countdown. Never show the title, tagline or accent colour of a locked
  game, and never open its controls modal — the modal names it and launches
  it.
- Countdown and stamp strings come from `unlocks.ts` already built and cached
  per game, because both screens draw them every frame and `onDraw` must not
  allocate. Format there, not at the call site.
- The clock is the machine's local clock, read as `Date.now()` per frame — so
  a card unlocks while the menu is open without anything watching for it.

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
